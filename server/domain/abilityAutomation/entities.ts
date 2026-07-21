import { createHash } from 'node:crypto'
import { normalizeRevision } from '#shared/sessionRevisions'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { cloneStrictJson, isPlainJsonObject } from '#shared/automation/strictJson'
import {
  ABILITY_ENTITY_LIMITS,
  createEmptyAbilityEntityState,
  parseAbilityEntityState,
  type AbilityEntityController,
  type AbilityEntityEntry,
  type AbilityEntityReceipt,
  type AbilityEntityState,
  type AbilityEntityCell,
} from '#shared/abilityAutomation/entities'
import { parseEncounterState, createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { footprintsOverlap, isAnchorWithinBounds } from '~/utils/gridGeometry'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { AuthoritativeAbilityContext } from './context'
import {
  reduceAbilityEffectLifecycle,
  type AbilityEffectLifecycleEvent,
} from './effectLifecycle'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveStateChangePlan,
} from '../moveAutomation/plan'

interface AbilityEntityCreateDraft extends Omit<
  AbilityEntityEntry,
  'version' | 'createdOperationId' | 'lastOperationId'
> {}
export type AbilityEntityCommand =
  | { readonly operationId: string; readonly kind: 'create'; readonly entityId: string; readonly expectedVersion: null; readonly entity: AbilityEntityCreateDraft }
  | { readonly operationId: string; readonly kind: 'move'; readonly entityId: string; readonly expectedVersion: number; readonly position: AbilityEntityCell }
  | { readonly operationId: string; readonly kind: 'damage'; readonly entityId: string; readonly expectedVersion: number; readonly amount: number }
  | { readonly operationId: string; readonly kind: 'transfer-control'; readonly entityId: string; readonly expectedVersion: number; readonly controller: AbilityEntityController }
  | { readonly operationId: string; readonly kind: 'remove'; readonly entityId: string; readonly expectedVersion: number }

export interface AbilityEntityCommandResult {
  readonly status: 'applied' | 'duplicate'
  readonly outcome: AbilityEntityReceipt['outcome']
  readonly entity: AbilityEntityEntry | null
  readonly state: AbilityEntityState
}
export interface AbilityEntityPlanResult extends AbilityEntityCommandResult { readonly plan: MoveStateChangePlan }

export type AbilityEntityCommandErrorCode =
  | 'invalid-command' | 'operation-id-conflict' | 'entity-exists' | 'entity-missing'
  | 'version-conflict' | 'source-ability-inactive' | 'controller-unauthorized'
  | 'movement-forbidden' | 'movement-out-of-range' | 'hp-unavailable'
  | 'bounds-conflict' | 'occupancy-conflict' | 'limit-exceeded'

