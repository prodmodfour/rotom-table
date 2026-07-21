import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import type { CombatStageMap } from '~/types/combatStages'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { computeTickValue } from '~/utils/ptuHp'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  applyHpToSheet,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveSheetStateField,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityFrequencyPayment } from '../usage'
import { planAbilityOwnedStateCommand } from '../ownedState'
import { aa062BoneLordReadyMarkId, aa062BoneLordUsedMarkId } from './aa062MoveIntegration'

const BEAUTIFUL_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Scene – Standard Action', actionText: 'Standard Action', kind: 'scene', uses: 1, exceptionId: null,
})
const BLESSED_TOUCH_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Daily x2 – Standard Action', actionText: 'Standard Action', kind: 'daily', uses: 2, exceptionId: null,
})

export class Aa062ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa062ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa062ActivatedExecutionError(detail) }
const value = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  id: string,
): AbilityDeclarationOptionValue | null => choices.find(choice => choice.declarationId === id)?.options[0]?.value ?? null
const mapWithEncounter = (context: AuthoritativeAbilityContext, encounter: unknown): AuthoritativeAbilityContext => ({
  ...context,
  map: { ...context.map, encounterState: parseEncounterState(encounter) },
})
const currentEncounter = (plan: MoveStateChangePlan, fallback: unknown): ReturnType<typeof parseEncounterState> => {
  const change = plan.changes.find(entry => entry.kind === 'encounter-state')
  return parseEncounterState(change?.kind === 'encounter-state' ? change.current : fallback)
}
const withoutPlanIdentity = (plan: MoveStateChangePlan): MoveStateChangeInput[] => plan.changes.map(
  ({ id: _id, order: _order, ...change }) => change,
)
const actionPlan = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  canonicalId: string
  moveKey: string
}) => planEncounterMoveResourceCosts({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  canonicalMoveId: `ability:${input.canonicalId}`,
  moveKey: input.moveKey,
  range: 'Standard Action',
  resolutionId: input.context.resolutionId,
  sourceOperationId: `${input.operationId}:action`,
  movement: null,
  reviewedCosts: [{
    id: 'ability.action.standard', phase: 'pay',
    cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
  }],
  allowLegacyFallback: false,
  minimumPhaseExclusive: null,
  maximumPhaseInclusive: 'pay',
})
const sheetChange = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  placementId: string
  previous: AnyLiveSheet
  current: AnyLiveSheet
  changedFields: readonly MoveSheetStateField[]
  reasonCode: string
}): MoveStateChangeInput => {
  const placement = input.context.queries.placements.get(input.placementId)
    ?? fail(`Ability sheet target ${input.placementId} disappeared.`)
  const resolved = input.context.queries.sheets.forPlacement(placement)
    ?? fail(`Ability sheet target ${input.placementId} has no sheet.`)
  input.current.revision = nextRevision(resolved.revision)
  return {
    kind: 'sheet-state',
    scope: { kind: 'sheet', sheetKind: resolved.kind, sheetSlug: resolved.slug },
    expectedRevision: resolved.revision,
    sourceOperationId: input.operationId,
    reasonCode: input.reasonCode,
    previous: input.previous,
    current: input.current,
    changedFields: [...input.changedFields],
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }
}
const stagesFor = (context: AuthoritativeAbilityContext, placementId: string): CombatStageMap => {
  const token = context.queries.tokens.get(placementId) ?? fail(`Ability stage target ${placementId} disappeared.`)
  return { ...token.combatStages }
}

