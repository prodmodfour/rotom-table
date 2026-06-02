<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import { getSpriteUrl } from '~~/data/characterSheets'
import { useApiClient } from '~/composables/useApiClient'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { playerProfileSwitchRoute } from '~/utils/playerProfileNavigation'
import { buildPlayerTrainerPortal } from '~/utils/playerTrainerPortal'
import { buildSheetListFetchOptions, sheetApiProfileContext } from '~/utils/sheetApiRequests'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

interface SheetListPayload {
  pokemonSheets: CharacterSheet[]
  trainerSheets: TrainerSheet[]
}

useHead({
  title: 'Trainers · Rotom Table',
})

const route = useRoute()
const { isPlayer } = useAuth()
const { getJson } = useApiClient()
const {
  selectedProfileId,
  selectedProfileDisplayName,
  selectedLinkedCharacters,
  hasSelectedProfile,
  loadRememberedProfile,
  reloadProfiles,
  busy: profileBusy,
  lastError: profileError,
} = usePlayerProfiles()

const pokemonSheets = ref<CharacterSheet[]>([])
const trainerSheets = ref<TrainerSheet[]>([])
const loadingSheets = ref(false)
const sheetError = ref<string | null>(null)
let loadSequence = 0

if (import.meta.client && isPlayer.value) loadRememberedProfile()

const chooseProfileRoute = computed(() => playerProfileSwitchRoute(route.fullPath))
const selectedProfileLabel = computed(() => selectedProfileDisplayName.value ?? 'No profile selected')
const loading = computed(() => profileBusy.value || loadingSheets.value)
const portal = computed(() => buildPlayerTrainerPortal({
  trainerSheets: trainerSheets.value,
  pokemonSheets: pokemonSheets.value,
  linkedCharacters: selectedLinkedCharacters.value,
  spriteUrlForSpecies: getSpriteUrl,
}))
const hasPortalSheets = computed(() => (
  portal.value.trainers.length > 0 || portal.value.otherPokemon.length > 0
))

const loadTrainerPortal = async (): Promise<void> => {
  if (!import.meta.client || !isPlayer.value) return

  const sequence = ++loadSequence
  sheetError.value = null
  loadRememberedProfile()

  let profileLoadError: string | null = null
  try {
    await reloadProfiles({ silent: true, clearMissingSelection: true })
  } catch (error) {
    if (sequence !== loadSequence) return
    profileLoadError = getErrorMessage(error)
  }

  const profileId = selectedProfileId.value
  if (!profileId) {
    pokemonSheets.value = []
    trainerSheets.value = []
    loadingSheets.value = false
    sheetError.value = profileLoadError
    return
  }

  loadingSheets.value = true
  try {
    const payload = await getJson<SheetListPayload>(
      SHEET_API_PATHS.list,
      buildSheetListFetchOptions(sheetApiProfileContext(true, profileId)),
    )
    if (sequence !== loadSequence) return
    pokemonSheets.value = payload.pokemonSheets
    trainerSheets.value = payload.trainerSheets
    sheetError.value = null
  } catch (error) {
    if (sequence !== loadSequence) return
    sheetError.value = getErrorMessage(error) || profileLoadError
    pokemonSheets.value = []
    trainerSheets.value = []
  } finally {
    if (sequence === loadSequence) loadingSheets.value = false
  }
}

onMounted(() => {
  void loadTrainerPortal()
})

watch(selectedProfileId, () => {
  void loadTrainerPortal()
})
</script>

