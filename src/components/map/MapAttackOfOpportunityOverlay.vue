<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { PendingMoveResolutionPublicSummary } from '#shared/moveAutomation/pendingResolution'
import type { PendingMoveResponseWindowView } from '#shared/moveAutomation/responseViews'
import {
  pendingMoveResponseWindowKey,
  type PendingMoveResponseOptionReference,
  type PendingMoveResponseReference,
  type PendingMoveResponseWindowState,
} from '~/composables/map-editor/usePendingMoveResponses'
import { pendingMoveResponseOptionLabel } from '~/utils/pendingMoveResponsePresentation'

const props = defineProps<{
  summaries: readonly PendingMoveResolutionPublicSummary[]
  windows: readonly PendingMoveResponseWindowView[]
  stateByWindow?: Readonly<Record<string, PendingMoveResponseWindowState>>
  actorLabels?: Readonly<Record<string, string>>
  eligibleOwnerLabel: string
  loading?: boolean
  error?: string | null
  canManage?: boolean
}>()

const surface = ref<HTMLElement | null>(null)

const emit = defineEmits<{
  choose: [input: PendingMoveResponseOptionReference]
  pass: [input: PendingMoveResponseReference]
  forcePass: [input: PendingMoveResponseReference]
  cancel: [resolutionId: string]
  retry: [opId: string]
  refresh: []
  focusActor: [placementId: string]
}>()

const referenceFor = (view: PendingMoveResponseWindowView): PendingMoveResponseReference => ({
  resolutionId: view.resolution.resolutionId,
  windowId: view.window.windowId,
})

const stateFor = (view: PendingMoveResponseWindowView): PendingMoveResponseWindowState => (
  props.stateByWindow?.[pendingMoveResponseWindowKey(referenceFor(view))] ?? { status: 'pending' }
)

const actorLabel = (placementId: string): string => (
  props.actorLabels?.[placementId] ?? 'The provoking token'
)
const firstActorPlacementId = (): string => props.summaries[0]?.actorPlacementId ?? ''
const resolutionIsResuming = (): boolean => props.summaries.some(summary => (
  summary.status === 'resuming' || summary.outstandingWindowCount === 0
))
const isMovementOpportunity = (view: PendingMoveResponseWindowView): boolean => (
  view.resolution.phase === 'movement'
)
const firstOpportunityIsMovement = (): boolean => props.summaries[0]?.phase === 'movement'
const waitingMessage = (): string => {
  if (props.loading) return 'Loading the eligible defender’s response…'
  if (!resolutionIsResuming()) return 'Waiting for an eligible defender to attack or pass.'
  return firstOpportunityIsMovement()
    ? 'Resolving the reaction and validating the remaining route…'
    : 'Resolving the reaction…'
}

const isBusy = (view: PendingMoveResponseWindowView): boolean => stateFor(view).status !== 'pending'

const choose = (view: PendingMoveResponseWindowView, optionId: string): void => {
  if (isBusy(view)) return
  emit('choose', { ...referenceFor(view), optionId })
}

const pass = (view: PendingMoveResponseWindowView): void => {
  if (isBusy(view) || !view.window.allowPass) return
  emit('pass', referenceFor(view))
}

const forcePass = (view: PendingMoveResponseWindowView): void => {
  if (isBusy(view) || !props.canManage) return
  emit('forcePass', referenceFor(view))
}

const cancel = (view: PendingMoveResponseWindowView): void => {
  if (isBusy(view) || !props.canManage) return
  emit('cancel', view.resolution.resolutionId)
}

const retry = (view: PendingMoveResponseWindowView): void => {
  const state = stateFor(view)
  if (state.status !== 'uncertain' || !state.opId) return
  emit('retry', state.opId)
}

watch(
  () => props.windows.map(view => (
    `${pendingMoveResponseWindowKey(referenceFor(view))}:${stateFor(view).status}:${stateFor(view).opId ?? ''}`
  )).join('|'),
  async (key, previousKey) => {
    if (!key || key === previousKey) return
    await nextTick()
    const action = surface.value?.querySelector<HTMLButtonElement>(
      '.aoo-card__attack:not(:disabled), .aoo-card__pass:not(:disabled), .aoo-card__uncertain button:not(:disabled)',
    )
    action?.focus({ preventScroll: true })
  },
  { immediate: true },
)
</script>

