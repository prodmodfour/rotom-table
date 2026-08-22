<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { PhArrowLeft, PhCheckCircle, PhPencilLine } from '@phosphor-icons/vue'
import AppNavigation from '~/components/AppNavigation.vue'
import OnboardingIssueList from '~/components/onboarding/OnboardingIssueList.vue'
import type { OnboardingReviewView } from '~~/server/useCases/onboardingApproval'
import { onboardingCreationCatalog } from '#shared/onboarding/catalog'
import { computeOnboardingPokemonPreview, computeOnboardingTrainerPreview } from '#shared/onboarding/preview'
import { ONBOARDING_PATH } from '~/utils/onboardingRoutes'
import { DEFAULT_LOGIN_REDIRECT } from '~/utils/loginRedirect'

useHead({ title: 'Onboarding review · Rotom Table' })

definePageMeta({
  middleware: () => {
    const { isPlayer } = useAuth()
    if (isPlayer.value) return navigateTo(DEFAULT_LOGIN_REDIRECT)
  },
})

const route = useRoute()
const draftId = computed(() => String(route.params.draftId ?? ''))
const { getJson, postJson } = useApiClient()

const view = ref<OnboardingReviewView | null>(null)
const loading = ref(false)
const lastError = ref<string | null>(null)
const actionError = ref<string | null>(null)
const busy = ref(false)
const confirmDeviations = ref(false)
const changeComment = ref('')
const selectedReasons = ref<string[]>([])
const gmOnlyNote = ref('')
const completed = ref<{ trainerSlug: string, pokemonSlugs: string[] } | null>(null)

const catalog = onboardingCreationCatalog()

const REASON_OPTIONS = [
  { id: 'identity', label: 'Identity / name' },
  { id: 'stat-allocation', label: 'Stat allocation' },
  { id: 'background', label: 'Background & skills' },
  { id: 'edges', label: 'Edges' },
  { id: 'features', label: 'Features & classes' },
  { id: 'starter-species', label: 'Starter species' },
  { id: 'starter-build', label: 'Starter build' },
  { id: 'flavor', label: 'Flavor / tone' },
  { id: 'other', label: 'Other (see comment)' },
]

const snapshot = computed(() => view.value?.submission.snapshot ?? null)

const trainerPreview = computed(() => {
  if (!snapshot.value || !view.value) return null
  const level = trainerLevel.value
  return level === null ? null : computeOnboardingTrainerPreview(snapshot.value.trainerBuild, level, catalog)
})

/* The policy level comes from the plan's policy binding; load via overview policy. */
const trainerLevel = ref<number | null>(null)
const starterLevel = ref<number | null>(null)

const load = async (): Promise<void> => {
  loading.value = true
  lastError.value = null
  try {
    view.value = await getJson<OnboardingReviewView>(`/api/onboarding/review/load?draftId=${encodeURIComponent(draftId.value)}`)
    const draft = await getJson<{ policy: { content: { trainer: { startingLevel: number }, pokemon: { starterLevel: number } } } | null }>(
      `/api/onboarding/draft/load?draftId=${encodeURIComponent(draftId.value)}`,
    )
    trainerLevel.value = draft.policy?.content.trainer.startingLevel ?? null
    starterLevel.value = draft.policy?.content.pokemon.starterLevel ?? null
  } catch (error) {
    lastError.value = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? (error instanceof Error ? error.message : 'Failed to load review')
  } finally {
    loading.value = false
  }
}

const starterRows = computed(() => {
  if (!snapshot.value || starterLevel.value === null) return []
  return snapshot.value.pokemonBuilds.map(build => ({
    build,
    preview: computeOnboardingPokemonPreview(build, starterLevel.value!, catalog),
  }))
})

/* Bounded corrections (P9-055). */
const correctionScope = ref<'trainer-name' | 'trainer-identity-text' | 'pokemon-nickname'>('trainer-name')
const correctionBuildIndex = ref(0)
const correctionValue = ref('')
const correctionRationale = ref('')
const correctionRequiresAck = ref(true)

