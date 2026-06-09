<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getSpriteUrl } from '~~/data/characterSheets'
import { getClientId } from '~/utils/clientId'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import { deepCloneJson } from '~/utils/serialization'
import { buildSheetSaveBody, sheetApiProfileContext } from '~/utils/sheetApiRequests'
import { toPersistableSheetPayload } from '~/utils/sheets/persistence'
import { POKEMON_EXPERIENCE_CHART, calculatePokemonLevelFromExperience } from '~/utils/sheets/pokemonExperience'
import {
  POKEMON_TRAINING_FEATURE_OPTIONS,
  normalizePokemonTrainingFeatureName,
  resolvePokemonTrainingFeatureEffects,
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
  trainerCanSelectPerPokemonTrainingFeatures,
  trainerExperienceTrainingLimit,
  trainerHasEdgeNamed,
  trainerOwnedPokemonTrainingFeatures,
  trainerSkillRankNameForTraining,
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

type RosterKind = 'team' | 'box'

interface TrainingRosterRow {
  slug: string
  roster: RosterKind
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
const applyTrainingFeature = ref(true)
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

const boxedSlugs = computed(() => {
  const team = new Set(normalizePokemonSlugList(props.sheet.currentTeam))
  return normalizePokemonSlugList(props.sheet.boxedPokemon).filter((slug) => !team.has(slug))
})

const rosterEntries = computed(() => [
  ...teamSlugs.value.map((slug) => ({ slug, roster: 'team' as const })),
  ...boxedSlugs.value.map((slug) => ({ slug, roster: 'box' as const })),
])

const rosterSlugs = computed(() => rosterEntries.value.map((entry) => entry.slug))

const trainerOwnedTrainingFeatures = computed(() => trainerOwnedPokemonTrainingFeatures(props.sheet))

const trainingFeatureOptions = computed(() => {
  const owned = trainerOwnedTrainingFeatures.value
  const ownedOptions = POKEMON_TRAINING_FEATURE_OPTIONS.filter((name) => owned.has(name))
  return ownedOptions.length ? ownedOptions : POKEMON_TRAINING_FEATURE_OPTIONS
})

const selectedTrainingFeatureEffects = computed(() =>
  resolvePokemonTrainingFeatureEffects(selectedTrainingFeature.value),
)
const canSelectPerPokemonTrainingFeatures = computed(() => trainerCanSelectPerPokemonTrainingFeatures(props.sheet))
const canApplyAceTrainerStat = computed(() => trainerCanApplyAceTrainerTraining(props.sheet))

const initialTrainingFeature = () => {
  const savedDefault = normalizePokemonTrainingFeatureName(props.sheet.trainingFeature)
  if (savedDefault) return savedDefault
  return trainingFeatureOptions.value[0] ?? ''
}

const selectedTrainingFeatureForSlug = (slug: string): string => {
  if (!canSelectPerPokemonTrainingFeatures.value) {
    return normalizePokemonTrainingFeatureName(selectedTrainingFeature.value) ?? ''
  }
  if (Object.prototype.hasOwnProperty.call(selectedTrainingFeatureBySlug.value, slug)) {
    return normalizePokemonTrainingFeatureName(selectedTrainingFeatureBySlug.value[slug]) ?? ''
  }
  return normalizePokemonTrainingFeatureName(selectedTrainingFeature.value) ?? ''
}

const setTrainingFeatureForSlug = (slug: string, value: unknown): void => {
  const normalized = normalizePokemonTrainingFeatureName(value)
  selectedTrainingFeatureBySlug.value = {
    ...selectedTrainingFeatureBySlug.value,
    [slug]: normalized ?? '',
  }
}

const setTrainingFeatureForSlugFromEvent = (slug: string, event: Event): void => {
  const target = event.target
  if (!(target instanceof HTMLSelectElement)) return
  setTrainingFeatureForSlug(slug, target.value)
}

const ensureTrainingFeatureChoices = (slugs: readonly string[]): void => {
  const next = { ...selectedTrainingFeatureBySlug.value }
  const fallback = normalizePokemonTrainingFeatureName(selectedTrainingFeature.value) ?? initialTrainingFeature()
  for (const slug of slugs) {
    const current = normalizePokemonTrainingFeatureName(next[slug])
    if (!current) next[slug] = fallback
  }
  selectedTrainingFeatureBySlug.value = next
}

const setSelectedRowsToDefaultTrainingFeature = (): void => {
  const normalized = normalizePokemonTrainingFeatureName(selectedTrainingFeature.value)
  if (!normalized) return
  const next = { ...selectedTrainingFeatureBySlug.value }
  for (const slug of selectedTrainingSlugs.value) next[slug] = normalized
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
const experienceRankName = computed(() => trainerSkillRankNameForTraining(props.sheet, experienceSkill.value))
const selectedSessionCount = computed(() => selectedTrainingSlugs.value.size)
const selectedExperienceCount = computed(() => selectedExperienceSlugs.value.size)

const rosterRows = computed<TrainingRosterRow[]>(() => rosterEntries.value.map(({ slug, roster }) => {
  const pokemon = availablePokemonBySlug.value.get(slug) ?? null
  const level = pokemon?.level ?? null
  return {
    slug,
    roster,
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
    (applyTrainingFeature.value && selectedRowsWithTrainingFeature.value.length > 0) ||
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

const setSelectedTrainingSlugs = (slugs: readonly string[]) => {
  const selected = slugs.slice(0, TRAINING_SESSION_TARGET_LIMIT)
  selectedTrainingSlugs.value = new Set(selected)
  selectedExperienceSlugs.value = new Set([...selectedExperienceSlugs.value].filter((slug) => selectedTrainingSlugs.value.has(slug)))
  ensureTrainingFeatureChoices(selected)
  ensureAceTrainerStatChoices(selected)
}

const selectTeam = () => setSelectedTrainingSlugs(teamSlugs.value)
const selectFirstSix = () => setSelectedTrainingSlugs(rosterSlugs.value)
const clearSelection = () => {
  selectedTrainingSlugs.value = new Set()
  selectedExperienceSlugs.value = new Set()
}

const selectExperienceFirst = () => {
  selectedExperienceSlugs.value = new Set([...selectedTrainingSlugs.value].slice(0, experienceLimit.value))
}

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

const expNeededForLevel = (level: number): number => {
  const normalizedLevel = Math.min(100, Math.max(1, Math.floor(level)))
  return [...POKEMON_EXPERIENCE_CHART]
    .reverse()
    .find((entry) => entry.level <= normalizedLevel)?.expNeeded ?? 0
}

const applyExperienceTrainingToPokemon = (
  pokemon: CharacterSheet,
  gain: number,
) => {
  pokemon.combat ??= {}
  pokemon.combat.trainingExp = Math.max(0, pokemon.combat.trainingExp ?? 0) + gain

  const currentTotal = typeof pokemon.totalExp === 'number'
    ? Math.max(0, pokemon.totalExp)
    : expNeededForLevel(pokemon.level ?? 1)
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
  if (applyTrainingFeature.value) {
    for (const row of selectedRowsWithSheets.value) {
      const feature = normalizePokemonTrainingFeatureName(row.selectedTrainingFeature)
      if (feature) trainingFeatureBySlug.set(row.slug, feature)
    }
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
    <div class="trainer-training-modal-backdrop" @pointerdown.self="emit('close')">
      <section
        class="trainer-training-modal"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        @pointerdown.stop
      >
        <header class="trainer-training-modal__header">
          <div>
            <p class="trainer-training-modal__eyebrow">PTU downtime training</p>
            <h2 :id="titleId">Training · {{ sheet.name || 'Trainer' }}</h2>
            <p class="trainer-training-modal__subtitle">
              One hour trains up to 6 Pokémon. Experience Training is capped by trainer rank.
            </p>
          </div>
          <button type="button" class="trainer-training-modal__close" @click="emit('close')">
            Close
          </button>
        </header>

        <div class="training-summary-grid">
          <div class="training-summary-card">
            <span class="summary-label">Session targets</span>
            <strong>{{ selectedSessionCount }}/{{ TRAINING_SESSION_TARGET_LIMIT }}</strong>
            <small>Pokémon affected by the hour-long session.</small>
          </div>
          <div class="training-summary-card">
            <span class="summary-label">Experience Training</span>
            <strong>{{ selectedExperienceCount }}/{{ experienceLimit }}</strong>
            <small>{{ TRAINING_SKILL_LABELS[experienceSkill] }} {{ experienceRankName }} rank.</small>
          </div>
          <div class="training-summary-card">
            <span class="summary-label">Default Feature</span>
            <strong>{{ selectedTrainingFeature || 'None' }}</strong>
            <small v-if="canSelectPerPokemonTrainingFeatures">Each Pokémon row can override this default.</small>
            <small v-else>Applied to all selected Pokémon unless a feature permits per-Pokémon choices.</small>
          </div>
          <div v-if="canApplyAceTrainerStat" class="training-summary-card">
            <span class="summary-label">Ace Trainer</span>
            <strong>{{ applyAceTrainerStat ? aceTrainerStatLabel(selectedAceTrainerStat) : 'Off' }}</strong>
            <small>Choose one non-HP Trained Stat per selected Pokémon.</small>
          </div>
        </div>

        <section class="training-controls">
          <div class="training-control-block training-control-block--feature">
            <label class="check-row">
              <input v-model="applyTrainingFeature" type="checkbox" />
              <span>Apply Training Features</span>
            </label>
            <select v-model="selectedTrainingFeature" :disabled="!applyTrainingFeature || saving" title="Default Training Feature for newly selected Pokémon">
              <option value="">No Feature</option>
              <option v-for="name in trainingFeatureOptions" :key="name" :value="name">
                {{ name }}<template v-if="trainerOwnedTrainingFeatures.has(name)"> · owned</template>
              </option>
            </select>
            <p v-if="selectedTrainingFeatureEffects" class="feature-effect">
              <strong>{{ selectedTrainingFeatureEffects.stateName }}:</strong>
              {{ selectedTrainingFeatureEffects.reference?.effect ?? 'Training bonus is applied to selected Pokémon.' }}
            </p>
            <button
              v-if="canSelectPerPokemonTrainingFeatures"
              type="button"
              class="training-control-inline-button"
              :disabled="!applyTrainingFeature || !selectedSessionCount || saving"
              @click="setSelectedRowsToDefaultTrainingFeature"
            >
              Set selected Pokémon to default
            </button>
            <p v-else class="feature-effect">
              Per-Pokémon Training Feature choices require Elite Trainer.
            </p>
          </div>

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
              Experience rank source
              <select v-model="experienceSkill" :disabled="saving">
                <option v-for="option in experienceSkillOptions" :key="option.key" :value="option.key">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <p class="feature-effect">
              EXP per selected Pokémon: half its level + rank bonus.
              <template v-if="trainerHasEdgeNamed(sheet, 'Train the Reserves')"> Train the Reserves is included.</template>
              <template v-if="trainerHasEdgeNamed(sheet, 'Trainer of Champions')"> Trainer of Champions adds +5.</template>
            </p>
          </div>

          <div class="training-actions-row">
            <button type="button" @click="selectTeam" :disabled="saving">Select team</button>
            <button type="button" @click="selectFirstSix" :disabled="saving">Select first 6</button>
            <button type="button" @click="selectExperienceFirst" :disabled="saving || !selectedSessionCount">EXP first eligible</button>
            <button type="button" @click="clearSelection" :disabled="saving">Clear</button>
          </div>
        </section>

        <section class="training-roster" :class="{ 'training-roster--ace': canApplyAceTrainerStat }" aria-label="Trainer Pokémon training targets">
          <div class="training-roster__head">
            <span>Pokémon</span>
            <span>Roster</span>
            <span>Current Training</span>
            <span>New Feature</span>
            <span v-if="canApplyAceTrainerStat">Ace Stat</span>
            <span>Session</span>
            <span>EXP</span>
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
              <span class="training-row__badge">{{ row.roster === 'team' ? 'Team' : 'Box' }}</span>
              <span class="training-row__muted">
                {{ row.activeTrainingFeature || '—' }}
                <small v-if="canApplyAceTrainerStat && row.trainedStat">Trained {{ aceTrainerStatLabel(row.trainedStat) }}</small>
                <small v-if="row.totalExp != null">Total EXP {{ row.totalExp }}</small>
                <small v-if="row.trainingExp">Training EXP {{ row.trainingExp }}</small>
              </span>
              <span class="training-row__feature-select">
                <select
                  v-if="canSelectPerPokemonTrainingFeatures"
                  :value="row.selectedTrainingFeature"
                  :disabled="!row.sheet || !row.selectedForSession || !applyTrainingFeature || saving"
                  @change="setTrainingFeatureForSlugFromEvent(row.slug, $event)"
                >
                  <option value="">No Feature</option>
                  <option v-for="name in trainingFeatureOptions" :key="`${row.slug}-${name}`" :value="name">
                    {{ name }}
                  </option>
                </select>
                <span v-else class="training-row__feature-locked">
                  {{ applyTrainingFeature && selectedTrainingFeature ? selectedTrainingFeature : '—' }}
                </span>
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
          <p v-else class="training-empty-state">No linked Pokémon. Add Pokémon to this trainer before training.</p>
        </section>

        <p v-if="errorMessage" class="training-message training-message--error">{{ errorMessage }}</p>
        <p v-else-if="statusMessage" class="training-message training-message--success">{{ statusMessage }}</p>

        <footer class="trainer-training-modal__footer">
          <p>
            Note: the modal enforces the session size and daily EXP cap, but it does not track whether a Pokémon already received Experience Training today.
          </p>
          <button type="button" class="apply-button" :disabled="!canApplyTraining || saving" @click="applyTraining">
            {{ saving ? 'Applying…' : 'Apply Training' }}
          </button>
        </footer>
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
  width: min(1100px, 100%);
  max-height: min(92vh, 860px);
  overflow: auto;
  border: 1px solid var(--rule);
  border-radius: 16px;
  background: var(--paper-soft);
  box-shadow: var(--shadow-card);
  padding: 0.95rem;
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

.trainer-training-modal__eyebrow,
.trainer-training-modal__subtitle {
  margin: 0;
  color: var(--ink-muted);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.trainer-training-modal__subtitle {
  margin-top: 0.25rem;
  color: var(--ink-soft);
  letter-spacing: 0.02em;
  text-transform: none;
}

.trainer-training-modal__header h2 {
  margin: 0.15rem 0 0;
  color: var(--ink-bright);
  font-family: var(--font-book);
  font-size: 1.3rem;
}

.trainer-training-modal__close,
.training-actions-row button,
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
.trainer-training-modal__close:focus-visible,
.training-actions-row button:hover:not(:disabled),
.training-actions-row button:focus-visible:not(:disabled),
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
.trainer-training-modal__footer p,
.training-row small,
.training-row__muted {
  color: var(--ink-muted);
  font-size: 0.78rem;
  line-height: 1.35;
}

.training-controls {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(220px, 0.8fr);
  gap: 0.65rem;
  margin-bottom: 0.85rem;
}

.training-control-block {
  padding: 0.75rem;
}

.training-control-block--feature {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
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

.training-actions-row {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.training-actions-row button:disabled,
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
  grid-template-columns: minmax(220px, 1.3fr) 84px minmax(150px, 0.9fr) minmax(150px, 0.85fr) 92px 116px;
  align-items: center;
  gap: 0.6rem;
}

.training-roster--ace .training-roster__head,
.training-roster--ace .training-row {
  grid-template-columns: minmax(200px, 1.25fr) 76px minmax(140px, 0.82fr) minmax(140px, 0.82fr) minmax(120px, 0.72fr) 84px 110px;
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
.training-row__pokemon small,
.training-row__muted small {
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

.training-row__badge {
  justify-self: start;
  border: 1px solid var(--rule-soft);
  border-radius: 999px;
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent);
  padding: 0.16rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.training-row__feature-select select,
.training-row__feature-locked,
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

.training-row__feature-locked {
  display: inline-block;
  color: var(--ink-muted);
  background: rgba(5, 6, 8, 0.18);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  margin-top: 0.9rem;
  border-top: 1px solid var(--rule-soft);
  padding-top: 0.75rem;
}

.trainer-training-modal__footer p {
  margin: 0;
}

.apply-button {
  flex: 0 0 auto;
  border-color: color-mix(in srgb, var(--accent) 60%, var(--rule-soft));
  background: rgba(var(--accent-rgb), 0.16);
}

@media (max-width: 860px) {
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
