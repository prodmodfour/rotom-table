import { createHash } from 'node:crypto'
import { normalizeRevision } from '#shared/sessionRevisions'
import {
  ABILITY_OWNED_STATE_LIMITS,
  createEmptyAbilityOwnedState,
  parseAbilityOwnedState,
  type AbilityOwnedState,
  type AbilityOwnedStateEntry,
  type AbilityOwnedStateLifecycle,
  type AbilityOwnedStatePayload,
  type AbilityOwnedStateReceipt,
} from '#shared/abilityAutomation/ownedState'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, isPlainJsonObject } from '#shared/automation/strictJson'
import { createEmptyEncounterState, parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveStateChangePlan,
} from '../moveAutomation/plan'
import type { AbilityEffectLifecycleEvent } from './effectLifecycle'
import type { AuthoritativeAbilityContext } from './context'

interface AbilityOwnedStateCreateDraft {
  readonly stateId: string
  readonly ownerPlacementId: string
  readonly sourceAbilityInstanceId: string
  readonly canonicalId: string
  readonly targetPlacementIds: readonly string[]
  readonly lifecycle: AbilityOwnedStateLifecycle
  readonly payload: AbilityOwnedStatePayload
}

export type AbilityOwnedStateCommand =
  | {
      readonly operationId: string
      readonly kind: 'create'
      readonly stateId: string
      readonly expectedVersion: null
      readonly entry: AbilityOwnedStateCreateDraft
    }
  | {
      readonly operationId: string
      readonly kind: 'remove'
      readonly stateId: string
      readonly expectedVersion: number
    }
  | {
      readonly operationId: string
      readonly kind: 'set-targets'
      readonly stateId: string
      readonly expectedVersion: number
      readonly targetPlacementIds: readonly string[]
    }
  | {
      readonly operationId: string
      readonly kind: 'adjust-counter'
      readonly stateId: string
      readonly expectedVersion: number
      readonly delta: number
    }
  | {
      readonly operationId: string
      readonly kind: 'adjust-token'
      readonly stateId: string
      readonly expectedVersion: number
      readonly delta: number
    }
  | {
      readonly operationId: string
      readonly kind: 'set-mode'
      readonly stateId: string
      readonly expectedVersion: number
      readonly modeId: string
    }
  | {
      readonly operationId: string
      readonly kind: 'set-form'
      readonly stateId: string
      readonly expectedVersion: number
      readonly formId: string
    }

export interface AbilityOwnedStateCommandResult {
  readonly status: 'applied' | 'duplicate'
  readonly outcome: AbilityOwnedStateReceipt['outcome']
  readonly entry: AbilityOwnedStateEntry | null
  readonly state: AbilityOwnedState
}

export type AbilityOwnedStateCommandErrorCode =
  | 'invalid-command'
  | 'operation-id-conflict'
  | 'state-already-exists'
  | 'state-missing'
  | 'version-conflict'
  | 'kind-mismatch'
  | 'value-out-of-bounds'
  | 'receipt-limit-exceeded'
  | 'source-ability-inactive'
  | 'target-placement-missing'

export class AbilityOwnedStateCommandError extends Error {
  readonly code: AbilityOwnedStateCommandErrorCode

  constructor(code: AbilityOwnedStateCommandErrorCode, detail: string) {
    super(detail)
    this.name = 'AbilityOwnedStateCommandError'
    this.code = code
  }
}

const fail = (code: AbilityOwnedStateCommandErrorCode, detail: string): never => {
  throw new AbilityOwnedStateCommandError(code, detail)
}

const COMMAND_FIELDS: Record<AbilityOwnedStateCommand['kind'], readonly string[]> = {
  create: ['operationId', 'kind', 'stateId', 'expectedVersion', 'entry'],
  remove: ['operationId', 'kind', 'stateId', 'expectedVersion'],
  'set-targets': ['operationId', 'kind', 'stateId', 'expectedVersion', 'targetPlacementIds'],
  'adjust-counter': ['operationId', 'kind', 'stateId', 'expectedVersion', 'delta'],
  'adjust-token': ['operationId', 'kind', 'stateId', 'expectedVersion', 'delta'],
  'set-mode': ['operationId', 'kind', 'stateId', 'expectedVersion', 'modeId'],
  'set-form': ['operationId', 'kind', 'stateId', 'expectedVersion', 'formId'],
}
const COMMAND_KIND_SET = new Set(Object.keys(COMMAND_FIELDS))
const COMMAND_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