export class AbilityEntityCommandError extends Error {
  constructor(readonly code: AbilityEntityCommandErrorCode, detail: string) {
    super(detail)
    this.name = 'AbilityEntityCommandError'
  }
}
const fail = (code: AbilityEntityCommandErrorCode, detail: string): never => {
  throw new AbilityEntityCommandError(code, detail)
}
const FIELDS: Readonly<Record<AbilityEntityCommand['kind'], readonly string[]>> = {
  create: ['operationId', 'kind', 'entityId', 'expectedVersion', 'entity'],
  move: ['operationId', 'kind', 'entityId', 'expectedVersion', 'position'],
  damage: ['operationId', 'kind', 'entityId', 'expectedVersion', 'amount'],
  'transfer-control': ['operationId', 'kind', 'entityId', 'expectedVersion', 'controller'],
  remove: ['operationId', 'kind', 'entityId', 'expectedVersion'],
}
const STABLE_ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const parseCommand = (value: unknown): AbilityEntityCommand => {
  let cloned: unknown
  try {
    cloned = cloneStrictJson(value, 'abilityEntityCommand', {
      limits: { depth: 12, nodes: 8_192, objectFields: 32, arrayEntries: 512, stringLength: 500, objectKeyLength: 200 },
      rootLabel: 'ability entity command', valueLabel: 'ability entity commands',
      failNotJson: (_path, detail) => fail('invalid-command', detail),
      failLimit: (_path, detail) => fail('invalid-command', detail),
    })
  }
  catch (error) {
    if (error instanceof AbilityEntityCommandError) throw error
    fail('invalid-command', 'Entity command is not strict JSON.')
  }
  if (!isPlainJsonObject(cloned)) fail('invalid-command', 'Entity command must be an object.')
  const command = cloned as Record<string, unknown>
  if (typeof command.kind !== 'string' || !(command.kind in FIELDS)) {
    fail('invalid-command', 'Entity command kind is unsupported.')
  }
  const fields = FIELDS[command.kind as AbilityEntityCommand['kind']]
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(command, field))
    || Object.keys(command).some(field => !expected.has(field))
    || typeof command.operationId !== 'string' || !STABLE_ID.test(command.operationId)
    || typeof command.entityId !== 'string' || !STABLE_ID.test(command.entityId)) {
    fail('invalid-command', 'Entity command shape or identity is invalid.')
  }
  if (command.kind === 'create') {
    if (command.expectedVersion !== null || !isPlainJsonObject(command.entity)) {
      fail('invalid-command', 'Entity create requires a draft and null version.')
    }
  }
  else if (!Number.isSafeInteger(command.expectedVersion) || Number(command.expectedVersion) < 1) {
    fail('invalid-command', 'Entity mutation requires a positive expected version.')
  }
  if (command.kind === 'damage' && (!Number.isSafeInteger(command.amount) || Number(command.amount) < 1)) {
    fail('invalid-command', 'Entity damage must be a positive integer.')
  }
  return command as unknown as AbilityEntityCommand
}
const requestHash = (command: AbilityEntityCommand): string => createHash('sha256')
  .update(stableJsonStringify(command), 'utf8').digest('hex')
const receipt = (
  command: AbilityEntityCommand,
  hash: string,
  outcome: AbilityEntityReceipt['outcome'],
  resultVersion: number | null,
): AbilityEntityReceipt => ({
  operationId: command.operationId, entityId: command.entityId,
  requestSha256: hash, outcome, resultVersion,
})
const nextVersion = (entry: AbilityEntityEntry): number => {
  if (entry.version >= ABILITY_ENTITY_LIMITS.version) fail('limit-exceeded', 'Entity version is exhausted.')
  return entry.version + 1
}

