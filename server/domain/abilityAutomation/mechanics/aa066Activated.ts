import { createHash } from 'node:crypto'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { applyConditionsToSheet } from '~/utils/sheetMutations'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { deepCloneJson } from '~/utils/serialization'
import {
  moveAutomationUserAccuracy,
  resolveMoveAutomationTargetEvasion,
} from '~/utils/moveAutomationAccuracy'
import { resolveMoveAutomationAccuracyRoll } from '~/utils/moveAutomationResolution'
import { normalizeConditionName } from '~/utils/statusConditions'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import { moveAutomationConditionImmunitySource } from '~/utils/moveAutomationConditionImmunity'
import type { AuthoritativeAbilityContext } from '../context'
import { reduceAbilityOwnedStateCommand } from '../ownedState'
import { planAbilityFrequencyPayment } from '../usage'
import {
  aa066DeadlyPoisonStateIds,
} from './aa066ConditionIntegration'
import { aa066DazzlingDefinition } from './aa066StaticIntegration'

const SCENE_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
})
const SCENE_X2_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Scene x2', actionText: '', kind: 'scene', uses: 2, exceptionId: null,
})
const DAILY_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Daily', actionText: '', kind: 'daily', uses: 1, exceptionId: null,
})

export class Aa066ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa066ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa066ActivatedExecutionError(detail) }
const choiceValue = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  id: string,
): AbilityDeclarationOptionValue | null => choices.find(choice => choice.declarationId === id)?.options[0]?.value ?? null
const currentEncounter = (plan: MoveStateChangePlan, fallback: unknown) => {
  const change = plan.changes.find(entry => entry.kind === 'encounter-state')
  return parseEncounterState(change?.kind === 'encounter-state' ? change.current : fallback)
}
const mapWithEncounter = (context: AuthoritativeAbilityContext, encounter: unknown): AuthoritativeAbilityContext => ({
  ...context,
  map: { ...context.map, encounterState: parseEncounterState(encounter) },
})
const actionPlan = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'standard' | 'swift' | 'free' | 'full'
}) => planEncounterMoveResourceCosts({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  canonicalMoveId: `ability:${input.canonicalId}`,
  moveKey: `ability:${input.canonicalId.toLowerCase().replaceAll(' ', '-')}`,
  range: `${input.resource[0]!.toUpperCase()}${input.resource.slice(1)} Action`,
  resolutionId: input.context.resolutionId ?? input.operationId,
  sourceOperationId: `${input.operationId}:action`, movement: null,
  reviewedCosts: [{
    id: `ability.action.${input.resource}`, phase: 'pay',
    cost: { kind: 'action-resource', resource: input.resource, amount: 1 },
  }],
  allowLegacyFallback: false, minimumPhaseExclusive: null, maximumPhaseInclusive: 'pay',
})
const encounterChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly reasonCode: string
  readonly current: unknown
}): MoveStateChangeInput => ({
  kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
  expectedRevision: normalizeRevision(input.context.map.revision), sourceOperationId: input.operationId,
  reasonCode: input.reasonCode,
  previous: parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState()),
  current: parseEncounterState(input.current), compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
})
const sheetChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly placementId: string
  readonly previous: AnyLiveSheet
  readonly current: AnyLiveSheet
  readonly changedFields: readonly ('conditions' | 'combatStages' | 'hp')[]
  readonly reasonCode: string
}): MoveStateChangeInput => {
  const placement = input.context.queries.placements.get(input.placementId)
    ?? fail(`Ability target ${input.placementId} disappeared.`)
  const resolved = input.context.queries.sheets.forPlacement(placement)
    ?? fail(`Ability target ${input.placementId} has no sheet.`)
  input.current.revision = nextRevision(resolved.revision)
  return {
    kind: 'sheet-state', scope: { kind: 'sheet', sheetKind: resolved.kind, sheetSlug: resolved.slug },
    expectedRevision: resolved.revision, sourceOperationId: input.operationId,
    reasonCode: input.reasonCode, previous: input.previous, current: input.current,
    changedFields: input.changedFields, compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }
}

