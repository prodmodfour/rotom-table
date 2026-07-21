import { normalizeRevision } from '#shared/sessionRevisions'
import { createEmptyEncounterState, parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import { cloneStrictJson, isPlainJsonObject } from '#shared/automation/strictJson'
import type { EncounterEventMovementMode } from '#shared/moveAutomation/events'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import { footprintsOverlap } from '~/utils/gridGeometry'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { appendMovementLogEntry } from '~/utils/mapMovementLog'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { tokenFacingForPlacement, tokenFacingStoresLegacyTurned, tokenFacingTowardPoint } from '~/utils/tokenFacing'
import {
  resolveAuthoritativeDisplacement,
  resolveAuthoritativeMovement,
  resolveAuthoritativeRelocation,
  type AuthoritativeMovementSheets,
  type AuthoritativeMovementTriggeringStep,
} from '../movement/resolveMovement'
import {
  runAuthoritativeMovementLifecycle,
  type AuthoritativeMovementLifecycleRun,
} from '../moveAutomation/movementLifecycle'
import type { EncounterLifecycleTriggerHandler } from '../moveAutomation/reduceLifecycle'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../moveAutomation/plan'
import type { AuthoritativeAbilityContext } from './context'

export const ABILITY_MOVEMENT_COMMAND_KINDS = ['shift', 'displacement', 'teleport', 'swap'] as const
export const ABILITY_MOVEMENT_LIMITS = Object.freeze({ identifierLength: 200, distance: 1_000 })
export type AbilityMovementCommand =
  | {
      readonly operationId: string
      readonly kind: 'shift'
      readonly placementId: string
      readonly destination: GridAnchor
      readonly maximumCost: number
    }
  | {
      readonly operationId: string
      readonly kind: 'displacement'
      readonly placementId: string
      readonly movementMode: 'forced' | 'voluntary'
      readonly vector: GridAnchor
      readonly requestedDistance: number
      readonly distancePolicy: 'up-to-distance' | 'full-distance-required'
    }
  | {
      readonly operationId: string
      readonly kind: 'teleport'
      readonly placementId: string
      readonly destination: GridAnchor
    }
  | {
      readonly operationId: string
      readonly kind: 'swap'
      readonly leftPlacementId: string
      readonly rightPlacementId: string
    }

export interface PlannedAbilityMovement {
  readonly placementId: string
  readonly mode: EncounterEventMovementMode
  readonly origin: GridAnchor
  readonly destination: GridAnchor
  readonly distance: number
  readonly path: readonly GridAnchor[]
  readonly triggeringSteps: readonly AuthoritativeMovementTriggeringStep[]
  readonly shortened: boolean
  readonly shorteningReason: string | null
}

export interface CompletedAbilityMovementPlan {
  readonly status: 'completed'
  readonly movements: readonly PlannedAbilityMovement[]
  readonly lifecycleRuns: readonly AuthoritativeMovementLifecycleRun[]
  readonly operations: readonly unknown[]
  readonly plan: MoveStateChangePlan
}
export interface PendingAbilityMovementPlan {
  readonly status: 'pending-interrupt'
  readonly movements: readonly PlannedAbilityMovement[]
  readonly lifecycleRuns: readonly AuthoritativeMovementLifecycleRun[]
  readonly pendingRunIndex: number
  /** No relocation is committable before its durable response saga is materialized. */
  readonly plan: MoveStateChangePlan
}
export type AbilityMovementPlanResult = CompletedAbilityMovementPlan | PendingAbilityMovementPlan

export type AbilityMovementErrorCode =
  | 'invalid-command' | 'target-unauthorized' | 'movement-illegal' | 'movement-anchored'
  | 'entity-obstructed' | 'swap-same-placement' | 'swap-final-overlap'

export class AbilityMovementError extends Error {
  constructor(readonly code: AbilityMovementErrorCode, detail: string) {
    super(detail)
    this.name = 'AbilityMovementError'
  }
}
const fail = (code: AbilityMovementErrorCode, detail: string): never => {
  throw new AbilityMovementError(code, detail)
}
const STABLE_ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const FIELDS: Readonly<Record<AbilityMovementCommand['kind'], readonly string[]>> = {
  shift: ['operationId', 'kind', 'placementId', 'destination', 'maximumCost'],
  displacement: ['operationId', 'kind', 'placementId', 'movementMode', 'vector', 'requestedDistance', 'distancePolicy'],
  teleport: ['operationId', 'kind', 'placementId', 'destination'],
  swap: ['operationId', 'kind', 'leftPlacementId', 'rightPlacementId'],
}
const stableId = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= ABILITY_MOVEMENT_LIMITS.identifierLength && STABLE_ID.test(value)
const anchor = (value: unknown, signed = false): value is GridAnchor => isPlainJsonObject(value)
  && Object.keys(value).length === 3 && ['x', 'y', 'z'].every(key => Object.prototype.hasOwnProperty.call(value, key))
  && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y) && Number.isSafeInteger(value.z)
  && (signed
    ? [value.x, value.y, value.z].every(coordinate => Number(coordinate) >= -1 && Number(coordinate) <= 1)
      && (value.x !== 0 || value.y !== 0 || value.z !== 0)
    : [value.x, value.y, value.z].every(coordinate => Number(coordinate) >= 0 && Number(coordinate) <= 1_000_000))

