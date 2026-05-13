<script setup lang="ts">
import type {
  TrainerStatEditableField,
} from '~/composables/sheets/useTrainerSheetRowActions'
import type { ResolvedTrainerStat } from '~/utils/sheets/trainerDerived'
import type {
  TrainerSheet,
  TrainerStatKey,
} from '~/types/trainerSheet'

defineProps<{
  sheet: TrainerSheet
  stats: readonly ResolvedTrainerStat[]
  statPointsLeft: number
  statPointsSpent: number
  statPointsBudget: number
}>()

const emit = defineEmits<{
  setStatField: [key: TrainerStatKey, field: TrainerStatEditableField, value: number | undefined]
  addClass: []
  removeClass: [index: number]
}>()

const forwardSetStatField = (
  key: TrainerStatKey,
  field: TrainerStatEditableField,
  value: number | undefined,
) => emit('setStatField', key, field, value)
</script>

<template>
  <section class="tab-panel">
    <TrainerStatsPanel
      :stats="stats"
      :stat-points-left="statPointsLeft"
      :stat-points-spent="statPointsSpent"
      :stat-points-budget="statPointsBudget"
      @set-stat-field="forwardSetStatField"
    />

    <TrainerProgressPanel
      :sheet="sheet"
      @add-class="emit('addClass')"
      @remove-class="emit('removeClass', $event)"
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
