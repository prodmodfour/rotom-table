<script setup lang="ts">
import type { TrainerEvasionBonusKey } from '~/composables/sheets/useTrainerSheetRowActions'
import type { ConditionEffectSummary } from '~/utils/sheetConditionEffects'
import type { TrainerSheet } from '~/types/trainerSheet'

const otherCapsCsv = defineModel<string>('otherCapsCsv', { required: true })

type TrainerEvasionEntry = {
  total: number
  base: number
  bonus: number
  suppressedByCondition?: string | null
}

type TrainerEvasionSummary = {
  speed: TrainerEvasionEntry
  physical: TrainerEvasionEntry
  special: TrainerEvasionEntry
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
  initiative: number
  trainerEvasion: TrainerEvasionSummary
  conditionEffects: readonly ConditionEffectSummary[]
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
      :initiative="initiative"
      @set-current-hp="emit('setCurrentHp', $event)"
      @update-damage-reduction="sheet.damageReduction = $event"
      @update-level="sheet.level = $event ?? 1"
    />

    <div class="grid-two">
      <TrainerActionPointsPanel :ap="sheet.ap!" :max-ap="maxAp" />

      <TrainerEvasionConditionsPanel
        v-model:conditions="sheet.conditions"
        v-model:digestion="sheet.digestion"
        :trainer-evasion="trainerEvasion"
        :condition-effects="conditionEffects"
        :available-moves="sheet.movelist?.map((move) => move.name) ?? []"
        @set-evasion-bonus="forwardEvasionBonus"
      />
    </div>

    <TrainerCapabilitiesPanel
      v-model:other-caps-csv="otherCapsCsv"
      :sheet="sheet"
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
