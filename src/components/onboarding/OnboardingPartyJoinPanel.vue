<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { PhSword } from '@phosphor-icons/vue'
import type {
  EncounterJoinEligibility,
  OnboardedPartyCandidate,
} from '~~/server/useCases/onboardingEncounterJoin'

/**
 * Explicit GM workflow that places a completed onboarding party onto an
 * eligible staging encounter map (P9-074/P9-075). Only completed,
 * profile-linked packages appear; drafts structurally cannot.
 */
const { getJson, postJson } = useApiClient()

const candidates = ref<OnboardedPartyCandidate[]>([])
const maps = ref<{ slug: string, name: string }[]>([])
const selectedTrainer = ref('')
const selectedMap = ref('')
const selectedSide = ref('')
const eligibility = ref<EncounterJoinEligibility | null>(null)
const busy = ref(false)
const lastError = ref<string | null>(null)
const joined = ref<{ mapSlug: string, placementIds: string[] } | null>(null)

const load = async (): Promise<void> => {
  try {
    const result = await getJson<{ candidates: OnboardedPartyCandidate[] }>('/api/onboarding/encounter/eligibility')
    candidates.value = result.candidates
    const mapList = await getJson<{ maps: { slug: string, name?: string }[] }>('/api/maps/list')
    maps.value = mapList.maps.map(map => ({ slug: map.slug, name: map.name ?? map.slug }))
  } catch {
    candidates.value = []
  }
}

watch(selectedMap, async (mapSlug) => {
  eligibility.value = null
  selectedSide.value = ''
  if (!mapSlug) return
  try {
    const result = await getJson<{ eligibility: EncounterJoinEligibility | null }>(
      `/api/onboarding/encounter/eligibility?mapSlug=${encodeURIComponent(mapSlug)}`,
    )
    eligibility.value = result.eligibility
    if (result.eligibility?.sides.length === 1) selectedSide.value = result.eligibility.sides[0]!.id
  } catch (error) {
    lastError.value = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? 'Could not check the map'
  }
})

const join = async (): Promise<void> => {
  if (!selectedTrainer.value || !selectedMap.value || !selectedSide.value) return
  busy.value = true
  lastError.value = null
  joined.value = null
  try {
    joined.value = await postJson<{ mapSlug: string, placementIds: string[] }>('/api/onboarding/encounter/join', {
      trainerSlug: selectedTrainer.value,
      mapSlug: selectedMap.value,
      sideId: selectedSide.value,
      operationId: `onbop_join-${selectedTrainer.value}-${selectedMap.value}-${Date.now().toString(36)}`,
    })
  } catch (error) {
    lastError.value = (error as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? (error instanceof Error ? error.message : 'Join failed')
  } finally {
    busy.value = false
  }
}

const readyCandidates = computed(() => candidates.value.filter(candidate => candidate.ready))
const canJoin = computed(() =>
  !busy.value
  && selectedTrainer.value !== ''
  && selectedSide.value !== ''
  && eligibility.value?.eligible === true)

onMounted(() => { void load() })

defineExpose({ reload: load })
</script>

<template>
  <section v-if="candidates.length > 0" class="party-join" aria-labelledby="party-join-title">
    <h2 id="party-join-title">
      <PhSword :size="20" weight="duotone" aria-hidden="true" />
      Send a party to an encounter
    </h2>
    <p class="party-join__hint">
      Completed packages join a staging battlefield in one authorized step.
      A live scene uses the ordinary in-play send-out tools instead.
    </p>

    <div class="party-join__form">
      <label class="party-join__field">
        <span>Party</span>
        <select v-model="selectedTrainer" :disabled="busy">
          <option value="">Choose a party…</option>
          <option v-for="candidate in readyCandidates" :key="candidate.trainerSlug" :value="candidate.trainerSlug">
            {{ candidate.trainerName }} + {{ candidate.pokemonSlugs.length }} Pokémon
            ({{ candidate.kind === 'intake' ? 'adopted' : 'new' }})
          </option>
        </select>
      </label>
      <label class="party-join__field">
        <span>Battlefield</span>
        <select v-model="selectedMap" :disabled="busy">
          <option value="">Choose a map…</option>
          <option v-for="map in maps" :key="map.slug" :value="map.slug">{{ map.name }}</option>
        </select>
      </label>
      <label v-if="eligibility && eligibility.sides.length > 0" class="party-join__field">
        <span>Side</span>
        <select v-model="selectedSide" :disabled="busy">
          <option value="">Choose a side…</option>
          <option v-for="side in eligibility.sides" :key="side.id" :value="side.id">{{ side.label }}</option>
        </select>
      </label>
      <button type="button" class="party-join__submit" :disabled="!canJoin" @click="join">
        {{ busy ? 'Placing…' : 'Place party' }}
      </button>
    </div>

    <p v-if="eligibility && !eligibility.eligible" class="party-join__blocked" role="status">
      {{ eligibility.reason }}
    </p>
    <p v-if="lastError" class="party-join__error" role="alert">{{ lastError }}</p>
    <p v-if="joined" class="party-join__done" role="status">
      Placed {{ joined.placementIds.length }} participant(s).
      <NuxtLink :to="`/maps/${joined.mapSlug}`">Open the battlefield</NuxtLink>
    </p>
  </section>
</template>

<style scoped>
.party-join {
  display: grid;
  gap: .65rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-1, var(--paper-soft));
  padding: var(--rt-space-4, 1rem);
}
.party-join h2 {
  display: flex;
  align-items: center;
  gap: .5rem;
  margin: 0;
  color: var(--rt-text-strong, var(--ink-bright));
  font: 700 1.3rem/1.1 var(--font-book);
}
.party-join__hint { margin: 0; color: var(--rt-text-muted, var(--ink-soft)); }
.party-join__form { display: flex; flex-wrap: wrap; gap: .7rem; align-items: end; }
.party-join__field { display: grid; gap: .3rem; min-width: min(16rem, 100%); }
.party-join__field span { font-size: .78rem; font-weight: 750; color: var(--rt-text-muted, var(--ink-soft)); }
.party-join__field select {
  min-height: 44px;
  padding: .45rem .6rem;
  border: 1px solid var(--rt-rule, var(--rule-soft));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text, var(--ink));
  font: inherit;
}
.party-join__submit {
  min-height: 44px;
  padding: .55rem 1rem;
  border: 1px solid var(--rt-focus, var(--info));
  background: var(--rt-surface-2, var(--paper-inset));
  color: var(--rt-text-strong, var(--ink-bright));
  font-weight: 800;
  cursor: pointer;
}
.party-join__submit:disabled { opacity: .5; cursor: not-allowed; }
.party-join__blocked {
  margin: 0;
  border-left: 4px solid var(--rt-pending, #ffbf52);
  background: var(--rt-surface-2, var(--paper-inset));
  padding: .55rem .8rem;
}
.party-join__error {
  margin: 0;
  border-left: 4px solid var(--rt-danger, #ff6672);
  background: var(--rt-surface-2, var(--paper-inset));
  padding: .55rem .8rem;
}
.party-join__done {
  margin: 0;
  border-left: 4px solid var(--rt-success, #58d5a0);
  background: var(--rt-surface-2, var(--paper-inset));
  padding: .55rem .8rem;
}
.party-join :is(select, button, a):focus-visible {
  outline: 3px solid var(--rt-focus, #59d8ff);
  outline-offset: 2px;
}
</style>
