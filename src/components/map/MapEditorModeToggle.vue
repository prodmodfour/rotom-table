<script setup lang="ts">
import type { MapEditorMode } from '#shared/mapEditor'

defineProps<{
  buildMode: boolean
  hazardMode: boolean
}>()

const emit = defineEmits<{
  (event: 'set-mode', mode: MapEditorMode): void
}>()
</script>

<template>
  <div class="mode-row" role="group" aria-label="Editor mode">
    <button
      type="button"
      class="mode-button"
      :class="{ 'is-active': !buildMode && !hazardMode }"
      :aria-pressed="!buildMode && !hazardMode"
      @click="emit('set-mode', 'play')"
    >
      Play
    </button>
    <button
      type="button"
      class="mode-button"
      :class="{ 'is-active': buildMode }"
      :aria-pressed="buildMode"
      @click="emit('set-mode', 'build')"
    >
      Build
    </button>
    <button
      type="button"
      class="mode-button"
      :class="{ 'is-active': hazardMode }"
      :aria-pressed="hazardMode"
      @click="emit('set-mode', 'hazards')"
    >
      Hazards
    </button>
  </div>
</template>

<style scoped>
.mode-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
}

.mode-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.8rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.mode-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.mode-button.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
</style>
