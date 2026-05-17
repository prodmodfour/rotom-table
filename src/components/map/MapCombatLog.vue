<script setup lang="ts">
import { computed } from 'vue'
import type { CombatLogMessage } from '~/utils/combatLog'

const props = defineProps<{
  messages: CombatLogMessage[]
}>()

const visibleMessages = computed(() => props.messages)

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const messageDate = (message: CombatLogMessage): Date => new Date(message.at)

const formatMessageTime = (message: CombatLogMessage): string =>
  timeFormatter.format(messageDate(message))
</script>

<template>
  <aside
    v-if="visibleMessages.length"
    class="combat-log"
    aria-label="Combat log"
    aria-live="polite"
    aria-relevant="additions text"
    role="log"
  >
    <ol class="combat-log__list">
      <li
        v-for="message in visibleMessages"
        :key="message.id"
        class="combat-log__message"
        :class="`combat-log__message--${message.source}`"
        :title="`${message.userName} · ${message.actionName}`"
      >
        <span class="combat-log__meta">
          <strong class="combat-log__title">{{ message.title }}</strong>
          <time class="combat-log__time" :datetime="messageDate(message).toISOString()">
            {{ formatMessageTime(message) }}
          </time>
        </span>

        <ol v-if="message.details.length" class="combat-log__details">
          <li
            v-for="(line, index) in message.details"
            :key="`${message.id}-${index}`"
            class="combat-log__detail"
          >
            {{ line }}
          </li>
        </ol>
      </li>
    </ol>
  </aside>
</template>

<style scoped>
.combat-log {
  position: absolute;
  z-index: 3;
  top: var(--map-combat-log-top, calc(var(--map-overlay-gutter, 0.75rem) + 4.25rem));
  right: var(--map-overlay-gutter, 0.75rem);
  bottom: var(--map-overlay-gutter, 0.75rem);
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  width: min(25rem, 31vw);
  overflow: hidden;
  pointer-events: none;
  mask-image: linear-gradient(to bottom, transparent 0, black 3.2rem, black 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 3.2rem, black 100%);
}

.combat-log__list {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.42rem;
  width: 100%;
  min-height: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}

.combat-log__message {
  display: grid;
  gap: 0.26rem;
  max-width: 100%;
  padding: 0.46rem 0.58rem;
  border: 0;
  background: rgba(8, 10, 14, 0.34);
  box-shadow:
    0 8px 22px rgba(0, 0, 0, 0.20),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(12px) saturate(135%);
  -webkit-backdrop-filter: blur(12px) saturate(135%);
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
}

.combat-log__meta {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.55rem;
  min-width: 0;
  line-height: 1.15;
}

.combat-log__title {
  min-width: 0;
  color: var(--accent);
  font-size: clamp(0.78rem, 0.94vw, 0.9rem);
  font-weight: 900;
  overflow-wrap: anywhere;
}

.combat-log__time {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.62);
  font-size: clamp(0.58rem, 0.72vw, 0.68rem);
  font-weight: 800;
  letter-spacing: 0.04em;
  line-height: 1;
  white-space: nowrap;
}

.combat-log__details {
  display: grid;
  gap: 0.12rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.combat-log__detail {
  color: rgba(255, 255, 255, 0.94);
  font-size: clamp(0.74rem, 0.9vw, 0.86rem);
  font-weight: 700;
  line-height: 1.22;
  overflow-wrap: anywhere;
}

@media (max-width: 900px) {
  .combat-log {
    width: min(21rem, 42vw);
  }
}

@media (max-width: 640px) {
  .combat-log {
    left: var(--map-overlay-gutter, 0.75rem);
    width: auto;
  }
}
</style>
