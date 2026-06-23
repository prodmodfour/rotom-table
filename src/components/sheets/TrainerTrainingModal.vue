<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PhX } from '@phosphor-icons/vue'
import { getSpriteUrl } from '~~/data/characterSheets'
import { getClientId } from '~/utils/clientId'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { deepCloneJson } from '~/utils/serialization'
import { buildSheetSaveBody, sheetApiProfileContext } from '~/utils/sheetApiRequests'
import { normalizeRevision } from '#shared/sessionRevisions'
import { toPersistableSheetPayload } from '~/utils/sheets/persistence'
import { trainerAccentCssVariables } from '~/utils/trainerAccent'
import {
  calculatePokemonLevelFromExperience,
  pokemonExperienceNeededForLevel,
} from '~/utils/sheets/pokemonExperience'
import {
  POKEMON_TRAINING_FEATURE_OPTIONS,
  normalizePokemonTrainingFeatureName,
} from '~/utils/sheets/pokemonTrainingFeatures'
import {
  ACE_TRAINER_STAT_OPTIONS,
  TRAINING_SESSION_TARGET_LIMIT,
  TRAINING_SKILL_LABELS,
  aceTrainerStatLabel,
  applyAceTrainerTrainedStat,
  normalizeAceTrainerStatKey,
  pokemonTrainingExperienceGain,
  trainerCanApplyAceTrainerTraining,
  trainerExperienceTrainingLimit,
  trainerHasEdgeNamed,
  trainerOwnedPokemonTrainingFeatures,
  type AceTrainerStatKey,
  type TrainerTrainingSkillKey,
} from '~/utils/sheets/trainerTraining'
import { normalizeCharacterSheet } from '~/utils/sheetNormalize'
import { useLiveSheets } from '~/composables/useLiveSheets'
import { useApiClient } from '~/composables/useApiClient'
import {
  normalizePokemonSlugList,
  TRAINER_TEAM_LIMIT,
} from '~/utils/trainerPokemonLinks'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const props = defineProps<{
  sheet: TrainerSheet
  pokemonSheets?: readonly CharacterSheet[]
}>()

const emit = defineEmits<{
  close: []
  pokemonUpdated: [sheet: CharacterSheet]
  trainerUpdated: [sheet: TrainerSheet]
}>()

interface SaveSheetResponse<TSheet> {
  ok: true
  slug: string
  path: string
  sheet: TSheet
}

interface TrainingRosterRow {
  slug: string
  sheet: CharacterSheet | null
  displayName: string
  species: string
  level: number | null
  spriteUrl: string | null
  activeTrainingFeature: string
  trainedStat: AceTrainerStatKey | null
  selectedTrainingFeature: string
  selectedAceTrainerStat: AceTrainerStatKey | ''
  trainingExp: number
  totalExp: number | null
  selectedForSession: boolean
  selectedForExperience: boolean
  experienceGain: number
}

const titleId = 'trainer-training-modal-title'
const clientId = getClientId()
const { pokemonBySlug: livePokemonBySlug } = useLiveSheets()
const { postJson } = useApiClient()
const { isPlayer } = useAuth()
const { selectedProfileId } = usePlayerProfiles()

const selectedTrainingSlugs = ref<Set<string>>(new Set())
const selectedExperienceSlugs = ref<Set<string>>(new Set())
const selectedTrainingFeature = ref('')
const selectedTrainingFeatureBySlug = ref<Record<string, string>>({})
const selectedAceTrainerStat = ref<AceTrainerStatKey | ''>('atk')
const selectedAceTrainerStatBySlug = ref<Record<string, AceTrainerStatKey | ''>>({})
const applyAceTrainerStat = ref(false)
const experienceSkill = ref<TrainerTrainingSkillKey>('command')
const saving = ref(false)
const statusMessage = ref<string | null>(null)
const errorMessage = ref<string | null>(null)

const availablePokemonBySlug = computed<ReadonlyMap<string, CharacterSheet>>(() => {
  if (props.pokemonSheets) return new Map(props.pokemonSheets.map((sheet) => [sheet.slug, sheet]))
  return livePokemonBySlug.value
})

const teamSlugs = computed(() => (
  normalizePokemonSlugList(props.sheet.currentTeam).slice(0, TRAINER_TEAM_LIMIT)
))

