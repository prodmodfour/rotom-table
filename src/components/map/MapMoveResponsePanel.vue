<script setup lang="ts">
import type { PendingMoveResponseWindowView } from '#shared/moveAutomation/responseViews'
import { ATTACK_OF_OPPORTUNITY_ASSISTANCE_NOTICE } from '~/utils/moveAutomationAssistedFollowUps'
import {
  pendingMoveResponseWindowKey,
  type PendingMoveResponseOptionReference,
  type PendingMoveResponseReference,
  type PendingMoveResponseWindowState,
} from '~/composables/map-editor/usePendingMoveResponses'

const props = defineProps<{
  windows: readonly PendingMoveResponseWindowView[]
  stateByWindow?: Readonly<Record<string, PendingMoveResponseWindowState>>
  actorLabels?: Readonly<Record<string, string>>
  eligibleOwnerLabel: string
  loading?: boolean
  error?: string | null
  canManage?: boolean
}>()

const emit = defineEmits<{
  choose: [input: PendingMoveResponseOptionReference]
  pass: [input: PendingMoveResponseReference]
  forcePass: [input: PendingMoveResponseReference]
  cancel: [resolutionId: string]
  retry: [opId: string]
  refresh: []
}>()

const referenceFor = (view: PendingMoveResponseWindowView): PendingMoveResponseReference => ({
  resolutionId: view.resolution.resolutionId,
  windowId: view.window.windowId,
})

const stateFor = (view: PendingMoveResponseWindowView): PendingMoveResponseWindowState => (
  props.stateByWindow?.[pendingMoveResponseWindowKey(referenceFor(view))] ?? { status: 'pending' }
)

const safeLookupLabel = (key: string): string => {
  const leaf = key.split('.').at(-1) ?? key
  const words = leaf.replace(/[-_]+/g, ' ').trim()
  return words.length > 0
    ? words.replace(/\b\w/g, character => character.toUpperCase())
    : key
}

const actorLabel = (view: PendingMoveResponseWindowView): string => (
  props.actorLabels?.[view.resolution.actorPlacementId] ?? 'Visible acting token'
)

const phaseLabel = (phase: string): string => safeLookupLabel(phase)
const promptLabel = (view: PendingMoveResponseWindowView): string => safeLookupLabel(view.window.promptKey)
const optionLabel = (labelKey: string): string => safeLookupLabel(labelKey)
const responseKindLabel = (view: PendingMoveResponseWindowView): string => (
  view.window.kind === 'reaction' ? 'Durable reaction' : 'Durable choice'
)
const isAttackOfOpportunity = (view: PendingMoveResponseWindowView): boolean => (
  view.window.reasonCode.startsWith('maneuver.attack-of-opportunity.')
)

const isBusy = (view: PendingMoveResponseWindowView): boolean => (
  stateFor(view).status !== 'pending'
)

const chooseOption = (view: PendingMoveResponseWindowView, optionId: string): void => {
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
</script>

<template>
  <section
    v-if="props.loading || props.error || props.windows.length > 0"
    class="move-response-panel"
    aria-label="Durable move responses"
    aria-live="polite"
  >
    <header class="move-response-panel__header">
      <div>
        <p class="move-response-panel__eyebrow">Move response</p>
        <h2>Authoritative prompts</h2>
      </div>
      <button
        v-if="props.error"
        type="button"
        class="move-response-panel__refresh"
        :disabled="props.loading"
        @click="emit('refresh')"
      >
        {{ props.loading ? 'Refreshing…' : 'Retry load' }}
      </button>
    </header>

    <p v-if="props.loading && props.windows.length === 0" class="move-response-panel__status">
      Loading eligible responses…
    </p>
    <p v-if="props.error" class="move-response-panel__error" role="alert">
      {{ props.error }}
    </p>

    <article
      v-for="view in props.windows"
      :key="pendingMoveResponseWindowKey(referenceFor(view))"
      class="move-response-card"
      :class="`move-response-card--${stateFor(view).status}`"
    >
      <div class="move-response-card__heading">
        <div>
          <span class="move-response-card__kind">{{ responseKindLabel(view) }}</span>
          <h3>{{ view.resolution.canonicalMoveId }}</h3>
        </div>
        <span class="move-response-card__state" :data-state="stateFor(view).status">
          {{ stateFor(view).status }}
        </span>
      </div>

      <dl class="move-response-card__context">
        <div>
          <dt>Actor</dt>
          <dd>{{ actorLabel(view) }}</dd>
        </div>
        <div>
          <dt>Phase</dt>
          <dd>{{ phaseLabel(view.window.phase) }}</dd>
        </div>
        <div>
          <dt>Eligible responder</dt>
          <dd>{{ props.eligibleOwnerLabel }}</dd>
        </div>
      </dl>

      <p class="move-response-card__prompt">{{ promptLabel(view) }}</p>
      <p v-if="isAttackOfOpportunity(view)" class="move-response-card__limitation">
        {{ ATTACK_OF_OPPORTUNITY_ASSISTANCE_NOTICE }}
      </p>

      <div class="move-response-card__actions">
        <button
          v-for="option in view.window.options"
          :key="option.id"
          type="button"
          class="move-response-card__option"
          :data-option-id="option.id"
          :disabled="isBusy(view)"
          @click="chooseOption(view, option.id)"
        >
          {{ optionLabel(option.labelKey) }}
        </button>
        <button
          v-if="view.window.allowPass"
          type="button"
          class="move-response-card__pass"
          :disabled="isBusy(view)"
          @click="pass(view)"
        >
          Pass
        </button>
      </div>

      <p v-if="stateFor(view).status === 'sending'" class="move-response-card__notice">
        Sending the exact journaled response…
      </p>
      <div v-else-if="stateFor(view).status === 'uncertain'" class="move-response-card__uncertain">
        <p>{{ stateFor(view).message ?? 'The server outcome is uncertain.' }}</p>
        <button type="button" :disabled="!stateFor(view).opId" @click="retry(view)">
          Retry exact response
        </button>
      </div>

      <div v-if="props.canManage" class="move-response-card__gm-controls">
        <span>GM controls</span>
        <button type="button" :disabled="isBusy(view)" @click="forcePass(view)">
          Force pass
        </button>
        <button type="button" :disabled="isBusy(view)" @click="cancel(view)">
          Cancel resolution
        </button>
      </div>
    </article>
  </section>
</template>

<style scoped>
.move-response-panel {
  position: absolute;
  z-index: 13;
  right: var(--map-overlay-gutter, 0.75rem);
  bottom: var(--map-overlay-gutter, 0.75rem);
  display: grid;
  gap: 0.65rem;
  width: min(24rem, calc(100vw - 1.5rem));
  max-height: min(70vh, 42rem);
  padding: 0.72rem;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--accent) 62%, var(--rule-strong));
  border-radius: 16px;
  background: color-mix(in srgb, var(--paper) 96%, transparent);
  box-shadow: 0 20px 54px rgba(0, 0, 0, 0.38);
  color: var(--ink);
  pointer-events: auto;
}

