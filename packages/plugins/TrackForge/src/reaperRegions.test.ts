import { describe, expect, it } from 'vitest'
import {
  compareRegions,
  defaultRegionTitle,
  frameRateById,
  framesToTimecode,
  isRegionListResponse,
  isTransportResponse,
  parseRegionList,
  regionTimecode,
  timecodeToFrames,
  type DesignerTrackInfo,
} from './reaperRegions'

const fps25 = frameRateById('25')

function track(name: string, slug: string, timecode: string, sectionCount = 2): DesignerTrackInfo {
  return {
    name,
    path: `objects/track/${slug}.apx`,
    sectionCount,
    secondSectionBeat: sectionCount > 1 ? 60 : null,
    timecode,
  }
}

describe('REAPER region list', () => {
  it('parses the web interface REGION answer and sorts by start', () => {
    const body = [
      'REGION_LIST',
      'REGION\tBallad\t3\t465.48\t662\t0',
      'REGION\tIntro.wav\t1\t0.000000\t102.12\t16777216',
      'REGION\tTab\\tname\t2\t120\t130\t0',
      'REGION_LIST_END',
      '',
    ].join('\n')

    expect(isRegionListResponse(body)).toBe(true)
    expect(parseRegionList(body)).toEqual([
      { id: 1, name: 'Intro.wav', start: 0, end: 102.12 },
      { id: 2, name: 'Tab\tname', start: 120, end: 130 },
      { id: 3, name: 'Ballad', start: 465.48, end: 662 },
    ])
  })

  it('accepts an empty project and recognizes a TRANSPORT answer', () => {
    expect(parseRegionList('REGION_LIST\nREGION_LIST_END\n')).toEqual([])
    expect(isRegionListResponse('<html>Not REAPER</html>')).toBe(false)
    expect(isTransportResponse('TRANSPORT\t0\t12.5\t0\t0:12.500\t5.1.00\n')).toBe(true)
  })
})

describe('timecode conversion', () => {
  it('adds the project start TC to the region start', () => {
    const offset = timecodeToFrames('01:00:00:00', fps25)!
    expect(regionTimecode(0, fps25, offset)).toBe('01:00:00:00')
    expect(regionTimecode(132.32, fps25, offset)).toBe('01:02:12:08')
    expect(regionTimecode(465.48, fps25, 0)).toBe('00:07:45:12')
  })

  it('round-trips drop-frame labels at 29.97', () => {
    const df = frameRateById('29.97df')
    expect(framesToTimecode(1800, df)).toBe('00:01:00:02')
    expect(framesToTimecode(17982, df)).toBe('00:10:00:00')
    expect(timecodeToFrames('00:01:00:02', df)).toBe(1800)
    expect(timecodeToFrames('01:00:00:00', df)).toBe(107892)
  })

  it('rejects frames beyond the frame rate', () => {
    expect(timecodeToFrames('00:00:00:25', fps25)).toBeNull()
  })
})

describe('compareRegions', () => {
  it('classifies regions and Designer-only tracks', () => {
    const regions = parseRegionList([
      'REGION_LIST',
      'REGION\tIntro\t1\t0\t10\t0',
      'REGION\tOpening Medley\t2\t132.32\t400\t0',
      'REGION\tNotte Stellata\t3\t690\t900\t0',
      'REGION\tDrum Solo\t4\t905\t915\t0',
      'REGION\tEncore\t5\t1770\t1980\t0',
      'REGION\tencore\t6\t1990\t2160\t0',
      'REGION\t!!!\t7\t2200\t2210\t0',
      'REGION\tInterlude_REF MIX.wav\t8\t1180\t1255\t0',
      'REGION_LIST_END',
    ].join('\n')).map(region => ({ region, title: defaultRegionTitle(region) }))

    const tracks = [
      track('Intro', 'intro', '01:00:00:00'),
      track('Opening Medley', 'opening-medley', '01:02:10:00'),
      track('Drum Solo', 'drum-solo', '', 1),
      track('Encore', 'encore', '01:29:30:00'),
      track('Interlude', 'interlude', ''),
      track('Soundcheck', 'soundcheck', '00:55:00:00'),
    ]

    const rows = compareRegions(regions, tracks, fps25, timecodeToFrames('01:00:00:00', fps25)!)
    expect(rows.map(row => [row.title, row.status])).toEqual([
      ['Intro', 'sync'],
      ['Opening Medley', 'update'],
      ['Notte Stellata', 'create'],
      ['Drum Solo', 'repair'],
      ['Interlude', 'update'],
      ['Encore', 'conflict'],
      ['encore', 'conflict'],
      ['!!!', 'invalid'],
      ['Soundcheck', 'orphan'],
    ])
    expect(rows[1].note).toBe('01:02:10:00 → 01:02:12:08')
    expect(rows[4].note).toBe('missing → 01:19:40:00')
    expect(rows[5].note).toBe('Same track name as region 6.')
  })

  it('uses an edited title to resolve a conflict', () => {
    const [first, second] = parseRegionList('REGION\tEncore\t1\t0\t1\t0\nREGION\tEncore\t2\t5\t6\t0')
    const rows = compareRegions(
      [{ region: first, title: 'Encore' }, { region: second, title: 'Encore 2' }],
      [],
      fps25,
      0,
    )
    expect(rows.map(row => [row.slug, row.status])).toEqual([['encore', 'create'], ['encore-2', 'create']])
  })
})
