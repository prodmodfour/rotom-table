<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  PhArrowClockwise,
  PhCheck,
  PhCheckCircle,
  PhCircle,
  PhCircleNotch,
  PhClock,
  PhWarning,
  PhX,
} from '@phosphor-icons/vue'
import type { ItemExtendedActionProjectionV1 } from '#shared/itemAutomation/extendedActions'
import type { TrainerItemExtendedActionStatus } from '~/composables/sheets/useTrainerItemExtendedActions'

const props = withDefaults(defineProps<{
  activity: ItemExtendedActionProjectionV1 | null
  status: TrainerItemExtendedActionStatus
  message: string | null
  busy: boolean
  recoveryOnline?: boolean
  exactRetryAvailable?: boolean
}>(), {
  recoveryOnline: true,
  exactRetryAvailable: true,
})

const emit = defineEmits<{
  complete: []
  interrupt: []
  retryExact: []
  refresh: []
  dismiss: []
}>()

const heading = ref<HTMLElement | null>(null)
const active = computed(() => props.activity?.status === 'in-progress')
const uncertain = computed(() => props.status === 'uncertain')
const failed = computed(() => props.status === 'conflict' || props.status === 'error')
const terminal = computed(() => props.activity?.terminal ?? null)
const treatmentItems = new Set(['First Aid Kit', 'Bandages'])
const treatment = computed(() => !props.activity || treatmentItems.has(props.activity.item.canonicalId))
const moveTraining = computed(() => /^(?:TM|HM)\s/u.test(props.activity?.item.canonicalId ?? ''))
const dowsing = computed(() => props.activity?.item.canonicalId === 'Dowsing Rod')
const itemLabel = computed(() => props.activity?.item.label ?? 'Extended Action')
const title = computed(() => dowsing.value
  ? uncertain.value ? 'Dowsing result uncertain'
    : terminal.value?.kind === 'completed' ? 'Dowsing search complete'
      : terminal.value?.kind === 'interrupted' ? 'Dowsing search interrupted'
        : 'Dowsing search in progress'
  : moveTraining.value
  ? uncertain.value ? 'Move training result uncertain'
    : terminal.value?.kind === 'completed' ? 'Move training complete'
      : terminal.value?.kind === 'interrupted' ? 'Move training interrupted'
        : 'Move training in progress'
  : treatment.value
  ? uncertain.value ? 'Treatment result uncertain'
    : terminal.value?.kind === 'completed' ? 'Treatment complete'
      : terminal.value?.kind === 'interrupted' ? 'Treatment interrupted'
        : 'Treatment in progress'
  : uncertain.value ? `${itemLabel.value} result uncertain`
    : terminal.value?.kind === 'completed' ? `${itemLabel.value} complete`
      : terminal.value?.kind === 'interrupted' ? `${itemLabel.value} interrupted`
        : `${itemLabel.value} in progress`)
const actorTarget = computed(() => props.activity
  ? dowsing.value
    ? `${props.activity.actor.label} is searching with ${props.activity.item.label}`
    : moveTraining.value
    ? `${props.activity.actor.label} is training ${props.activity.target.label} with ${props.activity.item.label}`
    : treatment.value
      ? `${props.activity.actor.label} is treating ${props.activity.target.label}`
      : `${props.activity.actor.label} is applying ${props.activity.item.label} to ${props.activity.target.label}`
  : 'Recovering the durable Extended Action')

defineExpose({ focus: () => heading.value?.focus() })

watch(
  () => [props.activity?.activityId, props.activity?.revision, props.status] as const,
  async () => {
    await nextTick()
    heading.value?.focus()
  },
  { immediate: true },
)
</script>

