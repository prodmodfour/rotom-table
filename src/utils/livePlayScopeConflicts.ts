import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  LIVE_PLAY_MAP_SCOPE_LANES,
  LIVE_PLAY_TOKEN_SCOPE_FIELDS,
  type LivePlayMapScopeLane,
  type LivePlayScope,
  type LivePlayTokenScopeField,
} from '#shared/livePlayCommands'
import { isSheetKind, type SheetKind } from '#shared/sheets'

type JsonRecord = Record<string, unknown>

export interface LivePlayScopeConflictSubject {
  readonly scopes: readonly LivePlayScope[]
  readonly type?: string
  readonly payload?: unknown
  readonly command?: unknown
}

export type LivePlayScopeConflictInput = readonly LivePlayScope[] | LivePlayScopeConflictSubject

export type LivePlayScopeConflictDescriptor =
  | {
      readonly kind: 'token-field'
      readonly placementId: string
      readonly field: LivePlayTokenScopeField
      readonly label: string
    }
  | {
      readonly kind: 'sheet-field'
      readonly sheetKind: SheetKind
      readonly sheetSlug: string
      readonly field: string
      readonly label: string
    }
  | {
      readonly kind: 'map-lane'
      readonly lane: LivePlayMapScopeLane
      readonly label: string
    }
  | {
      readonly kind: 'terrain-cell'
      readonly x: number
      readonly y: number
      readonly z: number
      readonly label: string
    }
  | {
      readonly kind: 'unknown'
      readonly label: string
    }

export interface LivePlayScopeConflict {
  readonly left: LivePlayScopeConflictDescriptor
  readonly right: LivePlayScopeConflictDescriptor
  readonly label: string
}

interface GridCell {
  readonly x: number
  readonly y: number
  readonly z: number
}

interface NormalizedScopeConflictInput {
  readonly scopes: readonly unknown[]
  readonly command: unknown
}

const MAP_SCOPE_LANES = new Set<unknown>(LIVE_PLAY_MAP_SCOPE_LANES)
const TOKEN_SCOPE_FIELDS = new Set<unknown>(LIVE_PLAY_TOKEN_SCOPE_FIELDS)

const isRecord = (value: unknown): value is JsonRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
)

const parseGridCell = (value: unknown): GridCell | null => {
  if (!isRecord(value)) return null
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.z)) return null
  return { x: value.x, y: value.y, z: value.z }
}

const commandType = (command: unknown): string | null => (
  isRecord(command) && typeof command.type === 'string' ? command.type : null
)

const commandPayload = (command: unknown): unknown => (
  isRecord(command) ? command.payload : undefined
)

const terrainCellFromCommand = (command: unknown): GridCell | null => {
  const type = commandType(command)
  const payload = commandPayload(command)
  if (!isRecord(payload)) return null

  if (type === LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL) {
    return parseGridCell(payload.voxel)
  }

  if (type === LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL) {
    return parseGridCell(payload.cell)
  }

  if (type === LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN) {
    return parseGridCell(payload.cell)
  }

  return null
}

const isScopeConflictSubject = (input: LivePlayScopeConflictInput): input is LivePlayScopeConflictSubject => (
  isRecord(input) && Array.isArray(input.scopes)
)

const normalizeInput = (input: LivePlayScopeConflictInput): NormalizedScopeConflictInput => {
  if (!isScopeConflictSubject(input)) return { scopes: input, command: undefined }
  return { scopes: input.scopes, command: input.command ?? input }
}

const unknownDescriptor = (label: string): LivePlayScopeConflictDescriptor => ({
  kind: 'unknown',
  label,
})

const terrainCellDescriptor = (cell: GridCell): LivePlayScopeConflictDescriptor => ({
  kind: 'terrain-cell',
  x: cell.x,
  y: cell.y,
  z: cell.z,
  label: `terrain cell ${cell.x},${cell.y},${cell.z}`,
})

