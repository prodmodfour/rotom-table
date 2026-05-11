<script setup lang="ts">
import type { TrainerEvasionBonusKey } from '~/composables/sheets/useTrainerSheetRowActions'
import type { TrainerSheet } from '~/types/trainerSheet'

const otherCapsCsv = defineModel<string>('otherCapsCsv', { required: true })

type TrainerEvasionSummary = {
  speed: { total: number; base: number; bonus: number }
  physical: { total: number; base: number; bonus: number }
  special: { total: number; base: number; bonus: number }
}

defineProps<{
  sheet: TrainerSheet
  currentHp: number
  maxHp: number
  fullMaxHp: number
  maxAp: number
  tickValue: number
  hpThresholds: {
    half: number
    third: number
    quarter: number
  }
  attackTotal: number
  specialAttackTotal: number
  speedTotal: number
  trainerEvasion: TrainerEvasionSummary
}>()

const emit = defineEmits<{
  setCurrentHp: [value: unknown]
  setEvasionBonus: [key: TrainerEvasionBonusKey, value: number | undefined]
}>()

const forwardEvasionBonus = (key: TrainerEvasionBonusKey, value: number | undefined) => {
  emit('setEvasionBonus', key, value)
}
</script>

<template>
  <div class="trainer-combat-overview">
    <TrainerCombatVitalsStrip
      :current-hp="currentHp"
      :max-hp="maxHp"
      :full-max-hp="fullMaxHp"
      :tick-value="tickValue"
      :hp-thresholds="hpThresholds"
      :damage-reduction="sheet.damageReduction"
      :level="sheet.level"
      :attack-total="attackTotal"
      :special-attack-total="specialAttackTotal"
      :speed-total="speedTotal"
      @set-current-hp="emit('setCurrentHp', $event)"
      @update-damage-reduction="sheet.damageReduction = $event"
      @update-level="sheet.level = $event"
    />

    <div class="grid-two">
      <TrainerActionPointsPanel :ap="sheet.ap!" :max-ap="maxAp" />

      <TrainerEvasionConditionsPanel
        v-model:conditions="sheet.conditions"
        v-model:digestion="sheet.digestion"
        :trainer-evasion="trainerEvasion"
        @set-evasion-bonus="forwardEvasionBonus"
      />
    </div>

    <div class="block">
      <h2 class="block-title">Capabilities</h2>
      <ul class="cap-grid">
        <li>
          <span class="cap-label">Overland</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.overland" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Throw Range</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.throwingRange" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">High Jump</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.highJump" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Long Jump</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.longJump" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Swim</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.swim" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Power</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.power" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Sky</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.sky" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Levitate</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.levitate" type="number" :min="0" />
          </span>
        </li>
        <li>
          <span class="cap-label">Burrow</span>
          <span class="cap-value">
            <EditableCell v-model="sheet.capabilities!.burrow" type="number" :min="0" />
          </span>
        </li>
      </ul>
      <p class="muted-help capabilities-help">
        <strong>Other capabilities:</strong>
        <EditableCell v-model="otherCapsCsv" placeholder="Telepath, Aura Reader" />
      </p>
    </div>
  </div>
</template>

<style scoped>
.trainer-combat-overview {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.grid-two {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 0.85rem;
}

.block {
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-inset);
  padding: 0.7rem 0.85rem;
}

.block-title {
  margin: 0 0 0.5rem;
  font-family: var(--font-book);
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-bright);
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.muted-help { color: var(--ink-muted); font-size: 0.78rem; margin: 0 0 0.4rem; }

.cap-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.35rem;
}

.cap-grid li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.3rem 0.55rem;
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-inset);
}

.cap-label { color: var(--ink-soft); font-size: 0.82rem; }
.cap-value { color: var(--ink-bright); font-weight: 700; font-size: 0.92rem; font-variant-numeric: tabular-nums; }

.capabilities-help { margin-top: 0.6rem; }
</style>
