<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import EncounterCompactSpatialPreview from './EncounterCompactSpatialPreview.vue'
import type { EncounterChoiceSelection } from '#shared/encounterPresentation/contracts'
import {
  encounterDecisionChoiceSelections,
  encounterDecisionSelectionsValid,
  initialEncounterDecisionSelections,
  toggleEncounterDecisionOption,
  type EncounterDecisionModel,
  type EncounterDecisionSelections,
} from '#shared/encounterWorkspace/decision'

const props = defineProps<{
  decision: EncounterDecisionModel
  busy?: boolean
  error?: string | null
}>()
const emit = defineEmits<{
  submit: [selections: readonly EncounterChoiceSelection[]]
  pass: []
  cancel: []
  dismiss: []
  openTactical: [choiceId: string]
}>()
const headingRef = ref<HTMLElement | null>(null)
const errorRef = ref<HTMLElement | null>(null)
const selections = ref<EncounterDecisionSelections>(initialEncounterDecisionSelections(props.decision))
const valid = computed(() => encounterDecisionSelectionsValid(props.decision, selections.value))
const itemAction = computed(() => props.decision.kind === 'action' && props.decision.offer.source.sourceKind === 'item'
  ? props.decision.offer
  : null)
const formChangePreview = computed(() => itemAction.value?.formChangePreview ?? null)
const signedDelta = (value: number): string => value > 0 ? `+${value}` : value < 0 ? String(value) : '—'
const selectedItemOption = computed(() => {
  const offer = itemAction.value
  if (!offer) return null
  const targetChoiceIds = new Set(offer.targeting
    .filter(target => target.kind === 'participant' || target.kind === 'self')
    .map(target => target.requirementId))
  const selectedIds = new Set(Object.entries(selections.value)
    .filter(([choiceId]) => targetChoiceIds.has(choiceId))
    .flatMap(([, optionIds]) => optionIds))
  return (offer.selectionOptions ?? []).find(option => option.kind === 'participant' && selectedIds.has(option.value)) ?? null
})
const itemSummaryCosts = computed(() => selectedItemOption.value?.costs ?? itemAction.value?.costs ?? [])
const itemSourceSummary = computed(() => {
  const offer = itemAction.value
  if (!offer) return ''
  const available = offer.usage.remaining === null ? null : `${offer.usage.remaining} available`
  return [offer.sourceContextLabel ?? offer.actor.displayName, available].filter(Boolean).join(' · ')
})
const choose = (choiceIndex: number, optionId: string): void => {
  const choice = props.decision.choices[choiceIndex]
  if (!choice) return
  selections.value = toggleEncounterDecisionOption({ selections: selections.value, choice, optionId })
}
const submit = (): void => {
  if (!valid.value || props.busy) return
  emit('submit', encounterDecisionChoiceSelections(props.decision, selections.value))
}
watch(() => props.error, (error) => {
  if (error) errorRef.value?.focus({ preventScroll: true })
}, { flush: 'post' })
watch(() => ({
  interactionId: props.decision.interactionId,
  defaults: props.decision.choices.map(choice => `${choice.choiceId}:${choice.defaultOptionIds.join(',')}`).join('|'),
}), async (next, previous) => {
  selections.value = initialEncounterDecisionSelections(props.decision)
  if (next.interactionId !== previous?.interactionId) {
    await nextTick()
    if (!props.error) headingRef.value?.focus()
  }
}, { immediate: true })
</script>

