import type { TabletopMap, MapHazardV2, MapVoxelV2, SheetPlacement } from '~/types/map'
import type { GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import { normalizeDimensions } from '~/utils/gridGeometry'
import { reconcilePokemonPositions } from '~/utils/gridPlacement'
import { clampMapGroundLevelY } from '~/utils/mapGroundLevel'
import { filterMapHazardsInBounds } from '~/utils/mapHazards'
import { filterVoxelsInBounds } from '~/utils/voxelOccupancy'

export interface MapDimensionReconciliationResult {
  dimensions: GridDimensions
  groundLevelY?: number
  voxels: MapVoxelV2[]
  hazards: MapHazardV2[]
  placements: SheetPlacement[]
  selectedPlacementRemoved: boolean
}

export const reconcileMapForDimensions = (options: {
  map: TabletopMap
  spawnedPokemon: readonly SpawnedPokemon[]
  selectedId?: string | null
}): MapDimensionReconciliationResult => {
  const dimensions = normalizeDimensions(options.map.dimensions)
  const voxels = filterVoxelsInBounds(options.map.voxels, dimensions)
  const hazards = filterMapHazardsInBounds(options.map.hazards ?? [], dimensions)
  const reconciliation = reconcilePokemonPositions(
    [...options.spawnedPokemon],
    dimensions,
    voxels,
    // Manual token placement is allowed to overlap terrain. Dimension
    // reconciliation should only fix out-of-bounds/token-overlap issues,
    // not eject characters a GM intentionally tucked into terrain blocks.
    new Set<string>(),
  )
  const byId = new Map(reconciliation.pokemons.map((pokemon) => [pokemon.id, pokemon.position]))
  const placements = options.map.placements.flatMap((placement) => {
    const next = byId.get(placement.id)
    if (!next) return []
    return [{ ...placement, position: next }]
  })

  return {
    dimensions,
    groundLevelY: options.map.groundLevelY === undefined
      ? undefined
      : clampMapGroundLevelY(dimensions, options.map.groundLevelY),
    voxels,
    hazards,
    placements,
    selectedPlacementRemoved: Boolean(
      options.selectedId && !placements.some((placement) => placement.id === options.selectedId),
    ),
  }
}
