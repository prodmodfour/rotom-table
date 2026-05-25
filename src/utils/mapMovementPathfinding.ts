import type { GridAnchor, GridDimensions } from '~/types/pokemon'
import type { MapVoxelV2 } from '~/types/map'
import type { MovementCapabilityKey, MovementCapabilitySpeeds } from '~/types/movement'
import {
  bestAerialMovementCapability,
  highestShiftMovementSpeed,
  mixedMovementCapabilityLimit,
  movementCapabilityLabels,
  movementCapabilitySpeed,
} from '~/utils/movementCapabilities'
import {
  footprintsOverlap,
  getAnchorKey,
  getClearanceValue,
  isAnchorWithinBounds,
  type GridFootprint,
  type PositionedGridFootprint,
} from '~/utils/gridGeometry'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'
import {
  createMapMovementTerrainIndexCache,
  movementTerrainForAnchor,
  type MapMovementTerrainIndex,
  type MovementAnchorTerrain,
  type MovementTerrainRequirement,
} from '~/utils/mapMovementTerrain'

interface MovementPathState {
  anchor: GridAnchor
  cost: number
  diagonalParity: 0 | 1
  capabilityMask: number
}

interface QueuedMovementPathState extends MovementPathState {
  key: string
  priority: number
}

export interface MovementPathResult {
  path: GridAnchor[] | null
  distance: number
  movementLimit: number | null
  capabilityKeys: MovementCapabilityKey[]
  capabilityLabels: string[]
  capabilityLabel: string
  legal: boolean
  reason: 'legal' | 'same-position' | 'blocked' | 'missing-capability' | 'too-far'
}

interface AnchorMovementEvaluation {
  capabilityKeys: MovementCapabilityKey[]
  slow: boolean
}

const MOVEMENT_CAPABILITY_MASK_BITS: Record<MovementCapabilityKey, number> = {
  overland: 1 << 0,
  sky: 1 << 1,
  swim: 1 << 2,
  levitate: 1 << 3,
  burrow: 1 << 4,
  teleporter: 1 << 5,
}

const HORIZONTAL_DIRECTIONS: readonly GridAnchor[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
  { x: 1, y: 0, z: 1 },
  { x: 1, y: 0, z: -1 },
  { x: -1, y: 0, z: 1 },
  { x: -1, y: 0, z: -1 },
]

const VERTICAL_DIRECTIONS: readonly GridAnchor[] = [
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
]

const DIRECTIONS: readonly GridAnchor[] = [...HORIZONTAL_DIRECTIONS, ...VERTICAL_DIRECTIONS]

const movementTerrainIndexCache = createMapMovementTerrainIndexCache()

const sameAnchor = (left: GridAnchor, right: GridAnchor): boolean =>
  left.x === right.x && left.y === right.y && left.z === right.z

const stateKey = (anchor: GridAnchor, diagonalParity: 0 | 1, capabilityMask: number): string =>
  `${getAnchorKey(anchor)}|${diagonalParity}|${capabilityMask}`

const capabilityMaskForKeys = (keys: readonly MovementCapabilityKey[]): number =>
  keys.reduce((mask, key) => mask | MOVEMENT_CAPABILITY_MASK_BITS[key], 0)

const capabilityKeysForMask = (mask: number): MovementCapabilityKey[] =>
  (Object.keys(MOVEMENT_CAPABILITY_MASK_BITS) as MovementCapabilityKey[])
    .filter((key) => (mask & MOVEMENT_CAPABILITY_MASK_BITS[key]) !== 0)

const capabilitySummaryLabel = (keys: readonly MovementCapabilityKey[]): string => {
  if (!keys.length) return 'No movement'
  return movementCapabilityLabels(keys).join(keys.length > 2 ? ', ' : '/')
}

class MovementPriorityQueue {
  private heap: QueuedMovementPathState[] = []

  get size(): number {
    return this.heap.length
  }

  push(item: QueuedMovementPathState): void {
    this.heap.push(item)
    this.bubbleUp(this.heap.length - 1)
  }

  pop(): QueuedMovementPathState | null {
    const first = this.heap[0]
    if (!first) return null

    const last = this.heap.pop()!
    if (this.heap.length > 0) {
      this.heap[0] = last
      this.bubbleDown(0)
    }

    return first
  }

