<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  LivePlayPresenceEntry,
  LivePlayPresenceIntentKind,
  LivePlayPresenceRole,
} from '#shared/livePlayPresence'
import { livePlayPresenceAccentColor } from '~/utils/livePlayPresenceVisuals'

type MapPresencePanelStatus = 'idle' | 'loading' | 'ready' | 'error'
type PresenceFreshness = 'fresh' | 'stale'

interface PresencePanelRow {
  readonly key: string
  readonly entry: LivePlayPresenceEntry
  readonly label: string
  readonly hint: string
  readonly intentLabel: string
  readonly freshness: PresenceFreshness
  readonly freshnessLabel: string
  readonly accentStyle: Record<string, string>
}

const props = withDefaults(defineProps<{
  entries: readonly LivePlayPresenceEntry[]
  status?: MapPresencePanelStatus
  serverTimeOffsetMs?: number
  nowMs?: number
  staleAfterMs?: number
  staleBeforeExpiryMs?: number
}>(), {
  status: 'idle',
  serverTimeOffsetMs: 0,
  staleAfterMs: 10_000,
  staleBeforeExpiryMs: 5_000,
})

const PRESENCE_REFRESH_INTERVAL_MS = 2_000
const localNowMs = ref(Date.now())
let refreshTimer: ReturnType<typeof setInterval> | null = null

const roleLabel = (role: LivePlayPresenceRole): string => (role === 'gm' ? 'GM' : 'Player')

const intentLabels: Readonly<Record<LivePlayPresenceIntentKind, string>> = {
  idle: 'At table',
  'moving-token': 'Moving token',
  targeting: 'Targeting',
  measuring: 'Measuring',
  'placing-ping': 'Placing ping',
  'viewing-sheet': 'Viewing sheet',
}

const currentServerNowMs = computed(() => (
  props.nowMs ?? (localNowMs.value + props.serverTimeOffsetMs)
))

const participantLabel = (entry: LivePlayPresenceEntry): string => (
  entry.participant.profileDisplayName ?? roleLabel(entry.participant.role)
)

const participantHint = (entry: LivePlayPresenceEntry): string => (
  `${roleLabel(entry.participant.role)} · tab ${entry.participant.clientIdSuffix}`
)

const relativeSeenLabel = (entry: LivePlayPresenceEntry, serverNow: number): string => {
  const ageMs = Math.max(0, serverNow - entry.lastSeenAt)
  if (ageMs < 2_000) return 'Fresh · now'
  if (ageMs < 60_000) return `Fresh · ${Math.floor(ageMs / 1_000)}s ago`
  return `Fresh · ${Math.floor(ageMs / 60_000)}m ago`
}

const freshnessForEntry = (entry: LivePlayPresenceEntry, serverNow: number): PresenceFreshness => {
  const ageMs = Math.max(0, serverNow - entry.lastSeenAt)
  const expiresInMs = entry.expiresAt - serverNow
  return ageMs > props.staleAfterMs || expiresInMs <= props.staleBeforeExpiryMs ? 'stale' : 'fresh'
}

const freshnessLabel = (entry: LivePlayPresenceEntry, serverNow: number, freshness: PresenceFreshness): string => {
  const label = relativeSeenLabel(entry, serverNow)
  return freshness === 'stale' ? label.replace('Fresh', 'Stale') : label
}

const presenceAccentStyle = (accent: LivePlayPresenceEntry['participant']['accent']): Record<string, string> => ({
  '--presence-accent': livePlayPresenceAccentColor(accent),
})

const rowKey = (entry: LivePlayPresenceEntry): string => [
  entry.participant.role,
  entry.participant.profileDisplayName ?? 'anonymous',
  entry.participant.clientIdSuffix,
  entry.clientSequence,
].join(':')

const rows = computed<readonly PresencePanelRow[]>(() => {
  const serverNow = currentServerNowMs.value
  return props.entries
    .filter((entry) => entry.expiresAt > serverNow)
    .map((entry) => {
      const freshness = freshnessForEntry(entry, serverNow)
      return {
        key: rowKey(entry),
        entry,
        label: participantLabel(entry),
        hint: participantHint(entry),
        intentLabel: intentLabels[entry.intent.kind],
        freshness,
        freshnessLabel: freshnessLabel(entry, serverNow, freshness),
        accentStyle: presenceAccentStyle(entry.participant.accent),
      }
    })
})

const participantCountLabel = computed(() => {
  const count = rows.value.length
  return count === 1 ? '1 here' : `${count} here`
})

