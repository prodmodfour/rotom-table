<script setup lang="ts">
import { computed } from 'vue'
import type { OnboardingCreationCatalog } from '#shared/onboarding/catalog'
import type { OnboardingDraftV1 } from '#shared/onboarding/draft'
import type { OnboardingDraftState } from '#shared/onboarding/lifecycle'
import type { PublishedOnboardingPolicyV1 } from '#shared/onboarding/policy'
import { computeOnboardingTrainerPreview, computeOnboardingPokemonPreview } from '#shared/onboarding/preview'
import type { OnboardingValidationSummary } from '#shared/onboarding/validation'
import OnboardingIssueList from '~/components/onboarding/OnboardingIssueList.vue'

const props = defineProps<{
  decisionId: string
  draft: OnboardingDraftV1
  draftState: OnboardingDraftState
  revision: number
  policy: PublishedOnboardingPolicyV1
  catalog: OnboardingCreationCatalog
  validation: OnboardingValidationSummary | null
  editable: boolean
  submitting: boolean
  submitError: string | null
  reviewEntries?: readonly {
    entryId: string
    submissionRevision: number
    kind: string
    payload: Record<string, unknown>
    createdAt: number
  }[]
}>()

const emit = defineEmits<{
  (event: 'swap-team', firstBuildId: string, secondBuildId: string): void
  (event: 'focus-decision', decisionId: string): void
  (event: 'refresh'): void
  (event: 'submit'): void
  (event: 'acknowledge', correctionEntryId: string): void
}>()

const acknowledgedIds = computed(() => new Set(
  (props.reviewEntries ?? [])
    .filter(entry => entry.kind === 'acknowledgement')
    .map(entry => String(entry.payload.correctionEntryId ?? '')),
))

const historyEntries = computed(() =>
  [...(props.reviewEntries ?? [])]
    .filter(entry => entry.kind === 'change-request' || entry.kind === 'correction')
    .sort((left, right) => right.createdAt - left.createdAt))

const trainerPreview = computed(() =>
  computeOnboardingTrainerPreview(props.draft.trainerBuild, props.policy.content.trainer.startingLevel, props.catalog))

const starterPreviews = computed(() => props.draft.pokemonBuilds.map(build => ({
  build,
  preview: computeOnboardingPokemonPreview(build, props.policy.content.pokemon.starterLevel, props.catalog),
})))

const blockingIssues = computed(() =>
  (props.validation?.issues ?? []).filter(issue => issue.severity === 'blocking'))
const reviewNotes = computed(() =>
  (props.validation?.issues ?? []).filter(issue => issue.severity !== 'blocking'))

const isTeamDecision = computed(() => props.decisionId === 'pokemon.team')

/* Team ordering: swap teamSlots (P9-048). */
const orderedBuilds = computed(() =>
  [...props.draft.pokemonBuilds].sort((left, right) => (left.teamSlot ?? 99) - (right.teamSlot ?? 99)))

const moveStarter = (buildId: string, direction: -1 | 1): void => {
  if (!props.editable) return
  const ordered = orderedBuilds.value
  const index = ordered.findIndex(build => build.buildId === buildId)
  const swapWith = index + direction
  if (index < 0 || swapWith < 0 || swapWith >= ordered.length) return
  emit('swap-team', ordered[index]!.buildId, ordered[swapWith]!.buildId)
}

const canSubmit = computed(() =>
  props.editable
  && props.validation?.submittable === true
  && !props.submitting)
</script>