const rosterSlugs = computed(() => teamSlugs.value)

const trainerOwnedTrainingFeatures = computed(() => trainerOwnedPokemonTrainingFeatures(props.sheet))

const trainingFeatureOptions = computed(() => {
  const owned = trainerOwnedTrainingFeatures.value
  const ownedOptions = POKEMON_TRAINING_FEATURE_OPTIONS.filter((name) => owned.has(name))
  return ownedOptions.length ? ownedOptions : POKEMON_TRAINING_FEATURE_OPTIONS
})

const canApplyAceTrainerStat = computed(() => trainerCanApplyAceTrainerTraining(props.sheet))
const trainerAccentStyle = computed(() => trainerAccentCssVariables(props.sheet.accentColor))

const initialTrainingFeature = () => {
  const savedDefault = normalizePokemonTrainingFeatureName(props.sheet.trainingFeature)
  if (savedDefault) return savedDefault
  return trainingFeatureOptions.value[0] ?? ''
}

const currentTrainingFeatureForSlug = (slug: string): string => (
  normalizePokemonTrainingFeatureName(availablePokemonBySlug.value.get(slug)?.activeTrainingFeature) ?? ''
)

const selectedTrainingFeatureForSlug = (slug: string): string => {
  if (Object.prototype.hasOwnProperty.call(selectedTrainingFeatureBySlug.value, slug)) {
    return normalizePokemonTrainingFeatureName(selectedTrainingFeatureBySlug.value[slug]) ?? ''
  }
  return currentTrainingFeatureForSlug(slug)
}

const trainingFeatureOptionsForRow = (row: TrainingRosterRow): string[] => {
  const options = new Set(trainingFeatureOptions.value)
  const currentFeature = normalizePokemonTrainingFeatureName(row.activeTrainingFeature)
  const selectedFeature = normalizePokemonTrainingFeatureName(row.selectedTrainingFeature)
  if (currentFeature) options.add(currentFeature)
  if (selectedFeature) options.add(selectedFeature)
  return [...options]
}

const setTrainingFeatureForSlug = (slug: string, value: unknown): void => {
  const normalized = normalizePokemonTrainingFeatureName(value)
  selectedTrainingFeatureBySlug.value = {
    ...selectedTrainingFeatureBySlug.value,
    [slug]: normalized ?? '',
  }
}

const setTrainingFeatureChoiceFromEvent = (slug: string, event: Event): void => {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  const normalized = normalizePokemonTrainingFeatureName(target.value) ?? ''
  setTrainingFeatureForSlug(slug, normalized)
  selectedTrainingFeature.value = normalized
}

const ensureTrainingFeatureChoices = (slugs: readonly string[]): void => {
  const next = { ...selectedTrainingFeatureBySlug.value }
  for (const slug of slugs) {
    if (Object.prototype.hasOwnProperty.call(next, slug)) {
      next[slug] = normalizePokemonTrainingFeatureName(next[slug]) ?? ''
      continue
    }
    next[slug] = currentTrainingFeatureForSlug(slug)
  }
  selectedTrainingFeatureBySlug.value = next
}

const selectedAceTrainerStatForSlug = (slug: string): AceTrainerStatKey | '' => {
  if (Object.prototype.hasOwnProperty.call(selectedAceTrainerStatBySlug.value, slug)) {
    return normalizeAceTrainerStatKey(selectedAceTrainerStatBySlug.value[slug]) ?? ''
  }
  return normalizeAceTrainerStatKey(selectedAceTrainerStat.value) ?? ''
}

const setAceTrainerStatForSlug = (slug: string, value: unknown): void => {
  selectedAceTrainerStatBySlug.value = {
    ...selectedAceTrainerStatBySlug.value,
    [slug]: normalizeAceTrainerStatKey(value) ?? '',
  }
}

const setAceTrainerStatForSlugFromEvent = (slug: string, event: Event): void => {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  setAceTrainerStatForSlug(slug, target.value)
}

