<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  PhArrowClockwise,
  PhCheck,
  PhCheckCircle,
  PhClock,
  PhCompass,
  PhFlag,
  PhShieldCheck,
  PhWarning,
  PhX,
} from '@phosphor-icons/vue'
import type { ItemExplorationProjectionV1 } from '#shared/itemAutomation/exploration'
import type {
  TrainerItemExplorationAuthority,
  TrainerItemExplorationStatus,
} from '~/composables/sheets/useTrainerItemExploration'

const props = withDefaults(defineProps<{
  authority: TrainerItemExplorationAuthority
  projection: ItemExplorationProjectionV1
  status: TrainerItemExplorationStatus
  message: string | null
  busy: boolean
  recoveryOnline?: boolean
  exactRetryAvailable?: boolean
}>(), {
  recoveryOnline: true,
  exactRetryAvailable: true,
})

const emit = defineEmits<{
  resolveCheck: []
  cancelLure: []
  settleEncounter: [referenceId: string]
  adjudicateLoss: []
  retryExact: []
  refresh: []
  dismiss: []
}>()

const heading = ref<HTMLElement | null>(null)
const encounterReference = ref('')
const lossConfirmed = ref(false)
const activeRoute = computed(() => props.projection.routeLures.find(activity => (
  activity.status === 'active' || activity.status === 'awaiting-encounter'
)) ?? null)
const activeRepel = computed(() => props.projection.repels
  .filter(repel => repel.active)
  .sort((left, right) => right.maximumAffectedWildLevel - left.maximumAffectedWildLevel
    || right.expiresAtCampaignMinute - left.expiresAtCampaignMinute)[0] ?? null)
const attemptLabel = computed(() => {
  const route = activeRoute.value
  if (!route) return null
  return route.status === 'awaiting-encounter'
    ? `Succeeded on attempt ${route.attemptsResolved} of ${route.maximumAttempts}`
    : `Attempt ${Math.min(route.attemptsResolved + 1, route.maximumAttempts)} of ${route.maximumAttempts}`
})
const title = computed(() => activeRoute.value?.status === 'awaiting-encounter'
  ? 'GM encounter decision'
  : activeRoute.value?.canResolveCheck ? 'Route check due'
    : activeRoute.value ? 'Route check scheduled' : 'Exploration summary')
const validEncounterReference = computed(() => /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{7,199}$/.test(encounterReference.value))
const statusTone = computed(() => props.status === 'accepted' ? 'success'
  : props.status === 'uncertain' ? 'pending'
    : props.status === 'conflict' || props.status === 'error' ? 'error'
      : activeRoute.value?.canResolveCheck || activeRoute.value?.needsGmEncounter ? 'pending' : 'neutral')
const statusRole = computed(() => props.status === 'conflict' || props.status === 'error' ? 'alert' : 'status')
const commandsLocked = computed(() => props.busy || props.status === 'uncertain')

watch(() => [activeRoute.value?.activityId, activeRoute.value?.status, props.status] as const, async () => {
  encounterReference.value = ''
  lossConfirmed.value = false
  await nextTick()
  heading.value?.focus()
})
</script>

