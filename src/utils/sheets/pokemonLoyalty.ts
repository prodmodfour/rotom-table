export const POKEMON_LOYALTY_MIN = 0
export const POKEMON_LOYALTY_MAX = 6

const LOYALTY_DAMAGE_BASE_MOVES = new Set(['return', 'frustration'])

const normalizeMoveName = (value: string | null | undefined): string =>
  String(value ?? '').trim().toLowerCase()

export const normalizePokemonLoyalty = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined

  const normalizedValue = typeof value === 'string' ? value.trim() : value
  if (normalizedValue === '') return undefined

  const numericValue = typeof normalizedValue === 'number' ? normalizedValue : Number(normalizedValue)
  if (!Number.isFinite(numericValue)) return undefined

  return Math.min(
    POKEMON_LOYALTY_MAX,
    Math.max(POKEMON_LOYALTY_MIN, Math.trunc(numericValue)),
  )
}

export const isPokemonLoyaltyDamageBaseMove = (moveName: string | null | undefined): boolean =>
  LOYALTY_DAMAGE_BASE_MOVES.has(normalizeMoveName(moveName))

export const pokemonLoyaltyDamageBase = (
  moveName: string | null | undefined,
  loyalty: unknown,
): number | null => {
  const normalizedLoyalty = normalizePokemonLoyalty(loyalty)
  if (normalizedLoyalty == null) return null

  switch (normalizeMoveName(moveName)) {
    case 'return':
      return 3 + normalizedLoyalty
    case 'frustration':
      return 9 - normalizedLoyalty
    default:
      return null
  }
}
