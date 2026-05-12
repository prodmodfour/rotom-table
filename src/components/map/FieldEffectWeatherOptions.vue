<script setup lang="ts">
import { checkedValueFromEvent } from '~/utils/domEvents'

defineProps<{
  canEditMap: boolean
  activeWeatherCount: number
  weatherCoexistNext: boolean
}>()

const emit = defineEmits<{
  (event: 'update-weather-coexist-next', value: boolean): void
}>()
</script>

<template>
  <label v-if="canEditMap" class="coexist-toggle" :class="{ active: weatherCoexistNext }">
    <input
      :checked="weatherCoexistNext"
      type="checkbox"
      :disabled="activeWeatherCount === 0"
      @change="emit('update-weather-coexist-next', checkedValueFromEvent($event))"
    />
    Add next weather alongside current one (Climate Control)
  </label>
</template>

<style scoped>
.coexist-toggle {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin-top: 0.55rem;
  color: var(--ink-muted);
  font-size: 0.75rem;
  line-height: 1.35;
}

.coexist-toggle.active {
  color: var(--accent);
}

.coexist-toggle input {
  width: auto;
  margin-top: 0.15rem;
  accent-color: var(--accent);
}
</style>
