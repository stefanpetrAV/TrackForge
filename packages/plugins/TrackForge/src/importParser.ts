import * as XLSX from '@e965/xlsx'

export interface ImportColumn {
  index: number
  label: string
}

export interface ImportRecord {
  sourceRow: number
  values: string[]
}

export interface ImportResult {
  columns: ImportColumn[]
  records: ImportRecord[]
  suggestedTitleColumn: number | null
  suggestedTimecodeColumn: number | null
  sourceSheet?: string
}

const titleHeaders = new Set([
  'name', 'song', 'track', 'trackname', 'songname', 'tracktitle', 'songtitle',
  'segment', 'titledur', 'titleanddur',
  'traccia', 'nometraccia', 'canzone', 'nomecanzone', 'cue', 'titolo',
  'titolobrano', 'nomebrano', 'nome',
])
const timecodeHeaders = new Set([
  'tc', 'tcstart', 'start', 'starttime', 'timecode', 'timecodestart', 'ltc',
  'orainizio', 'timecodeinizio',
])
const preferredTitleHeaders = new Set(['segment', 'titledur', 'titleanddur'])
const preferredTimecodeHeaders = new Set(['ltc', 'tcstart'])
const timecodePattern = /^(\d{1,}):([0-5]\d):([0-5]\d)(?::(\d{2}))?$/

