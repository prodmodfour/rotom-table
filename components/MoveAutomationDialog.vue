<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { findMove } from '~/data/ptuReference'
import {
  buildManualMoveResolution,
  explicitScriptForMove,
  rollDamageFormula,
  sheetMoveToMoveLike,
  damageFormulaForMove,
  type MoveAutomationMoveLike,
} from '~/utils/moveAutomation'
import { COMBAT_STAGE_KEYS, COMBAT_STAGE_SHORT_LABELS } from '~/utils/combatStages'
import {
  parseHazardCellText,
  stageDeltaLabel,
} from '~/utils/moveAutomationDialog'
import {
  buildMoveAutomationTransaction,
  moveAutomationMultiplierLabel,
  moveAutomationSuggestionKey,
  resolveHpSuggestionAmount,
  resolveMoveAutomationTargetDamageLoss,
  suggestionIsEnabled,
  type MoveAutomationTargetResolutionState,
  type MoveAutomationSuggestionKind,
} from '~/utils/moveAutomationTransaction'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { CombatStageKey } from '~/types/combatStages'
import type { MapFieldEffects } from '~/types/map'
import type { MoveAutomationScript, MoveAutomationTransaction } from '~/types/moveAutomation'
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

interface MoveEntry {
  label: string
  sheetMove: CharacterSheetMove | TrainerMove
  move: MoveAutomationMoveLike
  script: MoveAutomationScript
  hasExplicitScript: boolean
}

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

const mergeMoveLike = (sheetMove: CharacterSheetMove | TrainerMove): MoveAutomationMoveLike => {
  const canonical = findMove(sheetMove.name)
  if (canonical) return canonical
  return sheetMoveToMoveLike(sheetMove)
}

const moveEntries = computed<MoveEntry[]>(() =>
  props.moves
    .filter((move) => move.name?.trim())
    .map((sheetMove) => {
      const move = mergeMoveLike(sheetMove)
      const explicitScript = explicitScriptForMove(move.name)
      return {
        label: move.name,
        sheetMove,
        move,
        script: explicitScript ?? buildManualMoveResolution(move),
        hasExplicitScript: Boolean(explicitScript),
      }
    }),
)

const filteredMoveEntries = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return moveEntries.value
  return moveEntries.value.filter((entry) => {
    const s = entry.script
    return [s.moveName, s.type, s.damageClass ?? '', entry.move.frequency ?? '', s.range, s.effect]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })
})

const selectedEntry = computed(() =>
  moveEntries.value.find((entry) => entry.move.name === selectedMoveName.value) ?? moveEntries.value[0] ?? null,
)
const script = computed(() => selectedEntry.value?.script ?? null)
const targetOptions = computed(() =>
  [...props.allTokens].sort((a, b) => a.species.localeCompare(b.species)),
)
const selectedTargets = computed(() =>
  targetIds.value
    .map((id) => props.allTokens.find((token) => token.id === id))
    .filter((token): token is SpawnedPokemon => Boolean(token)),
)
const requiresTargets = computed(() => {
  const mode = script.value?.targetMode
  return mode === 'one-target' || mode === 'multi-target'
})
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
  targetIds.value = []
  for (const key of Object.keys(targetResolutions)) delete targetResolutions[key]
  for (const key of Object.keys(enabledSuggestions)) delete enabledSuggestions[key]
  for (const key of Object.keys(hpSuggestionAmounts)) delete hpSuggestionAmounts[key]
  manualUserConditions.value = []
  manualTargetConditions.value = []
  hazardCellsText.value = ''
  manualNote.value = ''
  for (const key of COMBAT_STAGE_KEYS) {
    manualUserStageDeltas[key] = 0
    manualTargetStageDeltas[key] = 0
  }

  const s = script.value
  if (!s) return
  if (s.targetMode === 'self') targetIds.value = [props.user.id]

  s.conditionSuggestions.forEach((item, index) => {
    enabledSuggestions[suggestionKey('condition', index)] = !item.optional
  })
  s.stageSuggestions.forEach((item, index) => {
    enabledSuggestions[suggestionKey('stage', index)] = !item.optional
  })
  s.hpSuggestions.forEach((item, index) => {
    enabledSuggestions[suggestionKey('hp', index)] = !item.optional
  })
  s.fieldSuggestions.forEach((item, index) => {
    enabledSuggestions[suggestionKey('field', index)] = !item.optional
  })
  s.hazardSuggestions.forEach((item, index) => {
    enabledSuggestions[suggestionKey('hazard', index)] = !item.optional
  })
}

