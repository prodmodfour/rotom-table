import {
  parseMoveResolutionAuditTrace,
  type MoveResolutionAuditTrace,
  type MoveResolutionOperationTraceEvent,
} from '#shared/moveAutomation/trace'
import type { CharacterSheet } from '~/types/characterSheet'
import type {
  MapFieldEffects,
  MapHazardV2,
  SheetKind,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'
import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import type { EncounterState } from '#shared/moveAutomation/encounterState'
import type { TrainerSheet } from '~/types/trainerSheet'
import { sameJsonValue } from '~/utils/serialization'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  unavailableMoveStateCompensation,
  type MoveSheetStateField,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from './plan'
export interface AdaptV1ValueChange<Value> {
  readonly previous: Value
  readonly current: Value
}

export interface AdaptV1MapChanges {
  readonly placements?: AdaptV1ValueChange<readonly SheetPlacement[]>
  readonly temporaryHitPoints?: AdaptV1ValueChange<TabletopMap['temporaryHitPoints']>
  readonly moveUsage?: AdaptV1ValueChange<TabletopMap['moveUsage']>
  readonly hazards?: AdaptV1ValueChange<readonly MapHazardV2[]>
  readonly fieldEffects?: AdaptV1ValueChange<MapFieldEffects>
  readonly metadata?: AdaptV1ValueChange<TabletopMap['metadata']>
  readonly initiative?: AdaptV1ValueChange<TabletopMap['initiative']>
  readonly encounterState?: AdaptV1ValueChange<EncounterState>
}

export interface AdaptV1SheetWrite {
  readonly kind: SheetKind
  readonly slug: string
  readonly expectedRevision: number
  readonly previousSheet: CharacterSheet | TrainerSheet
  readonly nextSheet: CharacterSheet | TrainerSheet
  readonly placementIds: readonly string[]
  readonly changedFields: readonly MoveSheetStateField[]
}

export interface AdaptV1TransactionInput {
  readonly transaction: MoveAutomationTransaction
  readonly trace: MoveResolutionAuditTrace
  readonly previousMap: TabletopMap
  readonly expectedMapRevision: number
  readonly mapChanges: AdaptV1MapChanges
  readonly sheetWrites: readonly AdaptV1SheetWrite[]
}

export interface AdaptedV1Transaction {
  /** Existing v1 outcomes represented as immutable aggregate v2 state changes. */
  readonly stateChanges: MoveStateChangePlan
  /** Canonical detached trace whose operation IDs provide state-change provenance. */
  readonly trace: MoveResolutionAuditTrace
}

export type V1TransactionAdaptationErrorCode = 'trace-mismatch'

export class V1TransactionAdaptationError extends Error {
  readonly code: V1TransactionAdaptationErrorCode

  constructor(code: V1TransactionAdaptationErrorCode, message: string) {
    super(message)
    this.name = 'V1TransactionAdaptationError'
    this.code = code
  }
}

interface ExpectedTraceOperation {
  readonly operationId: string
  readonly operationKind: MoveResolutionOperationTraceEvent['operationKind']
  readonly recipientIds: readonly string[]
  readonly reasonCode: string
  readonly result: unknown
}

interface OperationProvenance {
  readonly sourceOperationId: string | null
  readonly reasonCode: string
}

interface V1OperationIdsByRecipient {
  readonly hp: ReadonlyMap<string, readonly string[]>
  readonly conditions: ReadonlyMap<string, readonly string[]>
  readonly combatStages: ReadonlyMap<string, readonly string[]>
  readonly hazards: readonly string[]
  readonly fieldEffects: readonly string[]
}

const failTraceMismatch = (message: string): never => {
  throw new V1TransactionAdaptationError('trace-mismatch', message)
}

const appendRecipientOperation = (
  operations: Map<string, string[]>,
  recipientId: string,
  operationId: string,
): void => {
  const current = operations.get(recipientId) ?? []
  current.push(operationId)
  operations.set(recipientId, current)
}

const expectedTransactionTraceOperations = (
  transaction: MoveAutomationTransaction,
): readonly ExpectedTraceOperation[] => [
  ...transaction.hpUpdates.map((update, index): ExpectedTraceOperation => ({
    operationId: `legacy-v1.hp.${index + 1}`,
    operationKind: 'direct-hp',
    recipientIds: [update.id],
    reasonCode: 'legacy-hp-update',
    result: update,
  })),
  ...transaction.conditionUpdates.map((update, index): ExpectedTraceOperation => ({
    operationId: `legacy-v1.condition.${index + 1}`,
    operationKind: 'condition',
    recipientIds: [update.id],
    reasonCode: 'legacy-condition-update',
    result: update,
  })),
  ...transaction.combatStageUpdates.map((update, index): ExpectedTraceOperation => ({
    operationId: `legacy-v1.combat-stage.${index + 1}`,
    operationKind: 'combat-stage',
    recipientIds: [update.id],
    reasonCode: 'legacy-combat-stage-update',
    result: update,
  })),
  ...transaction.hazardsToAdd.map((hazard, index): ExpectedTraceOperation => ({
    operationId: `legacy-v1.hazard.${index + 1}`,
    operationKind: 'hazard',
    recipientIds: [],
    reasonCode: 'legacy-hazard-add',
    result: hazard,
  })),
  ...transaction.fieldEffectsToApply.map((fieldEffect, index): ExpectedTraceOperation => ({
    operationId: `legacy-v1.field.${index + 1}`,
    operationKind: 'field',
    recipientIds: [],
    reasonCode: 'legacy-field-apply',
    result: fieldEffect,
  })),
  {
    operationId: 'legacy-v1.log.1',
    operationKind: 'log',
    recipientIds: [],
    reasonCode: 'legacy-log-projection',
    result: { lines: [...transaction.logLines] },
  },
]

const traceOperationEvents = (
  trace: MoveResolutionAuditTrace,
): readonly MoveResolutionOperationTraceEvent[] => trace.events.filter(
  (event): event is MoveResolutionOperationTraceEvent => event.kind === 'operation',
)

const assertTransactionTrace = (
  transaction: MoveAutomationTransaction,
  trace: MoveResolutionAuditTrace,
): ReadonlyMap<string, MoveResolutionOperationTraceEvent> => {
  if (trace.program.runtimeKind !== 'legacy-v1') {
    failTraceMismatch(
      `A v1 transaction requires a legacy-v1 trace, received ${trace.program.runtimeKind}.`,
    )
  }

  const events = traceOperationEvents(trace)
  const byId = new Map(events.map(event => [event.operationId, event]))
  for (const expected of expectedTransactionTraceOperations(transaction)) {
    const event = byId.get(expected.operationId)
      ?? failTraceMismatch(`Trace is missing transaction operation ${expected.operationId}.`)
    if (
      event.operationKind !== expected.operationKind
      || event.reasonCode !== expected.reasonCode
      || !sameJsonValue(event.recipientIds, expected.recipientIds)
      || !sameJsonValue(event.result, expected.result)
    ) {
      failTraceMismatch(`Trace operation ${expected.operationId} does not match the resolved v1 transaction.`)
    }
  }
  return byId
}

const operationIdsByRecipient = (
  transaction: MoveAutomationTransaction,
): V1OperationIdsByRecipient => {
  const hp = new Map<string, string[]>()
  transaction.hpUpdates.forEach((update, index) => {
    appendRecipientOperation(hp, update.id, `legacy-v1.hp.${index + 1}`)
  })

  const conditions = new Map<string, string[]>()
  transaction.conditionUpdates.forEach((update, index) => {
    appendRecipientOperation(conditions, update.id, `legacy-v1.condition.${index + 1}`)
  })

  const combatStages = new Map<string, string[]>()
  transaction.combatStageUpdates.forEach((update, index) => {
    appendRecipientOperation(
      combatStages,
      update.id,
      `legacy-v1.combat-stage.${index + 1}`,
    )
  })

  return {
    hp,
    conditions,
    combatStages,
    hazards: transaction.hazardsToAdd.map((_, index) => `legacy-v1.hazard.${index + 1}`),
    fieldEffects: transaction.fieldEffectsToApply.map((_, index) => `legacy-v1.field.${index + 1}`),
  }
}

const uniqueOperationIds = (operationIds: readonly string[]): readonly string[] => [
  ...new Set(operationIds),
]

const provenance = (
  operationIds: readonly string[],
  eventsById: ReadonlyMap<string, MoveResolutionOperationTraceEvent>,
  fallbackReasonCode: string,
  hasUnrepresentedContributor = false,
): OperationProvenance => {
  const unique = uniqueOperationIds(operationIds)
  if (!hasUnrepresentedContributor && unique.length === 1) {
    const event = eventsById.get(unique[0]!)
      ?? failTraceMismatch(`Trace is missing state-change source operation ${unique[0]}.`)
    return {
      sourceOperationId: event.operationId,
      reasonCode: event.reasonCode,
    }
  }
  return {
    sourceOperationId: null,
    reasonCode: fallbackReasonCode,
  }
}

const changedPlacementPairs = (
  previous: readonly SheetPlacement[],
  current: readonly SheetPlacement[],
): readonly {
  readonly placementId: string
  readonly previous: SheetPlacement | null
  readonly current: SheetPlacement | null
}[] => {
  const previousById = new Map(previous.map(placement => [placement.id, placement]))
  const currentById = new Map(current.map(placement => [placement.id, placement]))
  const pairs: Array<{
    readonly placementId: string
    readonly previous: SheetPlacement | null
    readonly current: SheetPlacement | null
  }> = []

  for (const placement of current) {
    const prior = previousById.get(placement.id) ?? null
    if (!sameJsonValue(prior, placement)) {
      pairs.push({ placementId: placement.id, previous: prior, current: placement })
    }
  }
  for (const placement of previous) {
    if (!currentById.has(placement.id)) {
      pairs.push({ placementId: placement.id, previous: placement, current: null })
    }
  }
  return pairs
}

const temporaryHpChangedPlacementIds = (
  change: AdaptV1ValueChange<TabletopMap['temporaryHitPoints']>,
): readonly string[] => {
  const placementIds = new Set([
    ...Object.keys(change.previous?.byPlacementId ?? {}),
    ...Object.keys(change.current?.byPlacementId ?? {}),
  ])
  return [...placementIds].filter(placementId => (
    (change.previous?.byPlacementId[placementId] ?? 0)
    !== (change.current?.byPlacementId[placementId] ?? 0)
  ))
}

const sheetOperationProvenance = (options: {
  readonly write: AdaptV1SheetWrite
  readonly operationIds: V1OperationIdsByRecipient
  readonly eventsById: ReadonlyMap<string, MoveResolutionOperationTraceEvent>
}): OperationProvenance => {
  const ids: string[] = []
  let hasUnrepresentedContributor = false
  const appendForPlacements = (byRecipient: ReadonlyMap<string, readonly string[]>): void => {
    for (const placementId of options.write.placementIds) {
      ids.push(...(byRecipient.get(placementId) ?? []))
    }
  }

  for (const field of options.write.changedFields) {
    const beforeCount = ids.length
    if (field === 'hp') appendForPlacements(options.operationIds.hp)
    else if (field === 'conditions') appendForPlacements(options.operationIds.conditions)
    else if (field === 'combatStages') appendForPlacements(options.operationIds.combatStages)
    else hasUnrepresentedContributor = true
    if (field !== 'moveUsage' && ids.length === beforeCount) hasUnrepresentedContributor = true
  }

  return provenance(
    ids,
    options.eventsById,
    'legacy-v1-sheet-state',
    hasUnrepresentedContributor,
  )
}

const adaptedStateChanges = (options: {
  readonly transaction: MoveAutomationTransaction
  readonly traceEventsById: ReadonlyMap<string, MoveResolutionOperationTraceEvent>
  readonly previousMap: TabletopMap
  readonly expectedMapRevision: number
  readonly mapChanges: AdaptV1MapChanges
  readonly sheetWrites: readonly AdaptV1SheetWrite[]
}): MoveStateChangePlan => {
  const inputs: MoveStateChangeInput[] = []
  const operationIds = operationIdsByRecipient(options.transaction)
  const mapScope = { kind: 'map' as const, mapSlug: options.previousMap.slug }
  const commonMapChange = {
    scope: mapScope,
    expectedRevision: options.expectedMapRevision,
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }

  if (options.mapChanges.moveUsage) {
    inputs.push({
      ...commonMapChange,
      kind: 'map-move-usage',
      sourceOperationId: null,
      reasonCode: 'legacy-v1-move-usage',
      previous: options.mapChanges.moveUsage.previous,
      current: options.mapChanges.moveUsage.current,
    })
  }
  if (options.mapChanges.temporaryHitPoints) {
    const changedPlacementIds = temporaryHpChangedPlacementIds(
      options.mapChanges.temporaryHitPoints,
    )
    const source = provenance(
      changedPlacementIds.flatMap(placementId => operationIds.hp.get(placementId) ?? []),
      options.traceEventsById,
      'legacy-v1-temporary-hit-points',
      changedPlacementIds.length === 0,
    )
    inputs.push({
      ...commonMapChange,
      kind: 'map-temporary-hit-points',
      ...source,
      previous: options.mapChanges.temporaryHitPoints.previous,
      current: options.mapChanges.temporaryHitPoints.current,
    })
  }
  if (options.mapChanges.placements) {
    for (const pair of changedPlacementPairs(
      options.mapChanges.placements.previous,
      options.mapChanges.placements.current,
    )) {
      const matchingMovement = [...options.traceEventsById.values()].filter(event => (
        event.operationKind === 'movement-request'
        && event.recipientIds.includes(pair.placementId)
      ))
      const source = provenance(
        matchingMovement.map(event => event.operationId),
        options.traceEventsById,
        'legacy-v1-placement-transition',
      )
      inputs.push({
        kind: 'placement-state',
        scope: {
          kind: 'placement',
          mapSlug: options.previousMap.slug,
          placementId: pair.placementId,
        },
        expectedRevision: options.expectedMapRevision,
        ...source,
        previous: pair.previous,
        current: pair.current,
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      })
    }
  }
  if (options.mapChanges.hazards) {
    const source = provenance(
      operationIds.hazards,
      options.traceEventsById,
      'legacy-v1-hazards',
      operationIds.hazards.length === 0,
    )
    inputs.push({
      ...commonMapChange,
      kind: 'map-hazards',
      ...source,
      previous: options.mapChanges.hazards.previous,
      current: options.mapChanges.hazards.current,
    })
  }
  if (options.mapChanges.encounterState) {
    const encounterOperationIds = [
      ...operationIds.fieldEffects,
      ...[...operationIds.conditions.values()].flat(),
    ]
    const source = provenance(
      encounterOperationIds,
      options.traceEventsById,
      'legacy-v1-encounter-state',
      encounterOperationIds.length === 0,
    )
    inputs.push({
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: options.previousMap.slug },
      expectedRevision: options.expectedMapRevision,
      ...source,
      previous: options.mapChanges.encounterState.previous,
      current: options.mapChanges.encounterState.current,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  if (options.mapChanges.fieldEffects) {
    const source = provenance(
      operationIds.fieldEffects,
      options.traceEventsById,
      'legacy-v1-field-effects',
      operationIds.fieldEffects.length === 0,
    )
    inputs.push({
      ...commonMapChange,
      kind: 'map-field-effects',
      ...source,
      previous: options.mapChanges.fieldEffects.previous,
      current: options.mapChanges.fieldEffects.current,
    })
  }
  if (options.mapChanges.metadata) {
    const source = provenance(
      ['legacy-v1.log.1'],
      options.traceEventsById,
      'legacy-v1-log-projection',
    )
    inputs.push({
      ...commonMapChange,
      kind: 'map-metadata',
      ...source,
      previous: options.mapChanges.metadata.previous,
      current: options.mapChanges.metadata.current,
      compensation: unavailableMoveStateCompensation(
        'accepted-log-may-be-observed',
        'externally-observed',
      ),
    })
  }

  for (const write of options.sheetWrites) {
    const source = sheetOperationProvenance({
      write,
      operationIds,
      eventsById: options.traceEventsById,
    })
    inputs.push({
      kind: 'sheet-state',
      scope: {
        kind: 'sheet',
        sheetKind: write.kind,
        sheetSlug: write.slug,
      },
      expectedRevision: write.expectedRevision,
      ...source,
      previous: write.previousSheet,
      current: write.nextSheet,
      changedFields: write.changedFields,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }

  return createMoveStateChangePlan(inputs)
}

/**
 * Adapt already-resolved v1 outcomes into the same aggregate state-plan
 * contract used by v2 reducers. The adapter links exact transaction fields to
 * their trace operation IDs; it never reruns mechanics or parses log prose.
 */
export const adaptV1Transaction = (
  input: AdaptV1TransactionInput,
): AdaptedV1Transaction => {
  const trace = parseMoveResolutionAuditTrace(input.trace)
  const traceEventsById = assertTransactionTrace(input.transaction, trace)
  const stateChanges = adaptedStateChanges({
    transaction: input.transaction,
    traceEventsById,
    previousMap: input.previousMap,
    expectedMapRevision: input.expectedMapRevision,
    mapChanges: input.mapChanges,
    sheetWrites: input.sheetWrites,
  })
  return Object.freeze({ stateChanges, trace })
}
