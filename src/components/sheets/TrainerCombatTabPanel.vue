<script setup lang="ts">
import type { AbilityLookupRow } from '~/utils/sheetAbilityLookup'
import type { TrainerSheetMoveLookupRow } from '~/composables/sheets/useTrainerSheetDerived'
import type { TrainerEvasionBonusKey } from '~/composables/sheets/useTrainerSheetRowActions'
import type {
  TrainerAbilityEntry,
  TrainerOrder,
  TrainerSheet,
} from '~/types/trainerSheet'

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
  moveRows: readonly TrainerSheetMoveLookupRow[]
  abilityRows: readonly AbilityLookupRow<TrainerAbilityEntry>[]
  orderTagsCsv: (order: TrainerOrder) => string
}>()

const emit = defineEmits<{
  setCurrentHp: [value: unknown]
  setEvasionBonus: [key: TrainerEvasionBonusKey, value: number | undefined]
  addMove: []
  removeMove: [index: number | null]
  addAbility: []
  removeAbility: [index: number]
  addManeuver: []
  removeManeuver: [index: number]
  addOrder: []
  removeOrder: [index: number]
  setOrderTags: [order: TrainerOrder, raw: string]
}>()

const forwardSetEvasionBonus = (key: TrainerEvasionBonusKey, value: number | undefined) =>
  emit('setEvasionBonus', key, value)

const forwardSetOrderTags = (order: TrainerOrder, raw: string) =>
  emit('setOrderTags', order, raw)
</script>

<template>
  <section class="tab-panel">
    <TrainerCombatOverviewPanel
      v-model:other-caps-csv="otherCapsCsv"
      :sheet="sheet"
      :current-hp="currentHp"
      :max-hp="maxHp"
      :full-max-hp="fullMaxHp"
      :max-ap="maxAp"
      :tick-value="tickValue"
      :hp-thresholds="hpThresholds"
      :attack-total="attackTotal"
      :special-attack-total="specialAttackTotal"
      :speed-total="speedTotal"
      :trainer-evasion="trainerEvasion"
      @set-current-hp="emit('setCurrentHp', $event)"
      @set-evasion-bonus="forwardSetEvasionBonus"
    />

    <TrainerCombatActionsPanel
      :sheet="sheet"
      :move-rows="moveRows"
      :ability-rows="abilityRows"
      :order-tags-csv="orderTagsCsv"
      @add-move="emit('addMove')"
      @remove-move="emit('removeMove', $event)"
      @add-ability="emit('addAbility')"
      @remove-ability="emit('removeAbility', $event)"
      @add-maneuver="emit('addManeuver')"
      @remove-maneuver="emit('removeManeuver', $event)"
      @add-order="emit('addOrder')"
      @remove-order="emit('removeOrder', $event)"
      @set-order-tags="forwardSetOrderTags"
    />
  </section>
</template>

<style scoped>
.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
</style>
