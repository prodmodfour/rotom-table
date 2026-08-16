<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  PhArrowRight,
  PhCheckCircle,
  PhClock,
  PhEgg,
  PhFirstAid,
  PhHeartbeat,
  PhPerson,
  PhShieldWarning,
  PhSparkle,
  PhWarningCircle,
  PhX,
} from '@phosphor-icons/vue'
import type { CampaignAttentionProjectionSummary } from '#shared/campaignAttention/projection'
import type {
  CampaignDayPreflightChangeKind,
  CampaignDayPreflightProjectionV1,
} from '#shared/campaignDayPreflight'
import type {
  CampaignDayPostflightState,
  CampaignDayPreflightPhase,
} from '~/composables/campaign/useCampaignDayPreflight'

const props = defineProps<{
  open: boolean
  phase: CampaignDayPreflightPhase
  projection: CampaignDayPreflightProjectionV1 | null
  postflight: CampaignDayPostflightState | null
  confirmed: boolean
  error: string | null
  uncertain: boolean
  online: boolean
  canCommit: boolean
  remainingAttention: CampaignAttentionProjectionSummary | null
}>()
const emit = defineEmits<{
  close: []
  recheck: []
  commit: []
  'update:confirmed': [value: boolean]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)

watch(() => props.open, async (open) => {
  if (open && dialog.value && !dialog.value.open) {
    dialog.value.showModal()
    await nextTick()
    closeButton.value?.focus()
  }
  else if (!open && dialog.value?.open) dialog.value.close()
}, { immediate: true })
watch(() => props.phase, async (phase, previous) => {
  if (!props.open || phase === previous || !['ready', 'blocked', 'accepted'].includes(phase)) return
  await nextTick()
  dialog.value?.scrollTo({ top: 0 })
  if (phase === 'accepted') closeButton.value?.focus()
})

onBeforeUnmount(() => { if (dialog.value?.open) dialog.value.close() })

const cancel = (event: Event): void => {
  event.preventDefault()
  if (props.phase !== 'committing') emit('close')
}
const updateConfirmed = (event: Event): void => {
  emit('update:confirmed', (event.target as HTMLInputElement).checked)
}
const format = (value: number): string => value.toLocaleString('en-US')
const changeLabels: Readonly<Record<CampaignDayPreflightChangeKind, string>> = {
  'hit-points': 'HP',
  injury: 'Injury',
  conditions: 'Conditions',
  'daily-moves': 'Daily Moves',
  'trainer-ap': 'AP',
  'daily-resources': 'Daily resources',
}
</script>