<template>
  <section
    class="encounter-decision-layer rt-surface rt-signal-spine"
    :class="{ 'encounter-decision-layer--item': itemAction }"
    role="dialog"
    aria-modal="false"
    :aria-labelledby="`decision-title-${decision.interactionId}`"
    data-rt-layer="decision"
    data-rt-state="pending"
    data-rt-elevation="3"
  >
    <header>
      <div>
        <p>{{ decision.kind === 'pending' ? 'Resolution required' : formChangePreview ? 'Scene transformation' : 'Action decision' }}</p>
        <h2
          :id="`decision-title-${decision.interactionId}`"
          ref="headingRef"
          data-encounter-focus="decision-heading"
          tabindex="-1"
        >{{ decision.title }}</h2>
        <span>{{ decision.prompt }}</span>
      </div>
      <button type="button" :disabled="busy" aria-label="Close decision panel" @click="emit('dismiss')">×</button>
    </header>

    <ul v-if="itemAction" class="encounter-decision-layer__item-summary" aria-label="Item source, cost, and target consequence">
      <li class="encounter-decision-layer__item-source">
        <strong>{{ itemSourceSummary }}</strong>
        <span>{{ itemAction.source.displayName }} · authoritative source</span>
      </li>
      <li v-for="cost in itemSummaryCosts" :key="`${cost.kind}:${cost.resourceId ?? ''}:${cost.label}`">
        <strong>{{ cost.label }}</strong>
        <span>{{ cost.kind === 'item' ? 'Irreversible on acceptance' : cost.resourceId === 'item.restorative.target-next-turn-forfeit' ? 'Target consequence' : 'Authoritative cost' }}</span>
      </li>
    </ul>

    <section v-if="formChangePreview" class="encounter-decision-layer__form-preview" aria-label="Mega Evolution effective-data preview" tabindex="0">
      <div class="encounter-decision-layer__form-option" data-rt-state="selected">
        <span class="encounter-decision-layer__form-check" aria-hidden="true">✓</span>
        <div>
          <strong>{{ formChangePreview.toFormLabel }}</strong>
          <span>Selected form</span>
        </div>
        <p>{{ formChangePreview.fromFormLabel }} <span aria-hidden="true">→</span><span class="sr-only">changes to</span> {{ formChangePreview.toFormLabel }}</p>
        <p>{{ formChangePreview.fromTypes.join(' / ') }} <span aria-hidden="true">→</span><span class="sr-only">changes to</span> {{ formChangePreview.toTypes.join(' / ') }}</p>
      </div>
      <div class="encounter-decision-layer__form-effects">
        <h3>Effective for this Scene</h3>
        <p><strong>Ability</strong><span>{{ formChangePreview.abilityLabel }}</span></p>
        <dl>
          <div v-for="stat in formChangePreview.statDeltas" :key="stat.statId">
            <dt>{{ stat.label }}</dt>
            <dd class="rt-numeric">{{ signedDelta(stat.delta) }}</dd>
          </div>
        </dl>
        <small>HP does not change.</small>
      </div>
      <div class="encounter-decision-layer__form-warning">
        <strong>{{ formChangePreview.reversalLabel }}</strong>
        <span>The Trainer’s one Mega Evolution this Scene and this Swift Action are committed together.</span>
      </div>
      <p class="encounter-decision-layer__form-boundary">{{ formChangePreview.acceptanceBoundaryLabel }}</p>
    </section>

    <div v-if="decision.choices.length" class="encounter-decision-layer__choices" :class="{ 'encounter-decision-layer__choices--form': formChangePreview }">
      <fieldset
        v-for="(choice, choiceIndex) in decision.choices"
        v-show="!(formChangePreview && choice.choiceId === 'target' && choice.options.length === 1)"
        :key="choice.choiceOfferId"
      >
        <legend>{{ choice.prompt }}</legend>
        <p v-if="choice.helpText">{{ choice.helpText }}</p>
        <span class="encounter-decision-layer__cardinality">
          Choose {{ choice.cardinality.minimum }}<template v-if="choice.cardinality.maximum !== choice.cardinality.minimum">–{{ choice.cardinality.maximum }}</template>
          · {{ choice.kind }}
        </span>
        <EncounterCompactSpatialPreview
          v-if="choice.ordering === 'spatial' && choice.options.some(option => option.preview.kind === 'spatial')"
          :choice="choice"
          :selected-option-ids="selections[choice.choiceId] ?? []"
          :disabled="busy"
          @select="choose(choiceIndex, $event)"
        />
        <div v-else-if="choice.options.length" class="encounter-decision-layer__options">
          <button
            v-for="option in choice.options"
            :key="option.optionId"
            type="button"
            :disabled="busy || option.disabled"
            :aria-pressed="(selections[choice.choiceId] ?? []).includes(option.optionId)"
            @click="choose(choiceIndex, option.optionId)"
          >
            <span v-if="option.preview.kind === 'participant'" class="encounter-decision-layer__preview" aria-hidden="true">
              <img v-if="option.preview.participant.portraitUrl" :src="option.preview.participant.portraitUrl" alt="">
              <span v-else>{{ option.preview.participant.displayName.slice(0, 1) }}</span>
            </span>
            <span v-else-if="option.preview.kind === 'side'" class="encounter-decision-layer__side" :style="{ '--choice-accent': option.preview.accent ?? 'var(--rt-info)' }" aria-hidden="true" />
            <span v-else-if="option.preview.kind === 'reference'" class="encounter-decision-layer__source" aria-hidden="true">§</span>
            <span v-else-if="option.preview.kind === 'item'" class="encounter-decision-layer__source" aria-hidden="true">◇</span>
            <span class="encounter-decision-layer__option-copy">
              <strong>{{ option.label }}</strong>
              <small v-if="option.description">{{ option.description }}</small>
              <small v-if="option.unavailableReason">{{ option.unavailableReason.label }}</small>
              <small v-if="option.preview.kind === 'reference'">{{ option.preview.source.sourceKind }} reference</small>
              <small v-if="option.preview.kind === 'item' && option.preview.quantity !== null">Quantity {{ option.preview.quantity }}</small>
            </span>
            <span v-if="(selections[choice.choiceId] ?? []).includes(option.optionId)" class="encounter-decision-layer__option-state">✓ Selected</span>
            <span v-else-if="option.disabled" class="encounter-decision-layer__option-state">Unavailable</span>
          </button>
        </div>
        <button
          v-else-if="choice.ordering === 'spatial'"
          type="button"
          class="encounter-decision-layer__tactical"
          :disabled="busy"
          @click="emit('openTactical', choice.choiceId)"
        >
          Open tactical choice for {{ choice.kind }}
        </button>
        <p v-else class="encounter-decision-layer__empty">No authorized options are currently projected.</p>
      </fieldset>
    </div>
    <p v-else class="encounter-decision-layer__immediate">This action has no projected choices. Confirm to request server authorization.</p>

    <p v-if="error" ref="errorRef" class="encounter-decision-layer__error" role="alert" tabindex="-1">{{ error }}</p>
    <footer>
      <button v-if="decision.allowCancel" type="button" :disabled="busy" @click="emit('cancel')">{{ decision.kind === 'pending' ? 'Cancel resolution' : 'Back' }}</button>
      <button v-if="decision.allowPass" type="button" :disabled="busy" @click="emit('pass')">Pass</button>
      <button
        type="button"
        class="encounter-decision-layer__confirm"
        :class="{ 'encounter-decision-layer__confirm--item': itemAction }"
        :disabled="busy || !valid"
        @click="submit"
      >
        {{ busy ? 'Submitting…' : decision.kind === 'pending' ? 'Submit response' : formChangePreview ? 'Mega Evolve' : decision.offer.source.sourceKind === 'item' ? 'Use item' : 'Declare action' }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.encounter-decision-layer { width: min(58rem, calc(100% - 1.5rem)); max-height: min(78dvh, 52rem); display: flex; flex-direction: column; margin: 1rem auto; overflow: hidden; background: var(--rt-surface-1); }
.encounter-decision-layer > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 1rem; border-bottom: 1px solid var(--rt-rule); }
.encounter-decision-layer > header p { margin: 0; color: var(--rt-pending); font-size: var(--rt-type-label-sm-size); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
.encounter-decision-layer h2 { margin: 0; color: var(--rt-text-strong); font-size: var(--rt-type-heading-md-size); }
.encounter-decision-layer > header span { color: var(--rt-text-muted); }
.encounter-decision-layer > header button { width: var(--rt-touch-minimum); height: var(--rt-touch-minimum); border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: 800 1.25rem/1 var(--rt-font-interface); }
.encounter-decision-layer__item-summary { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0; padding: 0.75rem 1rem; border-bottom: 1px solid var(--rt-rule); list-style: none; }
.encounter-decision-layer__item-summary li { min-width: min(100%, 11rem); display: grid; gap: 0.1rem; padding: 0.5rem 0.65rem; border-left: 3px solid var(--rt-pending); background: var(--rt-surface-2); }
.encounter-decision-layer__item-summary .encounter-decision-layer__item-source { flex: 1 1 16rem; }
.encounter-decision-layer__item-summary strong { color: var(--rt-text-strong); }
.encounter-decision-layer__item-summary span { color: var(--rt-text-muted); font-size: var(--rt-type-meta-xs-size); }
.encounter-decision-layer__form-preview { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.9fr); gap: 0.75rem; padding: 1rem 1rem 0; overflow: auto; }
.encounter-decision-layer__form-option,
.encounter-decision-layer__form-effects { min-width: 0; padding: 0.9rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); background: var(--rt-surface-2); }
.encounter-decision-layer__form-option { display: grid; grid-template-columns: auto 1fr; align-content: start; gap: 0.7rem; border: var(--rt-border-focus) solid var(--rt-focus); }
.encounter-decision-layer__form-check { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; border: 2px solid var(--rt-focus); border-radius: 50%; color: var(--rt-focus); font-weight: 900; }
.encounter-decision-layer__form-option > div { display: grid; align-content: center; }
.encounter-decision-layer__form-option > div strong { color: var(--rt-text-strong); font-size: var(--rt-type-heading-md-size); }
.encounter-decision-layer__form-option > div span { color: var(--rt-focus); font-size: var(--rt-type-label-sm-size); font-weight: 800; }
.encounter-decision-layer__form-option p { grid-column: 1 / -1; margin: 0; padding-top: 0.65rem; border-top: 1px solid var(--rt-rule); color: var(--rt-text); font-weight: 700; }
.encounter-decision-layer__form-option p span[aria-hidden='true'] { padding-inline: 0.4rem; color: var(--rt-focus); }
.encounter-decision-layer__form-effects h3 { margin: 0 0 0.3rem; color: var(--rt-text-strong); font-size: var(--rt-type-action-md-size); }
.encounter-decision-layer__form-effects > p { display: flex; justify-content: space-between; gap: 0.75rem; margin: 0; padding: 0.35rem 0; border-bottom: 1px solid var(--rt-rule); }
.encounter-decision-layer__form-effects dl { margin: 0; }
.encounter-decision-layer__form-effects dl > div { display: flex; justify-content: space-between; gap: 0.75rem; padding: 0.3rem 0; border-bottom: 1px solid var(--rt-rule); }
.encounter-decision-layer__form-effects dt { color: var(--rt-text); }
.encounter-decision-layer__form-effects dd { margin: 0; color: var(--rt-text-strong); font-weight: 800; }
.encounter-decision-layer__form-effects small { display: block; padding-top: 0.35rem; color: var(--rt-text-muted); }
.encounter-decision-layer__form-warning { grid-column: 1 / -1; display: grid; gap: 0.15rem; padding: 0.7rem 0.85rem; border: 1px solid var(--rt-pending); border-radius: var(--rt-radius-small); background: color-mix(in srgb, var(--rt-pending) 10%, var(--rt-surface-2)); }
.encounter-decision-layer__form-warning strong { color: var(--rt-pending); }
.encounter-decision-layer__form-warning span { color: var(--rt-text); }
.encounter-decision-layer__form-boundary { grid-column: 1 / -1; margin: 0; color: var(--rt-text-muted); font-weight: 700; text-align: center; }
.encounter-decision-layer__choices { min-height: 0; display: grid; gap: 0.75rem; padding: 1rem; overflow: auto; }
.encounter-decision-layer__choices--form { padding-top: 0.5rem; }
.encounter-decision-layer fieldset { min-width: 0; margin: 0; padding: 0.75rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); }
.encounter-decision-layer legend { padding: 0 0.25rem; color: var(--rt-text-strong); font-weight: 800; }
.encounter-decision-layer fieldset > p { margin: 0 0 0.35rem; color: var(--rt-text-muted); }
.encounter-decision-layer__cardinality { color: var(--rt-info); font-size: var(--rt-type-meta-xs-size); text-transform: uppercase; }
.encounter-decision-layer__options { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: 0.5rem; margin-top: 0.65rem; }
.encounter-decision-layer--item .encounter-decision-layer__options { grid-template-columns: 1fr; }
.encounter-decision-layer__options > button { min-height: var(--rt-touch-minimum); display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.55rem; padding: 0.55rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text); font: inherit; text-align: left; }
.encounter-decision-layer__options > button[aria-pressed='true'] { border-color: var(--rt-focus); background: color-mix(in srgb, var(--rt-focus) 12%, var(--rt-surface-2)); }
.encounter-decision-layer__options > button:disabled { border-style: dashed; color: var(--rt-text-muted); opacity: 1; }
.encounter-decision-layer__preview,
.encounter-decision-layer__source { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; overflow: hidden; border-radius: 50%; background: var(--rt-surface-3); color: var(--rt-text-strong); font-weight: 800; }
.encounter-decision-layer__preview img { width: 100%; height: 100%; object-fit: contain; }
.encounter-decision-layer__side { width: 0.5rem; height: 2.5rem; border-radius: 999px; background: var(--choice-accent); }
.encounter-decision-layer__option-copy strong,
.encounter-decision-layer__option-copy small { display: block; }
.encounter-decision-layer__option-copy small { color: var(--rt-text-muted); }
.encounter-decision-layer__option-state { color: var(--rt-focus); font-size: var(--rt-type-label-sm-size); font-weight: 800; white-space: nowrap; }
.encounter-decision-layer__options > button:disabled .encounter-decision-layer__option-state { color: var(--rt-text-muted); }
.encounter-decision-layer__tactical { min-height: var(--rt-touch-minimum); margin-top: 0.6rem; border: 1px solid var(--rt-info); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
.encounter-decision-layer__empty,
.encounter-decision-layer__immediate { margin: 1rem; color: var(--rt-text-muted); }
.encounter-decision-layer__error { margin: 0 1rem; padding: 0.6rem; border-left: 3px solid var(--rt-danger); background: color-mix(in srgb, var(--rt-danger) 12%, var(--rt-surface-2)); color: var(--rt-text-strong); }
.encounter-decision-layer > footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.75rem 1rem; border-top: 1px solid var(--rt-rule); }
.encounter-decision-layer > footer button { min-height: var(--rt-touch-minimum); padding: 0.55rem 0.8rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
.encounter-decision-layer > footer .encounter-decision-layer__confirm { border-color: var(--rt-info); }
.encounter-decision-layer > footer .encounter-decision-layer__confirm--item:not(:disabled) { border-color: var(--rt-brand); background: var(--rt-brand); color: var(--rt-on-brand); }
@media (max-width: 42rem) {
  .encounter-decision-layer { width: 100%; max-height: 86dvh; margin: auto 0 0; border-radius: var(--rt-radius-medium) var(--rt-radius-medium) 0 0; }
  .encounter-decision-layer > header,
  .encounter-decision-layer__choices { padding-inline: 0.75rem; }
  .encounter-decision-layer__form-preview { grid-template-columns: 1fr; padding-inline: 0.75rem; }
  .encounter-decision-layer__form-warning,
  .encounter-decision-layer__form-boundary { grid-column: 1; }
  .encounter-decision-layer__item-summary { padding-inline: 0.75rem; }
  .encounter-decision-layer > footer { position: sticky; bottom: 0; background: var(--rt-surface-1); }
  .encounter-decision-layer > footer button { flex: 1 1 0; }
}
</style>
