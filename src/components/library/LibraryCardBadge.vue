<script setup lang="ts">
withDefaults(defineProps<{
  variant?: 'accent' | 'success' | 'shiny'
  spacing?: 'inline' | 'stacked'
}>(), {
  variant: 'accent',
  spacing: 'inline',
})
</script>

<template>
  <span
    class="library-card-badge"
    :class="[
      `library-card-badge--${variant}`,
      spacing === 'stacked' ? 'library-card-badge--stacked' : '',
    ]"
  >
    <slot />
  </span>
</template>

<style scoped>
.library-card-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  border-radius: 999px;
  padding: 0.22rem 0.65rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
}

.library-card-badge--stacked {
  margin-top: 0.45rem;
}

.library-card-badge--success {
  padding: 0.18rem 0.55rem;
  background: rgba(184, 187, 38, 0.12);
  color: var(--good);
  font-size: 0.72rem;
  font-weight: 700;
}

.library-card-badge--shiny {
  padding: 0.18rem 0.5rem;
  background: rgba(221, 210, 176, 0.16);
  color: var(--ink-bright);
  font-size: 0.95rem;
  font-weight: 400;
  line-height: 1;
  text-transform: none;
}
</style>
