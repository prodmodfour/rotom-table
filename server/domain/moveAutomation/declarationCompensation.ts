import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  parsePendingMoveResolution,
  type PendingMoveResolution,
  type PendingMoveResolutionTerminalStatus,
} from '#shared/moveAutomation/pendingResolution'
import { reduceMoveResolutionTrace } from './trace'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetKind, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import {
  createMoveStateChangePlan,
  unavailableMoveStateCompensation,
  type MoveSheetDocument,
  type MoveStateChange,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from './plan'

export type PendingResolutionTerminationStatus = Extract<
  PendingMoveResolutionTerminalStatus,
  'cancelled' | 'expired' | 'abandoned'
>

export type DeclarationCompensationErrorCode =
  | 'unknown-compensation-plan'
  | 'unsupported-compensation-change'
  | 'pending-summary-missing'
  | 'compensation-value-conflict'
  | 'compensation-sheet-missing'

export class DeclarationCompensationError extends Error {
  readonly code: DeclarationCompensationErrorCode

  constructor(code: DeclarationCompensationErrorCode, message: string) {
    super(message)
    this.name = 'DeclarationCompensationError'
    this.code = code
  }
}

export interface PendingResolutionTerminationSheetWrite {
  readonly kind: SheetKind
  readonly slug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly nextSheet: CharacterSheet | TrainerSheet
}

export interface PendingResolutionTerminationPlan {
  readonly pendingResolution: PendingMoveResolution
  /** Map projection before the caller applies its one authoritative revision advance. */
  readonly nextMap: TabletopMap
  readonly sheetWrites: readonly PendingResolutionTerminationSheetWrite[]
  /** Exact typed inverse work executed for declaration-time costs. */
  readonly compensationPlan: MoveStateChangePlan<EncounterState>
}

export interface PlanPendingResolutionTerminationInput {
  readonly pendingResolution: PendingMoveResolution
  /** Null means a pre-MA-106 row whose declaration cost safety is unknown. */
  readonly declarationPlan: MoveStateChangePlan | null
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly status: PendingResolutionTerminationStatus
  readonly reasonCode: string
  readonly sourceOperationId: string
  readonly terminatedAt: number
  /** Explicit abandonment never rewrites a resource whose inverse is unknown. */
  readonly compensateDeclarationCosts?: boolean
}

type JsonRecord = Record<string, unknown>

const fail = (
  code: DeclarationCompensationErrorCode,
  message: string,
): never => {
  throw new DeclarationCompensationError(code, message)
}

const isRecord = (value: unknown): value is JsonRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

/** Rebuild and freeze repository JSON through the typed state-plan validator. */
export const normalizeDeclarationCompensationPlan = (
  value: unknown,
): MoveStateChangePlan => {
  if (!isRecord(value) || !Array.isArray(value.changes)) {
    throw new Error('Declaration compensation plan must be a typed state-change plan.')
  }
  return createMoveStateChangePlan(
    value.changes.map((entry) => {
      if (!isRecord(entry)) {
        throw new Error('Declaration compensation plan changes must be objects.')
      }
      const { id: _id, order: _order, ...input } = entry
      return input as MoveStateChangeInput
    }),
  )
}

const withoutPlanIdentity = (
  change: MoveStateChange,
): MoveStateChangeInput => {
  const { id: _id, order: _order, ...input } = change
  return deepCloneJson(input) as MoveStateChangeInput
}

const withoutPendingSummary = (
  state: EncounterState,
  resolutionId: string,
): EncounterState => parseEncounterState({
  ...state,
  pendingResolutionSummaries: state.pendingResolutionSummaries.filter(
    summary => summary.resolutionId !== resolutionId,
  ),
})

/**
 * Fold resource costs committed while opening a later response window into
 * the original declaration compensation plan. The additional plan may own
 * only encounter turn resources; pending summaries remain terminal saga state.
 */
export const appendPendingDeclarationResourcePlan = (input: {
  readonly existing: MoveStateChangePlan | null | undefined
  readonly additional: MoveStateChangePlan
  readonly resolutionId: string
}): MoveStateChangePlan => {
  const existing = input.existing
    ?? fail(
      'unknown-compensation-plan',
      `Pending resolution ${input.resolutionId} has no durable declaration plan.`,
    )
  if (input.additional.changes.length === 0) return existing
  if (
    input.additional.changes.length !== 1
    || input.additional.changes[0]?.kind !== 'encounter-state'
  ) {
    return fail(
      'unsupported-compensation-change',
      'A resumed pending window may append only an encounter-resource declaration plan.',
    )
  }

  const additional = input.additional.changes[0]
  const additionalPrevious = parseEncounterState(additional.previous)
  const additionalCurrent = parseEncounterState(additional.current)
  if (!sameJsonValue(
    { ...additionalPrevious, turnResources: {} },
    { ...additionalCurrent, turnResources: {} },
  )) {
    return fail(
      'unsupported-compensation-change',
      'A resumed pending resource plan changed state outside encounter turn resources.',
    )
  }

  const inputs = existing.changes
    .filter(change => change.kind !== 'encounter-state')
    .map(withoutPlanIdentity)
  const existingEncounter = existing.changes.find(
    change => change.kind === 'encounter-state',
  )
  const previous = existingEncounter
    ? parseEncounterState(existingEncounter.previous)
    : withoutPendingSummary(additionalPrevious, input.resolutionId)
  const currentBase = existingEncounter
    ? parseEncounterState(existingEncounter.current)
    : withoutPendingSummary(additionalPrevious, input.resolutionId)
  const mapExpectation = existing.expectedRevisions.find(
    revision => revision.kind === 'map',
  )
  inputs.push({
    kind: 'encounter-state',
    scope: { kind: 'encounter', mapSlug: additional.scope.mapSlug },
    expectedRevision: mapExpectation?.expectedRevision ?? additional.expectedRevision,
    sourceOperationId: existingEncounter ? null : additional.sourceOperationId,
    reasonCode: existingEncounter
      ? 'pending-resolution-phased-resource-costs'
      : additional.reasonCode,
    previous: deepCloneJson(previous),
    current: parseEncounterState({
      ...currentBase,
      turnResources: deepCloneJson(additionalCurrent.turnResources),
    }),
    compensation: existingEncounter?.compensation ?? additional.compensation,
  })
  return createMoveStateChangePlan(inputs)
}

const pendingSummaryRemoved = (
  state: EncounterState,
  resolutionId: string,
): EncounterState => {
  if (!state.pendingResolutionSummaries.some(summary => summary.resolutionId === resolutionId)) {
    return fail(
      'pending-summary-missing',
      `Pending resolution ${resolutionId} has no authoritative map summary.`,
    )
  }
  return parseEncounterState({
    ...state,
    pendingResolutionSummaries: state.pendingResolutionSummaries.filter(
      summary => summary.resolutionId !== resolutionId,
    ),
  })
}

/**
 * Apply only leaves changed by the typed declaration operation. Unrelated
 * current values survive; a changed owned leaf fails closed unless it still
 * equals the declaration's recorded after-value.
 */
const restoreTypedDelta = (
  live: unknown,
  before: unknown,
  after: unknown,
  path: string,
): unknown => {
  if (sameJsonValue(before, after)) return deepCloneJson(live)
  if (isRecord(before) && isRecord(after) && isRecord(live)) {
    const restored: JsonRecord = { ...deepCloneJson(live) }
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const key of keys) {
      if (key === 'revision' || key === 'updatedAt') continue
      const value = restoreTypedDelta(
        live[key],
        before[key],
        after[key],
        `${path}.${key}`,
      )
      if (value === undefined) delete restored[key]
      else restored[key] = value
    }
    return restored
  }
  if (!sameJsonValue(live, after)) {
    return fail(
      'compensation-value-conflict',
      `Declaration compensation expected ${path} to retain its recorded after-value.`,
    )
  }
  return deepCloneJson(before)
}