  private bubbleUp(index: number): void {
    let current = index
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2)
      if (this.heap[parent]!.priority <= this.heap[current]!.priority) return
      this.swap(parent, current)
      current = parent
    }
  }

  private bubbleDown(index: number): void {
    let current = index
    while (true) {
      const left = current * 2 + 1
      const right = left + 1
      let smallest = current

      if (this.heap[left] && this.heap[left]!.priority < this.heap[smallest]!.priority) smallest = left
      if (this.heap[right] && this.heap[right]!.priority < this.heap[smallest]!.priority) smallest = right
      if (smallest === current) return

      this.swap(current, smallest)
      current = smallest
    }
  }

  private swap(left: number, right: number): void {
    const temp = this.heap[left]!
    this.heap[left] = this.heap[right]!
    this.heap[right] = temp
  }
}

const anchorHeuristic = (anchor: GridAnchor, goal: GridAnchor): number =>
  ptuGridVectorDistance({
    x: goal.x - anchor.x,
    y: goal.y - anchor.y,
    z: goal.z - anchor.z,
  })

const diagonalStepCost = (diagonalParity: 0 | 1): number => diagonalParity === 0 ? 1 : 2

const isDiagonalHorizontalStep = (direction: GridAnchor): boolean =>
  direction.y === 0 && direction.x !== 0 && direction.z !== 0

const movementStepCost = (
  direction: GridAnchor,
  diagonalParity: 0 | 1,
  slow: boolean,
): { cost: number; diagonalParity: 0 | 1 } => {
  const diagonal = isDiagonalHorizontalStep(direction)
  const baseCost = diagonal ? diagonalStepCost(diagonalParity) : 1
  const nextDiagonalParity: 0 | 1 = diagonal ? (diagonalParity === 0 ? 1 : 0) : diagonalParity
  return {
    cost: slow ? baseCost * 2 : baseCost,
    diagonalParity: nextDiagonalParity,
  }
}

const tokenFootprintsAllowAnchor = (
  pokemon: GridFootprint,
  anchor: GridAnchor,
  pokemons: readonly PositionedGridFootprint[],
  dimensions: GridDimensions,
  exceptId?: string | null,
): boolean => {
  if (!isAnchorWithinBounds(anchor, pokemon, dimensions)) return false

  return pokemons.every((other) => {
    if (other.id && other.id === exceptId) return true

    return !footprintsOverlap(
      anchor,
      pokemon.base,
      getClearanceValue(pokemon),
      other.position,
      other.base,
      getClearanceValue(other),
    )
  })
}

const terrainRequirementToCapability = (
  requirement: MovementTerrainRequirement,
  capabilities: MovementCapabilitySpeeds | null | undefined,
  airHeight: number,
): MovementCapabilityKey | null => {
  if (requirement === 'aerial') {
    return bestAerialMovementCapability(capabilities, airHeight)
  }

  return movementCapabilitySpeed(capabilities, requirement) == null ? null : requirement
}

const primaryCapabilityKeysForTerrain = (
  terrain: MovementAnchorTerrain,
  capabilities: MovementCapabilitySpeeds | null | undefined,
): MovementCapabilityKey[] | null => {
  const capabilityKeys: MovementCapabilityKey[] = []
  for (const requirement of terrain.requirements) {
    const capability = terrainRequirementToCapability(requirement, capabilities, terrain.airHeight)
    if (!capability) return null
    capabilityKeys.push(capability)
  }

  return Array.from(new Set(capabilityKeys))
}

const sortedMovementOptions = (
  options: readonly AnchorMovementEvaluation[],
  capabilities: MovementCapabilitySpeeds | null | undefined,
): AnchorMovementEvaluation[] => {
  const unique = new Map<string, AnchorMovementEvaluation>()
  for (const option of options) {
    const key = `${capabilityMaskForKeys(option.capabilityKeys)}|${option.slow ? 'slow' : 'normal'}`
    if (!unique.has(key)) unique.set(key, option)
  }

  return Array.from(unique.values()).sort((left, right) => {
    const leftLimit = mixedMovementCapabilityLimit(capabilities, left.capabilityKeys) ?? -1
    const rightLimit = mixedMovementCapabilityLimit(capabilities, right.capabilityKeys) ?? -1
    if (leftLimit !== rightLimit) return rightLimit - leftLimit
    if (left.slow !== right.slow) return left.slow ? 1 : -1
    return left.capabilityKeys.length - right.capabilityKeys.length
  })
}

