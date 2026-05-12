<script setup lang="ts">
import type { MapEffectDefinition } from '~/utils/mapFieldEffectDefinitions'

defineProps<{
  effects: MapEffectDefinition[]
  isActive: (kind: string) => boolean
  disabled: boolean
  ariaLabel: string
}>()

const emit = defineEmits<{
  (event: 'select', kind: string): void
}>()
</script>

<template>
  <div class="effect-swatch-grid" role="group" :aria-label="ariaLabel">
    <button
      v-for="effect in effects"
      :key="effect.kind"
      type="button"
      class="effect-swatch"
      :class="{ 'is-active': isActive(effect.kind) }"
      :aria-pressed="isActive(effect.kind)"
      :disabled="disabled"
      :title="effect.rules"
      :style="{ '--effect-color': effect.color }"
      @click="emit('select', effect.kind)"
    >
      <span class="effect-swatch__icon">{{ effect.shortLabel }}</span>
      <span class="effect-swatch__label">{{ effect.label }}</span>
    </button>
  </div>
</template>

<style scoped>
.effect-swatch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4rem;
}

.effect-swatch {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.45rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.45rem;
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.effect-swatch:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--effect-color) 55%, var(--rule-strong));
  background: var(--paper-hover);
}

.effect-swatch:disabled {
  cursor: default;
  opacity: 0.8;
}

.effect-swatch.is-active {
  border-color: color-mix(in srgb, var(--effect-color) 72%, var(--accent));
  background: color-mix(in srgb, var(--effect-color) 16%, var(--paper));
}

.effect-swatch__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.65rem;
  min-height: 1.9rem;
  border: 1px solid color-mix(in srgb, var(--effect-color) 65%, #1d2021);
  border-radius: 8px;
  background: color-mix(in srgb, var(--effect-color) 20%, transparent);
  color: color-mix(in srgb, var(--effect-color) 78%, #fbf1c7);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.effect-swatch__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.76rem;
  letter-spacing: 0.03em;
}
</style>
