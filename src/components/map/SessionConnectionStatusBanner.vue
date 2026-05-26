<script setup lang="ts">
import type { SessionConnectionStatusNotice } from '~/utils/sessionConnectionStatusUi'

const props = defineProps<{
  notice: SessionConnectionStatusNotice
}>()

const emit = defineEmits<{
  (event: 'refresh-session'): void
}>()
</script>

<template>
  <aside
    class="session-connection-status"
    :class="`session-connection-status--${props.notice.tone}`"
    role="status"
    aria-live="polite"
  >
    <span class="session-connection-status__pulse" aria-hidden="true" />
    <div class="session-connection-status__copy">
      <p class="session-connection-status__kicker">
        <span>Session socket</span>
        <span aria-hidden="true">•</span>
        <span>{{ props.notice.currentRevision === null ? 'revision unknown' : `rev ${props.notice.currentRevision}` }}</span>
      </p>
      <h2>{{ props.notice.title }}</h2>
      <p>{{ props.notice.summary }}</p>
      <p class="session-connection-status__detail">{{ props.notice.detail }}</p>
    </div>
    <button
      v-if="props.notice.actionLabel"
      type="button"
      class="session-connection-status__action"
      @click="emit('refresh-session')"
    >
      {{ props.notice.actionLabel }}
    </button>
  </aside>
</template>

<style scoped>
.session-connection-status {
  position: absolute;
  z-index: 7;
  top: var(--map-overlay-gutter, 0.75rem);
  left: calc(var(--map-overlay-gutter, 0.75rem) + var(--map-nav-rail-width, 0px) + 0.75rem);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 0.62rem;
  align-items: center;
  width: min(32rem, calc(100vw - var(--map-nav-rail-width, 0px) - 2.5rem));
  padding: 0.68rem 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.9rem;
  background: color-mix(in srgb, rgba(8, 10, 14, 0.88) 86%, var(--paper));
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.34);
  color: var(--ink-bright);
  pointer-events: auto;
  backdrop-filter: blur(14px) saturate(135%);
  -webkit-backdrop-filter: blur(14px) saturate(135%);
}

.session-connection-status--info {
  border-color: color-mix(in srgb, var(--accent) 56%, rgba(255, 255, 255, 0.2));
}

.session-connection-status--success {
  border-color: rgba(99, 232, 137, 0.52);
}

.session-connection-status--warning {
  border-color: color-mix(in srgb, var(--warn) 70%, rgba(255, 255, 255, 0.2));
}

.session-connection-status--danger {
  border-color: color-mix(in srgb, var(--bad) 70%, rgba(255, 255, 255, 0.22));
}

.session-connection-status__pulse {
  width: 0.72rem;
  height: 0.72rem;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
}

.session-connection-status--success .session-connection-status__pulse {
  background: #63e889;
  box-shadow: 0 0 0 3px rgba(99, 232, 137, 0.16), 0 0 12px rgba(99, 232, 137, 0.32);
}

.session-connection-status--warning .session-connection-status__pulse {
  background: var(--warn);
  box-shadow: 0 0 0 3px rgba(255, 187, 78, 0.16), 0 0 12px rgba(255, 187, 78, 0.32);
}

.session-connection-status--danger .session-connection-status__pulse {
  background: var(--bad);
  box-shadow: 0 0 0 3px rgba(255, 92, 110, 0.18), 0 0 12px rgba(255, 92, 110, 0.34);
}

.session-connection-status__copy {
  min-width: 0;
}

.session-connection-status__kicker {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.42rem;
  margin: 0;
  color: color-mix(in srgb, var(--accent) 82%, white);
  font-size: 0.58rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.session-connection-status--success .session-connection-status__kicker {
  color: #9ff5b7;
}

.session-connection-status--warning .session-connection-status__kicker {
  color: color-mix(in srgb, var(--warn) 88%, white);
}

.session-connection-status--danger .session-connection-status__kicker {
  color: color-mix(in srgb, var(--bad) 82%, white);
}

.session-connection-status h2 {
  margin: 0.12rem 0 0;
  font-family: var(--font-book);
  font-size: 0.98rem;
  line-height: 1.05;
}

.session-connection-status p {
  margin: 0.18rem 0 0;
  color: color-mix(in srgb, var(--ink-bright) 84%, transparent);
  font-size: 0.72rem;
  font-weight: 800;
  line-height: 1.28;
}

.session-connection-status__detail {
  color: color-mix(in srgb, var(--ink-bright) 70%, transparent) !important;
}

.session-connection-status__action {
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  padding: 0.5rem 0.68rem;
  background: rgba(255, 255, 255, 0.08);
  color: var(--ink-bright);
  font-size: 0.72rem;
  font-weight: 900;
  cursor: pointer;
}

.session-connection-status__action:hover,
.session-connection-status__action:focus-visible {
  border-color: rgba(255, 255, 255, 0.52);
  filter: brightness(1.08);
}

@media (max-width: 840px) {
  .session-connection-status {
    left: var(--map-overlay-gutter, 0.75rem);
    width: min(30rem, calc(100vw - 1.5rem));
  }
}

@media (max-width: 640px) {
  .session-connection-status {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .session-connection-status__action {
    grid-column: 1 / -1;
    justify-self: start;
  }
}
</style>