<template>
  <div class="trainer-portal-page">
    <header class="trainer-portal-page__header">
      <AppNavigation />

      <section class="trainer-portal-hero panel-card">
        <div>
          <p class="trainer-portal-eyebrow">Player trainer page</p>
          <h1>Your linked trainers</h1>
          <p>
            Open your linked trainer sheets and the Pokémon in each trainer's team and box.
          </p>
        </div>
        <div class="trainer-portal-profile">
          <span>Profile</span>
          <strong>{{ selectedProfileLabel }}</strong>
          <NuxtLink :to="chooseProfileRoute">{{ hasSelectedProfile ? 'Switch' : 'Choose profile' }}</NuxtLink>
        </div>
      </section>
    </header>

    <main class="trainer-portal-page__body">
      <section v-if="!hasSelectedProfile" class="trainer-portal-empty panel-card">
        <h2>Choose a player profile</h2>
        <p>Select your table profile to see the trainers and Pokémon the GM linked to you.</p>
        <NuxtLink class="trainer-portal-action" :to="chooseProfileRoute">Choose profile</NuxtLink>
      </section>

      <section v-else-if="loading" class="trainer-portal-empty panel-card" aria-live="polite">
        <h2>Loading linked trainers…</h2>
        <p>Checking your selected player profile and sheet access.</p>
      </section>

      <section v-else-if="sheetError || profileError" class="trainer-portal-empty panel-card">
        <h2>Could not load trainers</h2>
        <p>{{ sheetError || profileError }}</p>
        <button type="button" class="trainer-portal-action trainer-portal-action--button" @click="loadTrainerPortal">
          Retry
        </button>
      </section>

      <section v-else-if="!hasPortalSheets" class="trainer-portal-empty panel-card">
        <h2>No linked trainers yet</h2>
        <p>Ask the GM to link a trainer sheet to {{ selectedProfileLabel }}.</p>
      </section>

      <template v-else>
        <section class="trainer-portal-grid" aria-label="Linked trainers">
          <article
            v-for="trainer in portal.trainers"
            :key="trainer.slug"
            class="trainer-portal-card panel-card"
          >
            <header class="trainer-portal-card__header">
              <div class="trainer-portal-card__portrait">
                <img
                  v-if="trainer.spriteUrl"
                  :src="trainer.spriteUrl"
                  :alt="`${trainer.displayName} trainer portrait`"
                >
                <span v-else aria-hidden="true">🎯</span>
              </div>
              <div>
                <p class="trainer-portal-eyebrow">Trainer · Lv {{ trainer.level }}</p>
                <h2>
                  <NuxtLink :to="trainer.path">{{ trainer.displayName }}</NuxtLink>
                </h2>
                <p v-if="trainer.sheet.classes?.length" class="trainer-portal-card__meta">
                  {{ trainer.sheet.classes.map((entry) => entry.name).join(', ') }}
                </p>
                <p v-else-if="trainer.sheet.playedBy" class="trainer-portal-card__meta">
                  Played by {{ trainer.sheet.playedBy }}
                </p>
              </div>
            </header>

            <section class="trainer-portal-roster" aria-label="Team Pokémon">
              <div class="trainer-portal-roster__heading">
                <h3>Team</h3>
                <span>{{ trainer.team.length }}</span>
              </div>
              <div v-if="trainer.team.length" class="trainer-portal-pokemon-list">
                <NuxtLink
                  v-for="pokemon in trainer.team"
                  :key="`team-${trainer.slug}-${pokemon.slug}`"
                  class="trainer-portal-pokemon"
                  :class="{ 'trainer-portal-pokemon--missing': !pokemon.path }"
                  :to="pokemon.path || trainer.path"
                >
                  <span class="trainer-portal-pokemon__sprite">
                    <img v-if="pokemon.spriteUrl" :src="pokemon.spriteUrl" :alt="pokemon.species || pokemon.displayName">
                    <span v-else aria-hidden="true">?</span>
                  </span>
                  <span class="trainer-portal-pokemon__text">
                    <strong>{{ pokemon.displayName }}</strong>
                    <small v-if="pokemon.sheet">{{ pokemon.species }} · Lv {{ pokemon.level }}</small>
                    <small v-else>Sheet unavailable</small>
                  </span>
                </NuxtLink>
              </div>
              <p v-else class="trainer-portal-roster__empty">No team Pokémon linked.</p>
            </section>

            <section class="trainer-portal-roster" aria-label="Boxed Pokémon">
              <div class="trainer-portal-roster__heading">
                <h3>Box</h3>
                <span>{{ trainer.box.length }}</span>
              </div>
              <div v-if="trainer.box.length" class="trainer-portal-pokemon-list trainer-portal-pokemon-list--box">
                <NuxtLink
                  v-for="pokemon in trainer.box"
                  :key="`box-${trainer.slug}-${pokemon.slug}`"
                  class="trainer-portal-pokemon"
                  :class="{ 'trainer-portal-pokemon--missing': !pokemon.path }"
                  :to="pokemon.path || trainer.path"
                >
                  <span class="trainer-portal-pokemon__sprite">
                    <img v-if="pokemon.spriteUrl" :src="pokemon.spriteUrl" :alt="pokemon.species || pokemon.displayName">
                    <span v-else aria-hidden="true">?</span>
                  </span>
                  <span class="trainer-portal-pokemon__text">
                    <strong>{{ pokemon.displayName }}</strong>
                    <small v-if="pokemon.sheet">{{ pokemon.species }} · Lv {{ pokemon.level }}</small>
                    <small v-else>Sheet unavailable</small>
                  </span>
                </NuxtLink>
              </div>
              <p v-else class="trainer-portal-roster__empty">No boxed Pokémon linked.</p>
            </section>
          </article>
        </section>

        <section v-if="portal.otherPokemon.length" class="trainer-portal-other panel-card">
          <header>
            <p class="trainer-portal-eyebrow">Other linked sheets</p>
            <h2>Linked Pokémon not assigned to a trainer</h2>
          </header>
          <div class="trainer-portal-pokemon-list trainer-portal-pokemon-list--other">
            <NuxtLink
              v-for="pokemon in portal.otherPokemon"
              :key="`other-${pokemon.slug}`"
              class="trainer-portal-pokemon"
              :class="{ 'trainer-portal-pokemon--missing': !pokemon.path }"
              :to="pokemon.path || chooseProfileRoute"
            >
              <span class="trainer-portal-pokemon__sprite">
                <img v-if="pokemon.spriteUrl" :src="pokemon.spriteUrl" :alt="pokemon.species || pokemon.displayName">
                <span v-else aria-hidden="true">?</span>
              </span>
              <span class="trainer-portal-pokemon__text">
                <strong>{{ pokemon.displayName }}</strong>
                <small v-if="pokemon.sheet">{{ pokemon.species }} · Lv {{ pokemon.level }}</small>
                <small v-else>Sheet unavailable</small>
              </span>
            </NuxtLink>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.trainer-portal-page {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-height: 100vh;
  padding: 0.85rem;
  background: var(--paper);
  color: var(--ink);
}

