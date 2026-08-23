<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  PhArrowClockwise,
  PhArrowRight,
  PhCheckCircle,
  PhClipboardText,
  PhClock,
  PhMinusCircle,
} from '@phosphor-icons/vue'
import {
  parseCampaignSkillCheckHistoryResponse,
  type CampaignSkillCheckHistoryEntryV1,
  type CampaignSkillCheckHistoryResponseV1,
} from '#shared/skillChecks/campaignHistory'
import { SKILL_CHECK_API_PATHS } from '~/utils/apiRoutes'

const props = withDefaults(defineProps<{
  profileId?: string | null
  gm?: boolean
  refreshKey?: string | null
}>(), {
  profileId: null,
  gm: false,
  refreshKey: null,
})

const response = ref<CampaignSkillCheckHistoryResponseV1 | null>(null)
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const visibleCount = ref(4)
let loadSequence = 0

const canLoad = computed(() => props.gm || Boolean(props.profileId))
const entries = computed(() => response.value?.entries ?? [])
const visibleEntries = computed(() => entries.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < entries.value.length)
const statusMessage = computed(() => {
  if (!canLoad.value) return 'Select a Player Profile to view your Skill Check history.'
  if (status.value === 'loading') return 'Refreshing Skill Check history…'
  if (status.value === 'error') return 'Skill Check history is temporarily unavailable.'
  if (status.value === 'ready' && entries.value.length === 0) return 'No terminal Skill Checks are recorded yet.'
  return ''
})

const load = async (): Promise<void> => {
  if (status.value === 'loading') return
  const profileId = props.profileId ?? null
  const gm = props.gm
  const sequence = ++loadSequence
  if (!gm && !profileId) {
    response.value = null
    status.value = 'idle'
    return
  }
  status.value = 'loading'
  try {
    const value = await $fetch<unknown>(SKILL_CHECK_API_PATHS.campaignHistory, {
      query: gm ? { limit: 20 } : { profileId, limit: 20 },
    })
    const parsed = parseCampaignSkillCheckHistoryResponse(value)
    if (sequence !== loadSequence || gm !== props.gm || profileId !== (props.profileId ?? null)) return
    if ((gm && parsed.audience !== 'gm') || (!gm && parsed.audience !== 'owner')) {
      throw new Error('Campaign Skill Check history audience is invalid.')
    }
    response.value = parsed
    status.value = 'ready'
  }
  catch {
    if (sequence !== loadSequence || gm !== props.gm || profileId !== (props.profileId ?? null)) return
    status.value = 'error'
  }
}

