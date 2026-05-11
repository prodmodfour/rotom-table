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

    <TrainerCapabilitiesPanel
      v-model:other-caps-csv="otherCapsCsv"
      :capabilities="sheet.capabilities!"
    />
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
</style>
