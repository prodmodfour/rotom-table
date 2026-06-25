<script setup lang="ts">
import { computed } from 'vue'
import { LIVE_PLAY_COMMAND_TYPES, type LivePlayCommandType } from '#shared/livePlayCommands'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import type { LivePlayCommandOutboxRecoveryStatus } from '~/composables/map-editor/useLivePlayCommands'
import type { LivePlayCommandOutboxEntry, LivePlayCommandOutboxState } from '~/utils/livePlayCommandOutbox'

const props = defineProps<{
  entries: readonly LivePlayCommandOutboxEntry[]
  recoveryStatus: LivePlayCommandOutboxRecoveryStatus
  recoveryError?: string | null
  blockMessage?: string | null
  interactionMode: MapInteractionMode
  retryingOpId?: string | null
  retryDisabledMessage?: string | null
}>()

const emit = defineEmits<{
  refresh: []
  retry: [opId: string]
}>()

const COMMAND_LABELS: Record<LivePlayCommandType, string> = {
  [LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN]: 'Move token',
  [LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN]: 'Turn token',
  [LIVE_PLAY_COMMAND_TYPES.MODIFY_HP]: 'Modify HP',
  [LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES]: 'Modify combat stages',
  [LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS]: 'Modify conditions',
  [LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE]: 'Grant experience',
  [LIVE_PLAY_COMMAND_TYPES.USE_MOVE]: 'Use move',
  [LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE]: 'Resolve move',
  [LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER]: 'Use maneuver',
  [LIVE_PLAY_COMMAND_TYPES.USE_ABILITY]: 'Use ability',
  [LIVE_PLAY_COMMAND_TYPES.USE_ORDER]: 'Use order',
  [LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE]: 'Set initiative',
  [LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE]: 'Next initiative',
  [LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE]: 'Previous initiative',
  [LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD]: 'Place hazard',
  [LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD]: 'Remove hazard',
  [LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT]: 'Set field effect',
  [LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT]: 'Remove field effect',
  [LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS]: 'Tick field effect durations',
  [LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL]: 'Build terrain voxel',
  [LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL]: 'Remove terrain voxel',
  [LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN]: 'Spawn token',
  [LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON]: 'Send out Pokémon',
  [LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN]: 'Delete token',
  [LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL]: 'Throw Poké Ball',
  [LIVE_PLAY_COMMAND_TYPES.SET_SCENE]: 'Set scene',
  [LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY]: 'Update attack of opportunity',
  [LIVE_PLAY_COMMAND_TYPES.UPDATE_START_TURN_MODAL]: 'Update start-turn prompt',
}

const STATE_LABELS: Record<LivePlayCommandOutboxState, string> = {
  queued: 'Queued',
  sending: 'Sending',
  uncertain: 'Uncertain',
}

const summaryMessage = computed(() => {
  if (props.retryingOpId) return 'Retrying the pending live-play command with its original operation ID.'
  if (props.recoveryStatus === 'loading') return 'Checking for interrupted live-play commands before actions resume.'
  if (props.recoveryError) return props.recoveryError
  if (props.blockMessage) return props.blockMessage
  if (props.entries.length === 1) return 'One pending live-play command must be resolved before new live actions resume.'
  if (props.entries.length > 1) return `${props.entries.length} pending live-play commands must be resolved before new live actions resume.`
  return 'Durable live-play command recovery is up to date.'
})

const refreshBusy = computed(() => props.recoveryStatus === 'loading' || props.recoveryStatus === 'retrying')

const commandLabel = (entry: LivePlayCommandOutboxEntry): string => COMMAND_LABELS[entry.commandType]

const shortOpId = (opId: string): string => (
  opId.length <= 16 ? opId : `${opId.slice(0, 10)}…${opId.slice(-6)}`
)

const retryableState = (state: LivePlayCommandOutboxState): boolean => state === 'queued' || state === 'uncertain'

