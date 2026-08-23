<script setup lang="ts">
import {
  PhArrowRight,
  PhArrowsClockwise,
  PhCheckCircle,
  PhClipboardText,
  PhEgg,
  PhFirstAid,
  PhLightning,
  PhSword,
  PhToolbox,
  PhTrendUp,
  PhUsersThree,
  PhWarningCircle,
} from '@phosphor-icons/vue'
import { computed } from 'vue'
import type { CampaignAttentionItem, CampaignAttentionReason } from '#shared/campaignAttention/model'
import type { CampaignContinuationProjectionV1 } from '#shared/campaignContinuation'
import type { CampaignContinuationLoadStatus } from '~/composables/campaign/useCampaignContinuationDashboard'

const props = defineProps<{
  projection: CampaignContinuationProjectionV1 | null
  status: CampaignContinuationLoadStatus
  error: string | null
  hasSelectedProfile: boolean
}>()

const emit = defineEmits<{
  refresh: []
}>()

type CategoryId = 'decision' | 'recovery' | 'growth' | 'team' | 'equipment'

const categoryDefinitions = [
  { id: 'decision', label: 'Needs a decision', icon: PhLightning, empty: 'No other general decisions are waiting.' },
  { id: 'recovery', label: 'Recovery & care', icon: PhFirstAid, empty: 'No recovery or treatment follow-up is waiting.' },
  { id: 'growth', label: 'Growth & training', icon: PhTrendUp, empty: 'No advancement or training choice is waiting.' },
  { id: 'team', label: 'Team, captures & eggs', icon: PhUsersThree, empty: 'No team, capture, hatch, or ownership work is waiting.' },
  { id: 'equipment', label: 'Equipment', icon: PhToolbox, empty: 'Nothing needs equipment attention.' },
] as const

const recoveryReasons = new Set<CampaignAttentionReason>(['medical-review', 'recovery-review'])
const growthReasons = new Set<CampaignAttentionReason>([
  'level-threshold', 'advancement-review', 'unspent-advancement', 'invalid-advancement',
  'move-learning', 'ability-choice', 'evolution-choice', 'form-choice',
  'post-evolution-review', 'trainer-advancement',
])
const teamReasons = new Set<CampaignAttentionReason>([
  'capture-review', 'team-overflow', 'hatch-review', 'ownership-review',
])

const categoryFor = (reason: CampaignAttentionReason): CategoryId => {
  if (recoveryReasons.has(reason)) return 'recovery'
  if (growthReasons.has(reason)) return 'growth'
  if (teamReasons.has(reason)) return 'team'
  if (reason === 'equipment-review') return 'equipment'
  return 'decision'
}

const items = computed(() => props.projection?.attention.items ?? [])
const recommended = computed(() => items.value[0] ?? null)
const categories = computed(() => categoryDefinitions.map(definition => ({
  ...definition,
  items: items.value.filter(item => categoryFor(item.reason) === definition.id),
})))
const attention = computed(() => props.projection?.attention ?? null)
const isInitialLoading = computed(() => props.status === 'loading' && !props.projection)
const isRefreshing = computed(() => props.status === 'refreshing')
const campaignBlocked = computed(() => (attention.value?.summary.blocking ?? 0) > 0)

const reasonLabel: Readonly<Record<CampaignAttentionReason, string>> = {
  'level-threshold': 'Level review',
  'advancement-review': 'Advancement review',
  'unspent-advancement': 'Unspent advancement',
  'invalid-advancement': 'Advancement needs repair',
  'move-learning': 'Move choice',
  'ability-choice': 'Ability choice',
  'evolution-choice': 'Evolution choice',
  'form-choice': 'Form choice',
  'post-evolution-review': 'Post-evolution review',
  'trainer-advancement': 'Trainer advancement',
  'capture-review': 'Capture review',
  'team-overflow': 'Team over capacity',
  'hatch-review': 'Hatch review',
  'ownership-review': 'Ownership review',
  'medical-review': 'Medical attention',
  'recovery-review': 'Recovery review',
  'equipment-review': 'Equipment review',
  'skill-check-response': 'Skill Check response',
  'skill-check-resolution': 'Skill Check GM review',
  'continuation-review': 'Campaign follow-up',
}

