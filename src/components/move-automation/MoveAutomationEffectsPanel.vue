<script setup lang="ts">
import type { CombatStageKey } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { MoveAutomationSuggestionKind } from '~/utils/moveAutomationTargetResolution'

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

  <MoveAutomationNotesPanel
    v-model:manual-note="manualNote"
    :script="script"
  />
</template>

