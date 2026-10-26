<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useDesigner } from '@d3-toolkit/shared/composables'
import {
  cleanSongName,
  normalizeTimecode,
  parseImportFile,
  trackSlug,
  type ImportColumn,
  type ImportRecord,
} from './importParser'
import { trackforge } from './trackforge.py'

interface DesignerTrack {
  name: string
  path: string
  sectionCount: number
  secondSectionBeat: number | null
  timecode: string
}

interface ApiResult<T> {
  ok: boolean
  error?: string
  action?: 'created' | 'updated' | 'unchanged'
  repaired?: boolean
  tracks?: T
  name?: string
  path?: string
  timecode?: string
}

interface PreviewTrack {
  id: number
  sourceRow: number
  sourceName: string
  title: string
  timecode: string
  selected: boolean
  message: string
  processed: boolean
}

const { endpoint, connected } = useDesigner()
const { getExistingTracks, syncTrack, registration } = trackforge(endpoint.value)

const rows = ref<PreviewTrack[]>([])
const columns = ref<ImportColumn[]>([])
const sourceRecords = ref<ImportRecord[]>([])
const nameColumn = ref<number | null>(null)
const timecodeColumn = ref<number | null>(null)
const createWithoutTimecode = ref(false)
const filename = ref('')
const sourceSheet = ref('')
const importing = ref(false)
const creating = ref(false)
const designerError = ref('')
const importError = ref('')
const existingTracks = ref<DesignerTrack[]>([])

function parseResponse<T>(response: { returnValue?: string }): T {
  const value = response.returnValue
  if (!value || value === 'None') throw new Error('Designer returned an empty response.')

  let decoded: unknown = value
  if (value.startsWith('"')) decoded = JSON.parse(value)
  if (typeof decoded === 'string') decoded = JSON.parse(decoded)
  if (!decoded || typeof decoded !== 'object') throw new Error('Unrecognized response from Designer.')
  return decoded as T
}

function existingTrackFor(row: PreviewTrack): DesignerTrack | undefined {
  const path = `objects/track/${trackSlug(row.title)}.apx`
  return existingTracks.value.find(track => track.path === path)
}

function operationFor(row: PreviewTrack): 'create' | 'update' | 'repair' | 'unchanged' | 'exists' {
  const existing = existingTrackFor(row)
  if (!existing) return 'create'
  if (createWithoutTimecode.value) return 'exists'
  if (existing.sectionCount < 2 || existing.secondSectionBeat === null) return 'repair'
  return existing.timecode === normalizeTimecode(row.timecode) ? 'unchanged' : 'update'
}

function trackIssue(row: PreviewTrack): string {
  if (!row.title.trim()) return 'Track name is missing.'
  const slug = trackSlug(row.title)
  if (!slug) return 'Track name does not produce a valid track identifier.'
  if (!createWithoutTimecode.value && !normalizeTimecode(row.timecode)) {
    return 'Invalid timecode. Use H:MM:SS or H:MM:SS:FF.'
  }
  if (rows.value.some(other => other.id !== row.id && trackSlug(other.title) === slug)) {
    return 'Duplicate track name in the file.'
  }
  return ''
}

const eligibleRows = computed(() => rows.value.filter(row =>
  !row.processed && !trackIssue(row)
    && operationFor(row) !== 'unchanged' && operationFor(row) !== 'exists',
))
const selectedRows = computed(() => eligibleRows.value.filter(row => row.selected))
const allSelected = computed(() => eligibleRows.value.length > 0
  && eligibleRows.value.every(row => row.selected))

function selectAll(event: Event) {
  const selected = (event.target as HTMLInputElement).checked
  for (const row of eligibleRows.value) row.selected = selected
}

