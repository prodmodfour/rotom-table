import { normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { applyEncounterEffectLifecycleEvent } from '../../moveAutomation/effectLifecycle'
import { removeMapGlobalFields } from '../../moveAutomation/fieldMapState'
import { projectGlobalFieldZonesToMapEffects } from '../../moveAutomation/fieldMapState'
import type { EncounterCapabilityEffect } from '#shared/moveAutomation/encounterEffects'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { applyConditionsToSheet, type AnyLiveSheet } from '~/utils/sheetMutations'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityFrequencyPayment } from '../usage'
import { AA063_CLAY_CANNONS_CAPABILITY_ID } from './aa063MoveIntegration'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'

const CHERRY_POWER_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Daily – Swift Action', actionText: 'Swift Action', kind: 'daily', uses: 1, exceptionId: null,
})
const CLOUD_NINE_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Scene – Free Action', actionText: 'Free Action', kind: 'scene', uses: 1, exceptionId: null,
})
const PERSISTENT_CONDITIONS = new Set(['Burned', 'Frozen', 'Paralysis', 'Poisoned', 'Badly Poisoned'])
export class Aa063ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa063ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa063ActivatedExecutionError(detail) }
const mapWithEncounter = (context: AuthoritativeAbilityContext, encounter: unknown): AuthoritativeAbilityContext => ({
  ...context, map: { ...context.map, encounterState: parseEncounterState(encounter) },
})
const actionPlan = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  canonicalId: string
  action: 'swift' | 'free'
}) => planEncounterMoveResourceCosts({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  canonicalMoveId: `ability:${input.canonicalId}`,
  moveKey: `ability:${input.canonicalId.toLowerCase().replaceAll(' ', '-')}`,
  range: input.action === 'swift' ? 'Swift Action' : 'Free Action',
  resolutionId: input.context.resolutionId,
  sourceOperationId: `${input.operationId}:action`, movement: null,
  reviewedCosts: [{
    id: `ability.action.${input.action}`, phase: 'pay',
    cost: { kind: 'action-resource', resource: input.action, amount: 1 },
  }],
  allowLegacyFallback: false, minimumPhaseExclusive: null, maximumPhaseInclusive: 'pay',
})
const encounterChange = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  reasonCode: string
  previous: unknown
  current: unknown
}): MoveStateChangeInput => ({
  kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
  expectedRevision: normalizeRevision(input.context.map.revision), sourceOperationId: input.operationId,
  reasonCode: input.reasonCode, previous: parseEncounterState(input.previous), current: parseEncounterState(input.current),
  compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
})

const cherryPowerExecution = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  abilityInstanceId: string
}): Aa063ActivatedExecution => {
  const action = actionPlan({ context: input.context, operationId: input.operationId, canonicalId: 'Cherry Power', action: 'swift' })
  const dayKey = input.context.actor.sheet.sheet.abilityUsage?.dayKey ?? 'campaign-day:initial'
  const frequency = planAbilityFrequencyPayment({
    context: input.context, frequency: CHERRY_POWER_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId, clauseId: 'base',
    operationId: `${input.operationId}:frequency`, dayKey,
  })
  const frequencySheet = frequency.plan.changes.find(change => change.kind === 'sheet-state')
    ?? fail('Cherry Power daily payment did not produce its authoritative sheet change.')
  if (frequencySheet.kind !== 'sheet-state') return fail('Cherry Power received an invalid frequency change.')
  const paidSheet = deepCloneJson(frequencySheet.current) as AnyLiveSheet
  const conditions = normalizeConditionNames(input.context.actor.token.conditions)
    .filter(condition => !PERSISTENT_CONDITIONS.has(condition))
  const curedSheet = applyConditionsToSheet(input.context.actor.sheet.kind, paidSheet, conditions)
  const activeScene = input.context.map.activeScene ?? fail('Cherry Power requires an active Scene for Temporary Hit Points.')
  const previousTemporary = input.context.map.temporaryHitPoints
  const currentBase = previousTemporary
    && previousTemporary.scene.name === activeScene.name
    && previousTemporary.scene.startedAt === activeScene.startedAt
    ? previousTemporary
    : { scene: { ...activeScene }, byPlacementId: {} }
  const changes: MoveStateChangeInput[] = [
    ...(action.changed ? [encounterChange({
      context: input.context, operationId: `${input.operationId}:action`, reasonCode: 'ability.aa063.cherry-power.action',
      previous: action.previousEncounterState, current: action.currentEncounterState,
    })] : []),
    {
      ...frequencySheet,
      sourceOperationId: input.operationId,
      reasonCode: 'ability.aa063.cherry-power.daily-and-cure',
      current: curedSheet,
      changedFields: [...new Set([...frequencySheet.changedFields, 'conditions' as const])],
    },
    {
      kind: 'map-temporary-hit-points', scope: { kind: 'map', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision), sourceOperationId: `${input.operationId}:temporary-hp`,
      reasonCode: 'ability.aa063.cherry-power.temporary-hp', previous: deepCloneJson(previousTemporary),
      current: {
        scene: { ...currentBase.scene },
        byPlacementId: {
          ...currentBase.byPlacementId,
          [input.context.actor.placement.id]: authoritativeAbilityHealingBlocked({
            map: input.context.map,
            placementId: input.context.actor.placement.id,
          })
            ? currentBase.byPlacementId[input.context.actor.placement.id] ?? 0
            : Math.max(15, currentBase.byPlacementId[input.context.actor.placement.id] ?? 0),
        },
      },
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    },
  ]
  return Object.freeze({
    plan: createMoveStateChangePlan(changes), presentationKey: 'ability.aa063.cherry-power.applied',
  })
}

