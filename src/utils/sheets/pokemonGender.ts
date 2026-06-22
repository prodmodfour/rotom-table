import type { PokedexRecord } from '~/types/pokemon'

export const POKEMON_GENDER_OPTIONS = ['Male', 'Female', 'Genderless'] as const
export type PokemonGender = typeof POKEMON_GENDER_OPTIONS[number]

export type PokemonGenderPokedexFields = Pick<PokedexRecord, 'genderless' | 'male_pct' | 'female_pct'>

const POKEMON_BINARY_GENDER_OPTIONS = ['Male', 'Female'] as const satisfies readonly PokemonGender[]
const POKEMON_MALE_ONLY_GENDER_OPTIONS = ['Male'] as const satisfies readonly PokemonGender[]
const POKEMON_FEMALE_ONLY_GENDER_OPTIONS = ['Female'] as const satisfies readonly PokemonGender[]
const POKEMON_GENDERLESS_ONLY_OPTIONS = ['Genderless'] as const satisfies readonly PokemonGender[]

const numericPercent = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, value))
}

const inferComplementPercent = (knownPercent: number | null): number | null => (
  knownPercent == null ? null : 100 - knownPercent
)

export const normalizePokemonGender = (value: unknown): PokemonGender | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()

  if (['m', 'male', 'man', 'boy', '♂'].includes(normalized)) return 'Male'
  if (['f', 'female', 'woman', 'girl', '♀'].includes(normalized)) return 'Female'
  if (['g', 'genderless', 'sexless', 'none'].includes(normalized)) return 'Genderless'

  return null
}

export const pokemonGenderOptionsForPokedexEntry = (
  entry: PokemonGenderPokedexFields | null | undefined,
): readonly PokemonGender[] => {
  if (!entry) return POKEMON_GENDER_OPTIONS
  if (entry.genderless) return POKEMON_GENDERLESS_ONLY_OPTIONS

  const explicitMalePercent = numericPercent(entry.male_pct)
  const explicitFemalePercent = numericPercent(entry.female_pct)

  const malePercent = explicitMalePercent ?? inferComplementPercent(explicitFemalePercent)
  const femalePercent = explicitFemalePercent ?? inferComplementPercent(explicitMalePercent)

  if (malePercent == null && femalePercent == null) return POKEMON_BINARY_GENDER_OPTIONS

  const canBeMale = (malePercent ?? 0) > 0
  const canBeFemale = (femalePercent ?? 0) > 0

  if (canBeMale && canBeFemale) return POKEMON_BINARY_GENDER_OPTIONS
  if (canBeMale) return POKEMON_MALE_ONLY_GENDER_OPTIONS
  if (canBeFemale) return POKEMON_FEMALE_ONLY_GENDER_OPTIONS

  return POKEMON_BINARY_GENDER_OPTIONS
}

export const coercePokemonGenderForOptions = (
  value: unknown,
  options: readonly PokemonGender[],
): PokemonGender => {
  const fallback = options[0] ?? POKEMON_GENDER_OPTIONS[0]
  const normalized = normalizePokemonGender(value)
  return normalized && options.includes(normalized) ? normalized : fallback
}

export const coercePokemonGenderForPokedexEntry = (
  value: unknown,
  entry: PokemonGenderPokedexFields | null | undefined,
): PokemonGender => coercePokemonGenderForOptions(value, pokemonGenderOptionsForPokedexEntry(entry))

export interface PokemonGenderTarget {
  gender?: string | null
}

export const syncPokemonGenderForPokedexEntry = (
  target: PokemonGenderTarget,
  entry: PokemonGenderPokedexFields | null | undefined,
): PokemonGender => {
  const gender = coercePokemonGenderForPokedexEntry(target.gender, entry)
  if (target.gender !== gender) target.gender = gender
  return gender
}
