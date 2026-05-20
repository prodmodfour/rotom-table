import { findFeature } from '~~/data/ptuReference'
import { formatSignedModifier } from '~/utils/evasion'
import { isConditionAdjustedMovementCapability } from '~/utils/sheetConditionEffects'
import type { PtuFeature } from '~/types/ptuReference'

export const POKEMON_TRAINING_FEATURE_NAMES = [
  'Agility Training',
  'Brutal Training',
  'Focused Training',
  'Inspired Training',
] as const

export type PokemonTrainingFeatureName = (typeof POKEMON_TRAINING_FEATURE_NAMES)[number]

export const POKEMON_TRAINING_FEATURE_OPTIONS: readonly string[] = POKEMON_TRAINING_FEATURE_NAMES

export interface PokemonTrainingFeatureEffects {
  featureName: PokemonTrainingFeatureName
  stateName: 'Agile' | 'Brutal' | 'Focused' | 'Inspired'
  reference: PtuFeature | null
  movementCapabilityBonus: number
  initiativeBonus: number
  accuracyRollBonus: number
  evasionBonus: number
  saveCheckBonus: number
  skillCheckBonus: number
  criticalHitRangeBonus: number
  effectRangeBonus: number
}

export interface PokemonTrainingFeatureMovementAdjustment {
  featureName: PokemonTrainingFeatureName
  movementCapabilityBonus: number
  adjustedValue: number
  displayValue: string
  title: string
}

type StaticPokemonTrainingFeatureEffects = Omit<PokemonTrainingFeatureEffects, 'featureName' | 'reference'>

const TRAINING_FEATURE_EFFECTS: Record<PokemonTrainingFeatureName, StaticPokemonTrainingFeatureEffects> = {
  'Agility Training': {
    stateName: 'Agile',
    movementCapabilityBonus: 1,
    initiativeBonus: 4,
    accuracyRollBonus: 0,
    evasionBonus: 0,
    saveCheckBonus: 0,
    skillCheckBonus: 0,
    criticalHitRangeBonus: 0,
    effectRangeBonus: 0,
  },
  'Brutal Training': {
    stateName: 'Brutal',
    movementCapabilityBonus: 0,
    initiativeBonus: 0,
    accuracyRollBonus: 0,
    evasionBonus: 0,
    saveCheckBonus: 0,
    skillCheckBonus: 0,
    criticalHitRangeBonus: 1,
    effectRangeBonus: 1,
  },
  'Focused Training': {
    stateName: 'Focused',
    movementCapabilityBonus: 0,
    initiativeBonus: 0,
    accuracyRollBonus: 1,
    evasionBonus: 0,
    saveCheckBonus: 0,
    skillCheckBonus: 2,
    criticalHitRangeBonus: 0,
    effectRangeBonus: 0,
  },
  'Inspired Training': {
    stateName: 'Inspired',
    movementCapabilityBonus: 0,
    initiativeBonus: 0,
    accuracyRollBonus: 0,
    evasionBonus: 1,
    saveCheckBonus: 2,
    skillCheckBonus: 0,
    criticalHitRangeBonus: 0,
    effectRangeBonus: 0,
  },
}

const normalizeNameKey = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase()

const TRAINING_FEATURE_BY_KEY = new Map<string, PokemonTrainingFeatureName>(
  POKEMON_TRAINING_FEATURE_NAMES.map((name) => [normalizeNameKey(name), name]),
)

const TRAINING_FEATURE_ALIASES: Record<string, PokemonTrainingFeatureName> = {
  agility: 'Agility Training',
  agile: 'Agility Training',
  brutal: 'Brutal Training',
  focus: 'Focused Training',
  focused: 'Focused Training',
  inspire: 'Inspired Training',
  inspired: 'Inspired Training',
}

export const normalizePokemonTrainingFeatureName = (value: unknown): PokemonTrainingFeatureName | null => {
  if (typeof value !== 'string') return null
  const key = normalizeNameKey(value)
  if (!key) return null
  return TRAINING_FEATURE_BY_KEY.get(key) ?? TRAINING_FEATURE_ALIASES[key] ?? null
}

const resolveStaticPokemonTrainingFeatureEffects = (
  value: unknown,
): (StaticPokemonTrainingFeatureEffects & { featureName: PokemonTrainingFeatureName }) | null => {
  const featureName = normalizePokemonTrainingFeatureName(value)
  if (!featureName) return null
  return {
    featureName,
    ...TRAINING_FEATURE_EFFECTS[featureName],
  }
}

export const resolvePokemonTrainingFeatureEffects = (
  value: unknown,
): PokemonTrainingFeatureEffects | null => {
  const effects = resolveStaticPokemonTrainingFeatureEffects(value)
  if (!effects) return null
  return {
    ...effects,
    reference: findFeature(effects.featureName),
  }
}

export const pokemonTrainingFeatureMovementCapabilityBonus = (value: unknown): number =>
  resolveStaticPokemonTrainingFeatureEffects(value)?.movementCapabilityBonus ?? 0

export const pokemonTrainingFeatureInitiativeBonus = (value: unknown): number =>
  resolveStaticPokemonTrainingFeatureEffects(value)?.initiativeBonus ?? 0

export const pokemonTrainingFeatureAccuracyRollBonus = (value: unknown): number =>
  resolveStaticPokemonTrainingFeatureEffects(value)?.accuracyRollBonus ?? 0

export const pokemonTrainingFeatureEvasionBonus = (value: unknown): number =>
  resolveStaticPokemonTrainingFeatureEffects(value)?.evasionBonus ?? 0

export const pokemonTrainingFeatureMovementCapabilityAdjustment = (
  label: string,
  value: number | string | null | undefined,
  trainingFeature: unknown,
): PokemonTrainingFeatureMovementAdjustment | null => {
  const effects = resolvePokemonTrainingFeatureEffects(trainingFeature)
  if (!effects?.movementCapabilityBonus || !isConditionAdjustedMovementCapability(label)) return null

  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return null

  const bonus = effects.movementCapabilityBonus
  const adjustedValue = Math.trunc(n) + bonus
  const displayValue = formatSignedModifier(bonus)
  return {
    featureName: effects.featureName,
    movementCapabilityBonus: bonus,
    adjustedValue,
    displayValue,
    title: `${effects.featureName} gives ${displayValue} to Movement Capabilities.`,
  }
}