<template>
  <article class="decision-card" :aria-labelledby="`decision-title-${decisionId}`">
    <header class="decision-card__header">
      <h2 :id="`decision-title-${decisionId}`">{{ isTeamDecision ? 'Team order' : 'Review & submit' }}</h2>
      <span class="decision-card__meta">{{ isTeamDecision ? 'TEAM' : 'REVIEW' }}</span>
    </header>

    <!-- Team ordering -->
    <template v-if="isTeamDecision">
      <p class="decision-card__prompt">Order your starting team. Slot 1 leads.</p>
      <ul class="chosen-rows">
        <li v-for="(build, index) in orderedBuilds" :key="build.buildId" class="chosen-row">
          <span class="chosen-row__name">
            {{ build.teamSlot ?? '?' }}. {{ build.nickname ?? build.speciesId ?? 'Undecided starter' }}
          </span>
          <div class="team-order__controls">
            <button type="button" :disabled="!editable || index === 0" :aria-label="`Move ${build.speciesId ?? build.buildId} up`" @click="moveStarter(build.buildId, -1)">↑</button>
            <button type="button" :disabled="!editable || index === orderedBuilds.length - 1" :aria-label="`Move ${build.speciesId ?? build.buildId} down`" @click="moveStarter(build.buildId, 1)">↓</button>
          </div>
        </li>
      </ul>
    </template>

    <!-- Full review -->
    <template v-else>
      <p class="decision-card__prompt">
        Everything below is exactly what the GM will review. Submitting freezes this snapshot;
        later edits create a new submission.
      </p>

      <section class="review-block">
        <h3>{{ draft.trainerBuild.name ?? 'Unnamed Trainer' }} — Trainer Lv {{ policy.content.trainer.startingLevel }}</h3>
        <dl class="review-facts">
          <div><dt>Max HP</dt><dd>{{ trainerPreview.maxHp.value }}</dd></div>
          <div><dt>AP</dt><dd>{{ trainerPreview.apMax.value }}</dd></div>
          <div><dt>Stat points</dt><dd>{{ trainerPreview.statPoints.spent }}/{{ trainerPreview.statPoints.budget }}</dd></div>
          <div><dt>Background</dt><dd>{{ draft.trainerBuild.background?.name ?? '—' }}</dd></div>
          <div><dt>Training</dt><dd>{{ draft.trainerBuild.trainingFeatureId ?? '—' }}</dd></div>
          <div><dt>Edges</dt><dd>{{ draft.trainerBuild.edges.map(edge => edge.canonicalId + (edge.choices.skill ? ` (${edge.choices.skill})` : '')).join(', ') || '—' }}</dd></div>
          <div><dt>Features</dt><dd>{{ draft.trainerBuild.features.map(feature => feature.canonicalId).join(', ') || '—' }}</dd></div>
          <div v-if="policy.content.packages.trainerItems.length > 0">
            <dt>Starting items</dt>
            <dd>{{ policy.content.packages.trainerItems.map(grant => `${grant.itemId} ×${grant.quantity}`).join(', ') }}</dd>
          </div>
          <div>
            <dt>Money</dt>
            <dd>
              {{ policy.content.trainer.startingMoney.kind === 'explicit'
                ? policy.content.trainer.startingMoney.amount
                : catalog.trainer.startingMoney.recommendedDefault }}
            </dd>
          </div>
        </dl>
      </section>

      <section v-for="entry in starterPreviews" :key="entry.build.buildId" class="review-block">
        <h3>
          {{ entry.build.nickname ? `${entry.build.nickname} · ` : '' }}{{ entry.build.speciesId ?? 'Species not chosen' }}
          — Lv {{ policy.content.pokemon.starterLevel }}
        </h3>
        <dl class="review-facts">
          <div><dt>Max HP</dt><dd>{{ entry.preview?.maxHp.value ?? '—' }}</dd></div>
          <div><dt>Nature</dt><dd>{{ entry.build.natureId ?? '—' }}</dd></div>
          <div><dt>Gender</dt><dd>{{ entry.build.gender ?? (entry.build.speciesId && catalog.species.get(entry.build.speciesId)?.genderless ? 'Genderless' : '—') }}</dd></div>
          <div><dt>Ability</dt><dd>{{ entry.build.abilityIds.join(', ') || '—' }}</dd></div>
          <div><dt>Moves</dt><dd>{{ entry.build.moveIds.join(', ') || '—' }}</dd></div>
          <div><dt>Added points</dt><dd>{{ entry.preview?.addedPoints.spent ?? 0 }}/{{ entry.preview?.addedPoints.budget ?? '—' }}</dd></div>
          <div><dt>Tutor points</dt><dd>{{ entry.preview?.tutorPoints.value ?? '—' }}</dd></div>
          <div><dt>Loyalty</dt><dd>{{ policy.content.pokemon.startingLoyalty.kind === 'explicit' ? policy.content.pokemon.startingLoyalty.value : catalog.pokemon.startingLoyalty.defaultValue }}</dd></div>
        </dl>
      </section>

      <section v-if="historyEntries.length > 0" class="review-block">
        <h3>Review history</h3>
        <ul class="review-history">
          <li v-for="entry in historyEntries" :key="entry.entryId" class="review-history__entry" :data-kind="entry.kind">
            <template v-if="entry.kind === 'change-request'">
              <strong>Changes requested</strong>
              <span>{{ (entry.payload.reasons as string[] ?? []).join(', ') }}</span>
              <p v-if="entry.payload.comment" class="review-history__comment">“{{ entry.payload.comment }}”</p>
            </template>
            <template v-else>
              <strong>GM correction — {{ entry.payload.scope }}</strong>
              <span>
                “{{ entry.payload.before ?? '—' }}” → “{{ entry.payload.after ?? '—' }}”
              </span>
              <p v-if="entry.payload.rationale" class="review-history__comment">{{ entry.payload.rationale }}</p>
              <button
                v-if="entry.payload.requiresAcknowledgement === true && !acknowledgedIds.has(entry.entryId)"
                type="button"
                class="review-history__ack"
                @click="$emit('acknowledge', entry.entryId)"
              >
                Acknowledge this correction
              </button>
              <span v-else-if="entry.payload.requiresAcknowledgement === true" class="review-history__acked">
                Acknowledged
              </span>
            </template>
          </li>
        </ul>
      </section>

      <section v-if="blockingIssues.length > 0" class="review-block review-block--blocking">
        <h3>{{ blockingIssues.length }} blocking issue(s)</h3>
        <OnboardingIssueList :issues="blockingIssues" navigable @focus-decision="$emit('focus-decision', $event)" />
      </section>
      <section v-else-if="reviewNotes.length > 0" class="review-block">
        <h3>For GM review</h3>
        <OnboardingIssueList :issues="reviewNotes" />
      </section>

      <p v-if="submitError" class="review-submit-error" role="alert">{{ submitError }}</p>

      <button
        v-if="draftState === 'draft' || draftState === 'changes-requested'"
        type="button"
        class="review-submit"
        :disabled="!canSubmit"
        @click="$emit('submit')"
      >
        {{ submitting ? 'Submitting…' : draftState === 'changes-requested' ? 'Resubmit for GM review' : 'Submit for GM review' }}
      </button>
      <p v-else class="decision-card__prompt" role="status">
        <template v-if="draftState === 'submitted'">Submitted — submission #{{ draft.submissionRevision }} is waiting for the GM.</template>
        <template v-else-if="draftState === 'approved'">Approved — waiting for the final commit.</template>
        <template v-else-if="draftState === 'completed'">Completed — your sheets are live.</template>
      </p>
    </template>
  </article>
