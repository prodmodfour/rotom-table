<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
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
  <div class="move-automation-backdrop" @pointerdown.self="emit('close')" @contextmenu.prevent>
    <section class="move-automation" role="dialog" aria-modal="true" :aria-labelledby="overlayTitleId" @pointerdown.stop>
      <header class="move-automation__header">
        <div>
          <p class="move-automation__eyebrow">Use Move</p>
          <h2 :id="overlayTitleId">{{ user.species }}</h2>
        </div>
        <button type="button" class="move-automation__close" aria-label="Close" @click="emit('close')">×</button>
      </header>

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

      <footer class="move-automation__footer">
        <button type="button" class="move-automation__button move-automation__button--ghost" @click="emit('close')">Cancel</button>
        <button v-if="step > 0" type="button" class="move-automation__button move-automation__button--ghost" @click="previousStep">Back</button>
        <button v-if="step < 2" type="button" class="move-automation__button move-automation__button--primary" :disabled="!canContinue" @click="nextStep">Next</button>
        <button v-else type="button" class="move-automation__button move-automation__button--primary" @click="apply">Apply transaction</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.move-automation-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(29, 32, 33, 0.56);
  backdrop-filter: blur(3px);
}

.move-automation {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  width: min(1120px, 96vw);
  max-height: min(92vh, 980px);
  overflow: hidden;
  border: 1px solid var(--rule-soft);
  border-radius: 18px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  color: var(--ink);
}

.move-automation__header,
.move-automation__footer {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--rule-soft);
}

.move-automation__header {
  justify-content: space-between;
}

.move-automation__footer {
  justify-content: flex-end;
  border-top: 1px solid var(--rule-soft);
  border-bottom: 0;
}

.move-automation__eyebrow {
  margin: 0 0 0.1rem;
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.move-automation__header h2 {
  margin: 0;
}

.move-automation__close,
.move-automation__button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
}

.move-automation__close {
  width: 2.1rem;
  height: 2.1rem;
  font-size: 1.4rem;
  line-height: 1;
}

.move-automation__button {
  padding: 0.55rem 0.85rem;
  font-weight: 700;
}

.move-automation__button--primary {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, var(--paper));
  color: var(--ink-bright);
}

.move-automation__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}


.move-automation__empty {
  min-height: 0;
  overflow: auto;
  padding: 1rem;
}
</style>
