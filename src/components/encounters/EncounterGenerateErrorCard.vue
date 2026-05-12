<script setup lang="ts">
defineProps<{
  message: string
}>()
</script>

<template>
  <section class="panel-card error-card">
    <h2 class="panel-title">Generation failed</h2>
    <p class="error-message">{{ message }}</p>
  </section>
</template>

<style scoped>
.panel-card {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 1.1rem 1.2rem;
}

.panel-title {
  margin: 0 0 0.85rem;
  font-family: var(--font-book);
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-bright);
  text-transform: uppercase;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.error-card {
  border-color: rgba(251, 73, 52, 0.45);
  background: rgba(251, 73, 52, 0.08);
}

.error-message {
  margin: 0;
  color: var(--bad);
  font-family: var(--font-mono);
  font-size: 0.9rem;
  white-space: pre-wrap;
}
</style>
