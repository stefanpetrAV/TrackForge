import { cleanSongName, normalizeTimecode, trackSlug } from './importParser'

export type ReaperConnectionState = 'idle' | 'connecting' | 'connected' | 'error'

export interface ReaperRequest {
  host: string
  port: number
  username: string
  password: string
  command: 'TRANSPORT' | 'REGION'
}

export interface ReaperResponse {
  ok: boolean
  kind?: string
  status?: number | null
  body?: string
  error?: string
  elapsedMs?: number | null
}

export interface SyncResult {
  ok: boolean
  error?: string
  action?: 'created' | 'updated' | 'unchanged'
  repaired?: boolean
}

export interface ReaperConnectApi {
  reaperRequest: (request: ReaperRequest) => Promise<ReaperResponse>
  syncTrack: (request: { title: string; slug: string; timecode: string }) => Promise<SyncResult>
  refreshTracks: () => Promise<void>
}

export interface ReaperRegion {
  id: number
  name: string
  start: number
  end: number
}

export interface DesignerTrackInfo {
  name: string
  path: string
  sectionCount: number
  secondSectionBeat: number | null
  timecode: string
}

export interface FrameRate {
  id: string
  label: string
  /** Frames counted per second in the timecode label. */
  nominal: number
  /** Real frames per second. */
  rate: number
  dropFrame: boolean
}

export const frameRates: FrameRate[] = [
  { id: '23.976', label: '23.976', nominal: 24, rate: 24000 / 1001, dropFrame: false },
  { id: '24', label: '24', nominal: 24, rate: 24, dropFrame: false },
  { id: '25', label: '25', nominal: 25, rate: 25, dropFrame: false },
  { id: '29.97', label: '29.97 NDF', nominal: 30, rate: 30000 / 1001, dropFrame: false },
  { id: '29.97df', label: '29.97 DF', nominal: 30, rate: 30000 / 1001, dropFrame: true },
  { id: '30', label: '30', nominal: 30, rate: 30, dropFrame: false },
  { id: '50', label: '50', nominal: 50, rate: 50, dropFrame: false },
  { id: '60', label: '60', nominal: 60, rate: 60, dropFrame: false },
]

export function frameRateById(id: string): FrameRate {
  return frameRates.find(rate => rate.id === id) ?? frameRates[2]
}

function unescapeField(value: string): string {
  return value.replace(/\\([\\nt])/g, (_, char: string) => (char === 'n' ? '\n' : char === 't' ? '\t' : '\\'))
}

/**
 * Parses the answer to the REAPER web interface command `REGION`:
 *   REGION_LIST
 *   REGION<TAB>name<TAB>id<TAB>start<TAB>end<TAB>color
 *   REGION_LIST_END
 */
export function parseRegionList(body: string): ReaperRegion[] {
  const regions: ReaperRegion[] = []
  for (const line of body.split(/\r?\n/)) {
    const fields = line.split('\t')
    if (fields[0] !== 'REGION' || fields.length < 5) continue
    const id = Number(fields[2])
    const start = Number(fields[3])
    const end = Number(fields[4])
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    regions.push({ id: Number.isFinite(id) ? id : regions.length + 1, name: unescapeField(fields[1]), start, end })
  }
  return regions.sort((a, b) => a.start - b.start || a.id - b.id)
}

export function isRegionListResponse(body: string): boolean {
  return /^REGION_LIST\b/m.test(body)
}