<template>
  <aside
    class="exploration-card"
    :class="`exploration-card--${statusTone}`"
    :aria-busy="busy"
    aria-labelledby="exploration-card-title"
  >
    <header class="exploration-card__header">
      <div>
        <p class="exploration-card__eyebrow">Exploration activity</p>
        <h2 id="exploration-card-title" ref="heading" tabindex="-1">{{ title }}</h2>
      </div>
      <PhCompass :size="28" weight="duotone" aria-hidden="true" />
    </header>

    <section v-if="activeRoute" class="exploration-card__primary" aria-labelledby="exploration-route-item">
      <div class="exploration-card__item-heading">
        <span class="exploration-card__item-mark" aria-hidden="true"><PhFlag :size="24" weight="duotone" /></span>
        <div>
          <h3 id="exploration-route-item">{{ activeRoute.itemLabel }}</h3>
          <p>{{ activeRoute.reusable ? 'Reusable source remains locked until settlement.' : 'Accepted use already settled its source inventory.' }}</p>
        </div>
      </div>

      <div class="exploration-card__timing" aria-label="Route lure timing">
        <span><PhClock :size="18" weight="bold" aria-hidden="true" />Campaign minute {{ authority.campaignMinute.toLocaleString() }}</span>
        <span><PhFlag :size="18" weight="bold" aria-hidden="true" />{{ attemptLabel }}</span>
      </div>

      <template v-if="activeRoute.status === 'active'">
        <p class="exploration-card__copy">
          The server-owned d20 check resolves only after its 15-minute campaign boundary.
          <span v-if="activeRoute.nextCheckAtCampaignMinute !== null">Next boundary: minute {{ activeRoute.nextCheckAtCampaignMinute.toLocaleString() }}.</span>
        </p>
        <button
          type="button"
          class="exploration-card__primary-action"
          :disabled="commandsLocked || !activeRoute.canResolveCheck || !authority.permissions.canResolveChecks"
          @click="emit('resolveCheck')"
        >
          <PhCheck :size="19" weight="bold" aria-hidden="true" />
          {{ activeRoute.canResolveCheck ? 'Resolve server check' : `Due at minute ${activeRoute.nextCheckAtCampaignMinute?.toLocaleString()}` }}
        </button>
        <p class="exploration-card__boundary">No encounter is selected until the GM accepts a comparable-party-level result.</p>
      </template>

      <template v-else>
        <div class="exploration-card__decision-note">
          <PhWarning :size="20" weight="fill" aria-hidden="true" />
          <p><strong>The lure check succeeded.</strong> A GM must accept one exact comparable-party-level encounter before this activity completes.</p>
        </div>
        <div v-if="authority.permissions.canSettleEncounter" class="exploration-card__gm-form">
          <label for="exploration-encounter-reference">Encounter reference</label>
          <input
            id="exploration-encounter-reference"
            v-model.trim="encounterReference"
            type="text"
            maxlength="200"
            autocomplete="off"
            :disabled="commandsLocked"
            placeholder="e.g. route-12-encounter"
          >
          <small>Use the stable reference for the GM-selected comparable encounter. Private selection evidence is not shown here after acceptance.</small>
          <button
            type="button"
            class="exploration-card__primary-action"
            :disabled="commandsLocked || !validEncounterReference"
            @click="emit('settleEncounter', encounterReference)"
          >
            <PhCheckCircle :size="19" weight="fill" aria-hidden="true" />
            Accept encounter
          </button>
        </div>
        <p v-else class="exploration-card__boundary">Waiting for the GM; no encounter identity or private selection is exposed.</p>
      </template>

      <div v-if="activeRoute.reusable && authority.permissions.canAdjudicateLureLoss" class="exploration-card__loss">
        <label>
          <input v-model="lossConfirmed" type="checkbox" :disabled="commandsLocked">
          <span>I confirm fictional events explicitly caused this Fishing Lure to be lost.</span>
        </label>
        <button type="button" :disabled="commandsLocked || !lossConfirmed" @click="emit('adjudicateLoss')">
          Adjudicate lure lost
        </button>
      </div>
    </section>

    <div class="exploration-card__secondary" aria-label="Exploration status">
      <div v-if="activeRepel" class="exploration-card__status-row">
        <span class="exploration-card__status-icon" aria-hidden="true"><PhShieldCheck :size="22" weight="duotone" /></span>
        <span>
          <strong>Route ward</strong>
          <small>{{ activeRepel.itemLabel }} · through minute {{ activeRepel.expiresAtCampaignMinute.toLocaleString() }} · Level {{ activeRepel.maximumAffectedWildLevel }} or lower</small>
        </span>
        <div class="exploration-card__status-actions">
          <b>Active</b>
          <NuxtLink
            v-if="authority.permissions.canSettleEncounter"
            :to="{ path: '/generate', query: { trainer: authority.trainerSlug } }"
          >
            Generate route encounter
          </NuxtLink>
        </div>
      </div>
      <div v-if="projection.dowsing.latest" class="exploration-card__status-row exploration-card__status-row--success">
        <span class="exploration-card__status-icon" aria-hidden="true"><PhCompass :size="22" weight="duotone" /></span>
        <span>
          <strong>Dowsing today</strong>
          <small>{{ projection.dowsing.uses }} of {{ projection.dowsing.maximumUses }} searches · {{ projection.dowsing.latest.successes }} Shard{{ projection.dowsing.latest.successes === 1 ? '' : 's' }} found</small>
          <span v-if="projection.dowsing.latest.shardAwards.length" class="exploration-card__shards">
            <span v-for="(color, index) in projection.dowsing.latest.shardAwards" :key="`${color}-${index}`">{{ color }}</span>
          </span>
        </span>
        <b>Found</b>
      </div>
      <p v-if="!activeRepel && !projection.dowsing.latest && !activeRoute" class="exploration-card__empty">No active exploration item state.</p>
    </div>

    <div v-if="status === 'uncertain'" class="exploration-card__connection" role="status" aria-live="polite">
      <PhWarning :size="18" weight="fill" aria-hidden="true" />
      <span>{{ recoveryOnline ? 'Online — ready for exact retry' : 'Offline — waiting to reconnect' }}</span>
    </div>

    <div v-if="message" class="exploration-card__notice" :class="`exploration-card__notice--${statusTone}`" :role="statusRole" aria-live="polite">
      <PhWarning v-if="statusTone === 'error' || statusTone === 'pending'" :size="18" weight="fill" aria-hidden="true" />
      <PhCheckCircle v-else-if="statusTone === 'success'" :size="18" weight="fill" aria-hidden="true" />
      <span>{{ message }}</span>
    </div>

    <footer class="exploration-card__footer">
      <button
        v-if="activeRoute && authority.permissions.canCancelOwnLure"
        type="button"
        :disabled="commandsLocked"
        @click="emit('cancelLure')"
      >
        <PhX :size="18" weight="bold" aria-hidden="true" />
        Cancel lure
      </button>
      <button v-if="status === 'uncertain'" type="button" class="is-primary" :disabled="busy || !recoveryOnline || !exactRetryAvailable" @click="emit('retryExact')">
        <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
        Retry exact command
      </button>
      <small v-if="status === 'uncertain'" class="exploration-card__retry-note">
        {{ !recoveryOnline ? 'Available after reconnection.' : !exactRetryAvailable ? 'Select the same player profile that began this command.' : 'Reconnect never retries automatically.' }}
      </small>
      <button v-else-if="status === 'conflict' || status === 'error'" type="button" class="is-primary" :disabled="busy" @click="emit('refresh')">
        <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
        Refresh activity
      </button>
      <button v-else-if="message" type="button" @click="emit('dismiss')">Dismiss result</button>
    </footer>
  </aside>