const ensureAceTrainerStatChoices = (slugs: readonly string[]): void => {
  const next = { ...selectedAceTrainerStatBySlug.value }
  const fallback = normalizeAceTrainerStatKey(selectedAceTrainerStat.value) ?? 'atk'
  for (const slug of slugs) {
    const current = normalizeAceTrainerStatKey(next[slug])
    if (current) continue
    next[slug] = normalizeAceTrainerStatKey(availablePokemonBySlug.value.get(slug)?.trainedStat) ?? fallback
  }
  selectedAceTrainerStatBySlug.value = next
}

const setSelectedRowsToDefaultAceTrainerStat = (): void => {
  const normalized = normalizeAceTrainerStatKey(selectedAceTrainerStat.value)
  if (!normalized) return
  const next = { ...selectedAceTrainerStatBySlug.value }
  for (const slug of selectedTrainingSlugs.value) next[slug] = normalized
  selectedAceTrainerStatBySlug.value = next
}

const experienceSkillOptions = computed<Array<{ key: TrainerTrainingSkillKey; label: string }>>(() => {
  const options: Array<{ key: TrainerTrainingSkillKey; label: string }> = [
    { key: 'command', label: TRAINING_SKILL_LABELS.command },
  ]
  if (trainerHasEdgeNamed(props.sheet, 'Beast Master')) {
    options.push({ key: 'intimidate', label: TRAINING_SKILL_LABELS.intimidate })
  }
  return options
})

const experienceLimit = computed(() => trainerExperienceTrainingLimit(props.sheet, experienceSkill.value))
const selectedSessionCount = computed(() => selectedTrainingSlugs.value.size)
const selectedExperienceCount = computed(() => selectedExperienceSlugs.value.size)

const rosterRows = computed<TrainingRosterRow[]>(() => rosterSlugs.value.map((slug) => {
  const pokemon = availablePokemonBySlug.value.get(slug) ?? null
  const level = pokemon?.level ?? null
  return {
    slug,
    sheet: pokemon,
    displayName: pokemon?.nickname || slug,
    species: pokemon?.species ?? 'Missing sheet',
    level,
    spriteUrl: pokemon ? getSpriteUrl(pokemon.species) : null,
    activeTrainingFeature: pokemon?.activeTrainingFeature ?? '',
    trainedStat: normalizeAceTrainerStatKey(pokemon?.trainedStat),
    selectedTrainingFeature: selectedTrainingFeatureForSlug(slug),
    selectedAceTrainerStat: selectedAceTrainerStatForSlug(slug),
    trainingExp: pokemon?.combat?.trainingExp ?? 0,
    totalExp: typeof pokemon?.totalExp === 'number' ? pokemon.totalExp : null,
    selectedForSession: selectedTrainingSlugs.value.has(slug),
    selectedForExperience: selectedExperienceSlugs.value.has(slug),
    experienceGain: pokemon ? pokemonTrainingExperienceGain(props.sheet, pokemon, experienceSkill.value) : 0,
  }
}))

const selectedRowsWithSheets = computed(() => rosterRows.value.filter((row) => row.selectedForSession && row.sheet))
const selectedExperienceRows = computed(() => rosterRows.value.filter((row) => row.selectedForExperience && row.sheet))
const selectedRowsWithTrainingFeature = computed(() => selectedRowsWithSheets.value.filter(
  (row) => Boolean(normalizePokemonTrainingFeatureName(row.selectedTrainingFeature)),
))
const selectedRowsWithAceTrainerStat = computed(() => selectedRowsWithSheets.value.filter(
  (row) => Boolean(normalizeAceTrainerStatKey(row.selectedAceTrainerStat)),
))

const canApplyTraining = computed(() => (
  selectedRowsWithSheets.value.length > 0 && (
    selectedRowsWithTrainingFeature.value.length > 0 ||
    (canApplyAceTrainerStat.value && applyAceTrainerStat.value && selectedRowsWithAceTrainerStat.value.length > 0) ||
    selectedExperienceRows.value.length > 0
  )
))

watch(trainingFeatureOptions, () => {
  const normalized = normalizePokemonTrainingFeatureName(selectedTrainingFeature.value)
  if (!normalized || !trainingFeatureOptions.value.includes(normalized)) {
    selectedTrainingFeature.value = initialTrainingFeature()
  }

  const optionSet = new Set(trainingFeatureOptions.value)
  const nextChoices: Record<string, string> = {}
  for (const [slug, rawFeature] of Object.entries(selectedTrainingFeatureBySlug.value)) {
    const feature = normalizePokemonTrainingFeatureName(rawFeature)
    if (feature && optionSet.has(feature)) nextChoices[slug] = feature
  }
  selectedTrainingFeatureBySlug.value = nextChoices
}, { immediate: true })