<template>
  <aside
    class="extended-treatment"
    :class="{
      'extended-treatment--terminal': terminal,
      'extended-treatment--uncertain': uncertain,
      'extended-treatment--error': failed,
    }"
    :aria-busy="busy"
    aria-labelledby="extended-treatment-title"
  >
    <div class="extended-treatment__header">
      <PhWarning v-if="uncertain || failed" :size="25" weight="fill" aria-hidden="true" />
      <PhCheckCircle v-else-if="terminal?.kind === 'completed'" :size="26" weight="fill" aria-hidden="true" />
      <PhX v-else-if="terminal?.kind === 'interrupted'" :size="25" weight="bold" aria-hidden="true" />
      <PhClock v-else :size="26" weight="bold" aria-hidden="true" />
      <div>
        <p class="extended-treatment__eyebrow">Extended Action</p>
        <h2 id="extended-treatment-title" ref="heading" tabindex="-1">{{ title }}</h2>
        <p class="extended-treatment__relationship">{{ actorTarget }}</p>
        <p v-if="activity" class="extended-treatment__minute">Campaign minute {{ activity.startedAtCampaignMinute }}</p>
      </div>
    </div>

    <template v-if="activity">
      <section class="extended-treatment__target" aria-label="Extended Action target">
        <span class="extended-treatment__monogram" aria-hidden="true">{{ activity.target.label.slice(0, 1).toUpperCase() }}</span>
        <div class="extended-treatment__target-name">
          <NuxtLink :to="activity.target.href">{{ activity.target.label }}</NuxtLink>
          <span v-if="activity.target.summary">{{ activity.target.summary }}</span>
        </div>
        <ul v-if="activity.target.conditionLabels.length" class="extended-treatment__conditions" aria-label="Current conditions">
          <li v-for="condition in activity.target.conditionLabels" :key="condition">{{ condition }}</li>
        </ul>
      </section>

      <ol v-if="active" class="extended-treatment__timeline" aria-label="Extended Action progress">
        <li class="is-complete">
          <PhCheck :size="16" weight="bold" aria-hidden="true" />
          <span><strong>Started</strong><small>Activity evidence stored</small></span>
        </li>
        <li class="is-current" aria-current="step">
          <PhCircleNotch :size="17" weight="bold" aria-hidden="true" />
          <span><strong>In progress</strong><small>No mechanics applied</small></span>
        </li>
        <li>
          <PhCircle :size="17" weight="bold" aria-hidden="true" />
          <span><strong>Complete</strong><small>Apply one accepted result</small></span>
        </li>
      </ol>

      <section v-if="active" class="extended-treatment__costs" aria-label="Completion requirements">
        <div v-for="cost in activity.completion.costs" :key="cost">
          <PhCheck :size="15" weight="bold" aria-hidden="true" />
          <span>{{ cost }}</span>
        </div>
      </section>

      <p v-if="active" class="extended-treatment__safe-note">
        <PhWarning :size="19" weight="fill" aria-hidden="true" />
        <span>{{ activity.completion.safePendingNotice }}</span>
      </p>
      <p v-if="active" class="extended-treatment__source-note">{{ activity.completion.sourceNotice }}</p>
      <p v-if="activity.permissions.unavailableReason" class="extended-treatment__unavailable" role="alert">
        {{ activity.permissions.unavailableReason }}
      </p>
      <p v-if="terminal" class="extended-treatment__terminal-copy" role="status">{{ terminal.message }}</p>
    </template>

    <p v-if="uncertain" class="extended-treatment__connection" role="status" aria-live="polite">
      {{ recoveryOnline ? 'Online — ready for exact retry' : 'Offline — waiting to reconnect' }}
    </p>

    <p v-if="message" class="extended-treatment__message" :role="failed ? 'alert' : 'status'">
      <PhCircleNotch v-if="busy" class="extended-treatment__spinner" :size="18" weight="bold" aria-hidden="true" />
      <span>{{ message }}</span>
    </p>

    <footer class="extended-treatment__footer">
      <template v-if="uncertain">
        <button type="button" class="treatment-button treatment-button--primary" :disabled="busy || !recoveryOnline || !exactRetryAvailable" @click="emit('retryExact')">
          <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
          Retry exact command
        </button>
        <span class="extended-treatment__retry-note">
          {{ !recoveryOnline ? 'Available after reconnection.' : !exactRetryAvailable ? 'Select the same player profile that began this command.' : 'Reconnect never retries automatically.' }}
        </span>
      </template>
      <template v-else-if="active">
        <button type="button" class="treatment-button" :disabled="busy || !activity?.permissions.canInterrupt" @click="emit('interrupt')">
          Interrupt safely
        </button>
        <button
          type="button"
          class="treatment-button treatment-button--primary"
          :disabled="busy || !activity?.permissions.canComplete"
          @click="emit('complete')"
        >
          <PhCircleNotch v-if="busy" class="extended-treatment__spinner" :size="18" weight="bold" aria-hidden="true" />
          <PhCheck v-else :size="18" weight="bold" aria-hidden="true" />
          {{ busy ? 'Completing…' : dowsing ? 'Complete Dowsing Search' : moveTraining ? 'Complete Move Training' : treatment ? 'Complete treatment' : 'Complete Extended Action' }}
        </button>
      </template>
      <template v-else-if="terminal">
        <button type="button" class="treatment-button" @click="emit('dismiss')">Done</button>
      </template>
      <template v-else>
        <button type="button" class="treatment-button treatment-button--primary" :disabled="busy" @click="emit('refresh')">
          <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
          {{ treatment ? 'Refresh treatment' : 'Refresh activity' }}
        </button>
      </template>
    </footer>
  </aside>
