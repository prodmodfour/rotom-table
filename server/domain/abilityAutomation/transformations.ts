import { createHash } from 'node:crypto'
import { normalizeRevision } from '#shared/sessionRevisions'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, isPlainJsonObject } from '#shared/automation/strictJson'
import {
  ABILITY_TRANSFORMATION_LIMITS,
  createEmptyAbilityTransformationState,
  parseAbilityTransformationState,
  type AbilityTransformationCopyBase,
  type AbilityTransformationMechanics,
  type AbilityTransformationPresentation,
  type AbilityTransformationReceipt,
  type AbilityTransformationSnapshot,
  type AbilityTransformationState,
  type AbilityTransformationKind,
} from '#shared/abilityAutomation/transformations'
import type { AbilityEffectDuration } from '#shared/abilityAutomation/durations'
import { parseAbilityInstanceData } from '#shared/abilityAutomation/parameters'
import { createEmptyEncounterState, parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveStateChangePlan,
} from '../moveAutomation/plan'
import type { AuthoritativeAbilityContext } from './context'
import { isCanonicalAutomationAbility } from './effectiveAbilities'
import { RUNTIME_ABILITY_PARAMETER_DEFINITIONS } from './instanceParameters'
import { reduceAbilityEffectLifecycle, type AbilityEffectLifecycleEvent } from './effectLifecycle'

export interface AbilityTransformationCreateDraft {
  readonly snapshotId: string
  readonly kind: AbilityTransformationKind
  readonly placementId: string
  readonly ownerPlacementId: string
  readonly sourceAbilityInstanceId: string
  readonly canonicalId: string
  readonly sourceOperationId: string
  readonly duration: AbilityEffectDuration
  readonly mechanics: AbilityTransformationMechanics
  readonly copyBase: AbilityTransformationCopyBase | null
  readonly presentation: AbilityTransformationPresentation
}
export type AbilityTransformationCommand =
  | {
      readonly operationId: string
      readonly kind: 'create'
      readonly snapshotId: string
      readonly expectedVersion: null
      readonly snapshot: AbilityTransformationCreateDraft
    }
  | {
      readonly operationId: string
      readonly kind: 'remove'
      readonly snapshotId: string
      readonly expectedVersion: 1
    }
export interface AbilityTransformationCommandResult {
  readonly status: 'applied' | 'duplicate'
  readonly outcome: AbilityTransformationReceipt['outcome']
  readonly snapshot: AbilityTransformationSnapshot | null
  readonly state: AbilityTransformationState
}
export class AbilityTransformationCommandError extends Error {
  constructor(readonly code:
    | 'invalid-command' | 'operation-id-conflict' | 'snapshot-exists' | 'snapshot-missing'
    | 'version-conflict' | 'source-ability-inactive' | 'placement-missing'
    | 'copy-source-missing' | 'copy-source-revision-conflict' | 'copy-base-hash-mismatch'
    | 'protected-copy' | 'receipt-limit-exceeded', detail: string) {
    super(detail)
    this.name = 'AbilityTransformationCommandError'
  }
}
const fail = (code: AbilityTransformationCommandError['code'], detail: string): never => {
  throw new AbilityTransformationCommandError(code, detail)
}
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const FIELDS = {
  create: ['operationId', 'kind', 'snapshotId', 'expectedVersion', 'snapshot'],
  remove: ['operationId', 'kind', 'snapshotId', 'expectedVersion'],
} as const
const parseCommand = (value: unknown): AbilityTransformationCommand => {
  let cloned: unknown
  try {
    cloned = cloneStrictJson(value, 'abilityTransformationCommand', {
      limits: { depth: 14, nodes: 32_768, objectFields: 32, arrayEntries: 1_024, stringLength: 500, objectKeyLength: 200 },
      rootLabel: 'ability transformation command', valueLabel: 'ability transformation command values',
      failNotJson: (_path, detail) => fail('invalid-command', detail),
      failLimit: (_path, detail) => fail('invalid-command', detail),
    })
  }
  catch (error) {
    if (error instanceof AbilityTransformationCommandError) throw error
    return fail('invalid-command', 'Transformation command must be strict JSON.')
  }
  if (!isPlainJsonObject(cloned)) fail('invalid-command', 'Transformation command must be an object.')
  const input = cloned as Record<string, unknown>
  if (input.kind !== 'create' && input.kind !== 'remove') fail('invalid-command', 'Transformation command kind is unsupported.')
  const kind = input.kind as 'create' | 'remove'
  const fields: readonly string[] = FIELDS[kind]
  const expected = new Set<string>(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field))
    || typeof input.operationId !== 'string' || !ID.test(input.operationId)
    || typeof input.snapshotId !== 'string' || !ID.test(input.snapshotId)) {
    fail('invalid-command', 'Transformation command shape or identity is invalid.')
  }
  if (input.kind === 'create') {
    if (input.expectedVersion !== null || !isPlainJsonObject(input.snapshot)) fail('invalid-command', 'Create requires a draft and null version.')
  }
  else if (input.expectedVersion !== 1) fail('invalid-command', 'Immutable snapshots can be removed only at version 1.')
  return input as unknown as AbilityTransformationCommand
}
const commandHash = (command: AbilityTransformationCommand): string => createHash('sha256')
  .update(stableJsonStringify(command), 'utf8').digest('hex')
