<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppNavigation from '~/components/AppNavigation.vue'
import OnboardingDecisionRail from '~/components/onboarding/OnboardingDecisionRail.vue'
import OnboardingPreviewRail from '~/components/onboarding/OnboardingPreviewRail.vue'
import OnboardingTrainerDecision from '~/components/onboarding/OnboardingTrainerDecision.vue'
import OnboardingPokemonDecision from '~/components/onboarding/OnboardingPokemonDecision.vue'
import OnboardingReviewDecision from '~/components/onboarding/OnboardingReviewDecision.vue'
import { useOnboardingDraft } from '~/composables/useOnboarding'
import { onboardingCreationCatalog } from '#shared/onboarding/catalog'
import { computeOnboardingDecisionNodes, nextOnboardingDecision } from '#shared/onboarding/decisions'
import type { OnboardingDraftV1 } from '#shared/onboarding/draft'
import { parseOnboardingDecisionId, isOnboardingDecisionId } from '#shared/onboarding/ids'
import { canOwnerEditDraftContent } from '#shared/onboarding/lifecycle'
import { validateOnboardingPackage } from '#shared/onboarding/validate'
import { ONBOARDING_PATH } from '~/utils/onboardingRoutes'

useHead({ title: 'Character builder · Rotom Table' })

const route = useRoute()
const router = useRouter()
const draftId = computed(() => String(route.params.draftId ?? ''))

const { isGm, profiles, handle, loading, saving, lastError, conflict, load, save } = useOnboardingDraft()

const catalog = onboardingCreationCatalog()

/** Local working copy; server acceptance replaces it. */
const working = ref<OnboardingDraftV1 | null>(null)

watch(handle, (next) => {
  if (next) working.value = next.draft
}, { immediate: true })

const policy = computed(() => handle.value?.policy ?? null)

const editable = computed(() =>
  !isGm.value
  && handle.value !== null
  && canOwnerEditDraftContent(handle.value.state))

const validation = computed(() => {
  if (!working.value || !policy.value) return null
  return validateOnboardingPackage(
    {
      trainerBuild: working.value.trainerBuild,
      pokemonBuilds: working.value.pokemonBuilds,
      deferredDecisions: working.value.deferredDecisions,
    },
    policy.value.content,
    catalog,
    { draftCatalogFingerprint: working.value.catalogFingerprint, profileBound: true },
  )
})

const nodes = computed(() => {
  if (!working.value || !policy.value) return []
  return computeOnboardingDecisionNodes(working.value, policy.value.content, catalog, validation.value ?? undefined)
})

const currentDecisionId = ref<string | null>(null)

watch([nodes, working], () => {
  if (nodes.value.length === 0) return
  const fromRoute = typeof route.query.decision === 'string' && isOnboardingDecisionId(route.query.decision)
    ? parseOnboardingDecisionId(route.query.decision)
    : null
  if (currentDecisionId.value === null) {
    currentDecisionId.value = fromRoute ?? nextOnboardingDecision(nodes.value, working.value?.currentDecisionId ?? null)
  }
}, { immediate: true })

const currentNode = computed(() =>
  nodes.value.find(node => node.decisionId === currentDecisionId.value) ?? null)

const currentIndex = computed(() =>
  nodes.value.findIndex(node => node.decisionId === currentDecisionId.value))

const previousNode = computed(() => (currentIndex.value > 0 ? nodes.value[currentIndex.value - 1]! : null))
const nextNode = computed(() =>
  (currentIndex.value >= 0 && currentIndex.value < nodes.value.length - 1
    ? nodes.value[currentIndex.value + 1]!
    : null))

const focusDecision = (decisionId: string): void => {
  currentDecisionId.value = decisionId
  void router.replace({ query: { ...route.query, decision: decisionId } })
  const region = document.getElementById('onboarding-primary-decision')
  region?.focus()
}

/* Saving: debounce content mutations into revision-checked saves. */
let saveTimer: ReturnType<typeof setTimeout> | null = null
let editVersion = 0
const scheduleSave = (): void => {
  if (!editable.value) return
  editVersion += 1
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { void flushSave() }, 700)
}

