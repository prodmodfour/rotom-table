<script setup lang="ts">
import type { MoveAutomationScript } from '~/types/moveAutomation'

const manualNote = defineModel<string>('manualNote', { required: true })

defineProps<{
  script: MoveAutomationScript
}>()
</script>

<template>
  <section class="move-resolution__section">
    <header class="move-resolution__section-header"><h3>Manual note</h3></header>
    <textarea v-model="manualNote" rows="3" placeholder="Unique move text, GM ruling, ability/item modifiers…" />
  </section>

  <section v-if="script.automationNotes.length" class="move-resolution__section is-warning">
    <header class="move-resolution__section-header"><h3>Script notes</h3></header>
    <ul>
      <li v-for="note in script.automationNotes" :key="note">{{ note }}</li>
    </ul>
  </section>
</template>

<style scoped>
.move-resolution__section {
  padding: 0.85rem;
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper);
}

.move-resolution__section h3 {
  margin: 0;
}

.move-resolution__section-header {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  align-items: center;
}

.move-resolution__section textarea {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  padding: 0.55rem 0.65rem;
  font: inherit;
}

.is-warning {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--rule-soft));
}

.is-warning ul {
  margin: 0.45rem 0 0;
  padding-left: 1.1rem;
}
</style>
