<script setup lang="ts">
import {
  EVASION_BONUS_MAX,
  EVASION_BONUS_MIN,
  formatSignedModifier,
} from '~/utils/evasion'
import type { PokemonEvasionBonusKey } from '~/composables/sheets/usePokemonSheetRowActions'
import type { CharacterSheet } from '~/types/characterSheet'

interface HpThresholds {
  half: number
  third: number
  quarter: number
}

interface EvasionEntry {
  total: number
  base: number
  bonus: number
}

interface PokemonEvasionSummary {
  vsAtk: EvasionEntry
  vsSatk: EvasionEntry
  vsAny: EvasionEntry & { itemBonus: number }
}

defineProps<{
  sheet: CharacterSheet
  currentHp: number
  maxHp: number
  fullMaxHp: number
  tickValue: number
  hpThresholds: HpThresholds
  pokemonEvasion: PokemonEvasionSummary
}>()

const emit = defineEmits<{
  setCurrentHp: [value: unknown]
  setEvasionBonus: [key: PokemonEvasionBonusKey, value: number | undefined]
}>()
</script>

<template>
  <section class="panel-card">
    <h2 class="panel-title">Combat</h2>
    <div class="combat-grid">
      <div class="combat-cell hp-cell">
        <span class="cell-label">Current HP</span>
        <span class="cell-value cell-value--big">
          <EditableCell
            :model-value="currentHp"
            type="number"
            :min="0"
            :max="maxHp"
            @update:model-value="emit('setCurrentHp', $event)"
          />
        </span>
      </div>
      <div
        class="combat-cell hp-cell hp-cell--max"
        title="Formula Max HP = Level + (HP × 3) + 10. Injuries reduce the effective Max HP by 1/10 each."
      >
        <span class="cell-label">Max HP</span>
        <span class="cell-value cell-value--big">
          {{ maxHp }}
          <span v-if="maxHp !== fullMaxHp" class="cell-sub">full {{ fullMaxHp }}</span>
        </span>
      </div>
      <div class="combat-cell">
        <span class="cell-label">Injuries</span>
        <span class="cell-value">
          <EditableCell v-model="sheet.combat!.injuries" type="number" :min="0" :max="10" />
        </span>
      </div>
      <div class="combat-cell" title="A Tick is 1/10th of full maximum Hit Points, rounded down.">
        <span class="cell-label">Tick</span>
        <span class="cell-value">{{ tickValue }}</span>
      </div>
      <div class="combat-cell">
        <span class="cell-label">DR</span>
        <span class="cell-value">
          <EditableCell v-model="sheet.combat!.dr" type="number" :min="0" />
        </span>
      </div>
      <div class="combat-cell" title="Fractional HP values use full Max HP before the injury cap.">
        <span class="cell-label">½ HP</span>
        <span class="cell-value">{{ hpThresholds.half }}</span>
      </div>
      <div class="combat-cell" title="Fractional HP values use full Max HP before the injury cap.">
        <span class="cell-label">⅓ HP</span>
        <span class="cell-value">{{ hpThresholds.third }}</span>
      </div>
      <div class="combat-cell" title="Fractional HP values use full Max HP before the injury cap.">
        <span class="cell-label">¼ HP</span>
        <span class="cell-value">{{ hpThresholds.quarter }}</span>
      </div>
      <div class="combat-cell">
        <span class="cell-label">Training Exp</span>
        <span class="cell-value">
          <EditableCell v-model="sheet.combat!.trainingExp" type="number" :min="0" />
        </span>
      </div>
    </div>

    <div class="evasion-row">
      <span class="cell-label">Evasion</span>
      <ul>
        <li title="Stat evasion = floor(Defense Total / 5), capped at +6 from stats.">
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
          </span>
        </li>
        <li title="Stat evasion = floor(Special Defense Total / 5), capped at +6 from stats.">
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
          </span>
        </li>
        <li title="Stat evasion = floor(Speed Total / 5), capped at +6 from stats. Bright Powder adds +2 to Speed Evasion while held; total evasion is capped at +9.">
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
              v-if="pokemonEvasion.vsAny.itemBonus"
              class="evasion-bonus__item"
              title="Bright Powder held-item bonus"
            >
              Bright Powder {{ formatSignedModifier(pokemonEvasion.vsAny.itemBonus) }}
            </span>
          </span>
        </li>
      </ul>
    </div>

    <div class="combat-line condition-block">
      <strong>Conditions:</strong>
      <ConditionPicker v-model="sheet.combat!.conditions" />
    </div>
    <p class="combat-line">
      <strong>Vitamins:</strong>
      <EditableCell v-model="sheet.combat!.vitamins" placeholder="—" />
    </p>
    <p class="combat-line notes">
      <EditableCell v-model="sheet.combat!.notes" type="textarea" placeholder="Combat notes…" multiline />
    </p>
  </section>
</template>

<style scoped>
.panel-title {
  margin: 0 0 0.6rem;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.combat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
}

@media (max-width: 760px) {
  .combat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.combat-cell {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  padding: 0.45rem 0.6rem;
  background: var(--paper-inset);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.combat-cell.hp-cell {
  grid-column: span 2;
  background: var(--accent-soft);
  border-color: var(--accent);
}

.cell-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-muted);
}

.cell-value {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--ink-bright);
}

.cell-value--big {
  font-size: 1.5rem;
  font-family: var(--font-book);
}

.cell-sub {
  margin-left: 0.35rem;
  font-weight: 400;
  color: var(--ink-muted);
  font-size: 0.82rem;
  font-family: var(--font-ui);
  letter-spacing: 0.04em;
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

.evasion-bonus__item {
  color: var(--accent);
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

.combat-line.notes {
  color: var(--ink-soft);
  font-style: italic;
}
</style>