</template>

<style scoped>
.exploration-card {
  --exploration-signal: var(--rt-info);
  position: sticky;
  top: 1rem;
  min-width: 0;
  align-self: start;
  border: 1px solid var(--rule-strong);
  border-left: 4px solid var(--exploration-signal);
  border-radius: 0 14px 14px 0;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  color: var(--ink);
  overflow: hidden;
}
.exploration-card--pending { --exploration-signal: var(--rt-pending); }
.exploration-card--success { --exploration-signal: var(--rt-success); }
.exploration-card--error { --exploration-signal: var(--rt-danger); }
.exploration-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--rule);
  padding: 1rem;
  color: var(--exploration-signal);
}
.exploration-card__eyebrow { margin: 0; color: var(--ink-muted); font-size: 0.72rem; letter-spacing: 0.09em; text-transform: uppercase; }
.exploration-card__header h2 { margin: 0.15rem 0 0; color: var(--ink-bright); font-family: var(--font-book); font-size: clamp(1.4rem, 2.2vw, 1.9rem); line-height: 1.08; }
.exploration-card__header h2:focus-visible { outline: 2px solid var(--rt-focus); outline-offset: 4px; }
.exploration-card__primary { display: grid; gap: 0.85rem; padding: 1rem; }
.exploration-card__item-heading { display: flex; align-items: center; gap: 0.75rem; }
.exploration-card__item-mark, .exploration-card__status-icon { display: inline-grid; width: 2.75rem; height: 2.75rem; flex: 0 0 auto; place-items: center; border: 1px solid var(--rule-soft); border-radius: 50%; background: var(--paper); color: var(--exploration-signal); }
.exploration-card__item-heading h3 { margin: 0; color: var(--ink-bright); font-family: var(--font-book); font-size: 1.45rem; }
.exploration-card__item-heading p { margin: 0.16rem 0 0; color: var(--ink-muted); font-size: 0.76rem; line-height: 1.35; }
.exploration-card__timing { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border: 1px solid var(--rule); background: var(--paper-inset); }
.exploration-card__timing span { display: flex; min-height: 2.75rem; align-items: center; gap: 0.45rem; padding: 0.55rem 0.65rem; color: var(--ink-soft); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
.exploration-card__timing span + span { border-left: 1px solid var(--rule); }
.exploration-card__copy, .exploration-card__boundary { margin: 0; color: var(--ink-soft); font-size: 0.82rem; line-height: 1.5; }
.exploration-card__copy span { display: block; color: var(--ink-muted); }
.exploration-card__boundary { border-left: 3px solid var(--rt-pending); padding-left: 0.65rem; }
.exploration-card__primary-action, .exploration-card__footer button, .exploration-card__loss button {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px solid var(--rule-strong);
  border-radius: 7px;
  background: var(--paper);
  color: var(--ink-bright);
  padding: 0.6rem 0.8rem;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 750;
  cursor: pointer;
}
.exploration-card__primary-action, .exploration-card__footer .is-primary { border-color: var(--rt-brand); background: var(--rt-brand); color: white; }
.exploration-card__primary-action:focus-visible, .exploration-card__footer button:focus-visible, .exploration-card__loss button:focus-visible, .exploration-card__gm-form input:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 3px; }
.exploration-card button:disabled { border-color: var(--rule-soft); background: var(--paper-inset); color: var(--ink-muted); cursor: not-allowed; }
.exploration-card__decision-note { display: flex; gap: 0.55rem; border: 1px solid var(--rule-active); background: var(--paper-inset); padding: 0.65rem; color: var(--rt-pending); }
.exploration-card__decision-note p { margin: 0; color: var(--ink-soft); font-size: 0.8rem; line-height: 1.45; }
.exploration-card__decision-note strong { color: var(--ink-bright); }
.exploration-card__gm-form { display: grid; gap: 0.4rem; }
.exploration-card__gm-form label { color: var(--ink-bright); font-size: 0.75rem; font-weight: 750; }
.exploration-card__gm-form input { min-height: 2.75rem; border: 1px solid var(--rule-strong); border-radius: 6px; background: var(--paper); color: var(--ink); padding: 0.55rem 0.65rem; font: inherit; }
.exploration-card__gm-form small { color: var(--ink-muted); font-size: 0.7rem; line-height: 1.4; }
.exploration-card__loss { display: grid; gap: 0.5rem; border-top: 1px dashed var(--rule); padding-top: 0.75rem; }
.exploration-card__loss label { display: flex; gap: 0.55rem; align-items: flex-start; color: var(--ink-soft); font-size: 0.75rem; line-height: 1.4; }
.exploration-card__loss input { width: 1.1rem; height: 1.1rem; flex: 0 0 auto; accent-color: var(--rt-danger); }
.exploration-card__loss button:not(:disabled) { border-color: var(--rt-danger); color: var(--rt-danger); }
.exploration-card__secondary { border-top: 1px solid var(--rule); }
.exploration-card__status-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.65rem; padding: 0.8rem 1rem; }
.exploration-card__status-row + .exploration-card__status-row { border-top: 1px solid var(--rule); }
.exploration-card__status-row strong, .exploration-card__status-row small { display: block; }
.exploration-card__status-row strong { color: var(--ink-bright); font-family: var(--font-book); font-size: 0.95rem; }
.exploration-card__status-row small { margin-top: 0.12rem; color: var(--ink-muted); font-size: 0.7rem; line-height: 1.35; font-variant-numeric: tabular-nums; }
.exploration-card__status-row b { color: var(--rt-pending); font-size: 0.72rem; }
.exploration-card__status-actions { display: grid; justify-items: end; gap: 0.2rem; }
.exploration-card__status-actions a { display: inline-flex; min-height: 2.75rem; align-items: center; color: var(--rt-info); font-size: 0.7rem; font-weight: 750; text-align: end; }
.exploration-card__status-actions a:focus-visible { outline: 3px solid var(--rt-focus); outline-offset: 3px; }
.exploration-card__status-row--success b { color: var(--rt-success); }
.exploration-card__shards { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 0.35rem; }
.exploration-card__shards span { border: 1px solid var(--rule-soft); border-radius: 999px; padding: 0.08rem 0.32rem; color: var(--ink-soft); font-size: 0.62rem; }
.exploration-card__empty { margin: 0; padding: 1rem; color: var(--ink-muted); font-size: 0.8rem; }
.exploration-card__connection,
.exploration-card__notice { display: flex; align-items: flex-start; gap: 0.45rem; border-top: 1px solid var(--rule); padding: 0.7rem 1rem; color: var(--ink-soft); font-size: 0.76rem; line-height: 1.4; }
.exploration-card__connection { color: var(--rt-pending); }
.exploration-card__notice--pending { color: var(--rt-pending); }
.exploration-card__notice--success { color: var(--rt-success); }
.exploration-card__notice--error { color: var(--rt-danger); }
.exploration-card__notice span { color: var(--ink-soft); }
.exploration-card__footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.55rem; border-top: 1px solid var(--rule); padding: 0.8rem 1rem; }
.exploration-card__retry-note { flex: 1 0 100%; color: var(--ink-muted); font-size: 0.72rem; text-align: right; }
@media (max-width: 520px) {
  .exploration-card__timing { grid-template-columns: minmax(0, 1fr); }
  .exploration-card__timing span + span { border-top: 1px solid var(--rule); border-left: 0; }
  .exploration-card__status-row { grid-template-columns: auto minmax(0, 1fr); }
  .exploration-card__status-actions { grid-column: 2; justify-items: start; }
  .exploration-card__footer { flex-direction: column; }
  .exploration-card__footer button { width: 100%; }
}
</style>