</template>

<style scoped>
.extended-treatment {
  --activity-signal: var(--rt-pending);
  position: sticky;
  top: 1rem;
  min-width: 0;
  align-self: start;
  border: 1px solid var(--rule-strong);
  border-left: 5px solid var(--activity-signal);
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  color: var(--ink);
  clip-path: polygon(0 0, calc(100% - 1.4rem) 0, 100% 1.4rem, 100% 100%, 0 100%);
}

.extended-treatment--terminal { --activity-signal: var(--rt-success); }
.extended-treatment--uncertain { --activity-signal: var(--rt-pending); }
.extended-treatment--error { --activity-signal: var(--rt-danger); }

.extended-treatment__header {
  display: flex;
  align-items: flex-start;
  gap: 0.8rem;
  border-bottom: 1px solid var(--rule);
  padding: 1rem;
  color: var(--activity-signal);
}

.extended-treatment__header h2 {
  margin: 0.1rem 0 0.35rem;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: clamp(1.5rem, 2.4vw, 2.05rem);
  line-height: 1.05;
}

.extended-treatment__header h2:focus-visible {
  outline: 2px solid var(--rt-focus);
  outline-offset: 4px;
}

.extended-treatment__eyebrow,
.extended-treatment__relationship,
.extended-treatment__minute {
  margin: 0;
}

