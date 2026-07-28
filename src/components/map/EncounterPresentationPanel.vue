<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type {
  AcceptedEncounterPresentation,
  EncounterActionOffer,
  EncounterPendingInteractionAuthorizedView,
  EncounterPendingInteractionView,
  EncounterPresentationProjection,
} from '#shared/encounterPresentation'

const props = defineProps<{
  projection: EncounterPresentationProjection
  accepted: readonly AcceptedEncounterPresentation[]
  selectedParticipantId?: string | null
}>()

const emit = defineEmits<{
  activate: [offer: EncounterActionOffer]
  respond: [payload: {
    interaction: EncounterPendingInteractionAuthorizedView
    decision: 'choose' | 'pass' | 'cancel' | 'force-pass'
    choiceId?: string
    optionIds?: readonly string[]
  }]
}>()

const expanded = ref(false)
const pendingHeading = ref<HTMLElement | null>(null)
const selectedOptions = ref<Readonly<Record<string, readonly string[]>>>({})
const actorIds = computed(() => [...new Set(props.projection.offers.map(offer => offer.actor.participantId))])
const selectedActorId = computed(() => (
  props.selectedParticipantId && actorIds.value.includes(props.selectedParticipantId)
    ? props.selectedParticipantId
    : actorIds.value[0] ?? null
))
const visibleOffers = computed(() => props.projection.offers.filter(offer => (
  selectedActorId.value === null || offer.actor.participantId === selectedActorId.value
)))
const groupedOffers = computed(() => {
  const groups = new Map<string, EncounterActionOffer[]>()
  for (const offer of visibleOffers.value) {
    const values = groups.get(offer.group) ?? []
    values.push(offer)
    groups.set(offer.group, values)
  }
  return [...groups.entries()].map(([group, offers]) => ({
    group,
    offers: [...offers].sort((left, right) => left.offerOrder - right.offerOrder),
  })).sort((left, right) => (left.offers[0]?.groupOrder ?? 0) - (right.offers[0]?.groupOrder ?? 0))
})
const visiblePassives = computed(() => props.projection.passives.filter(summary => (
  selectedActorId.value === null || summary.participant.participantId === selectedActorId.value
)))
const visibleAffordances = computed(() => props.projection.affordances.filter(affordance => (
  affordance.actor === null
  || selectedActorId.value === null
  || affordance.actor.participantId === selectedActorId.value
)))
const latestAccepted = computed(() => [...props.accepted].slice(-12).reverse())

const isAuthorizedPending = (
  pending: EncounterPendingInteractionView,
): pending is EncounterPendingInteractionAuthorizedView => pending.projection !== 'public'

const unavailableText = (offer: EncounterActionOffer): string => offer.availability.reasons
  .map(reason => reason.label)
  .join(' ') || 'This action is unavailable.'

const activate = (offer: EncounterActionOffer): void => {
  if (offer.availability.status !== 'available') return
  emit('activate', offer)
}

const choiceKey = (interactionId: string, choiceId: string): string => `${interactionId}:${choiceId}`
const selectionFor = (interactionId: string, choiceId: string): readonly string[] => (
  selectedOptions.value[choiceKey(interactionId, choiceId)] ?? []
)
const toggleOption = (
  pending: EncounterPendingInteractionAuthorizedView,
  choice: EncounterPendingInteractionAuthorizedView['choices'][number],
  optionId: string,
): void => {
  if (!choice.requiresConfirmation && choice.cardinality.maximum === 1) {
    emit('respond', { interaction: pending, decision: 'choose', choiceId: choice.choiceId, optionIds: [optionId] })
    return
  }
  const key = choiceKey(pending.interactionId, choice.choiceId)
  const current = selectionFor(pending.interactionId, choice.choiceId)
  const next = current.includes(optionId)
    ? current.filter(id => id !== optionId)
    : current.length < choice.cardinality.maximum
      ? [...current, optionId]
      : current
  selectedOptions.value = { ...selectedOptions.value, [key]: next }
}
const confirmChoice = (
  pending: EncounterPendingInteractionAuthorizedView,
  choice: EncounterPendingInteractionAuthorizedView['choices'][number],
): void => {
  const optionIds = selectionFor(pending.interactionId, choice.choiceId)
  if (optionIds.length < choice.cardinality.minimum || optionIds.length > choice.cardinality.maximum) return
  emit('respond', { interaction: pending, decision: 'choose', choiceId: choice.choiceId, optionIds })
}

