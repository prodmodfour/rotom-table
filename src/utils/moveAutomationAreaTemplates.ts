import { getClearanceValue } from '~/utils/gridGeometry'
import { tokenGridDistance } from '~/utils/moveAutomationRange'
import type {
  MoveAutomationAreaDirection,
  MoveAutomationAreaTemplate,
  MoveAutomationAreaTemplateKind,
  MoveAutomationScript,
} from '~/types/moveAutomation'
import type { GridAnchor, SpawnedPokemon } from '~/types/pokemon'

interface DirectionDefinition {
  id: MoveAutomationAreaDirection
  label: string
  dx: -1 | 0 | 1
  dz: -1 | 0 | 1
}

export interface MoveAutomationAreaTemplatePlacement {
  id: string
  label: string
  template: MoveAutomationAreaTemplate
  cells: GridAnchor[]
  targetIds: string[]
  direction?: MoveAutomationAreaDirection
}

interface AreaTemplateFootprint {
  id?: string
  position: GridAnchor
  base: number
  clearance?: number
}

export interface BuildMoveAutomationAreaTemplateCellsInput {
  template: MoveAutomationAreaTemplate
  user: AreaTemplateFootprint
  direction?: MoveAutomationAreaDirection
  /** Center square for Ranged Blast templates. */
  center?: GridAnchor
}

export interface TokensInMoveAutomationAreaInput {
  cells: readonly GridAnchor[]
  tokens: readonly SpawnedPokemon[]
  excludeIds?: readonly string[]
}

export interface BuildMoveAutomationAreaTemplatePlacementsInput {
  script: Pick<MoveAutomationScript, 'areaTemplates' | 'range'> | null | undefined
  user: SpawnedPokemon
  tokens: readonly SpawnedPokemon[]
  includeEmpty?: boolean
}

const AREA_DIRECTIONS: readonly DirectionDefinition[] = [
  { id: 'north', label: 'north', dx: 0, dz: -1 },
  { id: 'north-east', label: 'north-east', dx: 1, dz: -1 },
  { id: 'east', label: 'east', dx: 1, dz: 0 },
  { id: 'south-east', label: 'south-east', dx: 1, dz: 1 },
  { id: 'south', label: 'south', dx: 0, dz: 1 },
  { id: 'south-west', label: 'south-west', dx: -1, dz: 1 },
  { id: 'west', label: 'west', dx: -1, dz: 0 },
  { id: 'north-west', label: 'north-west', dx: -1, dz: -1 },
]

export const MOVE_AUTOMATION_AREA_DIRECTIONS: readonly MoveAutomationAreaDirection[] = AREA_DIRECTIONS.map((item) => item.id)

const directionDefinition = (direction: MoveAutomationAreaDirection | undefined): DirectionDefinition | null =>
  AREA_DIRECTIONS.find((item) => item.id === direction) ?? null

const positiveInt = (raw: string | undefined): number | null => {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : null
}

const areaTemplateLabel = (kind: MoveAutomationAreaTemplateKind, size: number, range?: number | null): string => {
  switch (kind) {
    case 'burst': return `Burst ${size}`
    case 'close-blast': return `Close Blast ${size}`
    case 'ranged-blast': return range != null ? `Ranged ${range} Blast ${size}` : `Blast ${size}`
    case 'cone': return `Cone ${size}`
    case 'line': return `Line ${size}`
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

  if (/\b(?:All\s+)?Cardinally\s+Adjacent\s+Targets\b/i.test(value)) {
    addTemplate(templates, seen, 'cardinally-adjacent', 1)
  }

  return templates.sort((a, b) => templateTextIndex(value, a) - templateTextIndex(value, b))
}

const cellKey = (cell: GridAnchor): string => `${cell.x},${cell.y},${cell.z}`

const uniqueCells = (cells: GridAnchor[]): GridAnchor[] => Array.from(
  new Map(cells.map((cell) => [cellKey(cell), cell])).values(),
)

const footprintCenterCell = (user: AreaTemplateFootprint): GridAnchor => ({
  x: user.position.x + Math.floor((user.base - 1) / 2),
  y: user.position.y,
  z: user.position.z + Math.floor((user.base - 1) / 2),
})

const originCellForDirection = (user: AreaTemplateFootprint, direction: DirectionDefinition): GridAnchor => {
  const center = footprintCenterCell(user)
  return {
    x: direction.dx > 0 ? user.position.x + user.base - 1 : direction.dx < 0 ? user.position.x : center.x,
    y: user.position.y,
    z: direction.dz > 0 ? user.position.z + user.base - 1 : direction.dz < 0 ? user.position.z : center.z,
  }
}

const buildSquareCells = (start: GridAnchor, size: number): GridAnchor[] => {
  const cells: GridAnchor[] = []
  for (let x = start.x; x < start.x + size; x += 1) {
    for (let z = start.z; z < start.z + size; z += 1) cells.push({ x, y: start.y, z })
  }
  return cells
}

const buildBurstCells = (user: AreaTemplateFootprint, radius: number): GridAnchor[] => {
  const cells: GridAnchor[] = []
  const minX = user.position.x - radius
  const maxX = user.position.x + user.base - 1 + radius
  const minZ = user.position.z - radius
  const maxZ = user.position.z + user.base - 1 + radius
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const insideUser = x >= user.position.x
        && x < user.position.x + user.base
        && z >= user.position.z
        && z < user.position.z + user.base
      if (!insideUser) cells.push({ x, y: user.position.y, z })
    }
  }
  return cells
}

