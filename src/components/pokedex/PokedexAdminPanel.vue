<script setup lang="ts">
defineProps<{
  errorMessage: string | null
  isRestoring: boolean
  species: string | null
  statusMessage: string | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'restore-from-books'): void
}>()
</script>

<template>
  <div
    class="pokedex-admin-backdrop"
    role="presentation"
    @pointerdown.self="emit('close')"
  >
    <section
      class="pokedex-admin-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pokedex-admin-title"
      @pointerdown.stop
    >
      <header class="pokedex-admin-panel__header">
        <div>
          <p class="pokedex-admin-panel__eyebrow">Admin · Ctrl+A</p>
          <h2 id="pokedex-admin-title">Pokédex admin</h2>
        </div>
        <button
          type="button"
          class="pokedex-admin-panel__close"
          aria-label="Close Pokédex admin panel"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <button
        type="button"
        class="pokedex-admin-panel__restore"
        :disabled="!species || isRestoring"
        @click="emit('restore-from-books')"
      >
        {{ isRestoring ? 'Restoring…' : `Restore ${species ?? 'Pokémon'} from PTU markdown books` }}
      </button>

      <p v-if="errorMessage" class="pokedex-admin-panel__message pokedex-admin-panel__message--error">
        {{ errorMessage }}
      </p>
      <p v-else-if="statusMessage" class="pokedex-admin-panel__message pokedex-admin-panel__message--success">
        {{ statusMessage }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.pokedex-admin-backdrop {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: grid;
  place-items: center;
  padding: 1rem;
  background:
    radial-gradient(circle at top, rgba(255, 31, 45, 0.16), transparent 40%),
    rgba(5, 6, 8, 0.62);
  backdrop-filter: blur(3px) saturate(125%);
  -webkit-backdrop-filter: blur(3px) saturate(125%);
}

.pokedex-admin-panel {
  width: min(440px, 100%);
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 18px;
  background:
    linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.10) 0 18%,
      transparent 18% 100%
    ),
    rgba(12, 14, 18, 0.86);
  box-shadow:
    var(--shadow-card),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
  color: var(--ink);
  padding: 1rem;
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
}

.pokedex-admin-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.pokedex-admin-panel__eyebrow {
  margin: 0 0 0.2rem;
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.pokedex-admin-panel__header h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
}

.pokedex-admin-panel__close {
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

.pokedex-admin-panel__close:hover,
.pokedex-admin-panel__close:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}

.pokedex-admin-panel__restore {
  width: 100%;
  border: 1px solid var(--accent);
  border-radius: 14px;
  background: var(--accent);
  color: #050608;
  cursor: pointer;
  font: inherit;
  font-weight: 900;
  padding: 0.8rem 1rem;
}

.pokedex-admin-panel__restore:hover:not(:disabled),
.pokedex-admin-panel__restore:focus-visible:not(:disabled) {
  filter: brightness(1.08);
  outline: none;
}

.pokedex-admin-panel__restore:disabled {
  cursor: wait;
  opacity: 0.64;
}

.pokedex-admin-panel__message {
  margin: 0.8rem 0 0;
  border-radius: 12px;
  padding: 0.7rem 0.8rem;
  font-weight: 700;
}

.pokedex-admin-panel__message--error {
  background: rgba(255, 80, 80, 0.16);
  color: #ffb5b5;
}

.pokedex-admin-panel__message--success {
  background: rgba(95, 220, 125, 0.15);
  color: #a8efb4;
}
</style>
