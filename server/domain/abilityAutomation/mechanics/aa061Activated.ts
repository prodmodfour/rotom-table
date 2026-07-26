import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import type { TabletopMap } from '~/types/map'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { computeTickValue } from '~/utils/ptuHp'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { applyHpToSheet, type AnyLiveSheet } from '~/utils/sheetMutations'
import { createMoveStateChangePlan, RESTORE_PREVIOUS_MOVE_STATE_VALUE, type MoveStateChangeInput, type MoveStateChangePlan } from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityFrequencyPayment } from '../usage'
import { planAbilityOwnedStateCommand } from '../ownedState'
import { planAbilityMovement } from '../movement'
import { aa061AquaBulletMarkId, aa061AuraBreakMarkId } from './aa061MoveIntegration'
import { findMove } from '~~/data/ptuReference'
import { aa061BallFetchReleaseMarkId } from './aa061PresenceIntegration'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'
import { aa084PowerConstructBlocksTemporaryHp } from './aa084StaticIntegration'

const ARENA_TRAP_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Scene – Free Action', actionText: 'Free Action', kind: 'scene', uses: 1, exceptionId: null,
})
const BATTERY_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Scene x2 – Swift Action', actionText: 'Swift Action', kind: 'scene', uses: 2, exceptionId: null,
})
const AURA_BREAK_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Scene x2 – Swift Action', actionText: 'Swift Action', kind: 'scene', uses: 2, exceptionId: null,
})
const fail = (detail: string): never => { throw new Aa061ActivatedExecutionError(detail) }
export class Aa061ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa061ActivatedExecutionError' }
}
const value = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  id: string,
): AbilityDeclarationOptionValue | null => choices.find(choice => choice.declarationId === id)?.options[0]?.value ?? null
const mapWithEncounter = (map: TabletopMap, encounter: unknown): TabletopMap => ({ ...map, encounterState: parseEncounterState(encounter) })
const planEncounterCurrent = (plan: MoveStateChangePlan, fallback: unknown): ReturnType<typeof parseEncounterState> => {
  const change = plan.changes.find(entry => entry.kind === 'encounter-state')
  return parseEncounterState(change?.kind === 'encounter-state' ? change.current : fallback)
}
const withMap = (context: AuthoritativeAbilityContext, map: TabletopMap): AuthoritativeAbilityContext => ({ ...context, map })
const materializeMovementPlan = (map: TabletopMap, plan: MoveStateChangePlan): TabletopMap => {
  let next = map
  for (const change of plan.changes) {
    if (change.kind === 'placement-state') {
      const current = change.current ?? fail('Ability movement cannot remove its source placement.')
      next = {
        ...next,
        placements: next.placements.map(placement => placement.id === change.scope.placementId ? current : placement),
      }
    }
    else if (change.kind === 'encounter-state') next = mapWithEncounter(next, change.current)
    else if (change.kind === 'map-metadata') next = { ...next, metadata: change.current }
  }
  return next
}
const nonEncounterMovementChanges = (plan: MoveStateChangePlan): MoveStateChangeInput[] => plan.changes
  .filter(change => change.kind !== 'encounter-state')
  .map(({ id: _id, order: _order, ...change }) => change)

const aquaBulletExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa061ActivatedExecution => {
  const selectedMove = value(input.choices, 'launch.move')
  const selectedCell = value(input.choices, 'launch.cell')
  const moveId = selectedMove?.kind === 'move'
    ? selectedMove.canonicalMoveId
    : fail('Aqua Bullet requires one issued move.')
  const destination = selectedCell?.kind === 'cell'
    ? selectedCell.cell
    : fail('Aqua Bullet requires one issued destination.')
  const sheetMove = input.context.actor.sheet.sheet.movelist?.find(move => move.name === moveId)
  const canonicalMove = findMove(moveId)
  const moveType = sheetMove?.type ?? canonicalMove?.type
  const damageClass = sheetMove?.category ?? canonicalMove?.damage_class
  if (moveType?.trim().toLowerCase() !== 'water'
    || (damageClass !== 'Physical' && damageClass !== 'Special')) {
    fail('Aqua Bullet requires a damaging Water-Type move.')
  }
  const origin = input.context.actor.placement.position
  const delta = {
    x: destination.x - origin.x,
    y: destination.y - origin.y,
    z: destination.z - origin.z,
  }
  const distance = Math.max(Math.abs(delta.x), Math.abs(delta.y), Math.abs(delta.z))
  const straight = distance > 0 && distance <= 10
    && [delta.x, delta.y, delta.z].every(value => value === 0 || Math.abs(value) === distance)
  if (!straight) fail('Aqua Bullet destination must be within 10 meters on one straight line.')
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  const action = planEncounterMoveResourceCosts({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
    canonicalMoveId: 'ability:Aqua Bullet', moveKey: 'ability:aqua-bullet', range: 'Full Action',
    resolutionId: input.context.resolutionId, sourceOperationId: `${input.operationId}:action`, movement: null,
    reviewedCosts: [{ id: 'ability.action.full', phase: 'pay', cost: { kind: 'action-resource', resource: 'full', amount: 1 } }],
    allowLegacyFallback: false, minimumPhaseExclusive: null, maximumPhaseInclusive: 'pay',
  })
  const movement = planAbilityMovement({
    context: withMap(input.context, action.nextMap),
    command: {
      operationId: `${input.operationId}:movement`, kind: 'displacement',
      placementId: input.context.actor.placement.id,
      movementMode: 'voluntary',
      vector: {
        x: Math.sign(delta.x), y: Math.sign(delta.y), z: Math.sign(delta.z),
      },
      requestedDistance: distance,
      distancePolicy: 'full-distance-required',
    },
    userName: input.context.actor.token.species,
  })
  if (movement.status !== 'completed') fail('Aqua Bullet movement opened an unsupported interrupt window.')
  let map = materializeMovementPlan(action.nextMap, movement.plan)
  const stateId = `${input.abilityInstanceId}:aqua-bullet:${input.operationId}`
  const mark = planAbilityOwnedStateCommand({
    context: withMap(input.context, map),
    command: {
      operationId: `${input.operationId}:mark`, kind: 'create', stateId, expectedVersion: null,
      entry: {
        stateId, ownerPlacementId: input.context.actor.placement.id,
        sourceAbilityInstanceId: input.abilityInstanceId, canonicalId: 'Aqua Bullet',
        targetPlacementIds: [], lifecycle: { kind: 'turn', targetPolicy: null },
        payload: { kind: 'mark', markId: aa061AquaBulletMarkId(moveId) },
      },
    },
  })
  map = mapWithEncounter(map, planEncounterCurrent(mark.plan, map.encounterState))
  const current = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  const nonEncounter = nonEncounterMovementChanges(movement.plan)
  return Object.freeze({
    plan: createMoveStateChangePlan([
      ...nonEncounter,
      {
        kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
        expectedRevision: normalizeRevision(input.context.map.revision), sourceOperationId: input.operationId,
        reasonCode: 'ability.aa061.aqua-bullet.launch', previous, current,
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
    ]),
    presentationKey: 'ability.aa061.aqua-bullet.attack-ready',
  })
}

const ballFetchExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa061ActivatedExecution => {
  const selectedTarget = value(input.choices, 'fetch.target')
  const selectedCell = value(input.choices, 'fetch.cell')
  const releasedPlacementId = selectedTarget?.kind === 'token'
    ? selectedTarget.placementId
    : fail('Ball Fetch requires one issued released Pokémon.')
  const destination = selectedCell?.kind === 'cell'
    ? selectedCell.cell
    : fail('Ball Fetch requires one issued destination.')
  const mark = (input.context.map.encounterState?.abilityOwnedState?.entries ?? []).find(entry => (
    entry.ownerPlacementId === input.context.actor.placement.id
    && entry.sourceAbilityInstanceId === input.abilityInstanceId
    && entry.canonicalId === 'Ball Fetch'
    && entry.targetPlacementIds.includes(releasedPlacementId)
    && entry.payload.kind === 'mark'
    && entry.payload.markId === aa061BallFetchReleaseMarkId(releasedPlacementId)
  )) ?? fail('Ball Fetch has no pending trigger for that released Pokémon.')
  const released = input.context.queries.tokens.get(releasedPlacementId)
    ?? fail('The released Pokémon is no longer present.')
  const beforeDistance = ptuGridDistanceBetweenFootprints(input.context.actor.token, released)
  const movement = planAbilityMovement({
    context: input.context,
    command: {
      operationId: `${input.operationId}:movement`, kind: 'shift',
      placementId: input.context.actor.placement.id,
      destination,
      maximumCost: 1_000,
    },
    userName: input.context.actor.token.species,
  })
  if (movement.status !== 'completed') fail('Ball Fetch movement opened an unsupported interrupt window.')
  const resolvedMovement = movement.movements[0] ?? fail('Ball Fetch did not resolve movement.')
  const movedToken = { ...input.context.actor.token, position: resolvedMovement.destination }
  const afterDistance = ptuGridDistanceBetweenFootprints(movedToken, released)
  if (afterDistance >= beforeDistance) fail('Ball Fetch movement must end closer to the released Pokémon.')
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  let map = materializeMovementPlan(input.context.map, movement.plan)
  const currentMark = map.encounterState?.abilityOwnedState?.entries.find(entry => entry.stateId === mark.stateId)
    ?? fail('Ball Fetch trigger expired during movement.')
  const consumed = planAbilityOwnedStateCommand({
    context: withMap(input.context, map),
    command: {
      operationId: `${input.operationId}:consume`, kind: 'remove', stateId: currentMark.stateId,
      expectedVersion: currentMark.version,
    },
  })
  map = mapWithEncounter(map, planEncounterCurrent(consumed.plan, map.encounterState))
  const current = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  return Object.freeze({
    plan: createMoveStateChangePlan([
      ...nonEncounterMovementChanges(movement.plan),
      {
        kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
        expectedRevision: normalizeRevision(input.context.map.revision), sourceOperationId: input.operationId,
        reasonCode: 'ability.aa061.ball-fetch.shift', previous, current,
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
    ]),
    presentationKey: 'ability.aa061.ball-fetch.shifted',
  })
}

const auraBreakExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa061ActivatedExecution => {
  const selectedTarget = value(input.choices, 'activate.target')
  const selectedAbility = value(input.choices, 'activate.ability')
  const targetPlacementId = selectedTarget?.kind === 'token'
    ? selectedTarget.placementId
    : fail('Aura Break requires one issued foe target.')
  const abilitySelection = selectedAbility?.kind === 'ability'
    ? selectedAbility
    : fail('Aura Break requires one issued Ability belonging to the selected foe.')
  if (input.context.queries.relationships.relation(input.context.actor.placement.id, targetPlacementId) !== 'enemy'
    || !abilitySelection.canonicalAbilityId.toLowerCase().includes('aura')) {
    fail('Aura Break can select only an Aura Ability belonging to a foe.')
  }
  const targetAbility = input.context.queries.effectiveAbilities.allForPlacement(targetPlacementId)
    .find(ability => ability.effective
      && ability.instanceId === abilitySelection.abilityInstanceId
      && ability.canonicalId === abilitySelection.canonicalAbilityId)
    ?? fail('The selected Aura Ability is no longer effective.')
  const action = planEncounterMoveResourceCosts({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
    canonicalMoveId: 'ability:Aura Break', moveKey: 'ability:aura-break', range: 'Swift Action',
    resolutionId: input.context.resolutionId, sourceOperationId: `${input.operationId}:action`, movement: null,
    reviewedCosts: [{ id: 'ability.action.swift', phase: 'pay', cost: { kind: 'action-resource', resource: 'swift', amount: 1 } }],
    allowLegacyFallback: false, minimumPhaseExclusive: null, maximumPhaseInclusive: 'pay',
  })
  const usage = planAbilityFrequencyPayment({
    context: withMap(input.context, action.nextMap), frequency: AURA_BREAK_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId, clauseId: 'base',
    operationId: `${input.operationId}:usage`, sceneId: action.nextMap.encounterState?.history.sceneId ?? undefined,
  })
  const mapAfterUsage = mapWithEncounter(action.nextMap, planEncounterCurrent(usage.plan, action.nextMap.encounterState))
  const stateId = `${input.abilityInstanceId}:aura-break:${input.operationId}`
  const mark = planAbilityOwnedStateCommand({
    context: withMap(input.context, mapAfterUsage),
    command: {
      operationId: `${input.operationId}:mark`, kind: 'create', stateId, expectedVersion: null,
      entry: {
        stateId, ownerPlacementId: input.context.actor.placement.id,
        sourceAbilityInstanceId: input.abilityInstanceId, canonicalId: 'Aura Break',
        targetPlacementIds: [targetPlacementId], lifecycle: { kind: 'scene', targetPolicy: null },
        payload: { kind: 'mark', markId: aa061AuraBreakMarkId(targetAbility.instanceId) },
      },
    },
  })
  const current = planEncounterCurrent(mark.plan, mapAfterUsage.encounterState)
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  return Object.freeze({
    plan: createMoveStateChangePlan([{
      kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision), sourceOperationId: input.operationId,
      reasonCode: 'ability.aa061.aura-break.activate', previous, current,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }]),
    presentationKey: 'ability.aa061.aura-break.inversion-active',
  })
}

const arenaTrapExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa061ActivatedExecution => {
  const ending = input.context.request.modeId === 'end'
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  const action = planEncounterMoveResourceCosts({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
    canonicalMoveId: 'ability:Arena Trap', moveKey: 'ability:arena-trap', range: 'Free Action',
    resolutionId: input.context.resolutionId, sourceOperationId: `${input.operationId}:action`, movement: null,
    reviewedCosts: [{ id: 'ability.action.free', phase: 'pay', cost: { kind: 'action-resource', resource: 'free', amount: 1 } }],
    allowLegacyFallback: false, minimumPhaseExclusive: null, maximumPhaseInclusive: 'pay',
  })
  let map = action.nextMap
  const stateId = `${input.abilityInstanceId}:arena-trap`
  const existing = map.encounterState?.abilityOwnedState?.entries.find(entry => entry.stateId === stateId)
  if (ending) {
    const existingState = existing ?? fail('Arena Trap is not active.')
    const removed = planAbilityOwnedStateCommand({
      context: withMap(input.context, map),
      command: {
        operationId: `${input.operationId}:end`, kind: 'remove', stateId,
        expectedVersion: existingState.version,
      },
    })
    map = mapWithEncounter(map, planEncounterCurrent(removed.plan, map.encounterState))
  }
  else {
    if (existing) fail('Arena Trap is already active.')
    const frequency = planAbilityFrequencyPayment({
      context: withMap(input.context, map), frequency: ARENA_TRAP_FREQUENCY,
      abilityInstanceId: input.abilityInstanceId, clauseId: 'base',
      operationId: `${input.operationId}:frequency`, sceneId: map.encounterState?.history.sceneId ?? undefined,
    })
    map = mapWithEncounter(map, planEncounterCurrent(frequency.plan, map.encounterState))
    const created = planAbilityOwnedStateCommand({
      context: withMap(input.context, map),
      command: {
        operationId: `${input.operationId}:mark`, kind: 'create', stateId, expectedVersion: null,
        entry: {
          stateId,
          ownerPlacementId: input.context.actor.placement.id,
          sourceAbilityInstanceId: input.abilityInstanceId,
          canonicalId: 'Arena Trap', targetPlacementIds: [],
          lifecycle: { kind: 'source-ability', targetPolicy: null },
          payload: { kind: 'mark', markId: 'aa061.arena-trap.active' },
        },
      },
    })
    map = mapWithEncounter(map, planEncounterCurrent(created.plan, map.encounterState))
  }
  const current = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  return Object.freeze({
    plan: createMoveStateChangePlan(sameJsonValue(previous, current) ? [] : [{
      kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision), sourceOperationId: input.operationId,
      reasonCode: ending ? 'ability.aa061.arena-trap.ended' : 'ability.aa061.arena-trap.activated',
      previous, current, compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }]),
    presentationKey: ending ? 'ability.aa061.arena-trap.ended' : 'ability.aa061.arena-trap.accepted',
  })
}

const badDreamsExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa061ActivatedExecution => {
  const action = planEncounterMoveResourceCosts({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
    canonicalMoveId: 'ability:Bad Dreams', moveKey: 'ability:bad-dreams', range: 'Swift Action',
    resolutionId: input.context.resolutionId, sourceOperationId: `${input.operationId}:action`, movement: null,
    reviewedCosts: [{ id: 'ability.action.swift', phase: 'pay', cost: { kind: 'action-resource', resource: 'swift', amount: 1 } }],
    allowLegacyFallback: false, minimumPhaseExclusive: null, maximumPhaseInclusive: 'pay',
  })
  const changes: MoveStateChangeInput[] = action.changed ? [{
    kind: 'encounter-state',
    scope: { kind: 'encounter', mapSlug: input.context.map.slug },
    expectedRevision: normalizeRevision(input.context.map.revision),
    sourceOperationId: `${input.operationId}:action`,
    reasonCode: 'ability.aa061.bad-dreams.action',
    previous: action.previousEncounterState,
    current: action.currentEncounterState,
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }] : []
  const mutations = new Map<string, { participant: AuthoritativeAbilityContext['actor']; previous: AnyLiveSheet; current: AnyLiveSheet }>()
  let anyLoss = false
  const participants = input.context.queries.placements.all().flatMap((placement) => {
    const token = input.context.queries.tokens.get(placement.id)
    const resolvedSheet = input.context.queries.sheets.forPlacement(placement)
    return token && resolvedSheet ? [{
      placement,
      token,
      sheet: resolvedSheet,
      effectiveAbilities: input.context.queries.effectiveAbilities.allForPlacement(placement.id),
    }] : []
  })
  for (const participant of participants) {
    if (ptuGridDistanceBetweenFootprints(input.context.actor.token, participant.token) > 5
      || !normalizeConditionNames(participant.token.conditions).includes('Sleep')) continue
    const tick = computeTickValue(participant.token.fullMaxHp ?? participant.token.maxHp)
    const currentHp = Math.max(0, participant.token.currentHp - tick)
    if (currentHp >= participant.token.currentHp) continue
    anyLoss = true
    const previous = deepCloneJson(participant.sheet.sheet) as AnyLiveSheet
    const current = applyHpToSheet(participant.sheet.kind, previous, currentHp)
    mutations.set(participant.placement.id, { participant, previous, current })
  }
  if (anyLoss && !authoritativeAbilityHealingBlocked({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
  }) && !aa084PowerConstructBlocksTemporaryHp({
    context: input.context,
    placementId: input.context.actor.placement.id,
  })) {
    const activeScene = input.context.map.activeScene
      ?? fail('Bad Dreams requires an active Scene for temporary Hit Points.')
    const previousTemporary = input.context.map.temporaryHitPoints
    const currentBase = previousTemporary
      && previousTemporary.scene.name === activeScene.name
      && previousTemporary.scene.startedAt === activeScene.startedAt
      ? previousTemporary
      : { scene: { ...activeScene }, byPlacementId: {} }
    const tick = computeTickValue(input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp)
    changes.push({
      kind: 'map-temporary-hit-points',
      scope: { kind: 'map', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision),
      sourceOperationId: `${input.operationId}:temporary-hp`,
      reasonCode: 'ability.aa061.bad-dreams.temporary-hp',
      previous: deepCloneJson(previousTemporary),
      current: {
        scene: { ...currentBase.scene },
        byPlacementId: {
          ...currentBase.byPlacementId,
          [input.context.actor.placement.id]: (currentBase.byPlacementId[input.context.actor.placement.id] ?? 0) + tick,
        },
      },
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  for (const { participant, previous, current } of mutations.values()) {
    current.revision = nextRevision(participant.sheet.revision)
    changes.push({
      kind: 'sheet-state',
      scope: { kind: 'sheet', sheetKind: participant.sheet.kind, sheetSlug: participant.sheet.slug },
      expectedRevision: participant.sheet.revision,
      sourceOperationId: `${input.operationId}:hp:${participant.placement.id}`,
      reasonCode: 'ability.aa061.bad-dreams.hp',
      previous,
      current,
      changedFields: ['hp'],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: anyLoss ? 'ability.aa061.bad-dreams.applied' : 'ability.aa061.bad-dreams.no-op',
  })
}

export interface Aa061ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

/** Closed AA-061 activated lane; blocked cohort members remain unreachable. */
export const executeAa061ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa061ActivatedExecution => {
  if (input.operation.mechanicId === 'aa061.ball-fetch'
    && input.context.runtime.canonicalId === 'Ball Fetch'
    && input.context.request.modeId === 'fetch') {
    return ballFetchExecution({
      context: input.context,
      operationId: input.operationId,
      abilityInstanceId: input.abilityInstanceId,
      choices: input.choices,
    })
  }
  if (input.operation.mechanicId === 'aa061.aura-break'
    && input.context.runtime.canonicalId === 'Aura Break'
    && input.context.request.modeId === 'activate') {
    return auraBreakExecution({
      context: input.context,
      operationId: input.operationId,
      abilityInstanceId: input.abilityInstanceId,
      choices: input.choices,
    })
  }
  if (input.operation.mechanicId === 'aa061.aqua-bullet'
    && input.context.runtime.canonicalId === 'Aqua Bullet'
    && input.context.request.modeId === 'launch') {
    return aquaBulletExecution({
      context: input.context,
      operationId: input.operationId,
      abilityInstanceId: input.abilityInstanceId,
      choices: input.choices,
    })
  }
  if ((input.operation.mechanicId === 'aa061.arena-trap' || input.operation.mechanicId === 'aa061.arena-trap-end')
    && input.context.runtime.canonicalId === 'Arena Trap') {
    return arenaTrapExecution({
      context: input.context,
      operationId: input.operationId,
      abilityInstanceId: input.abilityInstanceId,
    })
  }
  if (input.operation.mechanicId === 'aa061.bad-dreams' && input.context.runtime.canonicalId === 'Bad Dreams') {
    return badDreamsExecution({ context: input.context, operationId: input.operationId })
  }
  if (input.operation.mechanicId !== 'aa061.battery' || input.context.runtime.canonicalId !== 'Battery') {
    fail(`AA-061 mechanic ${input.operation.mechanicId} has no activated adapter.`)
  }
  const selected = value(input.choices, 'activate.target')
  const targetId = selected?.kind === 'token'
    ? selected.placementId
    : fail('Battery requires one issued target choice.')
  const target = input.context.targets.find(candidate => candidate.placement.id === targetId)
    ?? fail('Battery target is unavailable.')
  if (input.context.queries.relationships.relation(input.context.actor.placement.id, target.placement.id) !== 'ally'
    || ptuGridDistanceBetweenFootprints(input.context.actor.token, target.token) > 1) {
    fail('Battery requires an adjacent ally.')
  }
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  const action = planEncounterMoveResourceCosts({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
    canonicalMoveId: 'ability:Battery', moveKey: 'ability:battery', range: 'Swift Action',
    resolutionId: input.context.resolutionId, sourceOperationId: `${input.operationId}:action`, movement: null,
    reviewedCosts: [{ id: 'ability.action.swift', phase: 'pay', cost: { kind: 'action-resource', resource: 'swift', amount: 1 } }],
    allowLegacyFallback: false, minimumPhaseExclusive: null, maximumPhaseInclusive: 'pay',
  })
  let map = action.nextMap
  const frequency = planAbilityFrequencyPayment({
    context: withMap(input.context, map), frequency: BATTERY_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId, clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: map.encounterState?.history.sceneId ?? undefined,
  })
  map = mapWithEncounter(map, planEncounterCurrent(frequency.plan, map.encounterState))
  const stateId = `${input.abilityInstanceId}:battery:${target.placement.id}:${input.operationId}`
  const mark = planAbilityOwnedStateCommand({
    context: withMap(input.context, map),
    command: {
      operationId: `${input.operationId}:mark`, kind: 'create', stateId, expectedVersion: null,
      entry: {
        stateId,
        ownerPlacementId: input.context.actor.placement.id,
        sourceAbilityInstanceId: input.abilityInstanceId,
        canonicalId: 'Battery',
        targetPlacementIds: [target.placement.id],
        lifecycle: { kind: 'target-presence', targetPolicy: 'any-target-leaves' },
        payload: { kind: 'mark', markId: 'aa061.battery.next-special' },
      },
    },
  })
  map = mapWithEncounter(map, planEncounterCurrent(mark.plan, map.encounterState))
  const current = parseEncounterState(map.encounterState ?? createEmptyEncounterState())
  return Object.freeze({
    plan: createMoveStateChangePlan(sameJsonValue(previous, current) ? [] : [{
      kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision), sourceOperationId: input.operationId,
      reasonCode: 'ability.aa061.battery.activated', previous, current,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }]),
    presentationKey: 'ability.aa061.battery.accepted',
  })
}
