<template>
  <ul class="library-card-meta-list">
    <slot />
  </ul>
</template>

<style scoped>
.library-card-meta-list {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  color: var(--ink-muted);
  font-size: 0.76rem;
  letter-spacing: 0.04em;
}

.library-card-meta-list :slotted(li) {
  padding: 0.1rem 0.45rem;
  border: 1px solid var(--rule);
  border-radius: 999px;
  background: var(--paper-inset);
}

.library-card-meta-list :slotted(.library-card-meta-list__badges) {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.22rem;
  padding: 0;
  border: 0;
  background: transparent;
}
</style>
