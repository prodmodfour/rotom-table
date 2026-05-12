<script setup lang="ts">
defineProps<{
  targetKind: string
  targetLabel: string
}>()
</script>

<template>
  <header class="ctx-header">
    <span class="ctx-kind">{{ targetKind }}</span>
    <span class="ctx-target">{{ targetLabel }}</span>
  </header>
</template>

<style scoped>
.ctx-header {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.4rem 0.55rem 0.55rem;
  border-bottom: 1px solid var(--rule-soft);
  margin-bottom: 0.25rem;
}

.ctx-kind {
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.ctx-target {
  font-family: var(--font-book);
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--ink-bright);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
