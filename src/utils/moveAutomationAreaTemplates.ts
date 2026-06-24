import {
  footprintsOverlap,
  getClearanceValue,
  isAnchorWithinBounds,
} from '~/utils/gridGeometry'
import { tokenGridDistance } from '~/utils/moveAutomationRange'
import {
  ptuAlternatingDiagonalDistance,
  ptuGridDistanceBetweenFootprints,
  ptuGridVectorDistance,
} from '~/utils/ptuGridDistance'
import { MOVE_AUTOMATION_AREA_DIRECTIONS } from '~/types/moveAutomation'
import type {
  MoveAutomationAreaDirection,
  MoveAutomationAreaTemplate,
  MoveAutomationAreaTemplateKind,
  MoveAutomationScript,
} from '~/types/moveAutomation'
import type { GridAnchor, GridDimensions, SpawnedPokemon } from '~/types/pokemon'

interface DirectionDefinition {
  id: MoveAutomationAreaDirection
  label: string
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
  dz: -1 | 0 | 1
}

export interface MoveAutomationAreaTemplatePlacement {
  id: string
  label: string
  template: MoveAutomationAreaTemplate
  cells: GridAnchor[]
  targetIds: string[]
  direction?: MoveAutomationAreaDirection
  /** Center square/cube for free-aim Ranged Blast templates. */
  center?: GridAnchor
  /** Pointer-selected legal cell for constrained free-aim area templates. */
  aimCell?: GridAnchor
  /** End square for Pass templates; undefined for stationary area templates. */
  destination?: GridAnchor
}

interface AreaTemplateFootprint {
  id?: string
  position: GridAnchor
  base: number
  clearance?: number
}

export interface AreaTemplateCellConstraints {
  bounds?: GridDimensions
  /** Terrain cells that the AoE volume cannot occupy or pass through. */
  blockedCells?: ReadonlySet<string>
}

export interface BuildMoveAutomationAreaTemplateCellsInput extends AreaTemplateCellConstraints {
  template: MoveAutomationAreaTemplate
  user: AreaTemplateFootprint
  direction?: MoveAutomationAreaDirection
  /** Center square/cube for Ranged Blast templates. */
  center?: GridAnchor
}

export interface TokensInMoveAutomationAreaInput {
  cells: readonly GridAnchor[]
  tokens: readonly SpawnedPokemon[]
  excludeIds?: readonly string[]
}

export interface BuildMoveAutomationAreaTemplatePlacementsInput extends AreaTemplateCellConstraints {
  script: Pick<MoveAutomationScript, 'areaTemplates' | 'range'> | null | undefined
  user: SpawnedPokemon
  tokens: readonly SpawnedPokemon[]
  includeEmpty?: boolean
}

export interface BuildMoveAutomationAreaTemplatePlacementAtCenterInput extends AreaTemplateCellConstraints {
  template: MoveAutomationAreaTemplate
  user: SpawnedPokemon
  tokens: readonly SpawnedPokemon[]
  center: GridAnchor
  includeEmpty?: boolean
  id?: string
  label?: string
}

export interface BuildMoveAutomationCloseBlastPlacementAtAimCellInput extends AreaTemplateCellConstraints {
  template: MoveAutomationAreaTemplate
  user: SpawnedPokemon
  tokens: readonly SpawnedPokemon[]
  aimCell: GridAnchor
  includeEmpty?: boolean
  id?: string
  label?: string
}

const AREA_DIRECTION_METADATA: Record<MoveAutomationAreaDirection, Omit<DirectionDefinition, 'id'>> = {
  north: { label: 'north', dx: 0, dy: 0, dz: -1 },
  'north-east': { label: 'north-east', dx: 1, dy: 0, dz: -1 },
  east: { label: 'east', dx: 1, dy: 0, dz: 0 },
  'south-east': { label: 'south-east', dx: 1, dy: 0, dz: 1 },
  south: { label: 'south', dx: 0, dy: 0, dz: 1 },
  'south-west': { label: 'south-west', dx: -1, dy: 0, dz: 1 },
  west: { label: 'west', dx: -1, dy: 0, dz: 0 },
  'north-west': { label: 'north-west', dx: -1, dy: 0, dz: -1 },
  up: { label: 'up', dx: 0, dy: 1, dz: 0 },
  down: { label: 'down', dx: 0, dy: -1, dz: 0 },
}

const AREA_DIRECTIONS: readonly DirectionDefinition[] = MOVE_AUTOMATION_AREA_DIRECTIONS.map((id) => ({
  id,
  ...AREA_DIRECTION_METADATA[id],
}))

export { MOVE_AUTOMATION_AREA_DIRECTIONS }

const directionDefinition = (direction: MoveAutomationAreaDirection | undefined): DirectionDefinition | null =>
  AREA_DIRECTIONS.find((item) => item.id === direction) ?? null

const positiveInt = (raw: string | undefined): number | null => {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : null
}

export const moveAutomationAreaTemplateId = (template: Pick<MoveAutomationAreaTemplate, 'kind' | 'size' | 'range'>): string =>
  `${template.kind}:${template.range ?? 'any'}:${template.size}`

