<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { OnboardedPartyCandidate } from '~~/server/useCases/onboardingEncounterJoin'
import { ONBOARDING_PATH } from '~/utils/onboardingRoutes'

/**
 * Grouped completed-package candidates for encounter authoring (P9-075).
 * Only committed onboarding packages appear; drafts have no sheets and can
 * never be listed as playable participants.
 */
const { getJson } = useApiClient()
const candidates = ref<OnboardedPartyCandidate[]>([])

onMounted(async () => {
  try {
    const result = await getJson<{ candidates: OnboardedPartyCandidate[] }>('/api/onboarding/encounter/eligibility')
    candidates.value = result.candidates
  } catch {
    candidates.value = []
  }
})
</script>

<template>
  <section v-if="candidates.length > 0" class="party-candidates" aria-labelledby="party-candidates-title">
    <header>
      <h2 id="party-candidates-title">Onboarded parties</h2>
      <p>Completed player packages ready to face this encounter. Place them from the onboarding queue after staging.</p>
    </header>
    <ul>
      <li v-for="candidate in candidates" :key="candidate.trainerSlug">
        <strong>{{ candidate.trainerName }}</strong>
        <span class="party-candidates__meta">
          + {{ candidate.pokemonSlugs.length }} Pokémon ·
          {{ candidate.kind === 'intake' ? 'adopted' : 'new player' }}
        </span>
        <span class="party-candidates__ready" :data-ready="candidate.ready ? '1' : undefined">
          {{ candidate.ready ? 'Ready' : 'Needs repair' }}
        </span>
      </li>
    </ul>
    <NuxtLink class="party-candidates__link" :to="ONBOARDING_PATH">Open onboarding queue</NuxtLink>
  </section>
</template>

<style scoped>
.party-candidates {
  display: grid;
  gap: .55rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  border-left: 4px solid var(--rt-focus, #59d8ff);
  background: var(--rt-surface-1, var(--paper-soft));
  padding: 1rem;
  margin-block-end: 1rem;
}
.party-candidates header h2 { margin: 0; font: 700 1.15rem/1.1 var(--font-book); color: var(--rt-text-strong, var(--ink-bright)); }
.party-candidates header p { margin: .2rem 0 0; color: var(--rt-text-muted, var(--ink-soft)); font-size: .85rem; }
.party-candidates ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .35rem; }
.party-candidates li { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; }
.party-candidates__meta { color: var(--rt-text-muted, var(--ink-muted)); font-size: .82rem; }
.party-candidates__ready { font-size: .75rem; font-weight: 800; color: var(--rt-pending, #8a6d1a); }
.party-candidates__ready[data-ready="1"] { color: var(--rt-success, #2e8b57); }
.party-candidates__link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-weight: 750;
  color: var(--rt-text-strong, var(--ink-bright));
  width: fit-content;
}
.party-candidates__link:focus-visible { outline: 3px solid var(--rt-focus, #59d8ff); outline-offset: 2px; }
</style>