watch(rosterSlugs, (slugs) => {
  const valid = new Set(slugs)
  let selected = [...selectedTrainingSlugs.value].filter((slug) => valid.has(slug)).slice(0, TRAINING_SESSION_TARGET_LIMIT)
  if (!selected.length) selected = teamSlugs.value.slice(0, TRAINING_SESSION_TARGET_LIMIT)
  selectedTrainingSlugs.value = new Set(selected)
  selectedExperienceSlugs.value = new Set([...selectedExperienceSlugs.value].filter((slug) => selected.includes(slug)))
  selectedTrainingFeatureBySlug.value = Object.fromEntries(
    Object.entries(selectedTrainingFeatureBySlug.value).filter(([slug]) => valid.has(slug)),
  )
  selectedAceTrainerStatBySlug.value = Object.fromEntries(
    Object.entries(selectedAceTrainerStatBySlug.value).filter(([slug]) => valid.has(slug)),
  )
  ensureTrainingFeatureChoices(selected)
  ensureAceTrainerStatChoices(selected)
}, { immediate: true })

watch([experienceLimit, selectedTrainingSlugs], () => {
  const selected = selectedTrainingSlugs.value
  selectedExperienceSlugs.value = new Set(
    [...selectedExperienceSlugs.value]
      .filter((slug) => selected.has(slug))
      .slice(0, experienceLimit.value),
  )
})

const toggleTrainingTarget = (slug: string) => {
  errorMessage.value = null
  const next = new Set(selectedTrainingSlugs.value)
  if (next.has(slug)) {
    next.delete(slug)
    const expNext = new Set(selectedExperienceSlugs.value)
    expNext.delete(slug)
    selectedExperienceSlugs.value = expNext
  } else {
    if (next.size >= TRAINING_SESSION_TARGET_LIMIT) {
      errorMessage.value = `A training session can target only ${TRAINING_SESSION_TARGET_LIMIT} Pokémon.`
      return
    }
    next.add(slug)
    ensureTrainingFeatureChoices([slug])
    ensureAceTrainerStatChoices([slug])
  }
  selectedTrainingSlugs.value = next
}

const toggleExperienceTarget = (slug: string) => {
  errorMessage.value = null
  if (!selectedTrainingSlugs.value.has(slug)) return

  const next = new Set(selectedExperienceSlugs.value)
  if (next.has(slug)) next.delete(slug)
  else {
    if (next.size >= experienceLimit.value) {
      errorMessage.value = `Experience Training is limited to ${experienceLimit.value} Pokémon for this trainer.`
      return
    }
    next.add(slug)
  }
  selectedExperienceSlugs.value = next
}

const applyExperienceTrainingToPokemon = (
  pokemon: CharacterSheet,
  gain: number,
) => {
  pokemon.combat ??= {}
  pokemon.combat.trainingExp = Math.max(0, pokemon.combat.trainingExp ?? 0) + gain

  const currentTotal = typeof pokemon.totalExp === 'number'
    ? Math.max(0, pokemon.totalExp)
    : pokemonExperienceNeededForLevel(pokemon.level ?? 1) ?? 0
  pokemon.totalExp = currentTotal + gain
  const levelFromExperience = calculatePokemonLevelFromExperience(pokemon.totalExp)
  if (levelFromExperience != null) pokemon.level = levelFromExperience
}

const savePokemonSheet = async (pokemon: CharacterSheet): Promise<CharacterSheet> => {
  const payload = toPersistableSheetPayload(pokemon)
  const profileContext = sheetApiProfileContext(isPlayer.value, selectedProfileId.value)
  const result = await postJson<SaveSheetResponse<CharacterSheet>>(SHEET_API_PATHS.save, buildSheetSaveBody({
    kind: 'pokemon',
    slug: pokemon.slug,
    sheet: payload,
    expectedRevision: normalizeRevision(pokemon.revision),
    clientId,
    profileContext,
    allowSlugSync: false,
  }))
  return result.sheet
}

