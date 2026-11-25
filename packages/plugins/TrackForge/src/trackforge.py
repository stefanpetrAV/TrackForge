__all__ = ["getExistingTracks", "syncTrack", "reaperRequest"]

import base64
import json
import re
import time


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


_REAPER_COMMANDS = ("TRANSPORT", "REGION")
_REAPER_TIMEOUT_SECONDS = 1.5


def _reaper_error(kind, error, status=None, elapsed_ms=None):
    return _json_result({
        "ok": False,
        "kind": kind,
        "status": status,
        "error": error,
        "elapsedMs": elapsed_ms,
    })


def reaperRequest(request_json):
    """Send one read-only command to the REAPER web interface.

    The request runs inside Designer, so the plugin browser does not need
    cross-origin access to the REAPER computer. The timeout is short because
    this call blocks Designer's Python while it waits.
    """
    try:
        request = json.loads(request_json)
        host = unicode(request.get("host", "")).strip()
        port = int(request.get("port", 0))
        command = unicode(request.get("command", "")).strip().upper()
        username = unicode(request.get("username", "") or "")
        password = unicode(request.get("password", "") or "")
    except:
        return _reaper_error("invalid", "Invalid REAPER connection settings.")

    if not re.match(r"^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,252})$", host):
        return _reaper_error("invalid", "Enter a valid REAPER host name or IP address.")
    if port < 1 or port > 65535:
        return _reaper_error("invalid", "Enter a REAPER port between 1 and 65535.")
    if command not in _REAPER_COMMANDS:
        return _reaper_error("invalid", "Unsupported REAPER command.")

    try:
        import urllib2
        HTTPError = urllib2.HTTPError
        URLError = urllib2.URLError
        Request = urllib2.Request
        urlopen = urllib2.urlopen
    except ImportError:
        try:
            import urllib.request as _request
            import urllib.error as _error
            HTTPError = _error.HTTPError
            URLError = _error.URLError
            Request = _request.Request
            urlopen = _request.urlopen
        except ImportError:
            return _reaper_error("unsupported", "Designer's Python cannot make HTTP requests.")

    url = "http://%s:%d/_/%s" % (host, port, command)
    http_request = Request(url)
    if username or password:
        token = base64.b64encode(("%s:%s" % (username, password)).encode("utf-8"))
        http_request.add_header("Authorization", "Basic %s" % token.decode("ascii"))

    started = time.time()
    try:
        response = urlopen(http_request, timeout=_REAPER_TIMEOUT_SECONDS)
        raw = response.read()
        status = int(response.getcode())
    except HTTPError as error:
        elapsed_ms = int((time.time() - started) * 1000)
        code = int(error.code)
        if code == 401:
            return _reaper_error("auth", "REAPER rejected the username or password.", code, elapsed_ms)
        if code == 404:
            return _reaper_error(
                "notFound",
                "REAPER answered, but the web interface command was not found on this port.",
                code,
                elapsed_ms,
            )
        return _reaper_error("http", "REAPER answered with HTTP %d." % code, code, elapsed_ms)
    except Exception:
        elapsed_ms = int((time.time() - started) * 1000)
        if elapsed_ms >= int(_REAPER_TIMEOUT_SECONDS * 1000) - 50:
            return _reaper_error(
                "timeout",
                "REAPER did not respond within %.1f s." % _REAPER_TIMEOUT_SECONDS,
                None,
                elapsed_ms,
            )
        return _reaper_error("unreachable", "Could not connect to REAPER.", None, elapsed_ms)

    elapsed_ms = int((time.time() - started) * 1000)
    try:
        body = raw.decode("utf-8")
    except:
        body = raw.decode("latin-1")
    return _json_result({
        "ok": True,
        "status": status,
        "body": body,
        "elapsedMs": elapsed_ms,
    })
