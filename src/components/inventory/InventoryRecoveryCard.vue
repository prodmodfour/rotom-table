<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import {
  PhArrowClockwise,
  PhBroadcast,
  PhLockKey,
  PhShieldCheck,
  PhWarning,
} from '@phosphor-icons/vue'

export type InventoryRecoveryState = 'uncertain' | 'conflict' | 'error'

const props = withDefaults(defineProps<{
  state: InventoryRecoveryState
  message: string | null
  online?: boolean
  busy?: boolean
  exactRetryAvailable?: boolean
  retryLabel?: string
}>(), {
  online: true,
  busy: false,
  exactRetryAvailable: true,
  retryLabel: 'Retry exact action',
})
const emit = defineEmits<{
  retryExact: []
  reconcile: []
}>()

const heading = ref<HTMLElement | null>(null)
const componentId = useId()
const titleId = `${componentId}-title`
const safeHeadingId = `${componentId}-safe-heading`
const disabledReasonId = `${componentId}-disabled-reason`
const uncertain = computed(() => props.state === 'uncertain')
const eyebrow = computed(() => uncertain.value ? 'Recovery required' : 'Reconciliation required')
const title = computed(() => uncertain.value
  ? 'Inventory result uncertain'
  : props.state === 'conflict' ? 'Inventory changed elsewhere' : 'Inventory actions unavailable')
const connectionLabel = computed(() => props.online
  ? uncertain.value ? 'Online — ready for exact retry' : 'Online — ready to reload current inventory'
  : 'Offline — waiting to reconnect')
const retryDisabledReason = computed(() => {
  if (!uncertain.value) return null
  if (props.busy) return 'Waiting for the current recovery request.'
  if (!props.online) return 'Available after reconnection.'
  if (!props.exactRetryAvailable) return 'Select the same player profile that began this action.'
  return null
})

watch(
  () => [props.state, props.online] as const,
  async (next, previous) => {
    if (next[0] === previous?.[0] && next[1] === previous?.[1]) return
    await nextTick()
    heading.value?.focus()
  },
  { immediate: true },
)
</script>

<template>
  <aside
    class="inventory-recovery-card"
    :class="`inventory-recovery-card--${state}`"
    :aria-busy="busy"
    :aria-labelledby="titleId"
  >
    <header class="inventory-recovery-card__header">
      <PhWarning :size="38" weight="bold" aria-hidden="true" />
      <div>
        <p>{{ eyebrow }}</p>
        <h2 :id="titleId" ref="heading" tabindex="-1">{{ title }}</h2>
        <span>
          {{ uncertain
            ? 'Inventory actions are locked until this result is resolved.'
            : 'Inventory actions are locked until current authority is reloaded.' }}
        </span>
      </div>
    </header>

    <div class="inventory-recovery-card__connection" :class="{ 'is-offline': !online }" role="status" aria-live="polite">
      <PhBroadcast :size="23" weight="bold" aria-hidden="true" />
      <strong>{{ connectionLabel }}</strong>
    </div>

    <section v-if="uncertain" class="inventory-recovery-card__safe" :aria-labelledby="safeHeadingId">
      <h3 :id="safeHeadingId">What is safe</h3>
      <p>The original action is retained. No new inventory action will be created.</p>
      <div>
        <PhShieldCheck :size="26" weight="bold" aria-hidden="true" />
        <span>Exact retry reuses the retained action and cannot apply it twice.</span>
      </div>
      <p v-if="message" class="inventory-recovery-card__detail">{{ message }}</p>
    </section>

    <section v-else class="inventory-recovery-card__safe" :aria-labelledby="safeHeadingId">
      <h3 :id="safeHeadingId">Reload before choosing again</h3>
      <p>The selected row may have moved, changed quantity, or become reserved. Current server state will replace the stale selection.</p>
      <div v-if="message" class="inventory-recovery-card__detail inventory-recovery-card__detail--alert" role="alert">
        <PhLockKey :size="24" weight="bold" aria-hidden="true" />
        <span>{{ message }}</span>
      </div>
    </section>

    <footer class="inventory-recovery-card__footer">
      <button
        v-if="uncertain"
        type="button"
        class="inventory-recovery-card__action"
        :disabled="Boolean(retryDisabledReason)"
        :aria-describedby="retryDisabledReason ? disabledReasonId : undefined"
        @click="emit('retryExact')"
      >
        <PhArrowClockwise :size="19" weight="bold" aria-hidden="true" />
        {{ busy ? 'Retrying exact action…' : retryLabel }}
      </button>
      <button
        v-else
        type="button"
        class="inventory-recovery-card__action"
        :disabled="busy || !online"
        :aria-describedby="!online ? disabledReasonId : undefined"
        @click="emit('reconcile')"
      >
        <PhArrowClockwise :size="19" weight="bold" aria-hidden="true" />
        {{ busy ? 'Reloading current inventory…' : 'Reload authoritative inventory' }}
      </button>
      <p v-if="retryDisabledReason" :id="disabledReasonId">{{ retryDisabledReason }}</p>
      <p v-else-if="!uncertain && !online" :id="disabledReasonId">Available after reconnection.</p>
      <p v-else class="inventory-recovery-card__boundary">
        {{ uncertain
          ? 'Retry starts only when you choose it; reconnecting never submits automatically.'
          : 'Reloading does not submit an inventory mutation.' }}
      </p>
    </footer>
  </aside>
