<script setup lang="ts">
import type { SessionCommandRejectionNotice } from '~/utils/sessionCommandRejectionUi'

const props = defineProps<{
  notice: SessionCommandRejectionNotice
}>()

const emit = defineEmits<{
  (event: 'refresh-session'): void
  (event: 'dismiss'): void
}>()
</script>

<template>
  <aside
    class="session-command-rejection"
    role="alert"
    aria-live="assertive"
  >
    <div class="rejection-copy">
      <div class="rejection-kicker">
        <span>{{ props.notice.commandLabel }}</span>
        <span aria-hidden="true">•</span>
        <span>{{ props.notice.reasonLabel }}</span>
        <span>rev {{ props.notice.currentRevision }}</span>
      </div>
      <h2>{{ props.notice.title }}</h2>
      <p class="rejection-summary">{{ props.notice.summary }}</p>
      <p class="rejection-detail">{{ props.notice.detail }}</p>
      <p class="rejection-guidance">{{ props.notice.guidance }}</p>
    </div>

    <div class="rejection-actions" aria-label="Live session command rejection actions">
      <button type="button" class="refresh-button" @click="emit('refresh-session')">
        {{ props.notice.refreshLabel }}
      </button>
      <button type="button" class="dismiss-button" @click="emit('dismiss')">
        {{ props.notice.dismissLabel }}
      </button>
    </div>
  </aside>
</template>

<style scoped>
.session-command-rejection {
  position: absolute;
  top: var(--map-top-info-top, calc(var(--map-overlay-gutter, 0.75rem) + var(--map-initiative-info-bar-height, 4rem) + 0.6rem));
  left: 50%;
  z-index: 10900;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.9rem;
  align-items: center;
  width: min(44rem, calc(100vw - 2rem));
  transform: translateX(-50%);
  padding: 0.85rem 0.95rem;
  border: 1px solid color-mix(in srgb, var(--warn) 68%, rgba(255, 255, 255, 0.3));
  border-radius: 1rem;
  background: color-mix(in srgb, rgba(36, 22, 8, 0.94) 85%, var(--paper));
  color: var(--ink-bright);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.42);
}

.rejection-copy {
  min-width: 0;
}

.rejection-kicker {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.5rem;
  align-items: center;
  color: color-mix(in srgb, var(--warn) 88%, white);
  font-size: 0.72rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.session-command-rejection h2 {
  margin: 0.15rem 0 0;
  font-family: var(--font-book);
  font-size: clamp(1rem, 2vw, 1.25rem);
  line-height: 1.05;
}

.rejection-summary,
.rejection-detail,
.rejection-guidance {
  margin: 0.28rem 0 0;
  font-size: 0.84rem;
  line-height: 1.35;
}

.rejection-summary,
.rejection-guidance {
  color: color-mix(in srgb, var(--ink-bright) 86%, transparent);
}

.rejection-detail {
  font-weight: 900;
}

.rejection-actions {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  align-items: stretch;
}

.rejection-actions button {
  min-width: 9.4rem;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  padding: 0.55rem 0.8rem;
  color: var(--ink-bright);
  font-weight: 900;
  cursor: pointer;
}

.refresh-button {
  background: color-mix(in srgb, var(--warn) 70%, #2d1700);
}

.dismiss-button {
  background: rgba(255, 255, 255, 0.08);
}

.rejection-actions button:hover,
.rejection-actions button:focus-visible {
  border-color: rgba(255, 255, 255, 0.5);
  filter: brightness(1.08);
}

@media (max-width: 720px) {
  .session-command-rejection {
    grid-template-columns: 1fr;
  }

  .rejection-actions {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .rejection-actions button {
    min-width: 0;
    flex: 1 1 10rem;
  }
}
</style>
