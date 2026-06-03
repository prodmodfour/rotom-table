<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AppNavigation from '~/components/AppNavigation.vue'
import TrainerPokemonCard from '~/components/sheets/TrainerPokemonCard.vue'
import { getSpriteUrl } from '~~/data/characterSheets'
import { useApiClient } from '~/composables/useApiClient'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { playerProfileSwitchRoute } from '~/utils/playerProfileNavigation'
import { buildPlayerTrainerPortal } from '~/utils/playerTrainerPortal'
import { trainerAccentCssVariables } from '~/utils/trainerAccent'
import {
  buildSheetListFetchOptions,
  buildSheetSaveBody,
  sheetApiProfileContext,
} from '~/utils/sheetApiRequests'
import {
  addPokemonToTrainerTeam,
  boxPokemonForTrainer,
  moveTrainerPokemonLink,
  trainerTeamHasOpenSlot,
  trainerTeamSlotCount,
  TRAINER_TEAM_LIMIT,
  type TrainerPokemonRosterKind,
} from '~/utils/trainerPokemonLinks'
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
const { getJson, postJson } = useApiClient()
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
const savingRosterSlugs = reactive(new Set<string>())
const rosterSaveErrors = reactive<Record<string, string>>({})
const trainingTrainerSlug = ref<string | null>(null)
let loadSequence = 0

interface TrainerPortalDragPayload {
  trainerSlug: string
  slug: string
  sourceRoster: TrainerPokemonRosterKind
}

const TRAINER_PORTAL_POKEMON_LINK_DRAG_TYPE = 'application/x-rotom-trainer-portal-pokemon-link'
const draggedPokemon = ref<TrainerPortalDragPayload | null>(null)
const dragOverRoster = ref<{ trainerSlug: string; roster: TrainerPokemonRosterKind } | null>(null)

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
const trainerPortalAccentStyle = (accentColor: unknown): Record<string, string> => (
  trainerAccentCssVariables(accentColor)
)
const trainerHasOpenTeamSlot = (sheet: TrainerSheet): boolean => trainerTeamHasOpenSlot(sheet)
const trainerTeamCount = (sheet: TrainerSheet): number => trainerTeamSlotCount(sheet)
const emptyTeamSlotsForTrainer = (sheet: TrainerSheet): unknown[] => Array.from({
  length: Math.max(0, TRAINER_TEAM_LIMIT - trainerTeamSlotCount(sheet)),
})
const isRosterDropTarget = (trainerSlug: string, roster: TrainerPokemonRosterKind): boolean => (
  dragOverRoster.value?.trainerSlug === trainerSlug && dragOverRoster.value.roster === roster
)

const findTrainerSheet = (trainerSlug: string): TrainerSheet | null => (
  trainerSheets.value.find((sheet) => sheet.slug === trainerSlug) ?? null
)

const trainingTrainer = computed(() => (
  trainingTrainerSlug.value ? findTrainerSheet(trainingTrainerSlug.value) : null
))

const openTrainingModal = (trainerSlug: string): void => {
  trainingTrainerSlug.value = trainerSlug
}

const closeTrainingModal = (): void => {
  trainingTrainerSlug.value = null
}

const replacePokemonSheet = (updatedSheet: CharacterSheet): void => {
  const index = pokemonSheets.value.findIndex((sheet) => sheet.slug === updatedSheet.slug)
  if (index >= 0) pokemonSheets.value.splice(index, 1, updatedSheet)
  else pokemonSheets.value.push(updatedSheet)
  pokemonSheets.value = [...pokemonSheets.value]
}

const replaceTrainerSheet = (updatedSheet: TrainerSheet): void => {
  const index = trainerSheets.value.findIndex((sheet) => sheet.slug === updatedSheet.slug)
  if (index >= 0) trainerSheets.value.splice(index, 1, { ...trainerSheets.value[index], ...updatedSheet })
  else trainerSheets.value.push(updatedSheet)
  touchTrainerSheets()
}

const touchTrainerSheets = (): void => {
  trainerSheets.value = [...trainerSheets.value]
}

const trainerRosterSnapshot = (sheet: TrainerSheet) => ({
  currentTeam: [...(sheet.currentTeam ?? [])],
  boxedPokemon: [...(sheet.boxedPokemon ?? [])],
})

