<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import MoveAutomationDialogFooter from '~/components/move-automation/MoveAutomationDialogFooter.vue'
import MoveAutomationDialogHeader from '~/components/move-automation/MoveAutomationDialogHeader.vue'
import MoveAutomationDialogShell from '~/components/move-automation/MoveAutomationDialogShell.vue'
import MoveAutomationStepIndicator from '~/components/move-automation/MoveAutomationStepIndicator.vue'
import { damageFormulaForMove } from '~/utils/moveAutomation'
import { parseHazardCellText } from '~/utils/moveAutomationDialog'
import {
  buildMoveAutomationMoveEntries,
  filterMoveAutomationMoveEntries,
  moveAutomationRequiresTargets,
  selectedMoveAutomationTargets,
  selectMoveAutomationEntry,
  sortMoveAutomationTargets,
  toggleMoveAutomationTargetIds,
  type MoveAutomationMoveEntry,
} from '~/utils/moveAutomationMoves'
import {
  applyMoveAutomationAccuracyRoll,
  applyMoveAutomationDamageRoll,
  ensureMoveAutomationTargetResolution,
  resetMoveAutomationResolutionState,
  rollAllMoveAutomationTargets,
  syncMoveAutomationTargetResolutions,
} from '~/utils/moveAutomationResolution'
import {
  buildMoveAutomationTransaction,
  moveAutomationMultiplierLabel,
  moveAutomationSuggestionKey,
  resolveMoveAutomationTargetDamageLoss,
  suggestionIsEnabled,
  type MoveAutomationTargetResolutionState,
  type MoveAutomationSuggestionKind,
} from '~/utils/moveAutomationTransaction'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { CombatStageKey } from '~/types/combatStages'
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

type TargetResolutionState = MoveAutomationTargetResolutionState

const search = ref('')
const selectedMoveName = ref<string | null>(null)
const step = ref(0)
const targetIds = ref<string[]>([])
const targetResolutions = reactive<Record<string, TargetResolutionState>>({})
const enabledSuggestions = reactive<Record<string, boolean>>({})
const hpSuggestionAmounts = reactive<Record<string, string>>({})
const manualUserConditions = ref<string[]>([])
const manualTargetConditions = ref<string[]>([])
const manualUserStageDeltas = reactive<Record<CombatStageKey, number>>({ atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 })
const manualTargetStageDeltas = reactive<Record<CombatStageKey, number>>({ atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 })
const hazardCellsText = ref('')
const manualNote = ref('')

const overlayTitleId = 'move-automation-title'

const moveEntries = computed<MoveAutomationMoveEntry[]>(() => buildMoveAutomationMoveEntries(props.moves))
const filteredMoveEntries = computed(() => filterMoveAutomationMoveEntries(moveEntries.value, search.value))
const selectedEntry = computed(() => selectMoveAutomationEntry(moveEntries.value, selectedMoveName.value))
const script = computed(() => selectedEntry.value?.script ?? null)
const targetOptions = computed(() => sortMoveAutomationTargets(props.allTokens))
const selectedTargets = computed(() => selectedMoveAutomationTargets(targetIds.value, props.allTokens))
const requiresTargets = computed(() => moveAutomationRequiresTargets(script.value))
const selectedMoveFormula = computed(() => selectedEntry.value ? damageFormulaForMove(selectedEntry.value.move) : null)

watch(
  moveEntries,
  (entries) => {
    if (!entries.length) {
      selectedMoveName.value = null
      return
    }
    if (!selectedMoveName.value || !entries.some((entry) => entry.move.name === selectedMoveName.value)) {
      selectedMoveName.value = entries[0].move.name
    }
  },
  { immediate: true },
)

const suggestionKey = (kind: MoveAutomationSuggestionKind, index: number): string => moveAutomationSuggestionKey(script.value, kind, index)

