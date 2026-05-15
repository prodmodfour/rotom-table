<script setup lang="ts">
import {
  EVASION_BONUS_MAX,
  EVASION_BONUS_MIN,
  formatSignedModifier,
} from '~/utils/evasion'
import type { PokemonEvasionBonusKey } from '~/composables/sheets/usePokemonSheetRowActions'
import type { ConditionEffectSummary } from '~/utils/sheetConditionEffects'
import type { CharacterSheetCombat } from '~/types/characterSheet'

interface EvasionEntry {
  total: number
  base: number
  bonus: number
  abilityBonus: number
  suppressedByCondition?: string | null
}

interface PokemonEvasionSummary {
  vsAtk: EvasionEntry
  vsSatk: EvasionEntry
  vsAny: EvasionEntry & { itemBonus: number }
}

interface PokemonAccuracySummary {
  total: number
  stage: number
  conditionModifier: number
  itemBonus: number
}

defineProps<{
  combat: CharacterSheetCombat
  pokemonAccuracy: PokemonAccuracySummary
  pokemonEvasion: PokemonEvasionSummary
  conditionEffects: readonly ConditionEffectSummary[]
  availableMoves?: string[]
}>()

const emit = defineEmits<{
  setEvasionBonus: [key: PokemonEvasionBonusKey, value: number | undefined]
}>()
</script>

<template>
  <div class="evasion-row">
    <span class="cell-label">Evasion</span>
    <ul>
      <li title="Stat evasion = floor(Defense Total / 5), capped at +6 from stats. Sand Veil adds +1 if present, or +2 when activated from the Abilities table.">
        <span class="evasion-label">vs ATK</span>
        <strong>{{ pokemonEvasion.vsAtk.total }}</strong>
        <small>stat {{ pokemonEvasion.vsAtk.base }}</small>
        <span class="evasion-bonus">
          bonus
          <EditableCell
            :model-value="pokemonEvasion.vsAtk.bonus"
            type="number"
            :min="EVASION_BONUS_MIN"
            :max="EVASION_BONUS_MAX"
            :format="formatSignedModifier"
            @update:model-value="(v) => emit('setEvasionBonus', 'vsAtkBonus', v as number | undefined)"
          />
          <span
            v-if="pokemonEvasion.vsAtk.abilityBonus"
            class="evasion-bonus__ability"
            title="Sand Veil ability bonus"
          >
            Sand Veil {{ formatSignedModifier(pokemonEvasion.vsAtk.abilityBonus) }}
          </span>
          <span
            v-if="pokemonEvasion.vsAtk.suppressedByCondition"
            class="evasion-bonus__condition"
            :title="`${pokemonEvasion.vsAtk.suppressedByCondition} prevents this Evasion from applying`"
          >
            suppressed by {{ pokemonEvasion.vsAtk.suppressedByCondition }}
          </span>
        </span>
      </li>
      <li title="Stat evasion = floor(Special Defense Total / 5), capped at +6 from stats. Sand Veil adds +1 if present, or +2 when activated from the Abilities table.">
        <span class="evasion-label">vs SATK</span>
        <strong>{{ pokemonEvasion.vsSatk.total }}</strong>
        <small>stat {{ pokemonEvasion.vsSatk.base }}</small>
        <span class="evasion-bonus">
          bonus
          <EditableCell
            :model-value="pokemonEvasion.vsSatk.bonus"
            type="number"
            :min="EVASION_BONUS_MIN"
            :max="EVASION_BONUS_MAX"
            :format="formatSignedModifier"
            @update:model-value="(v) => emit('setEvasionBonus', 'vsSatkBonus', v as number | undefined)"
          />
          <span
            v-if="pokemonEvasion.vsSatk.abilityBonus"
            class="evasion-bonus__ability"
            title="Sand Veil ability bonus"
          >
            Sand Veil {{ formatSignedModifier(pokemonEvasion.vsSatk.abilityBonus) }}
          </span>
          <span
            v-if="pokemonEvasion.vsSatk.suppressedByCondition"
            class="evasion-bonus__condition"
            :title="`${pokemonEvasion.vsSatk.suppressedByCondition} prevents this Evasion from applying`"
          >
            suppressed by {{ pokemonEvasion.vsSatk.suppressedByCondition }}
          </span>
        </span>
      </li>
      <li title="Stat evasion = floor(Speed Total / 5), capped at +6 from stats. Sand Veil adds +1 if present, or +2 when activated from the Abilities table. Bright Powder adds +2 to Speed Evasion while held; total evasion is capped at +9.">
        <span class="evasion-label">vs Any</span>
        <strong>{{ pokemonEvasion.vsAny.total }}</strong>
        <small>stat {{ pokemonEvasion.vsAny.base }}</small>
        <span class="evasion-bonus">
          bonus
          <EditableCell
            :model-value="pokemonEvasion.vsAny.bonus"
            type="number"
            :min="EVASION_BONUS_MIN"
            :max="EVASION_BONUS_MAX"
            :format="formatSignedModifier"
            @update:model-value="(v) => emit('setEvasionBonus', 'vsAnyBonus', v as number | undefined)"
          />
          <span
            v-if="pokemonEvasion.vsAny.abilityBonus"
            class="evasion-bonus__ability"
            title="Sand Veil ability bonus"
          >
            Sand Veil {{ formatSignedModifier(pokemonEvasion.vsAny.abilityBonus) }}
          </span>
          <span
            v-if="pokemonEvasion.vsAny.itemBonus"
            class="evasion-bonus__item"
            title="Bright Powder held-item bonus"
          >
            Bright Powder {{ formatSignedModifier(pokemonEvasion.vsAny.itemBonus) }}
          </span>
          <span
            v-if="pokemonEvasion.vsAny.suppressedByCondition"
            class="evasion-bonus__condition"
            :title="`${pokemonEvasion.vsAny.suppressedByCondition} prevents this Evasion from applying`"
          >
            suppressed by {{ pokemonEvasion.vsAny.suppressedByCondition }}
          </span>
        </span>
      </li>
    </ul>
  </div>

  <p
    class="combat-line accuracy-line"
    title="Accuracy Roll modifier = Accuracy Combat Stage + condition modifiers + Luck Incense held-item bonus. A natural 1 still always misses."
  >
    <strong>Accuracy Rolls:</strong>
    <span class="accuracy-line__total">{{ formatSignedModifier(pokemonAccuracy.total) }}</span>
    <small>stage {{ formatSignedModifier(pokemonAccuracy.stage) }}</small>
    <small v-if="pokemonAccuracy.conditionModifier" class="accuracy-line__condition">
      condition {{ formatSignedModifier(pokemonAccuracy.conditionModifier) }}
    </small>
    <small v-if="pokemonAccuracy.itemBonus" class="accuracy-line__item">
      Luck Incense {{ formatSignedModifier(pokemonAccuracy.itemBonus) }}
    </small>
  </p>

  <div class="combat-line condition-block">
    <strong>Conditions:</strong>
    <ConditionPicker v-model="combat.conditions" :available-moves="availableMoves" />
    <ul v-if="conditionEffects.length" class="condition-effects" aria-label="Condition effects">
      <li v-for="effect in conditionEffects" :key="effect.id">
        <strong>{{ effect.label }}:</strong> {{ effect.description }}
      </li>
    </ul>
  </div>
  <p class="combat-line">
    <strong>Vitamins:</strong>
    <EditableCell v-model="combat.vitamins" placeholder="—" />
  </p>
  <p class="combat-line notes">
    <EditableCell v-model="combat.notes" type="textarea" placeholder="Combat notes…" multiline />
  </p>