const areaTemplateLabel = (kind: MoveAutomationAreaTemplateKind, size: number, range?: number | null): string => {
  switch (kind) {
    case 'burst': return `Burst ${size}`
    case 'close-blast': return `Close Blast ${size}`
    case 'ranged-blast': return range != null ? `Ranged ${range} Blast ${size}` : `Blast ${size}`
    case 'cone': return `Cone ${size}`
    case 'line': return `Line ${size}`
    case 'pass': return `Pass ${size}`
    case 'cardinally-adjacent': return 'Cardinally Adjacent Targets'
  }
}

const makeAreaTemplate = (
  kind: MoveAutomationAreaTemplateKind,
  size: number,
  range?: number | null,
): MoveAutomationAreaTemplate => ({
  kind,
  size,
  ...(range !== undefined ? { range } : {}),
  label: areaTemplateLabel(kind, size, range),
})

const addTemplate = (
  templates: MoveAutomationAreaTemplate[],
  seen: Set<string>,
  kind: MoveAutomationAreaTemplateKind,
  size: number | null,
  range?: number | null,
): void => {
  if (size == null) return
  const key = `${kind}:${range ?? ''}:${size}`
  if (seen.has(key)) return
  seen.add(key)
  templates.push(makeAreaTemplate(kind, size, range))
}

const previousTextEndsWithRangedBlastRange = (value: string, index: number): boolean =>
  /(?:^|[,;\s])\d+\s*,\s*$/i.test(value.slice(Math.max(0, index - 12), index))

const previousTextNamesBlastKind = (value: string, index: number): boolean =>
  /(?:Close|Ranged)\s+$/i.test(value.slice(Math.max(0, index - 12), index))

const escapedNumber = (value: number | null | undefined): string => String(value ?? '')

const templateTextIndex = (value: string, template: MoveAutomationAreaTemplate): number => {
  const size = escapedNumber(template.size)
  const range = escapedNumber(template.range)
  const pattern = (() => {
    switch (template.kind) {
      case 'burst': return new RegExp(`\\bBurst\\s+${size}\\b`, 'i')
      case 'close-blast': return new RegExp(`\\bClose\\s+Blast\\s+${size}\\b`, 'i')
      case 'ranged-blast': return template.range != null
        ? new RegExp(`\\b${range}\\s*,\\s*(?:Ranged\\s+)?Blast\\s+${size}\\b`, 'i')
        : new RegExp(`\\b(?:Ranged\\s+)?Blast\\s+${size}\\b`, 'i')
      case 'cone': return new RegExp(`\\bCone\\s+${size}\\b`, 'i')
      case 'line': return new RegExp(`\\bLine\\s+${size}\\b`, 'i')
      case 'pass': return /\bPass\b/i
      case 'cardinally-adjacent': return /\b(?:All\s+)?Cardinally\s+Adjacent\s+Targets\b/i
    }
  })()
  const index = value.search(pattern)
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER
}

/**
 * Parses PTU area-of-effect range keywords using the definitions from
 * `books/markdown/core/10-indices-and-reference.md` pages 343-344:
 * Burst, Close Blast, Cone, Line, Ranged Blast, and Cardinally Adjacent Targets.
 */