const beautifulExecution = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  abilityInstanceId: string
  modeId: string
}): Aa062ActivatedExecution => {
  const action = actionPlan({
    context: input.context, operationId: input.operationId,
    canonicalId: 'Beautiful', moveKey: 'ability:beautiful',
  })
  const actionContext = mapWithEncounter(input.context, action.currentEncounterState)
  const frequency = planAbilityFrequencyPayment({
    context: actionContext,
    frequency: BEAUTIFUL_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: action.nextMap.encounterState?.history.sceneId ?? undefined,
  })
  let encounter = currentEncounter(frequency.plan, action.currentEncounterState)
  const changes: MoveStateChangeInput[] = []
  if (input.modeId === 'contest') {
    const stateId = `${input.abilityInstanceId}:beautiful-contest:${input.operationId}`
    const mark = planAbilityOwnedStateCommand({
      context: mapWithEncounter(input.context, encounter),
      command: {
        operationId: `${input.operationId}:contest-mark`, kind: 'create', stateId, expectedVersion: null,
        entry: {
          stateId,
          ownerPlacementId: input.context.actor.placement.id,
          sourceAbilityInstanceId: input.abilityInstanceId,
          canonicalId: 'Beautiful', targetPlacementIds: [],
          lifecycle: { kind: 'scene', targetPolicy: null },
          payload: { kind: 'token', tokenId: 'aa062.beautiful.beauty-dice', quantity: 2, maximum: 2 },
        },
      },
    })
    encounter = currentEncounter(mark.plan, encounter)
  }
  else if (input.modeId === 'battle') {
    const actorSheet = deepCloneJson(input.context.actor.sheet.sheet) as AnyLiveSheet
    const actorStages = stagesFor(input.context, input.context.actor.placement.id)
    actorStages.satk = Math.min(6, actorStages.satk + 1)
    const actorCurrent = applyCombatStagesToSheet(input.context.actor.sheet.kind, actorSheet, actorStages)
    changes.push(sheetChange({
      context: input.context, operationId: `${input.operationId}:special-attack`,
      placementId: input.context.actor.placement.id,
      previous: actorSheet, current: actorCurrent,
      changedFields: ['combatStages'], reasonCode: 'ability.aa062.beautiful.special-attack-stage',
    }))
    for (const placement of input.context.queries.placements.all()) {
      if (input.context.queries.relationships.relation(input.context.actor.placement.id, placement.id) !== 'ally') continue
      const token = input.context.queries.tokens.get(placement.id)
      const resolved = input.context.queries.sheets.forPlacement(placement)
      if (!token || !resolved || ptuGridDistanceBetweenFootprints(input.context.actor.token, token) > 5) continue
      const filtered = token.conditions.filter(condition => !['enraged', 'rage'].includes(condition.trim().toLowerCase()))
      if (filtered.length === token.conditions.length) continue
      const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
      const current = applyConditionsToSheet(resolved.kind, previous, filtered)
      changes.push(sheetChange({
        context: input.context, operationId: `${input.operationId}:cure:${placement.id}`,
        placementId: placement.id, previous, current,
        changedFields: ['conditions'], reasonCode: 'ability.aa062.beautiful.cure-enraged',
      }))
    }
  }
  else fail('Beautiful received an unsupported branch.')
  const previousEncounter = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  if (!sameJsonValue(previousEncounter, encounter)) {
    changes.unshift({
      kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision), sourceOperationId: input.operationId,
      reasonCode: `ability.aa062.beautiful.${input.modeId}`, previous: previousEncounter, current: encounter,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: `ability.aa062.beautiful.${input.modeId}.applied`,
  })
}

const boneLordExecution = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  abilityInstanceId: string
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa062ActivatedExecution => {
  const selected = value(input.choices, 'empower.move')
  const moveName = selected?.kind === 'move'
    ? selected.canonicalMoveId
    : fail('Bone Lord requires one issued eligible move.')
  if (!['Bone Club', 'Bone Rush', 'Bonemerang'].includes(moveName)) {
    fail('Bone Lord can empower only Bone Club, Bone Rush, or Bonemerang.')
  }
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  const entries = previous.abilityOwnedState?.entries ?? []
  const usedMarkId = aa062BoneLordUsedMarkId(moveName)
  if (entries.some(entry => entry.ownerPlacementId === input.context.actor.placement.id
    && entry.canonicalId === 'Bone Lord' && entry.payload.kind === 'mark'
    && entry.payload.markId === usedMarkId)) {
    fail(`Bone Lord has already empowered ${moveName} this Scene.`)
  }
  if (entries.some(entry => entry.ownerPlacementId === input.context.actor.placement.id
    && entry.canonicalId === 'Bone Lord' && entry.payload.kind === 'mark'
    && entry.payload.markId.startsWith('aa062.bone-lord.ready:'))) {
    fail('Bone Lord already has an unresolved empowered move.')
  }
  const suffix = usedMarkId.split(':').at(-1)!
  const usedStateId = `${input.abilityInstanceId}:bone-lord-used:${suffix}`
  const used = planAbilityOwnedStateCommand({
    context: input.context,
    command: {
      operationId: `${input.operationId}:used`, kind: 'create', stateId: usedStateId, expectedVersion: null,
      entry: {
        stateId: usedStateId, ownerPlacementId: input.context.actor.placement.id,
        sourceAbilityInstanceId: input.abilityInstanceId, canonicalId: 'Bone Lord', targetPlacementIds: [],
        lifecycle: { kind: 'scene', targetPolicy: null }, payload: { kind: 'mark', markId: usedMarkId },
      },
    },
  })
  let encounter = currentEncounter(used.plan, previous)
  const readyStateId = `${input.abilityInstanceId}:bone-lord-ready:${suffix}`
  const ready = planAbilityOwnedStateCommand({
    context: mapWithEncounter(input.context, encounter),
    command: {
      operationId: `${input.operationId}:ready`, kind: 'create', stateId: readyStateId, expectedVersion: null,
      entry: {
        stateId: readyStateId, ownerPlacementId: input.context.actor.placement.id,
        sourceAbilityInstanceId: input.abilityInstanceId, canonicalId: 'Bone Lord', targetPlacementIds: [],
        lifecycle: { kind: 'turn', targetPolicy: null },
        payload: { kind: 'mark', markId: aa062BoneLordReadyMarkId(moveName) },
      },
    },
  })
  encounter = currentEncounter(ready.plan, encounter)
  return Object.freeze({
    plan: createMoveStateChangePlan([{
      kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision), sourceOperationId: input.operationId,
      reasonCode: 'ability.aa062.bone-lord.empowered', previous, current: encounter,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }]),
    presentationKey: 'ability.aa062.bone-lord.empowered',
  })
}

