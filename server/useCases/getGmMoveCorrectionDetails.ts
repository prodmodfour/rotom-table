import type { AuthRole } from '#shared/auth'
import {
  LIVE_PLAY_PATCH_TYPES,
  parseLivePlayMapSlug,
} from '#shared/livePlayCommands'
import { parseLivePlayMoveStatePatchPayload } from '#shared/livePlayMoveState'
import {
  GM_MOVE_CORRECTION_DETAILS_LIMITS,
  GM_MOVE_CORRECTION_DETAILS_SCHEMA_VERSION,
  parseGmMoveCorrectionDetails,
  type GmMoveCorrectionDetails,
  type GmMoveCorrectionEffectKind,
  type GmMoveCorrectionHistoryView,
  type GmMoveCorrectionOperationView,
  type GmMoveCorrectionResourceView,
} from '#shared/moveAutomation/correctionViews'
import { parseGmMoveCorrectionCommand } from '#shared/moveAutomation/correctionCommands'
import { validateLivePlayOperationId } from '../livePlay/commandIdempotency'
import type {
  AcceptedMoveCompensationOperation,
  AcceptedMoveCompensationResourceRevision,
  AcceptedMoveTypedInverseOperation,
} from '../domain/moveAutomation/acceptedMoveCompensation'
import {
  createSqliteLivePlayOpRepository,
  type LivePlayOpRepository,
  type SqliteLivePlayOpRecord,
} from '../storage/opRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class GmMoveCorrectionDetailsUseCaseError extends UseCaseHttpError<400 | 403 | 404 | 409> {}

export interface GetGmMoveCorrectionDetailsDependencies {
  readonly database?: RotomDatabase
  readonly opRepository?: Pick<
    LivePlayOpRepository,
    'getStoredOpRecord' | 'listMoveCorrectionRecords'
  >
}

const asRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
)

const parseIdentity = (input: {
  readonly mapSlug: unknown
  readonly originOperationId: unknown
}): { readonly mapSlug: string; readonly originOperationId: string } => {
  try {
    return {
      mapSlug: parseLivePlayMapSlug(input.mapSlug, 'move correction details map slug'),
      originOperationId: validateLivePlayOperationId(
        input.originOperationId,
        'move correction details origin operation ID',
      ),
    }
  }
  catch (error) {
    throw new GmMoveCorrectionDetailsUseCaseError(
      400,
      error instanceof Error ? error.message : 'Move correction details identity is invalid.',
    )
  }
}

const resourceView = (
  resource: AcceptedMoveCompensationResourceRevision,
): GmMoveCorrectionResourceView => {
  if (resource.kind === 'map') {
    return {
      kind: 'map',
      mapSlug: resource.mapSlug,
      acceptedRevision: resource.afterRevision,
    }
  }
  if (resource.kind === 'sheet') {
    return {
      kind: 'sheet',
      sheetKind: resource.sheetKind,
      sheetSlug: resource.sheetSlug,
      acceptedRevision: resource.afterRevision,
    }
  }
  return {
    kind: 'external-resource',
    resourceKind: resource.resourceKind,
    resourceId: resource.resourceId,
    acceptedRevision: resource.afterRevision,
  }
}

const effectKindForInverse = (
  inverse: AcceptedMoveTypedInverseOperation,
): GmMoveCorrectionEffectKind => {
  if (inverse.kind === 'restore-map-temporary-hit-points') return 'temporary-hp'
  if (inverse.kind === 'restore-map-move-usage' || inverse.kind === 'restore-sheet-move-usage') {
    return 'move-usage'
  }
  if (inverse.kind === 'restore-map-hazards') return 'hazards'
  if (inverse.kind === 'restore-map-field-effects') return 'field-effects'
  if (inverse.kind === 'restore-encounter-sides') return 'encounter-sides'
  if (inverse.kind === 'restore-encounter-effects') return 'encounter-effects'
  if (inverse.kind === 'restore-encounter-counters') return 'encounter-counters'
  if (inverse.kind === 'restore-encounter-turn-resources') return 'turn-resources'
  if (inverse.kind === 'restore-encounter-zones') return 'zones'
  if (inverse.kind === 'restore-placement-state') return 'placement'
  if (inverse.kind === 'restore-sheet-hp') return 'hp'
  if (inverse.kind === 'restore-sheet-combat-stages') return 'combat-stages'
  return 'conditions'
}

const unavailableEffectKind = (
  operation: Extract<AcceptedMoveCompensationOperation, { readonly availability: 'unavailable' }>,
): GmMoveCorrectionEffectKind => {
  if (operation.unavailableReasonCode.includes('history')) return 'history'
  if (operation.unavailableReasonCode.includes('pending-resolution')) return 'pending-resolution'
  if (operation.stateChangeKind === 'map-metadata') return 'history'
  if (operation.stateChangeKind === 'group-inventory-state') return 'external-resource'
  return 'other'
}

