<script setup lang="ts">
import type {
  AbilityDeclarationPanelState,
  AbilityInvocationStatus,
  AbilityModeSelectionState,
} from '~/composables/map-editor/useAbilityAutomationPanel'

const props = defineProps<{
  modeSelection: AbilityModeSelectionState | null
  declaration: AbilityDeclarationPanelState | null
  status: AbilityInvocationStatus
}>()
const emit = defineEmits<{
  selectMode: [modeId: string]
  toggleOption: [declarationId: string, optionId: string]
  submit: []
  retry: []
  cancel: []
}>()
const selected = (declarationId: string, optionId: string): boolean => (
  props.declaration?.selectedOptionIds[declarationId]?.includes(optionId) ?? false
)
const hintLabel = (hint: AbilityDeclarationPanelState['offer']['declarations'][number]['options'][number]['hint']): string => {
  if (hint.kind === 'placement') return `Token ${hint.placementId}`
  if (hint.kind === 'side') return `Side ${hint.sideId}`
  if (hint.kind === 'cell') return `Cell ${hint.x}, ${hint.y}, ${hint.z}`
  if (hint.kind === 'none') return 'No selection'
  return hint.valueId
}
const canSubmit = (): boolean => props.declaration?.offer.declarations.every((declaration) => {
  const count = props.declaration?.selectedOptionIds[declaration.declarationId]?.length ?? 0
  return count >= declaration.minSelections && count <= declaration.maxSelections
}) ?? false
const visible = (): boolean => props.modeSelection !== null
  || props.declaration !== null
  || props.status.kind !== 'idle'
const controllerPresentation = (key: string | null | undefined): string | null => {
  if (key === 'ability.anticipation.super-effective-present') {
    return 'The target has at least one super-effective damaging move.'
  }
  if (key === 'ability.anticipation.super-effective-absent') {
    return 'The target has no super-effective damaging move.'
  }
  return null
}
</script>

<template>
  <section
    v-if="visible()"
    class="ability-panel"
    aria-label="Ability automation"
    aria-live="polite"
  >
    <header>
      <div>
        <p class="eyebrow">Ability</p>
        <h2>{{ modeSelection?.displayName ?? declaration?.offer.canonicalId ?? 'Authoritative ability' }}</h2>
      </div>
      <button type="button" aria-label="Cancel ability selection" @click="emit('cancel')">×</button>
    </header>

    <div v-if="modeSelection" class="choices" role="group" aria-label="Ability modes">
      <p>Choose how to use this ability.</p>
      <button
        v-for="mode in modeSelection.modes"
        :key="mode.modeId"
        type="button"
        @click="emit('selectMode', mode.modeId)"
      >
        {{ mode.modeId }}
      </button>
    </div>

    <div v-else-if="declaration" class="declarations">
      <fieldset v-for="entry in declaration.offer.declarations" :key="entry.declarationId">
        <legend>{{ entry.declarationId }} · choose {{ entry.minSelections }}–{{ entry.maxSelections }}</legend>
        <button
          v-for="option in entry.options"
          :key="option.optionId"
          type="button"
          :aria-pressed="selected(entry.declarationId, option.optionId)"
          @click="emit('toggleOption', entry.declarationId, option.optionId)"
        >
          {{ hintLabel(option.hint) }}
        </button>
      </fieldset>
      <button type="button" :disabled="!canSubmit()" @click="emit('submit')">Confirm ability</button>
    </div>

    <p v-if="status.kind === 'loading-offer'">Loading server-authorized choices…</p>
    <p v-else-if="status.kind === 'submitting'">Submitting the exact declaration…</p>
    <p v-else-if="status.kind === 'pending'">Waiting for an authoritative response.</p>
    <p v-else-if="status.kind === 'accepted'">
      Ability result accepted: {{ status.result.presentation.outcome }}.
      <span v-if="controllerPresentation(status.controllerPresentationKey)">
        {{ controllerPresentation(status.controllerPresentationKey) }}
      </span>
    </p>
    <div v-else-if="status.kind === 'uncertain'" role="alert">
      <p>{{ status.message }}</p>
      <button type="button" @click="emit('retry')">Retry exact declaration</button>
    </div>
    <p v-else-if="status.kind === 'error'" role="alert">{{ status.message }}</p>
  </section>
</template>

<style scoped>
.ability-panel {
  position: absolute;
  z-index: 15;
  right: var(--map-overlay-gutter, 0.75rem);
  top: 4.5rem;
  display: grid;
  gap: 0.65rem;
  width: min(24rem, calc(100vw - 1.5rem));
  max-height: min(70vh, 42rem);
  padding: 0.8rem;
  overflow: auto;
  border: 1px solid color-mix(in srgb, var(--accent) 62%, var(--rule-strong));
  border-radius: 14px;
  background: color-mix(in srgb, var(--paper) 96%, transparent);
  color: var(--ink);
  pointer-events: auto;
}
header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
h2, p { margin: 0; }
.eyebrow { color: var(--accent); font-size: 0.68rem; font-weight: 900; text-transform: uppercase; }
.choices, .declarations { display: grid; gap: 0.55rem; }
fieldset { display: flex; flex-wrap: wrap; gap: 0.4rem; border: 1px solid var(--rule-soft); border-radius: 10px; }
button { padding: 0.4rem 0.6rem; border: 1px solid var(--rule-strong); border-radius: 999px; background: var(--paper-accent); color: var(--ink); cursor: pointer; }
button[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
button:disabled { cursor: not-allowed; opacity: 0.5; }
</style>