<template>
  <dialog
    ref="dialog"
    class="day-preflight"
    aria-labelledby="day-preflight-title"
    aria-describedby="day-preflight-description"
    @cancel="cancel"
  >
    <div class="day-preflight__signal" aria-hidden="true" />
    <header class="day-preflight__header">
      <div>
        <p>Campaign day preflight</p>
        <h2 id="day-preflight-title">
          {{ phase === 'accepted' ? 'Next day complete' : 'Review next day' }}
        </h2>
      </div>
      <button
        ref="closeButton"
        type="button"
        class="day-preflight__close"
        :disabled="phase === 'committing'"
        aria-label="Close next day review"
        @click="emit('close')"
      >
        <PhX :size="24" weight="bold" aria-hidden="true" />
      </button>
    </header>

    <p id="day-preflight-description" class="sr-only">
      Review exact campaign-wide changes and blockers before advancing one day.
    </p>

    <div v-if="phase === 'loading' && !projection" class="day-preflight__loading" role="status">
      <PhClock :size="27" weight="duotone" aria-hidden="true" />
      Loading current campaign-day authority…
    </div>

    <template v-else-if="projection">
      <section class="day-preflight__clock" aria-label="Campaign clock change">
        <PhClock :size="27" weight="duotone" aria-hidden="true" />
        <span>Campaign minute {{ format(projection.clock.currentCampaignMinute) }}</span>
        <PhArrowRight :size="21" weight="bold" aria-hidden="true" />
        <strong>{{ format(projection.clock.targetCampaignMinute) }}</strong>
        <small>+{{ format(projection.clock.minutesAdvanced) }} minutes</small>
      </section>

      <section v-if="phase === 'accepted' && postflight" class="day-preflight__state day-preflight__state--ready" role="status" aria-live="polite">
        <PhCheckCircle :size="27" weight="fill" aria-hidden="true" />
        <div>
          <h3>Authoritative day advancement accepted</h3>
          <p>{{ postflight.accepted.replayed ? 'Recovered the exact accepted result.' : 'Recovery, campaign time, Eggs, and due effects committed together.' }}</p>
        </div>
      </section>
      <section v-else-if="projection.state === 'ready'" class="day-preflight__state day-preflight__state--ready">
        <PhCheckCircle :size="27" weight="fill" aria-hidden="true" />
        <div><h3>Ready to advance</h3><p>No unresolved blockers in the current authority snapshot.</p></div>
      </section>
      <section v-else class="day-preflight__state day-preflight__state--blocked">
        <PhShieldWarning :size="27" weight="fill" aria-hidden="true" />
        <div><h3>Resolve blockers first</h3><p>Campaign time will not advance until fresh authority is clear.</p></div>
      </section>

      <section v-if="projection.blockers.length" class="day-preflight__blockers" aria-labelledby="day-preflight-blockers-title">
        <h3 id="day-preflight-blockers-title">Unresolved blockers</h3>
        <ul>
          <li v-for="blocker in projection.blockers" :key="`${blocker.kind}:${blocker.reason ?? 'none'}:${blocker.href}`">
            <PhWarningCircle :size="20" weight="fill" aria-hidden="true" />
            <span><strong>{{ blocker.label }}</strong><small>{{ blocker.count }} {{ blocker.count === 1 ? 'item' : 'items' }}</small></span>
            <NuxtLink :to="blocker.href">Review</NuxtLink>
          </li>
        </ul>
      </section>

      <section class="day-preflight__metrics" aria-label="Campaign day impact summary">
        <div><PhPerson :size="20" aria-hidden="true" /><strong>{{ format(projection.impact.affectedSheetCount) }}</strong><span>Affected sheets</span></div>
        <div><PhHeartbeat :size="20" aria-hidden="true" /><strong>{{ format(projection.impact.hitPointsRestored) }}</strong><span>HP restored</span></div>
        <div><PhFirstAid :size="20" aria-hidden="true" /><strong>{{ format(projection.impact.injuriesHealed) }}</strong><span>Injuries healed</span></div>
        <div><PhEgg :size="20" aria-hidden="true" /><strong>{{ format(projection.impact.reconciledEggs) }}</strong><span>Eggs reconciled</span></div>
      </section>

      <section v-if="projection.impact.affectedSheets.length" class="day-preflight__sheets" aria-labelledby="day-preflight-sheets-title">
        <h3 id="day-preflight-sheets-title">Affected sheets</h3>
        <ul>
          <li v-for="sheet in projection.impact.affectedSheets" :key="sheet.href">
            <PhSparkle :size="19" weight="duotone" aria-hidden="true" />
            <span><strong>{{ sheet.label }}</strong><small>{{ sheet.kind === 'pokemon' ? 'Pokémon' : 'Trainer' }}</small></span>
            <span class="day-preflight__changes">
              {{ sheet.changes.map(change => changeLabels[change]).join(' · ') }}
            </span>
          </li>
        </ul>
        <p v-if="projection.impact.additionalAffectedSheets > 0">
          +{{ format(projection.impact.additionalAffectedSheets) }} more affected sheets
        </p>
      </section>
      <p v-else class="day-preflight__empty-impact">No sheet document requires a next-day change.</p>

      <dl class="day-preflight__details">
        <div><dt>Conditions cleared</dt><dd>{{ format(projection.impact.conditionsCleared) }}</dd></div>
        <div><dt>Daily Move entries cleared</dt><dd>{{ format(projection.impact.dailyMoveEntriesCleared) }}</dd></div>
        <div><dt>Trainer AP restored</dt><dd>{{ format(projection.impact.trainerApRestored) }}</dd></div>
        <div><dt>Timed effects expiring</dt><dd>{{ format(projection.impact.expiredEffects) }}</dd></div>
      </dl>

      <section v-if="phase === 'accepted'" class="day-preflight__remaining" aria-labelledby="day-preflight-remaining-title">
        <h3 id="day-preflight-remaining-title">Remaining attention</h3>
        <p v-if="remainingAttention">
          {{ remainingAttention.total }} open · {{ remainingAttention.blocking }} blocking · {{ remainingAttention.urgent }} urgent
        </p>
        <p v-else>Refreshing the complete campaign attention snapshot…</p>
      </section>

      <label v-if="projection.state === 'ready' && phase !== 'accepted'" class="day-preflight__confirmation">
        <input type="checkbox" :checked="confirmed" :disabled="phase === 'committing'" @change="updateConfirmed">
        <span>I reviewed these campaign-wide changes.</span>
      </label>
    </template>

    <div v-if="error" class="day-preflight__error" role="alert">
      <PhWarningCircle :size="22" weight="fill" aria-hidden="true" />
      <div>
        <strong>{{ uncertain ? 'Acceptance status is uncertain.' : 'Preflight needs another review.' }}</strong>
        <p>{{ error }}</p>
        <small v-if="uncertain">The exact command is retained. Check its accepted status before trying anything else.</small>
      </div>
    </div>
    <p v-if="!online" class="day-preflight__offline" role="status">Offline · advancement remains disabled.</p>

    <footer class="day-preflight__footer">
      <button type="button" :disabled="phase === 'committing'" @click="emit('close')">
        {{ phase === 'accepted' ? 'Close' : 'Cancel' }}
      </button>
      <button
        v-if="phase !== 'accepted'"
        type="button"
        class="day-preflight__recheck"
        :disabled="phase === 'loading' || phase === 'committing' || !online"
        @click="emit('recheck')"
      >
        {{ phase === 'loading' ? 'Checking…' : uncertain ? 'Check accepted status' : 'Recheck' }}
      </button>
      <button
        v-if="phase !== 'accepted'"
        type="button"
        class="day-preflight__commit"
        :disabled="!canCommit"
        @click="emit('commit')"
      >
        {{ phase === 'committing' ? 'Advancing…' : 'Advance one day' }}
        <PhArrowRight v-if="phase !== 'committing'" :size="18" weight="bold" aria-hidden="true" />
      </button>
    </footer>
  </dialog>
