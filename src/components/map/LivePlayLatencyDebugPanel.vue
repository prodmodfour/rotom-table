<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES,
  type LivePlayCommandTraceEventType,
  type LivePlayCommandTraceSnapshot,
} from '~/utils/livePlayCommandTrace'
import type { MapPresenceDebugMetrics } from '~/composables/map-editor/useMapPresence'
import type { TokenMotionDebugMetrics } from '~/utils/isometric/tokenMotionDebugMetrics'
import type { TokenMotionTrackReason } from '~/utils/isometric/tokenMotionTracks'

const props = defineProps<{
  traces: Readonly<Record<string, LivePlayCommandTraceSnapshot>>
  maxRows?: number
  presenceMetrics?: MapPresenceDebugMetrics | null
  tokenMotionMetrics?: TokenMotionDebugMetrics | null
}>()

interface LivePlayLatencyDebugRow {
  readonly trace: LivePlayCommandTraceSnapshot
  readonly opIdSuffix: string
  readonly commandType: string
  readonly status: string
  readonly resourceSummary: string
  readonly predictedToSse: string
  readonly predictedToHttp: string
  readonly httpToAdopt: string
  readonly sseToAdopt: string
  readonly totalPending: string
  readonly planTime: string
  readonly responseWait: string
  readonly resumeCommit: string
  readonly lifecycleTime: string
  readonly runtime: string
  readonly recovery: string
  readonly terminalOutcome: string
  readonly reasonCode: string
}

interface LivePlayPresenceMetricRow {
  readonly label: string
  readonly value: string
}

interface LivePlayTokenMotionReasonRow extends LivePlayPresenceMetricRow {
  readonly reason: TokenMotionTrackReason
}

const now = ref<number | null>(null)
let refreshTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  now.value = Date.now()
  refreshTimer = setInterval(() => {
    now.value = Date.now()
  }, 1_000)
})

onBeforeUnmount(() => {
  if (refreshTimer !== null) clearInterval(refreshTimer)
})

const maxRows = computed(() => Math.max(1, Math.min(12, Math.floor(props.maxRows ?? 6))))

const latestTraces = computed(() => Object.values(props.traces ?? {})
  .sort((left, right) => right.lastSequence - left.lastSequence)
  .slice(0, maxRows.value))

const firstEventTimestamp = (
  trace: LivePlayCommandTraceSnapshot,
  eventType: LivePlayCommandTraceEventType,
): number | null => (
  trace.events.find((event) => event.type === eventType)?.timestamp ?? null
)