watch(
  () => props.projection.pending.map(pending => pending.interactionId).join('|'),
  async (current, previous) => {
    if (!current || current === previous) return
    expanded.value = true
    await nextTick()
    pendingHeading.value?.focus({ preventScroll: true })
  },
)
</script>

<template>
  <aside
    class="encounter-presentation"
    data-testid="encounter-presentation-panel"
    aria-label="Encounter actions and outcomes"
  >
    <button
      class="encounter-presentation__toggle"
      type="button"
      :aria-expanded="expanded"
      aria-controls="encounter-presentation-content"
      @click="expanded = !expanded"
    >
      <span>Encounter</span>
      <span class="encounter-presentation__count">{{ visibleOffers.length }}</span>
    </button>

    <div
      v-show="expanded"
      id="encounter-presentation-content"
      class="encounter-presentation__content"
    >
      <section
        v-if="projection.pending.length"
        class="encounter-presentation__section encounter-presentation__pending"
        aria-label="Pending responses"
      >
        <h2
          ref="pendingHeading"
          tabindex="-1"
        >
          Response needed
        </h2>
        <article
          v-for="pending in projection.pending"
          :key="pending.interactionId"
          class="encounter-presentation__pending-card"
          :data-interaction-id="pending.interactionId"
        >
          <p>{{ pending.prompt }}</p>
          <template v-if="isAuthorizedPending(pending)">
            <fieldset
              v-for="choice in pending.choices"
              :key="choice.choiceOfferId"
            >
              <legend>{{ choice.prompt }}</legend>
              <button
                v-for="option in choice.options"
                :key="option.optionId"
                type="button"
                :disabled="option.disabled"
                :title="option.unavailableReason?.label ?? undefined"
                :aria-pressed="choice.requiresConfirmation || choice.cardinality.maximum > 1 ? selectionFor(pending.interactionId, choice.choiceId).includes(option.optionId) : undefined"
                @click="toggleOption(pending, choice, option.optionId)"
              >
                {{ option.label }}
              </button>
              <button
                v-if="choice.requiresConfirmation || choice.cardinality.maximum > 1"
                type="button"
                :disabled="selectionFor(pending.interactionId, choice.choiceId).length < choice.cardinality.minimum || selectionFor(pending.interactionId, choice.choiceId).length > choice.cardinality.maximum"
                @click="confirmChoice(pending, choice)"
              >
                Confirm {{ selectionFor(pending.interactionId, choice.choiceId).length }} selection{{ selectionFor(pending.interactionId, choice.choiceId).length === 1 ? '' : 's' }}
              </button>
            </fieldset>
            <div class="encounter-presentation__row">
              <button
                v-if="pending.allowPass"
                type="button"
                @click="emit('respond', { interaction: pending, decision: 'pass' })"
              >
                Pass
              </button>
              <button
                v-if="pending.allowCancel"
                type="button"
                @click="emit('respond', { interaction: pending, decision: 'cancel' })"
              >
                Cancel
              </button>
              <button
                v-for="action in pending.recoveryActions.filter(action => action.action === 'force-pass')"
                :key="action.actionId"
                type="button"
                :disabled="!action.enabled"
                :title="action.unavailableReason?.label ?? undefined"
                @click="emit('respond', { interaction: pending, decision: 'force-pass' })"
              >
                {{ action.label }}
              </button>
            </div>
          </template>
          <p v-else>
            {{ pending.outstandingChoiceCount }} response{{ pending.outstandingChoiceCount === 1 ? '' : 's' }} outstanding
          </p>
        </article>
      </section>

      <section
        class="encounter-presentation__section"
        aria-label="Available actions"
      >
        <h2>Actions</h2>
        <p v-if="visibleOffers.length === 0" class="encounter-presentation__empty">
          No actions are available for this participant.
        </p>
        <section
          v-for="entry in groupedOffers"
          :key="entry.group"
          class="encounter-presentation__group"
        >
          <h3>{{ entry.group }}</h3>
          <button
            v-for="offer in entry.offers"
            :key="offer.offerId"
            type="button"
            class="encounter-presentation__action"
            :class="{ 'encounter-presentation__action--blocked': offer.availability.status !== 'available' }"
            :disabled="offer.availability.status !== 'available'"
            :title="offer.availability.status === 'available' ? offer.presentation.description ?? undefined : unavailableText(offer)"
            :data-offer-id="offer.offerId"
            :data-action-id="offer.intent.actionId"
            @click="activate(offer)"
          >
            <span>{{ offer.presentation.label }}</span>
            <small>{{ offer.timing.label }}</small>
            <small v-if="offer.usage.frequencyLabel">{{ offer.usage.frequencyLabel }}</small>
            <small v-if="offer.availability.status !== 'available'">{{ unavailableText(offer) }}</small>
          </button>
        </section>
      </section>

      <details
        v-if="visiblePassives.length"
        class="encounter-presentation__section"
      >
        <summary>Passives ({{ visiblePassives.length }})</summary>
        <article
          v-for="summary in visiblePassives"
          :key="summary.summaryId"
          class="encounter-presentation__passive"
        >
          <strong>{{ summary.presentation.label }}</strong>
          <p v-if="summary.presentation.description">{{ summary.presentation.description }}</p>
          <dl v-if="summary.facts.length">
            <template v-for="fact in summary.facts" :key="fact.factId">
              <dt>{{ fact.label }}</dt>
              <dd>
                {{ fact.value.numberValue ?? fact.value.textValue ?? fact.value.booleanValue }}{{ fact.value.unit ? ` ${fact.value.unit}` : '' }}
              </dd>
            </template>
          </dl>
          <details v-if="summary.explanation">
            <summary>Why this value</summary>
            <ol>
              <li
                v-for="contribution in summary.explanation.contributions"
                :key="contribution.contributionId"
              >
                {{ contribution.label }}
              </li>
            </ol>
          </details>
        </article>
      </details>

      <details
        v-if="visibleAffordances.length"
        class="encounter-presentation__section"
      >
        <summary>Context ({{ visibleAffordances.length }})</summary>
        <ul class="encounter-presentation__affordances">
          <li v-for="affordance in visibleAffordances" :key="affordance.affordanceId">
            <strong>{{ affordance.presentation.label }}</strong>
            <span v-if="affordance.presentation.description">{{ affordance.presentation.description }}</span>
            <small v-if="affordance.availability.status === 'unavailable'">
              {{ affordance.availability.reasons.map(reason => reason.label).join(' ') }}
            </small>
          </li>
        </ul>
      </details>

      <details
        v-if="projection.audience === 'diagnostic' && projection.diagnostics.length"
        class="encounter-presentation__section"
        data-testid="encounter-presentation-diagnostics"
      >
        <summary>Contract diagnostics ({{ projection.diagnostics.length }})</summary>
        <dl>
          <template v-for="diagnostic in projection.diagnostics" :key="diagnostic.diagnosticId">
            <dt>{{ diagnostic.label }}</dt>
            <dd>{{ diagnostic.detail }}</dd>
          </template>
        </dl>
      </details>

      <details
        v-if="latestAccepted.length"
        class="encounter-presentation__section"
      >
        <summary>Recent outcomes ({{ accepted.length }})</summary>
        <ol class="encounter-presentation__history">
          <li
            v-for="presentation in latestAccepted"
            :key="presentation.presentationId"
            :data-presentation-id="presentation.presentationId"
          >
            <strong>{{ presentation.headline.label }}</strong>
            <span v-if="presentation.outcomes.length">
              {{ presentation.outcomes.map(outcome => outcome.label).join(', ') }}
            </span>
            <details v-if="presentation.changes.length || presentation.explanations.length">
              <summary>Details</summary>
              <ul>
                <li v-for="change in presentation.changes" :key="change.changeId">
                  {{ change.label }}
                </li>
                <li v-for="explanation in presentation.explanations" :key="explanation.explanationId">
                  {{ explanation.label }}
                  <ol>
                    <li v-for="contribution in explanation.contributions" :key="contribution.contributionId">
                      {{ contribution.label }}
                    </li>
                  </ol>
                </li>
              </ul>
            </details>
          </li>
        </ol>
      </details>
    </div>
  </aside>