</template>

<style scoped src="./onboardingDecision.css" />
<style scoped>
.review-block {
  display: grid;
  gap: .5rem;
  border-top: 1px solid var(--rt-rule, var(--rule-soft));
  padding-top: .7rem;
}
.review-block h3 {
  margin: 0;
  font: 700 1.05rem/1.15 var(--font-book);
  color: var(--rt-text-strong, var(--ink-bright));
}
.review-block--blocking { border-top-color: var(--rt-danger, #ff6672); }
.review-facts {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: .35rem .9rem;
}
.review-facts > div { display: flex; gap: .5rem; align-items: baseline; }
.review-facts dt {
  flex: none;
  min-inline-size: 6.5rem;
  color: var(--rt-text-muted, var(--ink-muted));
  font-size: .78rem;
  font-weight: 750;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.review-facts dd { margin: 0; font-weight: 650; }
.review-submit {
  min-height: 48px;
  padding: .7rem 1.2rem;
  border: 1px solid var(--rt-brand, #ff3347);
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 800;
  cursor: pointer;
  width: fit-content;
}
.review-submit:disabled { opacity: .5; cursor: not-allowed; }
.review-submit-error {
  margin: 0;
  padding: .55rem .8rem;
  border-left: 4px solid var(--rt-danger, #ff6672);
  background: var(--rt-surface-2, var(--paper-inset));
}
.team-order__controls { display: inline-flex; gap: .35rem; margin-left: auto; }
.team-order__controls button {
  inline-size: 44px;
  block-size: 44px;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  color: var(--rt-text-strong, var(--ink-bright));
  font-size: 1.05rem;
  cursor: pointer;
}
.team-order__controls button:disabled { opacity: .4; cursor: not-allowed; }
.review-history { list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem; }
.review-history__entry {
  display: grid;
  gap: .25rem;
  border-left: 4px solid var(--rt-pending, #ffbf52);
  background: var(--rt-surface-2, var(--paper-inset));
  padding: .55rem .8rem;
}
.review-history__entry[data-kind="correction"] { border-left-color: var(--rt-info, #8aa8ff); }
.review-history__comment { margin: 0; color: var(--rt-text-muted, var(--ink-soft)); }
.review-history__ack {
  min-height: 44px;
  padding: .45rem .85rem;
  border: 1px solid var(--rt-pending, #ffbf52);
  background: transparent;
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 750;
  cursor: pointer;
  width: fit-content;
}
.review-history__acked { color: var(--rt-success, #2e8b57); font-weight: 750; }
</style>