function mapSourceRows() {
  if (nameColumn.value === null || (timecodeColumn.value === null && !createWithoutTimecode.value)) {
    rows.value = []
    return
  }

  rows.value = sourceRecords.value.map((record, id) => {
    const sourceName = record.values[nameColumn.value!] ?? ''
    const rawTimecode = timecodeColumn.value === null ? '' : record.values[timecodeColumn.value] ?? ''
    const normalized = normalizeTimecode(rawTimecode)
    const title = cleanSongName(sourceName)
    return {
      id,
      sourceRow: record.sourceRow,
      sourceName,
      title,
      timecode: normalized ?? rawTimecode,
      selected: Boolean(title && (createWithoutTimecode.value || normalized)),
      message: '',
      processed: false,
    }
  })
}

function setNameColumn(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  nameColumn.value = value === '' ? null : Number(value)
  changeColumns()
}

function setTimecodeColumn(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  createWithoutTimecode.value = value === 'create-only'
  timecodeColumn.value = value === '' || createWithoutTimecode.value ? null : Number(value)
  changeColumns()
}

function changeColumns() {
  designerError.value = ''
  importError.value = ''
  mapSourceRows()
}

async function refreshExistingTracks() {
  const result = parseResponse<ApiResult<DesignerTrack[]>>(await getExistingTracks())
  if (!result.ok || !result.tracks) {
    throw new Error(result.error || 'Could not read existing tracks from Designer.')
  }
  existingTracks.value = result.tracks
  for (const row of rows.value) {
    if (operationFor(row) === 'unchanged' || operationFor(row) === 'exists') row.selected = false
  }
  designerError.value = ''
}

async function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  importing.value = true
  importError.value = ''
  rows.value = []
  columns.value = []
  sourceRecords.value = []
  nameColumn.value = null
  timecodeColumn.value = null
  createWithoutTimecode.value = false
  filename.value = file.name
  sourceSheet.value = ''
  try {
    const result = await parseImportFile(file)
    columns.value = result.columns
    sourceRecords.value = result.records
    nameColumn.value = result.suggestedTitleColumn
    timecodeColumn.value = result.suggestedTimecodeColumn
    sourceSheet.value = result.sourceSheet ?? ''
    mapSourceRows()
    try {
      await refreshExistingTracks()
    } catch (error) {
      designerError.value = error instanceof Error ? error.message : String(error)
    }

    if (nameColumn.value === null) {
      importError.value = 'Select the track name column below to preview the file.'
    } else if (timecodeColumn.value === null && !createWithoutTimecode.value) {
      importError.value = 'Select a timecode column, or choose “No timecode — create tracks only”.'
    } else if (!rows.value.length) {
      importError.value = 'The file contains no data rows.'
    }
  } catch (error) {
    importError.value = error instanceof Error ? error.message : String(error)
  } finally {
    importing.value = false
    input.value = ''
  }
}

function removeFile() {
  rows.value = []
  columns.value = []
  sourceRecords.value = []
  nameColumn.value = null
  timecodeColumn.value = null
  createWithoutTimecode.value = false
  filename.value = ''
  sourceSheet.value = ''
  importError.value = ''
}

async function createSelectedTracks() {
  const pending = selectedRows.value.slice()
  if (!pending.length || creating.value) return

  creating.value = true
  designerError.value = ''
  try {
    for (const row of pending) {
      const timecode = normalizeTimecode(row.timecode)
      if (!createWithoutTimecode.value && !timecode) {
        row.message = 'Invalid timecode.'
        row.selected = false
        continue
      }

      try {
        const request = JSON.stringify({
          title: row.title.trim(),
          slug: trackSlug(row.title),
          timecode: createWithoutTimecode.value ? '' : timecode,
        })
        const result = parseResponse<ApiResult<unknown>>(await syncTrack(request))
        if (!result.ok) throw new Error(result.error || 'Operation failed.')
        row.processed = true
        row.selected = false
        if (result.action === 'created' && createWithoutTimecode.value) row.message = 'Track created without a TC tag'
        else if (result.action === 'created') row.message = 'Track created'
        else if (result.action === 'unchanged' && createWithoutTimecode.value) row.message = 'Track already exists; left unchanged'
        else if (result.action === 'updated' && result.repaired) row.message = 'Sections repaired; TC updated'
        else if (result.action === 'updated') row.message = 'TC updated'
        else row.message = 'TC already up to date'
        try {
          await refreshExistingTracks()
        } catch (error) {
          designerError.value = error instanceof Error ? error.message : String(error)
        }
      } catch (error) {
        row.selected = false
        row.message = error instanceof Error ? error.message : String(error)
      }
    }
  } finally {
    creating.value = false
  }
}