const reasonDescription: Readonly<Record<CampaignAttentionReason, string>> = {
  'level-threshold': 'A recent level change needs an explicit review.',
  'advancement-review': 'Recent advancement is ready for review.',
  'unspent-advancement': 'Available advancement remains to be allocated.',
  'invalid-advancement': 'Current advancement authority needs correction.',
  'move-learning': 'A learned Move decision is still open.',
  'ability-choice': 'An Ability decision is still open.',
  'evolution-choice': 'An Evolution decision is still open.',
  'form-choice': 'A form decision is still open.',
  'post-evolution-review': 'Accepted Evolution changes need follow-up.',
  'trainer-advancement': 'Trainer growth choices remain to be reviewed.',
  'capture-review': 'A settled capture needs explicit follow-up.',
  'team-overflow': 'The current team exceeds its supported capacity.',
  'hatch-review': 'A newly hatched Pokémon needs review.',
  'ownership-review': 'Roster or Profile ownership needs explicit repair.',
  'medical-review': 'Current health authority needs treatment review.',
  'recovery-review': 'Current recovery state needs follow-up.',
  'equipment-review': 'Current equipment authority needs review.',
  'skill-check-response': 'A requested Skill Check still needs a subject response.',
  'skill-check-resolution': 'A ready or declined Skill Check needs GM review.',
  'continuation-review': 'A campaign continuation remains to be reviewed.',
}

const actionLabel = (item: CampaignAttentionItem, intent: CampaignAttentionItem['legalActions'][number]['intent']): string => {
  if (item.reason === 'skill-check-response' || item.reason === 'skill-check-resolution') return 'Open Live Encounter'
  const labels: Record<typeof intent, string> = {
    'review-advancement': 'Review advancement',
    'review-moves': 'Review moves',
    'review-abilities': 'Review abilities',
    'review-evolution': 'Review evolution',
    'review-form': 'Review form',
    'review-post-evolution': 'Review changes',
    'review-trainer': 'Review Trainer',
    'review-capture': 'Review capture',
    'review-team': 'Review team',
    'review-hatch': 'Review hatch',
    'review-ownership': 'Review ownership',
    'start-treatment': 'Review treatment',
    'review-recovery': 'Review recovery',
    'review-equipment': 'Review equipment',
    'continue-campaign': 'Continue campaign',
  }
  return labels[intent] ?? reasonLabel[item.reason]
}

const titleCase = (value: string): string => value
  .split(/[-_]+/u)
  .filter(Boolean)
  .map(part => `${part.charAt(0).toLocaleUpperCase('en-US')}${part.slice(1)}`)
  .join(' ')

const entityLabel = (item: CampaignAttentionItem): string => {
  if (item.entity.kind === 'trainer-sheet') return `Trainer · ${titleCase(item.entity.id)}`
  if (item.entity.kind === 'pokemon-sheet') return `Pokémon · ${titleCase(item.entity.id)}`
  if (item.entity.kind === 'egg') return 'Pokémon Egg'
  if (item.entity.kind === 'profile') return 'Player Profile'
  if (item.entity.kind === 'encounter') return 'Encounter'
  if (item.entity.kind === 'settlement') return 'Encounter settlement'
  if (item.entity.kind === 'breeding-project') return 'Breeding project'
  if (item.entity.kind === 'group-inventory') return 'Group inventory'
  return 'Campaign'
}

const urgencyLabel = (item: CampaignAttentionItem): string => ({
  blocking: 'Blocking', urgent: 'Urgent', normal: 'Open', informational: 'Information',
})[item.urgency]

