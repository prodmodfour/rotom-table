<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  rowCount: number
  activeId: string | null
  round: number
  canManage: boolean
  hasInitiativeValues: boolean
  manualOrderActive: boolean
}>()

const emit = defineEmits<{
  (event: 'set-round', value: Event): void
  (event: 'previous'): void
  (event: 'next'): void
  (event: 'fill-from-speed'): void
  (event: 'clear-active'): void
  (event: 'clear-values'): void
  (event: 'clear-manual-order'): void
}>()

const turnControlsEnabled = computed(() => props.rowCount > 0 && props.canManage)
const fillFromSpeedEnabled = computed(() => props.rowCount > 0 && props.canManage)
const resetManualOrderEnabled = computed(() => props.manualOrderActive && props.canManage)
const clearActiveEnabled = computed(() => Boolean(props.activeId) && props.canManage)
const clearValuesEnabled = computed(() => (props.hasInitiativeValues || Boolean(props.activeId)) && props.canManage)

const emitPrevious = () => {
  if (turnControlsEnabled.value) emit('previous')
}

const emitNext = () => {
  if (turnControlsEnabled.value) emit('next')
}

const emitFillFromSpeed = () => {
  if (fillFromSpeedEnabled.value) emit('fill-from-speed')
}

const emitClearActive = () => {
  if (clearActiveEnabled.value) emit('clear-active')
}

const emitClearManualOrder = () => {
  if (resetManualOrderEnabled.value) emit('clear-manual-order')
}

const emitClearValues = () => {
  if (clearValuesEnabled.value) emit('clear-values')
}
</script>

<template>
  <div class="panel-heading initiative-heading">
    <div class="initiative-title-block">
      <h2>Initiative</h2>
      <label class="round-field">
        <span>Round</span>
        <input
          type="number"
          min="1"
          :value="round"
          aria-label="Initiative round"
          :disabled="!canManage"
          @input="emit('set-round', $event)"
        />
      </label>
    </div>
    <span class="badge">
      {{ rowCount }} character{{ rowCount === 1 ? '' : 's' }}
    </span>
  </div>

  <div class="initiative-actions" role="group" aria-label="Turn controls">
    <button
      type="button"
      class="initiative-action"
      :disabled="!turnControlsEnabled"
      @click="emitPrevious"
    >
      Previous
    </button>
    <button
      type="button"
      class="initiative-action initiative-action--primary"
      :disabled="!turnControlsEnabled"
      @click="emitNext"
    >
      {{ activeId ? 'Next turn' : 'Start' }}
    </button>
  </div>

  <div class="initiative-tools" role="group" aria-label="Initiative utilities">
    <button
      type="button"
      class="initiative-tool"
      title="Recalculate every combatant from derived initiative: Speed after Combat Stages, item/training bonuses, then condition effects for final order"
      :disabled="!fillFromSpeedEnabled"
      @click="emitFillFromSpeed"
    >
      Auto-calc all
    </button>
    <button
      v-if="manualOrderActive"
      type="button"
      class="initiative-tool"
      :disabled="!resetManualOrderEnabled"
      title="Return to calculated initiative order"
      @click="emitClearManualOrder"
    >
      Reset order
    </button>
    <button
      type="button"
      class="initiative-tool"
      :disabled="!clearActiveEnabled"
      @click="emitClearActive"
    >
      Clear turn
    </button>
    <button
      type="button"
      class="initiative-tool initiative-tool--danger"
      :disabled="!clearValuesEnabled"
      @click="emitClearValues"
    >
      Reset
    </button>
  </div>
</template>

<style scoped>
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.panel-heading h2 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

input {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.65rem 0.8rem;
  outline: none;
}

input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(255, 31, 45, 0.18);
}

input:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.initiative-heading {
  align-items: flex-start;
  margin-bottom: 0;
}

.initiative-title-block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.55rem;
}

.round-field {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--ink-muted);
  font-size: 0.76rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.round-field input {
  width: 72px;
  padding: 0.42rem 0.55rem;
  text-align: center;
}

.initiative-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.45rem;
}

.initiative-tools {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
}

.initiative-action,
.initiative-tool {
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.5rem 0.65rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.initiative-action:hover:not(:disabled),
.initiative-tool:hover:not(:disabled) {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
}

.initiative-action:disabled,
.initiative-tool:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.initiative-action--primary {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.initiative-tool--danger {
  color: var(--bad);
}

.initiative-tool--danger:hover:not(:disabled) {
  border-color: var(--bad);
  background: rgba(255, 31, 45, 0.08);
}

@media (max-width: 640px) {
  .initiative-tools,
  .initiative-actions {
    grid-template-columns: 1fr;
  }
}
</style>