export const parseMoveAutomationAreaTemplates = (range: string | null | undefined): MoveAutomationAreaTemplate[] => {
  const value = (range ?? '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
  if (!value) return []

  const templates: MoveAutomationAreaTemplate[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null

  const rangedBlast = /\b(\d+)\s*,\s*Ranged\s+Blast\s+(\d+)\b/gi
  while ((match = rangedBlast.exec(value)) != null) {
    addTemplate(templates, seen, 'ranged-blast', positiveInt(match[2]), positiveInt(match[1]))
  }

  const numericBlast = /\b(\d+)\s*,\s*Blast\s+(\d+)\b/gi
  while ((match = numericBlast.exec(value)) != null) {
    addTemplate(templates, seen, 'ranged-blast', positiveInt(match[2]), positiveInt(match[1]))
  }

  const burst = /\bBurst\s+(\d+)\b/gi
  while ((match = burst.exec(value)) != null) addTemplate(templates, seen, 'burst', positiveInt(match[1]))

  const closeBlast = /\bClose\s+Blast\s+(\d+)\b/gi
  while ((match = closeBlast.exec(value)) != null) addTemplate(templates, seen, 'close-blast', positiveInt(match[1]))

  const bareRangedBlast = /\bRanged\s+Blast\s+(\d+)\b/gi
  while ((match = bareRangedBlast.exec(value)) != null) {
    if (previousTextEndsWithRangedBlastRange(value, match.index)) continue
    addTemplate(templates, seen, 'ranged-blast', positiveInt(match[1]), null)
  }

  const bareBlast = /\bBlast\s+(\d+)\b/gi
  while ((match = bareBlast.exec(value)) != null) {
    if (previousTextNamesBlastKind(value, match.index) || previousTextEndsWithRangedBlastRange(value, match.index)) continue
    addTemplate(templates, seen, 'ranged-blast', positiveInt(match[1]), null)
  }

  const cone = /\bCone\s+(\d+)\b/gi
  while ((match = cone.exec(value)) != null) addTemplate(templates, seen, 'cone', positiveInt(match[1]))

  const line = /\bLine\s+(\d+)\b/gi
  while ((match = line.exec(value)) != null) addTemplate(templates, seen, 'line', positiveInt(match[1]))

  if (/\bPass\b/i.test(value)) addTemplate(templates, seen, 'pass', 4)

  if (/\b(?:All\s+)?Cardinally\s+Adjacent\s+Targets\b/i.test(value)) {
    addTemplate(templates, seen, 'cardinally-adjacent', 1)
  }

  return templates.sort((a, b) => templateTextIndex(value, a) - templateTextIndex(value, b))
}

const cellKey = (cell: GridAnchor): string => `${cell.x},${cell.y},${cell.z}`

const uniqueCells = (cells: GridAnchor[]): GridAnchor[] => Array.from(
  new Map(cells.map((cell) => [cellKey(cell), cell])).values(),
)

const rangeInclusive = (start: number, end: number): number[] => {
  const values: number[] = []
  for (let value = start; value <= end; value += 1) values.push(value)
  return values
}

const footprintClearance = (user: AreaTemplateFootprint): number => getClearanceValue(user)

const footprintTopY = (user: AreaTemplateFootprint): number => user.position.y + footprintClearance(user) - 1

const footprintCenterCell = (user: AreaTemplateFootprint): GridAnchor => ({
  x: user.position.x + Math.floor((user.base - 1) / 2),
  y: user.position.y + Math.floor((footprintClearance(user) - 1) / 2),
  z: user.position.z + Math.floor((user.base - 1) / 2),
})

const footprintContainsCell = (user: AreaTemplateFootprint, cell: GridAnchor): boolean =>
  cell.x >= user.position.x
  && cell.x < user.position.x + user.base
  && cell.y >= user.position.y
  && cell.y <= footprintTopY(user)
  && cell.z >= user.position.z
  && cell.z < user.position.z + user.base

const footprintCells = (user: AreaTemplateFootprint): GridAnchor[] => {
  const cells: GridAnchor[] = []
  for (let x = user.position.x; x < user.position.x + user.base; x += 1) {
    for (let y = user.position.y; y <= footprintTopY(user); y += 1) {
      for (let z = user.position.z; z < user.position.z + user.base; z += 1) cells.push({ x, y, z })
    }
  }
  return cells
}

const originCellForDirection = (user: AreaTemplateFootprint, direction: DirectionDefinition): GridAnchor => {
  const center = footprintCenterCell(user)
  return {
    x: direction.dx > 0 ? user.position.x + user.base - 1 : direction.dx < 0 ? user.position.x : center.x,
    y: direction.dy > 0 ? footprintTopY(user) : direction.dy < 0 ? user.position.y : center.y,
    z: direction.dz > 0 ? user.position.z + user.base - 1 : direction.dz < 0 ? user.position.z : center.z,
  }
}

const directionOriginCells = (user: AreaTemplateFootprint, direction: DirectionDefinition): GridAnchor[] => {
  const xValues = direction.dx > 0
    ? [user.position.x + user.base - 1]
    : direction.dx < 0
      ? [user.position.x]
      : rangeInclusive(user.position.x, user.position.x + user.base - 1)
  const yValues = direction.dy > 0
    ? [footprintTopY(user)]
    : direction.dy < 0
      ? [user.position.y]
      : rangeInclusive(user.position.y, footprintTopY(user))
  const zValues = direction.dz > 0
    ? [user.position.z + user.base - 1]
    : direction.dz < 0
      ? [user.position.z]
      : rangeInclusive(user.position.z, user.position.z + user.base - 1)

  const cells: GridAnchor[] = []
  for (const x of xValues) {
    for (const y of yValues) {
      for (const z of zValues) cells.push({ x, y, z })
    }
  }
  return cells
}

const buildCuboidCells = (start: GridAnchor, size: GridDimensions): GridAnchor[] => {
  const cells: GridAnchor[] = []
  for (let x = start.x; x < start.x + size.x; x += 1) {
    for (let y = start.y; y < start.y + size.y; y += 1) {
      for (let z = start.z; z < start.z + size.z; z += 1) cells.push({ x, y, z })
    }
  }
  return cells
}

const buildCubeCells = (start: GridAnchor, size: number): GridAnchor[] =>
  buildCuboidCells(start, { x: size, y: size, z: size })

const buildBurstCells = (user: AreaTemplateFootprint, radius: number): GridAnchor[] => {
  const cells: GridAnchor[] = []
  const minX = user.position.x - radius
  const maxX = user.position.x + user.base - 1 + radius
  const minY = user.position.y - radius
  const maxY = footprintTopY(user) + radius
  const minZ = user.position.z - radius
  const maxZ = user.position.z + user.base - 1 + radius
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        const cell = { x, y, z }
        if (!footprintContainsCell(user, cell)) cells.push(cell)
      }
    }
  }
  return cells
}

const buildCardinalAdjacentCells = (user: AreaTemplateFootprint): GridAnchor[] => {
  const cells: GridAnchor[] = []
  for (let y = user.position.y; y <= footprintTopY(user); y += 1) {
    for (let x = user.position.x; x < user.position.x + user.base; x += 1) {
      cells.push({ x, y, z: user.position.z - 1 }, { x, y, z: user.position.z + user.base })
    }
    for (let z = user.position.z; z < user.position.z + user.base; z += 1) {
      cells.push({ x: user.position.x - 1, y, z }, { x: user.position.x + user.base, y, z })
    }
  }
  return uniqueCells(cells)
}

const verticalStartForSize = (user: AreaTemplateFootprint, size: number): number =>
  user.position.y + Math.floor((footprintClearance(user) - size) / 2)