const settlementStateLabel = computed(() => {
  const state = props.projection?.unfinishedSettlement?.state
  if (state === 'ready-to-finish') return 'Ready to finish'
  if (state === 'finishing') return 'Finishing'
  return 'Needs review'
})
</script>

<template>
  <section class="continuation" aria-labelledby="campaign-continuation-title">
    <header class="continuation__header">
      <div>
        <p class="continuation__eyebrow">Campaign continuation</p>
        <h1 id="campaign-continuation-title">What needs attention</h1>
        <p class="continuation__intro">
          <template v-if="attention?.summary.total">
            {{ attention.summary.total }} open {{ attention.summary.total === 1 ? 'item is' : 'items are' }} waiting before play continues.
          </template>
          <template v-else>
            Current campaign authority has no open attention items.
          </template>
        </p>
      </div>
      <button
        type="button"
        class="continuation__refresh"
        :disabled="status === 'loading' || status === 'refreshing'"
        @click="emit('refresh')"
      >
        <PhArrowsClockwise :size="19" weight="bold" aria-hidden="true" />
        {{ isRefreshing ? 'Refreshing…' : 'Refresh' }}
      </button>
    </header>

    <div v-if="error" class="continuation__error" role="alert">
      <div>
        <strong>Campaign attention is unavailable.</strong>
        <p>{{ error }}</p>
      </div>
      <button type="button" @click="emit('refresh')">Try again</button>
    </div>

    <div v-if="isInitialLoading" class="continuation__loading" role="status">
      <PhArrowsClockwise :size="24" weight="bold" aria-hidden="true" />
      Loading current campaign authority…
    </div>

    <div v-else-if="projection" class="continuation__layout">
      <div class="continuation__primary">
        <section class="resume-grid" aria-label="Campaign resumptions">
          <article class="resume-card">
            <div class="resume-card__body">
              <PhSword :size="26" weight="duotone" aria-hidden="true" />
              <div>
                <p>Active encounter</p>
                <h2>{{ projection.activeEncounter?.label ?? 'No active encounter' }}</h2>
                <small v-if="projection.activeEncounter">
                  {{ projection.activeEncounter.state === 'paused' ? 'Paused' : 'Live' }}
                  · Round {{ projection.activeEncounter.round }}
                  · {{ projection.activeEncounter.participantCount }} participants
                </small>
                <small v-else>The campaign is not currently in an encounter.</small>
              </div>
            </div>
            <NuxtLink v-if="projection.activeEncounter" :to="projection.activeEncounter.href" class="resume-card__link">
              Return to encounter
              <PhArrowRight :size="18" weight="bold" aria-hidden="true" />
            </NuxtLink>
            <span v-else class="resume-card__empty">Nothing to resume</span>
          </article>

          <article class="resume-card">
            <div class="resume-card__body">
              <PhClipboardText :size="26" weight="duotone" aria-hidden="true" />
              <div>
                <p>Unfinished settlement</p>
                <h2>{{ projection.unfinishedSettlement?.label ?? 'No unfinished settlement' }}</h2>
                <small v-if="projection.unfinishedSettlement">
                  {{ settlementStateLabel }}<template v-if="projection.unfinishedSettlement.openWorkCount !== null"> · {{ projection.unfinishedSettlement.openWorkCount }} open gates</template>
                </small>
                <small v-else>Encounter rewards and consequences are settled.</small>
              </div>
            </div>
            <NuxtLink v-if="projection.unfinishedSettlement" :to="projection.unfinishedSettlement.href" class="resume-card__link">
              Review settlement
              <PhArrowRight :size="18" weight="bold" aria-hidden="true" />
            </NuxtLink>
            <span v-else class="resume-card__empty resume-card__empty--clear">
              <PhCheckCircle :size="18" weight="fill" aria-hidden="true" />
              Clear
            </span>
          </article>
        </section>

        <article
          class="recommendation"
          :class="recommended ? `recommendation--${recommended.urgency}` : 'recommendation--clear'"
          aria-labelledby="recommended-action-title"
        >
          <div class="recommendation__icon" aria-hidden="true">
            <PhWarningCircle v-if="recommended" :size="30" weight="fill" />
            <PhCheckCircle v-else :size="30" weight="fill" />
          </div>
          <div class="recommendation__copy">
            <p class="recommendation__eyebrow">Recommended next action</p>
            <h2 id="recommended-action-title">
              {{ recommended ? reasonLabel[recommended.reason] : 'Campaign ready' }}
            </h2>
            <p v-if="recommended" class="recommendation__state">{{ urgencyLabel(recommended) }} · {{ entityLabel(recommended) }}</p>
            <p>{{ recommended ? reasonDescription[recommended.reason] : 'No open decision is blocking the next campaign step.' }}</p>
          </div>
          <div v-if="recommended" class="recommendation__actions">
            <NuxtLink
              v-for="action in recommended.legalActions"
              :key="action.actionId"
              :to="action.href"
              class="recommendation__action"
            >
              {{ actionLabel(recommended, action.intent) }}
              <PhArrowRight :size="19" weight="bold" aria-hidden="true" />
            </NuxtLink>
          </div>
        </article>

        <div class="attention-groups">
          <section
            v-for="category in categories"
            :key="category.id"
            class="attention-group"
            :aria-labelledby="`attention-group-${category.id}`"
          >
            <header class="attention-group__header">
              <component :is="category.icon" :size="20" weight="duotone" aria-hidden="true" />
              <h2 :id="`attention-group-${category.id}`">{{ category.label }}</h2>
              <span>{{ category.items.length }}</span>
            </header>

            <ul v-if="category.items.length" class="attention-list">
              <li v-for="item in category.items" :key="item.itemId">
                <article class="attention-row" :class="`attention-row--${item.urgency}`">
                  <div class="attention-row__state">
                    <span aria-hidden="true" />
                    {{ urgencyLabel(item) }}
                  </div>
                  <div class="attention-row__copy">
                    <strong>{{ reasonLabel[item.reason] }}</strong>
                    <span>{{ entityLabel(item) }}</span>
                    <p>{{ reasonDescription[item.reason] }}</p>
                  </div>
                  <div class="attention-row__actions">
                    <NuxtLink
                      v-for="action in item.legalActions"
                      :key="action.actionId"
                      :to="action.href"
                    >
                      {{ actionLabel(item, action.intent) }}
                    </NuxtLink>
                  </div>
                </article>
              </li>
            </ul>
            <p v-else class="attention-group__empty">{{ category.empty }}</p>

            <NuxtLink
              v-if="category.id === 'team' && projection.eggs.active > 0"
              :to="projection.eggs.href"
              class="egg-summary"
            >
              <PhEgg :size="23" weight="duotone" aria-hidden="true" />
              <span>
                <strong>{{ projection.eggs.active }} active {{ projection.eggs.active === 1 ? 'Egg' : 'Eggs' }}</strong>
                <small>
                  {{ projection.eggs.incubating }} incubating · {{ projection.eggs.ready }} ready · {{ projection.eggs.hatching }} hatching
                </small>
              </span>
              <PhArrowRight :size="18" weight="bold" aria-hidden="true" />
            </NuxtLink>
          </section>
        </div>
      </div>

      <aside class="continuation__rail" aria-label="Campaign continuation summary">
        <section class="attention-summary" aria-labelledby="attention-summary-title">
          <h2 id="attention-summary-title">Open work</h2>
          <dl>
            <div><dt>Blocking</dt><dd>{{ attention?.summary.blocking ?? 0 }}</dd></div>
            <div><dt>Urgent</dt><dd>{{ attention?.summary.urgent ?? 0 }}</dd></div>
            <div><dt>Other open</dt><dd>{{ (attention?.summary.normal ?? 0) + (attention?.summary.informational ?? 0) }}</dd></div>
          </dl>
        </section>

        <section class="campaign-readiness" :class="{ 'campaign-readiness--clear': !campaignBlocked }">
          <PhWarningCircle v-if="campaignBlocked" :size="22" weight="fill" aria-hidden="true" />
          <PhCheckCircle v-else :size="22" weight="fill" aria-hidden="true" />
          <div>
            <h2>{{ campaignBlocked ? 'Campaign blocked' : 'Campaign ready' }}</h2>
            <p>{{ campaignBlocked ? 'Resolve blocking work before moving forward.' : 'No blocking attention remains.' }}</p>
          </div>
        </section>

        <p v-if="attention?.scope === 'owner' && !hasSelectedProfile" class="profile-notice">
          Choose a Player Profile to see owned campaign decisions.
        </p>

        <slot name="campaign-tools" />
      </aside>
    </div>
  </section>
