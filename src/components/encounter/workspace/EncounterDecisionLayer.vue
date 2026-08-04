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
const selections = ref<EncounterDecisionSelections>(initialEncounterDecisionSelections(props.decision))
const valid = computed(() => encounterDecisionSelectionsValid(props.decision, selections.value))
const choose = (choiceIndex: number, optionId: string): void => {
  const choice = props.decision.choices[choiceIndex]
  if (!choice) return
  selections.value = toggleEncounterDecisionOption({ selections: selections.value, choice, optionId })
}
const submit = (): void => {
  if (!valid.value || props.busy) return
  emit('submit', encounterDecisionChoiceSelections(props.decision, selections.value))
}
watch(() => ({
  interactionId: props.decision.interactionId,
  defaults: props.decision.choices.map(choice => `${choice.choiceId}:${choice.defaultOptionIds.join(',')}`).join('|'),
}), async (next, previous) => {
  selections.value = initialEncounterDecisionSelections(props.decision)
  if (next.interactionId !== previous?.interactionId) {
    await nextTick()
    headingRef.value?.focus()
  }
}, { immediate: true })
</script>

<template>
  <section
    class="encounter-decision-layer rt-surface rt-signal-spine"
    role="dialog"
    aria-modal="false"
    :aria-labelledby="`decision-title-${decision.interactionId}`"
    data-rt-layer="decision"
    data-rt-state="pending"
    data-rt-elevation="3"
  >
    <header>
      <div>
        <p>{{ decision.kind === 'pending' ? 'Resolution required' : 'Action decision' }}</p>
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

    <div v-if="decision.choices.length" class="encounter-decision-layer__choices">
      <fieldset v-for="(choice, choiceIndex) in decision.choices" :key="choice.choiceOfferId">
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

    <p v-if="error" class="encounter-decision-layer__error" role="alert">{{ error }}</p>
    <footer>
      <button v-if="decision.allowCancel" type="button" :disabled="busy" @click="emit('cancel')">{{ decision.kind === 'pending' ? 'Cancel resolution' : 'Back' }}</button>
      <button v-if="decision.allowPass" type="button" :disabled="busy" @click="emit('pass')">Pass</button>
      <button type="button" class="encounter-decision-layer__confirm" :disabled="busy || !valid" @click="submit">
        {{ busy ? 'Submitting…' : decision.kind === 'pending' ? 'Submit response' : 'Declare action' }}
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
.encounter-decision-layer__choices { min-height: 0; display: grid; gap: 0.75rem; padding: 1rem; overflow: auto; }
.encounter-decision-layer fieldset { min-width: 0; margin: 0; padding: 0.75rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-medium); }
.encounter-decision-layer legend { padding: 0 0.25rem; color: var(--rt-text-strong); font-weight: 800; }
.encounter-decision-layer fieldset > p { margin: 0 0 0.35rem; color: var(--rt-text-muted); }
.encounter-decision-layer__cardinality { color: var(--rt-info); font-size: var(--rt-type-meta-xs-size); text-transform: uppercase; }
.encounter-decision-layer__options { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr)); gap: 0.5rem; margin-top: 0.65rem; }
.encounter-decision-layer__options > button { min-height: var(--rt-touch-minimum); display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 0.55rem; padding: 0.55rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text); font: inherit; text-align: left; }
.encounter-decision-layer__options > button[aria-pressed='true'] { border-color: var(--rt-focus); background: color-mix(in srgb, var(--rt-focus) 12%, var(--rt-surface-2)); }
.encounter-decision-layer__options > button:disabled { opacity: 0.55; }
.encounter-decision-layer__preview,
.encounter-decision-layer__source { display: grid; place-items: center; width: 2.5rem; height: 2.5rem; overflow: hidden; border-radius: 50%; background: var(--rt-surface-3); color: var(--rt-text-strong); font-weight: 800; }
.encounter-decision-layer__preview img { width: 100%; height: 100%; object-fit: contain; }
.encounter-decision-layer__side { width: 0.5rem; height: 2.5rem; border-radius: 999px; background: var(--choice-accent); }
.encounter-decision-layer__option-copy strong,
.encounter-decision-layer__option-copy small { display: block; }
.encounter-decision-layer__option-copy small { color: var(--rt-text-muted); }
.encounter-decision-layer__tactical { min-height: var(--rt-touch-minimum); margin-top: 0.6rem; border: 1px solid var(--rt-info); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
.encounter-decision-layer__empty,
.encounter-decision-layer__immediate { margin: 1rem; color: var(--rt-text-muted); }
.encounter-decision-layer__error { margin: 0 1rem; padding: 0.6rem; border-left: 3px solid var(--rt-danger); background: color-mix(in srgb, var(--rt-danger) 12%, var(--rt-surface-2)); color: var(--rt-text-strong); }
.encounter-decision-layer > footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.75rem 1rem; border-top: 1px solid var(--rt-rule); }
.encounter-decision-layer > footer button { min-height: var(--rt-touch-minimum); padding: 0.55rem 0.8rem; border: 1px solid var(--rt-rule); border-radius: var(--rt-radius-small); background: var(--rt-surface-2); color: var(--rt-text-strong); font: inherit; font-weight: 700; }
.encounter-decision-layer > footer .encounter-decision-layer__confirm { border-color: var(--rt-info); }
</style>