const statusNotice = computed(() => {
  if (props.status === 'loading') return 'Syncing presence…'
  if (props.status === 'error') return 'Presence updates delayed; gameplay commands continue.'
  return null
})

onMounted(() => {
  if (props.nowMs !== undefined) return
  refreshTimer = setInterval(() => {
    localNowMs.value = Date.now()
  }, PRESENCE_REFRESH_INTERVAL_MS)
})

onBeforeUnmount(() => {
  if (refreshTimer !== null) clearInterval(refreshTimer)
})
</script>

<template>
  <details
    class="map-presence-panel"
    open
    aria-labelledby="map-presence-panel-title"
    @click.stop
    @mousedown.stop
    @pointerdown.stop
    @wheel.stop
  >
    <summary class="map-presence-panel__summary">
      <span class="map-presence-panel__summary-copy">
        <span class="map-presence-panel__eyebrow">Live table</span>
        <strong id="map-presence-panel-title" class="map-presence-panel__title">At table</strong>
      </span>
      <span class="map-presence-panel__count">{{ participantCountLabel }}</span>
    </summary>

    <div class="map-presence-panel__body">
      <p v-if="rows.length === 0" class="map-presence-panel__empty">
        Waiting for table presence.
      </p>

      <ol v-else class="map-presence-panel__list" aria-label="Connected table participants">
        <li
          v-for="row in rows"
          :key="row.key"
          class="map-presence-panel__participant"
          :class="`map-presence-panel__participant--${row.freshness}`"
          :style="row.accentStyle"
          :data-presence-freshness="row.freshness"
        >
          <span class="map-presence-panel__accent" aria-hidden="true" />
          <span class="map-presence-panel__identity">
            <strong class="map-presence-panel__label">{{ row.label }}</strong>
            <span class="map-presence-panel__hint">{{ row.hint }}</span>
          </span>
          <span class="map-presence-panel__intent">{{ row.intentLabel }}</span>
          <span
            class="map-presence-panel__freshness"
            :class="`map-presence-panel__freshness--${row.freshness}`"
          >
            {{ row.freshnessLabel }}
          </span>
        </li>
      </ol>

      <p v-if="statusNotice" class="map-presence-panel__status" role="status">
        {{ statusNotice }}
      </p>
    </div>
  </details>
</template>

