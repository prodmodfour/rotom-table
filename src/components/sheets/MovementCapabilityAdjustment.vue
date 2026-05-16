<script setup lang="ts">
import { computed } from 'vue'
import {
  conditionAdjustedMovementCapability,
  slowedMovementCapabilityApplied,
} from '~/utils/sheetConditionEffects'

const props = defineProps<{
  name: string
  value?: number | string | null
  conditions?: readonly string[] | null
  showName?: boolean
}>()

const displayName = computed(() => props.name.trim().replace(/\s+/g, ' '))

const applied = computed(() => slowedMovementCapabilityApplied(
  props.name,
  props.value,
  props.conditions,
))
const adjustedValue = computed(() => conditionAdjustedMovementCapability(
  props.name,
  props.value,
  props.conditions,
))
</script>

<template>
  <small
    v-if="applied"
    class="movement-capability-adjustment"
    title="Slowed halves Movement, minimum 1."
  >Slowed: <template v-if="showName">{{ displayName }} </template>{{ adjustedValue }}</small>
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
</style>