const saveTrainerSheet = async (trainer: TrainerSheet): Promise<TrainerSheet> => {
  const payload = toPersistableSheetPayload(trainer)
  const profileContext = sheetApiProfileContext(isPlayer.value, selectedProfileId.value)
  const result = await postJson<SaveSheetResponse<TrainerSheet>>(SHEET_API_PATHS.save, buildSheetSaveBody({
    kind: 'trainer',
    slug: trainer.slug,
    sheet: payload,
    expectedRevision: normalizeRevision(trainer.revision),
    clientId,
    profileContext,
    allowSlugSync: false,
  }))
  return result.sheet
}

const applyTraining = async () => {
  if (!canApplyTraining.value || saving.value) return
  saving.value = true
  errorMessage.value = null
  statusMessage.value = null

  const selectedFeature = normalizePokemonTrainingFeatureName(selectedTrainingFeature.value)
  const trainingFeatureBySlug = new Map<string, string>()
  for (const row of selectedRowsWithSheets.value) {
    const feature = normalizePokemonTrainingFeatureName(row.selectedTrainingFeature)
    if (feature) trainingFeatureBySlug.set(row.slug, feature)
  }
  const aceTrainerStatBySlug = new Map<string, AceTrainerStatKey>()
  if (canApplyAceTrainerStat.value && applyAceTrainerStat.value) {
    for (const row of selectedRowsWithSheets.value) {
      const stat = normalizeAceTrainerStatKey(row.selectedAceTrainerStat)
      if (stat) aceTrainerStatBySlug.set(row.slug, stat)
    }
  }
  const experienceBySlug = new Map(selectedExperienceRows.value.map((row) => [row.slug, row.experienceGain]))
  const appliedExperienceTotal = [...experienceBySlug.values()].reduce((sum, gain) => sum + gain, 0)
  const shouldApplyFeature = trainingFeatureBySlug.size > 0
  const targetRows = selectedRowsWithSheets.value.filter((row) => (
    trainingFeatureBySlug.has(row.slug) || aceTrainerStatBySlug.has(row.slug) || experienceBySlug.has(row.slug)
  ))

  try {
    const savedSheets = await Promise.all(targetRows.map(async (row) => {
      const original = row.sheet!
      const updated = normalizeCharacterSheet(deepCloneJson(original))

      const rowTrainingFeature = trainingFeatureBySlug.get(row.slug)
      if (rowTrainingFeature) {
        updated.activeTrainingFeature = rowTrainingFeature
      }

      const rowAceTrainerStat = aceTrainerStatBySlug.get(row.slug)
      if (rowAceTrainerStat) {
        applyAceTrainerTrainedStat(updated, rowAceTrainerStat)
      }

      const experienceGain = experienceBySlug.get(row.slug)
      if (experienceGain) applyExperienceTrainingToPokemon(updated, experienceGain)

      const saved = await savePokemonSheet(updated)
      const runtimeFields = {
        folder: original.folder,
        playerProfileAccessible: original.playerProfileAccessible,
        sessionPlayerAccessible: original.sessionPlayerAccessible,
      }
      const normalizedSaved = normalizeCharacterSheet(deepCloneJson({ ...saved, ...runtimeFields }))
      livePokemonBySlug.value.set(normalizedSaved.slug, normalizedSaved)
      emit('pokemonUpdated', normalizedSaved)
      return normalizedSaved
    }))

    if (shouldApplyFeature && selectedFeature) {
      props.sheet.trainingFeature = selectedFeature
      const savedTrainer = await saveTrainerSheet(props.sheet)
      emit('trainerUpdated', { ...savedTrainer, folder: props.sheet.folder })
    }
    const aceTrainerSummary = aceTrainerStatBySlug.size ? `, set ${aceTrainerStatBySlug.size} Trained Stat${aceTrainerStatBySlug.size === 1 ? '' : 's'}` : ''
    statusMessage.value = `Trained ${savedSheets.length} Pokémon${aceTrainerSummary}${appliedExperienceTotal ? `, and awarded ${appliedExperienceTotal} EXP` : ''}.`
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    saving.value = false
  }
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="trainer-training-modal-backdrop" :style="trainerAccentStyle" @pointerdown.self="emit('close')">
      <section
        class="trainer-training-modal"
        :class="{ 'trainer-training-modal--with-sprite': sheet.portraitUrl }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        @pointerdown.stop
      >
        <aside v-if="sheet.portraitUrl" class="trainer-training-modal__sprite" aria-hidden="true">
          <img :src="sheet.portraitUrl" alt="" />
        </aside>
        <div class="trainer-training-modal__content">
          <header class="trainer-training-modal__header">
          <div>
            <h2 :id="titleId">Training · {{ sheet.name || 'Trainer' }}</h2>
          </div>
          <button type="button" class="trainer-training-modal__close" aria-label="Close" title="Close" @click="emit('close')">
            <PhX :size="18" weight="bold" aria-hidden="true" />
          </button>
        </header>

        <div v-if="canApplyAceTrainerStat" class="training-summary-grid">
          <div class="training-summary-card">
            <span class="summary-label">Ace Trainer</span>
            <strong>{{ applyAceTrainerStat ? aceTrainerStatLabel(selectedAceTrainerStat) : 'Off' }}</strong>
            <small>Choose one non-HP Trained Stat per selected Pokémon.</small>
          </div>
        </div>

        <section class="training-controls">
          <div v-if="canApplyAceTrainerStat" class="training-control-block training-control-block--ace">
            <label class="check-row">
              <input v-model="applyAceTrainerStat" type="checkbox" />
              <span>Apply Ace Trainer Trained Stats</span>
            </label>
            <label>
              Default stat
              <select v-model="selectedAceTrainerStat" :disabled="!applyAceTrainerStat || saving" title="Default Ace Trainer stat for newly selected Pokémon">
                <option v-for="option in ACE_TRAINER_STAT_OPTIONS" :key="option.key" :value="option.key">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <p class="feature-effect">
              Ace Trainer marks one stat besides HP as Trained and raises it to at least +1 Combat Stage until Extended Rest. Drain 1 AP manually.
            </p>
            <button
              type="button"
              class="training-control-inline-button"
              :disabled="!applyAceTrainerStat || !selectedSessionCount || saving"
              @click="setSelectedRowsToDefaultAceTrainerStat"
            >
              Set selected Pokémon to default stat
            </button>
          </div>

          <div class="training-control-block">
            <label>
              Training Skill
              <select v-model="experienceSkill" :disabled="saving">
                <option v-for="option in experienceSkillOptions" :key="option.key" :value="option.key">
                  {{ option.label }}
                </option>
              </select>
            </label>
          </div>

        </section>

        <section class="training-roster" :class="{ 'training-roster--ace': canApplyAceTrainerStat }" aria-label="Trainer Pokémon training targets">
          <div class="training-roster__head">
            <span>Pokémon</span>
            <span>Training Feature</span>
            <span v-if="canApplyAceTrainerStat">Ace Stat</span>
            <span>Session</span>
            <span>EXP ({{ selectedExperienceCount }}/{{ experienceLimit }})</span>
          </div>

          <div v-if="rosterRows.length" class="training-roster__rows">
            <article
              v-for="row in rosterRows"
              :key="row.slug"
              class="training-row"
              :class="{ 'training-row--missing': !row.sheet }"
            >
              <div class="training-row__pokemon">
                <span class="training-row__sprite">
                  <img v-if="row.spriteUrl" :src="row.spriteUrl" :alt="row.displayName" />
                  <span v-else>?</span>
                </span>
                <span>
                  <strong>{{ row.displayName }}</strong>
                  <small>{{ row.species }}<template v-if="row.level"> · Lv {{ row.level }}</template></small>
                </span>
              </div>
              <span class="training-row__feature-select">
                <select
                  :value="row.selectedTrainingFeature"
                  :disabled="!row.sheet || !row.selectedForSession || saving"
                  title="Training Feature for this Pokémon"
                  @change="setTrainingFeatureChoiceFromEvent(row.slug, $event)"
                >
                  <option value="">None</option>
                  <option v-for="name in trainingFeatureOptionsForRow(row)" :key="`${row.slug}-${name}`" :value="name">
                    {{ name }}<template v-if="trainerOwnedTrainingFeatures.has(name)"> · owned</template>
                  </option>
                </select>
              </span>
              <span v-if="canApplyAceTrainerStat" class="training-row__ace-stat">
                <select
                  :value="row.selectedAceTrainerStat"
                  :disabled="!row.sheet || !row.selectedForSession || !applyAceTrainerStat || saving"
                  @change="setAceTrainerStatForSlugFromEvent(row.slug, $event)"
                >
                  <option value="">No stat</option>
                  <option v-for="option in ACE_TRAINER_STAT_OPTIONS" :key="`${row.slug}-${option.key}`" :value="option.key">
                    {{ option.label }}
                  </option>
                </select>
              </span>
              <label class="training-row__toggle">
                <input
                  type="checkbox"
                  :checked="row.selectedForSession"
                  :disabled="!row.sheet || saving"
                  @change="toggleTrainingTarget(row.slug)"
                />
                <span>Train</span>
              </label>
              <label class="training-row__toggle">
                <input
                  type="checkbox"
                  :checked="row.selectedForExperience"
                  :disabled="!row.sheet || !row.selectedForSession || saving"
                  @change="toggleExperienceTarget(row.slug)"
                />
                <span>+{{ row.experienceGain }} EXP</span>
              </label>
            </article>
          </div>
          <p v-else class="training-empty-state">No team Pokémon. Add Pokémon to this trainer's team before training.</p>
        </section>

        <p v-if="errorMessage" class="training-message training-message--error">{{ errorMessage }}</p>
        <p v-else-if="statusMessage" class="training-message training-message--success">{{ statusMessage }}</p>

          <footer class="trainer-training-modal__footer">
            <button type="button" class="apply-button" :disabled="!canApplyTraining || saving" @click="applyTraining">
              {{ saving ? 'Applying…' : 'Apply Training' }}
            </button>
          </footer>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.trainer-training-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 82;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(10, 8, 6, 0.72);
  backdrop-filter: blur(8px);
}

