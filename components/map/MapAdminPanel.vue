<script setup lang="ts">
import { textValueFromEvent } from '~/utils/domEvents'

defineProps<{
  groundLevelYMax: number
  mapGroundLevelY: number
  mapSpecificYMin: number
  mapSpecificYMax: number
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'set-ground-level-y', value: string): void
}>()

</script>

<template>
  <div
    class="admin-panel-backdrop"
    role="presentation"
    @pointerdown.self="emit('close')"
  >
    <section
      class="admin-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-panel-title"
      @pointerdown.stop
    >
      <div class="admin-panel__header">
        <div>
          <p class="admin-panel__eyebrow">Admin · Ctrl+Shift+A</p>
          <h2 id="admin-panel-title">Map control panel</h2>
        </div>
        <button
          type="button"
          class="admin-panel__close"
          aria-label="Close admin control panel"
          @click="emit('close')"
        >
          ×
        </button>
      </div>

      <div class="admin-field">
        <label for="admin-ground-level-y">
          <span>Map-specific Y=0 / ground level</span>
          <input
            id="admin-ground-level-y"
            type="number"
            min="0"
            :max="groundLevelYMax"
            :value="mapGroundLevelY"
            @input="emit('set-ground-level-y', textValueFromEvent($event))"
          />
        </label>
        <p class="admin-field__hint">
          Set the absolute Y layer that should be shown as ground Y=0.
          Absolute Y=0 remains the lowest layer of the map.
        </p>
      </div>

      <dl class="admin-y-summary">
        <div>
          <dt>Absolute ground layer</dt>
          <dd>{{ mapGroundLevelY }}</dd>
        </div>
        <div>
          <dt>Map-specific Y range</dt>
          <dd>{{ mapSpecificYMin }} … {{ mapSpecificYMax }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>

<style scoped>
.admin-panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(29, 32, 33, 0.58);
  backdrop-filter: blur(2px);
}

.admin-panel {
  width: min(440px, 100%);
  border: 1px solid var(--rule-strong);
  border-radius: 18px;
  background: var(--paper);
  box-shadow: var(--shadow-card);
  padding: 1rem;
}

.admin-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.admin-panel__eyebrow {
  margin: 0 0 0.2rem;
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.admin-panel h2 {
  margin: 0;
  font-family: var(--font-book);
  color: var(--ink-bright);
}

.admin-panel__close {
  width: 34px;
  height: 34px;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-size: 1.4rem;
  line-height: 1;
}

.admin-panel__close:hover,
.admin-panel__close:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

.admin-field label {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.admin-field label span {
  color: var(--ink-muted);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.admin-field__hint {
  margin: 0.55rem 0 0;
  color: var(--ink-soft);
  font-size: 0.86rem;
  line-height: 1.45;
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
  box-shadow: 0 0 0 2px rgba(250, 189, 47, 0.18);
}

.admin-y-summary {
  display: grid;
  gap: 0.55rem;
  margin: 1rem 0 0;
}

.admin-y-summary div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  background: var(--paper-soft);
  padding: 0.65rem 0.75rem;
}

.admin-y-summary dt,
.admin-y-summary dd {
  margin: 0;
}

.admin-y-summary dt {
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.admin-y-summary dd {
  color: var(--accent);
  font-weight: 800;
  white-space: nowrap;
}
</style>
