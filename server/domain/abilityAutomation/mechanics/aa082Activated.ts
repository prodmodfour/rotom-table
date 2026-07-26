import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { CombatStageMap } from '~/types/combatStages'
import { clampCombatStage, normalizeCombatStages } from '~/utils/combatStages'
import { applyCombatStagesToSheet, type AnyLiveSheet } from '~/utils/sheetMutations'
import { deepCloneJson } from '~/utils/serialization'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityFrequencyPayment } from '../usage'

const SCENE_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
})
export interface Aa082ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}
export class Aa082ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa082ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa082ActivatedExecutionError(detail) }

const pay = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): ReturnType<typeof parseEncounterState> => {
  const action = planEncounterMoveResourceCosts({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
    canonicalMoveId: 'ability:Omen', moveKey: 'ability:omen', range: 'Swift Action',
    resolutionId: input.context.resolutionId, sourceOperationId: `${input.operationId}:action`,
    movement: null,
    reviewedCosts: [{
      id: 'ability.action.swift', phase: 'pay',
      cost: { kind: 'action-resource', resource: 'swift', amount: 1 },
    }],
    allowLegacyFallback: false, minimumPhaseExclusive: null, maximumPhaseInclusive: 'pay',
  })
  const context: AuthoritativeAbilityContext = {
    ...input.context,
    map: { ...input.context.map, encounterState: action.currentEncounterState },
  }
  const frequency = planAbilityFrequencyPayment({
    context, frequency: SCENE_FREQUENCY, abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base', operationId: `${input.operationId}:frequency`,
    sceneId: action.currentEncounterState.history.sceneId ?? undefined,
  })
  const change = frequency.plan.changes.find(candidate => candidate.kind === 'encounter-state')
  return parseEncounterState(change?.kind === 'encounter-state'
    ? change.current : action.currentEncounterState)
}

const omen = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa082ActivatedExecution => {
  const target = input.context.targets[0] ?? fail('Omen requires one server-issued target.')
  const resolved = input.context.queries.sheets.forPlacement(target.placement)
    ?? fail('Omen target sheet disappeared.')
  const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
  const stages = normalizeCombatStages(target.token.combatStages)
  const nextStages: CombatStageMap = {
    ...stages,
    acc: clampCombatStage(stages.acc - 2),
  }
  const current = applyCombatStagesToSheet(resolved.kind, previous, nextStages)
  current.revision = nextRevision(resolved.revision)
  const encounter = pay(input)
  const changes: MoveStateChangeInput[] = [{
    kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
    expectedRevision: normalizeRevision(input.context.map.revision),
    sourceOperationId: `${input.operationId}:resources`, reasonCode: 'ability.aa082.omen.resources',
    previous: parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState()),
    current: encounter, compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }, {
    kind: 'sheet-state',
    scope: { kind: 'sheet', sheetKind: resolved.kind, sheetSlug: resolved.slug },
    expectedRevision: resolved.revision, sourceOperationId: `${input.operationId}:accuracy`,
    reasonCode: 'ability.aa082.omen.accuracy-stage', previous, current,
    changedFields: ['combatStages'], compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }]
  return Object.freeze({
    plan: createMoveStateChangePlan(changes), presentationKey: 'ability.aa082.omen.applied',
  })
}

export const executeAa082ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa082ActivatedExecution | null => {
  if (input.context.actor.token.currentHp <= 0) fail('Omen cannot be used while Fainted.')
  return input.operation.mechanicId === 'aa082.omen' ? omen(input) : null
}
