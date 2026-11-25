<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { trackSlug } from './importParser'
import {
  actionableStatuses,
  compareRegions,
  defaultRegionTitle,
  formatSeconds,
  frameRateById,
  frameRates,
  isRegionListResponse,
  isTransportResponse,
  parseRegionList,
  timecodeToFrames,
  type ComparisonRow,
  type ComparisonStatus,
  type DesignerTrackInfo,
  type ReaperConnectApi,
  type ReaperConnectionState,
  type ReaperRegion,
  type ReaperRequest,
  type ReaperResponse,
} from './reaperRegions'

const props = defineProps<{
  designerConnected: boolean
  tracks: DesignerTrackInfo[]
  api: ReaperConnectApi
}>()

const emit = defineEmits<{
  status: [state: ReaperConnectionState, attention: number]
}>()

const storageKey = 'trackforge.reaperConnect'

function loadSettings() {
  const defaults = { host: '', port: 8080, username: '', fps: '25', offset: '00:00:00:00' }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}')
    return { ...defaults, ...saved }
  } catch {
    return defaults
  }
}

const settings = reactive(loadSettings())
const password = ref('')
watch(settings, value => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value))
  } catch {
    // Storage is optional.
  }
})

const state = ref<ReaperConnectionState>('idle')
const statusText = ref('Enter the REAPER address, then test the connection.')
const errorText = ref('')
const regions = ref<ReaperRegion[]>([])
const titles = reactive<Record<string, string>>({})
const selected = reactive<Record<string, boolean>>({})
const results = reactive<Record<string, { ok: boolean; message: string }>>({})
const hasRead = ref(false)
const applying = ref(false)
const filter = ref<ComparisonStatus | 'all'>('all')

const fps = computed(() => frameRateById(settings.fps))
const offsetFrames = computed(() => timecodeToFrames(settings.offset, fps.value))
const busy = computed(() => state.value === 'connecting' || applying.value)

function regionKey(region: ReaperRegion): string {
  return `${region.id}@${region.start}`
}

const rows = computed<ComparisonRow[]>(() => {
  if (!hasRead.value || offsetFrames.value === null) return []
  const input = regions.value.map(region => ({
    region,
    title: titles[regionKey(region)] ?? defaultRegionTitle(region),
  }))
  return compareRegions(input, props.tracks, fps.value, offsetFrames.value)
})

function rowId(row: ComparisonRow): string {
  return row.region ? regionKey(row.region) : row.key
}

function isActionable(row: ComparisonRow): boolean {
  return actionableStatuses.includes(row.status) && !results[rowId(row)]?.ok
}

const actionableRows = computed(() => rows.value.filter(isActionable))
const selectedRows = computed(() => actionableRows.value.filter(row => selected[rowId(row)]))
const allSelected = computed(() => actionableRows.value.length > 0
  && actionableRows.value.every(row => selected[rowId(row)]))
const visibleRows = computed(() => filter.value === 'all'
  ? rows.value
  : rows.value.filter(row => row.status === filter.value))

const statusOrder: { id: ComparisonStatus; label: string }[] = [
  { id: 'update', label: 'TC to update' },
  { id: 'create', label: 'Missing in Designer' },
  { id: 'repair', label: 'To repair' },
  { id: 'conflict', label: 'Conflicts' },
  { id: 'invalid', label: 'Invalid names' },
  { id: 'sync', label: 'In sync' },
  { id: 'orphan', label: 'Designer only' },
]
const statusLabels: Record<ComparisonStatus, string> = {
  update: 'TC to update',
  create: 'Missing in Designer',
  repair: 'To repair',
  conflict: 'Conflict',
  invalid: 'Invalid name',
  sync: 'In sync',
  orphan: 'Designer only',
}

const counts = computed(() => {
  const result: Record<string, number> = {}
  for (const row of rows.value) result[row.status] = (result[row.status] ?? 0) + 1
  return result
})
const attention = computed(() => rows.value.filter(row =>
  isActionable(row) || row.status === 'conflict' || row.status === 'invalid').length)

watch([state, attention], () => emit('status', state.value, attention.value), { immediate: true })

// New actionable rows start selected, like the file import report.
watch(actionableRows, list => {
  for (const row of list) {
    const id = rowId(row)
    if (!(id in selected)) selected[id] = true
  }
})

