import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { computeTickValue } from '~/utils/ptuHp'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
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
import { aa064ApplyCompetitive, aa064ContraryRequestedValue } from './aa064StageIntegration'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'
import { applyAbilityHpToSheet } from '../capabilityHpInvariants'

const CONFIDENCE_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Scene – Standard Action', actionText: 'Standard Action', kind: 'scene', uses: 1, exceptionId: null,
})
const STAT_KEYS: Readonly<Record<string, CombatStageKey | undefined>> = Object.freeze({
  attack: 'atk', defense: 'def', 'special-attack': 'satk', 'special-defense': 'sdef', speed: 'spd',
})

export class Aa064ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa064ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa064ActivatedExecutionError(detail) }
const choiceValue = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): AbilityDeclarationOptionValue | null => choices.find(choice => choice.declarationId === declarationId)?.options[0]?.value ?? null
const mapWithEncounter = (context: AuthoritativeAbilityContext, encounter: unknown): AuthoritativeAbilityContext => ({
  ...context, map: { ...context.map, encounterState: parseEncounterState(encounter) },
})
const currentEncounter = (plan: MoveStateChangePlan, fallback: unknown): ReturnType<typeof parseEncounterState> => {
  const change = plan.changes.find(entry => entry.kind === 'encounter-state')
  return parseEncounterState(change?.kind === 'encounter-state' ? change.current : fallback)
}
const actionPlan = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  canonicalId: string
  resource: 'standard'
}) => planEncounterMoveResourceCosts({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  canonicalMoveId: `ability:${input.canonicalId}`,
  moveKey: `ability:${input.canonicalId.toLowerCase().replaceAll(' ', '-')}`,
  range: 'Standard Action',
  resolutionId: input.context.resolutionId,
  sourceOperationId: `${input.operationId}:action`,
  movement: null,
  reviewedCosts: [{
    id: `ability.action.${input.resource}`, phase: 'pay',
    cost: { kind: 'action-resource', resource: input.resource, amount: 1 },
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
    kind: 'sheet-state', scope: { kind: 'sheet', sheetKind: resolved.kind, sheetSlug: resolved.slug },
    expectedRevision: resolved.revision, sourceOperationId: input.operationId, reasonCode: input.reasonCode,
    previous: input.previous, current: input.current, changedFields: [...input.changedFields],
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }
}
const encounterChange = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  reasonCode: string
  current: unknown
}): MoveStateChangeInput => ({
  kind: 'encounter-state', scope: { kind: 'encounter', mapSlug: input.context.map.slug },
  expectedRevision: normalizeRevision(input.context.map.revision), sourceOperationId: input.operationId,
  reasonCode: input.reasonCode,
  previous: parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState()),
  current: parseEncounterState(input.current), compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
})

const comatoseExecution = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
}): Aa064ActivatedExecution => {
  const action = actionPlan({
    context: input.context, operationId: input.operationId, canonicalId: 'Comatose', resource: 'standard',
  })
  const previous = deepCloneJson(input.context.actor.sheet.sheet) as AnyLiveSheet
  const withSleep = applyConditionsToSheet(
    input.context.actor.sheet.kind,
    previous,
    [...new Set([...(input.context.actor.token.sheetConditions ?? []), 'Sleep'])],
  )
  const healedHp = authoritativeAbilityHealingBlocked({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
  })
    ? input.context.actor.token.currentHp
    : Math.min(
        input.context.actor.token.maxHp,
        input.context.actor.token.currentHp + computeTickValue(input.context.actor.token.maxHp),
      )
  const current = applyAbilityHpToSheet({
    context: input.context,
    placementId: input.context.actor.placement.id,
    sheet: withSleep,
    currentHp: healedHp,
  })
  const changes: MoveStateChangeInput[] = []
  if (action.changed) changes.push(encounterChange({
    context: input.context, operationId: `${input.operationId}:action`,
    reasonCode: 'ability.aa064.comatose.action', current: action.currentEncounterState,
  }))
  if (!sameJsonValue(previous, current)) changes.push(sheetChange({
    context: input.context, operationId: input.operationId,
    placementId: input.context.actor.placement.id, previous, current,
    changedFields: ['conditions', 'hp'], reasonCode: 'ability.aa064.comatose.sleep-and-heal',
  }))
  return Object.freeze({
    plan: createMoveStateChangePlan(changes), presentationKey: 'ability.aa064.comatose.applied',
  })
}