</template>

<style scoped>
.encounter-presentation {
  position: absolute;
  inset: 0.75rem 0.75rem auto auto;
  z-index: 35;
  width: min(23rem, calc(100vw - 1.5rem));
  color: var(--color-text, #f7f7fb);
  font-size: 0.875rem;
}
.encounter-presentation__toggle,
.encounter-presentation__content {
  border: 1px solid rgb(255 255 255 / 18%);
  background: rgb(15 18 28 / 94%);
  box-shadow: 0 0.75rem 2rem rgb(0 0 0 / 35%);
  backdrop-filter: blur(0.75rem);
}
.encounter-presentation__toggle {
  display: flex;
  gap: 0.6rem;
  align-items: center;
  margin-left: auto;
  border-radius: 999px;
  padding: 0.55rem 0.85rem;
  color: inherit;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.encounter-presentation__count {
  display: inline-grid;
  min-width: 1.45rem;
  min-height: 1.45rem;
  place-items: center;
  border-radius: 999px;
  background: #7658ff;
}
.encounter-presentation__content {
  max-height: min(72vh, 46rem);
  margin-top: 0.5rem;
  overflow: auto;
  border-radius: 0.85rem;
  padding: 0.75rem;
}
.encounter-presentation__section + .encounter-presentation__section { margin-top: 0.9rem; }
h2, h3, p { margin: 0; }
h2 { font-size: 1rem; }
h3 { margin: 0.7rem 0 0.35rem; color: #b9acd9; font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; }
.encounter-presentation__group { display: grid; }
.encounter-presentation__action {
  display: grid;
  gap: 0.12rem;
  width: 100%;
  margin-bottom: 0.35rem;
  border: 1px solid rgb(255 255 255 / 13%);
  border-radius: 0.55rem;
  background: rgb(255 255 255 / 7%);
  padding: 0.55rem 0.65rem;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.encounter-presentation__action:hover:not(:disabled),
.encounter-presentation__action:focus-visible { border-color: #9d8aff; background: rgb(118 88 255 / 18%); }
.encounter-presentation__action--blocked { opacity: 0.62; cursor: not-allowed; }
.encounter-presentation__action small { color: #b7b7c7; }
.encounter-presentation__pending { border: 1px solid #d6a44d; border-radius: 0.6rem; padding: 0.65rem; }
.encounter-presentation__pending-card { display: grid; gap: 0.45rem; margin-top: 0.45rem; }
.encounter-presentation__row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.encounter-presentation__passive { margin: 0.55rem 0; border-left: 2px solid #7658ff; padding-left: 0.55rem; }
.encounter-presentation__passive dl { display: grid; grid-template-columns: 1fr auto; margin: 0.35rem 0 0; }
.encounter-presentation__passive dt, .encounter-presentation__passive dd { margin: 0; }
.encounter-presentation__affordances { display: grid; gap: 0.4rem; padding-left: 1.25rem; }
.encounter-presentation__affordances span, .encounter-presentation__affordances small { display: block; color: #c9c9d3; }
.encounter-presentation__history { display: grid; gap: 0.55rem; padding-left: 1.25rem; }
.encounter-presentation__history li { padding-left: 0.2rem; }
.encounter-presentation__history span { display: block; color: #c9c9d3; }
.encounter-presentation__empty { margin-top: 0.5rem; color: #b7b7c7; }
@media (max-width: 48rem) {
  .encounter-presentation { inset: 0.5rem 0.5rem auto; width: auto; }
  .encounter-presentation__content { max-height: 55vh; }
}
@media (prefers-reduced-motion: reduce) {
  .encounter-presentation__toggle, .encounter-presentation__action { scroll-behavior: auto; transition: none; }
}
</style>
