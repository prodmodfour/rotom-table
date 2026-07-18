import { isRevision, nextRevision } from '#shared/sessionRevisions'
import {
  PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
  parsePendingMoveResolution,
  type PendingMoveResolution,
  type PendingMoveResolutionPublicSummary,
  type PendingMoveResolutionResourceRead,
  type PendingMoveResponseWindow,
} from '#shared/moveAutomation/pendingResolution'
import type {
  MoveHazardCellSelectionWindow,
} from '#shared/moveAutomation/hazardCellSelection'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import { sameJsonValue } from '~/utils/serialization'
import type { TabletopMap } from '~/types/map'
import type { AuthoritativeMoveSheetRead } from './context'
import { deduplicateAuthoritativeMoveSheetReads } from './context'
import type {
  MoveSpecDeferredContinuation,
  MoveSpecExecutionPendingResult,
} from './executeSpec'
import type { MoveStateChangePlan } from './plan'
import type { ValidatedMoveSpecDefinition } from './validateSpec'
import { moveResourceCostsInPhaseWindow } from './planMoveResources'
import { materializeAuthoritativeHazardCellSelection } from './hazardCellSelection'
import {
  deduplicateAuthoritativeMoveGroupInventoryReads,
  type AuthoritativeMoveGroupInventoryRead,
} from './itemResources'

export type MoveSpecSuspensionMaterializationErrorCode =
  | 'invalid-continuation-revision'
  | 'pre-window-plan-invalid'
  | 'read-set-revision-conflict'
  | 'response-owner-missing'
  | 'hazard-cell-context-mismatch'

export class MoveSpecSuspensionMaterializationError extends Error {
  readonly code: MoveSpecSuspensionMaterializationErrorCode

  constructor(code: MoveSpecSuspensionMaterializationErrorCode, message: string) {
    super(message)
    this.name = 'MoveSpecSuspensionMaterializationError'
    this.code = code
  }
}

export interface MaterializedMoveSpecSuspension {
  /** Strict, bounded record ready for the pending-resolution repository. */
  readonly pendingResolution: PendingMoveResolution
  /** The exact nested projection used for map-visible encounter state. */
  readonly publicSummary: PendingMoveResolutionPublicSummary
  /** State mutations explicitly approved to commit with suspension creation. */
  readonly preWindowPlan: MoveStateChangePlan
  /** Evaluated ordinary work that remains non-committing until resume. */
  readonly deferredContinuation: MoveSpecDeferredContinuation
}

export interface MaterializeMoveSpecSuspensionInput {
  readonly resolutionId: string
  readonly originOpId: string
  readonly definition: ValidatedMoveSpecDefinition
  readonly originMapSlug: string
  readonly originMapRevision: number
  /** Immutable creation snapshot required only for server-owned spatial options. */
  readonly authoritativeMap?: TabletopMap
  readonly actorPlacementId: string
  readonly suspendedAt: number
  readonly authoritativeSheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly authoritativeGroupInventoryReads?: readonly AuthoritativeMoveGroupInventoryRead[]
  readonly execution: MoveSpecExecutionPendingResult
  /** Map revision visible after the summary and pre-window plan commit together. */
  readonly continuationMapRevision: number
  readonly preWindowPlan: MoveStateChangePlan
}

const fail = (
  code: MoveSpecSuspensionMaterializationErrorCode,
  message: string,
): never => {
  throw new MoveSpecSuspensionMaterializationError(code, message)
}

const sheetReadKey = (
  read: Pick<AuthoritativeMoveSheetRead, 'kind' | 'slug'>,
): string => `${read.kind}:${read.slug}`

