<script setup lang="ts">
import { computed } from 'vue'
import { LIVE_PLAY_COMMAND_TYPES, type LivePlayMapCommandType } from '#shared/livePlayCommands'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import type { LivePlayCommandOutboxRecoveryStatus } from '~/composables/map-editor/useLivePlayCommands'
import type { LivePlayCommandStatusInspection } from '~/composables/map-editor/useLivePlayCommandRecoveryGate'
import type { LivePlayCommandOutboxEntry, LivePlayCommandOutboxState } from '~/utils/livePlayCommandOutbox'

const props = defineProps<{
  entries: readonly LivePlayCommandOutboxEntry[]
  recoveryStatus: LivePlayCommandOutboxRecoveryStatus
  recoveryError?: string | null
  blockMessage?: string | null
  interactionMode: MapInteractionMode
  retryingOpId?: string | null
  checkingOpId?: string | null
  confirmingAbandonOpId?: string | null
  abandoningOpId?: string | null
  statusResultByOpId?: Readonly<Record<string, LivePlayCommandStatusInspection>>
  retryDisabledMessage?: string | null
  resolutionNotice?: string | null
}>()

const emit = defineEmits<{
  refresh: []
  retry: [opId: string]
  checkStatus: [opId: string]
  requestAbandonConfirmation: [opId: string]
  cancelAbandonConfirmation: []
  confirmAbandon: [opId: string]
  clearResolutionNotice: []
}>()

const COMMAND_LABELS: Record<LivePlayMapCommandType, string> = {
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
  [LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS]: 'Clear hazards',
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
  if (props.checkingOpId || props.recoveryStatus === 'checking') return 'Checking the server for a terminal command result without resending the command.'
  if (props.abandoningOpId || props.recoveryStatus === 'abandoning') return 'Abandoning the pending live-play operation safely on the server.'
  if (props.recoveryStatus === 'synchronizing') return 'Synchronizing accepted command with the authoritative live table snapshot.'
  if (props.recoveryStatus === 'loading') return 'Checking for interrupted live-play commands before actions resume.'
  if (props.recoveryError) return props.recoveryError
  if (props.blockMessage) return props.blockMessage
  if (props.entries.length === 1) return 'One pending live-play command must be resolved before new live actions resume.'
  if (props.entries.length > 1) return `${props.entries.length} pending live-play commands must be resolved before new live actions resume.`
  return 'Durable live-play command recovery is up to date.'
})

const refreshBusy = computed(() => (
  props.recoveryStatus === 'loading'
  || props.recoveryStatus === 'retrying'
  || props.recoveryStatus === 'checking'
  || props.recoveryStatus === 'abandoning'
  || props.recoveryStatus === 'synchronizing'
  || Boolean(props.checkingOpId)
  || Boolean(props.abandoningOpId)
))

const refreshButtonLabel = computed(() => {
  if (props.abandoningOpId || props.recoveryStatus === 'abandoning') return 'Abandoning…'
  if (props.checkingOpId || props.recoveryStatus === 'checking') return 'Checking…'
  return refreshBusy.value ? 'Refreshing…' : 'Refresh'
})

const commandLabel = (entry: LivePlayCommandOutboxEntry): string => (
  COMMAND_LABELS[entry.commandType as LivePlayMapCommandType]
)

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
  if (props.checkingOpId) return 'Wait for the server status check to finish before retrying.'
  if (props.abandoningOpId) return 'Wait for the active abandonment to finish before retrying.'
  if (props.retryDisabledMessage) return props.retryDisabledMessage
  if (props.recoveryStatus === 'synchronizing') return 'Wait for accepted-command synchronization to finish before retrying.'
  if (props.recoveryStatus === 'loading') return 'Wait for recovery inspection to finish before retrying.'
  if (props.recoveryStatus === 'checking') return 'Wait for the server status check to finish before retrying.'
  if (props.recoveryStatus === 'abandoning') return 'Wait for the active abandonment to finish before retrying.'
  return null
}

const checkStatusDisabledReason = (entry: LivePlayCommandOutboxEntry): string | null => {
  if (props.retryingOpId) return 'Wait for the active retry to finish before checking the server.'
  if (props.abandoningOpId) return 'Wait for the active abandonment to finish before checking the server.'
  if (props.checkingOpId === entry.opId) return 'This operation is already being checked with the server.'
  if (props.checkingOpId) return 'Wait for the active server status check to finish before checking another operation.'
  if (props.recoveryStatus === 'loading') return 'Wait for recovery inspection to finish before checking the server.'
  if (props.recoveryStatus === 'synchronizing') return 'Wait for accepted-command synchronization to finish before checking the server.'
  if (props.recoveryStatus === 'checking') return 'Wait for the active server status check to finish before checking another operation.'
  if (props.recoveryStatus === 'abandoning') return 'Wait for the active abandonment to finish before checking the server.'
  return null
}

const abandonableState = (state: LivePlayCommandOutboxState): boolean => (
  state === 'queued' || state === 'sending' || state === 'uncertain'
)

