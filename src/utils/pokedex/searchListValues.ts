import type { PokedexRecord } from '~/types/pokemon'
import type { SearchBucketValue } from '~/utils/pokedex/searchBuckets'

export type PokedexListSearchValue = SearchBucketValue

interface ListAliasOptions {
  values: readonly string[] | null | undefined
  aggregateLabels: readonly string[]
  itemLabels: readonly string[]
}

const buildListAliases = ({
  values,
  aggregateLabels,
  itemLabels,
}: ListAliasOptions): PokedexListSearchValue[] => {
  if (!values?.length) return []

  const joinedValues = values.join(' ')
  const aliases: PokedexListSearchValue[] = [
    ...values,
    ...aggregateLabels.map((label) => `${label} ${joinedValues}`),
  ]

  for (const value of values) {
    for (const label of itemLabels) {
      aliases.push(`${label} ${value}`, `${value} ${label}`)
    }
  }

  return aliases
}

export const buildTypeSearchValues = (entry: Pick<PokedexRecord, 'types'>): PokedexListSearchValue[] => buildListAliases({
  values: entry.types,
  aggregateLabels: ['type', 'types'],
  itemLabels: ['type'],
})

export const buildHabitatSearchValues = (entry: Pick<PokedexRecord, 'habitat'>): PokedexListSearchValue[] => buildListAliases({
  values: entry.habitat,
  aggregateLabels: ['habitat', 'habitats'],
  itemLabels: ['habitat'],
})

export const buildDietSearchValues = (entry: Pick<PokedexRecord, 'diet'>): PokedexListSearchValue[] => buildListAliases({
  values: entry.diet,
  aggregateLabels: ['diet'],
  itemLabels: ['diet'],
})

export const buildEggGroupSearchValues = (
  eggGroups: readonly string[] | null | undefined,
): PokedexListSearchValue[] => buildListAliases({
  values: eggGroups,
  aggregateLabels: ['egg group'],
  itemLabels: ['egg group'],
})