const clayCannonsEffect = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
}): EncounterCapabilityEffect => ({
  id: `ability.clay-cannons.${input.context.actor.placement.id}`,
  kind: 'capability',
  source: { operationId: input.operationId, moveId: 'ability.clay-cannons', placementId: input.context.actor.placement.id },
  affected: { placementIds: [input.context.actor.placement.id], sideIds: [], cells: [] },
  createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
  createdTurn: Math.max(0, input.context.map.encounterState?.history.currentTurn?.turn ?? 0),
  duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
  stacks: 1, charges: null,
  stackPolicy: { kind: 'refresh', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
  tags: ['ability', 'aa063', 'clay-cannons'],
  payload: { capabilityId: AA063_CLAY_CANNONS_CAPABILITY_ID, action: 'grant' },
  dispel: { policy: 'none', tags: [] }, transferPolicy: 'expire', suppression: { sources: [] },
})
const clayCannonsExecution = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
}): Aa063ActivatedExecution => {
  const action = actionPlan({ context: input.context, operationId: input.operationId, canonicalId: 'Clay Cannons', action: 'swift' })
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  const actionEncounter = parseEncounterState(action.currentEncounterState)
  const lifecycle = applyEncounterEffectLifecycleEvent(
    { effects: actionEncounter.effects },
    { kind: 'effect-applied', effect: clayCannonsEffect(input) },
  )
  const current = parseEncounterState({ ...actionEncounter, effects: lifecycle.effects })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      context: input.context, operationId: input.operationId, reasonCode: 'ability.aa063.clay-cannons.enabled',
      previous, current,
    })]),
    presentationKey: 'ability.aa063.clay-cannons.enabled',
  })
}

const cloudNineExecution = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  abilityInstanceId: string
}): Aa063ActivatedExecution => {
  const action = actionPlan({ context: input.context, operationId: input.operationId, canonicalId: 'Cloud Nine', action: 'free' })
  const actionContext = mapWithEncounter(input.context, action.currentEncounterState)
  const frequency = planAbilityFrequencyPayment({
    context: actionContext, frequency: CLOUD_NINE_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId, clauseId: 'base', operationId: `${input.operationId}:frequency`,
    sceneId: action.nextMap.encounterState?.history.sceneId ?? undefined,
  })
  const frequencyEncounterChange = frequency.plan.changes.find(change => change.kind === 'encounter-state')
  const paidEncounter = parseEncounterState(
    frequencyEncounterChange?.kind === 'encounter-state'
      ? frequencyEncounterChange.current
      : action.currentEncounterState,
  )
  const reduced = removeMapGlobalFields({
    map: { ...input.context.map, encounterState: paidEncounter },
    matches: zone => zone.kind === 'weather',
  })
  const currentEncounter = parseEncounterState(reduced.map.encounterState)
  const previousFieldEffects = input.context.map.fieldEffects ?? { weather: [], terrains: [], rooms: [] }
  const currentFieldEffects = projectGlobalFieldZonesToMapEffects({
    previous: previousFieldEffects, state: currentEncounter,
  })
  const previousEncounter = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  const changes: MoveStateChangeInput[] = [encounterChange({
    context: input.context, operationId: input.operationId, reasonCode: 'ability.aa063.cloud-nine.normal-weather',
    previous: previousEncounter, current: currentEncounter,
  })]
  if (!sameJsonValue(previousFieldEffects, currentFieldEffects)) {
    changes.push({
      kind: 'map-field-effects', scope: { kind: 'map', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision), sourceOperationId: `${input.operationId}:weather-projection`,
      reasonCode: 'ability.aa063.cloud-nine.weather-projection', previous: deepCloneJson(previousFieldEffects),
      current: deepCloneJson(currentFieldEffects), compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(changes), presentationKey: 'ability.aa063.cloud-nine.normal-weather',
  })
}

export interface Aa063ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa063ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa063ActivatedExecution | null => {
  if (input.context.runtime.canonicalId === 'Cherry Power'
    && input.operation.mechanicId === 'aa063.cherry-power') {
    return cherryPowerExecution(input)
  }
  if (input.context.runtime.canonicalId === 'Clay Cannons'
    && input.operation.mechanicId === 'aa063.clay-cannons') {
    return clayCannonsExecution(input)
  }
  if (input.context.runtime.canonicalId === 'Cloud Nine'
    && input.operation.mechanicId === 'aa063.cloud-nine') {
    return cloudNineExecution(input)
  }
  return null
}
