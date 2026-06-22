<script setup lang="ts">
import { PhX } from '@phosphor-icons/vue'

withDefaults(defineProps<{
  closeLabel?: string
  eyebrow?: string
  subtitle?: string | null
  title: string
  titleId: string
}>(), {
  closeLabel: 'Close GM admin panel',
  eyebrow: 'GM admin · Ctrl+Shift+A',
  subtitle: null,
})

const emit = defineEmits<{
  (event: 'close'): void
}>()
</script>

<template>
  <header class="gm-admin-panel-header">
    <div>
      <p class="gm-admin-panel-header__eyebrow">{{ eyebrow }}</p>
      <h2 :id="titleId">{{ title }}</h2>
      <p v-if="subtitle" class="gm-admin-panel-header__subtitle">{{ subtitle }}</p>
    </div>
    <button
      type="button"
      class="gm-admin-panel-header__close"
      :aria-label="closeLabel"
      @click="emit('close')"
    >
      <PhX :size="18" weight="bold" aria-hidden="true" />
    </button>
  </header>
</template>

<style scoped>
.gm-admin-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.gm-admin-panel-header__eyebrow {
  margin: 0 0 0.2rem;
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.gm-admin-panel-header h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
}

.gm-admin-panel-header__subtitle {
  margin: 0.18rem 0 0;
  color: var(--ink-soft);
  font-size: 0.85rem;
}

.gm-admin-panel-header__close {
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

.gm-admin-panel-header__close:hover,
.gm-admin-panel-header__close:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
}
</style>
