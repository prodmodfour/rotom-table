<script setup lang="ts">
import { computed } from 'vue'
import { movementCapabilityConditionAdjustment } from '~/utils/sheetConditionEffects'

const props = defineProps<{
  name: string
  value?: number | string | null
  conditions?: readonly string[] | null
  showName?: boolean
}>()

const displayName = computed(() => props.name.trim().replace(/\s+/g, ' '))

const adjustment = computed(() => movementCapabilityConditionAdjustment(
  props.name,
  props.value,
  props.conditions,
))
</script>

<template>
  <small
    v-if="adjustment"
    class="movement-capability-adjustment"
    :class="{ 'movement-capability-adjustment--blocked': adjustment.condition === 'Stuck' || adjustment.condition === 'Tripped' }"
    :title="adjustment.title"
  >{{ adjustment.condition }}: <template v-if="showName">{{ displayName }} </template>{{ adjustment.displayValue }}</small>
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
