<script setup lang="ts">
import { onMounted, ref } from 'vue'

withDefaults(defineProps<{
  title: string
  titleId: string
  descriptionId: string
  shortcutKeys: readonly string[]
  badge?: string
  size?: 'compact' | 'standard' | 'wide'
}>(), {
  badge: undefined,
  size: 'standard',
})

const emit = defineEmits<{
  (event: 'close'): void
}>()

const dialogRef = ref<HTMLElement | null>(null)

onMounted(() => {
  dialogRef.value?.focus()
})
</script>

<template>
  <div
    class="map-menu-modal-backdrop"
    role="presentation"
    @pointerdown.self="emit('close')"
  >
    <section
      ref="dialogRef"
      class="map-menu-modal"
      :class="`map-menu-modal--${size}`"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="descriptionId"
      tabindex="-1"
      @pointerdown.stop
    >
      <header class="map-menu-modal__header">
        <div class="map-menu-modal__title-group">
          <p :id="descriptionId" class="map-menu-modal__eyebrow">
            <span>Map menu</span>
            <span aria-hidden="true">·</span>
            <kbd v-for="key in shortcutKeys" :key="key">{{ key }}</kbd>
          </p>
          <h2 :id="titleId" class="map-menu-modal__title">
            {{ title }}
          </h2>
        </div>

        <span v-if="badge" class="map-menu-modal__badge">{{ badge }}</span>

        <button
          type="button"
          class="map-menu-modal__close"
          :aria-label="`Close ${title} menu`"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <div class="map-menu-modal__body">
        <slot />
      </div>
    </section>
  </div>
</template>

<style scoped>
.map-menu-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: grid;
  place-items: center;
  padding: clamp(0.75rem, 2vw, 1.5rem);
  background:
    radial-gradient(circle at top, rgba(255, 31, 45, 0.14), transparent 42%),
    rgba(5, 6, 8, 0.66);
  backdrop-filter: blur(4px) saturate(125%);
  -webkit-backdrop-filter: blur(4px) saturate(125%);
}

.map-menu-modal {
  --map-menu-modal-width: 760px;

  width: min(var(--map-menu-modal-width), 100%);
  max-height: min(86dvh, 780px);
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 22px;
  background:
    linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.10) 0 18%,
      transparent 18% 100%
    ),
    rgba(12, 14, 18, 0.84);
  box-shadow:
    var(--shadow-card, 0 18px 52px rgba(0, 0, 0, 0.34)),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
  padding: clamp(0.9rem, 2vw, 1.15rem);
  overflow: hidden;
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
}

.map-menu-modal--compact {
  --map-menu-modal-width: 560px;
}

.map-menu-modal--wide {
  --map-menu-modal-width: 840px;
}

.map-menu-modal:focus {
  outline: none;
}

.map-menu-modal__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: start;
  gap: 0.75rem;
  border-bottom: 1px solid var(--rule, rgba(255, 255, 255, 0.18));
  padding-bottom: 0.85rem;
}

.map-menu-modal__title-group {
  min-width: 0;
}

.map-menu-modal__eyebrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  margin: 0 0 0.25rem;
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.map-menu-modal__eyebrow kbd {
  border: 1px solid var(--rule-soft, rgba(255, 255, 255, 0.24));
  border-radius: 6px;
  background: var(--paper-inset, rgba(5, 6, 8, 0.34));
  color: var(--ink-bright);
  font-family: var(--font-mono, monospace);
  font-size: 0.7rem;
  line-height: 1;
  padding: 0.15rem 0.32rem;
}

.map-menu-modal__title {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: clamp(1.3rem, 2.4vw, 1.75rem);
  letter-spacing: 0.04em;
}

.map-menu-modal__badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.28rem 0.72rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}

.map-menu-modal__close {
  display: inline-grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border: 1px solid var(--rule-soft, rgba(255, 255, 255, 0.24));
  border-radius: 999px;
  background: var(--paper, rgba(5, 6, 8, 0.42));
  color: var(--ink-bright);
  cursor: pointer;
  font: inherit;
  font-size: 1.35rem;
  line-height: 1;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.map-menu-modal__close:hover,
.map-menu-modal__close:focus-visible {
  border-color: var(--rule-strong, rgba(255, 255, 255, 0.34));
  background: var(--paper-hover, rgba(255, 255, 255, 0.10));
  color: var(--accent);
}

.map-menu-modal__close:focus-visible {
  outline: 2px solid rgba(255, 31, 45, 0.35);
  outline-offset: 3px;
}

.map-menu-modal__body {
  min-height: 0;
  overflow: auto;
  padding-right: 0.15rem;
  overscroll-behavior: contain;
}

@media (max-width: 640px) {
  .map-menu-modal__header {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .map-menu-modal__badge {
    grid-column: 1 / -1;
    width: fit-content;
  }
}
</style>
