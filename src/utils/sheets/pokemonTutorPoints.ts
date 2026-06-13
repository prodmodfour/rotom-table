import type { CharacterSheet } from '~/types/characterSheet'

const DEFAULT_POKEMON_LEVEL = 1
const TUTOR_POINT_LEVEL_INTERVAL = 5
const STARTING_TUTOR_POINTS = 1

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const wholePokemonLevel = (level: number | null | undefined): number =>
  Math.max(DEFAULT_POKEMON_LEVEL, Math.floor(finiteNumber(level) ?? DEFAULT_POKEMON_LEVEL))

/**
 * PTU Pokémon Tutor Points: 1 at hatching, plus 1 at Level 5 and each later
 * level divisible by 5.
 */
export const computePokemonTutorPointsEarned = (level: number | null | undefined): number =>
  STARTING_TUTOR_POINTS + Math.floor(wholePokemonLevel(level) / TUTOR_POINT_LEVEL_INTERVAL)

/** Keeps the legacy persisted cache aligned with the level-derived value. */
export const syncPokemonTutorPointsForSheet = (sheet: CharacterSheet): void => {
  if (!sheet.tutorPoints || typeof sheet.tutorPoints !== 'object' || Array.isArray(sheet.tutorPoints)) {
    sheet.tutorPoints = {}
  }
  sheet.tutorPoints.earned = computePokemonTutorPointsEarned(sheet.level)
}