<template>
  <section
    v-if="props.summaries.length > 0"
    class="aoo-overlay"
    aria-label="Attack of Opportunity response"
    aria-live="assertive"
  >
    <div ref="surface" class="aoo-overlay__surface">
      <header class="aoo-overlay__header">
        <span class="aoo-overlay__signal" aria-hidden="true">!</span>
        <div>
          <p>{{ props.windows.length > 0 ? 'Reaction required' : 'Reaction pending' }}</p>
          <h2>Attack of Opportunity</h2>
        </div>
        <span v-if="props.summaries.length > 1" class="aoo-overlay__count">
          {{ props.summaries.length }} pending
        </span>
      </header>

      <p v-if="props.error" class="aoo-overlay__error" role="alert">
        {{ props.error }}
        <button type="button" :disabled="props.loading" @click="emit('refresh')">
          {{ props.loading ? 'Refreshing…' : 'Retry' }}
        </button>
      </p>

      <article
        v-for="view in props.windows"
        :key="pendingMoveResponseWindowKey(referenceFor(view))"
        class="aoo-card"
        :class="`aoo-card--${stateFor(view).status}`"
      >
        <div class="aoo-card__context">
          <div>
            <span>{{ isMovementOpportunity(view) ? 'Movement paused' : 'Provoking action' }}</span>
            <strong>{{ actorLabel(view.resolution.actorPlacementId) }}</strong>
          </div>
          <button
            type="button"
            class="aoo-card__focus"
            @click="emit('focusActor', view.resolution.actorPlacementId)"
          >
            Find on map
          </button>
        </div>

        <p class="aoo-card__prompt">
          <template v-if="isMovementOpportunity(view)">
            {{ actorLabel(view.resolution.actorPlacementId) }} is about to leave a threatened space.
            Choose an attack or pass; movement will resume from this checkpoint afterward.
          </template>
          <template v-else>
            {{ actorLabel(view.resolution.actorPlacementId) }} completed an action that provoked this reaction.
            Choose an Attack of Opportunity or pass.
          </template>
        </p>
        <p class="aoo-card__owner">Responder: {{ props.eligibleOwnerLabel }}</p>

        <div class="aoo-card__actions">
          <button
            v-for="option in view.window.options"
            :key="option.id"
            type="button"
            class="aoo-card__attack"
            :data-option-id="option.id"
            :disabled="isBusy(view)"
            @click="choose(view, option.id)"
          >
            {{ pendingMoveResponseOptionLabel(option) }}
          </button>
          <button
            v-if="view.window.allowPass"
            type="button"
            class="aoo-card__pass"
            :disabled="isBusy(view)"
            @click="pass(view)"
          >
            Pass reaction
          </button>
        </div>

        <p v-if="stateFor(view).status === 'sending'" class="aoo-card__status">
          Sending the journaled response…
        </p>
        <div v-else-if="stateFor(view).status === 'uncertain'" class="aoo-card__uncertain">
          <p>{{ stateFor(view).message ?? 'The server outcome is uncertain.' }}</p>
          <button type="button" :disabled="!stateFor(view).opId" @click="retry(view)">
            Retry exact response
          </button>
        </div>

        <div v-if="props.canManage" class="aoo-card__gm-controls">
          <span>GM recovery</span>
          <button type="button" :disabled="isBusy(view)" @click="forcePass(view)">Force pass</button>
          <button type="button" :disabled="isBusy(view)" @click="cancel(view)">Cancel resolution</button>
        </div>
      </article>

      <div v-if="props.windows.length === 0" class="aoo-waiting" role="status">
        <div>
          <span>{{ firstOpportunityIsMovement() ? 'Movement paused' : 'Reaction pending' }}</span>
          <strong>{{ actorLabel(firstActorPlacementId()) }}</strong>
        </div>
        <p>{{ waitingMessage() }}</p>
        <button
          type="button"
          class="aoo-card__focus"
          @click="emit('focusActor', firstActorPlacementId())"
        >
          {{ firstOpportunityIsMovement() ? 'Find checkpoint' : 'Find actor' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.aoo-overlay {
  position: absolute;
  z-index: 16;
  top: var(--map-top-info-top, calc(var(--map-overlay-gutter, 0.75rem) + var(--map-initiative-info-bar-height, 4rem) + 0.7rem));
  left: 50%;
  width: min(38rem, calc(100% - 2rem));
  color: var(--ink);
  transform: translateX(-50%);
  pointer-events: none;
}

.aoo-overlay__surface {
  display: grid;
  gap: 0.65rem;
  max-height: min(68vh, 40rem);
  padding: 0.8rem;
  overflow: auto;
  border: 2px solid color-mix(in srgb, #ef4444 78%, var(--rule-strong));
  border-radius: 18px;
  background: color-mix(in srgb, var(--paper) 96%, transparent);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.48), 0 0 0 5px color-mix(in srgb, #ef4444 15%, transparent);
  backdrop-filter: blur(12px);
  pointer-events: auto;
}

.aoo-overlay__header,
.aoo-card__context,
.aoo-card__actions,
.aoo-card__gm-controls,
.aoo-waiting {
  display: flex;
  align-items: center;
}

.aoo-overlay__header {
  gap: 0.7rem;
}

.aoo-overlay__signal {
  display: grid;
  flex: 0 0 2.35rem;
  width: 2.35rem;
  height: 2.35rem;
  place-items: center;
  border-radius: 999px;
  background: #dc2626;
  box-shadow: 0 0 0 5px color-mix(in srgb, #ef4444 20%, transparent);
  color: white;
  font-size: 1.25rem;
  font-weight: 900;
}

.aoo-overlay__header p,
.aoo-overlay__header h2,
.aoo-card p,
.aoo-waiting p {
  margin: 0;
}

.aoo-overlay__header p,
.aoo-card__context span,
.aoo-waiting span {
  color: #dc2626;
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.aoo-overlay__header h2 {
  font-size: 1.05rem;
}

.aoo-overlay__count {
  margin-left: auto;
  padding: 0.22rem 0.5rem;
  border-radius: 999px;
  background: color-mix(in srgb, #ef4444 14%, var(--paper-soft));
  font-size: 0.72rem;
  font-weight: 800;
}

.aoo-card {
  display: grid;
  gap: 0.65rem;
  padding: 0.72rem;
  border: 1px solid color-mix(in srgb, #ef4444 42%, var(--rule-soft));
  border-radius: 13px;
  background: color-mix(in srgb, var(--paper-soft) 92%, transparent);
}

.aoo-card__context {
  justify-content: space-between;
  gap: 0.75rem;
}

.aoo-card__context > div,
.aoo-waiting > div {
  display: grid;
  gap: 0.1rem;
}

.aoo-card__prompt {
  line-height: 1.45;
}

.aoo-card__owner,
.aoo-card__status {
  color: var(--ink-muted);
  font-size: 0.75rem;
}

.aoo-card__actions {
  flex-wrap: wrap;
  gap: 0.5rem;
}

.aoo-card button,
.aoo-overlay__error button,
.aoo-waiting button {
  min-height: 2.2rem;
  padding: 0.45rem 0.72rem;
  border: 1px solid var(--rule-strong);
  border-radius: 9px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 800;
}

.aoo-card button:hover:not(:disabled),
.aoo-card button:focus-visible,
.aoo-overlay__error button:hover:not(:disabled),
.aoo-waiting button:hover:not(:disabled) {
  border-color: #ef4444;
  box-shadow: 0 0 0 3px color-mix(in srgb, #ef4444 18%, transparent);
}

.aoo-card button:disabled,
.aoo-overlay__error button:disabled {
  cursor: wait;
  opacity: 0.58;
}

.aoo-card__attack {
  border-color: color-mix(in srgb, #ef4444 72%, var(--rule-strong)) !important;
  background: color-mix(in srgb, #ef4444 12%, var(--paper)) !important;
}

.aoo-card__focus {
  min-height: 1.9rem !important;
  padding: 0.3rem 0.55rem !important;
}

.aoo-card__gm-controls {
  flex-wrap: wrap;
  gap: 0.42rem;
  padding-top: 0.55rem;
  border-top: 1px solid var(--rule-soft);
}

.aoo-card__gm-controls span {
  margin-right: auto;
  color: var(--ink-muted);
  font-size: 0.7rem;
  font-weight: 800;
}

.aoo-card__uncertain,
.aoo-overlay__error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.55rem;
  border-radius: 9px;
  background: color-mix(in srgb, #f59e0b 15%, var(--paper));
  color: var(--ink);
  font-size: 0.76rem;
}

.aoo-waiting {
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.72rem;
  border-radius: 12px;
  background: color-mix(in srgb, #ef4444 10%, var(--paper-soft));
}

.aoo-waiting p {
  flex: 1;
  font-size: 0.82rem;
  line-height: 1.4;
}

@media (max-width: 640px) {
  .aoo-overlay {
    top: auto;
    bottom: var(--map-overlay-gutter, 0.75rem);
    width: calc(100% - 1rem);
  }

  .aoo-waiting,
  .aoo-card__context {
    align-items: flex-start;
    flex-direction: column;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .aoo-overlay__signal {
    animation: aoo-signal-pulse 1.6s ease-in-out infinite;
  }

  @keyframes aoo-signal-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }
}
</style>
