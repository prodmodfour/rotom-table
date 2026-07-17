import {
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type LivePlayCommandEnvelope,
  type LivePlayCommandRejectionReason,
  type LivePlayGroupInventoryScopeField,
  type LivePlayMapScopeLane,
  type LivePlayScope,
  type LivePlayTokenScopeField,
  type SheetHpModifiedPatchPayload,
  type CombatStagesModifiedPatchPayload,
  type ConditionsModifiedPatchPayload,
  type MoveUsedPatchPayload,
} from '#shared/livePlayCommands'
import { isRevision } from '#shared/sessionRevisions'
import type { SheetKind } from '#shared/sheets'

export interface LivePlayAcceptedOperationMetadata {
  readonly mapSlug: string
  readonly opId: string
  readonly revision: number
  readonly scopes: readonly LivePlayScope[]
  readonly command?: unknown
  readonly result?: LivePlayCommandAccepted
}

export interface LivePlayAcceptedOperationHistoryInput {
  readonly mapSlug: string
  readonly baseRevision: number
  readonly currentRevision: number
}

export interface LivePlayAcceptedOperationHistoryStore {
  listAcceptedOpsSinceRevision(
    input: LivePlayAcceptedOperationHistoryInput,
  ): readonly LivePlayAcceptedOperationMetadata[]
}

export interface LivePlayConflictCheckInput {
  readonly command: LivePlayCommandEnvelope
  readonly baseRevision: number
  readonly currentRevision: number
  readonly recentAcceptedOps?: readonly LivePlayAcceptedOperationMetadata[] | null
}

export interface LivePlayConflictAllowed {
  readonly ok: true
}

export interface LivePlayConflictRejected {
  readonly ok: false
  readonly reason: Extract<LivePlayCommandRejectionReason, 'stale-revision' | 'conflict'>
  readonly message: string
  readonly currentRevision: number
  readonly conflictingOp?: LivePlayAcceptedOperationMetadata
}

export type LivePlayConflictDecision = LivePlayConflictAllowed | LivePlayConflictRejected

type JsonRecord = Record<string, unknown>

type ConflictScopeDescriptor =
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
      readonly kind: 'group-inventory-field'
      readonly slug: string
      readonly field: LivePlayGroupInventoryScopeField
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
      readonly kind: 'hazard-cell'
      readonly x: number
      readonly y: number
      readonly z: number
      readonly label: string
    }

interface GridCell {
  readonly x: number
  readonly y: number
  readonly z: number
}

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

  return null
}

const patchPayload = <TPayload>(result: LivePlayCommandAccepted | undefined, patchType: string): TPayload | null => {
  const patch = result?.patches.find((candidate) => candidate.type === patchType)
  return patch && isRecord(patch.payload) ? patch.payload as TPayload : null
}

const terrainCellFromResult = (result: LivePlayCommandAccepted | undefined): GridCell | null => {
  const payload = patchPayload<{ readonly cell?: unknown }>(result, LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN)
  return payload ? parseGridCell(payload.cell) : null
}

const cellFromScope = (scope: LivePlayScope): GridCell | null => (
  isRecord(scope) ? parseGridCell(scope.cell) : null
)

const tokenScopeFromSheetPatch = (
  result: LivePlayCommandAccepted | undefined,
  patchType: string,
): { readonly placementId: string; readonly field: LivePlayTokenScopeField } | null => {
  const payload = patchPayload<
    | SheetHpModifiedPatchPayload
    | CombatStagesModifiedPatchPayload
    | ConditionsModifiedPatchPayload
    | MoveUsedPatchPayload
  >(result, patchType)
  if (!payload || typeof payload.placementId !== 'string') return null

  if (patchType === LIVE_PLAY_PATCH_TYPES.TOKEN_HP) {
    return { placementId: payload.placementId, field: 'hp' }
  }
  if (patchType === LIVE_PLAY_PATCH_TYPES.TOKEN_COMBAT_STAGES) {
    return { placementId: payload.placementId, field: 'combatStages' }
  }
  if (patchType === LIVE_PLAY_PATCH_TYPES.TOKEN_CONDITIONS) {
    return { placementId: payload.placementId, field: 'conditions' }
  }
  if (patchType === LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE) {
    return { placementId: payload.placementId, field: 'moveUsage' }
  }
  if (patchType === LIVE_PLAY_PATCH_TYPES.TOKEN_ACTION) {
    return { placementId: payload.placementId, field: 'action' }
  }

  return null
}