.trainer-training-modal {
  width: min(860px, 100%);
  max-height: min(92vh, 860px);
  overflow: auto;
  border: 1px solid var(--rule);
  border-radius: 16px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
}

.trainer-training-modal--with-sprite {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  align-items: stretch;
  gap: 0.85rem;
}

.trainer-training-modal__sprite {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  align-self: stretch;
  min-height: 100%;
  margin: -0.95rem 0 -0.95rem -0.95rem;
  overflow: hidden;
  pointer-events: none;
}

.trainer-training-modal__sprite img {
  position: relative;
  z-index: 1;
  width: auto;
  height: calc(100% - 1rem);
  min-height: 100%;
  max-width: none;
  object-fit: contain;
  object-position: center bottom;
  image-rendering: pixelated;
  filter: drop-shadow(0 18px 18px rgba(5, 6, 8, 0.45));
}

.trainer-training-modal__content {
  min-width: 0;
}

.trainer-training-modal__header,
.trainer-training-modal__footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.trainer-training-modal__header {
  margin-bottom: 0.85rem;
}

.trainer-training-modal__header h2 {
  margin: 0.15rem 0 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.3rem;
}

.trainer-training-modal__close {
  display: inline-grid;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ink-bright);
  cursor: pointer;
  font: inherit;
  padding: 0;
}

