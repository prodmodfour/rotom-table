<template>
  <p class="hint">
    <slot />
  </p>
</template>

<style scoped>
.hint {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  line-height: 1.4;
}
</style>