export const reduceAbilityEntityCommand = (
  stateValue: unknown,
  commandValue: unknown,
): AbilityEntityCommandResult => {
  const command = parseCommand(commandValue)
  const state = parseAbilityEntityState(stateValue)
  const hash = requestHash(command)
  const prior = state.receipts.find(value => value.operationId === command.operationId)
  if (prior) {
    if (prior.requestSha256 !== hash || prior.entityId !== command.entityId) {
      fail('operation-id-conflict', 'Entity operation ID belongs to a different command.')
    }
    return Object.freeze({
      status: 'duplicate', outcome: prior.outcome,
      entity: state.entries.find(entity => entity.entityId === command.entityId
        && entity.version === prior.resultVersion) ?? null,
      state,
    })
  }
  if (state.receipts.length >= ABILITY_ENTITY_LIMITS.receipts) fail('limit-exceeded', 'Entity receipt budget is exhausted.')
  const existing = state.entries.find(entity => entity.entityId === command.entityId) ?? null
  if (command.kind === 'create') {
    if (existing) fail('entity-exists', 'Entity already exists.')
    if (command.entity.entityId !== command.entityId) fail('invalid-command', 'Entity draft identity differs.')
    const created: AbilityEntityEntry = {
      ...command.entity,
      version: 1,
      createdOperationId: command.operationId,
      lastOperationId: command.operationId,
    }
    const next = parseAbilityEntityState({
      schemaVersion: 1,
      entries: [...state.entries, created],
      receipts: [...state.receipts, receipt(command, hash, 'created', 1)],
    })
    return Object.freeze({ status: 'applied', outcome: 'created', entity: next.entries.at(-1)!, state: next })
  }
  const current = existing ?? fail('entity-missing', 'Entity does not exist.')
  if (current.version !== command.expectedVersion) fail('version-conflict', 'Entity version changed.')
  if (command.kind === 'remove') {
    const next = parseAbilityEntityState({
      schemaVersion: 1,
      entries: state.entries.filter(entity => entity !== current),
      receipts: [...state.receipts, receipt(command, hash, 'removed', null)],
    })
    return Object.freeze({ status: 'applied', outcome: 'removed', entity: null, state: next })
  }
  const version = nextVersion(current)
  let updated: AbilityEntityEntry
  let outcome: AbilityEntityReceipt['outcome']
  if (command.kind === 'move') {
    if (current.movementMode === 'fixed') fail('movement-forbidden', 'Fixed entities cannot move.')
    if (ptuGridDistanceBetweenFootprints(current, { ...current, position: command.position }) > current.movementSpeed) {
      fail('movement-out-of-range', 'Entity destination exceeds its movement speed.')
    }
    updated = { ...current, version, position: command.position, lastOperationId: command.operationId }
    outcome = 'moved'
  }
  else if (command.kind === 'damage') {
    const currentHp = current.currentHp
    const damageReduction = current.damageReduction
    if (current.maximumHp === null || currentHp === null || damageReduction === null) {
      fail('hp-unavailable', 'Entity has no damageable HP pool.')
    }
    const loss = Math.max(0, command.amount - damageReduction!)
    updated = {
      ...current, version, currentHp: Math.max(0, currentHp! - loss),
      lastOperationId: command.operationId,
    }
    outcome = 'damaged'
  }
  else {
    updated = { ...current, version, controller: command.controller, lastOperationId: command.operationId }
    outcome = 'control-transferred'
  }
  const next = parseAbilityEntityState({
    schemaVersion: 1,
    entries: state.entries.map(entity => entity === current ? updated : entity),
    receipts: [...state.receipts, receipt(command, hash, outcome, version)],
  })
  return Object.freeze({
    status: 'applied', outcome,
    entity: next.entries.find(entity => entity.entityId === command.entityId)!, state: next,
  })
}

const controllerAllows = (context: AuthoritativeAbilityContext, entity: AbilityEntityEntry): boolean => {
  const actorId = context.actor.placement.id
  if (entity.controller.kind === 'source-controller') return entity.ownerPlacementId === actorId
  if (entity.controller.kind === 'placement') return entity.controller.id === actorId
  if (entity.controller.kind === 'side') {
    return entity.controller.id !== null
      && context.queries.relationships.sideId(actorId) === entity.controller.id
  }
  return false
}
const validateGeometry = (context: AuthoritativeAbilityContext, state: AbilityEntityState): void => {
  for (const entity of state.entries) {
    if (!isAnchorWithinBounds(entity.position, entity, context.map.dimensions)) {
      fail('bounds-conflict', `Entity ${entity.entityId} is outside map bounds.`)
    }
    if (entity.occupancy !== 'blocking') continue
    const placementCollision = context.tokens.find(token => footprintsOverlap(
      entity.position, entity.base, entity.clearance,
      token.position, token.base, token.clearance,
    ))
    if (placementCollision) fail('occupancy-conflict', `Entity ${entity.entityId} overlaps placement ${placementCollision.id}.`)
    const entityCollision = state.entries.find(other => other !== entity && other.occupancy === 'blocking'
      && footprintsOverlap(
        entity.position, entity.base, entity.clearance,
        other.position, other.base, other.clearance,
      ))
    if (entityCollision) fail('occupancy-conflict', `Entity ${entity.entityId} overlaps entity ${entityCollision.entityId}.`)
  }
}

