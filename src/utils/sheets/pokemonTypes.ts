import pokedexData from '~~/data/reference/pokedex.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { PokedexRecord } from '~/types/pokemon'

const pokedexTypesBySpecies = new Map<string, readonly string[]>(
  (pokedexData as PokedexRecord[]).map((entry) => [entry.species, entry.types ?? []]),
)

export const resolvePokemonSheetTypes = (
  sheet: Pick<CharacterSheet, 'species' | 'types'> | null | undefined,
): string[] => {
  if (!sheet) return []

  const sourceTypes = sheet.types ?? pokedexTypesBySpecies.get(sheet.species) ?? []
  const seen = new Set<string>()
  const resolvedTypes: string[] = []

  for (const sourceType of sourceTypes) {
    if (typeof sourceType !== 'string') continue
    const type = sourceType.trim()
    const key = type.toLowerCase()
    if (!type || seen.has(key)) continue
    seen.add(key)
    resolvedTypes.push(type)
  }

  return resolvedTypes
}
