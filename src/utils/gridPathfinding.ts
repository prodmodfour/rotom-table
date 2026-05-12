import type { GridAnchor, GridDimensions } from '~/types/pokemon'
import {
  getAnchorKey,
  isAnchorWithinBounds,
  type GridFootprint,
  type PositionedGridFootprint,
} from './gridGeometry'
import { canPlacePokemon } from './gridPlacement'

const DIRECTIONS: GridAnchor[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
]

export const findPathForPokemon = (
  pokemon: GridFootprint,
  start: GridAnchor,
  goal: GridAnchor,
  pokemons: PositionedGridFootprint[],
  dimensions: GridDimensions,
  exceptId?: string | null,
  occupiedKeys?: ReadonlySet<string>,
) => {
  if (!isAnchorWithinBounds(start, pokemon, dimensions)) {
    return null
  }

  if (!canPlacePokemon(pokemon, goal, pokemons, dimensions, exceptId, occupiedKeys)) {
    return null
  }

  const queue: GridAnchor[] = [start]
  const visited = new Set<string>([getAnchorKey(start)])
  const cameFrom = new Map<string, GridAnchor | null>([[getAnchorKey(start), null]])

  while (queue.length > 0) {
    const current = queue.shift()!

    if (current.x === goal.x && current.y === goal.y && current.z === goal.z) {
      break
    }

    for (const direction of DIRECTIONS) {
      const next = {
        x: current.x + direction.x,
        y: current.y + direction.y,
        z: current.z + direction.z,
      }
      const nextKey = getAnchorKey(next)

      if (visited.has(nextKey)) {
        continue
      }

      if (!canPlacePokemon(pokemon, next, pokemons, dimensions, exceptId, occupiedKeys)) {
        continue
      }

      visited.add(nextKey)
      cameFrom.set(nextKey, current)
      queue.push(next)
    }
  }

  if (!cameFrom.has(getAnchorKey(goal))) {
    return null
  }

  const path: GridAnchor[] = []
  let current: GridAnchor | null = goal

  while (current) {
    path.push(current)
    current = cameFrom.get(getAnchorKey(current)) ?? null
  }

  return path.reverse()
}
