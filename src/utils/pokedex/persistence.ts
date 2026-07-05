import type { PokedexRecord } from '~/types/pokemon'

export const POKEDEX_RUNTIME_ENTRY_KEYS = [
  'id',
  'slug',
  'nationalDexNumber',
  'spriteUrl',
  'profileSpriteUrl',
  'spriteVisualBounds',
  'backSpriteVisualBounds',
  'searchText',
  'searchTexts',
] as const

const RUNTIME_ENTRY_KEY_SET = new Set<string>(POKEDEX_RUNTIME_ENTRY_KEYS)

export const withoutPokedexRuntimeFields = (
  entry: Record<string, unknown>,
): Record<string, unknown> => Object.fromEntries(
  Object.entries(entry).filter(([key]) => !RUNTIME_ENTRY_KEY_SET.has(key)),
)

export const toEditablePokedexRecord = (
  entry: Record<string, unknown> | null | undefined,
): PokedexRecord | null => {
  if (!entry) return null

  return JSON.parse(JSON.stringify(withoutPokedexRuntimeFields(entry))) as PokedexRecord
}