const retryDisabledReason = (entry: LivePlayCommandOutboxEntry): string | null => {
  if (entry.state === 'sending') {
    return 'Another tab or page instance may own this send lease. It will become retryable after lease recovery if the original send did not finish.'
  }
  if (!retryableState(entry.state)) return 'This live-play command state is not retryable.'
  if (props.interactionMode === MAP_INTERACTION_MODES.SETUP_EDIT) {
    return 'Switch to Run Live Play to retry pending live-play commands.'
  }
  if (props.retryingOpId) return 'Another live-play command retry is already active.'
  if (props.retryDisabledMessage) return props.retryDisabledMessage
  if (props.recoveryStatus === 'loading') return 'Wait for recovery inspection to finish before retrying.'
  return null
}

const retryButtonLabel = (entry: LivePlayCommandOutboxEntry): string => (
  props.retryingOpId === entry.opId ? 'Retrying…' : 'Retry'
)

const retryAriaLabel = (entry: LivePlayCommandOutboxEntry): string => (
  `Retry ${commandLabel(entry)} operation ${shortOpId(entry.opId)} with its original operation ID`
)

const onRetry = (entry: LivePlayCommandOutboxEntry): void => {
  if (retryDisabledReason(entry)) return
  emit('retry', entry.opId)
}
</script>

<template>
  <section
    class="live-play-command-recovery-panel panel-card"
    aria-labelledby="live-play-command-recovery-title"
  >
    <header class="live-play-command-recovery-panel__header">
      <div>
        <p class="live-play-command-recovery-panel__eyebrow">Live-play safety</p>
        <h2 id="live-play-command-recovery-title">Command recovery</h2>
      </div>
      <button
        class="live-play-command-recovery-panel__button live-play-command-recovery-panel__button--secondary"
        type="button"
        :disabled="refreshBusy"
        aria-label="Refresh live-play command recovery without sending commands"
        @click="emit('refresh')"
      >
        {{ refreshBusy ? 'Refreshing…' : 'Refresh' }}
      </button>
    </header>

    <p class="live-play-command-recovery-panel__summary" aria-live="polite">
      {{ summaryMessage }}
    </p>

    <p class="live-play-command-recovery-panel__safety">
      Retry reuses the original operation ID. It does not repeat a committed effect because the server is idempotent.
    </p>

    <ul v-if="entries.length" class="live-play-command-recovery-panel__entries" aria-label="Pending live-play commands">
      <li
        v-for="entry in entries"
        :key="entry.opId"
        class="live-play-command-recovery-panel__entry"
      >
        <div class="live-play-command-recovery-panel__entry-main">
          <div>
            <h3>{{ commandLabel(entry) }}</h3>
            <p>
              <span
                class="live-play-command-recovery-panel__state"
                :class="`live-play-command-recovery-panel__state--${entry.state}`"
              >
                {{ STATE_LABELS[entry.state] }}
              </span>
              <span>Operation <code>{{ shortOpId(entry.opId) }}</code></span>
            </p>
          </div>
          <button
            class="live-play-command-recovery-panel__button"
            type="button"
            :disabled="retryDisabledReason(entry) !== null"
            :aria-label="retryAriaLabel(entry)"
            @click="onRetry(entry)"
          >
            {{ retryButtonLabel(entry) }}
          </button>
        </div>

        <dl class="live-play-command-recovery-panel__meta">
          <div>
            <dt>Attempts</dt>
            <dd>{{ entry.attemptCount }}</dd>
          </div>
          <div v-if="entry.lastError">
            <dt>Last error</dt>
            <dd>{{ entry.lastError }}</dd>
          </div>
        </dl>

        <p
          v-if="retryDisabledReason(entry)"
          class="live-play-command-recovery-panel__guidance"
        >
          {{ retryDisabledReason(entry) }}
        </p>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.live-play-command-recovery-panel {
  position: absolute;
  z-index: 5;
  right: var(--map-overlay-gutter, 0.75rem);
  bottom: var(--map-overlay-gutter, 0.75rem);
  width: min(29rem, calc(100vw - var(--map-nav-rail-width, 0px) - 3rem));
  max-height: min(72vh, 42rem);
  overflow: auto;
  padding: 0.85rem;
  border: 1px solid var(--map-glass-border, var(--rule));
  border-radius: 18px;
  background: var(--map-glass-surface-strong, var(--paper-soft));
  box-shadow: var(--shadow-card, 0 18px 52px rgba(0, 0, 0, 0.34));
  color: var(--text);
  pointer-events: auto;
}