const payScene = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly canonicalId: string
  readonly resource: 'standard' | 'swift' | 'free' | 'full'
  readonly frequency?: AbilityFrequencyDeclaration
}) => {
  const action = actionPlan(input)
  const frequencyContext = mapWithEncounter(input.context, action.currentEncounterState)
  const frequency = planAbilityFrequencyPayment({
    context: frequencyContext,
    frequency: input.frequency ?? SCENE_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base', operationId: `${input.operationId}:frequency`,
    sceneId: frequencyContext.map.encounterState?.history.sceneId ?? undefined,
  })
  return currentEncounter(frequency.plan, action.currentEncounterState)
}

const targetId = (input: {
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
  readonly declarationId: string
}): string => {
  const selected = choiceValue(input.choices, input.declarationId)
  return selected?.kind === 'token'
    ? selected.placementId
    : fail(`${input.declarationId} requires one issued token target.`)
}

const dazeExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa066ActivatedExecution => {
  const recipientId = targetId({ choices: input.choices, declarationId: 'activate.target' })
  const target = input.context.queries.tokens.get(recipientId) ?? fail('Daze target disappeared.')
  if (ptuGridDistanceBetweenFootprints(input.context.actor.token, target) > 6) {
    fail('Daze target is no longer within 6 meters.')
  }
  const roll = input.context.random.roll({
    rollId: `ability.daze.accuracy.${createHash('sha256').update(input.operationId).digest('hex').slice(0, 24)}`,
    parentEffectId: input.operationId, reason: `ability.daze.accuracy for ${recipientId}`,
    formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
  })
  const script = {
    moveName: 'Daze', damageClass: 'Status', ac: 4, damaging: false,
    requiresAccuracy: true, criticalRange: null,
  } as unknown as MoveAutomationScript
  const actorAbilityNames = input.context.queries.effectiveAbilities
    .activeForPlacement(input.context.actor.placement.id)
    .map(ability => ability.canonicalId)
  const targetAbilityNames = input.context.queries.effectiveAbilities.activeForPlacement(recipientId)
    .map(ability => ability.canonicalId)
  const effectiveActor = { ...input.context.actor.token, abilityNames: actorAbilityNames }
  const effectiveTarget = { ...target, abilityNames: targetAbilityNames }
  const userAccuracy = moveAutomationUserAccuracy(effectiveActor, {
    fieldEffects: input.context.map.fieldEffects,
  })
  const evasion = resolveMoveAutomationTargetEvasion(script, effectiveTarget, {
    attacker: effectiveActor,
    fieldEffects: input.context.map.fieldEffects,
    dauntlessShieldActive: targetAbilityNames.includes('Dauntless Shield'),
  }).value
  const hit = resolveMoveAutomationAccuracyRoll(script, roll.naturalResult, {
    userAccuracy, targetEvasion: evasion,
  }).hit
  const payment = payScene({
    context: input.context, operationId: input.operationId,
    abilityInstanceId: input.abilityInstanceId, canonicalId: 'Daze', resource: 'standard',
  })
  const changes: MoveStateChangeInput[] = [encounterChange({
    context: input.context, operationId: input.operationId,
    reasonCode: hit ? 'ability.aa066.daze.hit' : 'ability.aa066.daze.miss', current: payment,
  })]
  if (hit && moveAutomationConditionImmunitySource('Sleep', effectiveTarget) === null
    && !target.conditions.some(condition => normalizeConditionName(condition) === 'Sleep')) {
    const placement = input.context.queries.placements.get(recipientId)
      ?? fail('Daze target placement disappeared.')
    const resolved = input.context.queries.sheets.forPlacement(placement)
      ?? fail('Daze target sheet disappeared.')
    const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
    const current = applyConditionsToSheet(
      resolved.kind,
      previous,
      [...new Set([...target.conditions, 'Sleep'])],
    )
    changes.push(sheetChange({
      context: input.context,
      operationId: `${input.operationId}:sleep`,
      placementId: recipientId,
      previous,
      current,
      changedFields: ['conditions'],
      reasonCode: 'ability.aa066.daze.sleep-applied',
    }))
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: hit ? 'ability.aa066.daze.hit' : 'ability.aa066.daze.miss',
  })
}

const dazzlingExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa066ActivatedExecution => {
  const recipientId = targetId({ choices: input.choices, declarationId: 'activate.target' })
  const target = input.context.queries.tokens.get(recipientId) ?? fail('Dazzling target disappeared.')
  if (ptuGridDistanceBetweenFootprints(input.context.actor.token, target) > 1
    || input.context.queries.relationships.relation(input.context.actor.placement.id, recipientId) !== 'enemy') {
    fail('Dazzling target must remain an adjacent foe.')
  }
  const encounter = payScene({
    context: input.context, operationId: input.operationId,
    abilityInstanceId: input.abilityInstanceId, canonicalId: 'Dazzling', resource: 'swift',
    frequency: SCENE_X2_FREQUENCY,
  })
  const suffix = createHash('sha256').update(`${input.operationId}:${recipientId}`).digest('hex').slice(0, 24)
  const definition = aa066DazzlingDefinition()
  const effect: EncounterEffect = {
    ...definition,
    id: `ability.dazzling.${recipientId}.${suffix}`,
    source: { operationId: input.operationId, moveId: 'ability.dazzling', placementId: input.context.actor.placement.id },
    affected: { placementIds: [recipientId], sideIds: [], cells: [] },
    createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
    createdTurn: encounter.history.currentTurn?.turn ?? 0,
  }
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      context: input.context, operationId: input.operationId,
      reasonCode: 'ability.aa066.dazzling.applied',
      current: parseEncounterState({ ...encounter, effects: [...encounter.effects, effect] }),
    })]),
    presentationKey: 'ability.aa066.dazzling.applied',
  })
}

const deadlyPoisonExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa066ActivatedExecution => {
  if (input.context.request.modeId !== 'upgrade') fail('Deadly Poison requires its triggered upgrade mode.')
  const recipientId = targetId({ choices: input.choices, declarationId: 'upgrade.target' })
  const stateIds = aa066DeadlyPoisonStateIds({
    map: input.context.map, ownerPlacementId: input.context.actor.placement.id,
    abilityInstanceId: input.abilityInstanceId, targetPlacementId: recipientId,
  })
  if (stateIds.length === 0) fail('Deadly Poison has no current authoritative Poison trigger for that target.')
  const placement = input.context.queries.placements.get(recipientId) ?? fail('Deadly Poison target disappeared.')
  const resolved = input.context.queries.sheets.forPlacement(placement) ?? fail('Deadly Poison target sheet disappeared.')
  const conditions = input.context.queries.tokens.get(recipientId)?.conditions ?? []
  if (!conditions.some(condition => normalizeConditionName(condition) === 'Poisoned')) {
    fail('Deadly Poison target is no longer Poisoned.')
  }
  const action = actionPlan({
    context: input.context, operationId: input.operationId,
    canonicalId: 'Deadly Poison', resource: 'free',
  })
  const frequencyContext = mapWithEncounter(input.context, action.currentEncounterState)
  const dayKey = input.context.actor.sheet.sheet.abilityUsage?.dayKey ?? 'campaign-day:initial'
  const frequency = planAbilityFrequencyPayment({
    context: frequencyContext, frequency: DAILY_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId, clauseId: 'base',
    operationId: `${input.operationId}:frequency`, dayKey,
  })
  let encounter = currentEncounter(frequency.plan, action.currentEncounterState)
  for (const stateId of stateIds) {
    const state = encounter.abilityOwnedState?.entries.find(entry => entry.stateId === stateId)
      ?? fail(`Deadly Poison state ${stateId} disappeared.`)
    encounter = parseEncounterState({
      ...encounter,
      abilityOwnedState: reduceAbilityOwnedStateCommand(encounter.abilityOwnedState, {
        operationId: `${input.operationId}:consume:${createHash('sha256').update(stateId).digest('hex').slice(0, 16)}`,
        kind: 'remove', stateId, expectedVersion: state.version,
      }).state,
    })
  }
  const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
  const nextConditions = conditions
    .filter(condition => normalizeConditionName(condition) !== 'Poisoned')
    .concat('Badly Poisoned')
  const current = applyConditionsToSheet(resolved.kind, previous, [...new Set(nextConditions)])
  const frequencySheetChanges = frequency.plan.changes.filter(change => change.kind === 'sheet-state')
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({
        context: input.context, operationId: input.operationId,
        reasonCode: 'ability.aa066.deadly-poison.upgraded', current: encounter,
      }),
      ...frequencySheetChanges,
      sheetChange({
        context: input.context, operationId: `${input.operationId}:condition`,
        placementId: recipientId, previous, current, changedFields: ['conditions'],
        reasonCode: 'ability.aa066.deadly-poison.badly-poisoned',
      }),
    ]),
    presentationKey: 'ability.aa066.deadly-poison.applied',
  })
}

