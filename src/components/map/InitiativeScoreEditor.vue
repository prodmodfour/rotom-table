<script setup lang="ts">
import type { InitiativeRow } from '~/composables/map-editor/useInitiativeTracker'

defineProps<{
  entry: InitiativeRow
  canManage: boolean
}>()

const emit = defineEmits<{
  (event: 'set-initiative-input', id: string, value: Event): void
  (event: 'set-initiative-from-speed', id: string, speed: number): void
}>()
</script>

<template>
  <div class="initiative-row__score">
    <label>
      <span>Init</span>
      <input
        type="number"
        inputmode="numeric"
        :value="entry.initiative ?? ''"
        placeholder="—"
        :aria-label="`${entry.name} initiative`"
        :disabled="!canManage"
        @input="emit('set-initiative-input', entry.id, $event)"
      />
    </label>
    <button
      type="button"
      class="initiative-row__speed-button"
      :title="`Set initiative to condition-adjusted value (${entry.initiativeScore})`"
      :aria-label="`Use ${entry.name}'s condition-adjusted initiative (${entry.initiativeScore})`"
      :disabled="!canManage"
      @click="emit('set-initiative-from-speed', entry.id, entry.initiativeScore)"
    >
      Use Init
    </button>
  </div>
</template>

<style scoped>
.initiative-row__score {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.28rem;
  min-width: 0;
}

.initiative-row__score label {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  min-width: 0;
}

.initiative-row__score span {
  color: var(--ink-muted);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-align: center;
  text-transform: uppercase;
}

.initiative-row__score input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.45rem 0.25rem;
  outline: none;
  text-align: center;
}

.initiative-row__score input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.initiative-row__score input:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.initiative-row__speed-button {
  border: 1px solid var(--rule-soft);
  border-radius: 8px;
  background: var(--paper-soft);
  color: var(--ink-soft);
  padding: 0.28rem 0.25rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1;
  white-space: nowrap;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.initiative-row__speed-button:hover,
.initiative-row__speed-button:focus-visible {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
  outline: none;
}
</style>