const abandonDisabledReason = (entry: LivePlayCommandOutboxEntry): string | null => {
  if (!abandonableState(entry.state)) return 'This live-play command state cannot be abandoned.'
  if (props.retryingOpId) return 'Wait for the active retry to finish before abandoning an operation.'
  if (props.checkingOpId) return 'Wait for the active server status check to finish before abandoning an operation.'
  if (props.abandoningOpId === entry.opId) return 'This operation is already being abandoned on the server.'
  if (props.abandoningOpId) return 'Wait for the active abandonment to finish before abandoning another operation.'
  if (props.recoveryStatus === 'loading') return 'Wait for recovery inspection to finish before abandoning an operation.'
  if (props.recoveryStatus === 'synchronizing') return 'Wait for accepted-command synchronization to finish before abandoning an operation.'
  if (props.recoveryStatus === 'checking') return 'Wait for the active server status check to finish before abandoning an operation.'
  if (props.recoveryStatus === 'abandoning') return 'Wait for the active abandonment to finish before abandoning another operation.'
  return null
}

const retryButtonLabel = (entry: LivePlayCommandOutboxEntry): string => (
  props.retryingOpId === entry.opId ? 'Retrying…' : 'Retry'
)

const retryAriaLabel = (entry: LivePlayCommandOutboxEntry): string => (
  `Retry ${commandLabel(entry)} operation ${shortOpId(entry.opId)} with its original operation ID`
)

const checkStatusButtonLabel = (entry: LivePlayCommandOutboxEntry): string => (
  props.checkingOpId === entry.opId ? 'Checking…' : 'Check server'
)

const checkStatusAriaLabel = (entry: LivePlayCommandOutboxEntry): string => (
  `Check whether operation ${shortOpId(entry.opId)} has a terminal server result`
)

const abandonButtonLabel = (entry: LivePlayCommandOutboxEntry): string => (
  props.abandoningOpId === entry.opId ? 'Abandoning…' : 'Abandon…'
)

const abandonAriaLabel = (entry: LivePlayCommandOutboxEntry): string => (
  `Abandon operation ${shortOpId(entry.opId)} safely on the server`
)

const abandonTitleId = (entry: LivePlayCommandOutboxEntry): string => `live-play-abandon-title-${entry.opId}`

const abandonDescriptionId = (entry: LivePlayCommandOutboxEntry): string => `live-play-abandon-description-${entry.opId}`

const statusInspection = (entry: LivePlayCommandOutboxEntry): LivePlayCommandStatusInspection | null => (
  props.statusResultByOpId?.[entry.opId] ?? null
)

const onRetry = (entry: LivePlayCommandOutboxEntry): void => {
  if (retryDisabledReason(entry)) return
  emit('retry', entry.opId)
}

const onCheckStatus = (entry: LivePlayCommandOutboxEntry): void => {
  if (checkStatusDisabledReason(entry)) return
  emit('checkStatus', entry.opId)
}

const onRequestAbandonConfirmation = (entry: LivePlayCommandOutboxEntry): void => {
  if (abandonDisabledReason(entry)) return
  emit('requestAbandonConfirmation', entry.opId)
}