const assertPlanOperationSources = (input: MaterializeMoveSpecSuspensionInput): void => {
  const allowedOperationIds = new Set<string>()
  for (const emission of input.execution.preWindowOperations) {
    const operation = emission.operation
    if (
      operation.kind !== 'direct-hp'
      || operation.phase !== 'pay'
      || operation.payload.cost?.timing !== 'declaration'
    ) {
      fail(
        'pre-window-plan-invalid',
        `Operation ${operation.id} is not an explicit pay-phase declaration HP cost.`,
      )
    }
    allowedOperationIds.add(operation.id)
  }
  const allowedCostIds = new Set(moveResourceCostsInPhaseWindow(
    input.definition.spec.costs,
    { maximumPhaseInclusive: input.execution.request.phase },
  ).map(cost => cost.id))
  for (const change of input.preWindowPlan.changes) {
    if (
      change.kind !== 'sheet-state'
      && change.kind !== 'map-temporary-hit-points'
      && change.kind !== 'encounter-state'
    ) {
      fail(
        'pre-window-plan-invalid',
        `Declaration HP cost cannot produce pre-window state change ${change.kind}.`,
      )
    }
    if (
      change.kind === 'sheet-state'
      && change.changedFields.some(field => field !== 'hp')
    ) {
      fail(
        'pre-window-plan-invalid',
        `Declaration HP cost cannot change non-HP sheet fields in ${change.id}.`,
      )
    }
    const effectSource = change.sourceOperationId !== null
      && allowedOperationIds.has(change.sourceOperationId)
    const resourceCostSource = change.sourceOperationId !== null
      && allowedCostIds.has(change.sourceOperationId)
    if (!effectSource && !resourceCostSource) {
      fail(
        'pre-window-plan-invalid',
        `Pre-window state change ${change.id} is not sourced by an interpreter-approved operation or reviewed resource cost.`,
      )
    }
    if (resourceCostSource) {
      if (change.kind !== 'encounter-state') {
        fail(
          'pre-window-plan-invalid',
          `Resource cost ${change.sourceOperationId} may change only encounter turn resources.`,
        )
      }
      const previous = parseEncounterState(
        change.previous ?? createEmptyEncounterState(),
      )
      const current = parseEncounterState(
        change.current ?? createEmptyEncounterState(),
      )
      if (!sameJsonValue(previous, { ...current, turnResources: previous.turnResources })) {
        fail(
          'pre-window-plan-invalid',
          `Resource cost ${change.sourceOperationId} changed state outside encounter turn resources.`,
        )
      }
    }
    if (
      (change.scope.kind === 'map'
        || change.scope.kind === 'encounter'
        || change.scope.kind === 'placement')
      && change.scope.mapSlug !== input.originMapSlug
    ) {
      fail(
        'pre-window-plan-invalid',
        `Pre-window state change ${change.id} belongs to a different map.`,
      )
    }
  }
}

const continuationReadSet = (
  input: MaterializeMoveSpecSuspensionInput,
): readonly PendingMoveResolutionResourceRead[] => {
  const originMapRevision = input.originMapRevision
  if (
    !isRevision(originMapRevision)
    || !isRevision(input.continuationMapRevision)
    || input.continuationMapRevision !== nextRevision(originMapRevision)
  ) {
    return fail(
      'invalid-continuation-revision',
      'A suspension must advance the originating map revision exactly once.',
    )
  }

  const sheetReads = deduplicateAuthoritativeMoveSheetReads([
    ...input.execution.sheetReads,
    ...input.authoritativeSheetReads,
  ])
  const originalSheetRevisions = new Map(
    sheetReads.map(read => [sheetReadKey(read), read.revision]),
  )
  const committedSheetRevisions = new Map<string, number>()

  for (const change of input.preWindowPlan.changes) {
    if (
      (change.scope.kind === 'map'
        || change.scope.kind === 'encounter'
        || change.scope.kind === 'placement')
      && change.expectedRevision !== originMapRevision
    ) {
      fail(
        'read-set-revision-conflict',
        `Pre-window map state expected revision ${change.expectedRevision}, not ${originMapRevision}.`,
      )
    }
    if (change.kind === 'sheet-state') {
      const key = `${change.scope.sheetKind}:${change.scope.sheetSlug}`
      const observedRevision = originalSheetRevisions.get(key)
      if (observedRevision !== undefined && observedRevision !== change.expectedRevision) {
        fail(
          'read-set-revision-conflict',
          `Pre-window sheet ${key} was read at revision ${observedRevision} but planned from ${change.expectedRevision}.`,
        )
      }
      committedSheetRevisions.set(key, change.current.revision ?? nextRevision(change.expectedRevision))
      if (observedRevision === undefined) {
        sheetReads.push({
          kind: change.scope.sheetKind,
          slug: change.scope.sheetSlug,
          revision: change.expectedRevision,
        })
      }
    }
  }

  const groupInventoryReads = deduplicateAuthoritativeMoveGroupInventoryReads(
    input.authoritativeGroupInventoryReads ?? [],
  )
  return [
    {
      kind: 'map',
      slug: input.originMapSlug,
      revision: input.continuationMapRevision,
    },
    ...sheetReads.map((read): PendingMoveResolutionResourceRead => ({
      kind: 'sheet',
      sheetKind: read.kind,
      slug: read.slug,
      revision: committedSheetRevisions.get(sheetReadKey(read)) ?? read.revision,
    })),
    ...groupInventoryReads.map((read): PendingMoveResolutionResourceRead => ({
      kind: 'group-inventory',
      slug: read.slug,
      revision: read.revision,
    })),
  ]
}