const terrainCellDescriptor = (cell: GridCell): ConflictScopeDescriptor => ({
  kind: 'terrain-cell',
  x: cell.x,
  y: cell.y,
  z: cell.z,
  label: `terrain cell ${cell.x},${cell.y},${cell.z}`,
})

const hazardCellDescriptor = (cell: GridCell): ConflictScopeDescriptor => ({
  kind: 'hazard-cell',
  x: cell.x,
  y: cell.y,
  z: cell.z,
  label: `hazard cell ${cell.x},${cell.y},${cell.z}`,
})

const mapLaneDescriptor = (lane: LivePlayMapScopeLane): ConflictScopeDescriptor => ({
  kind: 'map-lane',
  lane,
  label: `map lane ${lane}`,
})

const tokenFieldDescriptor = (
  placementId: string,
  field: LivePlayTokenScopeField,
): ConflictScopeDescriptor => ({
  kind: 'token-field',
  placementId,
  field,
  label: `token ${placementId} ${field}`,
})

const sheetFieldDescriptor = (
  sheetKind: SheetKind,
  sheetSlug: string,
  field: string,
): ConflictScopeDescriptor => ({
  kind: 'sheet-field',
  sheetKind,
  sheetSlug,
  field,
  label: `sheet ${sheetKind}:${sheetSlug} ${field}`,
})

const groupInventoryFieldDescriptor = (
  slug: string,
  field: LivePlayGroupInventoryScopeField,
): ConflictScopeDescriptor => ({
  kind: 'group-inventory-field',
  slug,
  field,
  label: `group inventory ${slug} ${field}`,
})

const descriptorKey = (descriptor: ConflictScopeDescriptor): string => {
  if (descriptor.kind === 'token-field') return `${descriptor.kind}:${descriptor.placementId}:${descriptor.field}`
  if (descriptor.kind === 'sheet-field') return `${descriptor.kind}:${descriptor.sheetKind}:${descriptor.sheetSlug}:${descriptor.field}`
  if (descriptor.kind === 'group-inventory-field') {
    return `${descriptor.kind}:${descriptor.slug}:${descriptor.field}`
  }
  if (descriptor.kind === 'terrain-cell') return `${descriptor.kind}:${descriptor.x}:${descriptor.y}:${descriptor.z}`
  if (descriptor.kind === 'hazard-cell') return `${descriptor.kind}:${descriptor.x}:${descriptor.y}:${descriptor.z}`
  return `${descriptor.kind}:${descriptor.lane}`
}

const uniqueDescriptors = (descriptors: readonly ConflictScopeDescriptor[]): readonly ConflictScopeDescriptor[] => {
  const seen = new Set<string>()
  const unique: ConflictScopeDescriptor[] = []
  for (const descriptor of descriptors) {
    const key = descriptorKey(descriptor)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(descriptor)
  }
  return unique
}