watch(() => selectedMoveName.value, resetResolutionState)
watch(script, resetResolutionState)

const ensureTargetResolution = (id: string): TargetResolutionState => {
  if (!targetResolutions[id]) {
    targetResolutions[id] = {
      accuracyRoll: '',
      hit: !script.value?.requiresAccuracy,
      crit: false,
      damageRoll: null,
      manualHpLoss: '',
      applyDamage: Boolean(script.value?.damaging),
    }
  }
  return targetResolutions[id]
}

watch(
  targetIds,
  (ids) => {
    for (const id of ids) ensureTargetResolution(id)
    for (const id of Object.keys(targetResolutions)) {
      if (!ids.includes(id)) delete targetResolutions[id]
    }
  },
  { deep: true },
)

const toggleTarget = (id: string) => {
  const s = script.value
  if (!s) return
  if (s.targetCount === 1 || s.targetMode === 'one-target') {
    targetIds.value = targetIds.value[0] === id ? [] : [id]
    return
  }
  const next = new Set(targetIds.value)
  if (next.has(id)) next.delete(id)
  else {
    if (s.targetCount != null && next.size >= s.targetCount) return
    next.add(id)
  }
  targetIds.value = Array.from(next)
}

const randomD20 = (): number => 1 + Math.floor(Math.random() * 20)

const rollAccuracy = (id: string) => {
  const state = ensureTargetResolution(id)
  const roll = randomD20()
  state.accuracyRoll = String(roll)
  const ac = script.value?.ac
  state.hit = ac == null ? true : roll >= ac
  if (script.value?.criticalRange && roll >= script.value.criticalRange) state.crit = true
}

const rollDamage = (id: string) => {
  const formula = selectedMoveFormula.value
  if (!formula) return
  const result = rollDamageFormula(formula)
  if (!result) return
  ensureTargetResolution(id).damageRoll = result
}

const rollAll = () => {
  for (const id of targetIds.value) {
    if (script.value?.requiresAccuracy) rollAccuracy(id)
    if (script.value?.damaging) rollDamage(id)
  }
}

const targetDamageLoss = (target: SpawnedPokemon): number =>
  resolveMoveAutomationTargetDamageLoss(script.value, props.user, target, ensureTargetResolution(target.id), props.fieldEffects)

const multiplierLabel = (target: SpawnedPokemon): string => moveAutomationMultiplierLabel(script.value, target)

const suggestionEnabled = (kind: MoveAutomationSuggestionKind, index: number): boolean =>
  suggestionIsEnabled(script.value, enabledSuggestions, kind, index)
const setSuggestionEnabled = (kind: MoveAutomationSuggestionKind, index: number, value: boolean) => {
  enabledSuggestions[suggestionKey(kind, index)] = value
}