const flushSave = async (): Promise<void> => {
  if (!working.value || !handle.value || !editable.value) return
  const versionAtSave = editVersion
  const document: OnboardingDraftV1 = {
    ...working.value,
    currentDecisionId: currentDecisionId.value && isOnboardingDecisionId(currentDecisionId.value)
      ? parseOnboardingDecisionId(currentDecisionId.value)
      : null,
  }
  await save(document)
  // Adopt the server echo only when no newer local edits arrived meanwhile.
  if (handle.value && editVersion === versionAtSave) {
    working.value = handle.value.draft
  }
}

/* Children emit scoped patches; every merge reads the LIVE working draft so
 * rapid same-tick events (input blur + select change) never stomp each other. */
const applyTrainerPatch = (patch: Partial<OnboardingDraftV1['trainerBuild']>): void => {
  if (!working.value) return
  working.value = {
    ...working.value,
    trainerBuild: { ...working.value.trainerBuild, ...patch },
  }
  scheduleSave()
}

const applyPokemonPatch = (index: number, patch: Partial<OnboardingDraftV1['pokemonBuilds'][number]>): void => {
  if (!working.value) return
  working.value = {
    ...working.value,
    pokemonBuilds: working.value.pokemonBuilds.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, ...patch } : entry),
  }
  scheduleSave()
}

const applyTeamSwap = (firstBuildId: string, secondBuildId: string): void => {
  if (!working.value) return
  const first = working.value.pokemonBuilds.find(build => build.buildId === firstBuildId)
  const second = working.value.pokemonBuilds.find(build => build.buildId === secondBuildId)
  if (!first || !second) return
  working.value = {
    ...working.value,
    pokemonBuilds: working.value.pokemonBuilds.map((build) => {
      if (build.buildId === firstBuildId) return { ...build, teamSlot: second.teamSlot }
      if (build.buildId === secondBuildId) return { ...build, teamSlot: first.teamSlot }
      return build
    }),
  }
  scheduleSave()
}

const reloadAfterConflict = async (): Promise<void> => {
  await load(draftId.value)
}

const saveStateLabel = computed(() => {
  if (conflict.value) return 'Out of date'
  if (saving.value) return 'Saving…'
  if (lastError.value) return 'Save failed'
  return 'Saved'
})

const blockingCount = computed(() => validation.value?.blockingCount ?? 0)

/* Submission (P9-052): flush pending edits so the server snapshot is exactly
 * what the player reviewed, then create the immutable submission. */
const { postJson } = useApiClient()
const submitting = ref(false)
const submitError = ref<string | null>(null)

/* Review history: change requests, corrections, acknowledgements (P9-054/P9-055). */
interface ReviewEntry {
  entryId: string
  submissionRevision: number
  kind: string
  payload: Record<string, unknown>
  createdAt: number
}
const reviewEntries = ref<ReviewEntry[]>([])
const { getJson } = useApiClient()

const loadReviewEntries = async (): Promise<void> => {
  if (!handle.value) return
  try {
    const profileQuery = !isGm.value && profiles.selectedProfileId.value
      ? `&profileId=${encodeURIComponent(profiles.selectedProfileId.value)}`
      : ''
    const result = await getJson<{ entries: ReviewEntry[] }>(
      `/api/onboarding/review/entries?draftId=${encodeURIComponent(handle.value.draft.draftId)}${profileQuery}`,
    )
    reviewEntries.value = result.entries
  } catch {
    reviewEntries.value = []
  }
}

const acknowledgeCorrection = async (correctionEntryId: string): Promise<void> => {
  if (!handle.value) return
  try {
    await postJson('/api/onboarding/draft/acknowledge', {
      draftId: handle.value.draft.draftId,
      profileId: profiles.selectedProfileId.value ?? undefined,
      correctionEntryId,
      operationId: `onbop_ack-${correctionEntryId}`,
    })
    await loadReviewEntries()
    await load(draftId.value)
  } catch (error) {
    submitError.value = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? (error instanceof Error ? error.message : 'Acknowledgement failed')
  }
}

watch(handle, () => { void loadReviewEntries() })

const submitDraft = async (): Promise<void> => {
  if (!working.value || !handle.value) return
  submitting.value = true
  submitError.value = null
  try {
    if (saveTimer) clearTimeout(saveTimer)
    await flushSave()
    if (conflict.value || lastError.value) {
      submitError.value = lastError.value ?? 'The draft could not be saved before submission.'
      return
    }
    await postJson('/api/onboarding/draft/submit', {
      draftId: handle.value.draft.draftId,
      profileId: profiles.selectedProfileId.value ?? undefined,
      expectedRevision: handle.value.revision,
      operationId: `onbop_submit-${handle.value.draft.draftId}-${handle.value.draft.submissionRevision + 1}`,
    })
    await load(draftId.value)
  } catch (error) {
    submitError.value = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? (error instanceof Error ? error.message : 'Submission failed')
  } finally {
    submitting.value = false
  }
}

