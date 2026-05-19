<script setup lang="ts">
import type { CharacterSheet } from '~/types/characterSheet'

type PokemonCombatState = NonNullable<CharacterSheet['combat']>

interface HpThresholds {
  half: number
  third: number
  quarter: number
}

defineProps<{
  combat: PokemonCombatState
  currentHp: number
  maxHp: number
  fullMaxHp: number
  tickValue: number
  hpThresholds: HpThresholds
  speedTotal: number
  initiative: number
}>()

const emit = defineEmits<{
  setCurrentHp: [value: unknown]
}>()
</script>

<template>
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
        <EditableCell v-model="combat.injuries" type="number" :min="0" :max="10" />
      </span>
    </div>
    <div class="combat-cell" title="A Tick is 1/10th of full maximum Hit Points, rounded down.">
      <span class="cell-label">Tick</span>
      <span class="cell-value">{{ tickValue }}</span>
    </div>
    <div class="combat-cell">
      <span class="cell-label">DR</span>
      <span class="cell-value">
        <EditableCell v-model="combat.dr" type="number" :min="0" />
      </span>
    </div>
    <div class="combat-cell" title="Initiative is Speed adjusted by conditions such as Paralysis and Flinch.">
      <span class="cell-label">Initiative</span>
      <span class="cell-value">
        {{ initiative }}
        <span v-if="initiative !== speedTotal" class="cell-sub">Speed {{ speedTotal }}</span>
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
        <EditableCell v-model="combat.trainingExp" type="number" :min="0" />
      </span>
    </div>
  </div>
</template>

<style scoped>
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
  background: rgba(255, 255, 255, 0.14);
  border-color: var(--rule-strong);
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
</style>
