import type { SpawnedPokemon } from '~/types/pokemon'
import {
  calculatePokemonLevelFromExperience,
  pokemonExperienceNeededForLevel,
} from '~/utils/sheets/pokemonExperience'

export interface ExperienceDialogState {
  id: string
  species: string
  level: number
  totalExp: number
  hasTrackedTotalExp: boolean
  accentColor?: string
  amount: string
}

export interface ExperienceGrantUpdate {
  id: string
  amount: number
}

type ExperienceDialogPokemon = Pick<
  SpawnedPokemon,
  'id' | 'species' | 'level' | 'totalExp' | 'accentColor'
>

const normalizeExperienceLevel = (level: number | null | undefined): number => {
  if (typeof level !== 'number' || !Number.isFinite(level)) return 1
  return Math.min(100, Math.max(1, Math.floor(level)))
}

const parsePositiveInteger = (value: string): number => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed
}

const totalExpFromPokemon = (pokemon: ExperienceDialogPokemon): { totalExp: number; hasTrackedTotalExp: boolean } => {
  if (typeof pokemon.totalExp === 'number' && Number.isFinite(pokemon.totalExp)) {
    return { totalExp: Math.max(0, Math.floor(pokemon.totalExp)), hasTrackedTotalExp: true }
  }

  return {
    totalExp: pokemonExperienceNeededForLevel(pokemon.level) ?? 0,
    hasTrackedTotalExp: false,
  }
}

export const createExperienceDialogState = (pokemon: ExperienceDialogPokemon): ExperienceDialogState => {
  const experience = totalExpFromPokemon(pokemon)
  return {
    id: pokemon.id,
    species: pokemon.species,
    level: normalizeExperienceLevel(pokemon.level),
    totalExp: experience.totalExp,
    hasTrackedTotalExp: experience.hasTrackedTotalExp,
    ...(pokemon.accentColor ? { accentColor: pokemon.accentColor } : {}),
    amount: '',
  }
}

export const getExperienceDialogAmount = (dialog: ExperienceDialogState | null): number => (
  dialog ? parsePositiveInteger(dialog.amount) : 0
)

export const getExperienceDialogPreviewTotalExp = (dialog: ExperienceDialogState | null): number => (
  dialog ? dialog.totalExp + getExperienceDialogAmount(dialog) : 0
)

export const getExperienceDialogPreviewLevel = (dialog: ExperienceDialogState | null): number => {
  if (!dialog) return 1
  return calculatePokemonLevelFromExperience(getExperienceDialogPreviewTotalExp(dialog)) ?? dialog.level
}

export const getExperienceDialogGrantUpdate = (dialog: ExperienceDialogState | null): ExperienceGrantUpdate | null => {
  const amount = getExperienceDialogAmount(dialog)
  if (!dialog || amount <= 0) return null
  return { id: dialog.id, amount }
}

export const updateExperienceDialogFromPokemon = (
  dialog: ExperienceDialogState,
  pokemon: ExperienceDialogPokemon,
): ExperienceDialogState => {
  const experience = totalExpFromPokemon(pokemon)
  return {
    ...dialog,
    species: pokemon.species,
    level: normalizeExperienceLevel(pokemon.level),
    totalExp: experience.totalExp,
    hasTrackedTotalExp: experience.hasTrackedTotalExp,
    accentColor: pokemon.accentColor,
  }
}