const closeBlastStart = (user: AreaTemplateFootprint, size: number, direction: DirectionDefinition): GridAnchor => {
  const neutralOffset = Math.floor((user.base - size) / 2)
  return {
    x: direction.dx > 0
      ? user.position.x + user.base
      : direction.dx < 0
        ? user.position.x - size
        : user.position.x + neutralOffset,
    y: direction.dy > 0
      ? footprintTopY(user) + 1
      : direction.dy < 0
        ? user.position.y - size
        : verticalStartForSize(user, size),
    z: direction.dz > 0
      ? user.position.z + user.base
      : direction.dz < 0
        ? user.position.z - size
        : user.position.z + neutralOffset,
  }
}

const directionStepDistance = (step: number, direction: DirectionDefinition): number =>
  direction.dx !== 0 && direction.dz !== 0 ? ptuAlternatingDiagonalDistance(step) : step

const buildLineCells = (user: AreaTemplateFootprint, length: number, direction: DirectionDefinition): GridAnchor[] => {
  const origin = originCellForDirection(user, direction)
  const cells: GridAnchor[] = []
  for (let step = 1; directionStepDistance(step, direction) <= length; step += 1) {
    if (direction.dy === 0) {
      for (let y = user.position.y; y <= footprintTopY(user); y += 1) {
        cells.push({
          x: origin.x + direction.dx * step,
          y,
          z: origin.z + direction.dz * step,
        })
      }
    } else {
      cells.push({
        x: origin.x,
        y: origin.y + direction.dy * step,
        z: origin.z,
      })
    }
  }
  return uniqueCells(cells)
}

const coneLateralVector = (direction: DirectionDefinition): { x: -1 | 0 | 1; z: -1 | 0 | 1 } => {
  if (direction.dx === 0) return { x: 1, z: 0 }
  if (direction.dz === 0) return { x: 0, z: 1 }
  return { x: -direction.dz as -1 | 1, z: direction.dx as -1 | 1 }
}

const buildVerticalConeCells = (user: AreaTemplateFootprint, length: number, direction: DirectionDefinition): GridAnchor[] => {
  const origin = originCellForDirection(user, direction)
  const cells: GridAnchor[] = []
  for (let distance = 1; distance <= length; distance += 1) {
    const lateralRadius = distance === 1 ? 0 : 1
    for (let xOffset = -lateralRadius; xOffset <= lateralRadius; xOffset += 1) {
      for (let zOffset = -lateralRadius; zOffset <= lateralRadius; zOffset += 1) {
        cells.push({
          x: origin.x + xOffset,
          y: origin.y + direction.dy * distance,
          z: origin.z + zOffset,
        })
      }
    }
  }
  return uniqueCells(cells)
}

const buildCardinalHorizontalConeCells = (user: AreaTemplateFootprint, length: number, direction: DirectionDefinition): GridAnchor[] => {
  const origin = originCellForDirection(user, direction)
  const lateral = coneLateralVector(direction)
  const cells: GridAnchor[] = []
  for (let distance = 1; distance <= length; distance += 1) {
    const center = {
      x: origin.x + direction.dx * distance,
      y: origin.y,
      z: origin.z + direction.dz * distance,
    }
    const lateralRadius = distance === 1 ? 0 : 1
    const verticalRadius = distance === 1 ? 0 : 1
    for (let offset = -lateralRadius; offset <= lateralRadius; offset += 1) {
      for (let yOffset = -verticalRadius; yOffset <= verticalRadius; yOffset += 1) {
        cells.push({
          x: center.x + lateral.x * offset,
          y: center.y + yOffset,
          z: center.z + lateral.z * offset,
        })
      }
    }
  }
  return uniqueCells(cells)
}

const buildDiagonalHorizontalConeCells = (user: AreaTemplateFootprint, length: number, direction: DirectionDefinition): GridAnchor[] => {
  const origin = originCellForDirection(user, direction)
  const cells: GridAnchor[] = []
  for (let step = 1; directionStepDistance(step, direction) <= length; step += 1) {
    const lineCell = {
      x: origin.x + direction.dx * step,
      y: origin.y,
      z: origin.z + direction.dz * step,
    }
    const xValues = direction.dx > 0 ? [lineCell.x, lineCell.x + 1] : [lineCell.x - 1, lineCell.x]
    const zValues = direction.dz > 0 ? [lineCell.z, lineCell.z + 1] : [lineCell.z - 1, lineCell.z]

    for (const x of xValues) {
      for (const z of zValues) {
        const isImmediateLineCell = step === 1 && x === lineCell.x && z === lineCell.z
        const verticalRadius = isImmediateLineCell ? 0 : 1
        for (let yOffset = -verticalRadius; yOffset <= verticalRadius; yOffset += 1) {
          cells.push({ x, y: lineCell.y + yOffset, z })
        }
      }
    }
  }
  return uniqueCells(cells)
}

const buildHorizontalConeCells = (user: AreaTemplateFootprint, length: number, direction: DirectionDefinition): GridAnchor[] =>
  direction.dx !== 0 && direction.dz !== 0
    ? buildDiagonalHorizontalConeCells(user, length, direction)
    : buildCardinalHorizontalConeCells(user, length, direction)

const buildConeCells = (user: AreaTemplateFootprint, length: number, direction: DirectionDefinition): GridAnchor[] =>
  direction.dy === 0
    ? buildHorizontalConeCells(user, length, direction)
    : buildVerticalConeCells(user, length, direction)