const sheetForChange = (input: {
  readonly change: Extract<MoveStateChange, { readonly kind: 'sheet-state' }>
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
}): MoveSheetDocument => {
  const sheet = input.change.scope.sheetKind === 'pokemon'
    ? input.pokemonSheets.get(input.change.scope.sheetSlug)
    : input.trainerSheets.get(input.change.scope.sheetSlug)
  if (!sheet) {
    return fail(
      'compensation-sheet-missing',
      `${input.change.scope.sheetKind} sheet ${input.change.scope.sheetSlug} is unavailable for declaration compensation.`,
    )
  }
  return sheet
}

const terminalAuditTrace = (input: PlanPendingResolutionTerminationInput) => (
  reduceMoveResolutionTrace(input.pendingResolution.trace, {
    kind: 'operation',
    phase: input.pendingResolution.phase,
    operationId: input.sourceOperationId,
    operationKind: 'log',
    recipientIds: [input.pendingResolution.actorPlacementId],
    outcome: 'applied',
    reasonCode: input.reasonCode,
    input: {
      action: 'terminate-pending-resolution',
      status: input.status,
    },
    result: {
      cancelledWindowCount: input.pendingResolution.outstandingWindows.length,
      declarationCompensation: input.compensateDeclarationCosts === false
        ? 'explicitly-abandoned'
        : 'applied',
    },
  })
)

const terminalResolution = (
  input: PlanPendingResolutionTerminationInput,
): PendingMoveResolution => {
  const trace = terminalAuditTrace(input)
  return parsePendingMoveResolution({
    ...input.pendingResolution,
    trace,
    outstandingWindows: [],
    status: input.status,
    updatedAt: input.terminatedAt,
    publicSummary: {
      ...input.pendingResolution.publicSummary,
      status: input.status,
      outstandingWindowCount: 0,
      updatedAt: input.terminatedAt,
    },
  })
}

/**
 * Plan one safe pending-resolution termination. Declaration costs are inverted
 * as typed state changes against their exact currently-owned values; no whole
 * resource snapshot is restored.
 */