.extended-treatment__eyebrow {
  color: var(--activity-signal);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.extended-treatment__relationship {
  color: var(--ink-bright);
  font-weight: 700;
}

.extended-treatment__minute {
  margin-top: 0.35rem;
  color: var(--ink-muted);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.extended-treatment__target {
  display: grid;
  grid-template-columns: 3.25rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.8rem;
  border-bottom: 1px solid var(--rule);
  padding: 0.9rem 1rem;
}

.extended-treatment__monogram {
  display: grid;
  width: 3.1rem;
  height: 3.1rem;
  place-items: center;
  border: 1px solid var(--rule-strong);
  background: var(--paper);
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.5rem;
}

.extended-treatment__target-name {
  display: grid;
  gap: 0.18rem;
}

.extended-treatment__target-name a {
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.15rem;
  font-weight: 700;
  text-decoration-color: transparent;
}

.extended-treatment__target-name a:hover,
.extended-treatment__target-name a:focus-visible {
  color: var(--rt-focus);
  text-decoration-color: currentColor;
}

.extended-treatment__target-name span {
  color: var(--ink-muted);
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

.extended-treatment__conditions {
  display: flex;
  max-width: 12rem;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.extended-treatment__conditions li {
  border-left: 2px solid var(--rt-pending);
  background: var(--paper);
  padding: 0.25rem 0.4rem;
  color: var(--ink-soft);
  font-size: 0.72rem;
}

.extended-treatment__timeline {
  display: grid;
  gap: 0.6rem;
  margin: 0;
  border-bottom: 1px solid var(--rule);
  padding: 0.9rem 1rem;
  list-style: none;
}

.extended-treatment__timeline li {
  display: grid;
  grid-template-columns: 1.4rem minmax(0, 1fr);
  gap: 0.55rem;
  color: var(--ink-muted);
}

.extended-treatment__timeline li.is-complete { color: var(--ink-soft); }
.extended-treatment__timeline li.is-current { color: var(--rt-pending); }
.extended-treatment__timeline span { display: grid; gap: 0.08rem; }
.extended-treatment__timeline strong { color: currentColor; font-size: 0.85rem; }
.extended-treatment__timeline small { color: var(--ink-muted); font-size: 0.72rem; }

.extended-treatment__costs {
  display: grid;
  gap: 0.45rem;
  border-bottom: 1px solid var(--rule);
  padding: 0.8rem 1rem;
}

.extended-treatment__costs div {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--ink-soft);
  font-size: 0.82rem;
}

.extended-treatment__safe-note,
.extended-treatment__message,
.extended-treatment__connection,
.extended-treatment__unavailable,
.extended-treatment__terminal-copy {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin: 0.8rem 1rem 0;
  border: 1px solid color-mix(in srgb, var(--rt-pending) 55%, var(--rule));
  background: color-mix(in srgb, var(--rt-pending) 8%, var(--paper));
  padding: 0.7rem;
  color: var(--ink-soft);
  font-size: 0.78rem;
  line-height: 1.45;
}

.extended-treatment__connection { color: var(--rt-pending); }
.extended-treatment__source-note {
  margin: 0.55rem 1rem;
  color: var(--ink-muted);
  font-size: 0.72rem;
}

.extended-treatment__unavailable,
.extended-treatment--error .extended-treatment__message {
  border-color: color-mix(in srgb, var(--rt-danger) 58%, var(--rule));
  background: color-mix(in srgb, var(--rt-danger) 8%, var(--paper));
}

.extended-treatment__terminal-copy { border-color: var(--rule); }

.extended-treatment__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.65rem;
  border-top: 1px solid var(--rule);
  margin-top: 0.9rem;
  padding: 0.85rem 1rem;
}

.extended-treatment__retry-note { flex: 1 0 100%; color: var(--ink-muted); font-size: 0.74rem; text-align: right; }
.treatment-button {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px solid var(--rule-strong);
  background: var(--paper);
  color: var(--ink-bright);
  padding: 0.55rem 0.85rem;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 800;
  cursor: pointer;
}

.treatment-button--primary {
  border-color: var(--rt-danger);
  background: var(--rt-danger);
  color: white;
}

.treatment-button:hover:not(:disabled),
.treatment-button:focus-visible {
  outline: 3px solid var(--rt-focus);
  outline-offset: 3px;
}

.treatment-button:disabled { cursor: not-allowed; opacity: 0.48; }
.extended-treatment__spinner { animation: treatment-spin 0.8s linear infinite; }

@keyframes treatment-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .extended-treatment__spinner { animation: none; }
}

@media (max-width: 720px) {
  .extended-treatment { position: static; clip-path: none; }
  .extended-treatment__target { grid-template-columns: 3rem minmax(0, 1fr); }
  .extended-treatment__conditions { grid-column: 1 / -1; max-width: none; justify-content: flex-start; }
  .extended-treatment__footer { flex-direction: column-reverse; }
  .treatment-button { width: 100%; }
}
</style>
