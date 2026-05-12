<script setup lang="ts">
defineProps<{
  titleId: string
  userSpecies: string
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()
</script>

<template>
  <header class="move-automation__header">
    <div>
      <p class="move-automation__eyebrow">Use Move</p>
      <h2 :id="titleId">{{ userSpecies }}</h2>
    </div>
    <button type="button" class="move-automation__close" aria-label="Close" @click="emit('close')">
      ×
    </button>
  </header>
</template>

<style scoped>
.move-automation__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--rule-soft);
}

.move-automation__eyebrow {
  margin: 0 0 0.1rem;
  color: var(--ink-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.move-automation__header h2 {
  margin: 0;
}

.move-automation__close {
  width: 2.1rem;
  height: 2.1rem;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
  font: inherit;
  font-size: 1.4rem;
  line-height: 1;
}
</style>