const buildRangedBlastCells = (center: GridAnchor, size: number): GridAnchor[] => {
  const offset = Math.floor(size / 2)
  return buildCubeCells({ x: center.x - offset, y: center.y - offset, z: center.z - offset }, size)
}

const cellFootprint = (position: GridAnchor): AreaTemplateFootprint => ({ position, base: 1, clearance: 1 })

const filterCellsWithinFootprintDistance = (
  cells: GridAnchor[],
  source: AreaTemplateFootprint,
  maxDistance: number,
): GridAnchor[] => cells.filter((cell) => ptuGridDistanceBetweenFootprints(source, cellFootprint(cell)) <= maxDistance)

const minCellDistanceFromOrigins = (cell: GridAnchor, origins: readonly GridAnchor[]): number =>
  origins.reduce((bestDistance, origin) => Math.min(bestDistance, ptuGridVectorDistance({
    x: cell.x - origin.x,
    y: cell.y - origin.y,
    z: cell.z - origin.z,
  })), Number.POSITIVE_INFINITY)

const filterCellsWithinOriginDistance = (
  cells: GridAnchor[],
  origins: readonly GridAnchor[],
  maxDistance: number,
): GridAnchor[] => origins.length
  ? cells.filter((cell) => minCellDistanceFromOrigins(cell, origins) <= maxDistance)
  : []

const rangedBlastDistanceRadius = (size: number): number => Math.floor(size / 2)

const cellInBounds = (cell: GridAnchor, bounds: GridDimensions | undefined): boolean =>
  cell.x >= 0
  && cell.y >= 0
  && cell.z >= 0
  && (!bounds || (
    cell.x < bounds.x
    && cell.y < bounds.y
    && cell.z < bounds.z
  ))

const cellsBetweenCellCenters = (from: GridAnchor, to: GridAnchor): GridAnchor[] => {
  const current: GridAnchor = { ...from }
  const target: GridAnchor = { ...to }
  const cells: GridAnchor[] = [{ ...current }]
  if (current.x === target.x && current.y === target.y && current.z === target.z) return cells

  const start = { x: from.x + 0.5, y: from.y + 0.5, z: from.z + 0.5 }
  const end = { x: to.x + 0.5, y: to.y + 0.5, z: to.z + 0.5 }
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dz = end.z - start.z
  const stepX = Math.sign(dx)
  const stepY = Math.sign(dy)
  const stepZ = Math.sign(dz)
  const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dx)
  const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dy)
  const tDeltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dz)
  let tMaxX = stepX === 0
    ? Number.POSITIVE_INFINITY
    : stepX > 0
      ? (from.x + 1 - start.x) / dx
      : (start.x - from.x) / -dx
  let tMaxY = stepY === 0
    ? Number.POSITIVE_INFINITY
    : stepY > 0
      ? (from.y + 1 - start.y) / dy
      : (start.y - from.y) / -dy
  let tMaxZ = stepZ === 0
    ? Number.POSITIVE_INFINITY
    : stepZ > 0
      ? (from.z + 1 - start.z) / dz
      : (start.z - from.z) / -dz
  const epsilon = 1e-9
  const guardLimit = Math.abs(target.x - current.x) + Math.abs(target.y - current.y) + Math.abs(target.z - current.z) + 3
  let guard = 0

  while ((current.x !== target.x || current.y !== target.y || current.z !== target.z) && guard < guardLimit) {
    const nextT = Math.min(tMaxX, tMaxY, tMaxZ)
    if (tMaxX <= nextT + epsilon) {
      current.x += stepX
      tMaxX += tDeltaX
    }
    if (tMaxY <= nextT + epsilon) {
      current.y += stepY
      tMaxY += tDeltaY
    }
    if (tMaxZ <= nextT + epsilon) {
      current.z += stepZ
      tMaxZ += tDeltaZ
    }
    cells.push({ ...current })
    guard += 1
  }

  return cells
}

const lineBetweenCellsIsClear = (
  origin: GridAnchor,
  target: GridAnchor,
  blockedCells: ReadonlySet<string>,
): boolean => {
  const lineCells = cellsBetweenCellCenters(origin, target)
  for (let index = 1; index < lineCells.length - 1; index += 1) {
    if (blockedCells.has(cellKey(lineCells[index]))) return false
  }
  return true
}

const cellHasLineOfEffect = (
  cell: GridAnchor,
  origins: readonly GridAnchor[],
  blockedCells: ReadonlySet<string>,
): boolean => origins.length === 0 || origins.some((origin) => lineBetweenCellsIsClear(origin, cell, blockedCells))

const applyCellConstraints = (
  cells: GridAnchor[],
  origins: readonly GridAnchor[],
  constraints: AreaTemplateCellConstraints,
): GridAnchor[] => {
  const bounded = uniqueCells(cells).filter((cell) => cellInBounds(cell, constraints.bounds))
  const blockedCells = constraints.blockedCells
  if (!blockedCells?.size) return bounded

  return bounded.filter((cell) =>
    !blockedCells.has(cellKey(cell)) && cellHasLineOfEffect(cell, origins, blockedCells),
  )
}

const offsetPositionByDirectionStep = (
  position: GridAnchor,
  direction: DirectionDefinition,
  step: number,
): GridAnchor => ({
  x: position.x + direction.dx * step,
  y: position.y + direction.dy * step,
  z: position.z + direction.dz * step,
})

