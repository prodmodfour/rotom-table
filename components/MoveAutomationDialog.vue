<script setup lang="ts">
import MoveAutomationDialogFooter from '~/components/move-automation/MoveAutomationDialogFooter.vue'
import MoveAutomationDialogHeader from '~/components/move-automation/MoveAutomationDialogHeader.vue'
import MoveAutomationDialogShell from '~/components/move-automation/MoveAutomationDialogShell.vue'
import MoveAutomationStepIndicator from '~/components/move-automation/MoveAutomationStepIndicator.vue'
import {
  MOVE_AUTOMATION_OVERLAY_TITLE_ID,
  useMoveAutomationWizard,
} from '~/composables/move-automation/useMoveAutomationWizard'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { MapFieldEffects } from '~/types/map'
import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerMove } from '~/types/trainerSheet'

const props = defineProps<{
  user: SpawnedPokemon
  moves: Array<CharacterSheetMove | TrainerMove>
  allTokens: SpawnedPokemon[]
  fieldEffects?: MapFieldEffects
  canApplyMapEffects?: boolean
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'apply', transaction: MoveAutomationTransaction): void
}>()

const overlayTitleId = MOVE_AUTOMATION_OVERLAY_TITLE_ID

const {
  search,
  step,
  targetIds,
  hpSuggestionAmounts,
  manualUserConditions,
  manualTargetConditions,
  manualUserStageDeltas,
  manualTargetStageDeltas,
  hazardCellsText,
  manualNote,
  moveEntries,
  filteredMoveEntries,
  selectedEntry,
  script,
  targetOptions,
  selectedTargets,
  requiresTargets,
  selectedMoveFormula,
  transaction,
  canContinue,
  suggestionKey,
  ensureTargetResolution,
  toggleTarget,
  rollAccuracy,
  rollDamage,
  rollAll,
  targetDamageLoss,
  multiplierLabel,
  suggestionEnabled,
  setSuggestionEnabled,
  setHpSuggestionAmount,
  setUserStageDelta,
  setTargetStageDelta,
  addUserCellToHazardText,
  nextStep,
  previousStep,
  selectMove,
  apply,
} = useMoveAutomationWizard(props, (transaction) => emit('apply', transaction))
</script>

<template>
  <MoveAutomationDialogShell :title-id="overlayTitleId" @close="emit('close')">
    <MoveAutomationDialogHeader
      :title-id="overlayTitleId"
      :user-species="user.species"
      @close="emit('close')"
    />

    <MoveAutomationStepIndicator :active-step="step" />

    <div v-if="!moveEntries.length" class="move-automation__empty">
      This sheet has no moves in its movelist.
    </div>

    <template v-else>
      <MoveAutomationPickStep
        v-if="step === 0"
        v-model:search="search"
        :entries="filteredMoveEntries"
        :selected-move-name="selectedEntry?.move.name ?? null"
        @select-move="selectMove"
      />

      <MoveAutomationResolveStep
        v-else-if="step === 1 && script"
        v-model:manual-user-conditions="manualUserConditions"
        v-model:manual-target-conditions="manualTargetConditions"
        v-model:hazard-cells-text="hazardCellsText"
        v-model:manual-note="manualNote"
        :user="user"
        :script="script"
        :selected-entry="selectedEntry"
        :selected-move-formula="selectedMoveFormula"
        :target-options="targetOptions"
        :selected-targets="selectedTargets"
        :target-ids="targetIds"
        :requires-targets="requiresTargets"
        :can-apply-map-effects="canApplyMapEffects"
        :hp-suggestion-amounts="hpSuggestionAmounts"
        :manual-user-stage-deltas="manualUserStageDeltas"
        :manual-target-stage-deltas="manualTargetStageDeltas"
        :ensure-target-resolution="ensureTargetResolution"
        :target-damage-loss="targetDamageLoss"
        :multiplier-label="multiplierLabel"
        :suggestion-enabled="suggestionEnabled"
        :suggestion-key="suggestionKey"
        @toggle-target="toggleTarget"
        @roll-all="rollAll"
        @roll-accuracy="rollAccuracy"
        @roll-damage="rollDamage"
        @set-suggestion-enabled="setSuggestionEnabled"
        @set-hp-suggestion-amount="setHpSuggestionAmount"
        @set-user-stage-delta="setUserStageDelta"
        @set-target-stage-delta="setTargetStageDelta"
        @add-user-cell-to-hazard-text="addUserCellToHazardText"
      />

      <MoveAutomationReviewStep
        v-else-if="step === 2"
        :transaction="transaction"
        :all-tokens="allTokens"
      />
    </template>

    <MoveAutomationDialogFooter
      :step="step"
      :can-continue="canContinue"
      @close="emit('close')"
      @back="previousStep"
      @next="nextStep"
      @apply="apply"
    />
  </MoveAutomationDialogShell>
</template>

<style scoped>
.move-automation__empty {
  min-height: 0;
  overflow: auto;
  padding: 1rem;
}
</style>
