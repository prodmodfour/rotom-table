<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PhArrowLeft, PhUserSwitch } from '@phosphor-icons/vue'
import AppNavigation from '~/components/AppNavigation.vue'
import type { OnboardingIntakePreview } from '~~/server/useCases/onboardingIntake'
import { ONBOARDING_PATH } from '~/utils/onboardingRoutes'
import { DEFAULT_LOGIN_REDIRECT } from '~/utils/loginRedirect'

useHead({ title: 'Character intake · Rotom Table' })

definePageMeta({
  middleware: () => {
    const { isPlayer } = useAuth()
    if (isPlayer.value) return navigateTo(DEFAULT_LOGIN_REDIRECT)
  },
})

const { getJson, postJson } = useApiClient()

const trainers = ref<{ slug: string, name: string, level?: number }[]>([])
const profiles = ref<{ id: string, displayName: string }[]>([])
const selectedTrainer = ref('')
const selectedProfile = ref('')
const preview = ref<OnboardingIntakePreview | null>(null)
const acceptedRepairs = ref<string[]>([])
const resolveConflicts = ref(false)
const loading = ref(false)
const busy = ref(false)
const lastError = ref<string | null>(null)
const committed = ref<{ trainerSlug: string, pokemonSlugs: string[] } | null>(null)

const load = async (): Promise<void> => {
  loading.value = true
  try {
    const sheets = await getJson<{ trainerSheets: { slug: string, name?: string, level?: number }[] }>('/api/sheets/list')
    trainers.value = sheets.trainerSheets.map(sheet => ({
      slug: sheet.slug,
      name: sheet.name ?? sheet.slug,
      level: sheet.level,
    }))
    const profileList = await getJson<{ profiles: { id: string, displayName: string }[] }>('/api/player-profiles/list')
    profiles.value = profileList.profiles
  } catch (error) {
    lastError.value = error instanceof Error ? error.message : 'Failed to load'
  } finally {
    loading.value = false
  }
}

const runPreview = async (): Promise<void> => {
  if (!selectedTrainer.value || !selectedProfile.value) return
  busy.value = true
  lastError.value = null
  preview.value = null
  committed.value = null
  try {
    preview.value = await getJson<OnboardingIntakePreview>(
      `/api/onboarding/intake/preview?trainerSlug=${encodeURIComponent(selectedTrainer.value)}&profileId=${encodeURIComponent(selectedProfile.value)}`,
    )
    acceptedRepairs.value = preview.value.proposedRepairs.map(repair => repair.repairId)
    resolveConflicts.value = false
  } catch (error) {
    lastError.value = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? (error instanceof Error ? error.message : 'Preview failed')
  } finally {
    busy.value = false
  }
}

const commit = async (): Promise<void> => {
  if (!preview.value) return
  busy.value = true
  lastError.value = null
  try {
    committed.value = await postJson<{ trainerSlug: string, pokemonSlugs: string[] }>('/api/onboarding/intake/commit', {
      trainerSlug: preview.value.trainerSlug,
      profileId: selectedProfile.value,
      acceptedRepairIds: acceptedRepairs.value,
      resolveOwnershipConflicts: resolveConflicts.value,
      operationId: `onbop_intake-${preview.value.trainerSlug}-${Date.now().toString(36)}`,
    })
    preview.value = null
  } catch (error) {
    lastError.value = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? (error instanceof Error ? error.message : 'Intake failed')
  } finally {
    busy.value = false
  }
}

const canCommit = computed(() =>
  preview.value !== null
  && preview.value.canCommit
  && (preview.value.ownershipConflicts.length === 0 || resolveConflicts.value)
  && !busy.value)

const findingTone = (kind: string): string =>
  kind === 'blocking-structural' ? 'blocking' : kind === 'ownership-conflict' ? 'conflict' : kind === 'informational' ? 'info' : 'legacy'

onMounted(() => { void load() })
</script>