const footprintOverlapsBlockedCells = (
  footprint: AreaTemplateFootprint,
  position: GridAnchor,
  blockedCells: ReadonlySet<string> | undefined,
): boolean => Boolean(
  blockedCells?.size
    && footprintCells({ ...footprint, position }).some((cell) => blockedCells.has(cellKey(cell))),
)

const footprintCanOccupyTerrain = (
  footprint: AreaTemplateFootprint,
  position: GridAnchor,
  constraints: AreaTemplateCellConstraints,
): boolean => (!constraints.bounds || isAnchorWithinBounds(position, footprint, constraints.bounds))
  && !footprintOverlapsBlockedCells(footprint, position, constraints.blockedCells)

const footprintOverlapsTokenAtPosition = (
  user: AreaTemplateFootprint,
  position: GridAnchor,
  token: AreaTemplateFootprint,
): boolean => footprintsOverlap(
  position,
  user.base,
  footprintClearance(user),
  token.position,
  token.base,
  footprintClearance(token),
)

const passDestinationIsEmpty = (
  user: SpawnedPokemon,
  position: GridAnchor,
  tokens: readonly SpawnedPokemon[],
): boolean => !tokens.some((token) => token.id !== user.id && footprintOverlapsTokenAtPosition(user, position, token))

const buildPassPlacementForDirection = (
  template: MoveAutomationAreaTemplate,
  user: SpawnedPokemon,
  tokens: readonly SpawnedPokemon[],
  direction: DirectionDefinition,
  constraints: AreaTemplateCellConstraints,
): { cells: GridAnchor[]; destination: GridAnchor } | null => {
  let destination: GridAnchor | null = null
  let destinationDistance = 0

  for (let step = 1; directionStepDistance(step, direction) <= template.size; step += 1) {
    const position = offsetPositionByDirectionStep(user.position, direction, step)
    if (!footprintCanOccupyTerrain(user, position, constraints)) break
    if (!passDestinationIsEmpty(user, position, tokens)) continue
    destination = position
    destinationDistance = directionStepDistance(step, direction)
  }

  if (!destination) return null
  const origins = directionOriginCells(user, direction)
  return {
    cells: applyCellConstraints(buildLineCells(user, destinationDistance, direction), origins, constraints),
    destination,
  }
}

export const buildMoveAutomationAreaTemplateCells = ({
  template,
  user,
  direction,
  center,
  bounds,
  blockedCells,
}: BuildMoveAutomationAreaTemplateCellsInput): GridAnchor[] => {
  const constraints = { bounds, blockedCells }
  switch (template.kind) {
    case 'burst': return applyCellConstraints(
      filterCellsWithinFootprintDistance(buildBurstCells(user, template.size), user, template.size),
      footprintCells(user),
      constraints,
    )
    case 'cardinally-adjacent': return applyCellConstraints(buildCardinalAdjacentCells(user), footprintCells(user), constraints)
    case 'close-blast': {
      const resolvedDirection = directionDefinition(direction)
      if (!resolvedDirection) return []
      const origins = directionOriginCells(user, resolvedDirection)
      return applyCellConstraints(
        filterCellsWithinOriginDistance(
          buildCubeCells(closeBlastStart(user, template.size, resolvedDirection), template.size),
          origins,
          template.size,
        ),
        origins,
        constraints,
      )
    }
    case 'cone': {
      const resolvedDirection = directionDefinition(direction)
      if (!resolvedDirection) return []
      const origins = directionOriginCells(user, resolvedDirection)
      return applyCellConstraints(
        filterCellsWithinOriginDistance(buildConeCells(user, template.size, resolvedDirection), origins, template.size),
        origins,
        constraints,
      )
    }
    case 'line': {
      const resolvedDirection = directionDefinition(direction)
      return resolvedDirection
        ? applyCellConstraints(buildLineCells(user, template.size, resolvedDirection), directionOriginCells(user, resolvedDirection), constraints)
        : []
    }
    case 'pass': {
      const resolvedDirection = directionDefinition(direction)
      return resolvedDirection
        ? applyCellConstraints(buildLineCells(user, template.size, resolvedDirection), directionOriginCells(user, resolvedDirection), constraints)
        : []
    }
    case 'ranged-blast': return center
      ? applyCellConstraints(
          filterCellsWithinOriginDistance(buildRangedBlastCells(center, template.size), [center], rangedBlastDistanceRadius(template.size)),
          [center],
          constraints,
        )
      : []
  }
}

const tokenOccupiesCell = (token: SpawnedPokemon, cell: GridAnchor): boolean =>
  cell.x >= token.position.x
  && cell.x < token.position.x + token.base
  && cell.z >= token.position.z
  && cell.z < token.position.z + token.base
  && cell.y >= token.position.y
  && cell.y < token.position.y + getClearanceValue(token)

export const tokensInMoveAutomationArea = ({
  cells,
  tokens,
  excludeIds = [],
}: TokensInMoveAutomationAreaInput): SpawnedPokemon[] => {
  const excluded = new Set(excludeIds)
  return tokens.filter((token) =>
    !excluded.has(token.id) && cells.some((cell) => tokenOccupiesCell(token, cell)),
  )
}

const cellsSignature = (cells: readonly GridAnchor[]): string =>
  [...cells].map(cellKey).sort().join('|')