const commandDerivedTokenDescriptors = (
  command: unknown,
  result: LivePlayCommandAccepted | undefined,
): readonly ConflictScopeDescriptor[] => {
  const descriptors: ConflictScopeDescriptor[] = []
  const type = commandType(command)
  const payload = commandPayload(command)

  if (type === LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN && isRecord(payload) && typeof payload.placementId === 'string') {
    descriptors.push(tokenFieldDescriptor(payload.placementId, 'position'))
    return descriptors
  }

  if (type === LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN && isRecord(payload) && typeof payload.placementId === 'string') {
    descriptors.push(tokenFieldDescriptor(payload.placementId, 'facing'))
    return descriptors
  }

  if (type === LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN && isRecord(payload) && isRecord(payload.placement) && typeof payload.placement.id === 'string') {
    descriptors.push(tokenFieldDescriptor(payload.placement.id, 'spawn'))
    return descriptors
  }

  if (type === LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON && isRecord(payload)) {
    if (typeof payload.trainerId === 'string') descriptors.push(tokenFieldDescriptor(payload.trainerId, 'sendOut'))
    if (typeof payload.tokenId === 'string') descriptors.push(tokenFieldDescriptor(payload.tokenId, 'spawn'))
    return descriptors
  }

  if (type === LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN && isRecord(payload) && typeof payload.placementId === 'string') {
    descriptors.push(tokenFieldDescriptor(payload.placementId, 'delete'))
    return descriptors
  }

  for (const patchType of [
    LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
    LIVE_PLAY_PATCH_TYPES.TOKEN_COMBAT_STAGES,
    LIVE_PLAY_PATCH_TYPES.TOKEN_CONDITIONS,
    LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE,
    LIVE_PLAY_PATCH_TYPES.TOKEN_ACTION,
  ] as const) {
    const scope = tokenScopeFromSheetPatch(result, patchType)
    if (scope) descriptors.push(tokenFieldDescriptor(scope.placementId, scope.field))
  }

  return descriptors
}

const descriptorsForScopes = (
  scopes: readonly LivePlayScope[],
  command: unknown,
  result: LivePlayCommandAccepted | undefined,
): readonly ConflictScopeDescriptor[] => {
  const descriptors: ConflictScopeDescriptor[] = []
  const terrainCell = terrainCellFromCommand(command) ?? terrainCellFromResult(result)

  for (const scope of scopes) {
    if (scope.kind === 'token') {
      descriptors.push(tokenFieldDescriptor(scope.placementId, scope.field))
      continue
    }

    if (scope.kind === 'sheet') {
      descriptors.push(sheetFieldDescriptor(scope.sheetKind, scope.sheetSlug, scope.field))
      continue
    }

    if (scope.kind === 'groupInventory') {
      descriptors.push(groupInventoryFieldDescriptor(scope.slug, scope.field))
      continue
    }

    const scopedCell = cellFromScope(scope)
    if (scope.lane === 'hazards' && scopedCell) {
      descriptors.push(hazardCellDescriptor(scopedCell))
      continue
    }

    const resolvedTerrainCell = scopedCell ?? terrainCell
    if (scope.lane === 'terrain' && resolvedTerrainCell) {
      descriptors.push(terrainCellDescriptor(resolvedTerrainCell))
      continue
    }

    descriptors.push(mapLaneDescriptor(scope.lane))
  }

  descriptors.push(...commandDerivedTokenDescriptors(command, result))
  return uniqueDescriptors(descriptors)
}

const broadTerrainScopeConflictsWith = (descriptor: ConflictScopeDescriptor): boolean => (
  (descriptor.kind === 'map-lane' && descriptor.lane === 'terrain') || descriptor.kind === 'terrain-cell'
)

const broadHazardsScopeConflictsWith = (descriptor: ConflictScopeDescriptor): boolean => (
  (descriptor.kind === 'map-lane' && descriptor.lane === 'hazards') || descriptor.kind === 'hazard-cell'
)