const stateLabel = (entry: CampaignSkillCheckHistoryEntryV1): string => {
  if (entry.state === 'accepted') return 'Resolved'
  if (entry.state === 'cancelled') return 'Cancelled'
  return 'Timed out'
}
const outcomeLabel = (entry: CampaignSkillCheckHistoryEntryV1): string => {
  if (entry.state === 'cancelled') return 'Request closed'
  if (entry.state === 'timed-out') return 'No response recorded'
  const labels = {
    success: 'Succeeded',
    failure: 'Did not succeed',
    winner: 'Won',
    loser: 'Did not win',
    mixed: 'Mixed result',
    resolved: 'Resolution recorded',
    withheld: 'Result withheld',
  } as const
  return labels[entry.outcome!]
}
const relativeTime = (terminalAt: number): string => {
  const deltaMinutes = Math.max(0, Math.floor(((response.value?.serverNow ?? terminalAt) - terminalAt) / 60_000))
  if (deltaMinutes < 1) return 'Just now'
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`
  const hours = Math.floor(deltaMinutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
const isoTime = (value: number): string => new Date(value).toISOString()
const showMore = (): void => { visibleCount.value = Math.min(entries.value.length, visibleCount.value + 4) }

onMounted(load)
watch(() => [props.profileId, props.gm] as const, () => {
  response.value = null
  visibleCount.value = 4
  status.value = 'idle'
  void load()
})
watch(() => props.refreshKey, (next, previous) => {
  if (!next || !previous || next === previous) return
  void load()
})
</script>

<template>
  <section class="skill-history" aria-labelledby="campaign-skill-history-title" :aria-busy="status === 'loading'">
    <header class="skill-history__header">
      <div class="skill-history__title">
        <PhClipboardText :size="25" weight="duotone" aria-hidden="true" />
        <div>
          <p>Campaign record</p>
          <h2 id="campaign-skill-history-title">Skill Check history</h2>
        </div>
      </div>
      <button
        type="button"
        class="skill-history__refresh"
        :disabled="!canLoad"
        :aria-disabled="status === 'loading' ? 'true' : undefined"
        @click="load"
      >
        <PhArrowClockwise :size="18" weight="bold" aria-hidden="true" />
        {{ status === 'loading' ? 'Refreshing…' : 'Refresh' }}
      </button>
    </header>

    <p class="skill-history__summary">
      Recent terminal checks from your authorised campaign view. Private rolls and GM adjustments stay in Live Encounter.
    </p>
    <p v-if="statusMessage" class="skill-history__note" role="status" aria-live="polite">
      {{ statusMessage }}
    </p>

    <ol v-if="visibleEntries.length" class="skill-history__list">
      <li v-for="entry in visibleEntries" :key="entry.entryId" :class="`skill-history__row skill-history__row--${entry.state}`">
        <span class="skill-history__state">
          <PhCheckCircle v-if="entry.state === 'accepted'" :size="18" weight="fill" aria-hidden="true" />
          <PhMinusCircle v-else-if="entry.state === 'cancelled'" :size="18" weight="bold" aria-hidden="true" />
          <PhClock v-else :size="18" weight="bold" aria-hidden="true" />
          {{ stateLabel(entry) }}
        </span>
        <span class="skill-history__record">
          <strong>{{ entry.publicLabel }}</strong>
          <small>{{ outcomeLabel(entry) }}</small>
        </span>
        <time :datetime="isoTime(entry.terminalAt)">{{ relativeTime(entry.terminalAt) }}</time>
      </li>
    </ol>

    <button v-if="hasMore" type="button" class="skill-history__more" @click="showMore">
      Show {{ Math.min(4, entries.length - visibleCount) }} more
    </button>

    <NuxtLink to="/play" class="skill-history__action">
      Open Live Encounter
      <PhArrowRight :size="18" weight="bold" aria-hidden="true" />
    </NuxtLink>
  </section>
</template>

<style scoped>
.skill-history {
  display: grid;
  gap: var(--rt-space-3, .75rem);
  min-width: 0;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  border-inline-start: 3px solid color-mix(in srgb, var(--rt-focus, #59d8ff) 72%, transparent);
  background: var(--rt-surface-1, var(--paper-soft));
  padding: var(--rt-space-4, 1rem);
}
.skill-history__header,
.skill-history__title,
.skill-history__state,
.skill-history__action,
.skill-history__refresh {
  display: flex;
  align-items: center;
}
.skill-history__header { justify-content: space-between; gap: .75rem; }
.skill-history__title { min-width: 0; gap: .65rem; }
.skill-history__title > svg { flex: 0 0 auto; color: var(--rt-focus, var(--info)); }
.skill-history__title p,
.skill-history__title h2,
.skill-history__summary,
.skill-history__note { margin: 0; }
.skill-history__title p {
  color: var(--rt-text-muted, var(--ink-muted));
  font-size: .7rem;
  font-weight: 850;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.skill-history__title h2 {
  margin-top: .15rem;
  overflow-wrap: anywhere;
  color: var(--rt-text-strong, var(--ink-bright));
  font: 700 1.45rem/1.1 var(--font-book);
}
.skill-history__refresh,
.skill-history__more {
  min-height: 44px;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text, var(--ink));
  cursor: pointer;
  font-weight: 750;
  padding: .55rem .75rem;
}
.skill-history__refresh { flex: 0 0 auto; justify-content: center; gap: .4rem; }
.skill-history__refresh:disabled,
.skill-history__refresh[aria-disabled='true'] { cursor: progress; opacity: .62; }
.skill-history__summary,
.skill-history__note {
  color: var(--rt-text-muted, var(--ink-muted));
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.skill-history__list {
  display: grid;
  gap: .4rem;
  min-width: 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.skill-history__row {
  display: grid;
  grid-template-columns: minmax(6.8rem, auto) minmax(0, 1fr) auto;
  align-items: center;
  gap: .7rem;
  min-height: 56px;
  min-width: 0;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  padding: .55rem .65rem;
}
.skill-history__state { gap: .4rem; font-size: .76rem; font-weight: 850; }
.skill-history__row--accepted .skill-history__state { color: var(--rt-ready, #65dba5); }
.skill-history__row--cancelled .skill-history__state,
.skill-history__row--timed-out .skill-history__state { color: var(--rt-text-muted, var(--ink-muted)); }
.skill-history__record { min-width: 0; }
.skill-history__record strong,
.skill-history__record small { display: block; overflow-wrap: anywhere; }
.skill-history__record strong { color: var(--rt-text-strong, var(--ink-bright)); }
.skill-history__record small,
.skill-history__row time { color: var(--rt-text-muted, var(--ink-muted)); font-size: .72rem; }
.skill-history__row time { white-space: nowrap; font-variant-numeric: tabular-nums; }
.skill-history__more { width: 100%; }
.skill-history__action {
  justify-content: center;
  gap: .45rem;
  min-height: 46px;
  border: 1px solid var(--rt-focus, var(--info));
  color: var(--rt-text-strong, var(--ink-bright));
  text-decoration: none;
  font-weight: 800;
  padding: .65rem 1rem;
}
.skill-history button:focus-visible,
.skill-history a:focus-visible {
  outline: 3px solid var(--rt-focus, #59d8ff);
  outline-offset: 3px;
}
@media (max-width: 480px) {
  .skill-history { padding: .8rem; }
  .skill-history__header { align-items: flex-start; }
  .skill-history__refresh { width: 44px; padding-inline: 0; font-size: 0; }
  .skill-history__refresh svg { width: 18px; height: 18px; }
  .skill-history__row { grid-template-columns: minmax(0, 1fr); gap: .25rem; }
  .skill-history__row time { white-space: normal; }
}
@media (prefers-reduced-motion: reduce) {
  .skill-history *, .skill-history *::before, .skill-history *::after { scroll-behavior: auto !important; transition: none !important; }
}
</style>
