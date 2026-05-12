<script setup lang="ts">
import FieldEffectChipList, { type FieldEffectChip } from '~/components/map/FieldEffectChipList.vue'
import FieldEffectSwatchGrid from '~/components/map/FieldEffectSwatchGrid.vue'
import type { MapEffectDefinition } from '~/utils/mapFieldEffectDefinitions'

defineProps<{
  title: string
  ariaLabel: string
  effects: MapEffectDefinition[]
  activeEffects: FieldEffectChip[]
  canEditMap: boolean
  emptyText: string
  isActive: (kind: string) => boolean
  definition: (kind: string) => MapEffectDefinition
  durationLabel: (rounds: number | null | undefined) => string
  note?: string
  clearable?: boolean
  clearDisabled?: boolean
  flushTop?: boolean
}>()

const emit = defineEmits<{
  (event: 'select', kind: string): void
  (event: 'set-rounds', kind: string, value: Event): void
  (event: 'remove', kind: string): void
  (event: 'clear'): void
}>()
</script>

<template>
  <div class="field-effect-group" :class="{ 'field-effect-group--flush': flushTop }">
    <div class="field-effect-header">
      <h3>{{ title }}</h3>
      <button
        v-if="clearable && canEditMap"
        type="button"
        class="mini-action"
        :disabled="clearDisabled"
        @click="emit('clear')"
      >
        Clear
      </button>
      <span v-else-if="note" class="field-effect-note">{{ note }}</span>
    </div>
    <FieldEffectSwatchGrid
      :ariaLabel="ariaLabel"
      :effects="effects"
      :is-active="isActive"
      :disabled="!canEditMap"
      @select="emit('select', $event)"
    />
    <slot />
    <FieldEffectChipList
      :effects="activeEffects"
      :can-edit-map="canEditMap"
      :definition="definition"
      :duration-label="durationLabel"
      :empty-text="emptyText"
      @set-rounds="(kind, value) => emit('set-rounds', kind, value)"
      @remove="emit('remove', $event)"
    />
  </div>
</template>

<style scoped>
.field-effect-group {
  border-top: 1px solid var(--rule-soft);
  padding-top: 0.8rem;
}

.field-effect-group--flush {
  border-top: 0;
  padding-top: 0;
}

.field-effect-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
  margin-bottom: 0.55rem;
}

.field-effect-header h3 {
  margin: 0;
  color: var(--ink-bright);
  font-size: 0.86rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.field-effect-note {
  color: var(--ink-muted);
  font-size: 0.74rem;
  letter-spacing: 0.04em;
}

.mini-action {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
  padding: 0.25rem 0.6rem;
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.mini-action:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.mini-action:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