</template>

<style scoped>
.day-preflight {
  position: fixed;
  width: min(52rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  margin: auto;
  border: 1px solid var(--rt-rule-strong, var(--rule));
  border-radius: 0;
  background: var(--rt-surface-1, var(--paper-soft));
  color: var(--rt-text, var(--ink));
  padding: 0;
  overflow: auto;
  box-shadow: 0 1rem 4rem rgb(0 0 0 / .55);
}
.day-preflight::backdrop { background: rgb(2 5 9 / .88); }
.day-preflight__signal { position: absolute; inset: .65rem auto .65rem .65rem; width: 4px; background: var(--rt-pending, var(--warn)); }
.day-preflight__header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--rt-rule, var(--rule-soft));
  margin: 0 1.5rem 0 2rem;
  padding: 1.35rem 0 1rem;
}
.day-preflight__header p { margin: 0; color: var(--rt-text-muted, var(--ink-muted)); font-size: .76rem; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }
.day-preflight__header h2 { margin: .2rem 0 0; color: var(--rt-text-strong, var(--ink-bright)); font: 700 clamp(2rem, 5vw, 3rem)/1 var(--font-book); }
.day-preflight__close,
.day-preflight__footer button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .5rem;
  min-height: 44px;
  border: 1px solid var(--rt-rule, var(--rule));
  border-radius: 0;
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text-strong, var(--ink-bright));
  cursor: pointer;
  padding: .65rem 1rem;
}
.day-preflight__close { width: 44px; padding: 0; }
.day-preflight__loading { display: flex; align-items: center; justify-content: center; gap: .65rem; min-height: 15rem; color: var(--rt-text-muted, var(--ink-soft)); padding: 2rem; }
.day-preflight__clock {
  display: grid;
  grid-template-columns: auto auto auto auto minmax(8rem, 1fr);
  align-items: center;
  gap: .65rem;
  border: 1px solid var(--rt-rule, var(--rule));
  margin: 1rem 1.5rem 0 2rem;
  padding: .8rem 1rem;
}
.day-preflight__clock strong { color: var(--rt-text-strong, var(--ink-bright)); }
.day-preflight__clock small { color: var(--rt-text-muted, var(--ink-muted)); text-align: right; }
.day-preflight__state { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .7rem; margin: 1rem 1.5rem 0 2rem; padding: .25rem 0; }
.day-preflight__state h3,
.day-preflight__state p { margin: 0; }
.day-preflight__state h3 { color: var(--rt-text-strong, var(--ink-bright)); font: 700 1.45rem/1.1 var(--font-book); }
.day-preflight__state p { margin-top: .25rem; color: var(--rt-text-muted, var(--ink-soft)); }
.day-preflight__state--ready > svg,
.day-preflight__state--ready h3 { color: var(--rt-success, var(--good)); }
.day-preflight__state--blocked > svg,
.day-preflight__state--blocked h3 { color: var(--rt-pending, var(--warn)); }
.day-preflight__blockers,
.day-preflight__sheets,
.day-preflight__remaining { margin: 1rem 1.5rem 0 2rem; }
.day-preflight h3 { margin: 0 0 .5rem; color: var(--rt-text-strong, var(--ink-bright)); }
.day-preflight__blockers ul,
.day-preflight__sheets ul { margin: 0; padding: 0; list-style: none; }
.day-preflight__blockers li,
.day-preflight__sheets li {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: .7rem;
  border-top: 1px solid var(--rt-rule, var(--rule-soft));
  min-height: 3.5rem;
  padding: .55rem .7rem;
}
.day-preflight__blockers li:last-child,
.day-preflight__sheets li:last-child { border-bottom: 1px solid var(--rt-rule, var(--rule-soft)); }
.day-preflight__blockers li > svg { color: var(--rt-pending, var(--warn)); }
.day-preflight__blockers span,
.day-preflight__sheets span { display: grid; gap: .12rem; }
.day-preflight__blockers small,
.day-preflight__sheets small { color: var(--rt-text-muted, var(--ink-muted)); }
.day-preflight__blockers a { min-height: 44px; display: inline-flex; align-items: center; color: var(--rt-text-strong, var(--ink-bright)); padding: 0 .5rem; }
.day-preflight__metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 1rem 1.5rem 0 2rem; border: 1px solid var(--rt-rule, var(--rule)); }
.day-preflight__metrics > div { display: grid; place-items: center; gap: .15rem; min-height: 5.5rem; padding: .65rem; text-align: center; }
.day-preflight__metrics > div + div { border-left: 1px solid var(--rt-rule, var(--rule)); }
.day-preflight__metrics svg { color: var(--rt-text-muted, var(--ink-muted)); }
.day-preflight__metrics strong { color: var(--rt-text-strong, var(--ink-bright)); font: 700 1.75rem/1 var(--font-book); }
.day-preflight__metrics span { color: var(--rt-text-muted, var(--ink-soft)); font-size: .78rem; }
.day-preflight__changes { color: var(--rt-text-muted, var(--ink-soft)); text-align: right; }
.day-preflight__sheets > p,
.day-preflight__empty-impact { margin: .55rem 1.5rem 0 2rem; color: var(--rt-text-muted, var(--ink-muted)); }
.day-preflight__details { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 1rem 1.5rem 0 2rem; border-block: 1px solid var(--rt-rule, var(--rule-soft)); }
.day-preflight__details > div { display: grid; gap: .2rem; padding: .7rem; }
.day-preflight__details dt { color: var(--rt-text-muted, var(--ink-muted)); font-size: .75rem; }
.day-preflight__details dd { margin: 0; color: var(--rt-text-strong, var(--ink-bright)); font-weight: 800; }
.day-preflight__remaining { border-left: 3px solid var(--rt-success, var(--good)); background: var(--rt-surface-2, var(--paper-inset)); padding: .75rem 1rem; }
.day-preflight__remaining p { margin: 0; color: var(--rt-text-muted, var(--ink-soft)); }
.day-preflight__confirmation { display: flex; align-items: center; gap: .7rem; min-height: 52px; margin: 1rem 1.5rem 0 2rem; border: 1px solid var(--rt-rule, var(--rule)); padding: .6rem .8rem; cursor: pointer; }
.day-preflight__confirmation input { width: 1.35rem; height: 1.35rem; margin: 0; accent-color: var(--rt-focus, var(--info)); }
.day-preflight__error,
.day-preflight__offline { margin: 1rem 1.5rem 0 2rem; }
.day-preflight__error { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .65rem; border: 1px solid var(--rt-danger, var(--bad)); padding: .75rem; }
.day-preflight__error > svg { color: var(--rt-danger, var(--bad)); }
.day-preflight__offline { color: var(--rt-pending, var(--warn)); }
.day-preflight__error p,
.day-preflight__error small { display: block; margin: .2rem 0 0; color: var(--rt-text-muted, var(--ink-soft)); }
.day-preflight__footer { display: grid; grid-template-columns: minmax(7rem, .8fr) minmax(7rem, .8fr) minmax(11rem, 1.2fr); gap: .75rem; margin: 1rem 1.5rem 1.25rem 2rem; }
.day-preflight__footer .day-preflight__recheck { border-color: var(--rt-focus, var(--info)); }
.day-preflight__footer .day-preflight__commit { border-color: var(--rt-brand, var(--accent)); background: var(--rt-brand, var(--accent)); color: var(--rt-on-brand, #08090b); font-weight: 850; }
.day-preflight button:disabled { cursor: not-allowed; opacity: .5; }
.day-preflight button:focus-visible,
.day-preflight a:focus-visible,
.day-preflight input:focus-visible { outline: 3px solid var(--rt-focus, #59d8ff); outline-offset: 3px; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
@media (max-width: 640px) {
  .day-preflight { width: calc(100vw - 1rem); max-height: calc(100dvh - 1rem); }
  .day-preflight__header,
  .day-preflight__clock,
  .day-preflight__state,
  .day-preflight__blockers,
  .day-preflight__metrics,
  .day-preflight__sheets,
  .day-preflight__details,
  .day-preflight__remaining,
  .day-preflight__confirmation,
  .day-preflight__error,
  .day-preflight__offline,
  .day-preflight__footer { margin-inline: 1.15rem .75rem; }
  .day-preflight__clock { grid-template-columns: auto minmax(0, 1fr) auto; }
  .day-preflight__clock strong { grid-column: 2; }
  .day-preflight__clock small { grid-column: 1 / -1; text-align: left; }
  .day-preflight__metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .day-preflight__metrics > div:nth-child(3) { border-left: 0; border-top: 1px solid var(--rt-rule, var(--rule)); }
  .day-preflight__metrics > div:nth-child(4) { border-top: 1px solid var(--rt-rule, var(--rule)); }
  .day-preflight__sheets li { grid-template-columns: auto minmax(0, 1fr); }
  .day-preflight__changes { grid-column: 2; text-align: left; }
  .day-preflight__details { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .day-preflight__footer { grid-template-columns: 1fr; }
  .day-preflight__footer button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .day-preflight, .day-preflight::backdrop { animation: none !important; transition: none !important; }
}
</style>
