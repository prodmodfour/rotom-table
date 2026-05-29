<script setup lang="ts">
defineProps<{
  title?: string
  badge?: string
}>()
</script>

<template>
  <section class="library-intro-panel">
    <div v-if="title || badge" class="library-intro-panel__heading">
      <h1 v-if="title">{{ title }}</h1>
      <span v-if="badge" class="library-intro-panel__badge">{{ badge }}</span>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.library-intro-panel {
  border: 1px solid var(--rule);
  border-radius: 14px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}

.library-intro-panel__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.4rem;
}

.library-intro-panel__heading h1 {
  margin: 0;
  font-family: var(--font-book);
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-bright);
}

.library-intro-panel__badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
</style>
