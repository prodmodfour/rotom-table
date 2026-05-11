<script setup lang="ts">
import type { AbilityLookupRow } from '~/utils/sheetAbilityLookup'
import type { MoveLookupRow } from '~/utils/sheetMoveLookup'
import type {
  TrainerAbilityEntry,
  TrainerMove,
  TrainerOrder,
  TrainerSheet,
} from '~/types/trainerSheet'

defineProps<{
  sheet: TrainerSheet
  moveRows: readonly MoveLookupRow<TrainerMove>[]
  abilityRows: readonly AbilityLookupRow<TrainerAbilityEntry>[]
  orderTagsCsv: (order: TrainerOrder) => string
}>()

const emit = defineEmits<{
  addMove: []
  removeMove: [index: number]
  addAbility: []
  removeAbility: [index: number]
  addManeuver: []
  removeManeuver: [index: number]
  addOrder: []
  removeOrder: [index: number]
  setOrderTags: [order: TrainerOrder, raw: string]
}>()

const emitRemoveMove = (index: number) => emit('removeMove', index)
const emitRemoveAbility = (index: number) => emit('removeAbility', index)
const emitRemoveManeuver = (index: number) => emit('removeManeuver', index)
const emitRemoveOrder = (index: number) => emit('removeOrder', index)
const emitSetOrderTags = (order: TrainerOrder, raw: string) => emit('setOrderTags', order, raw)
</script>

<template>
  <div class="trainer-combat-actions">
    <TrainerMovesPanel
      :move-rows="moveRows"
      @add="emit('addMove')"
      @remove="emitRemoveMove"
    />
    <TrainerAbilitiesPanel
      :ability-rows="abilityRows"
      @add="emit('addAbility')"
      @remove="emitRemoveAbility"
    />
    <TrainerManeuversPanel
      :maneuvers="sheet.maneuvers"
      @add="emit('addManeuver')"
      @remove="emitRemoveManeuver"
    />
    <TrainerOrdersPanel
      :orders="sheet.orders"
      :order-tags-csv="orderTagsCsv"
      @add="emit('addOrder')"
      @remove="emitRemoveOrder"
      @set-tags="emitSetOrderTags"
    />
  </div>
</template>

<style scoped>
.trainer-combat-actions {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
</style>