const hpSuggestionAmount = (index: number, token: SpawnedPokemon): number =>
  resolveHpSuggestionAmount(script.value, hpSuggestionAmounts, index, token)

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

      <div class="move-automation__steps" aria-label="Move wizard steps">
        <span :class="['move-automation__step', { 'is-active': step === 0 }]">1. Pick</span>
        <span :class="['move-automation__step', { 'is-active': step === 1 }]">2. Resolve</span>
        <span :class="['move-automation__step', { 'is-active': step === 2 }]">3. Review</span>
      </div>

      <div v-if="!moveEntries.length" class="move-automation__empty">
        This sheet has no moves in its movelist.
      </div>

      <template v-else>
        <div v-if="step === 0" class="move-automation__pick">
          <label class="move-automation__search">
            <span class="sr-only">Search moves</span>
            <input v-model.trim="search" type="search" placeholder="Search this move list…" />
          </label>

          <div class="move-automation__move-list">
            <button
              v-for="entry in filteredMoveEntries"
              :key="entry.move.name"
              type="button"
              class="move-card"
              :class="{ 'is-selected': selectedEntry?.move.name === entry.move.name }"
              @click="selectMove(entry.move.name)"
            >
              <span class="move-card__title">{{ entry.move.name }}</span>
              <span class="move-card__pills">
                <TypeBadge v-if="entry.script.type" :type="entry.script.type" size="xs" />
                <DamageClassBadge v-if="entry.script.damageClass" :category="entry.script.damageClass" size="xs" />
                <span v-if="entry.script.damageBase != null" class="move-card__badge">DB {{ entry.script.damageBase }}</span>
                <span v-if="entry.script.ac != null" class="move-card__badge">AC {{ entry.script.ac }}</span>
                <span v-if="entry.move.frequency" class="move-card__badge">{{ entry.move.frequency }}</span>
                <span
                  class="move-card__badge"
                  :class="entry.hasExplicitScript ? 'move-card__badge--explicit' : 'move-card__badge--manual'"
                >{{ entry.hasExplicitScript ? 'Scripted' : 'Manual fallback' }}</span>
              </span>
              <span v-if="entry.script.range" class="move-card__range">{{ entry.script.range }}</span>
            </button>
          </div>
        </div>

        <div v-else-if="step === 1 && script" class="move-automation__resolve">
          <aside class="move-summary">
            <div class="move-summary__heading">
              <h3>{{ script.moveName }}</h3>
              <div class="move-summary__pills">
                <TypeBadge :type="script.type" size="xs" />
                <DamageClassBadge v-if="script.damageClass" :category="script.damageClass" size="xs" />
                <span v-if="script.damageBase != null" class="move-card__badge">DB {{ script.damageBase }}</span>
                <span v-if="script.ac != null" class="move-card__badge">AC {{ script.ac }}</span>
              </div>
            </div>
            <dl class="move-summary__stats">
              <div v-if="selectedEntry?.move.frequency"><dt>Frequency</dt><dd>{{ selectedEntry.move.frequency }}</dd></div>
              <div v-if="selectedMoveFormula"><dt>Damage Roll</dt><dd>{{ selectedMoveFormula }}</dd></div>
              <div v-if="script.range"><dt>Range</dt><dd>{{ script.range }}</dd></div>
              <div v-if="script.criticalRange"><dt>Crit</dt><dd>{{ script.criticalRange }}+</dd></div>
            </dl>
            <div v-if="script.kind === 'manual-fallback'" class="manual-fallback-warning">
              <strong>No explicit automation script exists for this move yet.</strong>
              <span>This wizard is only a manual resolver. It does not count as move automation coverage.</span>
            </div>
            <div v-else class="explicit-script-banner">
              Explicit reviewed script v{{ script.version }}.
            </div>
            <p v-if="script.effect" class="move-summary__effect">{{ script.effect }}</p>
            <p v-else class="move-summary__effect is-muted">No effect text in moves.json.</p>
          </aside>

          <main class="move-resolution">
            <section v-if="requiresTargets" class="move-resolution__section">
              <header class="move-resolution__section-header">
                <h3>Targets</h3>
                <span v-if="script.targetCount">Choose {{ script.targetCount }}</span>
                <span v-else>Choose all affected tokens</span>
              </header>
              <div class="target-grid">
                <button
                  v-for="token in targetOptions"
                  :key="token.id"
                  type="button"
                  class="target-chip"
                  :class="{ 'is-selected': targetIds.includes(token.id), 'is-user': token.id === user.id }"
                  @click="toggleTarget(token.id)"
                >
                  <strong>{{ token.species }}</strong>
                  <span>{{ token.currentHp }}/{{ token.maxHp }} HP</span>
                </button>
              </div>
            </section>

            <section v-if="script.requiresAccuracy || script.damaging" class="move-resolution__section">
              <header class="move-resolution__section-header">
                <h3>Accuracy & damage</h3>
                <button type="button" class="mini-button" @click="rollAll">Roll all</button>
              </header>
              <p v-if="!selectedTargets.length && requiresTargets" class="move-resolution__hint">Choose targets first.</p>
              <div v-for="target in selectedTargets" :key="target.id" class="target-resolution">
                <header>
                  <strong>{{ target.species }}</strong>
                  <span>{{ target.currentHp }}/{{ target.maxHp }} HP</span>
                </header>
                <div v-if="script.requiresAccuracy" class="target-resolution__row">
                  <label>
                    <span>Accuracy d20</span>
                    <input v-model="ensureTargetResolution(target.id).accuracyRoll" type="number" min="1" max="20" />
                  </label>
                  <button type="button" class="mini-button" @click="rollAccuracy(target.id)">Roll</button>
                  <label class="inline-check"><input v-model="ensureTargetResolution(target.id).hit" type="checkbox" /> Hit</label>
                  <label class="inline-check"><input v-model="ensureTargetResolution(target.id).crit" type="checkbox" /> Crit</label>
                </div>
                <div v-if="script.damaging" class="target-resolution__row">
                  <button type="button" class="mini-button" :disabled="!selectedMoveFormula" @click="rollDamage(target.id)">Roll damage</button>
                  <span v-if="ensureTargetResolution(target.id).damageRoll" class="roll-readout">
                    [{{ ensureTargetResolution(target.id).damageRoll?.rolls.join(', ') }}] + {{ ensureTargetResolution(target.id).damageRoll?.mod }} =
                    <strong>{{ ensureTargetResolution(target.id).damageRoll?.total }}</strong>
                  </span>
                  <label class="inline-check"><input v-model="ensureTargetResolution(target.id).applyDamage" type="checkbox" /> Apply damage</label>
                </div>
                <div v-if="script.damaging" class="target-resolution__row">
                  <label>
                    <span>Final HP loss override</span>
                    <input v-model="ensureTargetResolution(target.id).manualHpLoss" type="number" min="0" placeholder="auto" />
                  </label>
                  <span class="damage-preview">
                    ×{{ multiplierLabel(target) }} → {{ targetDamageLoss(target) }} HP lost
                  </span>
                </div>
              </div>
            </section>

            <section class="move-resolution__section">
              <header class="move-resolution__section-header"><h3>Conditions</h3></header>
              <label
                v-for="(item, index) in script.conditionSuggestions"
                :key="`condition-${index}`"
                class="effect-toggle"
              >
                <input :checked="suggestionEnabled('condition', index)" type="checkbox" @change="setSuggestionEnabled('condition', index, ($event.target as HTMLInputElement).checked)" />
                <span>
                  {{ item.recipient === 'user' ? 'User' : 'Target' }}:
                  {{ item.action === 'remove' ? 'Remove ' : '' }}{{ item.label }}
                </span>
                <small v-if="item.threshold">{{ item.threshold }}</small>
              </label>
              <details class="manual-details">
                <summary>Manual condition additions</summary>
                <div class="manual-condition-grid">
                  <div>
                    <h4>User</h4>
                    <ConditionPicker v-model="manualUserConditions" compact tag-size="xs" />
                  </div>
                  <div>
                    <h4>Selected target(s)</h4>
                    <ConditionPicker v-model="manualTargetConditions" compact tag-size="xs" />
                  </div>
                </div>
              </details>
            </section>

            <section class="move-resolution__section">
              <header class="move-resolution__section-header"><h3>Combat stages</h3></header>
              <label
                v-for="(item, index) in script.stageSuggestions"
                :key="`stage-${index}`"
                class="effect-toggle"
              >
                <input :checked="suggestionEnabled('stage', index)" type="checkbox" @change="setSuggestionEnabled('stage', index, ($event.target as HTMLInputElement).checked)" />
                <span>{{ item.recipient === 'user' ? 'User' : 'Target' }}: {{ item.label }}</span>
                <small v-if="item.threshold">{{ item.threshold }}</small>
              </label>
              <details class="manual-details">
                <summary>Manual stage deltas</summary>
                <div class="stage-delta-grid">
                  <div>
                    <h4>User</h4>
                    <label v-for="key in COMBAT_STAGE_KEYS" :key="`user-${key}`">
                      <span>{{ COMBAT_STAGE_SHORT_LABELS[key] }}</span>
                      <input v-model.number="manualUserStageDeltas[key]" type="number" min="-6" max="6" />
                    </label>
                  </div>
                  <div>
                    <h4>Selected target(s)</h4>
                    <label v-for="key in COMBAT_STAGE_KEYS" :key="`target-${key}`">
                      <span>{{ COMBAT_STAGE_SHORT_LABELS[key] }}</span>
                      <input v-model.number="manualTargetStageDeltas[key]" type="number" min="-6" max="6" />
                    </label>
                  </div>
                </div>
              </details>
            </section>

            <section v-if="script.hpSuggestions.length" class="move-resolution__section">
              <header class="move-resolution__section-header"><h3>HP effects</h3></header>
              <label v-for="(item, index) in script.hpSuggestions" :key="`hp-${index}`" class="effect-toggle effect-toggle--with-input">
                <input :checked="suggestionEnabled('hp', index)" type="checkbox" @change="setSuggestionEnabled('hp', index, ($event.target as HTMLInputElement).checked)" />
                <span>{{ item.recipient === 'user' ? 'User' : 'Target' }}: {{ item.label }}</span>
                <input v-model="hpSuggestionAmounts[suggestionKey('hp', index)]" type="number" min="0" placeholder="auto" />
              </label>
            </section>

            <section v-if="script.fieldSuggestions.length || script.hazardSuggestions.length" class="move-resolution__section">
              <header class="move-resolution__section-header"><h3>Map effects</h3></header>
              <p v-if="!canApplyMapEffects" class="move-resolution__hint">Only the GM can persist map-level field effects and hazards.</p>
              <label v-for="(item, index) in script.fieldSuggestions" :key="`field-${index}`" class="effect-toggle">
                <input :checked="suggestionEnabled('field', index)" type="checkbox" :disabled="!canApplyMapEffects" @change="setSuggestionEnabled('field', index, ($event.target as HTMLInputElement).checked)" />
                <span>{{ item.label }}</span>
              </label>
              <label v-for="(item, index) in script.hazardSuggestions" :key="`hazard-${index}`" class="effect-toggle">
                <input :checked="suggestionEnabled('hazard', index)" type="checkbox" :disabled="!canApplyMapEffects" @change="setSuggestionEnabled('hazard', index, ($event.target as HTMLInputElement).checked)" />
                <span>{{ item.label }}</span>
              </label>
              <div v-if="script.hazardSuggestions.length" class="hazard-cell-input">
                <div class="move-resolution__section-header">
                  <span>Hazard cells</span>
                  <button type="button" class="mini-button" @click="addUserCellToHazardText">Add user cell</button>
                </div>
                <textarea v-model="hazardCellsText" :disabled="!canApplyMapEffects" rows="4" placeholder="x,y,z per line (or x,z using user's elevation)" />
              </div>
            </section>

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
          </main>
        </div>

        <div v-else-if="step === 2" class="move-automation__review">
          <h3>Transaction preview</h3>
          <div v-if="transaction.scriptKind === 'manual-fallback'" class="manual-fallback-warning manual-fallback-warning--review">
            <strong>Manual fallback transaction.</strong>
            <span>Review carefully; this was not produced by an explicit per-move script.</span>
          </div>
          <div class="review-grid">
            <section>
              <h4>HP</h4>
              <p v-if="!transaction.hpUpdates.length" class="muted">No HP changes.</p>
              <ul v-else>
                <li v-for="update in transaction.hpUpdates" :key="`hp-${update.id}`">
                  {{ allTokens.find((token) => token.id === update.id)?.species ?? update.id }} → {{ update.currentHp }} HP
                </li>
              </ul>
            </section>
            <section>
              <h4>Conditions</h4>
              <p v-if="!transaction.conditionUpdates.length" class="muted">No condition changes.</p>
              <ul v-else>
                <li v-for="update in transaction.conditionUpdates" :key="`cond-${update.id}`">
                  {{ allTokens.find((token) => token.id === update.id)?.species ?? update.id }}: {{ update.conditions.join(', ') || 'none' }}
                </li>
              </ul>
            </section>
            <section>
              <h4>Combat stages</h4>
              <p v-if="!transaction.combatStageUpdates.length" class="muted">No combat stage changes.</p>
              <ul v-else>
                <li v-for="update in transaction.combatStageUpdates" :key="`stage-${update.id}`">
                  {{ allTokens.find((token) => token.id === update.id)?.species ?? update.id }}:
                  <span v-for="key in COMBAT_STAGE_KEYS" :key="key">
                    {{ COMBAT_STAGE_SHORT_LABELS[key] }} {{ stageDeltaLabel(update.stages[key]) }}
                  </span>
                </li>
              </ul>
            </section>
            <section>
              <h4>Map</h4>
              <p v-if="!transaction.hazardsToAdd.length && !transaction.fieldEffectsToApply.length" class="muted">No map effects.</p>
              <ul v-else>
                <li v-for="effect in transaction.fieldEffectsToApply" :key="`${effect.kind}-${effect.value}`">{{ effect.kind }}: {{ effect.value }}</li>
                <li v-for="(hazard, index) in transaction.hazardsToAdd" :key="`hazard-${index}`">{{ hazard.kind }} at {{ hazard.x }},{{ hazard.y }},{{ hazard.z }}</li>
              </ul>
            </section>
          </div>
          <section class="review-log">
            <h4>Log</h4>
            <ul>
              <li v-for="line in transaction.logLines" :key="line">{{ line }}</li>
            </ul>
          </section>
        </div>
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
.move-automation__footer,
.move-automation__steps {
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

.move-automation__header h2,
.move-summary h3,
.move-resolution__section h3,
.move-automation__review h3,
.review-grid h4,
.review-log h4 {
  margin: 0;
}

.move-automation__close,
.move-automation__button,
.mini-button {
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

.move-automation__button,
.mini-button {
  padding: 0.55rem 0.85rem;
  font-weight: 700;
}

.move-automation__button--primary {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 18%, var(--paper));
  color: var(--ink-bright);
}

.move-automation__button:disabled,
.mini-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.move-automation__step {
  padding: 0.35rem 0.6rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  color: var(--ink-muted);
  font-size: 0.78rem;
  font-weight: 800;
}

.move-automation__step.is-active {
  border-color: var(--accent);
  color: var(--ink-bright);
}

.move-automation__pick,
.move-automation__resolve,
.move-automation__review,
.move-automation__empty {
  min-height: 0;
  overflow: auto;
  padding: 1rem;
}

.move-automation__search input,
.move-resolution input,
.move-resolution textarea,
.hazard-cell-input textarea {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.65rem;
  font: inherit;
}

.move-automation__move-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.55rem;
  margin-top: 0.8rem;
}