const restoreTrainerRosterSnapshot = (
  sheet: TrainerSheet,
  snapshot: ReturnType<typeof trainerRosterSnapshot>,
): void => {
  sheet.currentTeam = [...snapshot.currentTeam]
  sheet.boxedPokemon = [...snapshot.boxedPokemon]
  touchTrainerSheets()
}

const setTrainerRosterSaving = (trainerSlug: string, saving: boolean): void => {
  if (saving) savingRosterSlugs.add(trainerSlug)
  else savingRosterSlugs.delete(trainerSlug)
}

const persistTrainerRoster = async (sheet: TrainerSheet): Promise<void> => {
  setTrainerRosterSaving(sheet.slug, true)
  delete rosterSaveErrors[sheet.slug]
  try {
    await postJson(SHEET_API_PATHS.save, buildSheetSaveBody({
      kind: 'trainer',
      slug: sheet.slug,
      sheet,
      profileContext: sheetApiProfileContext(true, selectedProfileId.value),
      requireSelectedPlayerProfile: true,
      allowSlugSync: false,
    }))
  } catch (error) {
    rosterSaveErrors[sheet.slug] = getErrorMessage(error)
    throw error
  } finally {
    setTrainerRosterSaving(sheet.slug, false)
  }
}

const updateTrainerRoster = async (
  trainerSlug: string,
  mutate: (sheet: TrainerSheet) => boolean,
): Promise<void> => {
  if (savingRosterSlugs.has(trainerSlug)) return

  const sheet = findTrainerSheet(trainerSlug)
  if (!sheet) return

  const snapshot = trainerRosterSnapshot(sheet)
  if (!mutate(sheet)) return

  touchTrainerSheets()
  try {
    await persistTrainerRoster(sheet)
  } catch {
    restoreTrainerRosterSnapshot(sheet, snapshot)
  }
}

const readTrainerPokemonDragPayload = (event: DragEvent): TrainerPortalDragPayload | null => {
  if (draggedPokemon.value) return draggedPokemon.value

  const rawPayload = event.dataTransfer?.getData(TRAINER_PORTAL_POKEMON_LINK_DRAG_TYPE)
  if (!rawPayload) return null

  try {
    const parsed = JSON.parse(rawPayload) as Partial<TrainerPortalDragPayload>
    const sourceRoster = parsed.sourceRoster === 'team' || parsed.sourceRoster === 'box'
      ? parsed.sourceRoster
      : null
    const trainerSlug = typeof parsed.trainerSlug === 'string' ? parsed.trainerSlug : ''
    const slug = typeof parsed.slug === 'string' ? parsed.slug : ''
    return sourceRoster && trainerSlug && slug ? { trainerSlug, slug, sourceRoster } : null
  } catch {
    return null
  }
}

const canDropPokemonOnRoster = (
  payload: TrainerPortalDragPayload | null,
  targetTrainerSlug: string,
  targetRoster: TrainerPokemonRosterKind,
): boolean => {
  if (!payload || payload.trainerSlug !== targetTrainerSlug) return false
  if (savingRosterSlugs.has(targetTrainerSlug)) return false
  const sheet = findTrainerSheet(targetTrainerSlug)
  if (!sheet) return false
  if (targetRoster === 'team' && payload.sourceRoster !== 'team' && !trainerTeamHasOpenSlot(sheet)) return false
  return true
}

const clearPokemonDragState = (): void => {
  draggedPokemon.value = null
  dragOverRoster.value = null
}

const handlePokemonDragStart = (
  event: DragEvent,
  trainerSlug: string,
  slug: string,
  sourceRoster: TrainerPokemonRosterKind,
): void => {
  const payload: TrainerPortalDragPayload = { trainerSlug, slug, sourceRoster }
  draggedPokemon.value = payload
  dragOverRoster.value = null

  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData(TRAINER_PORTAL_POKEMON_LINK_DRAG_TYPE, JSON.stringify(payload))
  event.dataTransfer.setData('text/plain', slug)
}

const handlePokemonDragEnd = (): void => {
  clearPokemonDragState()
}

const handleRosterDragOver = (
  event: DragEvent,
  trainerSlug: string,
  targetRoster: TrainerPokemonRosterKind,
): void => {
  if (!canDropPokemonOnRoster(draggedPokemon.value, trainerSlug, targetRoster)) {
    dragOverRoster.value = null
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    return
  }

  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  dragOverRoster.value = { trainerSlug, roster: targetRoster }
}