const decoyExecution = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly abilityInstanceId: string
}): Aa066ActivatedExecution => {
  const encounter = payScene({
    context: input.context, operationId: input.operationId,
    abilityInstanceId: input.abilityInstanceId, canonicalId: 'Decoy', resource: 'full',
  })
  const suffix = createHash('sha256').update(input.operationId).digest('hex').slice(0, 24)
  const source = {
    operationId: input.operationId, moveId: 'follow-me', placementId: input.context.actor.placement.id,
  }
  const affected = { placementIds: [input.context.actor.placement.id], sideIds: [], cells: [] }
  const common = {
    source, affected,
    createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
    createdTurn: encounter.history.currentTurn?.turn ?? 0,
    duration: { kind: 'turns' as const, subject: 'source' as const, boundary: 'end' as const, remaining: 2 },
    stacks: 1, charges: null,
    stackPolicy: { kind: 'replace' as const, maxStacks: null },
    chargePolicy: { kind: 'none' as const, amount: null },
    transferPolicy: 'expire' as const, suppression: { sources: [] },
  }
  const effects: EncounterEffect[] = [{
    ...common,
    id: `ability.decoy.follow-me.${suffix}`, kind: 'capability',
    tags: ['follow-me', 'redirection'],
    payload: { capabilityId: 'move.follow-me.redirection', action: 'grant' },
    dispel: { policy: 'matching-tags', tags: ['follow-me', 'redirection'] },
  }, {
    ...common,
    id: `ability.decoy.evasion.${suffix}`, kind: 'capability',
    tags: ['ability', 'aa066', 'decoy', 'evasion'],
    payload: { capabilityId: 'aa066.decoy.evasion-bonus', action: 'grant', value: 2 },
    dispel: { policy: 'matching-tags', tags: ['decoy', 'evasion'] },
  }]
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      context: input.context, operationId: input.operationId,
      reasonCode: 'ability.aa066.decoy.follow-me-and-evasion',
      current: parseEncounterState({ ...encounter, effects: [...encounter.effects, ...effects] }),
    })]),
    presentationKey: 'ability.aa066.decoy.applied',
  })
}

export interface Aa066ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa066ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa066ActivatedExecution | null => {
  if (input.context.runtime.canonicalId === 'Daze'
    && input.operation.mechanicId === 'aa066.daze') return dazeExecution(input)
  if (input.context.runtime.canonicalId === 'Dazzling'
    && input.operation.mechanicId === 'aa066.dazzling') return dazzlingExecution(input)
  if (input.context.runtime.canonicalId === 'Deadly Poison'
    && input.operation.mechanicId === 'aa066.deadly-poison') return deadlyPoisonExecution(input)
  if (input.context.runtime.canonicalId === 'Decoy'
    && input.operation.mechanicId === 'aa066.decoy') return decoyExecution(input)
  return null
}
