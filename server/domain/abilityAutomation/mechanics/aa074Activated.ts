import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import {
  AA074_HONEY_PAWS_PREPARED_CAPABILITY_PREFIX,
  AA074_HUNGER_FULL_BELLY_MODE,
  AA074_HUNGER_HANGRY_MODE,
  AA074_HUNGER_MODE_CAPABILITY_PREFIX,
  AA074_HUNGER_MODES,
  aa074HoneyPawsPreparationForPlacement,
  aa074HungerModeForPlacement,
  type Aa074HungerMode,
} from '#shared/abilityAutomation/aa074'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { applyConditionsToSheet } from '~/utils/sheetMutations'
import { deepCloneJson } from '~/utils/serialization'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { splitSheetItemNames } from '~/utils/sheetItemNames'
import { resolveMoveAutomationItemRuleIdentity } from '../../moveAutomation/itemRuleData'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import { createMoveAutomationWeatherResolver } from '../../moveAutomation/weather'
import type { AuthoritativeAbilityContext } from '../context'
import { planAbilityFrequencyPayment } from '../usage'

const SCENE_FREQUENCY = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)

export class Aa074ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa074ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa074ActivatedExecutionError(detail) }

const selectedValues = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): readonly AbilityDeclarationOptionValue[] => choices.find(choice => choice.declarationId === declarationId)
  ?.options.map(option => option.value) ?? []

const effectiveInstanceId = (context: AuthoritativeAbilityContext, canonicalId: string): string => (
  context.actor.effectiveAbilities.find(ability => ability.effective && ability.canonicalId === canonicalId)?.instanceId
  ?? fail(`${canonicalId} effective instance disappeared.`)
)

const encounterChange = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly reasonCode: string
  readonly current: unknown
}): MoveStateChangeInput => ({
  kind: 'encounter-state',
  scope: { kind: 'encounter', mapSlug: input.context.map.slug },
  expectedRevision: normalizeRevision(input.context.map.revision),
  sourceOperationId: input.operationId,
  reasonCode: input.reasonCode,
  previous: parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState()),
  current: parseEncounterState(input.current),
  compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
})

const paySwift = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
}) => planEncounterMoveResourceCosts({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  canonicalMoveId: `ability:${input.canonicalId}`,
  moveKey: `ability:${input.canonicalId.toLowerCase().replaceAll(' ', '-')}`,
  range: 'swift action',
  resolutionId: input.context.resolutionId,
  sourceOperationId: `${input.operationId}:action`,
  movement: null,
  reviewedCosts: [{
    id: 'ability.action.swift', phase: 'pay',
    cost: { kind: 'action-resource', resource: 'swift', amount: 1 },
  }],
  allowLegacyFallback: false,
  minimumPhaseExclusive: null,
  maximumPhaseInclusive: 'pay',
})

const hungerEffectBase = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly id: string
  readonly kind: EncounterEffect['kind']
}) => ({
  id: input.id,
  kind: input.kind,
  source: {
    operationId: input.operationId,
    moveId: 'ability.hunger-switch',
    placementId: input.context.actor.placement.id,
  },
  affected: {
    placementIds: [input.context.actor.placement.id], sideIds: [], cells: [],
  },
  createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
  createdTurn: Math.max(0, input.context.map.encounterState?.history.currentTurn?.turn ?? 0),
  duration: { kind: 'turns' as const, subject: 'source' as const, boundary: 'start' as const, remaining: 1 },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace' as const, maxStacks: null },
  chargePolicy: { kind: 'none' as const, amount: null },
  tags: ['ability', 'aa074', 'hunger-switch'],
  dispel: { policy: 'matching-tags' as const, tags: ['hunger-switch'] },
  transferPolicy: 'expire' as const,
  suppression: { sources: [] },
})

