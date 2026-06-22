<script setup lang="ts">
import { PhX } from '@phosphor-icons/vue'

defineProps<{
  errorMessage: string | null
  sheetLabel: string | null
  statPointsBudget: number | null
  statusMessage: string | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'randomize-added-stats'): void
}>()
</script>

<template>
  <div
    class="sheet-admin-backdrop"
    role="presentation"
    @pointerdown.self="emit('close')"
  >
    <section
      class="sheet-admin-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sheet-admin-title"
      @pointerdown.stop
    >
      <header class="sheet-admin-panel__header">
        <div>
          <p class="sheet-admin-panel__eyebrow">GM admin · Ctrl+Shift+A</p>
          <h2 id="sheet-admin-title">Sheet admin</h2>
          <p v-if="sheetLabel" class="sheet-admin-panel__subtitle">{{ sheetLabel }}</p>
        </div>
        <button
          type="button"
          class="sheet-admin-panel__close"
          aria-label="Close sheet admin panel"
          @click="emit('close')"
        >
          <PhX :size="18" weight="bold" aria-hidden="true" />
        </button>
      </header>

      <section class="sheet-admin-panel__action-card" aria-labelledby="randomize-added-stats-title">
        <div>
          <h3 id="randomize-added-stats-title">Randomise Added Stats</h3>
          <p>
            Overwrite the Added column with a random legal allocation of this Pokémon's
            {{ statPointsBudget ?? 'Level + 10' }} Stat Points. Combat Stages are unchanged.
          </p>
        </div>
        <button
          type="button"
          class="sheet-admin-panel__primary-action"
          @click="emit('randomize-added-stats')"
        >
          Randomise added stats
        </button>
      </section>

      <p v-if="errorMessage" class="sheet-admin-panel__message sheet-admin-panel__message--error">
        {{ errorMessage }}
      </p>
      <p v-else-if="statusMessage" class="sheet-admin-panel__message sheet-admin-panel__message--success">
        {{ statusMessage }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.sheet-admin-backdrop {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: grid;
  place-items: center;
  padding: 1rem;
  background:
    radial-gradient(circle at top, rgba(var(--accent-rgb), 0.18), transparent 40%),
    rgba(5, 6, 8, 0.62);
  backdrop-filter: blur(3px) saturate(125%);
  -webkit-backdrop-filter: blur(3px) saturate(125%);
}

.sheet-admin-panel {
  width: min(480px, 100%);
  border: 1px solid var(--rule-soft);
  border-radius: 18px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--ink-bright) 8%, transparent) 0 18%,
      transparent 18% 100%
    ),
    color-mix(in srgb, var(--paper-soft) 92%, transparent);
  box-shadow:
    var(--shadow-card),
    inset 0 1px 0 color-mix(in srgb, var(--ink-bright) 10%, transparent);
  color: var(--ink);
  padding: 1rem;
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
}

.sheet-admin-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.sheet-admin-panel__eyebrow {
  margin: 0 0 0.2rem;
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.sheet-admin-panel__header h2,
.sheet-admin-panel__action-card h3 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
}

.sheet-admin-panel__subtitle {
  margin: 0.18rem 0 0;
  color: var(--ink-soft);
  font-size: 0.85rem;
}

.sheet-admin-panel__close {
  display: inline-grid;
  width: 34px;
  height: 34px;
  place-items: center;
  padding: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper-soft);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  line-height: 1;
}

.sheet-admin-panel__close:hover,
.sheet-admin-panel__close:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

.sheet-admin-panel__action-card {
  display: grid;
  gap: 0.85rem;
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-inset);
}

.sheet-admin-panel__action-card h3 {
  font-size: 1rem;
}

.sheet-admin-panel__action-card p {
  margin: 0.3rem 0 0;
  color: var(--ink-soft);
  font-size: 0.82rem;
  line-height: 1.45;
}

.sheet-admin-panel__primary-action {
  width: 100%;
  border: 1px solid var(--accent);
  border-radius: 14px;
  background: var(--accent);
  color: var(--accent-contrast);
  cursor: pointer;
  font: inherit;
  font-weight: 900;
  padding: 0.8rem 1rem;
}

.sheet-admin-panel__primary-action:hover,
.sheet-admin-panel__primary-action:focus-visible {
  filter: brightness(1.08);
  outline: none;
}

.sheet-admin-panel__message {
  margin: 0.8rem 0 0;
  border-radius: 12px;
  padding: 0.7rem 0.8rem;
  font-weight: 700;
}

.sheet-admin-panel__message--error {
  background: color-mix(in srgb, var(--bad) 14%, transparent);
  color: var(--bad);
}

.sheet-admin-panel__message--success {
  background: color-mix(in srgb, var(--good) 14%, transparent);
  color: var(--good);
}
</style>