const parseCommand = (value: unknown): AbilityOwnedStateCommand => {
  let cloned: unknown
  try {
    cloned = cloneStrictJson(value, 'abilityOwnedStateCommand', {
      limits: {
        depth: 6,
        nodes: 1_024,
        objectFields: 16,
        arrayEntries: ABILITY_OWNED_STATE_LIMITS.targetsPerEntry,
        stringLength: ABILITY_OWNED_STATE_LIMITS.identifierLength,
        objectKeyLength: ABILITY_OWNED_STATE_LIMITS.identifierLength,
      },
      rootLabel: 'ability-owned state command',
      valueLabel: 'ability-owned state commands',
      failNotJson: (_path, detail) => fail('invalid-command', detail),
      failLimit: (_path, detail) => fail('invalid-command', detail),
    })
  }
  catch (error) {
    if (error instanceof AbilityOwnedStateCommandError) throw error
    return fail('invalid-command', 'State command is not strict JSON.')
  }
  if (!isPlainJsonObject(cloned)
    || typeof cloned.kind !== 'string'
    || !COMMAND_KIND_SET.has(cloned.kind)) {
    return fail('invalid-command', 'State command kind is unsupported.')
  }
  const fields = COMMAND_FIELDS[cloned.kind as AbilityOwnedStateCommand['kind']]
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(cloned, field))
    || Object.keys(cloned).some(field => !expected.has(field))) {
    fail('invalid-command', 'State command has an invalid shape.')
  }
  if (typeof cloned.operationId !== 'string' || !COMMAND_ID_PATTERN.test(cloned.operationId)
    || typeof cloned.stateId !== 'string' || !COMMAND_ID_PATTERN.test(cloned.stateId)) {
    fail('invalid-command', 'State command IDs must be stable identifiers.')
  }
  if (cloned.kind === 'create') {
    if (cloned.expectedVersion !== null || !isPlainJsonObject(cloned.entry)) {
      fail('invalid-command', 'Create command must carry a draft and null version.')
    }
  }
  else if (!Number.isSafeInteger(cloned.expectedVersion) || Number(cloned.expectedVersion) < 1) {
    fail('invalid-command', 'Mutation expected version must be positive.')
  }
  if ((cloned.kind === 'adjust-counter' || cloned.kind === 'adjust-token')
    && (!Number.isSafeInteger(cloned.delta) || Number(cloned.delta) === 0)) {
    fail('invalid-command', 'Adjustment delta must be a non-zero integer.')
  }
  return cloned as unknown as AbilityOwnedStateCommand
}

const requestHash = (command: AbilityOwnedStateCommand): string => createHash('sha256')
  .update(stableJsonStringify(command))
  .digest('hex')

const nextVersion = (entry: AbilityOwnedStateEntry): number => {
  if (entry.version >= ABILITY_OWNED_STATE_LIMITS.version) {
    return fail('value-out-of-bounds', 'Ability-owned state version is exhausted.')
  }
  return entry.version + 1
}

const receipt = (input: {
  readonly command: AbilityOwnedStateCommand
  readonly requestSha256: string
  readonly outcome: AbilityOwnedStateReceipt['outcome']
  readonly resultVersion: number | null
}): AbilityOwnedStateReceipt => ({
  operationId: input.command.operationId,
  stateId: input.command.stateId,
  requestSha256: input.requestSha256,
  outcome: input.outcome,
  resultVersion: input.resultVersion,
})

