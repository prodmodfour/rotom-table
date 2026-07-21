import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import {
  MOVE_PERMANENT_MOVE_LIST_LIMITS,
  type MovePermanentMoveAcquisition,
  type PermanentMoveListEntryProvenance,
} from '#shared/moveAutomation/permanentMoveLists'
import {
  MOVE_EFFECT_OPERATION_LIMITS,
  type MovePermanentMoveListEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  parseMoveResolutionAuditTrace,
  type MoveResolutionAuditTrace,
} from '#shared/moveAutomation/trace'
import { findMove } from '~~/data/ptuReference'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { PtuMove } from '~/types/ptuReference'
import type { SheetKind, SheetPlacement } from '~/types/map'
import type { TrainerMove, TrainerSheet } from '~/types/trainerSheet'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from '../context'
import type { MoveSpecEmittedOperation } from '../executeSpec'
import {
  createMoveStateChangePlan,
  unavailableMoveStateCompensation,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../plan'
import {
  canonicalMoveEffectPlacementIds,
  expectedMoveEffectRecipientIds,
  moveEffectRecipientIdsEqual,
  resolveMoveEffectDynamicRecipients,
  type MoveEffectDynamicRecipientSets,
} from './effectRecipients'

export const PERMANENT_MOVE_LIST_LIMITS = Object.freeze({
  pokemonSlots: MOVE_PERMANENT_MOVE_LIST_LIMITS.pokemonEntries,
  trainerEntries: MOVE_PERMANENT_MOVE_LIST_LIMITS.trainerEntries,
  operations: MOVE_EFFECT_OPERATION_LIMITS.operations,
})

export type MovePermanentMoveListReductionErrorCode =
  | 'unsupported-operation'
  | 'duplicate-operation-id'
  | 'invalid-recipient-set'
  | 'recipient-not-found'
  | 'recipient-sheet-missing'
  | 'shared-sheet-recipient-conflict'
  | 'invalid-canonical-move'
  | 'invalid-move-list'
  | 'duplicate-known-move'
  | 'move-list-full'
  | 'move-not-known'
  | 'replacement-is-same-move'
  | 'current-resolution-missing'
  | 'history-source-not-selected'
  | 'history-source-missing'
  | 'history-source-stale'
  | 'history-source-mismatch'
  | 'trace-operation-missing'
  | 'trace-operation-mismatch'
  | 'state-plan-invalid'

export class MovePermanentMoveListReductionError extends Error {
  readonly code: MovePermanentMoveListReductionErrorCode

  constructor(code: MovePermanentMoveListReductionErrorCode, message: string) {
    super(message)
    this.name = 'MovePermanentMoveListReductionError'
    this.code = code
  }
}

export interface MoveResolvedPermanentMoveListOperation
  extends Omit<MoveSpecEmittedOperation, 'operation'> {
  readonly operation: MovePermanentMoveListEffectOperation
}

export interface MovePermanentMoveListRecipientResult {
  readonly placementId: string
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly slotIndex: number
  readonly previousMoveId: string | null
  readonly currentMoveId: string | null
}

export interface MovePermanentMoveListOperationResult {
  readonly operationId: string
  readonly operationKind: 'permanent-move-list'
  readonly action: MovePermanentMoveListEffectOperation['payload']['action']
  readonly phase: MovePermanentMoveListEffectOperation['phase']
  readonly reasonCode: string
  readonly recipientIds: readonly string[]
  readonly outcome: 'applied' | 'no-op'
  readonly recipients: readonly MovePermanentMoveListRecipientResult[]
}

export interface MovePermanentMoveListReduction {
  readonly stateChanges: MoveStateChangePlan
  readonly operationResults: readonly MovePermanentMoveListOperationResult[]
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly trace: MoveResolutionAuditTrace
}

type MoveSheet = CharacterSheet | TrainerSheet
type SheetMove = CharacterSheetMove | TrainerMove

interface WorkingSheet {
  readonly kind: SheetKind
  readonly slug: string
  readonly previous: MoveSheet
  current: MoveSheet
  readonly sourceOperationIds: string[]
  readonly reasonCodes: string[]
  readonly placementIds: Set<string>
  readonly plannedAt: number
}

const PERMANENT_MOVE_LIST_KIND = 'permanent-move-list'

const fail = (
  code: MovePermanentMoveListReductionErrorCode,
  message: string,
): never => {
  throw new MovePermanentMoveListReductionError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const sheetKey = (kind: SheetKind, slug: string): string => `${kind}:${slug}`

const canonicalMove = (moveId: string, label: string): PtuMove => findMove(moveId)
  ?? fail('invalid-canonical-move', `${label} ${JSON.stringify(moveId)} is not in the canonical move catalog.`)

const canonicalMoveIdForRow = (row: SheetMove): string | null => {
  if (!row || typeof row !== 'object' || typeof row.name !== 'string') return null
  return findMove(row.name)?.name ?? null
}

const moveListFor = (
  sheet: MoveSheet,
  kind: SheetKind,
  pokemonMaximum: number = PERMANENT_MOVE_LIST_LIMITS.pokemonSlots,
): readonly SheetMove[] => {
  const value = sheet.movelist
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    return fail('invalid-move-list', `${kind} sheet ${sheet.slug} movelist must be an array.`)
  }
  const maximum = kind === 'pokemon'
    ? pokemonMaximum
    : PERMANENT_MOVE_LIST_LIMITS.trainerEntries
  if (value.length > maximum) {
    return fail(
      'invalid-move-list',
      `${kind} sheet ${sheet.slug} exceeds its ${maximum}-entry permanent move-list limit.`,
    )
  }
  for (const [index, row] of value.entries()) {
    if (
      typeof row !== 'object'
      || row === null
      || Array.isArray(row)
      || typeof row.name !== 'string'
      || !row.name.trim()
    ) {
      return fail(
        'invalid-move-list',
        `${kind} sheet ${sheet.slug} move slot ${index + 1} is malformed.`,
      )
    }
  }
  return value
}

const matchingMoveIndexes = (
  rows: readonly SheetMove[],
  canonicalId: string,
): readonly number[] => rows.flatMap((row, index) => (
  canonicalMoveIdForRow(row) === canonicalId ? [index] : []
))

const uniqueKnownMoveIndex = (options: {
  readonly rows: readonly SheetMove[]
  readonly canonicalId: string
  readonly sheetLabel: string
}): number => {
  const indexes = matchingMoveIndexes(options.rows, options.canonicalId)
  if (indexes.length === 0) {
    return fail(
      'move-not-known',
      `${options.sheetLabel} does not know ${options.canonicalId}.`,
    )
  }
  if (indexes.length > 1) {
    return fail(
      'invalid-move-list',
      `${options.sheetLabel} contains duplicate ${options.canonicalId} slots.`,
    )
  }
  return indexes[0]!
}

const canonicalSheetMove = (
  move: PtuMove,
  provenance: PermanentMoveListEntryProvenance,
): SheetMove => {
  const category = move.damage_class === 'Physical'
    || move.damage_class === 'Special'
    || move.damage_class === 'Status'
    ? move.damage_class
    : undefined
  return {
    name: move.name,
    type: move.type,
    ...(category ? { category } : {}),
    ...(move.damage_base == null ? {} : { db: move.damage_base }),
    ...(move.damage_roll == null ? {} : { damageRoll: move.damage_roll }),
    ...(move.frequency === undefined ? {} : { frequency: move.frequency }),
    ...(move.ac == null ? {} : { ac: move.ac }),
    ...(move.range === undefined ? {} : { range: move.range }),
    ...(move.effect === undefined ? {} : { effect: move.effect }),
    ...(move.special === undefined ? {} : { special: move.special }),
    permanentMoveSource: deepCloneJson(provenance),
  }
}

const validateHistoryAcquisition = (options: {
  readonly acquisition: MovePermanentMoveAcquisition
  readonly learnedMoveId: string
  readonly context: AuthoritativeMoveRulesContext
}): void => {
  if (options.acquisition.kind === 'reviewed-rule') return
  const { sourcePlacementId, sourceResolutionId } = options.acquisition
  if (!options.context.selectedPlacements.some(placement => placement.id === sourcePlacementId)) {
    fail(
      'history-source-not-selected',
      `History source ${sourcePlacementId} is not an authoritative selected target.`,
    )
  }
  if (!options.context.queries.placements.get(sourcePlacementId)) {
    fail('history-source-missing', `History source placement ${sourcePlacementId} is missing.`)
  }
  const observedUse = options.context.queries.history.moveUse(sourceResolutionId)
  if (observedUse === null) {
    return fail(
      'history-source-missing',
      `History source resolution ${sourceResolutionId} is not a retained move use.`,
    )
  }
  if (observedUse.completion === null) {
    return fail(
      'history-source-missing',
      `History source resolution ${sourceResolutionId} is not completed.`,
    )
  }
  const use = observedUse
  if (use.actorPlacementId !== sourcePlacementId || use.canonicalId !== options.learnedMoveId) {
    fail(
      'history-source-mismatch',
      `History source ${sourceResolutionId} does not bind ${sourcePlacementId} to ${options.learnedMoveId}.`,
    )
  }
  const latest = options.context.queries.history.lastCompletedMove(sourcePlacementId)
  if (!latest || latest.resolutionId !== sourceResolutionId) {
    fail(
      'history-source-stale',
      `History source ${sourceResolutionId} is not ${sourcePlacementId}'s latest completed move.`,
    )
  }
}

const provenanceFor = (options: {
  readonly action: 'add' | 'replace'
  readonly acquisition: MovePermanentMoveAcquisition
  readonly operation: MovePermanentMoveListEffectOperation
  readonly context: AuthoritativeMoveRulesContext
}): PermanentMoveListEntryProvenance => {
  const sourceResolutionId = options.context.resolutionId
    ?? fail(
      'current-resolution-missing',
      `Permanent move-list operation ${options.operation.id} requires a server-owned resolution ID.`,
    )
  const sourceMove = canonicalMove(
    options.context.intent.moveName,
    'Permanent mutation source move',
  )
  return {
    schemaVersion: 1,
    mutation: options.action,
    sourceMoveId: sourceMove.name,
    sourcePlacementId: options.context.actor.placement.id,
    sourceResolutionId,
    sourceOperationId: options.operation.id,
    acquiredFrom: deepCloneJson(options.acquisition),
    recordedAt: options.context.time,
  }
}

const ensureWorkingSheet = (options: {
  readonly working: Map<string, WorkingSheet>
  readonly context: AuthoritativeMoveRulesContext
  readonly placement: SheetPlacement
}): WorkingSheet => {
  const resolved = options.context.queries.sheets.forPlacement(options.placement)
    ?? fail(
      'recipient-sheet-missing',
      `Placement ${options.placement.id} has no authoritative backing sheet.`,
    )
  options.context.reads.recordPlacement(options.placement)
  const key = sheetKey(resolved.kind, resolved.slug)
  const existing = options.working.get(key)
  if (existing) {
    if (!sameJsonValue(existing.previous, resolved.sheet)) {
      fail(
        'state-plan-invalid',
        `Permanent move-list operations observed incompatible snapshots for ${key}.`,
      )
    }
    return existing
  }
  const entry: WorkingSheet = {
    kind: resolved.kind,
    slug: resolved.slug,
    previous: deepCloneJson(resolved.sheet),
    current: deepCloneJson(resolved.sheet),
    sourceOperationIds: [],
    reasonCodes: [],
    placementIds: new Set<string>(),
    plannedAt: options.context.time,
  }
  options.working.set(key, entry)
  return entry
}

const applyOperationToSheet = (options: {
  readonly operation: MovePermanentMoveListEffectOperation
  readonly context: AuthoritativeMoveRulesContext
  readonly placement: SheetPlacement
  readonly working: WorkingSheet
}): MovePermanentMoveListRecipientResult => {
  const payload = options.operation.payload
  const learnedMove = payload.action === 'remove'
    ? null
    : canonicalMove(payload.moveId, 'Learned move')
  if (payload.action !== 'remove') {
    validateHistoryAcquisition({
      acquisition: payload.acquisition,
      learnedMoveId: learnedMove!.name,
      context: options.context,
    })
  }
  const pokemonMaximum = PERMANENT_MOVE_LIST_LIMITS.pokemonSlots + (
    options.working.kind === 'pokemon'
    && options.context.queries.abilities.has(options.placement.id, 'Cluster Mind')
      ? 2
      : 0
  )
  const rows = [...moveListFor(options.working.current, options.working.kind, pokemonMaximum)]
  const sheetLabel = `${options.working.kind} sheet ${options.working.slug}`

  if (payload.action === 'add') {
    if (matchingMoveIndexes(rows, learnedMove!.name).length > 0) {
      return fail(
        'duplicate-known-move',
        `${sheetLabel} already knows ${learnedMove!.name}.`,
      )
    }
    const maximum = options.working.kind === 'pokemon'
      ? pokemonMaximum
      : PERMANENT_MOVE_LIST_LIMITS.trainerEntries
    if (rows.length >= maximum) {
      return fail(
        'move-list-full',
        `${sheetLabel} has no legal slot for ${learnedMove!.name}.`,
      )
    }
    const slotIndex = rows.length
    rows.push(canonicalSheetMove(learnedMove!, provenanceFor({
      action: 'add',
      acquisition: payload.acquisition,
      operation: options.operation,
      context: options.context,
    })))
    options.working.current = { ...options.working.current, movelist: rows }
    return {
      placementId: options.placement.id,
      sheetKind: options.working.kind,
      sheetSlug: options.working.slug,
      slotIndex,
      previousMoveId: null,
      currentMoveId: learnedMove!.name,
    }
  }

  if (payload.action === 'remove') {
    const removedMove = canonicalMove(payload.moveId, 'Removed move')
    const slotIndex = uniqueKnownMoveIndex({
      rows,
      canonicalId: removedMove.name,
      sheetLabel,
    })
    rows.splice(slotIndex, 1)
    options.working.current = { ...options.working.current, movelist: rows }
    return {
      placementId: options.placement.id,
      sheetKind: options.working.kind,
      sheetSlug: options.working.slug,
      slotIndex,
      previousMoveId: removedMove.name,
      currentMoveId: null,
    }
  }

  const replacedMove = canonicalMove(payload.replacedMoveId, 'Replaced move')
  if (replacedMove.name === learnedMove!.name) {
    return fail(
      'replacement-is-same-move',
      `${sheetLabel} cannot replace ${replacedMove.name} with itself.`,
    )
  }
  const slotIndex = uniqueKnownMoveIndex({
    rows,
    canonicalId: replacedMove.name,
    sheetLabel,
  })
  const duplicateIndexes = matchingMoveIndexes(rows, learnedMove!.name)
  if (duplicateIndexes.some(index => index !== slotIndex)) {
    return fail(
      'duplicate-known-move',
      `${sheetLabel} already knows ${learnedMove!.name}.`,
    )
  }
  rows[slotIndex] = canonicalSheetMove(learnedMove!, provenanceFor({
    action: 'replace',
    acquisition: payload.acquisition,
    operation: options.operation,
    context: options.context,
  }))
  options.working.current = { ...options.working.current, movelist: rows }
  return {
    placementId: options.placement.id,
    sheetKind: options.working.kind,
    sheetSlug: options.working.slug,
    slotIndex,
    previousMoveId: replacedMove.name,
    currentMoveId: learnedMove!.name,
  }
}

const stateChangesFor = (
  working: Iterable<WorkingSheet>,
): MoveStateChangePlan => {
  const changes: MoveStateChangeInput[] = []
  for (const sheet of working) {
    if (sameJsonValue(sheet.previous, sheet.current)) continue
    const expectedRevision = normalizeRevision(sheet.previous.revision)
    const current = {
      ...deepCloneJson(sheet.current),
      slug: sheet.slug,
      revision: nextRevision(expectedRevision),
      updatedAt: sheet.plannedAt,
    } as MoveSheet & { readonly updatedAt: number }
    changes.push({
      kind: 'sheet-state',
      scope: {
        kind: 'sheet',
        sheetKind: sheet.kind,
        sheetSlug: sheet.slug,
      },
      expectedRevision,
      sourceOperationId: sheet.sourceOperationIds.length === 1
        ? sheet.sourceOperationIds[0]!
        : null,
      reasonCode: sheet.reasonCodes.length === 1
        ? sheet.reasonCodes[0]!
        : 'permanent-move-list-mutations',
      previous: deepCloneJson(sheet.previous),
      current,
      changedFields: ['movelist'],
      compensation: unavailableMoveStateCompensation(
        'permanent-move-list-correction-not-reviewed',
        'externally-observed',
      ),
    })
  }
  try {
    return createMoveStateChangePlan(changes)
  }
  catch (error) {
    return fail(
      'state-plan-invalid',
      `Permanent move-list state plan is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const traceResultFor = (
  result: MovePermanentMoveListOperationResult,
) => ({
  status: result.outcome,
  action: result.action,
  recipients: result.recipients.map(recipient => ({
    recipientId: recipient.placementId,
    sheetKind: recipient.sheetKind,
    sheetSlug: recipient.sheetSlug,
    slotIndex: recipient.slotIndex,
    previousMoveId: recipient.previousMoveId,
    currentMoveId: recipient.currentMoveId,
  })),
})

/** Replace interpreter placeholders with bounded permanent-list reducer evidence. */
export const applyPermanentMoveListResultsToTrace = (input: {
  readonly trace: MoveResolutionAuditTrace
  readonly results: readonly MovePermanentMoveListOperationResult[]
}): MoveResolutionAuditTrace => {
  const byId = new Map(input.results.map(result => [result.operationId, result]))
  const matched = new Set<string>()
  const events = input.trace.events.map((event) => {
    if (event.kind !== 'operation') return event
    const result = byId.get(event.operationId)
    if (!result) return event
    if (
      event.operationKind !== result.operationKind
      || event.phase !== result.phase
      || event.reasonCode !== result.reasonCode
    ) {
      return fail(
        'trace-operation-mismatch',
        `Trace event for ${result.operationId} does not match its permanent move-list operation.`,
      )
    }
    matched.add(result.operationId)
    return {
      ...event,
      recipientIds: [...result.recipientIds],
      outcome: result.outcome,
      result: traceResultFor(result),
    }
  })
  for (const result of input.results) {
    if (!matched.has(result.operationId)) {
      fail(
        'trace-operation-missing',
        `Trace is missing permanent move-list operation ${result.operationId}.`,
      )
    }
  }
  return parseMoveResolutionAuditTrace({ ...input.trace, events })
}

export const isMovePermanentMoveListEmission = (
  value: MoveSpecEmittedOperation,
): value is MoveResolvedPermanentMoveListOperation => (
  value.operation.kind === PERMANENT_MOVE_LIST_KIND
)

/**
 * Purely reduce reviewed permanent move-list operations into one CAS write per
 * physical sheet. Slot identity, catalog legality, and history provenance are
 * rechecked from the immutable authoritative context.
 */
export const reducePermanentMoveListOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operations: readonly MoveResolvedPermanentMoveListOperation[]
  readonly dynamicRecipients: MoveEffectDynamicRecipientSets
  readonly trace: MoveResolutionAuditTrace
  readonly contextForOperation?: (
    operation: MovePermanentMoveListEffectOperation,
  ) => AuthoritativeMoveRulesContext
  readonly dynamicRecipientsForOperation?: (
    operation: MovePermanentMoveListEffectOperation,
  ) => MoveEffectDynamicRecipientSets
}): MovePermanentMoveListReduction => {
  if (input.operations.length > PERMANENT_MOVE_LIST_LIMITS.operations) {
    return fail(
      'unsupported-operation',
      `Permanent move-list operations exceed ${PERMANENT_MOVE_LIST_LIMITS.operations}.`,
    )
  }
  const working = new Map<string, WorkingSheet>()
  const operationIds = new Set<string>()
  const results: MovePermanentMoveListOperationResult[] = []

  for (const emission of input.operations) {
    const operation = emission.operation
    if (operation.kind !== PERMANENT_MOVE_LIST_KIND) {
      return fail(
        'unsupported-operation',
        `Operation ${operation.id} is not a permanent move-list operation.`,
      )
    }
    if (operationIds.has(operation.id)) {
      return fail(
        'duplicate-operation-id',
        `Permanent move-list operation ${operation.id} is duplicated.`,
      )
    }
    operationIds.add(operation.id)
    const context = input.contextForOperation?.(operation) ?? input.context
    const dynamic = resolveMoveEffectDynamicRecipients(
      context,
      input.dynamicRecipientsForOperation?.(operation) ?? input.dynamicRecipients,
      fail,
    )
    const emittedIds = canonicalMoveEffectPlacementIds(
      context,
      emission.recipientIds,
      `operation ${operation.id} recipients`,
      fail,
    )
    const expectedIds = expectedMoveEffectRecipientIds(
      context,
      operation,
      dynamic,
      fail,
    )
    if (
      !moveEffectRecipientIdsEqual(emission.recipientIds, emittedIds)
      || !moveEffectRecipientIdsEqual(emittedIds, expectedIds)
    ) {
      return fail(
        'invalid-recipient-set',
        `Operation ${operation.id} recipients do not match selector ${operation.recipients.kind}.`,
      )
    }

    const physicalSheets = new Set<string>()
    const recipientResults = expectedIds.map((placementId) => {
      const placement = context.queries.placements.get(placementId)
        ?? fail('recipient-not-found', `Permanent move-list recipient ${placementId} is missing.`)
      const key = sheetKey(placement.sheetKind, placement.sheetSlug)
      if (physicalSheets.has(key)) {
        return fail(
          'shared-sheet-recipient-conflict',
          `Operation ${operation.id} addresses physical sheet ${key} more than once.`,
        )
      }
      physicalSheets.add(key)
      const sheet = ensureWorkingSheet({ working, context, placement })
      sheet.sourceOperationIds.push(operation.id)
      sheet.reasonCodes.push(operation.reasonCode)
      sheet.placementIds.add(placementId)
      return applyOperationToSheet({ operation, context, placement, working: sheet })
    })
    results.push({
      operationId: operation.id,
      operationKind: PERMANENT_MOVE_LIST_KIND,
      action: operation.payload.action,
      phase: operation.phase,
      reasonCode: operation.reasonCode,
      recipientIds: [...expectedIds],
      outcome: recipientResults.length === 0 ? 'no-op' : 'applied',
      recipients: recipientResults,
    })
  }

  const stateChanges = stateChangesFor(working.values())
  const frozenResults = deepFreeze(deepCloneJson(results))
  return deepFreeze({
    stateChanges,
    operationResults: frozenResults,
    sheetReads: input.context.reads.snapshot(),
    trace: applyPermanentMoveListResultsToTrace({
      trace: input.trace,
      results: frozenResults,
    }),
  })
}