const buildCardinalAdjacentCells = (user: AreaTemplateFootprint): GridAnchor[] => {
  const cells: GridAnchor[] = []
  const y = user.position.y
  for (let x = user.position.x; x < user.position.x + user.base; x += 1) {
    cells.push({ x, y, z: user.position.z - 1 }, { x, y, z: user.position.z + user.base })
  }
  for (let z = user.position.z; z < user.position.z + user.base; z += 1) {
    cells.push({ x: user.position.x - 1, y, z }, { x: user.position.x + user.base, y, z })
  }
  return uniqueCells(cells)
}

const closeBlastStart = (user: AreaTemplateFootprint, size: number, direction: DirectionDefinition): GridAnchor => {
  const neutralOffset = Math.floor((user.base - size) / 2)
  return {
    x: direction.dx > 0
      ? user.position.x + user.base
      : direction.dx < 0
        ? user.position.x - size
        : user.position.x + neutralOffset,
    y: user.position.y,
    z: direction.dz > 0
      ? user.position.z + user.base
      : direction.dz < 0
        ? user.position.z - size
        : user.position.z + neutralOffset,
  }
}

const buildLineCells = (user: AreaTemplateFootprint, length: number, direction: DirectionDefinition): GridAnchor[] => {
  const origin = originCellForDirection(user, direction)
  const cells: GridAnchor[] = []
  for (let distance = 1; distance <= length; distance += 1) {
    cells.push({
      x: origin.x + direction.dx * distance,
      y: origin.y,
      z: origin.z + direction.dz * distance,
    })
  }
  return cells
}

const coneLateralVector = (direction: DirectionDefinition): { x: -1 | 0 | 1; z: -1 | 0 | 1 } => {
  if (direction.dx === 0) return { x: 1, z: 0 }
  if (direction.dz === 0) return { x: 0, z: 1 }
  return { x: -direction.dz as -1 | 1, z: direction.dx as -1 | 1 }
}

const buildConeCells = (user: AreaTemplateFootprint, length: number, direction: DirectionDefinition): GridAnchor[] => {
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
    for (let offset = -lateralRadius; offset <= lateralRadius; offset += 1) {
      cells.push({
        x: center.x + lateral.x * offset,
        y: center.y,
        z: center.z + lateral.z * offset,
      })
    }
  }
  return uniqueCells(cells)
}

const buildRangedBlastCells = (center: GridAnchor, size: number): GridAnchor[] => {
  const offset = Math.floor(size / 2)
  return buildSquareCells({ x: center.x - offset, y: center.y, z: center.z - offset }, size)
}

export const buildMoveAutomationAreaTemplateCells = ({
  template,
  user,
  direction,
  center,
}: BuildMoveAutomationAreaTemplateCellsInput): GridAnchor[] => {
  switch (template.kind) {
    case 'burst': return buildBurstCells(user, template.size)
    case 'cardinally-adjacent': return buildCardinalAdjacentCells(user)
    case 'close-blast': {
      const resolvedDirection = directionDefinition(direction)
      return resolvedDirection ? buildSquareCells(closeBlastStart(user, template.size, resolvedDirection), template.size) : []
    }
    case 'cone': {
      const resolvedDirection = directionDefinition(direction)
      return resolvedDirection ? buildConeCells(user, template.size, resolvedDirection) : []
    }
    case 'line': {
      const resolvedDirection = directionDefinition(direction)
      return resolvedDirection ? buildLineCells(user, template.size, resolvedDirection) : []
    }
    case 'ranged-blast': return center ? buildRangedBlastCells(center, template.size) : []
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
  y: token.position.y,
  z: token.position.z + Math.floor((token.base - 1) / 2),
})

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

const templatesForScript = (script: Pick<MoveAutomationScript, 'areaTemplates' | 'range'> | null | undefined): MoveAutomationAreaTemplate[] =>
  script?.areaTemplates?.length ? [...script.areaTemplates] : parseMoveAutomationAreaTemplates(script?.range)

export const buildMoveAutomationAreaTemplatePlacements = ({
  script,
  user,
  tokens,
  includeEmpty = false,
}: BuildMoveAutomationAreaTemplatePlacementsInput): MoveAutomationAreaTemplatePlacement[] => {
  const templates = templatesForScript(script)
  const placements: MoveAutomationAreaTemplatePlacement[] = []
  const seen = new Set<string>()

  for (const template of templates) {
    if (template.kind === 'burst' || template.kind === 'cardinally-adjacent') {
      const cells = buildMoveAutomationAreaTemplateCells({ template, user })
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

    if (template.kind === 'ranged-blast') {
      for (const token of tokens) {
        if (token.id === user.id || !templateCanBeCenteredOnToken(template, user, token)) continue
        const center = tokenCenterCell(token)
        const cells = buildMoveAutomationAreaTemplateCells({ template, user, center })
        const targetIds = tokensInMoveAutomationArea({ cells, tokens, excludeIds: [user.id] }).map((item) => item.id)
        addPlacement(placements, seen, {
          id: `${template.kind}:${template.range ?? 'any'}:${template.size}:${token.id}`,
          label: `${template.label} centered on ${token.species}`,
          template,
          cells,
          targetIds,
        }, includeEmpty)
      }
      continue
    }

    for (const direction of AREA_DIRECTIONS) {
      const cells = buildMoveAutomationAreaTemplateCells({ template, user, direction: direction.id })
      const targetIds = tokensInMoveAutomationArea({ cells, tokens, excludeIds: [user.id] }).map((token) => token.id)
      addPlacement(placements, seen, {
        id: `${template.kind}:${template.size}:${direction.id}`,
        label: `${template.label} ${direction.label}`,
        template,
        cells,
        targetIds,
        direction: direction.id,
      }, includeEmpty)
    }
  }

  return placements
}
