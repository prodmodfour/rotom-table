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
  <div class="initiative-controls">
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

    <div class="initiative-command-row">
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
          class="initiative-tool initiative-tool--featured"
          title="Recalculate every combatant from derived initiative: Speed after Combat Stages, item/training bonuses, then condition effects for final order"
          :disabled="!fillFromSpeedEnabled"
          @click="emitFillFromSpeed"
        >
          Auto-calc all
        </button>
        <button
          v-if="manualOrderActive"
          type="button"
          class="initiative-tool initiative-tool--reset-order"
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
    </div>

    <p v-if="manualOrderActive" class="initiative-manual-notice" aria-live="polite">
      <span class="initiative-manual-notice__icon" aria-hidden="true">↕</span>
      <span><strong>Manual order active.</strong> Use Reset order to return to calculated initiative.</span>
    </p>
  </div>
</template>

<style scoped>
.initiative-controls {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: -0.2rem -0.2rem 0;
  border-bottom: 1px solid var(--rule-soft);
  border-radius: 12px 12px 10px 10px;
  background:
    linear-gradient(180deg, var(--paper-soft) 0 86%, rgba(0, 0, 0, 0) 100%);
  padding: 0.2rem 0.2rem 0.65rem;
}

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

.initiative-command-row {
  display: grid;
  grid-template-columns: minmax(210px, 0.8fr) minmax(280px, 1.2fr);
  gap: 0.5rem;
  align-items: stretch;
}

.initiative-actions {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 0.45rem;
}

.initiative-tools {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7.2rem, 1fr));
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

.initiative-action:focus-visible,
.initiative-tool:focus-visible {
  border-color: var(--accent);
  outline: 2px solid rgba(var(--accent-rgb), 0.35);
  outline-offset: 2px;
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
  font-weight: 900;
}

.initiative-tool--featured {
  min-height: 2.45rem;
  border-color: rgba(var(--accent-rgb), 0.55);
  background:
    linear-gradient(135deg, rgba(var(--accent-rgb), 0.18), rgba(var(--accent-rgb), 0.06)),
    var(--paper);
  color: var(--ink-bright);
  font-weight: 900;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.initiative-tool--reset-order {
  border-color: var(--rule-strong);
  background: var(--paper-hover);
  color: var(--ink-bright);
  font-weight: 800;
}

.initiative-tool--danger {
  color: var(--bad);
}

.initiative-tool--danger:hover:not(:disabled) {
  border-color: var(--bad);
  background: rgba(255, 31, 45, 0.08);
}

.initiative-manual-notice {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin: 0;
  border: 1px solid rgba(var(--accent-rgb), 0.28);
  border-radius: 10px;
  background: rgba(var(--accent-rgb), 0.08);
  color: var(--ink-soft);
  padding: 0.48rem 0.6rem;
  font-size: 0.75rem;
  line-height: 1.35;
}

.initiative-manual-notice strong {
  color: var(--ink-bright);
}

.initiative-manual-notice__icon {
  flex: 0 0 auto;
  color: var(--accent);
  font-weight: 900;
}

@media (max-width: 760px) {
  .initiative-command-row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .initiative-heading {
    flex-direction: column;
    gap: 0.55rem;
  }

  .initiative-tools,
  .initiative-actions {
    grid-template-columns: 1fr;
  }
}
</style>