</template>

<style scoped>
.inventory-recovery-card {
  --inventory-recovery-signal: var(--rt-pending);
  position: relative;
  display: grid;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--rule-strong);
  border-left: 4px solid var(--inventory-recovery-signal);
  border-radius: 10px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  color: var(--ink-soft);
}
.inventory-recovery-card--conflict,
.inventory-recovery-card--error { --inventory-recovery-signal: var(--rt-danger); }
.inventory-recovery-card__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 0.85rem;
  border-bottom: 1px solid var(--rule-soft);
  padding: 1rem;
}
.inventory-recovery-card__header > svg { color: var(--inventory-recovery-signal); }
.inventory-recovery-card__header div { display: grid; gap: 0.3rem; }
.inventory-recovery-card__header p {
  margin: 0;
  color: var(--inventory-recovery-signal);
  font-size: 0.74rem;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.inventory-recovery-card__header h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: clamp(1.45rem, 2.2vw, 2rem);
  line-height: 1.08;
}
.inventory-recovery-card__header h2:focus-visible {
  border-radius: 3px;
  outline: 2px solid var(--rt-focus);
  outline-offset: 4px;
}
.inventory-recovery-card__header span { line-height: 1.5; }
.inventory-recovery-card__connection {
  display: flex;
  min-height: 3.25rem;
  align-items: center;
  gap: 0.65rem;
  border-bottom: 1px solid var(--rule-soft);
  padding: 0.7rem 1rem;
  color: var(--rt-focus);
}
.inventory-recovery-card__connection.is-offline { color: var(--rt-pending); }
.inventory-recovery-card__safe { display: grid; gap: 0.75rem; padding: 1rem; }
.inventory-recovery-card__safe h3 { margin: 0; color: var(--ink-bright); font-family: var(--font-book); font-size: 1.08rem; }
.inventory-recovery-card__safe p { margin: 0; line-height: 1.5; }
.inventory-recovery-card__safe > div {
  display: grid;
  min-height: 3.25rem;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.65rem;
  border-top: 1px solid var(--rule-soft);
  border-bottom: 1px solid var(--rule-soft);
  padding: 0.7rem 0;
  color: var(--ink-bright);
}
.inventory-recovery-card__safe > div > svg { color: var(--inventory-recovery-signal); }
.inventory-recovery-card__detail { color: var(--ink-muted); font-size: 0.86rem; }
.inventory-recovery-card__detail--alert { border: 1px solid var(--rule-soft) !important; border-left: 3px solid var(--rt-danger) !important; padding: 0.7rem !important; }
.inventory-recovery-card__footer { display: grid; justify-items: start; gap: 0.5rem; border-top: 1px solid var(--rule-soft); padding: 1rem; }
.inventory-recovery-card__action {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px solid var(--rt-brand);
  border-radius: 6px;
  background: var(--rt-brand);
  color: var(--rt-on-brand);
  padding: 0.55rem 0.9rem;
  font: inherit;
  font-weight: 900;
  cursor: pointer;
}
.inventory-recovery-card__action:hover:not(:disabled),
.inventory-recovery-card__action:focus-visible { outline: 2px solid var(--rt-focus); outline-offset: 3px; }
.inventory-recovery-card__action:disabled { border-color: var(--rule); background: var(--paper-inset); color: var(--ink-faint); cursor: not-allowed; }
.inventory-recovery-card__footer p { margin: 0; color: var(--ink-muted); font-size: 0.8rem; line-height: 1.45; }
.inventory-recovery-card__boundary { max-width: 58ch; }
@media (max-width: 560px) {
  .inventory-recovery-card__header { grid-template-columns: minmax(0, 1fr); }
  .inventory-recovery-card__header > svg { width: 2rem; height: 2rem; }
  .inventory-recovery-card__footer { justify-items: stretch; }
  .inventory-recovery-card__action { width: 100%; }
}
</style>
