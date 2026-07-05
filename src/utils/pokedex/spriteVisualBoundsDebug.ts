export const POKEDEX_SPRITE_VISUAL_BOUNDS_DEBUG_QUERY = 'spriteBoundsDebug'

type QueryScalar = string | null

type QueryValue = QueryScalar | readonly QueryScalar[] | undefined

type DebugQuery = Record<string, QueryValue>

const TRUE_DEBUG_VALUES = new Set(['', '1', 'true', 'yes', 'on'])

const firstQueryValue = (value: QueryValue): string | null => {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null
  return typeof value === 'string' ? value : null
}

export const isPokedexSpriteVisualBoundsDebugEnabled = (
  query: DebugQuery,
  isDevBuild: boolean,
): boolean => {
  if (!isDevBuild) return false

  const value = firstQueryValue(query[POKEDEX_SPRITE_VISUAL_BOUNDS_DEBUG_QUERY])
  return value != null && TRUE_DEBUG_VALUES.has(value.toLowerCase())
}