function connectionRequest(command: ReaperRequest['command']): ReaperRequest | null {
  const host = settings.host.trim()
  if (!host) {
    fail('Enter the REAPER host name or IP address.')
    return null
  }
  return {
    host,
    port: Number(settings.port),
    username: settings.username.trim(),
    password: password.value,
    command,
  }
}

function now(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fail(message: string) {
  state.value = 'error'
  errorText.value = message
  statusText.value = `Last attempt at ${now()}`
}

function explain(response: ReaperResponse): string {
  const address = `${settings.host.trim()}:${settings.port}`
  switch (response.kind) {
    case 'timeout':
    case 'unreachable':
      return `REAPER did not respond at ${address}. Check that REAPER is open, that the web interface is enabled on this port, and that the firewall on the REAPER computer allows incoming connections.`
    case 'auth':
      return 'REAPER rejected the username or password set for its web interface.'
    case 'notFound':
      return `Something answered at ${address}, but not the REAPER web interface. Check the port in REAPER › Preferences › Control/OSC/web.`
    default:
      return response.error || 'REAPER did not complete the request.'
  }
}

async function send(command: ReaperRequest['command']): Promise<ReaperResponse | null> {
  if (!props.designerConnected) {
    fail('Designer is not connected. TrackForge contacts REAPER through Designer.')
    return null
  }
  const request = connectionRequest(command)
  if (!request) return null
  state.value = 'connecting'
  errorText.value = ''
  statusText.value = `Contacting ${request.host}:${request.port}…`
  try {
    const response = await props.api.reaperRequest(request)
    if (!response.ok) {
      fail(explain(response))
      return null
    }
    return response
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    return null
  }
}

async function testConnection() {
  const response = await send('TRANSPORT')
  if (!response) return
  if (!isTransportResponse(response.body ?? '')) {
    fail('The address answered, but the reply is not from the REAPER web interface.')
    return
  }
  state.value = 'connected'
  statusText.value = `REAPER responded in ${response.elapsedMs ?? '?'} ms · tested at ${now()}`
}

async function readRegions() {
  if (offsetFrames.value === null) {
    fail('Project start TC is not valid for the selected frame rate. Use HH:MM:SS:FF.')
    return
  }
  const response = await send('REGION')
  if (!response) return
  const body = response.body ?? ''
  if (!isRegionListResponse(body)) {
    fail('The address answered, but the reply is not a REAPER region list.')
    return
  }
  try {
    await props.api.refreshTracks()
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
    return
  }
  regions.value = parseRegionList(body)
  for (const key of Object.keys(results)) delete results[key]
  hasRead.value = true
  state.value = 'connected'
  statusText.value = `REAPER responded in ${response.elapsedMs ?? '?'} ms · ${regions.value.length} regions · read at ${now()}`
}

function selectAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  for (const row of actionableRows.value) selected[rowId(row)] = checked
}

function setTitle(row: ComparisonRow, event: Event) {
  if (!row.region) return
  titles[regionKey(row.region)] = (event.target as HTMLInputElement).value
}