.move-card,
.target-chip,
.move-resolution__section,
.move-summary,
.review-grid section,
.review-log {
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper);
}

.move-card {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.75rem;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
}

.move-card.is-selected,
.target-chip.is-selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.16);
}

.move-card__title {
  color: var(--ink-bright);
  font-weight: 900;
}

.move-card__pills,
.move-summary__pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
}

.move-card__badge {
  display: inline-flex;
  align-items: center;
  min-height: 1.35rem;
  padding: 0.12rem 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
}

.move-card__badge--explicit {
  border-color: color-mix(in srgb, #b8bb26 55%, var(--rule-soft));
  color: #b8bb26;
}

.move-card__badge--manual {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--rule-soft));
  color: var(--accent);
}

.manual-fallback-warning,
.explicit-script-banner {
  display: grid;
  gap: 0.2rem;
  margin: 0.7rem 0;
  padding: 0.65rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--rule-soft));
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 10%, var(--paper));
  color: var(--ink);
  font-size: 0.84rem;
}

.explicit-script-banner {
  border-color: color-mix(in srgb, #b8bb26 45%, var(--rule-soft));
  background: color-mix(in srgb, #b8bb26 9%, var(--paper));
  color: #b8bb26;
  font-weight: 800;
}

.manual-fallback-warning--review {
  margin-top: 0;
}

.move-card__range,
.move-summary__effect,
.move-resolution__hint,
.muted {
  color: var(--ink-muted);
  font-size: 0.84rem;
}

.move-automation__resolve {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  gap: 0.8rem;
}

.move-summary,
.move-resolution__section,
.review-grid section,
.review-log {
  padding: 0.85rem;
}

.move-summary__heading,
.move-resolution__section-header,
.target-resolution header {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: center;
}

.move-summary__stats {
  display: grid;
  gap: 0.35rem;
  margin: 0.7rem 0;
}

.move-summary__stats div {
  display: grid;
  grid-template-columns: 6rem minmax(0, 1fr);
  gap: 0.45rem;
}

.move-summary__stats dt {
  color: var(--ink-muted);
  font-size: 0.74rem;
  font-weight: 800;
  text-transform: uppercase;
}

.move-summary__stats dd {
  margin: 0;
}

.move-resolution {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.target-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.6rem;
}

.target-chip {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 9rem;
  padding: 0.55rem 0.65rem;
  color: var(--ink);
  cursor: pointer;
}

.target-chip.is-user {
  border-style: dashed;
}

.target-resolution {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.55rem;
  padding-top: 0.55rem;
  border-top: 1px solid var(--rule-soft);
}

.target-resolution__row,
.effect-toggle,
.stage-delta-grid label {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.target-resolution__row label:not(.inline-check) {
  display: grid;
  gap: 0.15rem;
  min-width: 8rem;
}

.target-resolution__row input[type='number'] {
  max-width: 8rem;
}

.inline-check,
.effect-toggle {
  color: var(--ink);
}

.roll-readout,
.damage-preview {
  color: var(--ink-bright);
  font-variant-numeric: tabular-nums;
}

.effect-toggle {
  padding: 0.35rem 0;
}

.effect-toggle small {
  color: var(--accent);
  font-weight: 800;
}

.effect-toggle--with-input input[type='number'] {
  max-width: 7rem;
  margin-left: auto;
}

.manual-details {
  margin-top: 0.6rem;
  border-top: 1px solid var(--rule-soft);
  padding-top: 0.6rem;
}

.manual-details summary {
  cursor: pointer;
  color: var(--ink-bright);
  font-weight: 800;
}

.manual-condition-grid,
.stage-delta-grid,
.review-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.8rem;
  margin-top: 0.65rem;
}

.stage-delta-grid label {
  justify-content: space-between;
  margin-top: 0.3rem;
}

.stage-delta-grid input {
  max-width: 5rem;
}

.hazard-cell-input {
  margin-top: 0.6rem;
}

.is-warning {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--rule-soft));
}

.review-grid {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.review-grid ul,
.review-log ul,
.is-warning ul {
  margin: 0.45rem 0 0;
  padding-left: 1.1rem;
}

@media (max-width: 760px) {
  .move-automation__resolve,
  .manual-condition-grid,
  .stage-delta-grid {
    grid-template-columns: 1fr;
  }
}
</style>