.move-response-panel__header,
.move-response-card__heading,
.move-response-card__actions,
.move-response-card__gm-controls,
.move-response-card__uncertain {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.move-response-panel__header,
.move-response-card__heading {
  justify-content: space-between;
}

.move-response-panel__eyebrow,
.move-response-card__kind,
.move-response-card__gm-controls > span {
  margin: 0;
  color: var(--accent);
  font-size: 0.68rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.move-response-panel h2,
.move-response-card h3,
.move-response-card p {
  margin: 0;
}

.move-response-panel h2 {
  font-size: 0.92rem;
}

.move-response-card {
  display: grid;
  gap: 0.65rem;
  padding: 0.75rem;
  border: 1px solid var(--rule-soft);
  border-radius: 13px;
  background: var(--paper-soft);
}

.move-response-card--uncertain {
  border-color: color-mix(in srgb, #efad2f 68%, var(--rule-strong));
}

.move-response-card h3 {
  margin-top: 0.1rem;
  color: var(--ink-bright);
  font-size: 1rem;
}

.move-response-card__state {
  padding: 0.24rem 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 900;
  text-transform: uppercase;
}

.move-response-card__state[data-state='sending'] {
  color: var(--accent);
}

.move-response-card__state[data-state='uncertain'] {
  color: #efad2f;
}

.move-response-card__context {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.45rem;
  margin: 0;
}

.move-response-card__context div {
  min-width: 0;
}

.move-response-card__context dt {
  color: var(--muted);
  font-size: 0.64rem;
  font-weight: 800;
  text-transform: uppercase;
}

.move-response-card__context dd {
  margin: 0.08rem 0 0;
  overflow-wrap: anywhere;
  font-size: 0.75rem;
  font-weight: 750;
}

.move-response-card__prompt {
  font-size: 0.84rem;
  font-weight: 800;
}

.move-response-card__actions,
.move-response-card__gm-controls {
  flex-wrap: wrap;
}

.move-response-panel button,
.move-response-card button {
  border: 1px solid var(--rule-strong);
  border-radius: 999px;
  background: var(--paper-accent);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-size: 0.74rem;
  font-weight: 850;
  padding: 0.38rem 0.62rem;
}

.move-response-card__option {
  border-color: color-mix(in srgb, var(--accent) 68%, var(--rule-strong)) !important;
  color: var(--accent) !important;
}

.move-response-panel button:disabled,
.move-response-card button:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.move-response-card__notice,
.move-response-card__uncertain,
.move-response-card__limitation,
.move-response-panel__status,
.move-response-panel__error {
  color: var(--muted);
  font-size: 0.75rem;
  line-height: 1.35;
}

.move-response-panel__error,
.move-response-card__uncertain,
.move-response-card__limitation {
  color: #efad2f;
}

.move-response-card__gm-controls {
  padding-top: 0.55rem;
  border-top: 1px solid var(--rule-soft);
}

@media (max-width: 600px) {
  .move-response-card__context {
    grid-template-columns: 1fr;
  }
}
</style>
