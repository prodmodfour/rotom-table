<script setup lang="ts">
import type { CombatStageKey } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { MoveAutomationSuggestionKind } from '~/utils/moveAutomationTransaction'

const manualUserConditions = defineModel<string[]>('manualUserConditions', { required: true })
const manualTargetConditions = defineModel<string[]>('manualTargetConditions', { required: true })
const hazardCellsText = defineModel<string>('hazardCellsText', { required: true })
const manualNote = defineModel<string>('manualNote', { required: true })

defineProps<{
  script: MoveAutomationScript
  canApplyMapEffects?: boolean
  hpSuggestionAmounts: Record<string, string>
  manualUserStageDeltas: Record<CombatStageKey, number>
  manualTargetStageDeltas: Record<CombatStageKey, number>
  suggestionEnabled: (kind: MoveAutomationSuggestionKind, index: number) => boolean
  suggestionKey: (kind: MoveAutomationSuggestionKind, index: number) => string
}>()

const emit = defineEmits<{
  (event: 'set-suggestion-enabled', kind: MoveAutomationSuggestionKind, index: number, value: boolean): void
  (event: 'set-hp-suggestion-amount', index: number, value: string): void
  (event: 'set-user-stage-delta', key: CombatStageKey, value: number): void
  (event: 'set-target-stage-delta', key: CombatStageKey, value: number): void
  (event: 'add-user-cell-to-hazard-text'): void
}>()

</script>

<template>
  <MoveAutomationStatusEffectsPanel
    v-model:manual-user-conditions="manualUserConditions"
    v-model:manual-target-conditions="manualTargetConditions"
    :script="script"
    :manual-user-stage-deltas="manualUserStageDeltas"
    :manual-target-stage-deltas="manualTargetStageDeltas"
    :suggestion-enabled="suggestionEnabled"
    @set-suggestion-enabled="(kind, index, value) => emit('set-suggestion-enabled', kind, index, value)"
    @set-user-stage-delta="(key, value) => emit('set-user-stage-delta', key, value)"
    @set-target-stage-delta="(key, value) => emit('set-target-stage-delta', key, value)"
  />

  <MoveAutomationHpMapEffectsPanel
    v-model:hazard-cells-text="hazardCellsText"
    :script="script"
    :can-apply-map-effects="canApplyMapEffects"
    :hp-suggestion-amounts="hpSuggestionAmounts"
    :suggestion-enabled="suggestionEnabled"
    :suggestion-key="suggestionKey"
    @set-suggestion-enabled="(kind, index, value) => emit('set-suggestion-enabled', kind, index, value)"
    @set-hp-suggestion-amount="(index, value) => emit('set-hp-suggestion-amount', index, value)"
    @add-user-cell-to-hazard-text="emit('add-user-cell-to-hazard-text')"
  />

  <section class="move-resolution__section">
    <header class="move-resolution__section-header"><h3>Manual note</h3></header>
    <textarea v-model="manualNote" rows="3" placeholder="Unique move text, GM ruling, ability/item modifiers…" />
  </section>

  <section v-if="script.automationNotes.length" class="move-resolution__section is-warning">
    <header class="move-resolution__section-header"><h3>Script notes</h3></header>
    <ul>
      <li v-for="note in script.automationNotes" :key="note">{{ note }}</li>
    </ul>
  </section>
</template>

<style scoped>
.move-resolution__section {
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper);
}

.move-resolution__section h3 {
  margin: 0;
}

.move-resolution__section-header {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: center;
}

.move-resolution__section textarea {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.65rem;
  font: inherit;
}

.is-warning {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--rule-soft));
}

.is-warning ul {
  margin: 0.45rem 0 0;
  padding-left: 1.1rem;
}
</style>