.trainer-portal-page__header,
.trainer-portal-page__body {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.trainer-portal-hero {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 1rem;
}

.trainer-portal-hero h1,
.trainer-portal-empty h2,
.trainer-portal-card h2,
.trainer-portal-other h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

.trainer-portal-hero h1 {
  font-size: clamp(2rem, 4vw, 3.2rem);
}

.trainer-portal-hero p,
.trainer-portal-empty p,
.trainer-portal-card__meta {
  margin: 0.35rem 0 0;
  color: var(--ink-muted);
  line-height: 1.5;
}

.trainer-portal-eyebrow {
  margin: 0 0 0.25rem;
  color: var(--accent);
  font-size: 0.74rem;
  font-weight: 900;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.trainer-portal-profile {
  min-width: min(100%, 18rem);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.8rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
}

.trainer-portal-profile span {
  color: var(--ink-muted);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.trainer-portal-profile strong {
  color: var(--ink-bright);
}

.trainer-portal-action,
.trainer-portal-profile a {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  min-height: 2.2rem;
  padding: 0.45rem 0.7rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper);
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-decoration: none;
  text-transform: uppercase;
}

.trainer-portal-action:hover,
.trainer-portal-profile a:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.trainer-portal-action--button {
  cursor: pointer;
}

.trainer-portal-empty {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  align-items: flex-start;
}

.trainer-portal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 0.85rem;
}

.trainer-portal-card {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.trainer-portal-card__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.75rem;
  align-items: center;
}

.trainer-portal-card__portrait,
.trainer-portal-pokemon__sprite {
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
}

.trainer-portal-card__portrait {
  width: 4.3rem;
  height: 4.3rem;
  color: var(--ink-muted);
  font-size: 2rem;
}

.trainer-portal-card__portrait img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.trainer-portal-card h2 a {
  color: var(--ink-bright);
  text-decoration: none;
}

.trainer-portal-card h2 a:hover {
  color: var(--accent);
}

.trainer-portal-roster {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.trainer-portal-roster__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.trainer-portal-roster__heading h3 {
  margin: 0;
  color: var(--ink-bright);
  font-size: 0.84rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.trainer-portal-roster__heading span {
  min-width: 2rem;
  padding: 0.15rem 0.5rem;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.74rem;
  font-weight: 900;
  text-align: center;
}

.trainer-portal-pokemon-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.45rem;
}

.trainer-portal-pokemon-list--box,
.trainer-portal-pokemon-list--other {
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}

.trainer-portal-pokemon {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.55rem;
  align-items: center;
  min-height: 4.25rem;
  padding: 0.45rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  color: var(--ink);
  text-decoration: none;
}

.trainer-portal-pokemon:hover {
  border-color: var(--accent);
  background: var(--paper-hover);
}

.trainer-portal-pokemon--missing {
  opacity: 0.72;
}

.trainer-portal-pokemon__sprite {
  width: 3rem;
  height: 3rem;
  color: var(--ink-faint);
  font-weight: 900;
}

.trainer-portal-pokemon__sprite img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.trainer-portal-pokemon__text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.15rem;
}

.trainer-portal-pokemon__text strong,
.trainer-portal-pokemon__text small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trainer-portal-pokemon__text strong {
  color: var(--ink-bright);
}

.trainer-portal-pokemon__text small,
.trainer-portal-roster__empty {
  color: var(--ink-muted);
  font-size: 0.78rem;
}

.trainer-portal-roster__empty {
  margin: 0;
  padding: 0.7rem;
  border: 1px dashed var(--rule-soft);
  background: rgba(5, 6, 8, 0.3);
  text-align: center;
}

.trainer-portal-other {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

@media (max-width: 720px) {
  .trainer-portal-hero {
    flex-direction: column;
  }

  .trainer-portal-grid {
    grid-template-columns: 1fr;
  }
}
</style>