const handlePokemonCardDragOver = (
  event: DragEvent,
  trainerSlug: string,
  targetRoster: TrainerPokemonRosterKind,
): void => {
  event.stopPropagation()
  handleRosterDragOver(event, trainerSlug, targetRoster)
}

const handlePokemonDrop = (
  event: DragEvent,
  trainerSlug: string,
  targetRoster: TrainerPokemonRosterKind,
  targetIndex?: number,
): void => {
  const payload = readTrainerPokemonDragPayload(event)
  if (!payload) return

  event.preventDefault()
  event.stopPropagation()
  if (canDropPokemonOnRoster(payload, trainerSlug, targetRoster)) {
    void updateTrainerRoster(trainerSlug, (sheet) => moveTrainerPokemonLink(
      sheet,
      payload.slug,
      targetRoster,
      targetIndex,
    ))
  }
  clearPokemonDragState()
}

const movePokemonToTeam = (trainerSlug: string, pokemonSlug: string): void => {
  void updateTrainerRoster(trainerSlug, (sheet) => addPokemonToTrainerTeam(sheet, pokemonSlug))
}

const movePokemonToBox = (trainerSlug: string, pokemonSlug: string): void => {
  void updateTrainerRoster(trainerSlug, (sheet) => boxPokemonForTrainer(sheet, pokemonSlug))
}

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
    savingRosterSlugs.clear()
    for (const key of Object.keys(rosterSaveErrors)) delete rosterSaveErrors[key]
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
            :style="trainerPortalAccentStyle(trainer.sheet.accentColor)"
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
                <button
                  type="button"
                  class="trainer-portal-action trainer-portal-action--button trainer-portal-action--training"
                  @click="openTrainingModal(trainer.slug)"
                >
                  Training
                </button>
                <p v-if="savingRosterSlugs.has(trainer.slug)" class="trainer-portal-card__save" aria-live="polite">
                  Saving roster…
                </p>
                <p v-else-if="rosterSaveErrors[trainer.slug]" class="trainer-portal-card__save trainer-portal-card__save--error" aria-live="polite">
                  {{ rosterSaveErrors[trainer.slug] }}
                </p>
              </div>
            </header>

            <section
              class="trainer-portal-roster trainer-portal-roster--team"
              :class="{ 'is-pokemon-drop-target': isRosterDropTarget(trainer.slug, 'team') }"
              aria-label="Team Pokémon"
              @dragover="handleRosterDragOver($event, trainer.slug, 'team')"
              @drop="handlePokemonDrop($event, trainer.slug, 'team')"
            >
              <div class="trainer-portal-roster__heading">
                <h3>Team</h3>
                <span>{{ trainerTeamCount(trainer.sheet) }}/{{ TRAINER_TEAM_LIMIT }}</span>
              </div>
              <div class="trainer-portal-pokemon-list trainer-portal-pokemon-list--team">
                <TrainerPokemonCard
                  v-for="(pokemon, index) in trainer.team"
                  :key="`team-${trainer.slug}-${pokemon.slug}`"
                  :member="pokemon"
                  variant="team"
                  :show-unlink="false"
                  @move-to-box="(slug) => movePokemonToBox(trainer.slug, slug)"
                  @drag-start="(event, slug, roster) => handlePokemonDragStart(event, trainer.slug, slug, roster)"
                  @drag-end="handlePokemonDragEnd"
                  @drag-over="(event) => handlePokemonCardDragOver(event, trainer.slug, 'team')"
                  @drop="(event) => handlePokemonDrop(event, trainer.slug, 'team', index)"
                />

                <div
                  v-for="(_, index) in emptyTeamSlotsForTrainer(trainer.sheet)"
                  :key="`empty-team-slot-${trainer.slug}-${index}`"
                  class="trainer-portal-team-empty-slot"
                >
                  <span>Empty Slot</span>
                </div>
              </div>
            </section>

            <section
              class="trainer-portal-roster trainer-portal-roster--box"
              :class="{ 'is-pokemon-drop-target': isRosterDropTarget(trainer.slug, 'box') }"
              aria-label="Boxed Pokémon"
              @dragover="handleRosterDragOver($event, trainer.slug, 'box')"
              @drop="handlePokemonDrop($event, trainer.slug, 'box')"
            >
              <div class="trainer-portal-roster__heading">
                <h3>Box</h3>
                <span>{{ trainer.box.length }}</span>
              </div>
              <div v-if="trainer.box.length" class="trainer-portal-pokemon-list trainer-portal-pokemon-list--box">
                <TrainerPokemonCard
                  v-for="(pokemon, index) in trainer.box"
                  :key="`box-${trainer.slug}-${pokemon.slug}`"
                  :member="pokemon"
                  variant="box"
                  :can-move-to-team="trainerHasOpenTeamSlot(trainer.sheet)"
                  :show-unlink="false"
                  @move-to-team="(slug) => movePokemonToTeam(trainer.slug, slug)"
                  @drag-start="(event, slug, roster) => handlePokemonDragStart(event, trainer.slug, slug, roster)"
                  @drag-end="handlePokemonDragEnd"
                  @drag-over="(event) => handlePokemonCardDragOver(event, trainer.slug, 'box')"
                  @drop="(event) => handlePokemonDrop(event, trainer.slug, 'box', index)"
                />
              </div>
              <p v-else class="trainer-portal-roster__empty">No boxed Pokémon linked.</p>
            </section>
          </article>
        </section>

        <TrainerTrainingModal
          v-if="trainingTrainer"
          :sheet="trainingTrainer"
          :pokemon-sheets="pokemonSheets"
          @close="closeTrainingModal"
          @pokemon-updated="replacePokemonSheet"
          @trainer-updated="replaceTrainerSheet"
        />

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