const descriptorsConflict = (
  left: ConflictScopeDescriptor,
  right: ConflictScopeDescriptor,
): boolean => {
  if (left.kind === 'map-lane' && left.lane === 'terrain') return broadTerrainScopeConflictsWith(right)
  if (right.kind === 'map-lane' && right.lane === 'terrain') return broadTerrainScopeConflictsWith(left)
  if (left.kind === 'map-lane' && left.lane === 'hazards') return broadHazardsScopeConflictsWith(right)
  if (right.kind === 'map-lane' && right.lane === 'hazards') return broadHazardsScopeConflictsWith(left)

  if (left.kind !== right.kind) return false

  if (left.kind === 'map-lane' && right.kind === 'map-lane') return left.lane === right.lane
  if (left.kind === 'terrain-cell' && right.kind === 'terrain-cell') {
    return left.x === right.x && left.y === right.y && left.z === right.z
  }
  if (left.kind === 'hazard-cell' && right.kind === 'hazard-cell') {
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
  if (
    left.kind === 'group-inventory-field'
    && right.kind === 'group-inventory-field'
  ) {
    return left.slug === right.slug && left.field === right.field
  }

  return false
}

const staleDecision = (message: string, currentRevision: number): LivePlayConflictRejected => ({
  ok: false,
  reason: 'stale-revision',
  message,
  currentRevision,
})

const conflictDecision = (
  commandBaseRevision: number,
  currentRevision: number,
  acceptedOp: LivePlayAcceptedOperationMetadata,
  descriptor: ConflictScopeDescriptor,
): LivePlayConflictRejected => ({
  ok: false,
  reason: 'conflict',
  message: `Command baseRevision ${commandBaseRevision} conflicts with accepted operation ${acceptedOp.opId} at revision ${acceptedOp.revision} on ${descriptor.label}`,
  currentRevision,
  conflictingOp: acceptedOp,
})

const hasRevisionCoverage = (
  baseRevision: number,
  currentRevision: number,
  operations: readonly LivePlayAcceptedOperationMetadata[],
): boolean => {
  const revisions = new Set(operations.map((operation) => operation.revision))
  for (let revision = baseRevision + 1; revision <= currentRevision; revision += 1) {
    if (!revisions.has(revision)) return false
  }
  return true
}

const sortedRelevantOperations = (
  baseRevision: number,
  currentRevision: number,
  operations: readonly LivePlayAcceptedOperationMetadata[],
): readonly LivePlayAcceptedOperationMetadata[] => [...operations]
  .filter((operation) => operation.revision > baseRevision && operation.revision <= currentRevision)
  .sort((left, right) => {
    if (left.revision !== right.revision) return left.revision - right.revision
    return left.opId.localeCompare(right.opId)
  })

export const evaluateLivePlayCommandConflicts = (
  input: LivePlayConflictCheckInput,
): LivePlayConflictDecision => {
  const { command, baseRevision, currentRevision } = input

  if (!isRevision(baseRevision)) {
    return staleDecision('Command baseRevision must be a safe non-negative integer revision', currentRevision)
  }

  if (!isRevision(currentRevision)) {
    return staleDecision('Current map revision must be a safe non-negative integer revision', currentRevision)
  }

  if (baseRevision === currentRevision) return { ok: true }

  if (baseRevision > currentRevision) {
    return staleDecision(
      `Command baseRevision ${baseRevision} is ahead of current map revision ${currentRevision}`,
      currentRevision,
    )
  }

  if (command.type === LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE) {
    return staleDecision(
      `resolveMove requires an exact map revision. Refresh and retry from revision ${currentRevision}.`,
      currentRevision,
    )
  }

  if (!input.recentAcceptedOps) {
    return staleDecision(
      `Command baseRevision ${baseRevision} is stale and accepted operation history through revision ${currentRevision} is unavailable`,
      currentRevision,
    )
  }

  const relevantOperations = sortedRelevantOperations(baseRevision, currentRevision, input.recentAcceptedOps)
  if (!hasRevisionCoverage(baseRevision, currentRevision, relevantOperations)) {
    return staleDecision(
      `Command baseRevision ${baseRevision} is stale and accepted operation history through revision ${currentRevision} is incomplete`,
      currentRevision,
    )
  }

  const commandDescriptors = descriptorsForScopes(command.scopes, command, undefined)
  if (commandDescriptors.length === 0) {
    return staleDecision(
      `Command baseRevision ${baseRevision} is stale and command resource scopes cannot be compared safely`,
      currentRevision,
    )
  }

  for (const operation of relevantOperations) {
    const operationDescriptors = descriptorsForScopes(operation.scopes, operation.command, operation.result)
    if (operationDescriptors.length === 0) {
      return staleDecision(
        `Command baseRevision ${baseRevision} is stale and accepted operation ${operation.opId} at revision ${operation.revision} has incomplete resource-scope history`,
        currentRevision,
      )
    }

    for (const commandDescriptor of commandDescriptors) {
      const conflictingDescriptor = operationDescriptors.find((operationDescriptor) => (
        descriptorsConflict(commandDescriptor, operationDescriptor)
      ))
      if (conflictingDescriptor) {
        return conflictDecision(baseRevision, currentRevision, operation, conflictingDescriptor)
      }
    }
  }

  return { ok: true }
}