const applyCorrection = async (): Promise<void> => {
  if (!view.value) return
  busy.value = true
  actionError.value = null
  try {
    await postJson('/api/onboarding/review/correct', {
      draftId: draftId.value,
      submissionRevision: view.value.submission.submissionRevision,
      scope: correctionScope.value,
      buildIndex: correctionScope.value === 'pokemon-nickname' ? correctionBuildIndex.value : undefined,
      value: correctionValue.value.trim() === '' ? null : correctionValue.value.trim(),
      rationale: correctionRationale.value,
      requiresAcknowledgement: correctionRequiresAck.value,
      operationId: `onbop_correct-${draftId.value}-${view.value.submission.submissionRevision}-${Date.now().toString(36)}`,
    })
    correctionValue.value = ''
    correctionRationale.value = ''
    await load()
  } catch (error) {
    actionError.value = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? (error instanceof Error ? error.message : 'Correction failed')
  } finally {
    busy.value = false
  }
}

const pendingAcknowledgements = computed(() => {
  const entries = view.value?.reviewEntries ?? []
  const acknowledged = new Set(entries
    .filter(entry => entry.kind === 'acknowledgement')
    .map(entry => String(entry.payload.correctionEntryId ?? '')))
  return entries.filter(entry =>
    entry.kind === 'correction'
    && entry.payload.requiresAcknowledgement === true
    && !acknowledged.has(entry.entryId))
})

const requestChanges = async (): Promise<void> => {
  if (!view.value || selectedReasons.value.length === 0) return
  busy.value = true
  actionError.value = null
  try {
    await postJson('/api/onboarding/review/request-changes', {
      draftId: draftId.value,
      submissionRevision: view.value.submission.submissionRevision,
      reasons: selectedReasons.value,
      comment: changeComment.value || undefined,
      gmOnlyNote: gmOnlyNote.value || undefined,
      operationId: `onbop_changes-${draftId.value}-${view.value.submission.submissionRevision}-${Date.now().toString(36)}`,
    })
    await navigateTo(ONBOARDING_PATH)
  } catch (error) {
    actionError.value = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? (error instanceof Error ? error.message : 'Request failed')
  } finally {
    busy.value = false
  }
}

const approve = async (): Promise<void> => {
  if (!view.value) return
  busy.value = true
  actionError.value = null
  try {
    const result = await postJson<{ trainerSlug: string, pokemonSlugs: string[] }>('/api/onboarding/review/approve', {
      draftId: draftId.value,
      submissionRevision: view.value.submission.submissionRevision,
      confirmDeviations: confirmDeviations.value,
      operationId: `onbop_approve-${draftId.value}-${view.value.submission.submissionRevision}`,
    })
    completed.value = result
  } catch (error) {
    actionError.value = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? (error instanceof Error ? error.message : 'Approval failed')
  } finally {
    busy.value = false
  }
}

const canApprove = computed(() =>
  view.value !== null
  && view.value.validation.submittable
  && (view.value.deviationsRequiringConfirmation.length === 0 || confirmDeviations.value)
  && pendingAcknowledgements.value.length === 0
  && !busy.value)

onMounted(() => { void load() })
</script>