const tokenCenterCell = (token: SpawnedPokemon): GridAnchor => ({
  x: token.position.x + Math.floor((token.base - 1) / 2),
  y: token.position.y + Math.floor((getClearanceValue(token) - 1) / 2),
  z: token.position.z + Math.floor((token.base - 1) / 2),
})

const rangedBlastCenterLabel = (template: MoveAutomationAreaTemplate, center: GridAnchor): string =>
  `${template.label} centered at (${center.x}, ${center.y}, ${center.z})`

const closeBlastAimLabel = (template: MoveAutomationAreaTemplate, aimCell: GridAnchor): string =>
  `${template.label} aimed at (${aimCell.x}, ${aimCell.y}, ${aimCell.z})`

const cellMatches = (left: GridAnchor, right: GridAnchor): boolean =>
  left.x === right.x && left.y === right.y && left.z === right.z

const closeBlastFootprint = (position: GridAnchor, size: number): AreaTemplateFootprint => ({
  position,
  base: size,
  clearance: size,
})

const closeBlastStartOverlapsUser = (
  user: AreaTemplateFootprint,
  start: GridAnchor,
  size: number,
): boolean => footprintsOverlap(
  start,
  size,
  size,
  user.position,
  user.base,
  footprintClearance(user),
)

const closeBlastStartIsAdjacentToUser = (
  user: AreaTemplateFootprint,
  start: GridAnchor,
  size: number,
): boolean => ptuGridDistanceBetweenFootprints(user, closeBlastFootprint(start, size)) === 1

const closeBlastStartCandidates = (user: AreaTemplateFootprint, size: number): GridAnchor[] => {
  const starts: GridAnchor[] = []
  for (let x = user.position.x - size; x <= user.position.x + user.base; x += 1) {
    for (let y = user.position.y - size; y <= footprintTopY(user) + 1; y += 1) {
      for (let z = user.position.z - size; z <= user.position.z + user.base; z += 1) {
        const start = { x, y, z }
        if (closeBlastStartOverlapsUser(user, start, size)) continue
        if (!closeBlastStartIsAdjacentToUser(user, start, size)) continue
        starts.push(start)
      }
    }
  }
  return starts
}

const buildCloseBlastCellsAtStart = (
  user: AreaTemplateFootprint,
  size: number,
  start: GridAnchor,
  constraints: AreaTemplateCellConstraints,
): GridAnchor[] => {
  const origins = footprintCells(user)
  return applyCellConstraints(
    filterCellsWithinOriginDistance(buildCubeCells(start, size), origins, size),
    origins,
    constraints,
  )
}

const closeBlastAimCellForDirection = (
  user: AreaTemplateFootprint,
  direction: DirectionDefinition,
  cells: readonly GridAnchor[],
): GridAnchor | undefined => {
  const origin = originCellForDirection(user, direction)
  const adjacent = {
    x: origin.x + direction.dx,
    y: origin.y + direction.dy,
    z: origin.z + direction.dz,
  }
  if (cells.some((cell) => cellMatches(cell, adjacent))) return adjacent
  return cells.find((cell) => cell.y === user.position.y) ?? cells[0]
}

const closeBlastPlacementScore = (
  start: GridAnchor,
  size: number,
  aimCell: GridAnchor,
): number => {
  const center = {
    x: start.x + (size - 1) / 2,
    y: start.y + (size - 1) / 2,
    z: start.z + (size - 1) / 2,
  }
  return Math.abs(center.x - aimCell.x)
    + Math.abs(center.y - aimCell.y)
    + Math.abs(center.z - aimCell.z)
}

const addPlacement = (
  placements: MoveAutomationAreaTemplatePlacement[],
  seen: Set<string>,
  placement: MoveAutomationAreaTemplatePlacement,
  includeEmpty: boolean,
): void => {
  if (!includeEmpty && !placement.targetIds.length) return
  const signature = `${placement.template.kind}:${cellsSignature(placement.cells)}`
  if (seen.has(signature)) return
  seen.add(signature)
  placements.push(placement)
}

const templateCanBeCenteredOnToken = (
  template: MoveAutomationAreaTemplate,
  user: SpawnedPokemon,
  token: SpawnedPokemon,
): boolean => template.range == null || tokenGridDistance(user, token) <= template.range

const templateCanBeCenteredAtCell = (
  template: MoveAutomationAreaTemplate,
  user: SpawnedPokemon,
  center: GridAnchor,
): boolean => template.range == null || ptuGridDistanceBetweenFootprints(user, cellFootprint(center)) <= template.range

const templatesForScript = (script: Pick<MoveAutomationScript, 'areaTemplates' | 'range'> | null | undefined): MoveAutomationAreaTemplate[] =>
  script?.areaTemplates?.length ? [...script.areaTemplates] : parseMoveAutomationAreaTemplates(script?.range)