/** Pure optimistic reducer with operation-hash idempotency. */
export const reduceAbilityOwnedStateCommand = (
  value: unknown,
  command: AbilityOwnedStateCommand,
): AbilityOwnedStateCommandResult => {
  command = parseCommand(command)
  const state = parseAbilityOwnedState(value)
  const hash = requestHash(command)
  const priorReceipt = state.receipts.find(candidate => candidate.operationId === command.operationId)
  if (priorReceipt) {
    if (priorReceipt.requestSha256 !== hash || priorReceipt.stateId !== command.stateId) {
      fail('operation-id-conflict', 'Operation ID was already used for a different state command.')
    }
    return Object.freeze({
      status: 'duplicate',
      outcome: priorReceipt.outcome,
      entry: state.entries.find(entry => (
        entry.stateId === command.stateId && entry.version === priorReceipt.resultVersion
      )) ?? null,
      state,
    })
  }
  if (state.receipts.length >= ABILITY_OWNED_STATE_LIMITS.receipts) {
    fail('receipt-limit-exceeded', 'Ability-owned state receipt budget is exhausted.')
  }
  const existing = state.entries.find(entry => entry.stateId === command.stateId) ?? null
  if (command.kind === 'create') {
    if (command.expectedVersion !== null || command.entry.stateId !== command.stateId) {
      fail('invalid-command', 'Create command identity or expected version is invalid.')
    }
    if (existing) fail('state-already-exists', `State ${command.stateId} already exists.`)
    const created: AbilityOwnedStateEntry = {
      ...command.entry,
      version: 1,
      createdOperationId: command.operationId,
      lastOperationId: command.operationId,
    }
    const next = parseAbilityOwnedState({
      schemaVersion: 1,
      entries: [...state.entries, created],
      receipts: [...state.receipts, receipt({
        command,
        requestSha256: hash,
        outcome: 'created',
        resultVersion: 1,
      })],
    })
    return Object.freeze({ status: 'applied', outcome: 'created', entry: next.entries.at(-1)!, state: next })
  }
  const current = existing
    ?? fail('state-missing', `State ${command.stateId} does not exist.`)
  if (current.version !== command.expectedVersion) {
    fail('version-conflict', `State ${command.stateId} is at version ${current.version}.`)
  }
  if (command.kind === 'remove') {
    const next = parseAbilityOwnedState({
      schemaVersion: 1,
      entries: state.entries.filter(entry => entry !== current),
      receipts: [...state.receipts, receipt({
        command,
        requestSha256: hash,
        outcome: 'removed',
        resultVersion: null,
      })],
    })
    return Object.freeze({ status: 'applied', outcome: 'removed', entry: null, state: next })
  }

  const version = nextVersion(current)
  let updated: AbilityOwnedStateEntry
  if (command.kind === 'set-targets') {
    updated = {
      ...current,
      version,
      targetPlacementIds: command.targetPlacementIds,
      lastOperationId: command.operationId,
    }
  }
  else if (command.kind === 'adjust-counter') {
    const payload = current.payload.kind === 'counter'
      ? current.payload
      : fail('kind-mismatch', 'State is not a counter.')
    const value = payload.value + command.delta
    if (value < payload.minimum || value > payload.maximum) {
      fail('value-out-of-bounds', 'Counter adjustment exceeds its bounds.')
    }
    updated = {
      ...current,
      version,
      payload: { ...payload, value },
      lastOperationId: command.operationId,
    }
  }
  else if (command.kind === 'adjust-token') {
    const payload = current.payload.kind === 'token'
      ? current.payload
      : fail('kind-mismatch', 'State is not a token pool.')
    const quantity = payload.quantity + command.delta
    if (quantity < 0 || quantity > payload.maximum) {
      fail('value-out-of-bounds', 'Token adjustment exceeds its bounds.')
    }
    updated = {
      ...current,
      version,
      payload: { ...payload, quantity },
      lastOperationId: command.operationId,
    }
  }
  else if (command.kind === 'set-mode') {
    if (current.payload.kind !== 'mode') fail('kind-mismatch', 'State is not a mode.')
    updated = {
      ...current,
      version,
      payload: { kind: 'mode', modeId: command.modeId },
      lastOperationId: command.operationId,
    }
  }
  else if (command.kind === 'set-form') {
    if (current.payload.kind !== 'form') fail('kind-mismatch', 'State is not a form.')
    updated = {
      ...current,
      version,
      payload: { kind: 'form', formId: command.formId },
      lastOperationId: command.operationId,
    }
  }
  else return fail('invalid-command', 'State command kind is unsupported.')
  const next = parseAbilityOwnedState({
    schemaVersion: 1,
    entries: state.entries.map(entry => entry === current ? updated : entry),
    receipts: [...state.receipts, receipt({
      command,
      requestSha256: hash,
      outcome: 'updated',
      resultVersion: version,
    })],
  })
  return Object.freeze({
    status: 'applied',
    outcome: 'updated',
    entry: next.entries.find(entry => entry.stateId === command.stateId)!,
    state: next,
  })
}