onMounted(async () => {
  try {
    await registration
    await refreshExistingTracks()
  } catch (error) {
    designerError.value = error instanceof Error ? error.message : String(error)
  }
})
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">
        <img class="brand-icon" src="/icon.png" alt="" aria-hidden="true">
        <div>
          <p class="eyebrow">DISGUISE DESIGNER</p>
          <h1>TrackForge</h1>
        </div>
      </div>
      <span class="connection" :class="{ connected }">
        <span class="connection-dot"></span>
        {{ connected ? 'Designer connected' : 'Designer not connected' }}
      </span>
    </header>

    <main>
      <section class="panel import-panel">
        <div>
          <h2>Import a track list</h2>
          <p>Load a CSV or Excel (.xlsx) file. Choose a timecode column to sync TC tags, or import track names only.</p>
        </div>
        <label class="file-button">
          {{ importing ? 'Reading file…' : 'Choose file' }}
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            :disabled="importing || creating"
            @change="handleFile"
          >
        </label>
      </section>

      <section v-if="columns.length" class="panel mapping-panel">
        <div>
          <h2>Column mapping</h2>
          <p>Confirm or choose the columns used for track names and timecodes.</p>
        </div>
        <label>
          Track name column
          <select :value="nameColumn ?? ''" :disabled="creating" @change="setNameColumn">
            <option value="">Select a column</option>
            <option v-for="column in columns" :key="column.index" :value="column.index">
              {{ column.label }}
            </option>
          </select>
        </label>
        <label>
          Timecode column
          <select :value="createWithoutTimecode ? 'create-only' : (timecodeColumn ?? '')" :disabled="creating" @change="setTimecodeColumn">
            <option value="">Select a column</option>
            <option v-for="column in columns" :key="column.index" :value="column.index">
              {{ column.label }}
            </option>
            <option value="create-only">No timecode — create tracks only</option>
          </select>
        </label>
      </section>

      <div v-if="filename" class="file-summary">
        <span class="file-icon">{{ filename.toLowerCase().endsWith('.xlsx') ? 'XLSX' : 'CSV' }}</span>
        <span><strong>{{ filename }}</strong><small v-if="sourceSheet">Worksheet: {{ sourceSheet }}</small></span>
        <button class="text-button" :disabled="creating" @click="removeFile">
          Remove
        </button>
      </div>
      <p v-if="importError" class="notice error">{{ importError }}</p>
      <p v-if="designerError" class="notice error">{{ designerError }}</p>

      <section v-if="rows.length" class="panel report-panel">
        <div class="report-heading">
          <div>
            <h2>{{ createWithoutTimecode ? 'Track creation report' : 'Track creation and update report' }}</h2>
            <p>{{ eligibleRows.length }} valid · {{ selectedRows.length }} selected · {{ rows.length }} rows read</p>
          </div>
          <button class="primary" :disabled="!connected || !selectedRows.length || creating" @click="createSelectedTracks">
            {{ creating ? 'Applying changes…' : createWithoutTimecode ? `Create ${selectedRows.length} tracks` : `Apply ${selectedRows.length} changes` }}
          </button>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th class="check-cell">
                  <input
                    type="checkbox"
                    aria-label="Select all valid operations"
                    :checked="allSelected"
                    :disabled="!eligibleRows.length || creating"
                    @change="selectAll"
                  >
                </th>
                <th>Row</th>
                <th>Track name</th>
                <th>{{ createWithoutTimecode ? 'Timecode tag' : 'TC tag in second section' }}</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id" :class="{ invalid: trackIssue(row), completed: row.processed }">
                <td class="check-cell">
                  <input
                    v-model="row.selected"
                    type="checkbox"
                    :aria-label="`Select ${row.title || 'unnamed row'}`"
                    :disabled="Boolean(trackIssue(row)) || row.processed || operationFor(row) === 'unchanged' || operationFor(row) === 'exists' || creating"
                  >
                </td>
                <td class="row-number">{{ row.sourceRow }}</td>
                <td>
                  <input
                    v-model="row.title"
                    class="edit-field title-field"
                    aria-label="Track name"
                    :disabled="creating || row.processed"
                  >
                  <small v-if="row.sourceName && row.sourceName !== row.title" class="source-name">
                    Source: {{ row.sourceName }}
                  </small>
                </td>
                <td>
                  <span v-if="createWithoutTimecode" class="result">Not requested</span>
                  <input
                    v-else
                    v-model="row.timecode"
                    class="edit-field timecode-field"
                    aria-label="Tag timecode"
                    :disabled="creating || row.processed"
                  >
                </td>
                <td>
                  <span v-if="row.processed" class="result success">{{ row.message }}</span>
                  <span v-else-if="row.message" class="result failure">{{ row.message }}</span>
                  <span v-else-if="trackIssue(row)" class="result failure">{{ trackIssue(row) }}</span>
                  <span v-else-if="operationFor(row) === 'exists'" class="result success">Track already exists; no TC changes requested</span>
                  <span v-else-if="operationFor(row) === 'unchanged'" class="result success">TC already up to date</span>
                  <span v-else-if="operationFor(row) === 'repair'" class="result ready">Existing track has no second section; it will be repaired</span>
                  <span v-else-if="operationFor(row) === 'update'" class="result ready">TC {{ existingTrackFor(row)?.timecode || 'missing' }} → {{ normalizeTimecode(row.timecode) }}</span>
                  <span v-else-if="createWithoutTimecode" class="result ready">Ready to create without a TC tag</span>
                  <span v-else class="result ready">Ready to create</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="report-footnote">
          <template v-if="createWithoutTimecode">
            Only new tracks will be created; existing tracks are left unchanged. New tracks have an empty first section lasting 1 minute, and no TC tag is written.
          </template>
          <template v-else>
            Existing tracks are not recreated: only a changed TC tag in the second section is updated.
            If the minimum section structure is missing, it is repaired before writing the tag. New tracks have an empty first section lasting 1 minute.
            HH:MM:SS values are completed with frame 00.
          </template>
        </p>
      </section>
    </main>
    <footer>Created by Stefano Petroni</footer>
  </div>