const evaluateAnchorMovementOptions = ({
  pokemon,
  anchor,
  terrainIndex,
  groundLevelY,
  capabilities,
}: {
  pokemon: GridFootprint
  anchor: GridAnchor
  terrainIndex: MapMovementTerrainIndex
  groundLevelY: number
  capabilities: MovementCapabilitySpeeds | null | undefined
}): AnchorMovementEvaluation[] => {
  const terrain = movementTerrainForAnchor({
    anchor,
    footprint: pokemon,
    terrain: terrainIndex,
    groundLevelY,
  })
  if (terrain.blocked) return []

  const options: AnchorMovementEvaluation[] = []
  const primaryCapabilityKeys = primaryCapabilityKeysForTerrain(terrain, capabilities)
  if (primaryCapabilityKeys) {
    options.push({
      capabilityKeys: primaryCapabilityKeys,
      slow: terrain.slow,
    })
  }

  if (terrain.hoverable) {
    const aerialCapability = bestAerialMovementCapability(capabilities, 0)
    if (aerialCapability) {
      options.push({
        capabilityKeys: [aerialCapability],
        slow: false,
      })
    }
  }

  return sortedMovementOptions(options, capabilities)
}

const reconstructPath = (
  goalKey: string,
  states: ReadonlyMap<string, MovementPathState>,
  cameFrom: ReadonlyMap<string, string | null>,
): GridAnchor[] => {
  const path: GridAnchor[] = []
  let currentKey: string | null = goalKey

  while (currentKey) {
    const state = states.get(currentKey)
    if (!state) break
    path.push(state.anchor)
    currentKey = cameFrom.get(currentKey) ?? null
  }

  return path.reverse()
}

const resultForPath = (
  path: GridAnchor[] | null,
  distance: number,
  capabilityKeys: readonly MovementCapabilityKey[],
  movementLimit: number | null,
): MovementPathResult => {
  const labels = movementCapabilityLabels(capabilityKeys)
  const legal = Boolean(path) && movementLimit != null && distance <= movementLimit
  return {
    path,
    distance,
    movementLimit,
    capabilityKeys: [...capabilityKeys],
    capabilityLabels: labels,
    capabilityLabel: capabilitySummaryLabel(capabilityKeys),
    legal,
    reason: legal ? 'legal' : 'too-far',
  }
}

const blockedResult = (
  distance: number,
  reason: 'blocked' | 'missing-capability' = 'blocked',
): MovementPathResult => ({
  path: null,
  distance,
  movementLimit: null,
  capabilityKeys: [],
  capabilityLabels: [],
  capabilityLabel: 'No legal route',
  legal: false,
  reason,
})