const responseOwnership = (
  execution: MoveSpecExecutionPendingResult,
  actorPlacementId: string,
): PendingMoveResponseWindow['ownership'] => {
  const owners = [] as Array<PendingMoveResponseWindow['ownership'][number]>
  const seen = new Set<string>()
  for (const placementId of execution.request.recipientIds) {
    const owner = placementId === actorPlacementId
      ? { kind: 'actor' as const, id: null }
      : { kind: 'target' as const, id: placementId }
    const key = `${owner.kind}:${owner.id ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    owners.push(owner)
  }
  if (owners.length === 0) {
    fail(
      'response-owner-missing',
      `Pending request ${execution.request.requestId} has no authoritative response owner.`,
    )
  }
  return owners
}

const hazardCellSelectionWindow = (
  input: MaterializeMoveSpecSuspensionInput,
): MoveHazardCellSelectionWindow | undefined => {
  const request = input.execution.request
  if (request.kind !== 'hazard-cell-choice') return undefined

  const map = input.authoritativeMap ?? fail(
    'hazard-cell-context-mismatch',
    'Hazard-cell suspension requires its immutable authoritative map snapshot.',
  )
  if (
    map.slug !== input.originMapSlug
    || (map.revision ?? 0) !== input.originMapRevision
  ) {
    fail(
      'hazard-cell-context-mismatch',
      'Hazard-cell suspension map identity must match the originating authoritative snapshot.',
    )
  }
  const actor = map.placements.find(placement => placement.id === input.actorPlacementId)
    ?? fail(
      'response-owner-missing',
      `Hazard selection actor ${input.actorPlacementId} is missing from the authoritative map.`,
    )

  return materializeAuthoritativeHazardCellSelection({
    map: { ...map, revision: input.continuationMapRevision },
    declaration: {
      schemaVersion: 1,
      windowId: request.requestId,
      promptKey: request.promptKey,
      map: {
        slug: input.originMapSlug,
        revision: input.continuationMapRevision,
      },
      move: {
        resolutionId: input.resolutionId,
        actorPlacementId: input.actorPlacementId,
        canonicalMoveId: input.definition.spec.canonicalId,
        operationId: request.operationId,
        cellSetId: request.cellSetId,
      },
      constraints: {
        count: request.selection.count,
        range: request.selection.range,
        adjacency: request.selection.adjacency,
        connectedness: request.selection.connectedness,
        occupancy: request.selection.occupancy,
        geometry: request.selection.geometry,
        origin: actor.position,
      },
    },
  }).window
}

const responseWindow = (
  input: MaterializeMoveSpecSuspensionInput,
): PendingMoveResponseWindow => {
  const execution = input.execution
  const request = execution.request
  const hazardCellSelection = hazardCellSelectionWindow(input)
  const common = {
    windowId: request.requestId,
    operationId: request.operationId,
    phase: request.phase,
    reasonCode: request.reasonCode,
    promptKey: request.promptKey,
    ownership: responseOwnership(execution, input.actorPlacementId),
    options: hazardCellSelection
      ? hazardCellSelection.options.map(option => ({
          id: option.id,
          labelKey: 'move.hazard.select-cell',
        }))
      : request.options.map(option => ({ ...option })),
  }
  return request.kind === 'reaction'
    ? {
        ...common,
        kind: 'reaction',
        allowPass: true,
        timing: request.timing,
        priority: request.priority,
        depth: request.depth,
      }
    : {
        ...common,
        kind: 'choice',
        allowPass: request.allowPass,
        priority: null,
        ...(hazardCellSelection ? { hazardCellSelection } : {}),
      }
}

/**
 * Assemble one repository-free, persistence-ready interpreter suspension.
 * Strict pending parsing cross-checks identity, trace, rolls, ancestry, window,
 * read-set, and public-summary fields before this boundary returns.
 */
export const materializeMoveSpecSuspension = (
  input: MaterializeMoveSpecSuspensionInput,
): MaterializedMoveSpecSuspension => {
  assertPlanOperationSources(input)
  const request = input.execution.request
  const publicSummary = {
    schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
    resolutionId: input.resolutionId,
    actorPlacementId: input.actorPlacementId,
    canonicalMoveId: input.definition.spec.canonicalId,
    phase: request.phase,
    status: 'pending' as const,
    outstandingWindowCount: 1,
    createdAt: input.suspendedAt,
    updatedAt: input.suspendedAt,
  }
  const pendingResolution = parsePendingMoveResolution({
    schemaVersion: PENDING_MOVE_RESOLUTION_SCHEMA_VERSION,
    continuationKind: 'movespec-v2',
    resolutionId: input.resolutionId,
    originMapSlug: input.originMapSlug,
    originOpId: input.originOpId,
    actorPlacementId: input.actorPlacementId,
    canonicalMoveId: input.definition.spec.canonicalId,
    specVersion: input.definition.spec.version,
    specHash: input.definition.definitionHash,
    rulesetId: input.definition.rulesetVersion.rulesetId,
    rulesetHash: input.definition.rulesetVersion.sourceDataSha256,
    phase: request.phase,
    readSet: continuationReadSet(input),
    trace: input.execution.trace,
    rollLedger: input.execution.rollLedger,
    outstandingWindows: [responseWindow(input)],
    chosenOptions: [],
    causalAncestry: input.execution.trace.ancestry,
    status: 'pending',
    createdAt: input.suspendedAt,
    updatedAt: input.suspendedAt,
    publicSummary,
  })

  return Object.freeze({
    pendingResolution,
    publicSummary: pendingResolution.publicSummary,
    preWindowPlan: input.preWindowPlan,
    deferredContinuation: input.execution.deferredContinuation,
  })
}
