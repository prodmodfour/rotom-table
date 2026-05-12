<script setup lang="ts">
import type { BuildTool } from '#shared/mapEditor'

withDefaults(defineProps<{
  activeTool: BuildTool
  ariaLabel: string
  pencilLabel?: string
  eraserLabel?: string
}>(), {
  pencilLabel: 'Pencil',
  eraserLabel: 'Eraser',
})

const emit = defineEmits<{
  (event: 'set-tool', tool: BuildTool): void
}>()
</script>

<template>
  <div class="tool-row" role="group" :aria-label="ariaLabel">
    <button
      type="button"
      class="tool-button"
      :class="{ 'is-active': activeTool === 'pencil' }"
      :aria-pressed="activeTool === 'pencil'"
      @click="emit('set-tool', 'pencil')"
    >
      {{ pencilLabel }}
    </button>
    <button
      type="button"
      class="tool-button"
      :class="{ 'is-active': activeTool === 'eraser' }"
      :aria-pressed="activeTool === 'eraser'"
      @click="emit('set-tool', 'eraser')"
    >
      {{ eraserLabel }}
    </button>
  </div>
</template>

<style scoped>
.tool-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.4rem;
}

.tool-button {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.7rem;
  cursor: pointer;
  font: inherit;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.tool-button:hover {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.tool-button.is-active {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}
</style>