.training-control-inline-button,
.apply-button {
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: var(--paper);
  color: var(--ink-bright);
  cursor: pointer;
  font: inherit;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 0.42rem 0.75rem;
}

.trainer-training-modal__close:hover,
.trainer-training-modal__close:focus-visible {
  color: var(--accent);
  background: transparent;
  outline: none;
}

.training-control-inline-button:hover:not(:disabled),
.training-control-inline-button:focus-visible:not(:disabled),
.apply-button:hover:not(:disabled),
.apply-button:focus-visible:not(:disabled) {
  border-color: var(--accent);
  background: rgba(var(--accent-rgb), 0.16);
  outline: none;
}

.training-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.65rem;
  margin-bottom: 0.85rem;
}

.training-summary-card,
.training-control-block,
.training-roster {
  border: 1px solid var(--rule-soft);
  border-radius: 14px;
  background: var(--paper-inset);
}

.training-summary-card {
  padding: 0.7rem 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.summary-label {
  color: var(--ink-muted);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.training-summary-card strong {
  color: var(--ink-bright);
  font-size: 1.15rem;
}

.training-summary-card small,
.feature-effect,
.training-row small {
  color: var(--ink-muted);
  font-size: 0.78rem;
  line-height: 1.35;
}

.training-controls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.65rem;
  margin-bottom: 0.85rem;
}

.training-control-block {
  padding: 0.75rem;
}

.training-control-block label,
.check-row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  color: var(--ink-bright);
  font-size: 0.82rem;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.check-row {
  flex-direction: row;
  align-items: center;
}

.check-row input,
.training-row__toggle input {
  accent-color: var(--accent);
}

.training-control-block select {
  width: 100%;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink-bright);
  padding: 0.45rem 0.55rem;
  font: inherit;
}

