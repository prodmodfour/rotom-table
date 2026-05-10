<script setup lang="ts">
defineProps<{
  titleId: string
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()
</script>

<template>
  <div class="move-automation-backdrop" @pointerdown.self="emit('close')" @contextmenu.prevent>
    <section class="move-automation" role="dialog" aria-modal="true" :aria-labelledby="titleId" @pointerdown.stop>
      <slot />
    </section>
  </div>
</template>

<style scoped>
.move-automation-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(29, 32, 33, 0.56);
  backdrop-filter: blur(3px);
}

.move-automation {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  width: min(1120px, 96vw);
  max-height: min(92vh, 980px);
  overflow: hidden;
  border: 1px solid var(--rule-soft);
  border-radius: 18px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  color: var(--ink);
}
</style>
