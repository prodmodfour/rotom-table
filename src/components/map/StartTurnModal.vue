<script setup lang="ts">
import { PhX } from '@phosphor-icons/vue'
import { computed, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  characterName: string
  characterMeta?: string | null
  profileUrl?: string | null
  accentColor?: string | null
  round: number
  canManage: boolean
  busy?: boolean
}>(), {
  characterMeta: null,
  profileUrl: null,
  accentColor: null,
  busy: false,
})

const emit = defineEmits<{
  (event: 'close'): void
}>()

const dialogRef = ref<HTMLElement | null>(null)

const accentStyle = computed(() => (
  props.accentColor ? { '--start-turn-accent': props.accentColor } : {}
))

const close = () => {
  if (!props.canManage || props.busy) return
  emit('close')
}

onMounted(() => {
  dialogRef.value?.focus()
})
</script>

<template>
  <div
    class="start-turn-modal-backdrop"
    role="presentation"
    @pointerdown.self="close"
  >
    <section
      ref="dialogRef"
      class="start-turn-modal"
      :style="accentStyle"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-turn-modal-title"
      aria-describedby="start-turn-modal-description"
      tabindex="-1"
      @pointerdown.stop
    >
      <header class="start-turn-modal__header">
        <div class="start-turn-modal__identity">
          <span v-if="profileUrl" class="start-turn-modal__portrait" aria-hidden="true">
            <img :src="profileUrl" alt="" draggable="false">
          </span>
          <span v-else class="start-turn-modal__portrait start-turn-modal__portrait--fallback" aria-hidden="true">
            {{ characterName.slice(0, 1).toUpperCase() }}
          </span>

          <span class="start-turn-modal__title-group">
            <span class="start-turn-modal__eyebrow">Start of turn · Round {{ round }}</span>
            <h2 id="start-turn-modal-title" class="start-turn-modal__title">
              {{ characterName }}'s turn
            </h2>
            <span v-if="characterMeta" class="start-turn-modal__meta">{{ characterMeta }}</span>
          </span>
        </div>

        <button
          v-if="canManage"
          type="button"
          class="start-turn-modal__close"
          aria-label="Close start-of-turn modal"
          :disabled="busy"
          @click="close"
        >
          <PhX :size="18" weight="bold" aria-hidden="true" />
        </button>
      </header>

      <div id="start-turn-modal-description" class="start-turn-modal__body">
        <p class="start-turn-modal__empty">Start-of-turn options will appear here.</p>
        <p v-if="!canManage" class="start-turn-modal__sync-note">
          Waiting for the GM to resolve this start-of-turn step.
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.start-turn-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 52;
  display: grid;
  place-items: center;
  padding: clamp(0.75rem, 2vw, 1.5rem);
  background:
    radial-gradient(circle at top, color-mix(in srgb, var(--start-turn-accent, var(--accent)) 22%, transparent), transparent 42%),
    rgba(5, 6, 8, 0.62);
  backdrop-filter: blur(4px) saturate(125%);
  -webkit-backdrop-filter: blur(4px) saturate(125%);
}

.start-turn-modal {
  --start-turn-accent: var(--accent);

  width: min(520px, 100%);
  display: grid;
  gap: 1rem;
  border: 1px solid color-mix(in srgb, var(--start-turn-accent) 62%, var(--rule-soft));
  border-radius: 22px;
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--start-turn-accent) 13%, transparent) 0 24%,
      transparent 24% 100%
    ),
    color-mix(in srgb, var(--paper-soft) 90%, transparent);
  box-shadow:
    var(--shadow-card),
    inset 0 1px 0 color-mix(in srgb, var(--ink-bright) 10%, transparent);
  color: var(--ink);
  padding: clamp(1rem, 2vw, 1.2rem);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
}

.start-turn-modal:focus {
  outline: none;
}

.start-turn-modal__header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.85rem;
  align-items: start;
}

.start-turn-modal__identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.8rem;
}

.start-turn-modal__portrait {
  display: inline-grid;
  width: 3.4rem;
  height: 3.4rem;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--start-turn-accent) 65%, var(--rule-soft));
  border-radius: 18px;
  background: color-mix(in srgb, var(--start-turn-accent) 16%, var(--paper-inset));
  color: var(--start-turn-accent);
  font-family: var(--font-book);
  font-size: 1.55rem;
  font-weight: 800;
}

.start-turn-modal__portrait img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.start-turn-modal__title-group {
  display: grid;
  min-width: 0;
  gap: 0.18rem;
}

.start-turn-modal__eyebrow,
.start-turn-modal__meta,
.start-turn-modal__sync-note {
  color: var(--ink-muted);
  font-size: 0.82rem;
}

.start-turn-modal__eyebrow {
  color: var(--start-turn-accent);
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.start-turn-modal__title {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: clamp(1.35rem, 2.6vw, 1.85rem);
  letter-spacing: 0.04em;
}

.start-turn-modal__close {
  display: inline-grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-bright);
  cursor: pointer;
  font: inherit;
  line-height: 1;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.start-turn-modal__close:hover,
.start-turn-modal__close:focus-visible {
  border-color: color-mix(in srgb, var(--start-turn-accent) 72%, var(--rule-strong));
  background: var(--paper-hover);
  color: var(--start-turn-accent);
}

.start-turn-modal__close:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--start-turn-accent) 36%, transparent);
  outline-offset: 3px;
}

.start-turn-modal__close:disabled {
  cursor: wait;
  opacity: 0.58;
}

.start-turn-modal__body {
  display: grid;
  gap: 0.65rem;
  min-height: 7rem;
  border: 1px dashed color-mix(in srgb, var(--start-turn-accent) 35%, var(--rule-soft));
  border-radius: 16px;
  background: color-mix(in srgb, var(--paper-inset) 74%, transparent);
  padding: 1rem;
}

.start-turn-modal__empty,
.start-turn-modal__sync-note {
  margin: 0;
}

.start-turn-modal__empty {
  color: var(--ink);
  font-weight: 700;
}
</style>
