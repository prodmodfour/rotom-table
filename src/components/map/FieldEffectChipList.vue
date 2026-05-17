<script setup lang="ts">
import type { MapEffectDefinition } from '~/utils/mapFieldEffectDefinitions'

export interface FieldEffectChip {
  kind: string
  rounds?: number | null
  startsNextRound?: boolean
}

defineProps<{
  effects: FieldEffectChip[]
  canEditMap: boolean
  emptyText: string
  definition: (kind: string) => MapEffectDefinition
  durationLabel: (rounds: number | null | undefined) => string
}>()

const emit = defineEmits<{
  (event: 'set-rounds', kind: string, value: Event): void
  (event: 'remove', kind: string): void
}>()
</script>

<template>
  <div v-if="effects.length" class="effect-chip-list">
    <article
      v-for="effect in effects"
      :key="effect.kind"
      class="effect-chip"
      :style="{ '--effect-color': definition(effect.kind).color }"
    >
      <div class="effect-chip__main">
        <strong>{{ definition(effect.kind).label }}</strong>
        <span>{{ definition(effect.kind).description }}</span>
        <em v-if="effect.startsNextRound">starts next round</em>
      </div>
      <label class="duration-field">
        <span>Duration</span>
        <input
          type="number"
          min="0"
          :value="durationLabel(effect.rounds)"
          :disabled="!canEditMap"
          placeholder="∞"
          @input="emit('set-rounds', effect.kind, $event)"
        />
      </label>
      <button
        v-if="canEditMap"
        type="button"
        class="chip-remove"
        :aria-label="`Remove ${definition(effect.kind).label}`"
        @click="emit('remove', effect.kind)"
      >
        ×
      </button>
    </article>
  </div>
  <p v-else class="field-effect-empty">{{ emptyText }}</p>
</template>

<style scoped>
.effect-chip-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-top: 0.6rem;
}

.effect-chip {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4.4rem auto;
  align-items: center;
  gap: 0.55rem;
  border: 1px solid color-mix(in srgb, var(--effect-color) 40%, var(--rule-soft));
  border-radius: 12px;
  background: color-mix(in srgb, var(--effect-color) 9%, var(--paper));
  padding: 0.55rem;
}

.effect-chip__main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
}

.effect-chip__main strong {
  color: color-mix(in srgb, var(--effect-color) 70%, var(--ink-bright));
  font-size: 0.82rem;
}

.effect-chip__main span,
.effect-chip__main em {
  color: var(--ink-muted);
  font-size: 0.72rem;
  line-height: 1.25;
}

.duration-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.duration-field span {
  color: var(--ink-muted);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.duration-field input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.4rem 0.45rem;
  outline: none;
  text-align: center;
}

.duration-field input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(255, 31, 45, 0.18);
}

.duration-field input:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.chip-remove {
  width: 1.9rem;
  height: 1.9rem;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-soft);
  cursor: pointer;
  font: inherit;
  font-size: 1.05rem;
  line-height: 1;
  padding: 0;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.chip-remove:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.chip-remove:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.field-effect-empty {
  margin: 0.5rem 0 0;
  color: var(--ink-muted);
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  line-height: 1.35;
}
</style>
