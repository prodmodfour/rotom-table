<script setup lang="ts">
import type { CombatStageKey } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveAutomationMoveEntry } from '~/utils/moveAutomationMoves'
import type {
  MoveAutomationSuggestionKind,
  MoveAutomationTargetResolutionState,
} from '~/utils/moveAutomationTransaction'

const manualUserConditions = defineModel<string[]>('manualUserConditions', { required: true })
const manualTargetConditions = defineModel<string[]>('manualTargetConditions', { required: true })
const hazardCellsText = defineModel<string>('hazardCellsText', { required: true })
const manualNote = defineModel<string>('manualNote', { required: true })

const props = defineProps<{
  user: SpawnedPokemon
  script: MoveAutomationScript
  selectedEntry: MoveAutomationMoveEntry | null
  selectedMoveFormula: string | null
  targetOptions: SpawnedPokemon[]
  selectedTargets: SpawnedPokemon[]
  targetIds: string[]
  requiresTargets: boolean
  canApplyMapEffects?: boolean
  hpSuggestionAmounts: Record<string, string>
  manualUserStageDeltas: Record<CombatStageKey, number>
  manualTargetStageDeltas: Record<CombatStageKey, number>
  ensureTargetResolution: (id: string) => MoveAutomationTargetResolutionState
  targetDamageLoss: (target: SpawnedPokemon) => number
  multiplierLabel: (target: SpawnedPokemon) => string
  suggestionEnabled: (kind: MoveAutomationSuggestionKind, index: number) => boolean
  suggestionKey: (kind: MoveAutomationSuggestionKind, index: number) => string
}>()

const emit = defineEmits<{
  (event: 'toggle-target', id: string): void
  (event: 'roll-all'): void
  (event: 'roll-accuracy', id: string): void
  (event: 'roll-damage', id: string): void
  (event: 'set-suggestion-enabled', kind: MoveAutomationSuggestionKind, index: number, value: boolean): void
  (event: 'set-hp-suggestion-amount', index: number, value: string): void
  (event: 'set-user-stage-delta', key: CombatStageKey, value: number): void
  (event: 'set-target-stage-delta', key: CombatStageKey, value: number): void
  (event: 'add-user-cell-to-hazard-text'): void
}>()

</script>

<template>
  <div class="move-automation__resolve">
    <MoveAutomationSummaryPanel
      :script="script"
      :selected-entry="selectedEntry"
      :selected-move-formula="selectedMoveFormula"
    />

    <main class="move-resolution">
      <MoveAutomationTargetResolutionPanel
        :user="user"
        :script="script"
        :target-options="targetOptions"
        :selected-targets="selectedTargets"
        :target-ids="targetIds"
        :requires-targets="requiresTargets"
        :selected-move-formula="selectedMoveFormula"
        :ensure-target-resolution="ensureTargetResolution"
        :target-damage-loss="targetDamageLoss"
        :multiplier-label="multiplierLabel"
        @toggle-target="emit('toggle-target', $event)"
        @roll-all="emit('roll-all')"
        @roll-accuracy="emit('roll-accuracy', $event)"
        @roll-damage="emit('roll-damage', $event)"
      />

      <MoveAutomationEffectsPanel
        v-model:manual-user-conditions="manualUserConditions"
        v-model:manual-target-conditions="manualTargetConditions"
        v-model:hazard-cells-text="hazardCellsText"
        v-model:manual-note="manualNote"
        :script="script"
        :can-apply-map-effects="canApplyMapEffects"
        :hp-suggestion-amounts="hpSuggestionAmounts"
        :manual-user-stage-deltas="manualUserStageDeltas"
        :manual-target-stage-deltas="manualTargetStageDeltas"
        :suggestion-enabled="suggestionEnabled"
        :suggestion-key="suggestionKey"
        @set-suggestion-enabled="(kind, index, value) => emit('set-suggestion-enabled', kind, index, value)"
        @set-hp-suggestion-amount="(index, value) => emit('set-hp-suggestion-amount', index, value)"
        @set-user-stage-delta="(key, value) => emit('set-user-stage-delta', key, value)"
        @set-target-stage-delta="(key, value) => emit('set-target-stage-delta', key, value)"
        @add-user-cell-to-hazard-text="emit('add-user-cell-to-hazard-text')"
      />
    </main>
  </div>
</template>

<style scoped>
.move-automation__resolve {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  gap: 0.8rem;
  min-height: 0;
  overflow: auto;
  padding: 1rem;
}

.move-resolution {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

@media (max-width: 760px) {
  .move-automation__resolve {
    grid-template-columns: 1fr;
  }
}
</style>