const detailNumber = (
  trace: LivePlayCommandTraceSnapshot,
  key: string,
): number | null => {
  for (const event of trace.events) {
    const value = event.detail?.[key]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return null
}

const lastDetailText = (
  trace: LivePlayCommandTraceSnapshot,
  keys: readonly string[],
): string | null => {
  for (const event of [...trace.events].reverse()) {
    for (const key of keys) {
      const value = event.detail?.[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
  }
  return null
}

const elapsedLabel = (milliseconds: number): string => {
  if (milliseconds < 1_000) return `${milliseconds} ms`
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`
}

const durationLabel = (start: number | null, end: number | null): string => {
  if (start === null || end === null || end < start) return '—'
  return elapsedLabel(end - start)
}

const ageLabel = (timestamp: number | null): string => {
  if (timestamp === null || now.value === null) return '—'
  return elapsedLabel(Math.max(0, now.value - timestamp))
}

const nonNegativeIntegerLabel = (count: number): string => (
  Number.isSafeInteger(count) && count > 0 ? count.toString() : '0'
)

const participantCountLabel = (count: number): string => nonNegativeIntegerLabel(count)

const opIdSuffix = (opId: string): string => {
  const suffix = opId.slice(-8)
  return `…${suffix}`
}

const statusLabel = (status: LivePlayCommandTraceSnapshot['status']): string => {
  if (status === 'rolled-back') return 'rolled back'
  return status
}

const traceEndTimestamp = (trace: LivePlayCommandTraceSnapshot): number => (
  trace.status === 'pending' && now.value !== null
    ? Math.max(trace.updatedAt, now.value)
    : trace.updatedAt
)

const rowForTrace = (trace: LivePlayCommandTraceSnapshot): LivePlayLatencyDebugRow => {
  const predictedAt = firstEventTimestamp(trace, LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.PREDICTED)
  const httpAt = firstEventTimestamp(trace, LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.HTTP_TERMINAL)
  const sseAt = firstEventTimestamp(trace, LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.SSE_TERMINAL)
  const adoptedAt = firstEventTimestamp(trace, LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.PATCH_ADOPTED)
  const plannedAt = firstEventTimestamp(trace, LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.PLANNED)
  const waitingAt = firstEventTimestamp(trace, LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.WAITING_FOR_RESPONSE)
  const resumedAt = firstEventTimestamp(trace, LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.RESUMED)
  const committedAt = firstEventTimestamp(trace, LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.COMMITTED)
  const lifecycleAt = firstEventTimestamp(trace, LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.LIFECYCLE_APPLIED)
  const builtAt = firstEventTimestamp(trace, LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.BUILT)
  const retryCount = trace.events.filter(event => event.type === LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.RECOVERED).length
  const reconcileCount = trace.events.filter(event => event.type === LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES.RECONCILED).length
  const explicitPlanMs = detailNumber(trace, 'planDurationMs')

  return {
    trace,
    opIdSuffix: opIdSuffix(trace.opId),
    commandType: trace.commandType ?? 'unknown command',
    status: statusLabel(trace.status),
    resourceSummary: trace.resourceSummary ?? 'resource scope unavailable',
    predictedToSse: durationLabel(predictedAt, sseAt),
    predictedToHttp: durationLabel(predictedAt, httpAt),
    httpToAdopt: durationLabel(httpAt, adoptedAt),
    sseToAdopt: durationLabel(sseAt, adoptedAt),
    totalPending: durationLabel(trace.startedAt || null, traceEndTimestamp(trace)),
    planTime: explicitPlanMs === null ? durationLabel(builtAt, plannedAt) : elapsedLabel(explicitPlanMs),
    responseWait: durationLabel(waitingAt, resumedAt ?? committedAt),
    resumeCommit: durationLabel(resumedAt, committedAt),
    lifecycleTime: durationLabel(committedAt, lifecycleAt),
    runtime: trace.runtimeKind
      ? `${trace.runtimeKind} v${trace.runtimeVersion ?? '?'}`
      : 'runtime unavailable',
    recovery: `${retryCount} retry · ${reconcileCount} reconcile`,
    terminalOutcome: lastDetailText(trace, ['outcome']) ?? statusLabel(trace.status),
    reasonCode: lastDetailText(trace, ['reasonCode', 'reason']) ?? '—',
  }
}

const rows = computed<readonly LivePlayLatencyDebugRow[]>(() => latestTraces.value.map(rowForTrace))

const tokenMotionAgeLabel = (milliseconds: number | null): string => (
  milliseconds === null ? '—' : elapsedLabel(Math.round(Math.max(0, milliseconds)))
)

const tokenMotionReasonLabel = (reason: TokenMotionTrackReason): string => {
  switch (reason) {
    case 'local-prediction':
      return 'Local prediction'
    case 'remote-accepted':
      return 'Remote accepted'
    case 'server-correction':
      return 'Server correction'
    case 'reconciliation':
      return 'Reconciliation'
    case 'setup-edit':
      return 'Setup edit'
    default:
      return reason
  }
}

const tokenMotionReasonCountLabel = ({
  activeCount,
  startedCount,
  completedCount,
}: TokenMotionDebugMetrics['sourceReasonCounts'][number]): string => (
  `${nonNegativeIntegerLabel(activeCount)} active · ${nonNegativeIntegerLabel(startedCount)} started · ${nonNegativeIntegerLabel(completedCount)} done`
)

const tokenMotionMetricRows = computed<readonly LivePlayPresenceMetricRow[]>(() => {
  const metrics = props.tokenMotionMetrics
  if (!metrics) return []

  return [
    { label: 'Active tokens', value: nonNegativeIntegerLabel(metrics.activeMovingTokenCount) },
    { label: 'Longest active age', value: tokenMotionAgeLabel(metrics.longestActiveMotionAgeMs) },
    { label: 'Completed motions', value: nonNegativeIntegerLabel(metrics.completedMotionCount) },
  ]
})
const tokenMotionReasonRows = computed<readonly LivePlayTokenMotionReasonRow[]>(() => {
  const metrics = props.tokenMotionMetrics
  if (!metrics) return []

  return metrics.sourceReasonCounts.map((counts) => ({
    reason: counts.reason,
    label: tokenMotionReasonLabel(counts.reason),
    value: tokenMotionReasonCountLabel(counts),
  }))
})
const presenceMetricRows = computed<readonly LivePlayPresenceMetricRow[]>(() => {
  const metrics = props.presenceMetrics
  if (!metrics) return []
  return [
    { label: 'Heartbeat age', value: ageLabel(metrics.lastHeartbeatAt) },
    { label: 'Last snapshot age', value: ageLabel(metrics.lastSnapshotAt) },
    { label: 'Last transient age', value: ageLabel(metrics.lastTransientAt) },
    { label: 'Active participants', value: participantCountLabel(metrics.activeParticipantCount) },
  ]
})
</script>

<template>
  <section
    class="live-play-latency-debug-panel"
    aria-labelledby="live-play-latency-debug-title"
    @click.stop
    @mousedown.stop
    @pointerdown.stop
    @wheel.stop
  >
    <header class="live-play-latency-debug-panel__header">
      <div>
        <p class="live-play-latency-debug-panel__eyebrow">Debug only</p>
        <h2 id="live-play-latency-debug-title" class="live-play-latency-debug-panel__title">Live-play latency</h2>
      </div>
      <span class="live-play-latency-debug-panel__count">{{ rows.length }}/{{ maxRows }}</span>
    </header>

    <section
      v-if="presenceMetricRows.length > 0"
      class="live-play-latency-debug-panel__presence"
      aria-labelledby="live-play-latency-debug-presence-title"
    >
      <div class="live-play-latency-debug-panel__presence-header">
        <h3 id="live-play-latency-debug-presence-title">Presence freshness</h3>
        <span>Transient table-feel transport</span>
      </div>
      <dl class="live-play-latency-debug-panel__presence-metrics">
        <div
          v-for="metric in presenceMetricRows"
          :key="metric.label"
        >
          <dt>{{ metric.label }}</dt>
          <dd>{{ metric.value }}</dd>
        </div>
      </dl>
    </section>

    <section
      v-if="tokenMotionMetricRows.length > 0"
      class="live-play-latency-debug-panel__motion"
      aria-labelledby="live-play-latency-debug-motion-title"
    >
      <div class="live-play-latency-debug-panel__motion-header">
        <h3 id="live-play-latency-debug-motion-title">Token motion</h3>
        <span>Presentation-only renderer state</span>
      </div>
      <dl class="live-play-latency-debug-panel__motion-metrics">
        <div
          v-for="metric in tokenMotionMetricRows"
          :key="metric.label"
        >
          <dt>{{ metric.label }}</dt>
          <dd>{{ metric.value }}</dd>
        </div>
      </dl>
      <dl
        v-if="tokenMotionReasonRows.length > 0"
        class="live-play-latency-debug-panel__motion-reasons"
        aria-label="Token motion source reason counts"
      >
        <div
          v-for="reason in tokenMotionReasonRows"
          :key="reason.reason"
        >
          <dt>{{ reason.label }}</dt>
          <dd>{{ reason.value }}</dd>
        </div>
      </dl>
    </section>

    <p v-if="rows.length === 0" class="live-play-latency-debug-panel__empty">
      No live-play command traces recorded yet.
    </p>

    <ol v-else class="live-play-latency-debug-panel__list">
      <li
        v-for="row in rows"
        :key="row.trace.opId"
        class="live-play-latency-debug-panel__row"
      >
        <div class="live-play-latency-debug-panel__row-header">
          <div>
            <p class="live-play-latency-debug-panel__command">{{ row.commandType }}</p>
            <p class="live-play-latency-debug-panel__resource">{{ row.resourceSummary }}</p>
          </div>
          <div class="live-play-latency-debug-panel__identity">
            <span class="live-play-latency-debug-panel__status">{{ row.status }}</span>
            <code>{{ row.opIdSuffix }}</code>
          </div>
        </div>

        <dl class="live-play-latency-debug-panel__timings">
          <div>
            <dt>Pred → SSE</dt>
            <dd>{{ row.predictedToSse }}</dd>
          </div>
          <div>
            <dt>Pred → HTTP</dt>
            <dd>{{ row.predictedToHttp }}</dd>
          </div>
          <div>
            <dt>HTTP → adopt</dt>
            <dd>{{ row.httpToAdopt }}</dd>
          </div>
          <div>
            <dt>SSE → adopt</dt>
            <dd>{{ row.sseToAdopt }}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{{ row.totalPending }}</dd>
          </div>
          <div>
            <dt>Plan</dt>
            <dd>{{ row.planTime }}</dd>
          </div>
          <div>
            <dt>Response wait</dt>
            <dd>{{ row.responseWait }}</dd>
          </div>
          <div>
            <dt>Resume → commit</dt>
            <dd>{{ row.resumeCommit }}</dd>
          </div>
          <div>
            <dt>Lifecycle</dt>
            <dd>{{ row.lifecycleTime }}</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>{{ row.runtime }}</dd>
          </div>
          <div>
            <dt>Recovery</dt>
            <dd>{{ row.recovery }}</dd>
          </div>
          <div>
            <dt>Outcome</dt>
            <dd>{{ row.terminalOutcome }}</dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd>{{ row.reasonCode }}</dd>
          </div>
        </dl>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.live-play-latency-debug-panel {
  position: absolute;
  right: calc(var(--map-overlay-gutter, 0.75rem) + 0.25rem);
  top: calc(var(--map-overlay-gutter, 0.75rem) + 0.25rem);
  z-index: 10830;
  width: min(31rem, calc(100vw - var(--map-nav-rail-width, 0px) - 2rem));
  max-height: min(70vh, 38rem);
  overflow: auto;
  padding: 0.82rem;
  border: 1px solid color-mix(in srgb, var(--accent) 55%, rgba(255, 255, 255, 0.24));
  border-radius: 1rem;
  background: color-mix(in srgb, rgba(7, 9, 13, 0.92) 88%, var(--paper));
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.38);
  color: var(--ink-bright);
  backdrop-filter: blur(12px);
}

.live-play-latency-debug-panel__header,
.live-play-latency-debug-panel__row-header,
.live-play-latency-debug-panel__identity {
  display: flex;
  gap: 0.75rem;
}

.live-play-latency-debug-panel__header,
.live-play-latency-debug-panel__row-header {
  align-items: flex-start;
  justify-content: space-between;
}

.live-play-latency-debug-panel__identity {
  flex: 0 0 auto;
  align-items: flex-end;
  flex-direction: column;
  text-align: right;
}

.live-play-latency-debug-panel__eyebrow,
.live-play-latency-debug-panel__title,
.live-play-latency-debug-panel__empty,
.live-play-latency-debug-panel__command,
.live-play-latency-debug-panel__resource,
.live-play-latency-debug-panel__timings,
.live-play-latency-debug-panel__timings dd,
.live-play-latency-debug-panel__presence h3,
.live-play-latency-debug-panel__motion h3,
.live-play-latency-debug-panel__presence-metrics,
.live-play-latency-debug-panel__motion-metrics,
.live-play-latency-debug-panel__motion-reasons,
.live-play-latency-debug-panel__presence-metrics dd,
.live-play-latency-debug-panel__motion-metrics dd,
.live-play-latency-debug-panel__motion-reasons dd {
  margin: 0;
}

.live-play-latency-debug-panel__eyebrow {
  color: color-mix(in srgb, var(--accent) 78%, white 14%);
  font-size: 0.66rem;
  font-weight: 950;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.live-play-latency-debug-panel__title {
  margin-top: 0.1rem;
  font-size: 0.98rem;
  line-height: 1.1;
}

.live-play-latency-debug-panel__count,
.live-play-latency-debug-panel__status {
  border: 1px solid color-mix(in srgb, var(--accent) 38%, rgba(255, 255, 255, 0.18));
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: color-mix(in srgb, var(--ink-bright) 78%, transparent);
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  line-height: 1;
  padding: 0.28rem 0.45rem;
  text-transform: uppercase;
}

.live-play-latency-debug-panel__empty {
  margin-top: 0.72rem;
  color: color-mix(in srgb, var(--ink-bright) 72%, transparent);
  font-size: 0.76rem;
  font-weight: 750;
}

.live-play-latency-debug-panel__presence,
.live-play-latency-debug-panel__motion {
  margin-top: 0.72rem;
  padding: 0.66rem;
  border: 1px solid color-mix(in srgb, var(--accent) 26%, rgba(255, 255, 255, 0.16));
  border-radius: 0.86rem;
  background: color-mix(in srgb, var(--accent) 10%, rgba(255, 255, 255, 0.055));
}

.live-play-latency-debug-panel__presence-header,
.live-play-latency-debug-panel__motion-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.72rem;
}

.live-play-latency-debug-panel__presence h3,
.live-play-latency-debug-panel__motion h3 {
  font-size: 0.78rem;
  font-weight: 950;
  line-height: 1.18;
}

.live-play-latency-debug-panel__presence-header span,
.live-play-latency-debug-panel__motion-header span {
  color: color-mix(in srgb, var(--ink-bright) 58%, transparent);
  font-size: 0.62rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  line-height: 1.2;
  text-align: right;
  text-transform: uppercase;
}

.live-play-latency-debug-panel__presence-metrics,
.live-play-latency-debug-panel__motion-metrics,
.live-play-latency-debug-panel__motion-reasons {
  display: grid;
  gap: 0.38rem;
  margin-top: 0.54rem;
}

.live-play-latency-debug-panel__presence-metrics,
.live-play-latency-debug-panel__motion-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.live-play-latency-debug-panel__motion-reasons {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.live-play-latency-debug-panel__presence-metrics div,
.live-play-latency-debug-panel__motion-metrics div,
.live-play-latency-debug-panel__motion-reasons div {
  min-width: 0;
  padding: 0.38rem;
  border-radius: 0.62rem;
  background: rgba(0, 0, 0, 0.2);
}

.live-play-latency-debug-panel__presence-metrics dt,
.live-play-latency-debug-panel__motion-metrics dt,
.live-play-latency-debug-panel__motion-reasons dt {
  color: color-mix(in srgb, var(--ink-bright) 58%, transparent);
  font-size: 0.56rem;
  font-weight: 950;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.live-play-latency-debug-panel__presence-metrics dd,
.live-play-latency-debug-panel__motion-metrics dd,
.live-play-latency-debug-panel__motion-reasons dd {
  margin-top: 0.12rem;
  font-size: 0.72rem;
  font-weight: 950;
  white-space: nowrap;
}

.live-play-latency-debug-panel__list {
  display: grid;
  gap: 0.62rem;
  margin: 0.78rem 0 0;
  padding: 0;
  list-style: none;
}

.live-play-latency-debug-panel__row {
  padding: 0.68rem;
  border: 1px solid color-mix(in srgb, var(--accent) 24%, rgba(255, 255, 255, 0.14));
  border-radius: 0.82rem;
  background: rgba(255, 255, 255, 0.055);
}

.live-play-latency-debug-panel__command {
  font-size: 0.82rem;
  font-weight: 950;
  line-height: 1.18;
}

.live-play-latency-debug-panel__resource {
  margin-top: 0.18rem;
  color: color-mix(in srgb, var(--ink-bright) 70%, transparent);
  font-size: 0.7rem;
  font-weight: 720;
  line-height: 1.3;
}

.live-play-latency-debug-panel__identity code {
  color: color-mix(in srgb, var(--ink-bright) 72%, transparent);
  font-size: 0.68rem;
}

.live-play-latency-debug-panel__timings {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.38rem;
  margin-top: 0.58rem;
}

.live-play-latency-debug-panel__timings div {
  min-width: 0;
  padding: 0.38rem;
  border-radius: 0.62rem;
  background: rgba(0, 0, 0, 0.2);
}

.live-play-latency-debug-panel__timings dt {
  color: color-mix(in srgb, var(--ink-bright) 58%, transparent);
  font-size: 0.58rem;
  font-weight: 950;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.live-play-latency-debug-panel__timings dd {
  margin-top: 0.12rem;
  font-size: 0.72rem;
  font-weight: 950;
  white-space: nowrap;
}

@media (max-width: 840px) {
  .live-play-latency-debug-panel {
    right: var(--map-overlay-gutter, 0.75rem);
    left: var(--map-overlay-gutter, 0.75rem);
    width: auto;
  }

  .live-play-latency-debug-panel__timings,
  .live-play-latency-debug-panel__presence-metrics,
  .live-play-latency-debug-panel__motion-metrics,
  .live-play-latency-debug-panel__motion-reasons {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