const currentIssues = computed(() =>
  (validation.value?.issues ?? []).filter(issue => issue.decisionId === currentDecisionId.value))

const stateBanner = computed(() => {
  if (!handle.value) return null
  const state = handle.value.state
  if (state === 'submitted') return 'Submitted — waiting for GM review. Content is read-only until the GM responds.'
  if (state === 'changes-requested') return 'The GM requested changes. Resolve them and resubmit from Review.'
  if (state === 'approved') return 'Approved — waiting for the final commit.'
  if (state === 'completed') return 'Completed — this draft is no longer authoritative; your sheets are live.'
  if (state === 'cancelled') return 'This draft was cancelled.'
  if (state === 'superseded') return 'This draft was superseded by a newer slot.'
  return null
})

onMounted(async () => {
  if (!isGm.value) profiles.loadRememberedProfile()
  await load(draftId.value)
})
</script>

<template>
  <main class="builder rt-design-system" data-rt-design-system="1" data-rt-context="workshop">
    <AppNavigation />

    <p v-if="loading" class="builder__state" role="status">Loading draft…</p>
    <section v-else-if="lastError && !handle" class="builder__state builder__state--error" role="alert">
      <p>{{ lastError }}</p>
      <NuxtLink :to="ONBOARDING_PATH">Back to onboarding</NuxtLink>
    </section>

    <template v-else-if="handle && working && policy">
      <header class="builder__top">
        <div>
          <p class="builder__eyebrow">Campaign onboarding</p>
          <h1>
            {{ working.trainerBuild.name ?? 'New Trainer' }}
            — Level {{ policy.content.trainer.startingLevel }} start
          </h1>
        </div>
        <div class="builder__top-status">
          <span class="builder__chip">Policy v{{ working.policyVersion }}</span>
          <span class="builder__save" :data-state="conflict ? 'conflict' : saving ? 'saving' : lastError ? 'conflict' : 'saved'" role="status">
            {{ saveStateLabel }}
          </span>
          <button
            v-if="blockingCount > 0"
            type="button"
            class="builder__resolve"
            @click="focusDecision('package.review')"
          >
            {{ blockingCount }} to resolve
          </button>
        </div>
      </header>

      <p v-if="stateBanner" class="builder__banner" role="status">{{ stateBanner }}</p>
      <div v-if="conflict" class="builder__conflict" role="alert">
        <p>This draft changed somewhere else. Reload to continue from the latest version.</p>
        <button type="button" @click="reloadAfterConflict">Reload latest</button>
      </div>

      <div class="builder__layout">
        <OnboardingDecisionRail
          :nodes="nodes"
          :current-decision-id="currentDecisionId"
          @focus-decision="focusDecision"
        />

        <section
          id="onboarding-primary-decision"
          class="builder__primary"
          tabindex="-1"
          :aria-label="currentNode?.title ?? 'Decision'"
        >
          <OnboardingTrainerDecision
            v-if="currentNode && currentNode.decisionId.startsWith('trainer.')"
            :decision-id="currentNode.decisionId"
            :draft="working"
            :policy="policy.content"
            :catalog="catalog"
            :issues="currentIssues"
            :editable="editable"
            @patch-trainer="applyTrainerPatch"
          />
          <OnboardingPokemonDecision
            v-else-if="currentNode && currentNode.decisionId.startsWith('pokemon.') && currentNode.decisionId !== 'pokemon.team'"
            :decision-id="currentNode.decisionId"
            :draft="working"
            :policy="policy.content"
            :catalog="catalog"
            :issues="currentIssues"
            :editable="editable"
            @patch-pokemon="applyPokemonPatch"
          />
          <OnboardingReviewDecision
            v-else-if="currentNode"
            :decision-id="currentNode.decisionId"
            :draft="working"
            :draft-state="handle.state"
            :revision="handle.revision"
            :policy="policy"
            :catalog="catalog"
            :validation="validation"
            :editable="editable"
            :submitting="submitting"
            :submit-error="submitError"
            :review-entries="reviewEntries"
            @swap-team="applyTeamSwap"
            @focus-decision="focusDecision"
            @refresh="reloadAfterConflict"
            @submit="submitDraft"
            @acknowledge="acknowledgeCorrection"
          />

          <footer class="builder__nav">
            <button
              v-if="previousNode"
              type="button"
              class="builder__nav-back"
              @click="focusDecision(previousNode.decisionId)"
            >
              ← {{ previousNode.title }}
            </button>
            <span v-else />
            <button
              v-if="nextNode"
              type="button"
              class="builder__nav-next"
              @click="focusDecision(nextNode.decisionId)"
            >
              Next: {{ nextNode.title }} →
            </button>
          </footer>
        </section>

        <OnboardingPreviewRail
          :draft="working"
          :policy="policy.content"
          :catalog="catalog"
        />
      </div>
    </template>
  </main>
