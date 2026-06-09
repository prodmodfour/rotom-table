<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  entryCount: number
}>()

const emit = defineEmits<{
  (event: 'clear-combat-log'): void
}>()

const entryCountLabel = computed(() => {
  const count = Math.max(0, props.entryCount)
  return `${count} combat log ${count === 1 ? 'entry' : 'entries'}`
})
</script>

<template>
  <section class="combat-log-control" aria-labelledby="admin-combat-log-heading">
    <div>
      <h3 id="admin-combat-log-heading">Combat log</h3>
      <p>{{ entryCountLabel }}</p>
    </div>

    <button
      type="button"
      class="combat-log-control__button"
      :disabled="entryCount <= 0"
      @click="emit('clear-combat-log')"
    >
      Clear combat log
    </button>
  </section>
</template>

<style scoped>
.combat-log-control {
  display: grid;
  gap: 0.75rem;
  margin: 0 0 1rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-soft);
  padding: 0.8rem;
}

.combat-log-control h3,
.combat-log-control p {
  margin: 0;
}

.combat-log-control h3 {
  color: var(--ink-muted);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.combat-log-control p {
  margin-top: 0.28rem;
  color: var(--ink-soft);
  font-size: 0.86rem;
  line-height: 1.35;
}

.combat-log-control__button {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--bad);
  padding: 0.55rem 0.75rem;
  cursor: pointer;
  font: inherit;
  font-weight: 800;
  letter-spacing: 0.04em;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.combat-log-control__button:hover:not(:disabled),
.combat-log-control__button:focus-visible:not(:disabled) {
  border-color: var(--bad);
  background: rgba(255, 31, 45, 0.08);
  outline: none;
}

.combat-log-control__button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