const operationView = (
  operation: AcceptedMoveCompensationOperation,
): GmMoveCorrectionOperationView => {
  const common = {
    operationId: operation.operationId,
    reasonCode: operation.reasonCode,
    resource: resourceView(operation.resource),
  }
  if (operation.availability === 'available') {
    return {
      ...common,
      effectKind: effectKindForInverse(operation.inverse),
      availability: 'available',
    }
  }
  return {
    ...common,
    effectKind: unavailableEffectKind(operation),
    availability: 'unavailable',
    safety: operation.safety,
    unavailableReasonCode: operation.unavailableReasonCode,
  }
}

const moveNameFromSource = (source: SqliteLivePlayOpRecord): string => {
  if (source.result.ok) {
    for (const patch of source.result.patches) {
      if (patch.type !== LIVE_PLAY_PATCH_TYPES.MOVE_STATE) continue
      const parsed = parseLivePlayMoveStatePatchPayload(patch.payload)
      if (parsed.valid) return parsed.payload.move.moveName
    }
  }

  const command = asRecord(source.command)
  const payload = asRecord(command?.payload)
  const directMoveName = typeof payload?.moveName === 'string' ? payload.moveName.trim() : ''
  if (directMoveName) return directMoveName
  const intent = asRecord(payload?.intent)
  const nestedMoveName = typeof intent?.moveName === 'string' ? intent.moveName.trim() : ''
  return nestedMoveName || 'Accepted move'
}

const correctionHistory = (
  record: SqliteLivePlayOpRecord,
  originOperationId: string,
): GmMoveCorrectionHistoryView => {
  let command
  try {
    command = parseGmMoveCorrectionCommand(record.command)
  }
  catch (error) {
    throw new GmMoveCorrectionDetailsUseCaseError(
      409,
      `Stored correction ${record.opId} has invalid command metadata: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (
    command.mapSlug !== record.mapSlug
    || command.opId !== record.opId
    || command.payload.originOperationId !== originOperationId
    || record.correctionOriginOperationId !== originOperationId
  ) {
    throw new GmMoveCorrectionDetailsUseCaseError(
      409,
      `Stored correction ${record.opId} has invalid causal ancestry.`,
    )
  }

  if (record.result.ok) {
    return {
      correctionOperationId: record.opId,
      originOperationId,
      operationIds: [...command.payload.operationIds],
      status: 'accepted',
      createdAt: record.createdAt,
      mapRevision: record.result.revision,
    }
  }
  return {
    correctionOperationId: record.opId,
    originOperationId,
    operationIds: [...command.payload.operationIds],
    status: 'conflicted',
    createdAt: record.createdAt,
    mapRevision: record.result.currentRevision ?? null,
    reasonCode: record.result.reason,
    message: record.result.message,
  }
}

/**
 * Project private compensation records into a GM-only, mechanics-free view.
 * Expected/current/restore values and source documents never cross this seam.
 */
export const getGmMoveCorrectionDetailsUseCase = (input: {
  readonly role: AuthRole
  readonly mapSlug: unknown
  readonly originOperationId: unknown
}, dependencyInput: GetGmMoveCorrectionDetailsDependencies = {}): GmMoveCorrectionDetails => {
  if (input.role !== 'gm') {
    throw new GmMoveCorrectionDetailsUseCaseError(
      403,
      'GM authorization is required for move correction details.',
    )
  }
  const identity = parseIdentity(input)
  const repository = dependencyInput.opRepository ?? createSqliteLivePlayOpRepository({
    database: dependencyInput.database ?? getRotomDatabase(),
  })
  const source = repository.getStoredOpRecord(
    identity.mapSlug,
    identity.originOperationId,
  )
  if (!source) {
    throw new GmMoveCorrectionDetailsUseCaseError(404, 'Accepted move operation was not found.')
  }
  if (!source.result.ok) {
    throw new GmMoveCorrectionDetailsUseCaseError(409, 'Only an accepted move can be inspected for correction.')
  }
  if (!source.moveCompensation) {
    throw new GmMoveCorrectionDetailsUseCaseError(
      409,
      'This accepted move has no reviewed correction metadata.',
    )
  }
  if (
    source.moveCompensation.mapSlug !== identity.mapSlug
    || source.moveCompensation.originOperationId !== identity.originOperationId
  ) {
    throw new GmMoveCorrectionDetailsUseCaseError(
      409,
      'Accepted move correction metadata has invalid causal identity.',
    )
  }

  const corrections = repository.listMoveCorrectionRecords(
    identity.mapSlug,
    identity.originOperationId,
  ).slice(-GM_MOVE_CORRECTION_DETAILS_LIMITS.correctionCount)
    .map(record => correctionHistory(record, identity.originOperationId))

  return parseGmMoveCorrectionDetails({
    schemaVersion: GM_MOVE_CORRECTION_DETAILS_SCHEMA_VERSION,
    mapSlug: identity.mapSlug,
    originOperationId: identity.originOperationId,
    moveName: moveNameFromSource(source),
    acceptedAt: source.createdAt,
    acceptedRevision: source.result.revision,
    operations: source.moveCompensation.operations.map(operationView),
    corrections,
  })
}