.trainer-portal-empty h2,
.trainer-portal-card h2,
.trainer-portal-other h2 {
  margin: 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  letter-spacing: 0.04em;
}

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

.trainer-portal-action {
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

.trainer-portal-action:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.trainer-portal-action--button {
  cursor: pointer;
}

.trainer-portal-action--training {
  margin-top: 0.55rem;
  border-color: color-mix(in srgb, var(--accent) 65%, var(--rule-soft));
  background: rgba(var(--accent-rgb), 0.14);
}

.trainer-portal-empty {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  align-items: flex-start;
}

.trainer-portal-grid {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.trainer-portal-card {
  display: grid;
  grid-template-columns: minmax(320px, 520px) minmax(0, 1fr);
  grid-template-areas:
    "trainer box"
    "team box";
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0.85rem;
  align-items: stretch;
  width: 100%;
}

.trainer-portal-card__header {
  grid-area: trainer;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.75rem;
  align-content: flex-start;
  align-items: center;
  min-width: 0;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--rule-soft);
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

.trainer-portal-card__save {
  grid-column: 1 / -1;
  margin: 0.4rem 0 0;
  color: var(--accent);
  font-size: 0.76rem;
  font-weight: 800;
  letter-spacing: 0.05em;
}

.trainer-portal-card__save--error {
  color: var(--bad);
}

.trainer-portal-card h2 {
  max-width: 100%;
  font-size: clamp(2.2rem, 3.8vw, 4.75rem);
  line-height: 0.95;
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
  gap: 0.55rem;
  min-width: 0;
  min-height: 100%;
  padding: 0.75rem;
  border: 1px solid var(--rule-soft);
  background: var(--paper-inset);
  transition: border-color 0.16s ease, box-shadow 0.16s ease;
}

.trainer-portal-roster--team {
  grid-area: team;
  background:
    linear-gradient(180deg, rgba(var(--accent-rgb), 0.08), transparent 40%),
    var(--paper-inset);
}

.trainer-portal-roster--box {
  grid-area: box;
}

.trainer-portal-roster.is-pokemon-drop-target {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.18), 0 12px 28px rgba(5, 6, 8, 0.28);
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
  gap: 0.55rem;
}

.trainer-portal-pokemon-list--team {
  display: flex;
  flex-direction: column;
}

.trainer-portal-pokemon-list--box {
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  align-content: start;
}

.trainer-portal-pokemon-list--other {
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
}

.trainer-portal-team-empty-slot {
  min-height: 64px;
  display: grid;
  place-items: center;
  border: 1px dashed var(--rule-soft);
  color: var(--ink-faint);
  background: rgba(5, 6, 8, 0.24);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
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

@media (max-width: 900px) {
  .trainer-portal-card {
    grid-template-columns: 1fr;
    grid-template-areas:
      "trainer"
      "team"
      "box";
  }

  .trainer-portal-card__header {
    padding-right: 0;
    padding-bottom: 0.85rem;
    border-right: 0;
    border-bottom: 1px solid var(--rule-soft);
  }
}
</style>