const descriptorForScope = (
  scope: unknown,
  terrainCell: GridCell | null,
): LivePlayScopeConflictDescriptor => {
  if (!isRecord(scope)) return unknownDescriptor('unknown resource scope')

  if (scope.kind === 'token') {
    if (typeof scope.placementId !== 'string' || !TOKEN_SCOPE_FIELDS.has(scope.field)) {
      return unknownDescriptor('unknown token scope')
    }
    return {
      kind: 'token-field',
      placementId: scope.placementId,
      field: scope.field as LivePlayTokenScopeField,
      label: `token ${scope.placementId} ${scope.field}`,
    }
  }

  if (scope.kind === 'sheet') {
    if (!isSheetKind(scope.sheetKind) || typeof scope.sheetSlug !== 'string' || typeof scope.field !== 'string') {
      return unknownDescriptor('unknown sheet scope')
    }
    return {
      kind: 'sheet-field',
      sheetKind: scope.sheetKind,
      sheetSlug: scope.sheetSlug,
      field: scope.field,
      label: `sheet ${scope.sheetKind}:${scope.sheetSlug} ${scope.field}`,
    }
  }

  if (scope.kind === 'map') {
    if (!MAP_SCOPE_LANES.has(scope.lane)) return unknownDescriptor('unknown map scope')
    if (scope.lane === 'terrain' && terrainCell) return terrainCellDescriptor(terrainCell)
    return {
      kind: 'map-lane',
      lane: scope.lane as LivePlayMapScopeLane,
      label: `map lane ${scope.lane}`,
    }
  }

  return unknownDescriptor('unknown resource scope')
}

const descriptorKey = (descriptor: LivePlayScopeConflictDescriptor): string => {
  if (descriptor.kind === 'token-field') return `${descriptor.kind}:${descriptor.placementId}:${descriptor.field}`
  if (descriptor.kind === 'sheet-field') return `${descriptor.kind}:${descriptor.sheetKind}:${descriptor.sheetSlug}:${descriptor.field}`
  if (descriptor.kind === 'terrain-cell') return `${descriptor.kind}:${descriptor.x}:${descriptor.y}:${descriptor.z}`
  if (descriptor.kind === 'map-lane') return `${descriptor.kind}:${descriptor.lane}`
  return `${descriptor.kind}:${descriptor.label}`
}

export const livePlayScopeConflictDescriptors = (
  input: LivePlayScopeConflictInput,
): readonly LivePlayScopeConflictDescriptor[] => {
  const normalized = normalizeInput(input)
  const terrainCell = terrainCellFromCommand(normalized.command)
  const descriptors = normalized.scopes.map((scope) => descriptorForScope(scope, terrainCell))

  if (descriptors.length === 0) return [unknownDescriptor('empty resource scope set')]

  const seen = new Set<string>()
  const unique: LivePlayScopeConflictDescriptor[] = []
  for (const descriptor of descriptors) {
    const key = descriptorKey(descriptor)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(descriptor)
  }
  return unique
}

const broadTerrainScopeConflictsWith = (descriptor: LivePlayScopeConflictDescriptor): boolean => (
  (descriptor.kind === 'map-lane' && descriptor.lane === 'terrain') || descriptor.kind === 'terrain-cell'
)

const descriptorsConflict = (
  left: LivePlayScopeConflictDescriptor,
  right: LivePlayScopeConflictDescriptor,
): boolean => {
  if (left.kind === 'unknown' || right.kind === 'unknown') return true

  if (left.kind === 'map-lane' && left.lane === 'terrain') return broadTerrainScopeConflictsWith(right)
  if (right.kind === 'map-lane' && right.lane === 'terrain') return broadTerrainScopeConflictsWith(left)

  if (left.kind !== right.kind) return false

  if (left.kind === 'map-lane' && right.kind === 'map-lane') return left.lane === right.lane
  if (left.kind === 'terrain-cell' && right.kind === 'terrain-cell') {
    return left.x === right.x && left.y === right.y && left.z === right.z
  }
  if (left.kind === 'token-field' && right.kind === 'token-field') {
    return left.placementId === right.placementId && left.field === right.field
  }
  if (left.kind === 'sheet-field' && right.kind === 'sheet-field') {
    return left.sheetKind === right.sheetKind
      && left.sheetSlug === right.sheetSlug
      && left.field === right.field
  }

  return false
}

const conflictLabel = (
  left: LivePlayScopeConflictDescriptor,
  right: LivePlayScopeConflictDescriptor,
): string => (
  left.label === right.label ? left.label : `${left.label} / ${right.label}`
)

export const findLivePlayScopeConflict = (
  left: LivePlayScopeConflictInput,
  right: LivePlayScopeConflictInput,
): LivePlayScopeConflict | null => {
  const leftDescriptors = livePlayScopeConflictDescriptors(left)
  const rightDescriptors = livePlayScopeConflictDescriptors(right)

  for (const leftDescriptor of leftDescriptors) {
    const rightDescriptor = rightDescriptors.find((candidate) => descriptorsConflict(leftDescriptor, candidate))
    if (rightDescriptor) {
      return {
        left: leftDescriptor,
        right: rightDescriptor,
        label: conflictLabel(leftDescriptor, rightDescriptor),
      }
    }
  }

  return null
}

export const livePlayScopesConflict = (
  left: LivePlayScopeConflictInput,
  right: LivePlayScopeConflictInput,
): boolean => findLivePlayScopeConflict(left, right) !== null