async function applyChanges() {
  const pending = selectedRows.value.slice()
  if (!pending.length || applying.value) return
  applying.value = true
  try {
    for (const row of pending) {
      const id = rowId(row)
      try {
        const result = await props.api.syncTrack({
          title: row.title.trim(),
          slug: trackSlug(row.title),
          timecode: row.reaperTimecode,
        })
        if (!result.ok) throw new Error(result.error || 'Operation failed.')
        let message = 'TC already up to date'
        if (result.action === 'created') message = 'Track created with TC'
        else if (result.action === 'updated' && result.repaired) message = 'Sections repaired; TC updated'
        else if (result.action === 'updated') message = 'TC updated'
        results[id] = { ok: true, message }
      } catch (error) {
        results[id] = { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
      selected[id] = false
    }
    try {
      await props.api.refreshTracks()
    } catch (error) {
      errorText.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    applying.value = false
  }
}

const statusColor: Record<ComparisonStatus, string> = {
  update: 'var(--rc-warn)',
  create: 'var(--rc-new)',
  repair: 'var(--rc-repair)',
  conflict: 'var(--rc-bad)',
  invalid: 'var(--rc-bad)',
  sync: 'var(--rc-ok)',
  orphan: 'var(--rc-grey)',
}
</script>

<template>
  <div class="reaper">
    <section class="panel conn-panel">
      <div>
        <h2>REAPER connection</h2>
        <p>
          Uses REAPER's built-in web interface (Preferences › Control/OSC/web › Web browser interface).
          Regions are read from the open REAPER project and compared with the tracks in this Designer project.
        </p>
      </div>
      <div class="fields">
        <label>
          Host / IP
          <input v-model.trim="settings.host" class="mono" placeholder="192.168.1.42" :disabled="busy">
        </label>
        <label>
          Port
          <input v-model.number="settings.port" class="mono" type="number" min="1" max="65535" :disabled="busy">
        </label>
        <label>
          Username <small>(optional)</small>
          <input v-model="settings.username" autocomplete="off" :disabled="busy">
        </label>
        <label>
          Password <small>(optional, not saved)</small>
          <input v-model="password" type="password" autocomplete="off" :disabled="busy">
        </label>
        <label>
          Frame rate
          <select v-model="settings.fps" :disabled="busy">
            <option v-for="rate in frameRates" :key="rate.id" :value="rate.id">{{ rate.label }}</option>
          </select>
        </label>
        <label>
          Project start TC
          <input v-model.trim="settings.offset" class="mono" :class="{ bad: offsetFrames === null }" :disabled="busy">
        </label>
      </div>
      <div class="actions">
        <button class="secondary" :disabled="busy" @click="testConnection">Test connection</button>
        <button class="primary" :disabled="busy" @click="readRegions">
          {{ state === 'connecting' ? 'Reading…' : 'Read regions' }}
        </button>
        <span class="status-line">{{ statusText }}</span>
      </div>
      <p v-if="errorText" class="notice error">{{ errorText }}</p>
    </section>

    <div v-if="rows.length" class="summary">
      <button class="chip" :class="{ active: filter === 'all' }" style="--c: #cfcfcf" @click="filter = 'all'">
        <span class="swatch"></span>All <b>{{ rows.length }}</b>
      </button>
      <template v-for="item in statusOrder" :key="item.id">
        <button
          v-if="counts[item.id]"
          class="chip"
          :class="{ active: filter === item.id }"
          :style="{ '--c': statusColor[item.id] }"
          @click="filter = item.id"
        >
          <span class="swatch"></span>{{ item.label }} <b>{{ counts[item.id] }}</b>
        </button>
      </template>
    </div>

    <section v-if="hasRead" class="panel report-panel">
      <div class="report-heading">
        <div>
          <h2>REAPER regions vs Designer tracks</h2>
          <p>
            {{ actionableRows.length }} actionable · {{ selectedRows.length }} selected ·
            {{ regions.length }} regions · {{ tracks.length }} tracks
          </p>
        </div>
        <button class="primary" :disabled="!designerConnected || !selectedRows.length || applying" @click="applyChanges">
          {{ applying ? 'Applying changes…' : `Apply ${selectedRows.length} changes` }}
        </button>
      </div>

      <p v-if="!rows.length" class="empty">The REAPER project has no regions and Designer has no tracks.</p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="check-cell">
                <input
                  type="checkbox"
                  aria-label="Select all actionable rows"
                  :checked="allSelected"
                  :disabled="!actionableRows.length || applying"
                  @change="selectAll"
                >
              </th>
              <th>#</th>
              <th>REAPER region</th>
              <th>Designer track</th>
              <th>TC in Designer</th>
              <th>TC from REAPER</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in visibleRows"
              :key="row.key"
              :class="[`st-${row.status}`, { completed: results[rowId(row)]?.ok }]"
              :style="{ '--c': statusColor[row.status] }"
            >
              <td class="check-cell">
                <input
                  v-model="selected[rowId(row)]"
                  type="checkbox"
                  :aria-label="`Select ${row.title || 'region'}`"
                  :disabled="!isActionable(row) || applying"
                >
              </td>
              <td class="row-number">{{ row.region?.id ?? '—' }}</td>
              <td>
                <template v-if="row.region">
                  <input
                    class="edit-field title-field"
                    aria-label="Track name"
                    :value="row.title"
                    :disabled="applying || results[rowId(row)]?.ok"
                    @input="setTitle(row, $event)"
                  >
                  <small class="sub">
                    <template v-if="row.region.name !== row.title">{{ row.region.name }} · </template>
                    {{ formatSeconds(row.region.start) }} – {{ formatSeconds(row.region.end) }}
                  </small>
                </template>
                <span v-else class="dash">No region</span>
              </td>
              <td>
                <span v-if="row.track" class="mono">{{ row.track.path.replace(/^objects\/track\//, '').replace(/\.apx$/, '') }}</span>
                <span v-else class="dash">Not in project</span>
              </td>
              <td class="mono">
                <span v-if="row.track && row.track.sectionCount < 2" class="dash">no 2nd section</span>
                <span v-else-if="row.track">{{ row.designerTimecode || '—' }}</span>
                <span v-else class="dash">—</span>
              </td>
              <td class="mono" :class="{ diff: ['update', 'create', 'repair'].includes(row.status) }">
                {{ row.reaperTimecode || '—' }}
              </td>
              <td>
                <span class="state">{{ statusLabels[row.status] }}</span>
                <small v-if="results[rowId(row)]" class="sub" :class="results[rowId(row)].ok ? 'ok' : 'fail'">
                  {{ results[rowId(row)].message }}
                </small>
                <small v-else class="sub">{{ row.note }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="report-footnote">
        Each region is matched to a track with the same name cleanup used by file import; edit the name in the table
        to match a different track or to resolve a conflict. The TC is the region start plus the project start TC.
        Designer-only tracks, conflicts and invalid names are shown for information and are never changed.
      </p>
    </section>
  </div>
</template>

<style scoped>
.reaper {
  --rc-ok: #81d888;
  --rc-warn: #e7c46b;
  --rc-new: #79b8f0;
  --rc-repair: #d6a0f0;
  --rc-bad: #ffaaa0;
  --rc-grey: #9a9a9a;
  display: grid;
  gap: 18px;
}
.conn-panel { display: grid; gap: 16px; padding: 18px 20px; }
.fields {
  display: grid;
  grid-template-columns: minmax(150px, 1.4fr) 90px minmax(110px, 1fr) minmax(110px, 1fr) 110px minmax(120px, 1fr);
  gap: 12px;
  align-items: end;
}
.fields label { display: grid; gap: 7px; min-width: 0; color: #dedede; font-size: 11px; font-weight: 600; }
.fields small { color: var(--designer-muted); font-weight: 400; }
.fields input, .fields select {
  width: 100%;
  min-height: 34px;
  padding: 5px 8px;
  border: 1px solid #666666;
  border-radius: 3px;
  background: var(--designer-input);
  color: #eeeeee;
  font-size: 12px;
}
.fields input:focus, .fields select:focus { border-color: #8b8b8b; outline: none; }
.fields input.bad { border-color: #b86a5e; }
.mono { font-family: Consolas, monospace; font-size: 12px; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.secondary {
  min-height: 38px;
  padding: 0 15px;
  border: 1px solid #6a6a6a;
  border-radius: 4px;
  background: #505050;
  color: #eeeeee;
  font-size: 12px;
  font-weight: 650;
}
.secondary:hover:not(:disabled) { background: #5a5a5a; }
.status-line { margin-left: auto; color: var(--designer-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.summary { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px;
  border: 1px solid var(--designer-border);
  border-radius: 999px;
  background: var(--designer-toolbar);
  color: #eeeeee;
  font-size: 12px;
}
.chip b { font-variant-numeric: tabular-nums; }
.chip .swatch { width: 8px; height: 8px; border-radius: 2px; background: var(--c); }
.chip.active { border-color: var(--c); box-shadow: inset 0 0 0 1px var(--c); }
tbody tr { box-shadow: inset 3px 0 0 var(--c); }
tbody tr.st-update { background: #4a4536; }
tbody tr.st-create { background: #3b4450; }
tbody tr.st-repair { background: #48404d; }
tbody tr.st-conflict, tbody tr.st-invalid { background: #4b3b3b; }
tbody tr.st-orphan { color: #bdbdbd; }
tbody tr.completed { background: #3d4a3e; }
.sub { display: block; margin-top: 4px; color: #c0c0c0; font-size: 10px; }
.sub.ok { color: var(--rc-ok); }
.sub.fail { color: var(--rc-bad); }
.dash { color: #8a8a8a; font-size: 12px; }
.diff { color: var(--rc-warn); font-weight: 700; }
.state {
  display: inline-flex;
  padding: 2px 9px;
  border: 1px solid var(--c);
  border-radius: 999px;
  color: var(--c);
  font-size: 11px;
  white-space: nowrap;
}
.empty { padding: 24px 20px; border-top: 1px solid var(--designer-border); text-align: center; }
@media (max-width: 850px) {
  .fields { grid-template-columns: 1fr 1fr; }
}
</style>
