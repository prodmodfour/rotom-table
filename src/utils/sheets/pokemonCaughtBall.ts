import type { CharacterSheet } from '~/types/characterSheet'

export const DEFAULT_POKEMON_CAUGHT_BALL = 'Basic Ball'

export const normalizePokemonCaughtBallName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export const pokemonCaughtBallName = (
  sheet: Pick<CharacterSheet, 'caughtBall'> | null | undefined,
): string => normalizePokemonCaughtBallName(sheet?.caughtBall) ?? DEFAULT_POKEMON_CAUGHT_BALL

export const setPokemonCaughtBall = (
  sheet: Pick<CharacterSheet, 'caughtBall'>,
  pokeballName: unknown,
): void => {
  sheet.caughtBall = normalizePokemonCaughtBallName(pokeballName) ?? DEFAULT_POKEMON_CAUGHT_BALL
}
