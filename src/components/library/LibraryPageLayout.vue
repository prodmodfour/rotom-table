<script setup lang="ts">
defineProps<{
  dragging?: boolean
}>()
</script>

<template>
  <main class="library-layout" :class="{ 'is-dragging': dragging }">
    <header class="library-header">
      <slot name="header" />
    </header>

    <slot />
  </main>
</template>

<style scoped>
.library-layout {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  padding: 0.85rem;
  min-height: 100vh;
  background: var(--paper);
  color: var(--ink);
}

.library-header {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
</style>