const parseCommand = (value: unknown): AbilityMovementCommand => {
  let cloned: unknown
  try {
    cloned = cloneStrictJson(value, 'abilityMovementCommand', {
      limits: { depth: 4, nodes: 64, objectFields: 12, arrayEntries: 0, stringLength: 200, objectKeyLength: 100 },
      rootLabel: 'ability movement command', valueLabel: 'ability movement command values',
      failNotJson: (_path, detail) => fail('invalid-command', detail),
      failLimit: (_path, detail) => fail('invalid-command', detail),
    })
  }
  catch (error) {
    if (error instanceof AbilityMovementError) throw error
    return fail('invalid-command', 'Ability movement command must be strict JSON.')
  }
  if (!isPlainJsonObject(cloned)) fail('invalid-command', 'Ability movement command must be an object.')
  const input = cloned as Record<string, unknown>
  if (typeof input.kind !== 'string' || !(input.kind in FIELDS)) fail('invalid-command', 'Movement command kind is unsupported.')
  const fields = FIELDS[input.kind as AbilityMovementCommand['kind']]
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(input, field))
    || Object.keys(input).some(field => !expected.has(field)) || !stableId(input.operationId)) {
    fail('invalid-command', 'Movement command has an invalid shape or operation ID.')
  }
  if (input.kind === 'swap') {
    if (!stableId(input.leftPlacementId) || !stableId(input.rightPlacementId)) fail('invalid-command', 'Swap placements are invalid.')
  }
  else if (!stableId(input.placementId)) fail('invalid-command', 'Movement placement is invalid.')
  if ((input.kind === 'shift' || input.kind === 'teleport') && !anchor(input.destination)) {
    fail('invalid-command', 'Movement destination is invalid.')
  }
  if (input.kind === 'shift' && (!Number.isSafeInteger(input.maximumCost)
    || Number(input.maximumCost) < 0 || Number(input.maximumCost) > ABILITY_MOVEMENT_LIMITS.distance)) {
    fail('invalid-command', 'Shift maximum cost is invalid.')
  }
  if (input.kind === 'displacement') {
    if (!anchor(input.vector, true)
      || (input.movementMode !== 'forced' && input.movementMode !== 'voluntary')
      || (input.distancePolicy !== 'up-to-distance' && input.distancePolicy !== 'full-distance-required')
      || !Number.isSafeInteger(input.requestedDistance) || Number(input.requestedDistance) < 0
      || Number(input.requestedDistance) > ABILITY_MOVEMENT_LIMITS.distance) {
      fail('invalid-command', 'Displacement mechanics are invalid.')
    }
  }
  return input as unknown as AbilityMovementCommand
}