.live-play-command-recovery-panel__header,
.live-play-command-recovery-panel__entry-main {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.live-play-command-recovery-panel__eyebrow,
.live-play-command-recovery-panel__summary,
.live-play-command-recovery-panel__safety,
.live-play-command-recovery-panel__guidance,
.live-play-command-recovery-panel__entry p {
  margin: 0;
}

.live-play-command-recovery-panel__eyebrow {
  color: var(--muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.live-play-command-recovery-panel h2,
.live-play-command-recovery-panel h3 {
  margin: 0;
  line-height: 1.15;
}

.live-play-command-recovery-panel h2 {
  font-size: 1rem;
}

.live-play-command-recovery-panel h3 {
  font-size: 0.95rem;
}

.live-play-command-recovery-panel__summary {
  margin-top: 0.65rem;
  font-weight: 700;
}

.live-play-command-recovery-panel__safety,
.live-play-command-recovery-panel__guidance,
.live-play-command-recovery-panel__entry p,
.live-play-command-recovery-panel__meta {
  color: var(--muted);
  font-size: 0.82rem;
}

.live-play-command-recovery-panel__safety {
  margin-top: 0.45rem;
}

.live-play-command-recovery-panel__entries {
  display: grid;
  gap: 0.6rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}

.live-play-command-recovery-panel__entry {
  padding: 0.7rem;
  border: 1px solid var(--map-glass-border-soft, var(--rule-soft));
  border-radius: 14px;
  background: var(--map-glass-surface-inset, var(--paper-inset));
}

.live-play-command-recovery-panel__button {
  min-height: 2rem;
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--map-glass-accent-border, var(--rule-active));
  border-radius: 999px;
  background: var(--map-glass-surface-active, var(--paper-active));
  color: var(--text);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 800;
  cursor: pointer;
}

.live-play-command-recovery-panel__button--secondary {
  border-color: var(--map-glass-border-soft, var(--rule-soft));
  background: var(--map-glass-surface, var(--paper));
}

.live-play-command-recovery-panel__button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.live-play-command-recovery-panel__state {
  display: inline-flex;
  align-items: center;
  margin-right: 0.45rem;
  padding: 0.08rem 0.42rem;
  border-radius: 999px;
  font-weight: 800;
}

.live-play-command-recovery-panel__state--queued {
  background: rgba(80, 160, 255, 0.16);
  color: #9dccff;
}

.live-play-command-recovery-panel__state--sending {
  background: rgba(255, 193, 7, 0.18);
  color: #ffd36a;
}

.live-play-command-recovery-panel__state--uncertain {
  background: rgba(255, 105, 135, 0.18);
  color: #ffb0bf;
}

.live-play-command-recovery-panel__meta {
  display: grid;
  gap: 0.35rem;
  margin: 0.55rem 0 0;
}

.live-play-command-recovery-panel__meta div {
  display: grid;
  grid-template-columns: 5.5rem minmax(0, 1fr);
  gap: 0.45rem;
}

.live-play-command-recovery-panel__meta dt {
  font-weight: 800;
}

.live-play-command-recovery-panel__meta dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.live-play-command-recovery-panel__guidance {
  margin-top: 0.5rem;
}

.live-play-command-recovery-panel code {
  font-family: var(--font-mono, monospace);
  font-size: 0.78rem;
}

@media (max-width: 760px) {
  .live-play-command-recovery-panel {
    right: var(--map-overlay-gutter, 0.75rem);
    left: var(--map-overlay-gutter, 0.75rem);
    width: auto;
  }

  .live-play-command-recovery-panel__header,
  .live-play-command-recovery-panel__entry-main {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