const blessedTouchExecution = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  abilityInstanceId: string
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa062ActivatedExecution => {
  const selected = value(input.choices, 'activate.target')
  const targetId = selected?.kind === 'token'
    ? selected.placementId
    : fail('Blessed Touch requires one issued adjacent target.')
  const targetPlacement = input.context.queries.placements.get(targetId)
    ?? fail('Blessed Touch target disappeared.')
  const target = input.context.queries.tokens.get(targetId) ?? fail('Blessed Touch target token disappeared.')
  const resolved = input.context.queries.sheets.forPlacement(targetPlacement)
    ?? fail('Blessed Touch target sheet disappeared.')
  if (ptuGridDistanceBetweenFootprints(input.context.actor.token, target) > 1) {
    fail('Blessed Touch target is no longer adjacent.')
  }
  const action = actionPlan({
    context: input.context, operationId: input.operationId,
    canonicalId: 'Blessed Touch', moveKey: 'ability:blessed-touch',
  })
  const dayKey = input.context.actor.sheet.sheet.abilityUsage?.dayKey ?? 'campaign-day:initial'
  const frequency = planAbilityFrequencyPayment({
    context: input.context,
    frequency: BLESSED_TOUCH_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base', operationId: `${input.operationId}:frequency`, dayKey,
  })
  const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
  const healing = Math.floor((target.fullMaxHp ?? target.maxHp) / 4)
  const currentHp = Math.min(target.fullMaxHp ?? target.maxHp, target.currentHp + healing)
  const current = applyHpToSheet(resolved.kind, previous, currentHp)
  const changes: MoveStateChangeInput[] = [
    ...(action.changed ? [{
      kind: 'encounter-state' as const,
      scope: { kind: 'encounter' as const, mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision),
      sourceOperationId: `${input.operationId}:action`,
      reasonCode: 'ability.aa062.blessed-touch.action',
      previous: action.previousEncounterState,
      current: action.currentEncounterState,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }] : []),
    ...withoutPlanIdentity(frequency.plan),
    sheetChange({
      context: input.context, operationId: `${input.operationId}:healing`, placementId: targetId,
      previous, current, changedFields: ['hp'], reasonCode: 'ability.aa062.blessed-touch.healing',
    }),
  ]
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: currentHp > target.currentHp
      ? 'ability.aa062.blessed-touch.healed'
      : 'ability.aa062.blessed-touch.no-op',
  })
}

export interface Aa062ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const aa062BeautifulContestDice = (
  context: AuthoritativeAbilityContext,
  placementId: string,
): number => (context.map.encounterState?.abilityOwnedState?.entries ?? []).reduce((total, entry) => (
  entry.ownerPlacementId === placementId
  && entry.canonicalId === 'Beautiful'
  && entry.payload.kind === 'token'
  && entry.payload.tokenId === 'aa062.beautiful.beauty-dice'
    ? total + entry.payload.quantity
    : total
), 0)

export const executeAa062ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa062ActivatedExecution | null => {
  if ((input.operation.mechanicId === 'aa062.beautiful-battle'
    || input.operation.mechanicId === 'aa062.beautiful-contest')
    && input.context.runtime.canonicalId === 'Beautiful') {
    return beautifulExecution({
      context: input.context, operationId: input.operationId,
      abilityInstanceId: input.abilityInstanceId, modeId: input.context.request.modeId,
    })
  }
  if (input.operation.mechanicId === 'aa062.bone-lord-empower'
    && input.context.runtime.canonicalId === 'Bone Lord'
    && input.context.request.modeId === 'empower') {
    return boneLordExecution({
      context: input.context, operationId: input.operationId,
      abilityInstanceId: input.abilityInstanceId, choices: input.choices,
    })
  }
  if (input.operation.mechanicId === 'aa062.blessed-touch'
    && input.context.runtime.canonicalId === 'Blessed Touch'
    && input.context.request.modeId === 'activate') {
    return blessedTouchExecution({
      context: input.context, operationId: input.operationId,
      abilityInstanceId: input.abilityInstanceId, choices: input.choices,
    })
  }
  return null
}
