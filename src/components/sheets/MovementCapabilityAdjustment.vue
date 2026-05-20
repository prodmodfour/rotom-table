<script setup lang="ts">
import { computed } from 'vue'
import { resolveSheetMovementCapabilityAdjustments } from '~/utils/sheets/movementCapabilityAdjustments'

const props = defineProps<{
  name: string
  value?: number | string | null
  conditions?: readonly string[] | null
  trainingFeature?: string | null
  showName?: boolean
}>()

const displayName = computed(() => props.name.trim().replace(/\s+/g, ' '))

const adjustments = computed(() => resolveSheetMovementCapabilityAdjustments(
  props.name,
  props.value,
  props.conditions,
  props.trainingFeature,
))

const trainingAdjustment = computed(() => adjustments.value.trainingAdjustment)
const conditionAdjustment = computed(() => adjustments.value.conditionAdjustment)
</script>

<template>
  <small
    v-if="trainingAdjustment"
    class="movement-capability-adjustment movement-capability-adjustment--training"
    :title="trainingAdjustment.title"
  >
    {{ trainingAdjustment.featureName }}<template v-if="showName"> ({{ displayName }})</template>
  </small>
  <small
    v-if="conditionAdjustment"
    class="movement-capability-adjustment"
    :class="{ 'movement-capability-adjustment--blocked': conditionAdjustment.condition === 'Stuck' || conditionAdjustment.condition === 'Tripped' }"
    :title="conditionAdjustment.title"
  >
    {{ conditionAdjustment.condition }}:
    <template v-if="showName">{{ displayName }} </template>{{ conditionAdjustment.displayValue }}
  </small>
</template>

<style scoped>
.movement-capability-adjustment {
  display: block;
  margin-top: 0.12rem;
  color: var(--accent);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.15;
}

.movement-capability-adjustment--blocked {
  color: var(--bad);
}
</style>