const honeyPaws = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa074ActivatedExecution => {
  const actorId = input.context.actor.placement.id
  const instanceId = effectiveInstanceId(input.context, 'Honey Paws')
  const heldNames = input.context.actor.sheet.kind === 'pokemon'
    ? splitSheetItemNames((input.context.actor.sheet.sheet as CharacterSheet).items?.held)
    : []
  if (!heldNames.some(name => resolveMoveAutomationItemRuleIdentity(name)?.canonicalItemId === 'honey')) {
    fail('Honey Paws preparation requires the user to hold Honey.')
  }
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  if (aa074HoneyPawsPreparationForPlacement(previous.effects, actorId)) {
    fail('Honey Paws already prepared the next Honey consumption.')
  }
  const effect: EncounterEffect = {
    id: `ability.honey-paws.prepared.${actorId}`,
    kind: 'capability',
    source: {
      operationId: input.operationId,
      moveId: 'ability.honey-paws',
      placementId: actorId,
    },
    affected: { placementIds: [actorId], sideIds: [], cells: [] },
    createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
    createdTurn: Math.max(0, previous.history.currentTurn?.turn ?? 0),
    duration: { kind: 'scene', remaining: null },
    stacks: 1,
    charges: 1,
    stackPolicy: { kind: 'replace', maxStacks: null },
    chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
    tags: ['ability', 'aa074', 'honey-paws', 'prepared'],
    payload: {
      capabilityId: `${AA074_HONEY_PAWS_PREPARED_CAPABILITY_PREFIX}${instanceId}`,
      action: 'grant',
    },
    dispel: { policy: 'matching-tags', tags: ['honey-paws', 'prepared'] },
    transferPolicy: 'expire',
    suppression: { sources: [] },
  }
  const current = parseEncounterState({ ...previous, effects: [...previous.effects, effect] })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input,
      reasonCode: 'ability.aa074.honey-paws.prepared',
      current,
    })]),
    presentationKey: 'ability.aa074.honey-paws.prepared',
  })
}

const hungerSwitch = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa074ActivatedExecution => {
  if (input.context.map.initiative?.activeId !== input.context.actor.placement.id) {
    fail('Hunger Switch must be configured at the beginning of the user’s active turn.')
  }
  if (aa074HungerModeForPlacement(
    input.context.map.encounterState?.effects,
    input.context.actor.placement.id,
  )) fail('Hunger Switch was already configured for this turn.')
  const selected = selectedValues(input.choices, 'choose-mode.mode')[0]
  const mode = selected?.kind === 'branch' ? selected.branchId : fail('Hunger Switch requires one issued mode.')
  if (!(AA074_HUNGER_MODES as readonly string[]).includes(mode)) {
    fail('Hunger Switch received an unsupported mode.')
  }
  effectiveInstanceId(input.context, 'Hunger Switch')
  const typedMode = mode as Aa074HungerMode
  const baseId = `ability.hunger-switch.${input.context.actor.placement.id}`
  const retained = (input.context.map.encounterState?.effects ?? []).filter(effect => (
    !effect.tags.includes('hunger-switch') || effect.source.placementId !== input.context.actor.placement.id
  ))
  const capability: EncounterEffect = {
    ...hungerEffectBase({ ...input, id: `${baseId}.mode`, kind: 'capability' }),
    kind: 'capability',
    payload: { capabilityId: `${AA074_HUNGER_MODE_CAPABILITY_PREFIX}${typedMode}`, action: 'grant' },
  }
  const form: EncounterEffect = {
    ...hungerEffectBase({ ...input, id: `${baseId}.form`, kind: 'creature-rule-overlay' }),
    kind: 'creature-rule-overlay',
    payload: {
      domain: 'form', action: 'replace',
      value: typedMode === AA074_HUNGER_HANGRY_MODE ? 'hangry-mode' : 'full-belly-mode',
      referencePlacementId: null,
    },
  }
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  const current = parseEncounterState({ ...previous, effects: [...retained, capability, form] })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input,
      reasonCode: `ability.aa074.hunger-switch.${typedMode}`,
      current,
    })]),
    presentationKey: `ability.aa074.hunger-switch.${typedMode}`,
  })
}