export function isTransportResponse(body: string): boolean {
  return /^TRANSPORT\t/m.test(body)
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Converts a frame count to H:MM:SS:FF using the nominal rate (and drop-frame numbering when set). */
export function framesToTimecode(totalFrames: number, fps: FrameRate): string {
  let frames = Math.max(0, Math.round(totalFrames))
  const nominal = fps.nominal
  if (fps.dropFrame) {
    const dropped = Math.round(nominal / 15) // 2 frames at 29.97
    const framesPer10Minutes = Math.round(fps.rate * 600)
    const framesPerMinute = nominal * 60 - dropped
    const tens = Math.floor(frames / framesPer10Minutes)
    const remainder = frames % framesPer10Minutes
    frames += dropped * 9 * tens
    if (remainder > dropped) frames += dropped * Math.floor((remainder - dropped) / framesPerMinute)
  }
  const ff = frames % nominal
  const totalSeconds = Math.floor(frames / nominal)
  const ss = totalSeconds % 60
  const mm = Math.floor(totalSeconds / 60) % 60
  const hh = Math.floor(totalSeconds / 3600)
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`
}

/** Converts an H:MM:SS[:FF] label to a frame count. Returns null when the label is invalid. */
export function timecodeToFrames(value: string, fps: FrameRate): number | null {
  const normalized = normalizeTimecode(value)
  if (!normalized) return null
  const [hh, mm, ss, ff] = normalized.split(':').map(Number)
  if (ff >= fps.nominal) return null
  const totalMinutes = hh * 60 + mm
  let frames = (totalMinutes * 60 + ss) * fps.nominal + ff
  if (fps.dropFrame) {
    const dropped = Math.round(fps.nominal / 15)
    frames -= dropped * (totalMinutes - Math.floor(totalMinutes / 10))
  }
  return frames
}

/** REAPER region start (seconds from project start) plus the project start TC. */
export function regionTimecode(seconds: number, fps: FrameRate, offsetFrames: number): string {
  return framesToTimecode(Math.round(seconds * fps.rate) + offsetFrames, fps)
}

export function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, '0')}`
}

export type ComparisonStatus = 'update' | 'create' | 'repair' | 'conflict' | 'invalid' | 'sync' | 'orphan'

export interface ComparisonRow {
  key: string
  status: ComparisonStatus
  region: ReaperRegion | null
  title: string
  slug: string
  track: DesignerTrackInfo | null
  designerTimecode: string
  reaperTimecode: string
  note: string
}

export interface RegionTitle {
  region: ReaperRegion
  title: string
}

export const actionableStatuses: ComparisonStatus[] = ['update', 'create', 'repair']

export function defaultRegionTitle(region: ReaperRegion): string {
  return cleanSongName(region.name)
}

/**
 * Compares REAPER regions with Designer tracks. Each region is matched to the track
 * `objects/track/<slug>.apx`, where the slug comes from the (editable) region title,
 * exactly as the file import does.
 */
export function compareRegions(
  regions: RegionTitle[],
  tracks: DesignerTrackInfo[],
  fps: FrameRate,
  offsetFrames: number,
): ComparisonRow[] {
  const bySlug = new Map<string, number[]>()
  regions.forEach(({ title }, index) => {
    const slug = trackSlug(title)
    if (!slug) return
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), index])
  })

  const usedPaths = new Set<string>()
  const rows: ComparisonRow[] = regions.map(({ region, title }, index) => {
    const slug = trackSlug(title)
    const path = `objects/track/${slug}.apx`
    const track = slug ? tracks.find(candidate => candidate.path === path) ?? null : null
    if (track) usedPaths.add(track.path)
    const reaperTimecode = regionTimecode(region.start, fps, offsetFrames)
    const base = {
      key: `region-${region.id}-${index}`,
      region,
      title,
      slug,
      track,
      designerTimecode: track?.timecode ?? '',
      reaperTimecode,
    }

    if (!slug) return { ...base, status: 'invalid' as const, note: 'Region name does not produce a valid track name.' }
    const twins = (bySlug.get(slug) ?? []).filter(other => other !== index)
    if (twins.length) {
      const ids = twins.map(other => regions[other].region.id).join(', ')
      return { ...base, status: 'conflict' as const, note: `Same track name as region ${ids}.` }
    }
    if (!track) return { ...base, status: 'create' as const, note: 'Will be created with TC.' }
    if (track.sectionCount < 2 || track.secondSectionBeat === null) {
      return { ...base, status: 'repair' as const, note: 'Sections repaired, then TC written.' }
    }
    if (normalizeTimecode(track.timecode) === reaperTimecode) {
      return { ...base, status: 'sync' as const, note: 'Up to date.' }
    }
    return {
      ...base,
      status: 'update' as const,
      note: `${track.timecode || 'missing'} → ${reaperTimecode}`,
    }
  })

  for (const track of tracks) {
    if (usedPaths.has(track.path)) continue
    rows.push({
      key: `track-${track.path}`,
      status: 'orphan',
      region: null,
      title: track.name,
      slug: track.path.replace(/^objects\/track\//, '').replace(/\.apx$/, ''),
      track,
      designerTimecode: track.timecode,
      reaperTimecode: '',
      note: 'No matching region; left unchanged.',
    })
  }
  return rows
}
