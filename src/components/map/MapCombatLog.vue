<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import InitiativeProfileImage from '~/components/map/InitiativeProfileImage.vue'
import type { CombatLogMessage } from '~/utils/combatLog'
import { trainerAccentCssVariables } from '~/utils/trainerAccent'

const props = defineProps<{
  messages: CombatLogMessage[]
  canInspectMoveOperations?: boolean
}>()

const emit = defineEmits<{
  inspectMoveOperation: [operationId: string]
}>()

const rootRef = ref<HTMLElement | null>(null)
const scrollViewportRef = ref<HTMLElement | null>(null)
const scrollingEnabled = ref(false)

const visibleMessages = computed(() => props.messages)
const visibleMessageKey = computed(() =>
  visibleMessages.value.map((message) => message.id).join('|'),
)

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const messageDate = (message: CombatLogMessage): Date => new Date(message.at)

const formatMessageTime = (message: CombatLogMessage): string =>
  timeFormatter.format(messageDate(message))

const messageAccentStyle = (message: CombatLogMessage): Record<string, string> | undefined =>
  message.accentColor ? trainerAccentCssVariables(message.accentColor) : undefined

const canInspectOperation = (message: CombatLogMessage): message is CombatLogMessage & { operationId: string } => (
  props.canInspectMoveOperations === true
  && message.source === 'move'
  && typeof message.operationId === 'string'
)

const inspectOperation = (message: CombatLogMessage): void => {
  if (!canInspectOperation(message)) return
  emit('inspectMoveOperation', message.operationId)
}

const scrollToBottom = () => {
  const viewport = scrollViewportRef.value
  if (!viewport) return
  viewport.scrollTop = viewport.scrollHeight
}

const enableScrolling = () => {
  scrollingEnabled.value = true
}

const disableScrolling = () => {
  scrollingEnabled.value = false
}

const handleDocumentPointerDown = (event: PointerEvent) => {
  if (!scrollingEnabled.value) return
  const target = event.target
  if (target instanceof Node && rootRef.value?.contains(target)) return
  disableScrolling()
}

watch(
  visibleMessageKey,
  () => {
    if (scrollingEnabled.value) return
    void nextTick(scrollToBottom)
  },
  { immediate: true },
)

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown, true)
  void nextTick(scrollToBottom)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true)
})
</script>

<template>
  <aside
    v-if="visibleMessages.length"
    ref="rootRef"
    class="combat-log"
    :class="{ 'combat-log--scroll-active': scrollingEnabled }"
    :aria-label="scrollingEnabled ? 'Combat log, scrolling enabled' : 'Combat log, click to enable scrolling'"
    aria-live="polite"
    aria-relevant="additions text"
    role="log"
    @pointerdown="enableScrolling"
  >
    <div ref="scrollViewportRef" class="combat-log__viewport">
      <ol class="combat-log__list">
        <li
          v-for="message in visibleMessages"
          :key="message.id"
          class="combat-log__message"
          :class="[
            `combat-log__message--${message.source}`,
            { 'combat-log__message--with-profile': message.profileEntry },
          ]"
          :style="messageAccentStyle(message)"
          :title="`${message.userName} · ${message.actionName}`"
        >
          <InitiativeProfileImage
            v-if="message.profileEntry"
            class="combat-log__profile"
            :entry="message.profileEntry"
          />
          <div class="combat-log__body">
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

            <button
              v-if="canInspectOperation(message)"
              type="button"
              class="combat-log__operation-button"
              :aria-label="`Inspect ${message.actionName} operation details`"
              @click.stop="inspectOperation(message)"
            >
              Operation details
            </button>
          </div>
        </li>
      </ol>
    </div>
  </aside>
</template>