</template>

<style scoped>
.builder {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: var(--rt-space-4, 1rem);
  padding: clamp(.6rem, 1.6vw, 1.25rem);
  background: var(--rt-bg-canvas, var(--paper));
  color: var(--rt-text, var(--ink));
}
.builder__state { padding: 1rem; }
.builder__state--error { border-left: 4px solid var(--rt-danger, #ff6672); background: var(--rt-surface-1, var(--paper-soft)); padding: 1rem; }
.builder__top {
  display: flex;
  flex-wrap: wrap;
  gap: .75rem 1.25rem;
  align-items: end;
  justify-content: space-between;
}
.builder__eyebrow {
  margin: 0;
  color: var(--rt-text-muted, var(--ink-muted));
  font-size: .72rem;
  font-weight: 800;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.builder__top h1 {
  margin: .1rem 0 0;
  color: var(--rt-text-strong, var(--ink-bright));
  font: 700 1.55rem/1.1 var(--font-book);
}
.builder__top-status { display: flex; align-items: center; gap: .6rem; }
.builder__chip {
  border: 1px solid var(--rt-rule, var(--rule-soft));
  padding: .3rem .6rem;
  font-size: .78rem;
  font-weight: 750;
}
.builder__save { color: var(--rt-text-muted, var(--ink-muted)); font-size: .82rem; font-weight: 700; }
.builder__save[data-state="saving"] { color: var(--rt-pending, #b8860b); }
.builder__save[data-state="conflict"] { color: var(--rt-danger, #b03a44); }
.builder__resolve {
  min-height: 40px;
  padding: .35rem .7rem;
  border: 1px solid var(--rt-pending, #ffbf52);
  color: var(--rt-pending, #8a6d1a);
  background: transparent;
  font-weight: 800;
  cursor: pointer;
}
.builder__banner {
  margin: 0;
  padding: .65rem .9rem;
  border-left: 4px solid var(--rt-info, #8aa8ff);
  background: var(--rt-surface-1, var(--paper-soft));
}
.builder__conflict {
  display: flex;
  flex-wrap: wrap;
  gap: .6rem;
  align-items: center;
  padding: .65rem .9rem;
  border-left: 4px solid var(--rt-danger, #ff6672);
  background: var(--rt-surface-1, var(--paper-soft));
}
.builder__conflict p { margin: 0; }
.builder__conflict button {
  min-height: 40px;
  padding: .35rem .8rem;
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  font-weight: 750;
  cursor: pointer;
}
.builder__layout {
  display: grid;
  grid-template-columns: minmax(230px, 280px) minmax(0, 1fr) minmax(260px, 320px);
  gap: var(--rt-space-4, 1rem);
  align-items: start;
}
.builder__primary {
  display: grid;
  gap: var(--rt-space-3, .75rem);
  outline: none;
}
.builder__nav {
  display: flex;
  justify-content: space-between;
  gap: .75rem;
}
.builder__nav-back,
.builder__nav-next {
  min-height: 46px;
  padding: .6rem 1rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  color: var(--rt-text, var(--ink));
  font-weight: 750;
  cursor: pointer;
}
.builder__nav-next {
  border-color: var(--rt-focus, #59d8ff);
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 800;
}
.builder :is(button, a, input, select, textarea, summary):focus-visible {
  outline: 3px solid var(--rt-focus, #59d8ff);
  outline-offset: 2px;
}
@media (max-width: 1100px) {
  .builder__layout { grid-template-columns: minmax(0, 1fr); }
}
</style>