const onConfirmAbandon = (entry: LivePlayCommandOutboxEntry): void => {
  if (props.abandoningOpId === entry.opId) return
  if (abandonDisabledReason(entry)) return
  emit('confirmAbandon', entry.opId)
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
        {{ refreshButtonLabel }}
      </button>
    </header>

    <p class="live-play-command-recovery-panel__summary" aria-live="polite">
      {{ summaryMessage }}
    </p>

    <div
      v-if="resolutionNotice"
      class="live-play-command-recovery-panel__notice"
      role="status"
      aria-live="polite"
    >
      <p>{{ resolutionNotice }}</p>
      <button
        class="live-play-command-recovery-panel__button live-play-command-recovery-panel__button--secondary"
        type="button"
        aria-label="Dismiss live-play command recovery resolution notice"
        @click="emit('clearResolutionNotice')"
      >
        Dismiss
      </button>
    </div>

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
          <div class="live-play-command-recovery-panel__actions">
            <button
              class="live-play-command-recovery-panel__button live-play-command-recovery-panel__button--secondary"
              type="button"
              :disabled="checkStatusDisabledReason(entry) !== null"
              :aria-label="checkStatusAriaLabel(entry)"
              @click="onCheckStatus(entry)"
            >
              {{ checkStatusButtonLabel(entry) }}
            </button>
            <button
              class="live-play-command-recovery-panel__button"
              type="button"
              :disabled="retryDisabledReason(entry) !== null"
              :aria-label="retryAriaLabel(entry)"
              @click="onRetry(entry)"
            >
              {{ retryButtonLabel(entry) }}
            </button>
            <button
              class="live-play-command-recovery-panel__button live-play-command-recovery-panel__button--secondary live-play-command-recovery-panel__button--destructive"
              type="button"
              :disabled="abandonDisabledReason(entry) !== null"
              :aria-label="abandonAriaLabel(entry)"
              @click="onRequestAbandonConfirmation(entry)"
            >
              {{ abandonButtonLabel(entry) }}
            </button>
          </div>
        </div>

        <div
          v-if="confirmingAbandonOpId === entry.opId"
          class="live-play-command-recovery-panel__abandon-confirmation"
          role="alertdialog"
          :aria-labelledby="abandonTitleId(entry)"
          :aria-describedby="abandonDescriptionId(entry)"
        >
          <h4 :id="abandonTitleId(entry)">Abandon operation {{ shortOpId(entry.opId) }}?</h4>
          <p :id="abandonDescriptionId(entry)">
            Abandoning does not undo an operation that already committed. The server will serialize this request against the original command: if the command already finished, its existing terminal result wins; otherwise the server records an abandoned result and prevents future execution under this operation ID.
          </p>
          <div class="live-play-command-recovery-panel__confirmation-actions">
            <button
              class="live-play-command-recovery-panel__button live-play-command-recovery-panel__button--secondary"
              type="button"
              aria-label="Cancel abandoning this live-play operation"
              :disabled="Boolean(abandoningOpId)"
              @click="emit('cancelAbandonConfirmation')"
            >
              Cancel
            </button>
            <button
              class="live-play-command-recovery-panel__button live-play-command-recovery-panel__button--destructive"
              type="button"
              :disabled="abandonDisabledReason(entry) !== null"
              :aria-label="abandonAriaLabel(entry)"
              @click="onConfirmAbandon(entry)"
            >
              {{ abandoningOpId === entry.opId ? 'Abandoning…' : 'Abandon operation' }}
            </button>
          </div>
        </div>

        <dl class="live-play-command-recovery-panel__meta">
          <div>
            <dt>Attempts</dt>
            <dd>{{ entry.attemptCount }}</dd>
          </div>
          <div v-if="entry.lastError">
            <dt>Last send error</dt>
            <dd>{{ entry.lastError }}</dd>
          </div>
          <div v-if="statusInspection(entry)">
            <dt>Server status check</dt>
            <dd>{{ statusInspection(entry)?.message }}</dd>
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
.live-play-command-recovery-panel__entry-main,
.live-play-command-recovery-panel__actions,
.live-play-command-recovery-panel__notice,
.live-play-command-recovery-panel__confirmation-actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.live-play-command-recovery-panel__actions,
.live-play-command-recovery-panel__confirmation-actions {
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.live-play-command-recovery-panel__notice {
  align-items: center;
  margin-top: 0.65rem;
  padding: 0.55rem;
  border: 1px solid var(--map-glass-border-soft, var(--rule-soft));
  border-radius: 12px;
  background: var(--map-glass-surface, var(--paper));
}

.live-play-command-recovery-panel__eyebrow,
.live-play-command-recovery-panel__summary,
.live-play-command-recovery-panel__safety,
.live-play-command-recovery-panel__guidance,
.live-play-command-recovery-panel__notice p,
.live-play-command-recovery-panel__abandon-confirmation p,
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
.live-play-command-recovery-panel h3,
.live-play-command-recovery-panel h4 {
  margin: 0;
  line-height: 1.15;
}

.live-play-command-recovery-panel h2 {
  font-size: 1rem;
}

.live-play-command-recovery-panel h3 {
  font-size: 0.95rem;
}

.live-play-command-recovery-panel h4 {
  font-size: 0.88rem;
}

.live-play-command-recovery-panel__summary {
  margin-top: 0.65rem;
  font-weight: 700;
}

.live-play-command-recovery-panel__safety,
.live-play-command-recovery-panel__guidance,
.live-play-command-recovery-panel__notice,
.live-play-command-recovery-panel__abandon-confirmation,
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

.live-play-command-recovery-panel__button--destructive {
  border-color: color-mix(in srgb, var(--bad, #ff5c67) 72%, var(--rule-strong, #ffffff));
  color: var(--bad, #ff5c67);
}

.live-play-command-recovery-panel__button--destructive:not(:disabled) {
  background: color-mix(in srgb, var(--bad, #ff5c67) 12%, var(--map-glass-surface-active, var(--paper-active)));
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

.live-play-command-recovery-panel__abandon-confirmation {
  display: grid;
  gap: 0.55rem;
  margin-top: 0.6rem;
  padding: 0.65rem;
  border: 1px solid color-mix(in srgb, var(--bad, #ff5c67) 52%, var(--map-glass-border-soft, var(--rule-soft)));
  border-radius: 12px;
  background: color-mix(in srgb, var(--bad, #ff5c67) 9%, var(--map-glass-surface-inset, var(--paper-inset)));
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
  .live-play-command-recovery-panel__entry-main,
  .live-play-command-recovery-panel__actions,
  .live-play-command-recovery-panel__notice,
  .live-play-command-recovery-panel__confirmation-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