function cellText(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

function headerKey(value: unknown): string {
  return cellText(value).toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function normalizeTimecode(value: string): string | null {
  const match = timecodePattern.exec(value.trim())
  if (!match) return null
  return `${match[1]}:${match[2]}:${match[3]}:${match[4] ?? '00'}`
}

export function cleanSongName(value: string): string {
  let name = value.trim().replace(/\s*\n\s*du(?:r|\d)\s*.*$/i, '').replace(/\.[^./\\]+$/, '')
  const technicalSuffixes = [
    /_REF[\s_-]*MIX\b.*$/i,
    /_L_MIX(?:[-_].*)?$/i,
    /_OPEN\d{2}[_ ]MUSIC\b.*$/i,
    /_\d{6,8}\s*\[chan\b.*$/i,
    /\s*\[chan\b.*$/i,
  ]
  for (const suffix of technicalSuffixes) {
    name = name.replace(suffix, '')
  }
  return name.replace(/[\s,_-]+$/, '').trim()
}

function findHeader(rows: unknown[][]): { row: number; title: number | null; timecode: number | null } | null {
  let fallbackRow: number | null = null
  let partialMatch: { row: number; title: number | null; timecode: number | null } | null = null
  let bestMatch: { row: number; title: number | null; timecode: number | null; score: number } | null = null
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 20); rowIndex++) {
    const row = rows[rowIndex] ?? []
    if (fallbackRow === null && row.filter(value => cellText(value) !== '').length > 1) {
      fallbackRow = rowIndex
    }
    let title: number | null = null
    let timecode: number | null = null
    let preferredTitle = false
    let preferredTimecode = false
    for (let index = 0; index < row.length; index++) {
      const key = headerKey(row[index])
      if (title === null && titleHeaders.has(key)) title = index
      if (timecode === null && timecodeHeaders.has(key)) timecode = index
      if (preferredTitleHeaders.has(key)) preferredTitle = true
      if (preferredTimecodeHeaders.has(key)) preferredTimecode = true
    }
    if (partialMatch === null && (title !== null || timecode !== null)) {
      partialMatch = { row: rowIndex, title, timecode }
    }
    if (title !== null && timecode !== null) {
      const score = 200 + Number(preferredTitle) * 10 + Number(preferredTimecode) * 10
      if (bestMatch === null || score > bestMatch.score || (score === bestMatch.score && rowIndex > bestMatch.row)) {
        bestMatch = { row: rowIndex, title, timecode, score }
      }
    }
  }
  if (bestMatch) return { row: bestMatch.row, title: bestMatch.title, timecode: bestMatch.timecode }
  if (partialMatch) return partialMatch
  return fallbackRow === null ? null : { row: fallbackRow, title: null, timecode: null }
}

function inspectGrid(rows: unknown[][], sourceSheet?: string, includeHeaderlessList = false): ImportResult | null {
  const header = findHeader(rows)
  if (!header) return null
  const recognizedHeader = header.title !== null || header.timecode !== null
  if (
    includeHeaderlessList
    && !recognizedHeader
    && isNumberedHeaderlessList(rows)
  ) {
    const columnCount = Math.max(...rows.map(row => row?.length ?? 0), 0)
    return {
      columns: Array.from({ length: columnCount }, (_, index) => ({
        index,
        label: `Column ${index + 1}`,
      })),
      records: rows
        .map((row, index) => ({ sourceRow: index + 1, values: (row ?? []).map(cellText) }))
        .filter(record => record.values.some(value => value !== '')),
      suggestedTitleColumn: 1,
      suggestedTimecodeColumn: null,
      sourceSheet,
    }
  }

  const data = rows.slice(header.row + 1)
    .map((row, index) => ({ sourceRow: header.row + index + 2, values: (row ?? []).map(cellText) }))
    .filter(record => record.values.some(value => value !== ''))

  const columnCount = Math.max(
    (rows[header.row] ?? []).length,
    ...data.map(record => record.values.length),
    0,
  )
  const columns: ImportColumn[] = []
  for (let index = 0; index < columnCount; index++) {
    const label = cellText(rows[header.row]?.[index]) || `Column ${index + 1}`
    columns.push({ index, label })
  }

  return {
    columns,
    records: data,
    suggestedTitleColumn: header.title,
    suggestedTimecodeColumn: header.timecode,
    sourceSheet,
  }
}

function isNumberedHeaderlessList(rows: unknown[][]): boolean {
  const nonEmptyRows = rows.filter(row => (row ?? []).some(value => cellText(value) !== ''))
  if (nonEmptyRows.length < 2) return false
  const numberedRows = nonEmptyRows.filter(row =>
    /^\d+(?:[.,]\d+)?$/.test(cellText(row[0]))
      && Boolean(cellText(row[1]))
      && !normalizeTimecode(cellText(row[1])),
  )
  return numberedRows.length >= Math.ceil(nonEmptyRows.length * 0.8)
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"'
        index++
      } else {
        quoted = !quoted
      }
    } else if (!quoted && character === delimiter) {
      row.push(field)
      field = ''
    } else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

export function parseCsvText(text: string): ImportResult {
  const content = text.replace(/^\uFEFF/, '')
  let bestResult: ImportResult | null = null
  let bestScore = -1

  for (const delimiter of [',', ';', '\t']) {
    const result = inspectGrid(parseDelimited(content, delimiter), undefined, true)
    if (!result) continue

    const recognizedHeaders = Number(result.suggestedTitleColumn !== null)
      + Number(result.suggestedTimecodeColumn !== null)
    const score = recognizedHeaders * 100 + result.columns.length
    if (score > bestScore) {
      bestResult = result
      bestScore = score
    }
  }

  if (bestResult) return bestResult
  throw new Error('No usable header row found. Choose a file with column names.')
}

export function parseXlsxBuffer(buffer: ArrayBuffer): ImportResult {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    })
    const result = inspectGrid(rows, sheetName)
    if (result) return result
  }
  throw new Error('No usable header row found in any Excel worksheet.')
}

export async function parseImportFile(file: File): Promise<ImportResult> {
  const extension = file.name.toLowerCase().split('.').pop()
  if (extension === 'csv') return parseCsvText(await file.text())
  if (extension === 'xlsx') return parseXlsxBuffer(await file.arrayBuffer())
  throw new Error('Unsupported file type. Select a CSV or Excel .xlsx file.')
}

export function trackSlug(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