</template>

<style scoped>
.cell-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.evasion-row {
  margin-top: 0.6rem;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper-inset);
}

.evasion-row .cell-label {
  display: block;
  margin-bottom: 0.3rem;
}

.evasion-row ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  gap: 0.85rem;
  flex-wrap: wrap;
}

.evasion-row li {
  display: inline-grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  column-gap: 0.35rem;
  row-gap: 0.15rem;
  font-size: 0.85rem;
  color: var(--ink);
}

.evasion-row li strong {
  color: var(--ink-bright);
  font-size: 1rem;
  font-variant-numeric: tabular-nums;
}

.evasion-label { font-weight: 700; }

.evasion-row small {
  color: var(--ink-muted);
  font-size: 0.72rem;
}

.evasion-bonus {
  grid-column: 1 / -1;
  color: var(--ink-muted);
  font-size: 0.76rem;
}

.evasion-bonus__item,
.evasion-bonus__ability,
.evasion-bonus__condition {
  color: var(--accent);
  font-weight: 700;
}

.evasion-bonus__condition { color: var(--bad); }

.accuracy-line {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.accuracy-line__total {
  color: var(--ink-bright);
  font-weight: 800;
}

.accuracy-line__item {
  color: var(--accent);
  font-weight: 700;
}

.accuracy-line__condition {
  color: var(--bad);
  font-weight: 700;
}

.combat-line {
  margin: 0.55rem 0 0;
  font-size: 0.9rem;
  color: var(--ink);
}

.condition-block {
  display: grid;
  gap: 0.45rem;
}

.condition-block > strong { color: var(--ink-bright); }

.condition-effects {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--ink-soft);
  font-size: 0.8rem;
}

.condition-effects li + li { margin-top: 0.25rem; }

.condition-effects strong { color: var(--ink-bright); }

.combat-line.notes {
  color: var(--ink-soft);
  font-style: italic;
}
</style>
