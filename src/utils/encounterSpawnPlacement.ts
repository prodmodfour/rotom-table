import type { GridAnchor, GridDimensions } from '~/types/pokemon'
import type { MapVoxelV2 } from '~/types/map'
import type { MovementCapabilitySpeeds } from '~/types/movement'
import {
  footprintsOverlap,
  getClearanceValue,
  isAnchorWithinBounds,
  type GridFootprint,
  type PositionedGridFootprint,
} from '~/utils/gridGeometry'
import { getVoxelMaterialDefinition } from '~/utils/mapMaterials'
import {
  bestAerialMovementCapability,
  movementCapabilitySpeed,
} from '~/utils/movementCapabilities'
import {
  buildMapMovementTerrainIndex,
  movementTerrainForAnchor,
  type MapMovementTerrainIndex,
  type MovementAnchorTerrain,
  type MovementTerrainRequirement,
} from '~/utils/mapMovementTerrain'

export interface EncounterSpawnCandidate extends GridFootprint {
  movementCapabilities?: MovementCapabilitySpeeds | null
}

export interface EvaluatedEncounterSpawnAnchor {
  position: GridAnchor
  terrain: MovementAnchorTerrain
  water: boolean
}

export interface FindEncounterSpawnPositionOptions {
  candidate: EncounterSpawnCandidate
  placed: readonly PositionedGridFootprint[]
  dimensions: GridDimensions
  voxels?: readonly MapVoxelV2[] | null
  groundLevelY?: number
  random?: () => number
  terrainIndex?: MapMovementTerrainIndex
}

const terrainRequirementSupported = (
  requirement: MovementTerrainRequirement,
  terrain: MovementAnchorTerrain,
  capabilities: MovementCapabilitySpeeds | null | undefined,
): boolean => {
  if (requirement === 'aerial') {
    return bestAerialMovementCapability(capabilities, terrain.airHeight) !== null
  }

  return movementCapabilitySpeed(capabilities, requirement) != null
}

const terrainPrimaryMovementSupported = (
  terrain: MovementAnchorTerrain,
  capabilities: MovementCapabilitySpeeds | null | undefined,
): boolean => terrain.requirements.every((requirement) => terrainRequirementSupported(requirement, terrain, capabilities))

const terrainHoverMovementSupported = (
  terrain: MovementAnchorTerrain,
  capabilities: MovementCapabilitySpeeds | null | undefined,
): boolean => terrain.hoverable && bestAerialMovementCapability(capabilities, terrain.airHeight) !== null

export const spawnCandidateCanUseTerrain = (
  candidate: Pick<EncounterSpawnCandidate, 'movementCapabilities'>,
  terrain: MovementAnchorTerrain,
): boolean => {
  if (terrain.blocked) return false
  return terrainPrimaryMovementSupported(terrain, candidate.movementCapabilities) ||
    terrainHoverMovementSupported(terrain, candidate.movementCapabilities)
}

const anchorOverlapsPlacedFootprints = (
  candidate: GridFootprint,
  position: GridAnchor,
  placed: readonly PositionedGridFootprint[],
): boolean => placed.some((other) => footprintsOverlap(
  position,
  candidate.base,
  getClearanceValue(candidate),
  other.position,
  other.base,
  getClearanceValue(other),
))

const anchorCanFit = (
  candidate: GridFootprint,
  position: GridAnchor,
  dimensions: GridDimensions,
  placed: readonly PositionedGridFootprint[],
): boolean => isAnchorWithinBounds(position, candidate, dimensions) && !anchorOverlapsPlacedFootprints(candidate, position, placed)

const lowerTagsForVoxel = (voxel: MapVoxelV2): Set<string> => {
  const material = getVoxelMaterialDefinition(voxel)
  return new Set([...(material.tags ?? []), ...(voxel.tags ?? [])].map((tag) => tag.toLowerCase()))
}

const voxelIsWater = (voxel: MapVoxelV2 | null): boolean => Boolean(voxel && lowerTagsForVoxel(voxel).has('water'))

const footprintCellTouchesWater = (
  terrainIndex: MapMovementTerrainIndex,
  x: number,
  y: number,
  z: number,
): boolean => voxelIsWater(terrainIndex.voxelAt(x, y, z)) || voxelIsWater(terrainIndex.voxelAt(x, y - 1, z))

const footprintIsFullyInWater = (
  candidate: GridFootprint,
  position: GridAnchor,
  terrainIndex: MapMovementTerrainIndex,
): boolean => {
  const base = Math.max(1, Math.trunc(candidate.base))

  for (let z = position.z; z < position.z + base; z += 1) {
    for (let x = position.x; x < position.x + base; x += 1) {
      if (!footprintCellTouchesWater(terrainIndex, x, position.y, z)) return false
    }
  }

  return true
}

const randomArrayItem = <T>(items: readonly T[], random: () => number): T | null => {
  if (!items.length) return null
  const index = Math.min(items.length - 1, Math.max(0, Math.floor(random() * items.length)))
  return items[index] ?? null
}

export const swimPreferredOverland = (
  capabilities: MovementCapabilitySpeeds | null | undefined,
): boolean => {
  const swim = movementCapabilitySpeed(capabilities, 'swim') ?? 0
  const overland = movementCapabilitySpeed(capabilities, 'overland') ?? 0
  return swim > overland
}

export const evaluateEncounterSpawnAnchors = ({
  candidate,
  placed,
  dimensions,
  voxels,
  groundLevelY = 0,
  terrainIndex = buildMapMovementTerrainIndex(voxels),
}: Omit<FindEncounterSpawnPositionOptions, 'random'>): EvaluatedEncounterSpawnAnchor[] => {
  const anchors: EvaluatedEncounterSpawnAnchor[] = []
  const maxX = Math.floor(dimensions.x - candidate.base)
  const maxY = Math.floor(dimensions.y - getClearanceValue(candidate))
  const maxZ = Math.floor(dimensions.z - candidate.base)

  if (maxX < 0 || maxY < 0 || maxZ < 0) return anchors

  for (let y = 0; y <= maxY; y += 1) {
    for (let z = 0; z <= maxZ; z += 1) {
      for (let x = 0; x <= maxX; x += 1) {
        const position = { x, y, z }
        if (!anchorCanFit(candidate, position, dimensions, placed)) continue

        const terrain = movementTerrainForAnchor({
          anchor: position,
          footprint: candidate,
          terrain: terrainIndex,
          groundLevelY,
        })
        if (!spawnCandidateCanUseTerrain(candidate, terrain)) continue

        anchors.push({
          position,
          terrain,
          water: footprintIsFullyInWater(candidate, position, terrainIndex),
        })
      }
    }
  }

  return anchors
}

export const findEncounterSpawnPosition = (options: FindEncounterSpawnPositionOptions): GridAnchor | null => {
  const random = options.random ?? Math.random
  const anchors = evaluateEncounterSpawnAnchors(options)
  const waterAnchors = anchors.filter((anchor) => anchor.water)
  const pool = swimPreferredOverland(options.candidate.movementCapabilities) && waterAnchors.length > 0
    ? waterAnchors
    : anchors

  const selected = randomArrayItem(pool, random)
  return selected ? { ...selected.position } : null
}
