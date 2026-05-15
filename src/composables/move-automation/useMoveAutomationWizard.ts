import { computed, reactive, ref, watch } from 'vue'
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
} from '~/utils/moveAutomationMoves'
import {
  applyMoveAutomationAccuracyRoll,
  applyMoveAutomationDamageRoll,
  ensureMoveAutomationTargetResolution,
  resetMoveAutomationResolutionState,
  rollAllMoveAutomationTargets,
  syncMoveAutomationTargetResolutions,
} from '~/utils/moveAutomationResolution'
import { buildMoveAutomationTransaction } from '~/utils/moveAutomationTransaction'
import {
  moveAutomationMultiplierLabel,
  moveAutomationSuggestionKey,
  resolveMoveAutomationTargetDamageLoss,
  suggestionIsEnabled,
  type MoveAutomationSuggestionKind,
  type MoveAutomationTargetResolutionState,
} from '~/utils/moveAutomationTargetResolution'
import {
  appendMoveAutomationHazardCellText,
  canContinueMoveAutomationWizard,
  createMoveAutomationStageDeltaRecord,
  nextMoveAutomationWizardStep,
  previousMoveAutomationWizardStep,
} from '~/utils/moveAutomationWizardState'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { CombatStageKey } from '~/types/combatStages'
import type { MapFieldEffects } from '~/types/map'
import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerMove } from '~/types/trainerSheet'

export {
  createMoveAutomationStageDeltaRecord,
  MOVE_AUTOMATION_OVERLAY_TITLE_ID,
} from '~/utils/moveAutomationWizardState'

export interface MoveAutomationWizardProps {
  user: SpawnedPokemon
  moves: ReadonlyArray<CharacterSheetMove | TrainerMove>
  allTokens: readonly SpawnedPokemon[]
  fieldEffects?: MapFieldEffects
  canApplyMapEffects?: boolean
  initialMoveName?: string | null
}

export const useMoveAutomationWizard = (
  props: MoveAutomationWizardProps,
  emitApply: (transaction: MoveAutomationTransaction) => void,
) => {
  const search = ref('')
  const selectedMoveName = ref<string | null>(props.initialMoveName?.trim() || null)
  const step = ref(selectedMoveName.value ? 1 : 0)
  const targetIds = ref<string[]>([])
  const targetResolutions = reactive<Record<string, MoveAutomationTargetResolutionState>>({})
  const enabledSuggestions = reactive<Record<string, boolean>>({})
  const hpSuggestionAmounts = reactive<Record<string, string>>({})
  const manualUserConditions = ref<string[]>([])
  const manualTargetConditions = ref<string[]>([])
  const manualUserStageDeltas = reactive(createMoveAutomationStageDeltaRecord())
  const manualTargetStageDeltas = reactive(createMoveAutomationStageDeltaRecord())
  const hazardCellsText = ref('')
  const manualNote = ref('')

  const moveEntries = computed(() => buildMoveAutomationMoveEntries(props.moves, {
    stabTypes: props.user.sheetKind === 'pokemon' ? props.user.defenderTypes : [],
    combatSkillRankValue: props.user.combatSkillRankValue,
  }))
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

  watch(
    () => props.initialMoveName,
    (name) => {
      const next = name?.trim()
      if (!next) return
      selectedMoveName.value = next
      step.value = 1
    },
  )

  const suggestionKey = (kind: MoveAutomationSuggestionKind, index: number): string =>
    moveAutomationSuggestionKey(script.value, kind, index)

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

  const ensureTargetResolution = (id: string): MoveAutomationTargetResolutionState =>
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
    hazardCellsText.value = appendMoveAutomationHazardCellText(hazardCellsText.value, props.user.position)
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

  const canContinue = computed(() => canContinueMoveAutomationWizard({
    step: step.value,
    hasSelectedMove: Boolean(selectedEntry.value),
    requiresTargets: requiresTargets.value,
    selectedTargetCount: selectedTargets.value.length,
  }))

  const nextStep = () => {
    step.value = nextMoveAutomationWizardStep(step.value, canContinue.value)
  }

  const previousStep = () => {
    step.value = previousMoveAutomationWizardStep(step.value)
  }

  const selectMove = (name: string) => {
    selectedMoveName.value = name
    step.value = 1
  }

  const apply = () => emitApply(transaction.value)

  return {
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
  }
}