export const findMovementPathForPokemon = ({
  pokemon,
  start,
  goal,
  pokemons,
  dimensions,
  exceptId,
  voxels,
  groundLevelY = 0,
  terrainRevision = null,
}: {
  pokemon: GridFootprint & { movementCapabilities?: MovementCapabilitySpeeds }
  start: GridAnchor
  goal: GridAnchor
  pokemons: readonly PositionedGridFootprint[]
  dimensions: GridDimensions
  exceptId?: string | null
  voxels?: readonly MapVoxelV2[] | null
  groundLevelY?: number
  terrainRevision?: string | number | null
}): MovementPathResult => {
  const directDistance = anchorHeuristic(start, goal)
  const capabilities = pokemon.movementCapabilities

  if (!tokenFootprintsAllowAnchor(pokemon, start, pokemons, dimensions, exceptId)) {
    return blockedResult(directDistance)
  }

  if (!tokenFootprintsAllowAnchor(pokemon, goal, pokemons, dimensions, exceptId)) {
    return blockedResult(directDistance)
  }

  if (sameAnchor(start, goal)) {
    return {
      path: [start],
      distance: 0,
      movementLimit: 0,
      capabilityKeys: [],
      capabilityLabels: [],
      capabilityLabel: 'No movement',
      legal: true,
      reason: 'same-position',
    }
  }

  const terrainIndex = movementTerrainIndexCache.get(voxels, terrainRevision)
  const directGoalMovementOptions = evaluateAnchorMovementOptions({
    pokemon,
    anchor: goal,
    terrainIndex,
    groundLevelY,
    capabilities,
  })
  const directTooFarResult = (): MovementPathResult => {
    const bestDirectMovement = directGoalMovementOptions[0]
    if (!bestDirectMovement) return blockedResult(directDistance, 'missing-capability')
    const capabilityKeys = bestDirectMovement.capabilityKeys
    return resultForPath(
      null,
      directDistance,
      capabilityKeys,
      mixedMovementCapabilityLimit(capabilities, capabilityKeys),
    )
  }

  const maxPotentialDistance = highestShiftMovementSpeed(capabilities)
  if (maxPotentialDistance <= 0 || directDistance > maxPotentialDistance) return directTooFarResult()

  const queue = new MovementPriorityQueue()
  const startState: MovementPathState = {
    anchor: start,
    cost: 0,
    diagonalParity: 0,
    capabilityMask: 0,
  }
  const startKey = stateKey(start, 0, 0)
  const bestCostByKey = new Map<string, number>([[startKey, 0]])
  const cameFrom = new Map<string, string | null>([[startKey, null]])
  const states = new Map<string, MovementPathState>([[startKey, startState]])
  queue.push({ ...startState, key: startKey, priority: 0 })
  let bestLegalGoalResult: MovementPathResult | null = null
  let bestIllegalGoalResult: MovementPathResult | null = null

  while (queue.size > 0) {
    const current = queue.pop()!
    if (current.cost !== bestCostByKey.get(current.key)) continue
    if (current.cost > maxPotentialDistance) break
    if (bestLegalGoalResult && current.cost > bestLegalGoalResult.distance) break

    if (sameAnchor(current.anchor, goal)) {
      const path = reconstructPath(current.key, states, cameFrom)
      const capabilityKeys = capabilityKeysForMask(current.capabilityMask)
      const movementLimit = mixedMovementCapabilityLimit(capabilities, capabilityKeys)
      const result = resultForPath(path, current.cost, capabilityKeys, movementLimit)
      if (result.legal) {
        if (
          !bestLegalGoalResult ||
          result.distance < bestLegalGoalResult.distance ||
          (result.distance === bestLegalGoalResult.distance &&
            (result.movementLimit ?? -1) > (bestLegalGoalResult.movementLimit ?? -1))
        ) {
          bestLegalGoalResult = result
        }
        continue
      }
      if (!bestIllegalGoalResult || result.distance < bestIllegalGoalResult.distance) {
        bestIllegalGoalResult = result
      }
      continue
    }

    for (const direction of DIRECTIONS) {
      const nextAnchor = {
        x: current.anchor.x + direction.x,
        y: current.anchor.y + direction.y,
        z: current.anchor.z + direction.z,
      }

      if (!tokenFootprintsAllowAnchor(pokemon, nextAnchor, pokemons, dimensions, exceptId)) continue

      const movementOptions = evaluateAnchorMovementOptions({
        pokemon,
        anchor: nextAnchor,
        terrainIndex,
        groundLevelY,
        capabilities,
      })
      if (!movementOptions.length) continue

      for (const movement of movementOptions) {
        const step = movementStepCost(direction, current.diagonalParity, movement.slow)
        const nextCost = current.cost + step.cost
        const nextCapabilityMask = current.capabilityMask | capabilityMaskForKeys(movement.capabilityKeys)
        const nextKey = stateKey(nextAnchor, step.diagonalParity, nextCapabilityMask)
        const bestCost = bestCostByKey.get(nextKey)
        if (bestCost != null && bestCost <= nextCost) continue

        const nextState: MovementPathState = {
          anchor: nextAnchor,
          cost: nextCost,
          diagonalParity: step.diagonalParity,
          capabilityMask: nextCapabilityMask,
        }
        bestCostByKey.set(nextKey, nextCost)
        states.set(nextKey, nextState)
        cameFrom.set(nextKey, current.key)
        queue.push({
          ...nextState,
          key: nextKey,
          priority: nextCost,
        })
      }
    }
  }

  if (bestLegalGoalResult) return bestLegalGoalResult
  if (bestIllegalGoalResult) return bestIllegalGoalResult
  return directGoalMovementOptions.length ? blockedResult(directDistance) : blockedResult(directDistance, 'missing-capability')
}

export const movementPathFailureMessage = (result: MovementPathResult): string | null => {
  if (result.legal || result.reason === 'same-position') return null
  if (result.reason === 'too-far') {
    const limit = result.movementLimit ?? 0
    return `Distance exceeds ${result.capabilityLabel} ${limit}.`
  }
  if (result.reason === 'missing-capability') return 'Missing the required Movement Capability for this terrain.'
  return 'No legal movement route to that space.'
}
