import type { GridAnchor, TabletopMap } from '~/types/map'
import type { PokemonTypeId } from '#shared/pokemonTypes'

export const AA071_FORECAST_TYPE_CAPABILITY_PREFIX = 'aa071.forecast.type.' as const
export const AA071_FOREST_LORD_ORIGIN_CAPABILITY = 'aa071.forest-lord.virtual-origin' as const
export const AA071_FOX_FIRE_WISP_CAPABILITY = 'aa071.fox-fire.wisp' as const

export const AA071_WEATHER_TYPE_BY_KIND = Object.freeze({
  sunny: 'fire',
  hail: 'ice',
  rainy: 'water',
  sandstorm: 'rock',
} satisfies Readonly<Record<'sunny' | 'hail' | 'rainy' | 'sandstorm', PokemonTypeId>>)

const cellKey = (cell: GridAnchor): string => `${cell.x}:${cell.y}:${cell.z}`
const normalizedTags = (tags: readonly string[] | undefined): ReadonlySet<string> => new Set(
  (tags ?? []).map(tag => tag.trim().toLowerCase()).filter(Boolean),
)

/** Forest Lord origins require an explicitly authored fully-grown tree voxel. */
export const isAa071FullyGrownTreeCell = (
  map: Pick<TabletopMap, 'voxels'>,
  cell: GridAnchor,
): boolean => {
  const key = cellKey(cell)
  return map.voxels.some((voxel) => {
    if (cellKey(voxel) !== key) return false
    const tags = normalizedTags(voxel.tags)
    return tags.has('fully-grown-tree') || (tags.has('tree') && tags.has('fully-grown'))
  })
}

export const aa071ForecastCapabilityId = (typeId: PokemonTypeId): string => (
  `${AA071_FORECAST_TYPE_CAPABILITY_PREFIX}${typeId}`
)

export const aa071ForewarnMoveCapabilityId = (canonicalMoveId: string): string => {
  const moveKey = canonicalMoveId.normalize('NFKD').replace(/[’']/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  return `aa071.forewarn.accuracy.${moveKey}`
}