const confidenceExecution = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  abilityInstanceId: string
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa064ActivatedExecution => {
  const selected = choiceValue(input.choices, 'activate.stat')
  const stage = selected?.kind === 'stat' ? STAT_KEYS[selected.statId] : undefined
  const selectedStage = stage ?? fail('Confidence requires one issued Combat Stat choice.')
  const action = actionPlan({
    context: input.context, operationId: input.operationId, canonicalId: 'Confidence', resource: 'standard',
  })
  const actionContext = mapWithEncounter(input.context, action.currentEncounterState)
  const frequency = planAbilityFrequencyPayment({
    context: actionContext, frequency: CONFIDENCE_FREQUENCY,
    abilityInstanceId: input.abilityInstanceId, clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: action.nextMap.encounterState?.history.sceneId ?? undefined,
  })
  const encounter = currentEncounter(frequency.plan, action.currentEncounterState)
  const changes: MoveStateChangeInput[] = []
  const previousEncounter = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  if (!sameJsonValue(previousEncounter, encounter)) changes.push(encounterChange({
    context: input.context, operationId: input.operationId,
    reasonCode: 'ability.aa064.confidence.action-and-frequency', current: encounter,
  }))

  const visitedSheets = new Set<string>()
  for (const placement of input.context.queries.placements.all()) {
    if (input.context.queries.relationships.relation(input.context.actor.placement.id, placement.id) !== 'ally') continue
    const token = input.context.queries.tokens.get(placement.id)
    const resolved = input.context.queries.sheets.forPlacement(placement)
    if (!token || !resolved
      || ptuGridDistanceBetweenFootprints(input.context.actor.token, token) > 5) continue
    const key = `${resolved.kind}:${resolved.slug}`
    if (visitedSheets.has(key)) continue
    visitedSheets.add(key)
    const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
    const before: CombatStageMap = { ...token.combatStages }
    const unbounded = before[selectedStage] + 1
    const selectedRequested = aa064ContraryRequestedValue({
      recipientId: placement.id, current: before[selectedStage], unboundedRequested: unbounded,
      abilities: { has: (id, canonicalId) => input.context.queries.effectiveAbilities.has(id, canonicalId) },
    })
    const afterSelected: CombatStageMap = {
      ...before,
      [selectedStage]: Math.max(-6, Math.min(6, selectedRequested)),
    }
    const competitive = aa064ApplyCompetitive({
      recipientId: placement.id, sourceOwnerId: input.context.actor.placement.id,
      previous: before, next: afterSelected,
      abilities: { has: (id, canonicalId) => input.context.queries.effectiveAbilities.has(id, canonicalId) },
    })
    if (sameJsonValue(before, competitive.stages)) continue
    const current = applyCombatStagesToSheet(resolved.kind, previous, competitive.stages)
    changes.push(sheetChange({
      context: input.context, operationId: `${input.operationId}:stage:${placement.id}`,
      placementId: placement.id, previous, current, changedFields: ['combatStages'],
      reasonCode: 'ability.aa064.confidence.raise-ally-stage',
    }))
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(changes), presentationKey: 'ability.aa064.confidence.applied',
  })
}

export interface Aa064ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa064ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa064ActivatedExecution | null => {
  if (input.context.runtime.canonicalId === 'Comatose'
    && input.operation.mechanicId === 'aa064.comatose') return comatoseExecution(input)
  if (input.context.runtime.canonicalId === 'Confidence'
    && input.operation.mechanicId === 'aa064.confidence') return confidenceExecution(input)
  return null
}