const sheetsForContext = (context: AuthoritativeAbilityContext): AuthoritativeMovementSheets => ({
  pokemon: new Map(context.resolvedSheets.filter(sheet => sheet.kind === 'pokemon').map(sheet => [sheet.slug, sheet.sheet])),
  trainer: new Map(context.resolvedSheets.filter(sheet => sheet.kind === 'trainer').map(sheet => [sheet.slug, sheet.sheet])),
}) as AuthoritativeMovementSheets
const selectedPlacementIds = (context: AuthoritativeAbilityContext): ReadonlySet<string> => new Set([
  context.actor.placement.id,
  context.source.placement.id,
  ...context.targets.map(target => target.placement.id),
])
const assertAuthorizedTargets = (context: AuthoritativeAbilityContext, command: AbilityMovementCommand): void => {
  const allowed = selectedPlacementIds(context)
  const ids = command.kind === 'swap'
    ? [command.leftPlacementId, command.rightPlacementId]
    : [command.placementId]
  if (ids.some(id => !allowed.has(id))) fail('target-unauthorized', 'Movement target was not authoritatively selected.')
  if (command.kind === 'swap' && command.leftPlacementId === command.rightPlacementId) {
    fail('swap-same-placement', 'A placement cannot swap with itself.')
  }
}
const lockMode = (command: AbilityMovementCommand): 'voluntary' | 'forced' | 'teleport' | 'swap' => {
  if (command.kind === 'shift') return 'voluntary'
  if (command.kind === 'displacement') return command.movementMode
  return command.kind
}
const activeAnchorEntities = (context: AuthoritativeAbilityContext) => context.abilityEntities.entries.filter(entity => (
  entity.payload.kind === 'anchor'
  && context.queries.effectiveAbilities.activeForPlacement(entity.ownerPlacementId)
    .some(ability => ability.instanceId === entity.sourceAbilityInstanceId)
))
const assertNotAnchored = (context: AuthoritativeAbilityContext, command: AbilityMovementCommand): void => {
  const mode = lockMode(command)
  const ids = command.kind === 'swap' ? [command.leftPlacementId, command.rightPlacementId] : [command.placementId]
  for (const entity of activeAnchorEntities(context)) {
    if (entity.payload.kind !== 'anchor'
      || !entity.payload.preventedMovementModes.includes(mode)
      || !entity.payload.anchoredPlacementIds.some(id => ids.includes(id))) continue
    fail('movement-anchored', `Entity ${entity.entityId} prevents ${mode} movement.`)
  }
}
const assertAnchoredRange = (
  context: AuthoritativeAbilityContext,
  movements: readonly PlannedAbilityMovement[],
): void => {
  for (const movement of movements) {
    for (const entity of activeAnchorEntities(context)) {
      if (entity.payload.kind !== 'anchor'
        || entity.payload.anchorKind !== 'aa060.anchored'
        || !entity.payload.anchoredPlacementIds.includes(movement.placementId)) continue
      const distance = ptuGridDistanceBetweenFootprints(
        { position: entity.position, base: 1, clearance: 1 },
        { position: movement.destination, base: 1, clearance: 1 },
      )
      if (distance > 3) fail('movement-anchored', `Entity ${entity.entityId} limits movement to 3 meters.`)
    }
  }
}
const tokenFor = (context: AuthoritativeAbilityContext, placementId: string) => (
  context.tokens.find(token => token.id === placementId)
  ?? fail('movement-illegal', `Movement token ${placementId} is unavailable.`)
)
const blockingEntityAt = (
  context: AuthoritativeAbilityContext,
  placementId: string,
  destination: GridAnchor,
) => {
  const mover = tokenFor(context, placementId)
  return context.abilityEntities.entries.find(entity => entity.occupancy === 'blocking'
    && footprintsOverlap(
      destination, mover.base, mover.clearance,
      entity.position, entity.base, entity.clearance,
    )) ?? null
}
const assertNoEntityObstruction = (
  context: AuthoritativeAbilityContext,
  movement: PlannedAbilityMovement,
): void => {
  const obstruction = movement.triggeringSteps.find(step => blockingEntityAt(context, movement.placementId, step.to))
  if (obstruction) {
    const entity = blockingEntityAt(context, movement.placementId, obstruction.to)!
    fail('entity-obstructed', `Movement path is blocked by entity ${entity.entityId}.`)
  }
}
const ordinaryMovement = (
  context: AuthoritativeAbilityContext,
  command: Extract<AbilityMovementCommand, { kind: 'shift' }>,
): PlannedAbilityMovement => {
  const result = resolveAuthoritativeMovement({
    map: context.map,
    sheets: sheetsForContext(context),
    placementId: command.placementId,
    mode: 'shift',
    destination: command.destination,
    policy: { kind: 'standard', maximumCost: command.maximumCost },
  })
  if (result.ok === false) return fail('movement-illegal', `${result.reasonCode}: ${result.message}`)
  const movement: PlannedAbilityMovement = {
    placementId: result.placementId, mode: 'voluntary', origin: result.origin,
    destination: result.destination, distance: result.cost, path: result.path,
    triggeringSteps: result.triggeringSteps, shortened: false, shorteningReason: null,
  }
  assertNoEntityObstruction(context, movement)
  return movement
}
const displacementMovement = (
  context: AuthoritativeAbilityContext,
  command: Extract<AbilityMovementCommand, { kind: 'displacement' }>,
): PlannedAbilityMovement => {
  const result = resolveAuthoritativeDisplacement({
    map: context.map,
    sheets: sheetsForContext(context),
    placementId: command.placementId,
    movementMode: command.movementMode,
    vector: command.vector,
    requestedDistance: command.requestedDistance,
    distancePolicy: command.distancePolicy,
  })
  if (result.ok === false) return fail('movement-illegal', `${result.reasonCode}: ${result.message}`)
  const blockedIndex = result.triggeringSteps.findIndex(step => blockingEntityAt(context, result.placementId, step.to))
  if (blockedIndex >= 0 && command.distancePolicy === 'full-distance-required') {
    const blocker = blockingEntityAt(context, result.placementId, result.triggeringSteps[blockedIndex]!.to)!
    fail('entity-obstructed', `Full displacement is blocked by entity ${blocker.entityId}.`)
  }
  const steps = blockedIndex >= 0 ? result.triggeringSteps.slice(0, blockedIndex) : result.triggeringSteps
  const destination = steps.at(-1)?.to ?? result.origin
  const distance = steps.at(-1)?.cumulativeCost ?? 0
  return {
    placementId: result.placementId,
    mode: command.movementMode,
    origin: result.origin,
    destination,
    distance,
    path: [result.origin, ...steps.map(step => step.to)],
    triggeringSteps: steps.map((step, index) => ({ ...step, finalDestination: index === steps.length - 1 })),
    shortened: result.shortened || blockedIndex >= 0,
    shorteningReason: blockedIndex >= 0 ? 'ability-entity' : result.shorteningReason,
  }
}
const relocationMovement = (
  context: AuthoritativeAbilityContext,
  input: { readonly placementId: string; readonly destination: GridAnchor; readonly mode: 'teleport' | 'swap'; readonly ignoredPlacementIds?: readonly string[] },
): PlannedAbilityMovement => {
  const result = resolveAuthoritativeRelocation({
    map: context.map,
    sheets: sheetsForContext(context),
    placementId: input.placementId,
    destination: input.destination,
    mode: input.mode,
    ignoredPlacementIds: input.ignoredPlacementIds,
  })
  if (result.ok === false) return fail('movement-illegal', `${result.reasonCode}: ${result.message}`)
  const movement: PlannedAbilityMovement = {
    placementId: result.placementId, mode: input.mode,
    origin: result.origin, destination: result.destination, distance: result.distance,
    path: result.path, triggeringSteps: result.triggeringSteps,
    shortened: false, shorteningReason: null,
  }
  assertNoEntityObstruction(context, movement)
  return movement
}
const resolveMovements = (
  context: AuthoritativeAbilityContext,
  command: AbilityMovementCommand,
): readonly PlannedAbilityMovement[] => {
  if (command.kind === 'shift') return [ordinaryMovement(context, command)]
  if (command.kind === 'displacement') return [displacementMovement(context, command)]
  if (command.kind === 'teleport') return [relocationMovement(context, { ...command, mode: 'teleport' })]
  const left = context.queries.placements.get(command.leftPlacementId)
    ?? fail('movement-illegal', 'Left swap placement is missing.')
  const right = context.queries.placements.get(command.rightPlacementId)
    ?? fail('movement-illegal', 'Right swap placement is missing.')
  const movements = [
    relocationMovement(context, {
      placementId: left.id, destination: right.position, mode: 'swap', ignoredPlacementIds: [right.id],
    }),
    relocationMovement(context, {
      placementId: right.id, destination: left.position, mode: 'swap', ignoredPlacementIds: [left.id],
    }),
  ].sort((a, b) => a.placementId < b.placementId ? -1 : a.placementId > b.placementId ? 1 : 0)
  const leftFinal = { ...tokenFor(context, movements[0]!.placementId), position: movements[0]!.destination }
  const rightFinal = { ...tokenFor(context, movements[1]!.placementId), position: movements[1]!.destination }
  if (footprintsOverlap(
    leftFinal.position, leftFinal.base, leftFinal.clearance,
    rightFinal.position, rightFinal.base, rightFinal.clearance,
  )) fail('swap-final-overlap', 'Swap footprints overlap in their final positions.')
  return movements
}

