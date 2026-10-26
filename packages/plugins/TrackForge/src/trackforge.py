__all__ = ["getExistingTracks", "syncTrack"]

import json
import re


def _json_result(value):
    return json.dumps(value)


def _active_tracks():
    import d3

    tracks = resourceManager.allResources(d3.Track)
    result = []
    for index in range(len(tracks)):
        track = tracks[index]
        path = unicode(track.path).lower()
        if path.startswith("objects/track/"):
            section_count = int(track.nSections())
            second_section_beat = None
            timecode = ""
            if section_count > 1:
                second_section_beat = float(track.sectionToBeat(1))
                cue = track.cueAtBeat(second_section_beat)
                tags = cue.getTags()
                for tag_index in range(len(tags)):
                    tag = tags[tag_index]
                    if int(tag.type) == d3.Tag.TC:
                        timecode = unicode(tag.text)
                        break
            result.append({
                "name": unicode(track.description),
                "path": path,
                "sectionCount": section_count,
                "secondSectionBeat": second_section_beat,
                "timecode": timecode,
            })
    return result


def _find_active_track(path):
    import d3

    tracks = resourceManager.allResources(d3.Track)
    for index in range(len(tracks)):
        track = tracks[index]
        if unicode(track.path).lower() == path:
            return track
    return None


def getExistingTracks():
    try:
        result = _active_tracks()
    except:
        return _json_result({
            "ok": False,
            "error": "Designer could not return the list of tracks.",
        })
    return _json_result({"ok": True, "tracks": result})


def syncTrack(request_json):
    import d3

    try:
        request = json.loads(request_json)
    except:
        return _json_result({"ok": False, "error": "Invalid request."})

    try:
        title = unicode(request.get("title", "")).strip()
        slug = unicode(request.get("slug", "")).strip().lower()
        timecode = unicode(request.get("timecode", "")).strip()
    except:
        return _json_result({"ok": False, "error": "Invalid title, track identifier, or timecode."})

    if not title or not re.match(r"^[a-z0-9]+(?:-[a-z0-9]+)*$", slug):
        return _json_result({"ok": False, "error": "Invalid track name."})
    if timecode and not re.match(r"^\d+:[0-5]\d:[0-5]\d:\d{2}$", timecode):
        return _json_result({"ok": False, "error": "Invalid timecode; use H:MM:SS:FF."})

    path = "objects/track/%s.apx" % slug
    try:
        track = _find_active_track(path)
        created = track is None
        if not created and not timecode:
            return _json_result({
                "ok": True,
                "action": "unchanged",
                "repaired": False,
                "name": title,
                "path": path,
                "timecode": "",
            })
        if created:
            track = resourceManager.loadOrCreate(path, d3.Track)
        if track is None:
            return _json_result({
                "ok": False,
                "error": "Designer could not create the track.",
            })

        if created:
            track.notifyCreate()

        structure_changed = False
        section_count = int(track.nSections())
        repaired = created or section_count < 2
        if repaired:
            has_start_section = False
            has_minute_section = False
            for index in range(section_count):
                section_beat = float(track.sectionToBeat(index))
                if abs(section_beat) <= 0.0001:
                    has_start_section = True
                if abs(section_beat - float(track.timeToBeat(60.0))) <= 0.0001:
                    has_minute_section = True

            if not has_start_section:
                markDirty(track)
                track.splitSectionAtBeat(track.timeToBeat(0.0))
                structure_changed = True
            if not has_minute_section:
                markDirty(track)
                track.splitSectionAtBeat(track.timeToBeat(60.0))
                structure_changed = True

            section_count = int(track.nSections())
            if section_count < 2:
                return _json_result({
                    "ok": False,
                    "error": "Designer did not create the required sections.",
                })
            second_section_beat = float(track.sectionToBeat(1))
        else:
            second_section_beat = float(track.sectionToBeat(1))

        if not timecode:
            if created or structure_changed:
                track.save()
                track = _find_active_track(path)
                if track is None:
                    return _json_result({
                        "ok": False,
                        "error": "The track is no longer available after saving.",
                    })

            section_count = int(track.nSections())
            if section_count < 2 or abs(float(track.sectionToBeat(1)) - float(second_section_beat)) > 0.0001:
                return _json_result({
                    "ok": False,
                    "error": "The second section was not saved correctly.",
                })

            return _json_result({
                "ok": True,
                "action": "created",
                "repaired": repaired,
                "name": title,
                "path": path,
                "timecode": "",
            })

        cue = track.cueAtBeat(second_section_beat)
        tags = cue.getTags()
        current_timecode = ""
        for index in range(len(tags)):
            tag = tags[index]
            if int(tag.type) == d3.Tag.TC:
                current_timecode = unicode(tag.text)
                break
        updated = current_timecode != timecode
        if updated:
            markDirty(track)
            track.setTagAtBeat(second_section_beat, d3.Tag(d3.Tag.TC, timecode))
        if updated or structure_changed:
            track.save()
            track = _find_active_track(path)
            if track is None:
                return _json_result({
                    "ok": False,
                    "error": "The track is no longer available after saving.",
                })

        section_count = int(track.nSections())
        if section_count < 2 or abs(float(track.sectionToBeat(1)) - float(second_section_beat)) > 0.0001:
            return _json_result({
                "ok": False,
                "error": "The second section was not saved correctly.",
            })

        cue = track.cueAtBeat(second_section_beat)
        tags = cue.getTags()
        timecode_tags = []
        for index in range(len(tags)):
            tag = tags[index]
            if int(tag.type) == d3.Tag.TC:
                timecode_tags.append(unicode(tag.text))
        if timecode_tags != [timecode]:
            return _json_result({
                "ok": False,
                "error": "The TC tag was not correctly updated in the second section.",
            })
    except:
        return _json_result({
            "ok": False,
            "error": "Designer did not complete the track operation.",
        })

    return _json_result({
        "ok": True,
        "action": "created" if created else ("updated" if updated else "unchanged"),
        "repaired": repaired,
        "name": title,
        "path": path,
        "timecode": timecode,
    })