export const buildMoveAutomationAreaTemplatePlacementAtCenter = ({
  template,
  user,
  tokens,
  center,
  includeEmpty = false,
  id,
  label,
  bounds,
  blockedCells,
}: BuildMoveAutomationAreaTemplatePlacementAtCenterInput): MoveAutomationAreaTemplatePlacement | null => {
  if (template.kind !== 'ranged-blast') return null
  if (!cellInBounds(center, bounds)) return null
  if (blockedCells?.has(cellKey(center))) return null
  if (!templateCanBeCenteredAtCell(template, user, center)) return null

  const cells = buildMoveAutomationAreaTemplateCells({ template, user, center, bounds, blockedCells })
  if (!cells.length) return null

  const targetIds = tokensInMoveAutomationArea({ cells, tokens, excludeIds: [user.id] }).map((item) => item.id)
  if (!includeEmpty && !targetIds.length) return null

  return {
    id: id ?? `${template.kind}:${template.range ?? 'any'}:${template.size}:${center.x},${center.y},${center.z}`,
    label: label ?? rangedBlastCenterLabel(template, center),
    template,
    cells,
    targetIds,
    center: { ...center },
    aimCell: { ...center },
  }
}

export const buildMoveAutomationCloseBlastPlacementAtAimCell = ({
  template,
  user,
  tokens,
  aimCell,
  includeEmpty = false,
  id,
  label,
  bounds,
  blockedCells,
}: BuildMoveAutomationCloseBlastPlacementAtAimCellInput): MoveAutomationAreaTemplatePlacement | null => {
  if (template.kind !== 'close-blast') return null
  if (!cellInBounds(aimCell, bounds)) return null
  if (blockedCells?.has(cellKey(aimCell))) return null
  if (ptuGridDistanceBetweenFootprints(user, cellFootprint(aimCell)) > template.size) return null

  const constraints = { bounds, blockedCells }
  let best: { placement: MoveAutomationAreaTemplatePlacement; score: number } | null = null
  for (const start of closeBlastStartCandidates(user, template.size)) {
    const cells = buildCloseBlastCellsAtStart(user, template.size, start, constraints)
    if (!cells.some((cell) => cellMatches(cell, aimCell))) continue

    const targetIds = tokensInMoveAutomationArea({ cells, tokens, excludeIds: [user.id] }).map((item) => item.id)
    if (!includeEmpty && !targetIds.length) continue

    const score = closeBlastPlacementScore(start, template.size, aimCell)
    if (best && score >= best.score) continue

    best = {
      score,
      placement: {
        id: id ?? `${template.kind}:${template.size}:${aimCell.x},${aimCell.y},${aimCell.z}`,
        label: label ?? closeBlastAimLabel(template, aimCell),
        template,
        cells,
        targetIds,
        aimCell: { ...aimCell },
      },
    }
  }

  return best?.placement ?? null
}

export const buildMoveAutomationAreaTemplatePlacements = ({
  script,
  user,
  tokens,
  includeEmpty = false,
  bounds,
  blockedCells,
}: BuildMoveAutomationAreaTemplatePlacementsInput): MoveAutomationAreaTemplatePlacement[] => {
  const templates = templatesForScript(script)
  const placements: MoveAutomationAreaTemplatePlacement[] = []
  const seen = new Set<string>()
  const constraints = { bounds, blockedCells }

  for (const template of templates) {
    if (template.kind === 'burst' || template.kind === 'cardinally-adjacent') {
      const cells = buildMoveAutomationAreaTemplateCells({ template, user, ...constraints })
      const targetIds = tokensInMoveAutomationArea({ cells, tokens, excludeIds: [user.id] }).map((token) => token.id)
      addPlacement(placements, seen, {
        id: `${template.kind}:${template.size}`,
        label: template.label,
        template,
        cells,
        targetIds,
      }, includeEmpty)
      continue
    }

    if (template.kind === 'pass') {
      for (const direction of AREA_DIRECTIONS) {
        const path = buildPassPlacementForDirection(template, user, tokens, direction, constraints)
        if (!path) continue
        const targetIds = tokensInMoveAutomationArea({ cells: path.cells, tokens, excludeIds: [user.id] }).map((token) => token.id)
        addPlacement(placements, seen, {
          id: `${template.kind}:${template.size}:${direction.id}`,
          label: `${template.label} ${direction.label}`,
          template,
          cells: path.cells,
          targetIds,
          direction: direction.id,
          destination: path.destination,
        }, includeEmpty)
      }
      continue
    }

    if (template.kind === 'ranged-blast') {
      for (const token of tokens) {
        if (token.id === user.id || !templateCanBeCenteredOnToken(template, user, token)) continue
        const center = tokenCenterCell(token)
        const placement = buildMoveAutomationAreaTemplatePlacementAtCenter({
          template,
          user,
          tokens,
          center,
          includeEmpty,
          id: `${template.kind}:${template.range ?? 'any'}:${template.size}:${token.id}`,
          label: `${template.label} centered on ${token.species}`,
          ...constraints,
        })
        if (placement) addPlacement(placements, seen, placement, includeEmpty)
      }
      continue
    }

    for (const direction of AREA_DIRECTIONS) {
      const cells = buildMoveAutomationAreaTemplateCells({ template, user, direction: direction.id, ...constraints })
      const targetIds = tokensInMoveAutomationArea({ cells, tokens, excludeIds: [user.id] }).map((token) => token.id)
      const aimCell = template.kind === 'close-blast'
        ? closeBlastAimCellForDirection(user, direction, cells)
        : undefined
      addPlacement(placements, seen, {
        id: `${template.kind}:${template.size}:${direction.id}`,
        label: `${template.label} ${direction.label}`,
        template,
        cells,
        targetIds,
        direction: direction.id,
        ...(aimCell ? { aimCell } : {}),
      }, includeEmpty)
    }
  }

  return placements
}