const resetResolutionState = () => {
  step.value = 0
  targetIds.value = resetMoveAutomationResolutionState({
    script: script.value,
    userId: props.user.id,
    targetResolutions,
    enabledSuggestions,
    hpSuggestionAmounts,
    manualUserStageDeltas,
    manualTargetStageDeltas,
  })
  manualUserConditions.value = []
  manualTargetConditions.value = []
  hazardCellsText.value = ''
  manualNote.value = ''
}

watch(() => selectedMoveName.value, resetResolutionState)
watch(script, resetResolutionState)

const ensureTargetResolution = (id: string): TargetResolutionState =>
  ensureMoveAutomationTargetResolution(targetResolutions, id, script.value)

watch(
  targetIds,
  (ids) => syncMoveAutomationTargetResolutions(targetResolutions, ids, script.value),
  { deep: true },
)

const toggleTarget = (id: string) => {
  targetIds.value = toggleMoveAutomationTargetIds(targetIds.value, id, script.value)
}

const rollAccuracy = (id: string) => {
  applyMoveAutomationAccuracyRoll(targetResolutions, id, script.value)
}

const rollDamage = (id: string) => {
  applyMoveAutomationDamageRoll(targetResolutions, id, script.value, selectedMoveFormula.value)
}

const rollAll = () => {
  rollAllMoveAutomationTargets(targetIds.value, script.value, targetResolutions, selectedMoveFormula.value)
}

const targetDamageLoss = (target: SpawnedPokemon): number =>
  resolveMoveAutomationTargetDamageLoss(script.value, props.user, target, ensureTargetResolution(target.id), props.fieldEffects)

const multiplierLabel = (target: SpawnedPokemon): string => moveAutomationMultiplierLabel(script.value, target)

const suggestionEnabled = (kind: MoveAutomationSuggestionKind, index: number): boolean =>
  suggestionIsEnabled(script.value, enabledSuggestions, kind, index)
const setSuggestionEnabled = (kind: MoveAutomationSuggestionKind, index: number, value: boolean) => {
  enabledSuggestions[suggestionKey(kind, index)] = value
}

const setHpSuggestionAmount = (index: number, value: string) => {
  hpSuggestionAmounts[suggestionKey('hp', index)] = value
}

const setUserStageDelta = (key: CombatStageKey, value: number) => {
  manualUserStageDeltas[key] = value
}

const setTargetStageDelta = (key: CombatStageKey, value: number) => {
  manualTargetStageDeltas[key] = value
}

const parseHazardCells = () => parseHazardCellText(hazardCellsText.value, props.user.position.y)

const addUserCellToHazardText = () => {
  const line = `${props.user.position.x}, ${props.user.position.y}, ${props.user.position.z}`
  hazardCellsText.value = hazardCellsText.value.trim() ? `${hazardCellsText.value.trim()}\n${line}` : line
}

const buildTransaction = (): MoveAutomationTransaction => buildMoveAutomationTransaction({
  script: script.value,
  user: props.user,
  selectedTargets: selectedTargets.value,
  targetResolutions,
  enabledSuggestions,
  hpSuggestionAmounts,
  manualUserConditions: manualUserConditions.value,
  manualTargetConditions: manualTargetConditions.value,
  manualUserStageDeltas,
  manualTargetStageDeltas,
  hazardCells: parseHazardCells(),
  manualNote: manualNote.value,
  fieldEffects: props.fieldEffects,
})

const transaction = computed(buildTransaction)

const canContinue = computed(() => {
  if (step.value === 0) return Boolean(selectedEntry.value)
  if (step.value === 1 && requiresTargets.value) return selectedTargets.value.length > 0
  return true
})

const nextStep = () => {
  if (!canContinue.value) return
  step.value = Math.min(2, step.value + 1)
}
const previousStep = () => {
  step.value = Math.max(0, step.value - 1)
}
const selectMove = (name: string) => {
  selectedMoveName.value = name
  step.value = 1
}
const apply = () => emit('apply', transaction.value)

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