<template>
  <main class="review-page rt-design-system" data-rt-design-system="1" data-rt-context="workshop">
    <AppNavigation />

    <header class="review-page__hero">
      <NuxtLink class="review-page__back" :to="ONBOARDING_PATH">
        <PhArrowLeft :size="16" weight="bold" aria-hidden="true" />
        Onboarding queue
      </NuxtLink>
      <h1>Review submission</h1>
    </header>

    <p v-if="loading" class="review-page__state" role="status">Loading submission…</p>
    <section v-else-if="lastError" class="review-page__state review-page__state--error" role="alert">
      <p>{{ lastError }}</p>
      <button type="button" @click="load()">Try again</button>
    </section>

    <section v-else-if="completed" class="review-card review-card--success" aria-live="polite">
      <h2><PhCheckCircle :size="22" weight="fill" aria-hidden="true" /> Package created</h2>
      <p>The character package is committed, linked, and ready for play.</p>
      <ul>
        <li><NuxtLink :to="`/sheets/trainers/${completed.trainerSlug}`">Trainer sheet</NuxtLink></li>
        <li v-for="slug in completed.pokemonSlugs" :key="slug">
          <NuxtLink :to="`/sheets/${slug}`">Pokémon sheet: {{ slug }}</NuxtLink>
        </li>
      </ul>
    </section>

    <template v-else-if="view && snapshot">
      <section class="review-card">
        <h2>
          {{ snapshot.trainerBuild.name ?? 'Unnamed Trainer' }}
          — submission #{{ view.submission.submissionRevision }}
        </h2>
        <p class="review-card__meta">
          Policy v{{ snapshot.policyVersion }} ·
          submitted {{ new Date(view.submission.createdAt).toLocaleString() }} ·
          snapshot is immutable; later edits create a new submission
        </p>

        <dl v-if="trainerPreview" class="review-facts">
          <div><dt>Level</dt><dd>{{ trainerLevel }}</dd></div>
          <div><dt>Max HP</dt><dd>{{ trainerPreview.maxHp.value }}</dd></div>
          <div><dt>AP</dt><dd>{{ trainerPreview.apMax.value }}</dd></div>
          <div><dt>Stat points</dt><dd>{{ trainerPreview.statPoints.spent }}/{{ trainerPreview.statPoints.budget }}</dd></div>
          <div><dt>Background</dt><dd>{{ snapshot.trainerBuild.background?.name ?? '—' }}</dd></div>
          <div><dt>Training</dt><dd>{{ snapshot.trainerBuild.trainingFeatureId ?? '—' }}</dd></div>
          <div><dt>Edges</dt><dd>{{ snapshot.trainerBuild.edges.map(edge => edge.canonicalId + (edge.choices.skill ? ` (${edge.choices.skill})` : '')).join(', ') }}</dd></div>
          <div><dt>Features</dt><dd>{{ snapshot.trainerBuild.features.map(feature => feature.canonicalId).join(', ') }}</dd></div>
        </dl>
      </section>

      <section v-for="row in starterRows" :key="row.build.buildId" class="review-card">
        <h2>
          {{ row.build.nickname ? `${row.build.nickname} · ` : '' }}{{ row.build.speciesId }}
          — Lv {{ starterLevel }}
        </h2>
        <dl class="review-facts">
          <div><dt>Max HP</dt><dd>{{ row.preview?.maxHp.value ?? '—' }}</dd></div>
          <div><dt>Nature</dt><dd>{{ row.build.natureId }}</dd></div>
          <div><dt>Gender</dt><dd>{{ row.build.gender ?? 'Genderless' }}</dd></div>
          <div><dt>Ability</dt><dd>{{ row.build.abilityIds.join(', ') }}</dd></div>
          <div><dt>Moves</dt><dd>{{ row.build.moveIds.join(', ') }}</dd></div>
          <div><dt>Added points</dt><dd>{{ row.preview?.addedPoints.spent }}/{{ row.preview?.addedPoints.budget }}</dd></div>
        </dl>
      </section>

      <section class="review-card">
        <h2>Validation</h2>
        <p v-if="view.validation.issues.length === 0" class="review-card__meta">
          No issues. Everything re-authorized against current canonical data and policy.
        </p>
        <OnboardingIssueList v-else :issues="view.validation.issues" />
        <label v-if="view.deviationsRequiringConfirmation.length > 0" class="review-confirm">
          <input v-model="confirmDeviations" type="checkbox">
          <span>
            I confirm the {{ view.deviationsRequiringConfirmation.length }} reviewed prerequisite deviation(s) above are acceptable at this table.
          </span>
        </label>
      </section>

      <section class="review-card">
        <h2>What approval writes</h2>
        <ul class="review-plan">
          <li v-for="sheet in view.planPreview.writeSet.sheets" :key="`${sheet.kind}:${sheet.slug}`">
            Create {{ sheet.kind }} sheet <strong>{{ sheet.displayName }}</strong> at <code>{{ sheet.folder }}/{{ sheet.slug }}</code>
          </li>
          <li>Link {{ view.planPreview.writeSet.profileLinks.length }} sheet(s) to the player profile</li>
          <li>Team order: {{ view.planPreview.writeSet.team.currentTeam.join(' → ') }}</li>
          <li>Starting money: {{ view.planPreview.writeSet.startingMoney }}</li>
          <li v-for="row in view.planPreview.writeSet.inventoryRows" :key="`${row.itemId}-${row.section}`">
            Add {{ row.itemId }} ×{{ row.quantity }} to {{ row.section }}
          </li>
          <li>Record onboarding provenance and notify both audiences</li>
        </ul>
        <p class="review-card__meta">
          Approval re-checks the draft revision, policy version, canonical data, and slug availability inside one transaction.
          It either creates everything above or nothing.
        </p>
      </section>

      <section class="review-card">
        <h2>Bounded correction</h2>
        <p class="review-card__meta">
          Corrections are receipt-backed, always visible to the player, and re-run the same validators.
          Anything beyond presentation belongs in a change request.
        </p>
        <div class="review-correct">
          <label class="review-correct__field">
            <span>Scope</span>
            <select v-model="correctionScope">
              <option value="trainer-name">Rename Trainer</option>
              <option value="trainer-identity-text">Revise concept text</option>
              <option value="pokemon-nickname">Rename starter</option>
            </select>
          </label>
          <label v-if="correctionScope === 'pokemon-nickname'" class="review-correct__field">
            <span>Starter</span>
            <select v-model.number="correctionBuildIndex">
              <option v-for="(row, index) in starterRows" :key="row.build.buildId" :value="index">
                {{ row.build.nickname ?? row.build.speciesId }}
              </option>
            </select>
          </label>
          <label class="review-correct__field review-correct__field--grow">
            <span>New value</span>
            <input v-model="correctionValue" type="text" maxlength="80">
          </label>
          <label class="review-correct__field review-correct__field--grow">
            <span>Rationale (shown to the player)</span>
            <input v-model="correctionRationale" type="text" maxlength="2000">
          </label>
          <label class="review-correct__check">
            <input v-model="correctionRequiresAck" type="checkbox">
            <span>Require player acknowledgement before approval</span>
          </label>
          <button
            type="button"
            class="review-changes__submit"
            :disabled="busy || correctionRationale.trim() === '' || (correctionScope === 'trainer-name' && correctionValue.trim() === '')"
            @click="applyCorrection"
          >
            Apply correction
          </button>
        </div>
        <p v-if="pendingAcknowledgements.length > 0" class="review-card__impact" role="status">
          {{ pendingAcknowledgements.length }} correction(s) await the player's acknowledgement; approval stays blocked until then.
        </p>
      </section>

      <p v-if="actionError" class="review-page__state review-page__state--error" role="alert">{{ actionError }}</p>

      <div class="review-actions">
        <details class="review-changes">
          <summary><PhPencilLine :size="16" weight="bold" aria-hidden="true" /> Request changes</summary>
          <fieldset class="review-changes__reasons">
            <legend>Reasons</legend>
            <label v-for="reason in REASON_OPTIONS" :key="reason.id" class="review-changes__reason">
              <input v-model="selectedReasons" type="checkbox" :value="reason.id">
              <span>{{ reason.label }}</span>
            </label>
          </fieldset>
          <label class="review-changes__field">
            <span>Comment to the player (optional)</span>
            <textarea v-model="changeComment" rows="3" maxlength="2000" />
          </label>
          <label class="review-changes__field">
            <span>GM-only note (never shown to the player)</span>
            <textarea v-model="gmOnlyNote" rows="2" maxlength="2000" />
          </label>
          <button type="button" class="review-changes__submit" :disabled="busy || selectedReasons.length === 0" @click="requestChanges">
            Send change request
          </button>
        </details>

        <button type="button" class="review-approve" :disabled="!canApprove" @click="approve">
          {{ busy ? 'Working…' : 'Approve & create package' }}
        </button>
      </div>
    </template>
  </main>
