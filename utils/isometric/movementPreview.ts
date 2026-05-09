import type { GridAnchor, GridDimensions, SpawnedPokemon } from '~/types/pokemon'
import type { PreviewState } from '~/utils/grid'

export const EMPTY_MOVE_PREVIEW: PreviewState = {
  position: null,
  reachable: false,
  pathLength: 0,
}

type MoveGridPoint = Pick<GridAnchor, 'x' | 'z'>

type MovePreviewPokemon = Pick<SpawnedPokemon, 'base' | 'clearance'>

const clampInt = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)))

export const getMovePreviewAnchor = ({
  point,
  pokemon,
  dimensions,
  yLevel,
}: {
  point: MoveGridPoint | null
  pokemon: MovePreviewPokemon
  dimensions: GridDimensions
  yLevel: number
}): GridAnchor | null => {
  if (!point) return null
  if (point.x < 0 || point.x > dimensions.x || point.z < 0 || point.z > dimensions.z) {
    return null
  }

  const maxX = dimensions.x - pokemon.base
  const maxY = dimensions.y - pokemon.clearance
  const maxZ = dimensions.z - pokemon.base
  if (maxX < 0 || maxY < 0 || maxZ < 0) return null

  return {
    x: clampInt(point.x - pokemon.base / 2, 0, maxX),
    y: clampInt(yLevel, 0, maxY),
    z: clampInt(point.z - pokemon.base / 2, 0, maxZ),
  }
}

export const getNextMovePreviewElevationAnchor = ({
  currentAnchor,
  pokemon,
  dimensions,
  deltaY,
}: {
  currentAnchor: GridAnchor
  pokemon: MovePreviewPokemon
  dimensions: GridDimensions
  deltaY: number
}): GridAnchor | null => {
  const maxY = dimensions.y - pokemon.clearance
  if (maxY < 0) return null

  const direction = deltaY < 0 ? 1 : -1
  const nextY = Math.min(maxY, Math.max(0, currentAnchor.y + direction))
  if (nextY === currentAnchor.y) return null

  return { ...currentAnchor, y: nextY }
}
