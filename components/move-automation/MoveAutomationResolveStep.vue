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
            @click="emit('toggle-target', token.id)"
          >
            <strong>{{ token.species }}</strong>
            <span>{{ token.currentHp }}/{{ token.maxHp }} HP</span>
          </button>
        </div>
      </section>

      <section v-if="script.requiresAccuracy || script.damaging" class="move-resolution__section">
        <header class="move-resolution__section-header">
          <h3>Accuracy & damage</h3>
          <button type="button" class="mini-button" @click="emit('roll-all')">Roll all</button>
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
            <button type="button" class="mini-button" @click="emit('roll-accuracy', target.id)">Roll</button>
            <label class="inline-check"><input v-model="ensureTargetResolution(target.id).hit" type="checkbox" /> Hit</label>
            <label class="inline-check"><input v-model="ensureTargetResolution(target.id).crit" type="checkbox" /> Crit</label>
          </div>
          <div v-if="script.damaging" class="target-resolution__row">
            <button type="button" class="mini-button" :disabled="!selectedMoveFormula" @click="emit('roll-damage', target.id)">Roll damage</button>
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

.mini-button,
.target-chip,
.move-resolution__section,
.move-summary {
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper);
}

.mini-button {
  padding: 0.55rem 0.85rem;
  border-radius: 10px;
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}

.mini-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.target-chip.is-selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.16);
}

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

.move-summary__effect,
.move-resolution__hint {
  color: var(--ink-muted);
  font-size: 0.84rem;
}

.move-summary,
.move-resolution__section {
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