</template>

<style scoped>
.review-page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: var(--rt-space-4, 1rem);
  padding: clamp(.75rem, 2vw, 1.5rem);
  background: var(--rt-bg-canvas, var(--paper));
  color: var(--rt-text, var(--ink));
}
.review-page__back {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  min-height: 44px;
  color: var(--rt-text-muted, var(--ink-soft));
  font-size: .8rem;
  font-weight: 750;
  text-decoration: none;
}
.review-page__hero h1 {
  margin: 0;
  color: var(--rt-text-strong, var(--ink-bright));
  font: 700 1.8rem/1.1 var(--font-book);
}
.review-page__state { padding: 1rem; background: var(--rt-surface-1, var(--paper-soft)); }
.review-page__state--error { border-left: 4px solid var(--rt-danger, #ff6672); }
.review-page__state--error button { margin-top: .5rem; min-height: 44px; padding: .5rem .9rem; cursor: pointer; }
.review-card {
  display: grid;
  gap: .6rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  padding: var(--rt-space-4, 1rem);
}
.review-card h2 {
  margin: 0;
  display: flex;
  align-items: center;
  gap: .5rem;
  font: 700 1.25rem/1.15 var(--font-book);
  color: var(--rt-text-strong, var(--ink-bright));
}
.review-card--success { border-left: 4px solid var(--rt-success, #58d5a0); }
.review-card--success ul { margin: 0; padding-left: 1.2rem; }
.review-card__meta { margin: 0; color: var(--rt-text-muted, var(--ink-soft)); font-size: .85rem; }
.review-facts {
  margin: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: .35rem .9rem;
}
.review-facts > div { display: flex; gap: .5rem; align-items: baseline; }
.review-facts dt {
  flex: none;
  min-inline-size: 6.5rem;
  color: var(--rt-text-muted, var(--ink-muted));
  font-size: .75rem;
  font-weight: 750;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.review-facts dd { margin: 0; font-weight: 650; }
.review-plan { margin: 0; padding-left: 1.2rem; display: grid; gap: .25rem; }
.review-confirm {
  display: flex;
  gap: .6rem;
  align-items: flex-start;
  border-left: 4px solid var(--rt-pending, #ffbf52);
  background: var(--rt-surface-2, var(--paper-inset));
  padding: .6rem .8rem;
}
.review-confirm input { inline-size: 20px; block-size: 20px; margin-top: .15rem; }
.review-actions {
  display: grid;
  gap: 1rem;
}
.review-changes {
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  padding: .6rem .8rem;
}
.review-changes summary {
  display: flex;
  align-items: center;
  gap: .45rem;
  min-height: 44px;
  cursor: pointer;
  font-weight: 750;
}
.review-changes__reasons {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: .35rem;
  border: none;
  margin: .5rem 0 0;
  padding: 0;
}
.review-changes__reasons legend {
  font-size: .78rem;
  font-weight: 750;
  color: var(--rt-text-muted, var(--ink-soft));
  padding: 0 0 .25rem;
}
.review-changes__reason {
  display: flex;
  gap: .5rem;
  align-items: center;
  min-height: 40px;
}
.review-changes__reason input { inline-size: 18px; block-size: 18px; }
.review-changes__field { display: grid; gap: .3rem; margin-top: .6rem; }
.review-changes__field span { font-size: .78rem; font-weight: 750; color: var(--rt-text-muted, var(--ink-soft)); }
.review-changes__field textarea {
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text, var(--ink));
  font: inherit;
  padding: .45rem .6rem;
  resize: vertical;
}
.review-changes__submit {
  margin-top: .6rem;
  min-height: 44px;
  padding: .5rem .9rem;
  border: 1px solid var(--rt-pending, #ffbf52);
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 750;
  cursor: pointer;
}
.review-changes__submit:disabled { opacity: .5; cursor: not-allowed; }
.review-correct { display: flex; flex-wrap: wrap; gap: .7rem; align-items: end; }
.review-correct__field { display: grid; gap: .3rem; min-width: 11rem; }
.review-correct__field--grow { flex: 1 1 16rem; }
.review-correct__field span { font-size: .78rem; font-weight: 750; color: var(--rt-text-muted, var(--ink-soft)); }
.review-correct__field input,
.review-correct__field select {
  min-height: 44px;
  padding: .45rem .6rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text, var(--ink));
  font: inherit;
}
.review-correct__check { display: flex; gap: .5rem; align-items: center; min-height: 44px; }
.review-correct__check input { inline-size: 18px; block-size: 18px; }
.review-approve {
  min-height: 50px;
  padding: .75rem 1.3rem;
  border: 1px solid var(--rt-brand, #ff3347);
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 800;
  font-size: 1.02rem;
  cursor: pointer;
  width: fit-content;
}
.review-approve:disabled { opacity: .5; cursor: not-allowed; }
.review-page :is(a, button, summary, input, textarea):focus-visible {
  outline: 3px solid var(--rt-focus, #59d8ff);
  outline-offset: 2px;
}
</style>