export const abilityTransformationCopyBaseHash = (input: {
  readonly copyBase: AbilityTransformationCopyBase
  readonly mechanics: AbilityTransformationMechanics
}): string => createHash('sha256').update(stableJsonStringify(input), 'utf8').digest('hex')

export const assertAbilityTransformationCopyBaseHashes = (
  stateValue: unknown,
): AbilityTransformationState => {
  const state = parseAbilityTransformationState(stateValue)
  for (const snapshot of state.entries) {
    if (!snapshot.copyBase) continue
    const expected = abilityTransformationCopyBaseHash({
      copyBase: snapshot.copyBase,
      mechanics: snapshot.mechanics,
    })
    if (snapshot.copyBaseSha256 !== expected) {
      fail('copy-base-hash-mismatch', `Snapshot ${snapshot.snapshotId} copy base changed after capture.`)
    }
  }
  return state
}
const validateParameters = (mechanics: AbilityTransformationMechanics): void => {
  for (const ability of mechanics.abilities) {
    if (!isCanonicalAutomationAbility(ability.canonicalId)) {
      fail('invalid-command', `Copied ability ${ability.canonicalId} is not canonical.`)
    }
    if (ability.parameterStatus === 'ready') {
      parseAbilityInstanceData(
        ability.parameterData,
        ability.canonicalId,
        RUNTIME_ABILITY_PARAMETER_DEFINITIONS,
      )
    }
  }
}
const receipt = (
  command: AbilityTransformationCommand,
  requestSha256: string,
  outcome: AbilityTransformationReceipt['outcome'],
): AbilityTransformationReceipt => ({
  operationId: command.operationId,
  snapshotId: command.snapshotId,
  requestSha256,
  outcome,
})

/** Immutable snapshot reducer: creation captures mechanics once; no update command exists. */
export const reduceAbilityTransformationCommand = (
  stateValue: unknown,
  commandValue: unknown,
): AbilityTransformationCommandResult => {
  const command = parseCommand(commandValue)
  const state = assertAbilityTransformationCopyBaseHashes(stateValue)
  const requestSha256 = commandHash(command)
  const previousReceipt = state.receipts.find(entry => entry.operationId === command.operationId)
  if (previousReceipt) {
    if (previousReceipt.requestSha256 !== requestSha256 || previousReceipt.snapshotId !== command.snapshotId) {
      fail('operation-id-conflict', 'Transformation operation ID belongs to a different command.')
    }
    return Object.freeze({
      status: 'duplicate', outcome: previousReceipt.outcome,
      snapshot: state.entries.find(entry => entry.snapshotId === command.snapshotId) ?? null,
      state,
    })
  }
  if (state.receipts.length >= ABILITY_TRANSFORMATION_LIMITS.receipts) {
    fail('receipt-limit-exceeded', 'Transformation receipt budget is exhausted.')
  }
  const existing = state.entries.find(entry => entry.snapshotId === command.snapshotId) ?? null
  if (command.kind === 'remove') {
    const removing = existing ?? fail('snapshot-missing', 'Transformation snapshot is missing.')
    if (removing.version !== command.expectedVersion) fail('version-conflict', 'Transformation snapshot version changed.')
    const next = parseAbilityTransformationState({
      schemaVersion: 1,
      entries: state.entries.filter(entry => entry !== removing),
      receipts: [...state.receipts, receipt(command, requestSha256, 'removed')],
    })
    return Object.freeze({ status: 'applied', outcome: 'removed', snapshot: null, state: next })
  }
  if (existing) fail('snapshot-exists', 'Transformation snapshot already exists.')
  if (command.snapshot.snapshotId !== command.snapshotId) fail('invalid-command', 'Transformation snapshot identity differs.')
  validateParameters(command.snapshot.mechanics)
  const copyBaseSha256 = command.snapshot.copyBase === null
    ? null
    : abilityTransformationCopyBaseHash({
        copyBase: command.snapshot.copyBase,
        mechanics: command.snapshot.mechanics,
      })
  const created: AbilityTransformationSnapshot = {
    ...command.snapshot,
    version: 1,
    copyBaseSha256,
    createdOperationId: command.operationId,
  }
  const next = assertAbilityTransformationCopyBaseHashes({
    schemaVersion: 1,
    entries: [...state.entries, created],
    receipts: [...state.receipts, receipt(command, requestSha256, 'created')],
  })
  return Object.freeze({
    status: 'applied', outcome: 'created',
    snapshot: next.entries.find(entry => entry.snapshotId === command.snapshotId)!, state: next,
  })
}