</template>

<style>
* { box-sizing: border-box; }

:root {
  color-scheme: dark;
  font-family: Inter, "Segoe UI", sans-serif;
  background: #3b3b3b;
  color: #eeeeee;
  font-synthesis: none;

  --designer-toolbar: #292929;
  --designer-panel: #444444;
  --designer-border: #565656;
  --designer-input: #363636;
  --designer-muted: #b5b5b5;
  --designer-green: #16851f;
  --designer-green-hover: #1b9b28;
}

body { margin: 0; min-width: 680px; background: #3b3b3b; }
button, input, select { font: inherit; }
button { cursor: pointer; }
button:disabled, input:disabled, select:disabled { cursor: not-allowed; opacity: .55; }

.app { max-width: 1400px; margin: 0 auto; padding: 28px 32px 40px; }
.topbar, .import-panel, .report-heading, .file-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.topbar { padding-bottom: 22px; border-bottom: 1px solid var(--designer-border); }
.brand { display: flex; align-items: center; gap: 13px; }
.brand-icon { width: 44px; height: 44px; border-radius: 9px; object-fit: cover; }
.eyebrow { margin: 0 0 6px; color: var(--designer-muted); font-size: 10px; font-weight: 700; letter-spacing: .16em; }
h1 { margin: 0; font-size: 22px; letter-spacing: -.02em; }
h2 { margin: 0 0 7px; font-size: 16px; }
p { margin: 0; color: var(--designer-muted); font-size: 13px; line-height: 1.55; }
.connection { display: inline-flex; align-items: center; gap: 8px; color: #d3b66d; font-size: 12px; }
.connection.connected { color: #61c86a; }
.connection-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
main { display: grid; gap: 18px; padding-top: 22px; }
.panel { border: 1px solid var(--designer-border); border-radius: 6px; background: var(--designer-panel); }
.import-panel { gap: 20px; padding: 20px; }
.mapping-panel {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(180px, .7fr) minmax(180px, .7fr);
  align-items: end;
  gap: 16px;
  padding: 18px 20px;
}
.mapping-panel label { display: grid; gap: 7px; color: #dedede; font-size: 11px; font-weight: 600; }
.mapping-panel select {
  width: 100%;
  min-height: 34px;
  padding: 5px 8px;
  border: 1px solid #666666;
  border-radius: 3px;
  background: var(--designer-input);
  color: #eeeeee;
  font-size: 12px;
}
.mapping-panel select:focus { border-color: #8b8b8b; outline: none; }
.file-button, .primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 38px;
  padding: 0 15px;
  border: 1px solid var(--designer-green);
  border-radius: 4px;
  background: var(--designer-green);
  color: white;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}
.file-button input { display: none; }
.primary:hover:not(:disabled), .file-button:hover { border-color: var(--designer-green-hover); background: var(--designer-green-hover); }
.file-summary { justify-content: flex-start; gap: 12px; padding: 2px 4px; }
.file-icon {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 7px;
  background: #314b33;
  color: #8bd78f;
  font-size: 10px;
  font-weight: 700;
}
.file-summary strong { display: block; color: #eeeeee; font-size: 12px; font-weight: 600; }
.file-summary small { display: block; margin-top: 3px; color: var(--designer-muted); font-size: 11px; }
.text-button { margin-left: auto; border: 0; background: none; color: #c4c4c4; font-size: 12px; }
.text-button:hover { color: #fff; }
.notice { padding: 11px 14px; border: 1px solid #706344; border-radius: 4px; background: #4c4639; }
.notice.error { border-color: #805050; background: #503838; color: #ffc1b5; }
.report-panel { overflow: hidden; }
.report-heading { gap: 18px; padding: 18px 20px; }
.table-wrap { overflow: auto; border-top: 1px solid var(--designer-border); }
table { width: 100%; border-collapse: collapse; text-align: left; }
th { padding: 11px 12px; background: var(--designer-toolbar); color: #d0d0d0; font-size: 10px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; }
td { padding: 10px 12px; border-top: 1px solid #585858; vertical-align: middle; }
tbody tr:hover { background: #4c4c4c; }
tbody tr.invalid { background: #4b3b3b; }
tbody tr.completed { background: #3d4a3e; }
.check-cell { width: 42px; text-align: center; }
.check-cell input { width: 15px; height: 15px; accent-color: var(--designer-green-hover); }
.row-number { width: 58px; color: #d0d0d0; font-size: 12px; }
.edit-field { width: 100%; min-height: 32px; padding: 5px 8px; border: 1px solid #666666; border-radius: 3px; outline: none; background: var(--designer-input); color: #eeeeee; font-size: 12px; }
.edit-field:focus { border-color: #8b8b8b; }
.title-field { min-width: 180px; }
.timecode-field { min-width: 140px; font-family: Consolas, monospace; }
.source-name { display: block; max-width: 390px; margin: 4px 2px 0; overflow: hidden; color: #c0c0c0; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.result { font-size: 11px; }
.result.ready { color: #dddddd; }
.result.success { color: #81d888; }
.result.failure { color: #ffaaa0; }
.report-footnote { padding: 12px 20px 15px; border-top: 1px solid var(--designer-border); font-size: 11px; }
footer { padding-top: 4px; color: #c0c0c0; font-size: 10px; text-align: right; }

@media (max-width: 850px) {
  .app { padding: 20px 16px; }
  .import-panel { align-items: flex-start; flex-direction: column; }
  .report-heading { align-items: flex-start; flex-direction: column; }
  body { min-width: 600px; }
}
</style>