export const planPendingResolutionTermination = (
  input: PlanPendingResolutionTerminationInput,
): PendingResolutionTerminationPlan => {
  const compensate = input.compensateDeclarationCosts !== false
  if (compensate && input.declarationPlan === null) {
    return fail(
      'unknown-compensation-plan',
      `Pending resolution ${input.pendingResolution.resolutionId} predates durable declaration compensation metadata.`,
    )
  }

  let workingMap = deepCloneJson(input.map)
  const initialEncounterState = parseEncounterState(
    workingMap.encounterState ?? createEmptyEncounterState(),
  )
  const pokemonSheets = new Map(input.pokemonSheets)
  const trainerSheets = new Map(input.trainerSheets)
  const inverseInputs: MoveStateChangeInput<EncounterState>[] = []
  const sheetWrites: PendingResolutionTerminationSheetWrite[] = []

  for (const change of [...(input.declarationPlan?.changes ?? [])].reverse()) {
    if (!compensate) break
    if (change.kind === 'map-temporary-hit-points') {
      const previous = deepCloneJson(workingMap.temporaryHitPoints)
      const current = restoreTypedDelta(
        previous,
        change.previous,
        change.current,
        'map.temporaryHitPoints',
      ) as TabletopMap['temporaryHitPoints']
      workingMap.temporaryHitPoints = deepCloneJson(current)
      inverseInputs.push({
        kind: change.kind,
        scope: deepCloneJson(change.scope),
        expectedRevision: normalizeRevision(input.map.revision),
        sourceOperationId: input.sourceOperationId,
        reasonCode: input.reasonCode,
        previous,
        current,
        compensation: unavailableMoveStateCompensation(
          'declaration-cost-already-compensated',
          'irreversible',
        ),
      })
      continue
    }
    if (change.kind === 'encounter-state') {
      const previous = parseEncounterState(
        workingMap.encounterState ?? createEmptyEncounterState(),
      )
      const current = parseEncounterState(restoreTypedDelta(
        previous,
        change.previous,
        change.current,
        'map.encounterState',
      ))
      workingMap.encounterState = current
      continue
    }
    if (change.kind === 'sheet-state') {
      const live = deepCloneJson(sheetForChange({ change, pokemonSheets, trainerSheets }))
      const expectedRevision = normalizeRevision(live.revision)
      const restored = restoreTypedDelta(
        live,
        change.previous,
        change.current,
        `${change.scope.sheetKind}:${change.scope.sheetSlug}`,
      ) as MoveSheetDocument
      const current = {
        ...restored,
        slug: change.scope.sheetSlug,
        revision: nextRevision(expectedRevision),
        updatedAt: input.terminatedAt,
      } as unknown as MoveSheetDocument
      const inverse: MoveStateChangeInput<EncounterState> = {
        kind: change.kind,
        scope: deepCloneJson(change.scope),
        expectedRevision,
        sourceOperationId: input.sourceOperationId,
        reasonCode: input.reasonCode,
        previous: live,
        current,
        changedFields: [...change.changedFields],
        compensation: unavailableMoveStateCompensation(
          'declaration-cost-already-compensated',
          'irreversible',
        ),
      }
      inverseInputs.push(inverse)
      const write = {
        kind: change.scope.sheetKind,
        slug: change.scope.sheetSlug,
        expectedRevision,
        revision: current.revision ?? nextRevision(expectedRevision),
        nextSheet: deepCloneJson(current),
      } satisfies PendingResolutionTerminationSheetWrite
      sheetWrites.push(write)
      if (write.kind === 'pokemon') pokemonSheets.set(write.slug, write.nextSheet as CharacterSheet)
      else trainerSheets.set(write.slug, write.nextSheet as TrainerSheet)
      continue
    }
    return fail(
      'unsupported-compensation-change',
      `Declaration compensation cannot invert state change ${change.kind}.`,
    )
  }

  const previousEncounterState = parseEncounterState(
    workingMap.encounterState ?? createEmptyEncounterState(),
  )
  const currentEncounterState = pendingSummaryRemoved(
    previousEncounterState,
    input.pendingResolution.resolutionId,
  )
  workingMap.encounterState = currentEncounterState
  inverseInputs.push({
    kind: 'encounter-state',
    scope: { kind: 'encounter', mapSlug: workingMap.slug },
    expectedRevision: normalizeRevision(input.map.revision),
    sourceOperationId: input.sourceOperationId,
    reasonCode: input.reasonCode,
    previous: initialEncounterState,
    current: currentEncounterState,
    compensation: unavailableMoveStateCompensation(
      'pending-summary-termination-is-terminal',
      'irreversible',
    ),
  })

  return Object.freeze({
    pendingResolution: terminalResolution(input),
    nextMap: deepCloneJson(workingMap),
    sheetWrites: deepCloneJson(sheetWrites),
    compensationPlan: createMoveStateChangePlan(inverseInputs),
  })
}
