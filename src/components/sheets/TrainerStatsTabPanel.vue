<script setup lang="ts">
import type {
  TrainerStatEditableField,
} from '~/composables/sheets/useTrainerSheetRowActions'
import type { ResolvedTrainerStat } from '~/utils/sheets/trainerDerived'
import type { TrainerStatKey } from '~/types/trainerSheet'

defineProps<{
  stats: readonly ResolvedTrainerStat[]
  statPointsLeft: number
  statPointsSpent: number
  statPointsBudget: number
}>()

const emit = defineEmits<{
  setStatField: [key: TrainerStatKey, field: TrainerStatEditableField, value: number | undefined]
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
  </section>
</template>

<style scoped>
.tab-panel {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
</style>