<template>
  <main class="intake-page rt-design-system" data-rt-design-system="1" data-rt-context="workshop">
    <AppNavigation />

    <header class="intake-page__hero">
      <NuxtLink class="intake-page__back" :to="ONBOARDING_PATH">
        <PhArrowLeft :size="16" weight="bold" aria-hidden="true" />
        Onboarding
      </NuxtLink>
      <h1><PhUserSwitch :size="26" weight="duotone" aria-hidden="true" /> Existing-character intake</h1>
      <p>
        Adopt an existing Trainer and their team into campaign onboarding: validate references,
        apply bounded structural repairs, and link the owning player — without rewriting history.
      </p>
    </header>

    <p v-if="loading" class="intake-page__state" role="status">Loading…</p>
    <p v-if="lastError" class="intake-page__state intake-page__state--error" role="alert">{{ lastError }}</p>

    <section v-if="committed" class="intake-card intake-card--success" aria-live="polite">
      <h2>Intake complete</h2>
      <p>
        <NuxtLink :to="`/sheets/trainers/${committed.trainerSlug}`">{{ committed.trainerSlug }}</NuxtLink>
        and {{ committed.pokemonSlugs.length }} Pokémon are linked and ready for play.
      </p>
    </section>

    <section class="intake-card">
      <h2>1. Choose the character and owner</h2>
      <div class="intake-form">
        <label class="intake-field">
          <span>Existing Trainer</span>
          <select v-model="selectedTrainer" :disabled="busy">
            <option value="">Choose a trainer…</option>
            <option v-for="trainer in trainers" :key="trainer.slug" :value="trainer.slug">
              {{ trainer.name }} (Lv {{ trainer.level ?? '?' }})
            </option>
          </select>
        </label>
        <label class="intake-field">
          <span>Owning player profile</span>
          <select v-model="selectedProfile" :disabled="busy">
            <option value="">Choose a profile…</option>
            <option v-for="profile in profiles" :key="profile.id" :value="profile.id">
              {{ profile.displayName }}
            </option>
          </select>
        </label>
        <button type="button" class="intake-action" :disabled="busy || !selectedTrainer || !selectedProfile" @click="runPreview">
          Preview intake
        </button>
      </div>
    </section>

    <template v-if="preview">
      <section class="intake-card">
        <h2>2. Review {{ preview.trainerName }} (Lv {{ preview.trainerLevel }})</h2>
        <ul class="intake-team">
          <li v-for="pokemon in preview.pokemon" :key="pokemon.slug">
            <strong>{{ pokemon.nickname }}</strong>
            · {{ pokemon.species || 'no species' }} Lv {{ pokemon.level }}
            · {{ pokemon.rosterKind }}
            <span v-if="pokemon.linkedToOtherProfile" class="intake-conflict-tag">linked to {{ pokemon.linkedToOtherProfile }}</span>
          </li>
        </ul>

        <h3 v-if="preview.findings.length > 0">Findings</h3>
        <ul class="intake-findings">
          <li v-for="finding in preview.findings" :key="finding.findingId" :data-tone="findingTone(finding.kind)">
            {{ finding.message }}
          </li>
        </ul>

        <template v-if="preview.proposedRepairs.length > 0">
          <h3>Bounded repairs</h3>
          <label v-for="repair in preview.proposedRepairs" :key="repair.repairId" class="intake-repair">
            <input v-model="acceptedRepairs" type="checkbox" :value="repair.repairId">
            <span>{{ repair.description }}</span>
          </label>
        </template>

        <label v-if="preview.ownershipConflicts.length > 0" class="intake-repair intake-repair--conflict">
          <input v-model="resolveConflicts" type="checkbox">
          <span>
            Move the {{ preview.ownershipConflicts.length }} conflicting link(s) to the selected profile.
            The previous owner loses control of those sheets.
          </span>
        </label>

        <button type="button" class="intake-action intake-action--commit" :disabled="!canCommit" @click="commit">
          {{ busy ? 'Working…' : 'Adopt character package' }}
        </button>
        <p v-if="!preview.canCommit" class="intake-page__state intake-page__state--error" role="alert">
          Intake is blocked by structural findings that have no safe automatic repair.
          Fix the sheet through its ordinary editor first.
        </p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.intake-page {
  min-height: 100vh;
  display: grid;
  align-content: start;
  gap: var(--rt-space-4, 1rem);
  padding: clamp(.75rem, 2vw, 1.5rem);
  background: var(--rt-bg-canvas, var(--paper));
  color: var(--rt-text, var(--ink));
}
.intake-page__back {
  display: inline-flex;
  align-items: center;
  gap: .35rem;
  min-height: 44px;
  color: var(--rt-text-muted, var(--ink-soft));
  font-size: .8rem;
  font-weight: 750;
  text-decoration: none;
}
.intake-page__hero h1 {
  margin: 0 0 .3rem;
  display: flex;
  align-items: center;
  gap: .5rem;
  color: var(--rt-text-strong, var(--ink-bright));
  font: 700 1.8rem/1.1 var(--font-book);
}
.intake-page__hero p { margin: 0; color: var(--rt-text-muted, var(--ink-soft)); max-width: 68ch; }
.intake-page__state { margin: 0; padding: .75rem 1rem; background: var(--rt-surface-1, var(--paper-soft)); }
.intake-page__state--error { border-left: 4px solid var(--rt-danger, #ff6672); }
.intake-card {
  display: grid;
  gap: .7rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  padding: var(--rt-space-4, 1rem);
}
.intake-card h2 { margin: 0; font: 700 1.25rem/1.15 var(--font-book); color: var(--rt-text-strong, var(--ink-bright)); }
.intake-card h3 { margin: .3rem 0 0; font: 700 1rem/1.1 var(--font-book); }
.intake-card--success { border-left: 4px solid var(--rt-success, #58d5a0); }
.intake-form { display: flex; flex-wrap: wrap; gap: .75rem; align-items: end; }
.intake-field { display: grid; gap: .3rem; min-width: min(20rem, 100%); }
.intake-field span { font-size: .78rem; font-weight: 750; color: var(--rt-text-muted, var(--ink-soft)); }
.intake-field select {
  min-height: 44px;
  padding: .45rem .6rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text, var(--ink));
  font: inherit;
}
.intake-action {
  min-height: 44px;
  padding: .55rem 1rem;
  border: 1px solid var(--rt-focus, var(--info));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 800;
  cursor: pointer;
  width: fit-content;
}
.intake-action--commit { border-color: var(--rt-brand, #ff3347); min-height: 48px; }
.intake-action:disabled { opacity: .5; cursor: not-allowed; }
.intake-team { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
.intake-conflict-tag {
  margin-left: .4rem;
  color: var(--rt-pending, #8a6d1a);
  font-weight: 750;
  font-size: .8rem;
}
.intake-findings { list-style: none; margin: 0; padding: 0; display: grid; gap: .3rem; }
.intake-findings li {
  border-left: 4px solid var(--rt-info, #8aa8ff);
  background: var(--rt-surface-2, var(--paper-inset));
  padding: .45rem .7rem;
}
.intake-findings li[data-tone="blocking"] { border-left-color: var(--rt-danger, #ff6672); }
.intake-findings li[data-tone="conflict"],
.intake-findings li[data-tone="legacy"] { border-left-color: var(--rt-pending, #ffbf52); }
.intake-repair {
  display: flex;
  gap: .55rem;
  align-items: flex-start;
  min-height: 44px;
  padding: .35rem 0;
}
.intake-repair input { inline-size: 18px; block-size: 18px; margin-top: .2rem; }
.intake-repair--conflict {
  border-left: 4px solid var(--rt-pending, #ffbf52);
  padding-left: .7rem;
}
.intake-page :is(a, button, select, input):focus-visible {
  outline: 3px solid var(--rt-focus, #59d8ff);
  outline-offset: 2px;
}
</style>