const hydration = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa074ActivatedExecution => {
  const conditions = normalizeConditionNames(input.context.actor.sheet.kind === 'pokemon'
    ? (input.context.actor.sheet.sheet as CharacterSheet).combat?.conditions ?? []
    : (input.context.actor.sheet.sheet as TrainerSheet).conditions ?? [])
  const selected = selectedValues(input.choices, 'activate.condition')[0]
  const branchId = selected?.kind === 'branch' ? selected.branchId : fail('Hydration requires one issued Status Affliction.')
  const selectedCondition = conditions.find(condition => (
    `condition.${condition.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` === branchId
  )) ?? fail('Hydration selected condition is no longer present.')

  const action = paySwift({ ...input, canonicalId: 'Hydration' })
  let paid = action.currentEncounterState
  const rainy = createMoveAutomationWeatherResolver(input.context.map, {
    subjectPlacementId: input.context.actor.placement.id,
  }).active().some(weather => weather.kind === 'rainy')
  if (!rainy) {
    const frequencyContext: AuthoritativeAbilityContext = {
      ...input.context,
      map: { ...input.context.map, encounterState: paid },
    }
    const frequency = planAbilityFrequencyPayment({
      context: frequencyContext,
      frequency: SCENE_FREQUENCY,
      abilityInstanceId: effectiveInstanceId(frequencyContext, 'Hydration'),
      clauseId: 'base',
      operationId: `${input.operationId}:frequency`,
      sceneId: frequencyContext.map.encounterState?.history.sceneId ?? undefined,
    })
    const change = frequency.plan.changes.find(candidate => candidate.kind === 'encounter-state')
      ?? fail('Hydration did not produce its Scene payment.')
    paid = parseEncounterState(change.current)
  }
  else effectiveInstanceId(input.context, 'Hydration')

  const previousSheet = deepCloneJson(input.context.actor.sheet.sheet) as AnyLiveSheet
  const currentSheet = applyConditionsToSheet(
    input.context.actor.sheet.kind,
    previousSheet,
    conditions.filter(condition => condition !== selectedCondition),
  )
  currentSheet.revision = nextRevision(input.context.actor.sheet.revision)
  const normalizedSelected = selectedCondition.toLowerCase()
  const effects = paid.effects.filter(effect => !(
    effect.kind === 'condition'
    && effect.payload.action === 'apply'
    && effect.affected.placementIds.includes(input.context.actor.placement.id)
    && normalizeConditionNames([effect.payload.conditionId])[0]?.toLowerCase() === normalizedSelected
  ))
  const currentEncounter = parseEncounterState({ ...paid, effects })
  const changes: MoveStateChangeInput[] = [{
    kind: 'sheet-state',
    scope: {
      kind: 'sheet', sheetKind: input.context.actor.sheet.kind,
      sheetSlug: input.context.actor.sheet.slug,
    },
    expectedRevision: input.context.actor.sheet.revision,
    sourceOperationId: input.operationId,
    reasonCode: 'ability.aa074.hydration.condition-cured',
    previous: previousSheet,
    current: currentSheet,
    changedFields: ['conditions'],
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }, encounterChange({
    ...input,
    reasonCode: 'ability.aa074.hydration.cost-and-effects',
    current: currentEncounter,
  })]
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: 'ability.aa074.hydration.condition-cured',
  })
}

export interface Aa074ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa074ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa074ActivatedExecution => {
  if (input.operation.mechanicId === 'aa074.honey-paws') return honeyPaws(input)
  if (input.operation.mechanicId === 'aa074.hunger-switch') return hungerSwitch(input)
  if (input.operation.mechanicId === 'aa074.hydration') return hydration(input)
  return fail(`AA-074 mechanic ${input.operation.mechanicId} is not directly invocable.`)
}