const authorize = (
  context: AuthoritativeAbilityContext,
  state: AbilityTransformationState,
  command: AbilityTransformationCommand,
): void => {
  const draft = command.kind === 'create'
    ? command.snapshot
    : state.entries.find(entry => entry.snapshotId === command.snapshotId)
      ?? fail('snapshot-missing', 'Transformation snapshot is missing.')
  if (!context.queries.placements.get(draft.placementId)) fail('placement-missing', 'Transformed placement is missing.')
  const active = context.queries.effectiveAbilities.activeForPlacement(draft.ownerPlacementId)
    .some(ability => ability.instanceId === draft.sourceAbilityInstanceId && ability.canonicalId === draft.canonicalId)
  if (!active || draft.canonicalId !== context.runtime.canonicalId) {
    fail('source-ability-inactive', 'Transformation is not backed by the selected active ability.')
  }
  if (draft.copyBase) {
    const sourcePlacement = context.queries.placements.get(draft.copyBase.sourcePlacementId)
      ?? fail('copy-source-missing', 'Transformation copy source is missing.')
    const sourceSheet = context.queries.sheets.forPlacement(sourcePlacement)
      ?? fail('copy-source-missing', 'Transformation copy source sheet is missing.')
    if (normalizeRevision(sourceSheet.revision) !== normalizeRevision(draft.copyBase.sourceRevision)) {
      fail('copy-source-revision-conflict', 'Transformation copy source changed before snapshot creation.')
    }
  }
}

export const planAbilityTransformationCommand = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly command: unknown
}): { readonly plan: MoveStateChangePlan; readonly result: AbilityTransformationCommandResult } => {
  const command = parseCommand(input.command)
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  const state = assertAbilityTransformationCopyBaseHashes(
    previous.abilityTransformations ?? createEmptyAbilityTransformationState(),
  )
  authorize(input.context, state, command)
  const result = reduceAbilityTransformationCommand(state, command)
  if (result.status === 'duplicate') return Object.freeze({ plan: createMoveStateChangePlan([]), result })
  const current = parseEncounterState({ ...previous, abilityTransformations: result.state })
  return Object.freeze({
    result,
    plan: createMoveStateChangePlan([{
      kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision),
      sourceOperationId: command.operationId,
      reasonCode: `ability-transformation.${command.kind}`,
      previous, current, compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }]),
  })
}

export const reduceAbilityTransformationLifecycle = (
  stateValue: unknown,
  event: AbilityEffectLifecycleEvent,
): AbilityTransformationState => {
  const state = assertAbilityTransformationCopyBaseHashes(stateValue)
  const reduction = reduceAbilityEffectLifecycle({
    schemaVersion: 1,
    entries: state.entries.map(snapshot => ({
      effectId: snapshot.snapshotId,
      sourcePlacementId: snapshot.ownerPlacementId,
      sourceAbilityInstanceId: snapshot.sourceAbilityInstanceId,
      targetPlacementIds: [snapshot.placementId],
      duration: snapshot.duration,
    })),
  }, event)
  if (reduction.transitions.length === 0) return state
  const retained = new Map(reduction.state.entries.map(entry => [entry.effectId, entry.duration]))
  return assertAbilityTransformationCopyBaseHashes({
    schemaVersion: 1,
    entries: state.entries.flatMap(snapshot => {
      const duration = retained.get(snapshot.snapshotId)
      return duration ? [{ ...snapshot, duration }] : []
    }),
    receipts: event.kind === 'scene-end' ? [] : state.receipts,
  })
}

export const recoverAbilityTransformations = (input: {
  readonly encounter: unknown
  readonly presentPlacementIds: readonly string[]
  readonly activeAbilityInstanceIdsByPlacement: ReadonlyMap<string, readonly string[]>
}): EncounterState => {
  const encounter = parseEncounterState(input.encounter)
  let state = reduceAbilityTransformationLifecycle(
    encounter.abilityTransformations ?? createEmptyAbilityTransformationState(),
    { kind: 'presence-snapshot', presentPlacementIds: input.presentPlacementIds },
  )
  for (const placementId of [...new Set(state.entries.map(entry => entry.ownerPlacementId))].sort()) {
    state = reduceAbilityTransformationLifecycle(state, {
      kind: 'effective-ability-snapshot', placementId,
      activeAbilityInstanceIds: input.activeAbilityInstanceIdsByPlacement.get(placementId) ?? [],
    })
  }
  return parseEncounterState({ ...encounter, abilityTransformations: state })
}