const lifecycleRemoves = (
  entry: AbilityOwnedStateEntry,
  event: AbilityEffectLifecycleEvent,
): boolean => {
  if (event.kind === 'scene-end') return true
  if (event.kind === 'turn-boundary'
    && event.boundary === 'end'
    && entry.lifecycle.kind === 'turn'
    && event.placementId === entry.ownerPlacementId) return true
  if (event.kind === 'presence-snapshot') {
    const present = new Set(event.presentPlacementIds)
    if (entry.lifecycle.kind === 'source-presence' && !present.has(entry.ownerPlacementId)) return true
    if (entry.lifecycle.kind === 'target-presence') {
      const presentTargets = entry.targetPlacementIds.filter(id => present.has(id)).length
      return entry.lifecycle.targetPolicy === 'any-target-leaves'
        ? presentTargets !== entry.targetPlacementIds.length
        : presentTargets === 0
    }
  }
  return event.kind === 'effective-ability-snapshot'
    && entry.lifecycle.kind === 'source-ability'
    && event.placementId === entry.ownerPlacementId
    && !event.activeAbilityInstanceIds.includes(entry.sourceAbilityInstanceId)
}

export const reduceAbilityOwnedStateLifecycle = (
  value: unknown,
  event: AbilityEffectLifecycleEvent,
): AbilityOwnedState => {
  const state = parseAbilityOwnedState(value)
  const entries = state.entries.filter(entry => !lifecycleRemoves(entry, event))
  if (entries.length === state.entries.length) return state
  return parseAbilityOwnedState({
    schemaVersion: 1,
    entries,
    receipts: event.kind === 'scene-end' ? [] : state.receipts,
  })
}

const authorizeCommand = (
  context: AuthoritativeAbilityContext,
  state: AbilityOwnedState,
  command: AbilityOwnedStateCommand,
): void => {
  const draft = command.kind === 'create'
    ? command.entry
    : state.entries.find(entry => entry.stateId === command.stateId)
      ?? fail('state-missing', `State ${command.stateId} does not exist.`)
  const active = context.queries.effectiveAbilities.activeForPlacement(draft.ownerPlacementId)
    .some(ability => (
      ability.instanceId === draft.sourceAbilityInstanceId
      && ability.canonicalId === draft.canonicalId
    ))
  if (!active || draft.canonicalId !== context.runtime.canonicalId) {
    fail('source-ability-inactive', 'State command is not backed by the selected active ability.')
  }
  for (const targetId of command.kind === 'set-targets'
    ? command.targetPlacementIds
    : draft.targetPlacementIds) {
    if (!context.queries.placements.get(targetId)) {
      fail('target-placement-missing', `Target placement ${targetId} does not exist.`)
    }
  }
}

export const planAbilityOwnedStateCommand = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly command: AbilityOwnedStateCommand
}): { readonly plan: MoveStateChangePlan; readonly result: AbilityOwnedStateCommandResult } => {
  const previous = parseEncounterState(
    input.context.map.encounterState ?? createEmptyEncounterState(),
  )
  const state = parseAbilityOwnedState(previous.abilityOwnedState ?? createEmptyAbilityOwnedState())
  authorizeCommand(input.context, state, input.command)
  const result = reduceAbilityOwnedStateCommand(state, input.command)
  if (result.status === 'duplicate') {
    return Object.freeze({ plan: createMoveStateChangePlan([]), result })
  }
  const current = parseEncounterState({ ...previous, abilityOwnedState: result.state })
  return Object.freeze({
    plan: createMoveStateChangePlan([{
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision),
      sourceOperationId: input.command.operationId,
      reasonCode: `ability-owned-state.${input.command.kind}`,
      previous,
      current,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }]),
    result,
  })
}

export const recoverAbilityOwnedState = (
  encounterValue: unknown,
  facts: {
    readonly presentPlacementIds: readonly string[]
    readonly activeAbilityInstanceIdsByPlacement: ReadonlyMap<string, readonly string[]>
  },
): EncounterState => {
  let encounter = parseEncounterState(encounterValue)
  let state = reduceAbilityOwnedStateLifecycle(
    encounter.abilityOwnedState ?? createEmptyAbilityOwnedState(),
    { kind: 'presence-snapshot', presentPlacementIds: facts.presentPlacementIds },
  )
  const owners = [...new Set(state.entries.map(entry => entry.ownerPlacementId))].sort()
  for (const placementId of owners) {
    state = reduceAbilityOwnedStateLifecycle(state, {
      kind: 'effective-ability-snapshot',
      placementId,
      activeAbilityInstanceIds: facts.activeAbilityInstanceIdsByPlacement.get(placementId) ?? [],
    })
  }
  return parseEncounterState({ ...encounter, abilityOwnedState: state })
}
