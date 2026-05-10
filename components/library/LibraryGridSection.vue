<script setup lang="ts">
withDefaults(defineProps<{
  hasAnything: boolean
  loading?: boolean
  searchTerm: string
}>(), {
  loading: false,
})
</script>

<template>
  <section class="library-section">
    <div v-if="hasAnything" class="library-grid">
      <slot />
    </div>

    <p v-else-if="loading" class="empty-state">
      <slot name="loading">Loading…</slot>
    </p>
    <p v-else-if="searchTerm" class="empty-state">
      <slot name="search-empty">Nothing matches that search.</slot>
    </p>
    <p v-else class="empty-state">
      <slot name="empty" />
    </p>
  </section>
</template>

<style scoped>
.library-section {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.7rem;
  align-items: stretch;
}

.empty-state {
  margin: 1.5rem 0;
  text-align: center;
  color: var(--ink-muted);
  font-style: italic;
}
</style>
