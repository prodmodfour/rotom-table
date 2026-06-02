<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

const props = defineProps<{
  title: string
  subtitle?: string | null
}>()

const titleId = 'sheet-healing-modal-title'

const emit = defineEmits<{
  close: []
}>()

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="sheet-healing-modal-backdrop" @pointerdown.self="emit('close')">
      <section
        class="sheet-healing-modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        @pointerdown.stop
      >
        <header class="sheet-healing-modal__header">
          <div>
            <p class="sheet-healing-modal__eyebrow">Recovery controls</p>
            <h2 :id="titleId">{{ props.title }}</h2>
            <p v-if="props.subtitle" class="sheet-healing-modal__subtitle">{{ props.subtitle }}</p>
          </div>
          <button type="button" class="sheet-healing-modal__close" @click="emit('close')">
            Close
          </button>
        </header>

        <div class="sheet-healing-modal__body">
          <slot />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet-healing-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(10, 8, 6, 0.72);
  backdrop-filter: blur(8px);
}

.sheet-healing-modal {
  width: min(980px, 100%);
  max-height: min(90vh, 820px);
  overflow: auto;
  border: 1px solid var(--rule);
  border-radius: 16px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}

.sheet-healing-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.sheet-healing-modal__eyebrow,
.sheet-healing-modal__subtitle {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.sheet-healing-modal__subtitle {
  margin-top: 0.25rem;
  color: var(--ink-soft);
  letter-spacing: 0.02em;
  text-transform: none;
}

.sheet-healing-modal__header h2 {
  margin: 0.15rem 0 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.3rem;
}

.sheet-healing-modal__close {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-bright);
  cursor: pointer;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 0.42rem 0.75rem;
}

.sheet-healing-modal__close:hover,
.sheet-healing-modal__close:focus-visible {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.16);
  outline: none;
}

.sheet-healing-modal__body :deep(.healing-panel) {
  box-shadow: none;
}

@media (max-width: 720px) {
  .sheet-healing-modal__header {
    flex-direction: column;
  }
}
</style>