<style scoped>
.map-presence-panel {
  position: absolute;
  z-index: 4;
  top: var(--map-overlay-gutter, 0.75rem);
  right: var(--map-overlay-gutter, 0.75rem);
  width: min(21rem, calc(100vw - var(--map-nav-rail-width, 0px) - 2rem));
  max-width: calc(100vw - 1.5rem);
  overflow: hidden;
  border: 1px solid var(--map-glass-border-soft, rgba(255, 255, 255, 0.22));
  border-radius: 1rem;
  background: var(--map-glass-surface-strong, rgba(10, 12, 18, 0.72));
  box-shadow: 0 14px 34px color-mix(in srgb, var(--pokemon-black, #050608) 24%, transparent);
  color: var(--ink-bright, #fff);
  pointer-events: auto;
  backdrop-filter: blur(14px) saturate(135%);
  -webkit-backdrop-filter: blur(14px) saturate(135%);
}

.map-presence-panel__summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.62rem 0.72rem;
  cursor: pointer;
  list-style: none;
}

.map-presence-panel__summary::-webkit-details-marker {
  display: none;
}

.map-presence-panel__summary-copy,
.map-presence-panel__identity {
  display: grid;
  min-width: 0;
}

.map-presence-panel__eyebrow {
  color: color-mix(in srgb, var(--accent, #7dd3fc) 78%, white 12%);
  font-size: 0.62rem;
  font-weight: 950;
  letter-spacing: 0.12em;
  line-height: 1;
  text-transform: uppercase;
}

.map-presence-panel__title {
  margin-top: 0.12rem;
  font-size: 0.88rem;
  font-weight: 950;
  line-height: 1.1;
}

.map-presence-panel__count,
.map-presence-panel__intent,
.map-presence-panel__freshness {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  white-space: nowrap;
}

.map-presence-panel__count {
  flex: 0 0 auto;
  padding: 0.24rem 0.48rem;
  border: 1px solid color-mix(in srgb, var(--accent, #7dd3fc) 42%, var(--rule-soft, rgba(255, 255, 255, 0.22)));
  background: color-mix(in srgb, var(--accent, #7dd3fc) 14%, transparent);
  color: color-mix(in srgb, var(--ink-bright, #fff) 82%, transparent);
  font-size: 0.66rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.map-presence-panel__body {
  display: grid;
  gap: 0.52rem;
  padding: 0 0.62rem 0.62rem;
}

.map-presence-panel__empty,
.map-presence-panel__status {
  margin: 0;
  color: color-mix(in srgb, var(--ink-bright, #fff) 68%, transparent);
  font-size: 0.74rem;
  font-weight: 780;
  line-height: 1.3;
}

.map-presence-panel__list {
  display: grid;
  gap: 0.42rem;
  max-height: 13.5rem;
  margin: 0;
  overflow: auto;
  padding: 0;
  list-style: none;
  scrollbar-width: thin;
}

.map-presence-panel__participant {
  display: grid;
  grid-template-columns: 0.58rem minmax(0, 1fr) auto;
  grid-template-areas:
    'accent identity intent'
    'accent identity freshness';
  align-items: center;
  gap: 0.18rem 0.46rem;
  min-width: 0;
  padding: 0.48rem 0.52rem;
  border: 1px solid color-mix(in srgb, var(--presence-accent) 38%, var(--map-glass-border, rgba(255, 255, 255, 0.18)));
  border-radius: 0.78rem;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--presence-accent) 15%, transparent), transparent 64%),
    var(--map-glass-surface, rgba(255, 255, 255, 0.08));
  transition: opacity 0.15s ease, filter 0.15s ease;
}

.map-presence-panel__participant--stale {
  opacity: 0.58;
  filter: saturate(0.72);
}

.map-presence-panel__accent {
  grid-area: accent;
  width: 0.56rem;
  height: 100%;
  min-height: 1.9rem;
  border-radius: 999px;
  background: var(--presence-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--presence-accent) 24%, transparent);
}

.map-presence-panel__identity {
  grid-area: identity;
  gap: 0.08rem;
}

.map-presence-panel__label {
  min-width: 0;
  overflow: hidden;
  color: var(--ink-bright, #fff);
  font-size: 0.82rem;
  font-weight: 950;
  line-height: 1.16;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-presence-panel__hint {
  min-width: 0;
  overflow: hidden;
  color: color-mix(in srgb, var(--ink-bright, #fff) 58%, transparent);
  font-size: 0.66rem;
  font-weight: 780;
  letter-spacing: 0.02em;
  line-height: 1.16;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-presence-panel__intent {
  grid-area: intent;
  justify-self: end;
  padding: 0.18rem 0.38rem;
  background: color-mix(in srgb, var(--presence-accent) 18%, transparent);
  color: color-mix(in srgb, var(--ink-bright, #fff) 86%, transparent);
  font-size: 0.62rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  line-height: 1;
  text-transform: uppercase;
}

.map-presence-panel__freshness {
  grid-area: freshness;
  justify-self: end;
  color: color-mix(in srgb, var(--ink-bright, #fff) 58%, transparent);
  font-size: 0.62rem;
  font-weight: 820;
  line-height: 1.1;
}

.map-presence-panel__freshness--fresh::before,
.map-presence-panel__freshness--stale::before {
  display: inline-block;
  width: 0.42rem;
  height: 0.42rem;
  margin-right: 0.28rem;
  border-radius: 999px;
  content: '';
}

.map-presence-panel__freshness--fresh::before {
  background: #22c55e;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.16);
}

.map-presence-panel__freshness--stale::before {
  background: #f59e0b;
  box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.16);
}

.map-presence-panel__status {
  padding: 0.4rem 0.48rem;
  border: 1px solid color-mix(in srgb, var(--accent, #7dd3fc) 24%, var(--rule-soft, rgba(255, 255, 255, 0.16)));
  border-radius: 0.68rem;
  background: color-mix(in srgb, var(--accent, #7dd3fc) 8%, transparent);
}

@media (max-width: 760px) {
  .map-presence-panel {
    right: var(--map-overlay-gutter, 0.75rem);
    left: var(--map-overlay-gutter, 0.75rem);
    width: auto;
  }

  .map-presence-panel__list {
    max-height: 8.5rem;
  }
}

@media (max-width: 520px) {
  .map-presence-panel__eyebrow,
  .map-presence-panel__hint,
  .map-presence-panel__freshness {
    display: none;
  }

  .map-presence-panel__participant {
    grid-template-columns: 0.5rem minmax(0, 1fr) auto;
    grid-template-areas: 'accent identity intent';
  }
}
</style>