</template>

<style scoped>
.continuation {
  display: grid;
  gap: var(--rt-space-6, 1.5rem);
  color: var(--rt-text, var(--ink));
}
.continuation__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--rt-space-4, 1rem);
}
.continuation__eyebrow,
.recommendation__eyebrow {
  margin: 0 0 var(--rt-space-1, .25rem);
  color: var(--rt-text-muted, var(--ink-muted));
  font-size: .76rem;
  font-weight: 850;
  letter-spacing: .12em;
  text-transform: uppercase;
}
.continuation h1 {
  margin: 0;
  color: var(--rt-text-strong, var(--ink-bright));
  font: 700 clamp(2rem, 4vw, 3.35rem)/1 var(--font-book);
  letter-spacing: .01em;
}
.continuation__intro {
  max-width: 68ch;
  margin: var(--rt-space-2, .5rem) 0 0;
  color: var(--rt-text-muted, var(--ink-soft));
  line-height: 1.5;
}
.continuation__refresh,
.continuation__error button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--rt-space-2, .5rem);
  min-height: 44px;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text-strong, var(--ink-bright));
  cursor: pointer;
  padding: .65rem 1rem;
}
.continuation__refresh:disabled { cursor: progress; opacity: .65; }
.continuation__error,
.continuation__loading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--rt-space-4, 1rem);
  min-height: 5rem;
  border: 1px solid var(--rt-danger, var(--bad));
  background: var(--rt-surface-1, var(--paper-soft));
  padding: var(--rt-space-4, 1rem);
}
.continuation__error p { margin: .25rem 0 0; color: var(--rt-text-muted, var(--ink-soft)); }
.continuation__loading { justify-content: center; border-color: var(--rt-rule, var(--rule)); color: var(--rt-text-muted, var(--ink-soft)); }
.continuation__layout {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(17rem, 1fr);
  align-items: start;
  gap: var(--rt-space-6, 1.5rem);
}
.continuation__primary,
.continuation__rail,
.attention-groups { display: grid; align-content: start; gap: var(--rt-space-4, 1rem); }
.resume-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--rt-space-3, .75rem); }
.resume-card {
  display: grid;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
}
.resume-card__body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: var(--rt-space-3, .75rem);
  min-height: 6.6rem;
  padding: var(--rt-space-4, 1rem);
}
.resume-card__body > svg { color: var(--rt-text-muted, var(--ink-muted)); }
.resume-card p,
.resume-card h2,
.resume-card small { margin: 0; }
.resume-card p { color: var(--rt-text-muted, var(--ink-muted)); font-size: .82rem; }
.resume-card h2 { margin-top: .2rem; color: var(--rt-text-strong, var(--ink-bright)); font: 700 1.35rem/1.1 var(--font-book); }
.resume-card small { display: block; margin-top: .35rem; color: var(--rt-text-muted, var(--ink-muted)); line-height: 1.35; }
.resume-card__link,
.resume-card__empty {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .5rem;
  min-height: 44px;
  border-top: 1px solid var(--rt-rule, var(--rule-soft));
  color: var(--rt-text-strong, var(--ink-bright));
  padding: .65rem 1rem;
  text-decoration: none;
}
.resume-card__empty { color: var(--rt-text-muted, var(--ink-muted)); }
.resume-card__empty--clear { justify-content: flex-start; color: var(--rt-success, var(--good)); }
.recommendation {
  --recommendation-signal: var(--rt-pending, var(--warn));
  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) minmax(10rem, auto);
  align-items: center;
  gap: var(--rt-space-4, 1rem);
  min-height: 9.5rem;
  clip-path: polygon(0 0, calc(100% - 1.25rem) 0, 100% 1.25rem, 100% 100%, 1.25rem 100%, 0 calc(100% - 1.25rem));
  border: 1px solid var(--recommendation-signal);
  background: var(--rt-surface-1, var(--paper-soft));
  padding: clamp(1rem, 2vw, 1.4rem);
}
.recommendation::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: var(--recommendation-signal);
}
.recommendation--clear { --recommendation-signal: var(--rt-success, var(--good)); grid-template-columns: auto minmax(0, 1fr); }
.recommendation--urgent { --recommendation-signal: var(--rt-pending, var(--warn)); }
.recommendation--normal,
.recommendation--informational { --recommendation-signal: var(--rt-focus, var(--info)); }
.recommendation__icon { color: var(--recommendation-signal); }
.recommendation__copy h2,
.recommendation__copy p { margin: 0; }
.recommendation__copy h2 { color: var(--rt-text-strong, var(--ink-bright)); font: 700 clamp(1.45rem, 2.7vw, 2rem)/1.1 var(--font-book); }
.recommendation__copy > p:last-child { margin-top: .45rem; color: var(--rt-text-muted, var(--ink-soft)); line-height: 1.45; }
.recommendation__state { margin-top: .4rem !important; color: var(--recommendation-signal); font-size: .84rem; font-weight: 800; }
.recommendation__actions { display: grid; gap: .5rem; }
.recommendation__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .6rem;
  min-height: 48px;
  border: 2px solid var(--rt-brand, var(--accent));
  background: var(--rt-brand, var(--accent));
  color: var(--rt-on-brand, #07090d);
  font-weight: 850;
  padding: .7rem 1rem;
  text-decoration: none;
}
.attention-group { display: grid; gap: var(--rt-space-2, .5rem); }
.attention-group__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: .55rem;
  color: var(--rt-text-strong, var(--ink-bright));
}
.attention-group__header svg { color: var(--rt-text-muted, var(--ink-muted)); }
.attention-group__header h2 { margin: 0; font-size: 1rem; }
.attention-group__header > span { min-width: 2ch; color: var(--rt-text-muted, var(--ink-muted)); font-variant-numeric: tabular-nums; text-align: right; }
.attention-list { display: grid; gap: .5rem; margin: 0; padding: 0; list-style: none; }
.attention-row {
  --row-signal: var(--rt-focus, var(--info));
  display: grid;
  grid-template-columns: minmax(6rem, .72fr) minmax(0, 2fr) auto;
  align-items: center;
  gap: var(--rt-space-3, .75rem);
  min-height: 4.5rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  padding: .65rem .75rem;
}
.attention-row--blocking,
.attention-row--urgent { --row-signal: var(--rt-pending, var(--warn)); }
.attention-row--informational { --row-signal: var(--rt-text-muted, var(--ink-muted)); }
.attention-row__state { display: flex; align-items: center; gap: .45rem; color: var(--row-signal); font-size: .78rem; font-weight: 800; text-transform: uppercase; }
.attention-row__state > span { width: .55rem; height: .55rem; border: 2px solid currentColor; transform: rotate(45deg); }
.attention-row__copy { display: grid; gap: .12rem; min-width: 0; }
.attention-row__copy strong { color: var(--rt-text-strong, var(--ink-bright)); }
.attention-row__copy > span { color: var(--rt-text-muted, var(--ink-muted)); font-size: .78rem; }
.attention-row__copy p { margin: .2rem 0 0; color: var(--rt-text-muted, var(--ink-soft)); font-size: .9rem; line-height: 1.35; }
.attention-row__actions { display: flex; flex-wrap: wrap; justify-content: end; gap: .4rem; }
.attention-row__actions a,
.egg-summary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text-strong, var(--ink-bright));
  padding: .55rem .8rem;
  text-decoration: none;
}
.attention-group__empty { margin: 0; border: 1px solid var(--rt-rule, var(--rule-soft)); color: var(--rt-text-muted, var(--ink-muted)); padding: .75rem; }
.egg-summary { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; justify-content: stretch; gap: .7rem; color: var(--rt-text, var(--ink)); text-align: left; }
.egg-summary > svg:first-child { color: var(--rt-pending, var(--warn)); }
.egg-summary span { display: grid; gap: .15rem; }
.egg-summary strong { color: var(--rt-text-strong, var(--ink-bright)); }
.egg-summary small { color: var(--rt-text-muted, var(--ink-muted)); }
.continuation__rail { position: sticky; top: 1rem; }
.attention-summary,
.campaign-readiness,
.profile-notice {
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  padding: var(--rt-space-4, 1rem);
}
.attention-summary h2,
.campaign-readiness h2 { margin: 0; color: var(--rt-text-strong, var(--ink-bright)); font: 700 1.35rem/1.1 var(--font-book); }
.attention-summary dl { display: grid; margin: .75rem 0 0; }
.attention-summary dl > div { display: flex; justify-content: space-between; gap: 1rem; border-top: 1px solid var(--rt-rule, var(--rule-soft)); padding: .75rem 0; }
.attention-summary dt { color: var(--rt-text-muted, var(--ink-soft)); }
.attention-summary dd { margin: 0; color: var(--rt-text-strong, var(--ink-bright)); font-size: 1.12rem; font-weight: 800; }
.campaign-readiness { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .7rem; border-left: 3px solid var(--rt-pending, var(--warn)); }
.campaign-readiness > svg { color: var(--rt-pending, var(--warn)); }
.campaign-readiness p { margin: .4rem 0 0; color: var(--rt-text-muted, var(--ink-soft)); line-height: 1.4; }
.campaign-readiness--clear { border-left-color: var(--rt-success, var(--good)); }
.campaign-readiness--clear > svg { color: var(--rt-success, var(--good)); }
.profile-notice { margin: 0; color: var(--rt-pending, var(--warn)); line-height: 1.45; }
.continuation a:focus-visible,
.continuation button:focus-visible {
  outline: 3px solid var(--rt-focus, #59d8ff);
  outline-offset: 3px;
}
@media (max-width: 980px) {
  .continuation__layout { grid-template-columns: 1fr; }
  .continuation__rail { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .continuation__rail > :deep(*) { min-width: 0; }
}
@media (max-width: 720px) {
  .continuation__header { align-items: stretch; flex-direction: column; }
  .continuation__refresh { width: 100%; }
  .resume-grid,
  .continuation__rail { grid-template-columns: 1fr; }
  .recommendation { grid-template-columns: auto minmax(0, 1fr); }
  .recommendation__actions { grid-column: 1 / -1; }
  .recommendation__action { width: 100%; }
  .attention-row { grid-template-columns: 1fr; }
  .attention-row__actions { justify-content: stretch; }
  .attention-row__actions a { width: 100%; }
}
@media (max-width: 420px) {
  .continuation { gap: 1rem; }
  .continuation h1 { font-size: 2rem; }
  .resume-card__body { grid-template-columns: 1fr; }
  .recommendation { grid-template-columns: 1fr; clip-path: none; }
  .recommendation__actions { grid-column: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .continuation *,
  .continuation *::before,
  .continuation *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
</style>
