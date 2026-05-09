<script setup lang="ts">
import { COMBAT_STAGE_KEYS, COMBAT_STAGE_SHORT_LABELS } from '~/utils/combatStages'
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

const checkboxValue = (event: Event): boolean => (event.target as HTMLInputElement).checked
const inputValue = (event: Event): string => (event.target as HTMLInputElement | HTMLTextAreaElement).value
const numericValue = (event: Event): number => {
  const value = Number(inputValue(event))
  return Number.isFinite(value) ? value : 0
}
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

      <section class="move-resolution__section">
        <header class="move-resolution__section-header"><h3>Conditions</h3></header>
        <label
          v-for="(item, index) in script.conditionSuggestions"
          :key="`condition-${index}`"
          class="effect-toggle"
        >
          <input :checked="suggestionEnabled('condition', index)" type="checkbox" @change="emit('set-suggestion-enabled', 'condition', index, checkboxValue($event))" />
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
          <input :checked="suggestionEnabled('stage', index)" type="checkbox" @change="emit('set-suggestion-enabled', 'stage', index, checkboxValue($event))" />
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
                <input :value="manualUserStageDeltas[key]" type="number" min="-6" max="6" @input="emit('set-user-stage-delta', key, numericValue($event))" />
              </label>
            </div>
            <div>
              <h4>Selected target(s)</h4>
              <label v-for="key in COMBAT_STAGE_KEYS" :key="`target-${key}`">
                <span>{{ COMBAT_STAGE_SHORT_LABELS[key] }}</span>
                <input :value="manualTargetStageDeltas[key]" type="number" min="-6" max="6" @input="emit('set-target-stage-delta', key, numericValue($event))" />
              </label>
            </div>
          </div>
        </details>
      </section>

      <section v-if="script.hpSuggestions.length" class="move-resolution__section">
        <header class="move-resolution__section-header"><h3>HP effects</h3></header>
        <label v-for="(item, index) in script.hpSuggestions" :key="`hp-${index}`" class="effect-toggle effect-toggle--with-input">
          <input :checked="suggestionEnabled('hp', index)" type="checkbox" @change="emit('set-suggestion-enabled', 'hp', index, checkboxValue($event))" />
          <span>{{ item.recipient === 'user' ? 'User' : 'Target' }}: {{ item.label }}</span>
          <input :value="hpSuggestionAmounts[suggestionKey('hp', index)] ?? ''" type="number" min="0" placeholder="auto" @input="emit('set-hp-suggestion-amount', index, inputValue($event))" />
        </label>
      </section>

      <section v-if="script.fieldSuggestions.length || script.hazardSuggestions.length" class="move-resolution__section">
        <header class="move-resolution__section-header"><h3>Map effects</h3></header>
        <p v-if="!canApplyMapEffects" class="move-resolution__hint">Only the GM can persist map-level field effects and hazards.</p>
        <label v-for="(item, index) in script.fieldSuggestions" :key="`field-${index}`" class="effect-toggle">
          <input :checked="suggestionEnabled('field', index)" type="checkbox" :disabled="!canApplyMapEffects" @change="emit('set-suggestion-enabled', 'field', index, checkboxValue($event))" />
          <span>{{ item.label }}</span>
        </label>
        <label v-for="(item, index) in script.hazardSuggestions" :key="`hazard-${index}`" class="effect-toggle">
          <input :checked="suggestionEnabled('hazard', index)" type="checkbox" :disabled="!canApplyMapEffects" @change="emit('set-suggestion-enabled', 'hazard', index, checkboxValue($event))" />
          <span>{{ item.label }}</span>
        </label>
        <div v-if="script.hazardSuggestions.length" class="hazard-cell-input">
          <div class="move-resolution__section-header">
            <span>Hazard cells</span>
            <button type="button" class="mini-button" @click="emit('add-user-cell-to-hazard-text')">Add user cell</button>
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

.move-resolution__section {
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper);
}

.move-resolution__hint {
  color: var(--ink-muted);
  font-size: 0.84rem;
}

.move-resolution__section {
  padding: 0.85rem;
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

.move-resolution {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.effect-toggle,
.stage-delta-grid label {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.effect-toggle {
  padding: 0.35rem 0;
  color: var(--ink);
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
.stage-delta-grid {
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