export const planAbilityEntityCommand = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly command: unknown
}): AbilityEntityPlanResult => {
  const command = parseCommand(input.command)
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  const reduced = reduceAbilityEntityCommand(
    previous.abilityEntities ?? createEmptyAbilityEntityState(),
    command,
  )
  if (reduced.status === 'duplicate') return Object.freeze({ ...reduced, plan: createMoveStateChangePlan([]) })
  const entity = reduced.entity
  const source = entity ?? previous.abilityEntities?.entries.find(value => value.entityId === command.entityId)
    ?? fail('entity-missing', 'Removed entity source identity is unavailable.')
  if (command.kind === 'create' && source.ownerPlacementId !== input.context.actor.placement.id) {
    fail('controller-unauthorized', 'Ability actor cannot create an entity for another owner.')
  }
  if (!input.context.queries.effectiveAbilities.has(source.ownerPlacementId, source.canonicalId)
    || !input.context.queries.effectiveAbilities.activeForPlacement(source.ownerPlacementId)
      .some(ability => ability.instanceId === source.sourceAbilityInstanceId)) {
    fail('source-ability-inactive', 'Entity source ability is not currently effective.')
  }
  if (command.kind !== 'create' && !controllerAllows(input.context, source)) {
    fail('controller-unauthorized', 'Ability actor does not control this entity.')
  }
  validateGeometry(input.context, reduced.state)
  const current = parseEncounterState({ ...previous, abilityEntities: reduced.state })
  return Object.freeze({
    ...reduced,
    plan: createMoveStateChangePlan([{
      kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision),
      sourceOperationId: command.operationId,
      reasonCode: `ability-entity.${command.kind}`,
      previous, current, compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }]),
  })
}

export const reduceAbilityEntityLifecycle = (
  stateValue: unknown,
  event: AbilityEffectLifecycleEvent,
): AbilityEntityState => {
  const state = parseAbilityEntityState(stateValue)
  const lifecycle = reduceAbilityEffectLifecycle({
    schemaVersion: 1,
    entries: state.entries.map(entity => ({
      effectId: entity.entityId,
      sourcePlacementId: entity.ownerPlacementId,
      sourceAbilityInstanceId: entity.sourceAbilityInstanceId,
      targetPlacementIds: entity.payload.kind === 'decoy' && entity.payload.mimicsPlacementId
        ? [entity.payload.mimicsPlacementId]
        : [],
      duration: entity.duration,
    })),
  }, event)
  if (lifecycle.transitions.length === 0) return state
  const byId = new Map(lifecycle.state.entries.map(entry => [entry.effectId, entry]))
  return parseAbilityEntityState({
    schemaVersion: 1,
    entries: state.entries.flatMap(entity => {
      const retained = byId.get(entity.entityId)
      return retained ? [{ ...entity, duration: retained.duration }] : []
    }),
    receipts: state.receipts,
  })
}

export const recoverAbilityEntities = (input: {
  readonly encounter: unknown
  readonly presentPlacementIds: readonly string[]
  readonly activeAbilityInstanceIdsByPlacement: ReadonlyMap<string, readonly string[]>
}): ReturnType<typeof parseEncounterState> => {
  const encounter = parseEncounterState(input.encounter)
  let state = reduceAbilityEntityLifecycle(
    encounter.abilityEntities ?? createEmptyAbilityEntityState(),
    { kind: 'presence-snapshot', presentPlacementIds: input.presentPlacementIds },
  )
  for (const placementId of [...new Set(state.entries.map(entry => entry.ownerPlacementId))].sort()) {
    state = reduceAbilityEntityLifecycle(state, {
      kind: 'effective-ability-snapshot', placementId,
      activeAbilityInstanceIds: input.activeAbilityInstanceIdsByPlacement.get(placementId) ?? [],
    })
  }
  return parseEncounterState({ ...encounter, abilityEntities: state })
}

export const queryAbilityEntityTarget = (
  stateValue: unknown,
  entityId: string,
): AbilityEntityEntry | null => {
  const state = parseAbilityEntityState(stateValue)
  const entity = state.entries.find(value => value.entityId === entityId) ?? null
  return entity?.targetability === 'targetable' ? entity : null
}
