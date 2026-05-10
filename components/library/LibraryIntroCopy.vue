<template>
  <p class="library-intro-copy">
    <slot />
    <span v-if="$slots.hint" class="library-intro-copy__hint">
      <slot name="hint" />
    </span>
  </p>
</template>

<style scoped>
.library-intro-copy {
  margin: 0 0 0.85rem;
  color: var(--ink-soft);
  line-height: 1.5;
}

.library-intro-copy__hint {
  display: block;
  margin-top: 0.45rem;
  color: var(--ink-muted);
  font-size: 0.85em;
  font-style: italic;
}

.library-intro-copy :slotted(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--accent);
}
</style>
