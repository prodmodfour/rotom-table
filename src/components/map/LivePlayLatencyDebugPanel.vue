<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  LIVE_PLAY_COMMAND_TRACE_EVENT_TYPES,
  type LivePlayCommandTraceEventType,
  type LivePlayCommandTraceSnapshot,
} from '~/utils/livePlayCommandTrace'

const props = defineProps<{
  traces: Readonly<Record<string, LivePlayCommandTraceSnapshot>>
  maxRows?: number
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

const durationLabel = (start: number | null, end: number | null): string => {
  if (start === null || end === null || end < start) return '—'
  const milliseconds = end - start
  if (milliseconds < 1_000) return `${milliseconds} ms`
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`
}

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
  }
}

const rows = computed<readonly LivePlayLatencyDebugRow[]>(() => latestTraces.value.map(rowForTrace))
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
.live-play-latency-debug-panel__timings dd {
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

  .live-play-latency-debug-panel__timings {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