<style scoped>
.combat-log {
  --combat-log-title-outline: rgba(247, 247, 242, 0.94);
  --combat-log-title-outline-glow: rgba(247, 247, 242, 0.42);

  position: absolute;
  z-index: 3;
  top: var(--map-combat-log-top, calc(var(--map-overlay-gutter, 0.75rem) + 4.25rem));
  right: var(--map-overlay-gutter, 0.75rem);
  bottom: var(--map-overlay-gutter, 0.75rem);
  display: block;
  width: min(25rem, 31vw);
  overflow: hidden;
  pointer-events: none;
  mask-image: linear-gradient(to bottom, transparent 0, black 3.2rem, black 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 3.2rem, black 100%);
}

:global(:root[data-theme='light']) .combat-log {
  --combat-log-title-outline: rgba(5, 6, 8, 0.88);
  --combat-log-title-outline-glow: rgba(5, 6, 8, 0.24);
}

.combat-log__viewport {
  width: 100%;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: contain;
  pointer-events: none;
  scrollbar-width: thin;
}

.combat-log--scroll-active .combat-log__viewport {
  overflow-y: auto;
  pointer-events: auto;
}

.combat-log__viewport:focus {
  outline: none;
}

.combat-log__list {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 0.42rem;
  width: 100%;
  min-height: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}

.combat-log__message {
  flex: 0 0 auto;
  display: grid;
  gap: 0.26rem;
  max-width: 100%;
  padding: 0.46rem 0.58rem;
  border: 0;
  background: var(--map-glass-surface, color-mix(in srgb, var(--paper) 72%, transparent));
  box-shadow:
    0 8px 22px color-mix(in srgb, var(--pokemon-black) 18%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--ink-bright) 10%, transparent);
  backdrop-filter: blur(12px) saturate(135%);
  -webkit-backdrop-filter: blur(12px) saturate(135%);
  color: var(--ink-bright);
  cursor: pointer;
  pointer-events: auto;
}

.combat-log__message--with-profile {
  --combat-log-profile-height: clamp(1.9rem, 2.7vw, 2.35rem);
  --combat-log-profile-width: calc(var(--combat-log-profile-height) * 2.6666667);

  grid-template-columns: var(--combat-log-profile-width) minmax(0, 1fr);
  align-items: start;
  column-gap: 0.56rem;
}

.combat-log--scroll-active .combat-log__message {
  cursor: default;
}

.combat-log__profile {
  box-sizing: border-box;
  width: var(--combat-log-profile-width, 5.1rem);
  height: var(--combat-log-profile-height, 1.9rem);
  align-self: start;
  border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--rule-soft));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, transparent), transparent 62%),
    color-mix(in srgb, var(--paper) 54%, transparent);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, white 18%, transparent),
    0 4px 12px color-mix(in srgb, var(--pokemon-black) 20%, transparent);
}

.combat-log__body {
  display: grid;
  gap: 0.26rem;
  min-width: 0;
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
  -webkit-text-stroke: 0.35px var(--combat-log-title-outline);
  paint-order: stroke fill;
  text-shadow:
    0 1px 0 var(--combat-log-title-outline),
    1px 0 0 var(--combat-log-title-outline),
    -1px 0 0 var(--combat-log-title-outline),
    0 -1px 0 var(--combat-log-title-outline),
    0 0 4px var(--combat-log-title-outline-glow);
  overflow-wrap: anywhere;
}

.combat-log__time {
  flex: 0 0 auto;
  color: var(--ink-muted);
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
  color: var(--ink);
  font-size: clamp(0.74rem, 0.9vw, 0.86rem);
  font-weight: 700;
  line-height: 1.22;
  overflow-wrap: anywhere;
}

.combat-log__operation-button {
  justify-self: start;
  border: 1px solid color-mix(in srgb, var(--accent) 58%, var(--rule-soft));
  border-radius: 999px;
  background: color-mix(in srgb, var(--paper-accent) 88%, transparent);
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 0.66rem;
  font-weight: 850;
  letter-spacing: 0.03em;
  padding: 0.28rem 0.5rem;
}

.combat-log__operation-button:hover,
.combat-log__operation-button:focus-visible {
  border-color: var(--accent);
  outline: none;
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