.feature-effect {
  margin: 0;
}

.training-control-inline-button:disabled,
.apply-button:disabled,
.training-control-block select:disabled,
.training-row__feature-select select:disabled,
.training-row__ace-stat select:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.training-roster {
  overflow: hidden;
}

.training-roster__head,
.training-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.3fr) minmax(150px, 0.85fr) 92px 116px;
  align-items: center;
  gap: 0.6rem;
}

.training-roster--ace .training-roster__head,
.training-roster--ace .training-row {
  grid-template-columns: minmax(200px, 1.25fr) minmax(140px, 0.82fr) minmax(120px, 0.72fr) 84px 110px;
}

.training-roster__head {
  padding: 0.55rem 0.75rem;
  color: var(--ink-muted);
  background: rgba(255, 255, 255, 0.06);
  border-bottom: 1px solid var(--rule-soft);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.training-row {
  padding: 0.55rem 0.75rem;
  border-bottom: 1px dashed var(--rule-soft);
}

.training-row:last-child {
  border-bottom: 0;
}

.training-row--missing {
  opacity: 0.62;
}

.training-row__pokemon {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 0.55rem;
}

.training-row__pokemon strong,
.training-row__pokemon small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.training-row__pokemon strong {
  color: var(--ink-bright);
}

.training-row__sprite {
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: radial-gradient(circle at center, var(--paper-hover), var(--paper));
  color: var(--ink-faint);
  overflow: hidden;
}

.training-row__sprite img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  padding: 3px;
}

.training-row__feature-select select,
.training-row__ace-stat select {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--rule-soft);
  border-radius: 10px;
  background: var(--paper);
  color: var(--ink-bright);
  padding: 0.36rem 0.45rem;
  font: inherit;
  font-size: 0.78rem;
}

.training-row__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--ink-soft);
  font-size: 0.8rem;
  font-weight: 800;
}

.training-empty-state {
  margin: 0;
  padding: 1rem;
  color: var(--ink-muted);
  text-align: center;
}

.training-message {
  margin: 0.75rem 0 0;
  border: 1px solid var(--rule-soft);
  border-radius: 12px;
  padding: 0.55rem 0.7rem;
  font-size: 0.86rem;
}

.training-message--error {
  border-color: rgba(220, 80, 80, 0.45);
  color: var(--bad);
  background: rgba(220, 80, 80, 0.08);
}

.training-message--success {
  border-color: rgba(var(--accent-rgb), 0.45);
  color: var(--ink-bright);
  background: rgba(var(--accent-rgb), 0.12);
}

.trainer-training-modal__footer {
  align-items: center;
  justify-content: flex-end;
  margin-top: 0.9rem;
  border-top: 1px solid var(--rule-soft);
  padding-top: 0.75rem;
}

.apply-button {
  flex: 0 0 auto;
  border-color: color-mix(in srgb, var(--accent) 60%, var(--rule-soft));
  background: rgba(var(--accent-rgb), 0.16);
}

@media (max-width: 860px) {
  .trainer-training-modal--with-sprite {
    display: block;
  }

  .trainer-training-modal__sprite {
    display: none;
  }

  .trainer-training-modal__header,
  .trainer-training-modal__footer {
    flex-direction: column;
  }

  .training-summary-grid,
  .training-controls {
    grid-template-columns: 1fr;
  }

  .training-roster__head {
    display: none;
  }

  .training-row {
    grid-template-columns: 1fr;
    align-items: start;
  }
}
</style>
