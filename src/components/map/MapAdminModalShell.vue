<script setup lang="ts">
defineProps<{
  titleId: string
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()
</script>

<template>
  <div
    class="admin-panel-backdrop"
    role="presentation"
    @pointerdown.self="emit('close')"
  >
    <section
      class="admin-panel"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      @pointerdown.stop
    >
      <slot />
    </section>
  </div>
</template>

<style scoped>
.admin-panel-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: 1rem;
  background:
    radial-gradient(circle at top, rgba(255, 31, 45, 0.16), transparent 40%),
    rgba(5, 6, 8, 0.62);
  backdrop-filter: blur(3px) saturate(125%);
  -webkit-backdrop-filter: blur(3px) saturate(125%);
}

.admin-panel {
  width: min(720px, 100%);
  max-height: min(92vh, 980px);
  overflow-y: auto;
  border: 1px solid var(--rule-soft);
  border-radius: 18px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--ink-bright) 9%, transparent) 0 18%,
      transparent 18% 100%
    ),
    color-mix(in srgb, var(--paper-soft) 88%, transparent);
  box-shadow:
    var(--shadow-card),
    inset 0 1px 0 color-mix(in srgb, var(--ink-bright) 10%, transparent);
  padding: 1rem;
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
}
</style>