const lifecycleFor = (
  state: EncounterState,
  movement: PlannedAbilityMovement,
  operationId: string,
  index: number,
  handlers: readonly EncounterLifecycleTriggerHandler[],
): AuthoritativeMovementLifecycleRun => runAuthoritativeMovementLifecycle({
  state,
  movement,
  movementId: `${operationId}.path-${index}`,
  sourceOperationId: operationId,
  mode: movement.mode,
  handlers,
})
const movedPlacement = (placement: SheetPlacement, destination: GridAnchor): SheetPlacement => {
  const from = placement.position
  const facing = tokenFacingTowardPoint(from, destination, tokenFacingForPlacement(placement))
  return {
    ...deepCloneJson(placement),
    position: deepCloneJson(destination),
    ...(facing === null ? {} : {
      facing,
      turned: tokenFacingStoresLegacyTurned(facing),
    }),
  }
}
const buildStatePlan = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly command: AbilityMovementCommand
  readonly movements: readonly PlannedAbilityMovement[]
  readonly encounterState: EncounterState
  readonly userName: string
}): MoveStateChangePlan => {
  const revision = normalizeRevision(input.context.map.revision)
  const changes: MoveStateChangeInput[] = []
  const movedById = new Map(input.movements.filter(movement => !sameJsonValue(movement.origin, movement.destination))
    .map(movement => [movement.placementId, movement]))
  for (const placement of input.context.map.placements) {
    const movement = movedById.get(placement.id)
    if (!movement) continue
    changes.push({
      kind: 'placement-state', scope: { kind: 'placement', mapSlug: input.context.map.slug, placementId: placement.id },
      expectedRevision: revision, sourceOperationId: input.command.operationId,
      reasonCode: `ability-movement.${input.command.kind}`,
      previous: placement, current: movedPlacement(placement, movement.destination),
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  const previousEncounter = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  if (!sameJsonValue(previousEncounter, input.encounterState)) {
    changes.push({
      kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: revision, sourceOperationId: input.command.operationId,
      reasonCode: `ability-movement.${input.command.kind}.lifecycle`,
      previous: previousEncounter, current: input.encounterState,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  let metadata = deepCloneJson(input.context.map.metadata)
  for (const movement of input.movements) {
    if (sameJsonValue(movement.origin, movement.destination)) continue
    metadata = appendMovementLogEntry(metadata, {
      userId: movement.placementId,
      userName: input.userName,
      from: movement.origin,
      to: movement.destination,
      pathLength: movement.distance,
    }, { now: () => input.context.time })
  }
  if (!sameJsonValue(metadata, input.context.map.metadata)) {
    changes.push({
      kind: 'map-metadata', scope: { kind: 'map', mapSlug: input.context.map.slug },
      expectedRevision: revision, sourceOperationId: input.command.operationId,
      reasonCode: `ability-movement.${input.command.kind}.audit-log`,
      previous: input.context.map.metadata, current: metadata,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  return createMoveStateChangePlan(changes)
}

/**
 * Resolve and plan reviewed ability movement without accepting a client path,
 * distance, collision result, or checkpoint decision.
 */
export const planAbilityMovement = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly command: unknown
  readonly handlers?: readonly EncounterLifecycleTriggerHandler[]
  readonly userName?: string
}): AbilityMovementPlanResult => {
  const command = parseCommand(input.command)
  assertAuthorizedTargets(input.context, command)
  assertNotAnchored(input.context, command)
  const movements = resolveMovements(input.context, command)
  assertAnchoredRange(input.context, movements)
  const lifecycleRuns: AuthoritativeMovementLifecycleRun[] = []
  let state = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  for (const [index, movement] of movements.entries()) {
    const run = lifecycleFor(state, movement, command.operationId, index, input.handlers ?? [])
    lifecycleRuns.push(run)
    if (run.status === 'pending-interrupt') {
      return Object.freeze({
        status: 'pending-interrupt', movements: Object.freeze(movements),
        lifecycleRuns: Object.freeze(lifecycleRuns), pendingRunIndex: index,
        plan: createMoveStateChangePlan([]),
      })
    }
    state = run.state
  }
  return Object.freeze({
    status: 'completed', movements: Object.freeze(movements),
    lifecycleRuns: Object.freeze(lifecycleRuns),
    operations: Object.freeze(lifecycleRuns.flatMap(run => run.operations)),
    plan: buildStatePlan({
      context: input.context, command, movements, encounterState: state,
      userName: input.userName ?? 'Ability automation',
    }),
  })
}
