import { createHash } from 'node:crypto'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import {
  AA077_LEAF_GIFT_EFFECT_TAG,
  AA077_LEAF_GIFT_SUITS,
  AA077_LEAF_RUSH_MARK_ID,
  AA077_LEAFY_CLOAK_ABILITIES,
  AA077_LEAFY_CLOAK_EFFECT_TAG,
  AA077_LEAFY_CLOAK_OPTION_BY_ID,
  aa077HasActiveDesignerSuit,
  aa077LeafRushMarks,
  type Aa077LeafGiftSuit,
} from '#shared/abilityAutomation/aa077'
import {
  createEmptyAbilityOwnedState,
  parseAbilityOwnedState,
} from '#shared/abilityAutomation/ownedState'
import {
  createEmptyEncounterState,
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect, type EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { applyConditionsToSheet } from '~/utils/sheetMutations'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { computeTickValue } from '~/utils/ptuHp'
import { healPokemonHp, healTrainerHp } from '~/utils/sheets/healing'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { createMoveAutomationWeatherResolver } from '../../moveAutomation/weather'
import type { AuthoritativeAbilityContext } from '../context'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'
import { reduceAbilityOwnedStateCommand } from '../ownedState'
import { attachAbilityFrequencyPayment, planAbilityFrequencyPayment } from '../usage'
import { planAa077VoluntaryDrop } from './aa077ItemIntegration'

const SCENE_FREQUENCY = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const SCENE_X2_FREQUENCY = Object.freeze({
  raw: 'Scene x2', actionText: '', kind: 'scene', uses: 2, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const DAILY_FREQUENCY = Object.freeze({
  raw: 'Daily', actionText: '', kind: 'daily', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const DAILY_X5_FREQUENCY = Object.freeze({
  raw: 'Daily x5', actionText: '', kind: 'daily', uses: 5, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)

export class Aa077ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa077ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa077ActivatedExecutionError(detail) }
const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const selectedValues = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
): readonly AbilityDeclarationOptionValue[] => choices.find(choice => choice.declarationId === declarationId)
  ?.options.map(option => option.value) ?? []

const selectedBranch = (
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[],
  declarationId: string,
  label: string,
): string => {
  const selected = selectedValues(choices, declarationId)[0]
  return selected?.kind === 'branch' ? selected.branchId : fail(`${label} requires one issued choice.`)
}

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

const actionEncounter = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'swift' | 'free'
}): EncounterState => planEncounterMoveResourceCosts({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  canonicalMoveId: `ability:${input.canonicalId}`,
  moveKey: `ability:${input.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  range: `${input.resource} action`,
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
}).currentEncounterState

const contextWithEncounter = (
  context: AuthoritativeAbilityContext,
  encounterState: EncounterState,
): AuthoritativeAbilityContext => ({
  ...context,
  map: { ...context.map, encounterState },
})

const paySceneAfterAction = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'swift' | 'free'
  readonly frequency?: AbilityFrequencyDeclaration
}): EncounterState => {
  const action = actionEncounter(input)
  const context = contextWithEncounter(input.context, action)
  const payment = planAbilityFrequencyPayment({
    context,
    frequency: input.frequency ?? SCENE_FREQUENCY,
    abilityInstanceId: effectiveInstanceId(context, input.canonicalId),
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: context.map.encounterState?.history.sceneId ?? undefined,
  })
  const change = payment.plan.changes.find(candidate => candidate.kind === 'encounter-state')
    ?? fail(`${input.canonicalId} did not produce its Scene payment.`)
  return parseEncounterState(change.current)
}

const abilityOverlay = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly effectTag: string
  readonly values: readonly string[]
}): EncounterEffect => parseEncounterEffect({
  id: `ability.aa077.overlay.${shortHash(input.effectTag, input.context.actor.placement.id)}`,
  kind: 'creature-rule-overlay',
  source: {
    operationId: input.operationId,
    moveId: `ability.${input.context.runtime.canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    placementId: input.context.actor.placement.id,
  },
  affected: {
    placementIds: [input.context.actor.placement.id], sideIds: [], cells: [],
  },
  createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
  createdTurn: Math.max(0, input.context.map.encounterState?.history.currentTurn?.turn ?? 0),
  duration: { kind: 'until-triggered', remaining: null },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['ability', 'aa077', input.effectTag],
  payload: {
    domain: 'ability', action: 'add', values: [...input.values],
    referencePlacementId: null, suppressionScope: null,
  },
  dispel: { policy: 'matching-tags', tags: [input.effectTag] },
  transferPolicy: 'retain',
  suppression: { sources: [] },
})

const replaceTaggedOverlay = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly reasonCode: string
  readonly effectTag: string
  readonly values: readonly string[]
}): MoveStateChangePlan => {
  const previous = parseEncounterState(input.context.map.encounterState ?? createEmptyEncounterState())
  const retained = previous.effects.filter(effect => !(
    effect.tags.includes(input.effectTag)
    && effect.affected.placementIds.includes(input.context.actor.placement.id)
  ))
  const effect = abilityOverlay(input)
  return createMoveStateChangePlan([encounterChange({
    context: input.context,
    operationId: input.operationId,
    reasonCode: input.reasonCode,
    current: parseEncounterState({ ...previous, effects: [...retained, effect] }),
  })])
}

const leafGift = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa077ActivatedExecution => {
  const suit = selectedBranch(input.choices, 'activate.suit', 'Leaf Gift') as Aa077LeafGiftSuit
  const abilities = AA077_LEAF_GIFT_SUITS[suit]
    ?? fail('Leaf Gift received an unsupported suit.')
  const effects = replaceTaggedOverlay({
    ...input,
    effectTag: AA077_LEAF_GIFT_EFFECT_TAG,
    values: abilities,
    reasonCode: `ability.aa077.leaf-gift.${suit}`,
  })
  const frequency = planAbilityFrequencyPayment({
    context: input.context,
    frequency: DAILY_FREQUENCY,
    abilityInstanceId: effectiveInstanceId(input.context, 'Leaf Gift'),
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    dayKey: input.context.actor.sheet.sheet.abilityUsage?.dayKey ?? 'campaign-day:initial',
  })
  return Object.freeze({
    plan: attachAbilityFrequencyPayment(effects, frequency),
    presentationKey: `ability.aa077.leaf-gift.${suit}`,
  })
}

const leafGuard = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa077ActivatedExecution => {
  const currentConditions = normalizeConditionNames(input.context.actor.token.conditions)
  const branchId = selectedBranch(input.choices, 'activate.condition', 'Leaf Guard')
  const selected = currentConditions.find(condition => (
    `condition.${condition.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` === branchId
  )) ?? fail('Leaf Guard selected condition is no longer present.')
  let paid = actionEncounter({ ...input, canonicalId: 'Leaf Guard', resource: 'swift' })
  const sunny = createMoveAutomationWeatherResolver(input.context.map, {
    subjectPlacementId: input.context.actor.placement.id,
  }).active().some(weather => weather.kind === 'sunny')
  if (!sunny) {
    const frequencyContext = contextWithEncounter(input.context, paid)
    const payment = planAbilityFrequencyPayment({
      context: frequencyContext,
      frequency: SCENE_FREQUENCY,
      abilityInstanceId: effectiveInstanceId(frequencyContext, 'Leaf Guard'),
      clauseId: 'base',
      operationId: `${input.operationId}:frequency`,
      sceneId: frequencyContext.map.encounterState?.history.sceneId ?? undefined,
    })
    const change = payment.plan.changes.find(candidate => candidate.kind === 'encounter-state')
      ?? fail('Leaf Guard did not produce its Scene payment.')
    paid = parseEncounterState(change.current)
  }
  else effectiveInstanceId(input.context, 'Leaf Guard')

  const normalizedSelected = selected.toLowerCase()
  const currentEncounter = parseEncounterState({
    ...paid,
    effects: paid.effects.filter(effect => !(
      effect.kind === 'condition'
      && effect.payload.action === 'apply'
      && effect.affected.placementIds.includes(input.context.actor.placement.id)
      && normalizeConditionNames([effect.payload.conditionId])[0]?.toLowerCase() === normalizedSelected
    )),
  })
  const previousSheet = deepCloneJson(input.context.actor.sheet.sheet) as AnyLiveSheet
  const persistent = normalizeConditionNames(input.context.actor.sheet.kind === 'pokemon'
    ? (previousSheet as CharacterSheet).combat?.conditions ?? []
    : (previousSheet as TrainerSheet).conditions ?? [])
  const currentSheet = applyConditionsToSheet(
    input.context.actor.sheet.kind,
    previousSheet,
    persistent.filter(condition => condition.toLowerCase() !== normalizedSelected),
  )
  const changes: MoveStateChangeInput[] = [encounterChange({
    ...input,
    reasonCode: 'ability.aa077.leaf-guard.action-frequency-and-cure',
    current: currentEncounter,
  })]
  if (!sameJsonValue(previousSheet, currentSheet)) {
    currentSheet.revision = nextRevision(input.context.actor.sheet.revision)
    changes.unshift({
      kind: 'sheet-state',
      scope: {
        kind: 'sheet', sheetKind: input.context.actor.sheet.kind,
        sheetSlug: input.context.actor.sheet.slug,
      },
      expectedRevision: input.context.actor.sheet.revision,
      sourceOperationId: input.operationId,
      reasonCode: 'ability.aa077.leaf-guard.condition-cured',
      previous: previousSheet,
      current: currentSheet,
      changedFields: ['conditions'],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    })
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: 'ability.aa077.leaf-guard.condition-cured',
  })
}

const leafRush = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa077ActivatedExecution => {
  const abilityInstanceId = effectiveInstanceId(input.context, 'Leaf Rush')
  if (aa077LeafRushMarks({
    entries: input.context.map.encounterState?.abilityOwnedState?.entries,
    ownerPlacementId: input.context.actor.placement.id,
  }).length > 0) fail('Leaf Rush already has an unspent Grass Move declaration.')
  const paid = paySceneAfterAction({
    ...input,
    canonicalId: 'Leaf Rush',
    resource: 'free',
    frequency: SCENE_X2_FREQUENCY,
  })
  const stateId = `aa077.leaf-rush.${shortHash(input.operationId, input.context.actor.placement.id)}`
  const reduced = reduceAbilityOwnedStateCommand(
    paid.abilityOwnedState ?? createEmptyAbilityOwnedState(),
    {
      operationId: `${input.operationId}:leaf-rush-mark`,
      kind: 'create',
      stateId,
      expectedVersion: null,
      entry: {
        stateId,
        ownerPlacementId: input.context.actor.placement.id,
        sourceAbilityInstanceId: abilityInstanceId,
        canonicalId: 'Leaf Rush',
        targetPlacementIds: [],
        lifecycle: { kind: 'source-ability', targetPolicy: null },
        payload: { kind: 'mark', markId: AA077_LEAF_RUSH_MARK_ID },
      },
    },
  )
  const current = parseEncounterState({
    ...paid,
    abilityOwnedState: parseAbilityOwnedState(reduced.state),
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input,
      reasonCode: 'ability.aa077.leaf-rush.action-frequency-and-mark',
      current,
    })]),
    presentationKey: 'ability.aa077.leaf-rush.armed',
  })
}

const leafyCloak = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa077ActivatedExecution => {
  effectiveInstanceId(input.context, 'Leafy Cloak')
  if (!aa077HasActiveDesignerSuit({
    effects: input.context.map.encounterState?.effects,
    placementId: input.context.actor.placement.id,
  })) fail('Leafy Cloak requires a current Designer activation.')
  const values = selectedValues(input.choices, 'activate.abilities').map(value => {
    if (value.kind !== 'branch') return fail('Leafy Cloak requires issued ability choices.')
    return AA077_LEAFY_CLOAK_OPTION_BY_ID[
      value.branchId as keyof typeof AA077_LEAFY_CLOAK_OPTION_BY_ID
    ] ?? fail('Leafy Cloak received an unsupported ability choice.')
  })
  if (values.length !== 2 || new Set(values).size !== 2
    || values.some(value => !(AA077_LEAFY_CLOAK_ABILITIES as readonly string[]).includes(value))) {
    fail('Leafy Cloak requires exactly two distinct reviewed abilities.')
  }
  return Object.freeze({
    plan: replaceTaggedOverlay({
      ...input,
      effectTag: AA077_LEAFY_CLOAK_EFFECT_TAG,
      values,
      reasonCode: 'ability.aa077.leafy-cloak.abilities-replaced',
    }),
    presentationKey: 'ability.aa077.leafy-cloak.applied',
  })
}

const lifeForce = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa077ActivatedExecution => {
  const action = actionEncounter({ ...input, canonicalId: 'Life Force', resource: 'swift' })
  const frequency = planAbilityFrequencyPayment({
    context: input.context,
    frequency: DAILY_X5_FREQUENCY,
    abilityInstanceId: effectiveInstanceId(input.context, 'Life Force'),
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    dayKey: input.context.actor.sheet.sheet.abilityUsage?.dayKey ?? 'campaign-day:initial',
  })
  const payment = frequency.plan.changes.find(change => change.kind === 'sheet-state')
    ?? fail('Life Force did not produce its Daily payment.')
  const previous = deepCloneJson(input.context.actor.sheet.sheet) as AnyLiveSheet
  const paidSheet = deepCloneJson(payment.current) as AnyLiveSheet
  const token = input.context.actor.token
  const maximumHp = Math.max(1, token.fullMaxHp ?? token.maxHp)
  if (!authoritativeAbilityHealingBlocked({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
  })) {
    const healing = computeTickValue(maximumHp)
    if (input.context.actor.sheet.kind === 'pokemon') {
      healPokemonHp(paidSheet as CharacterSheet, healing)
    }
    else healTrainerHp(paidSheet as TrainerSheet, healing)
  }
  const current = paidSheet
  current.revision = nextRevision(input.context.actor.sheet.revision)
  const hpChanged = input.context.actor.sheet.kind === 'pokemon'
    ? (previous as CharacterSheet).combat?.currentHp !== (current as CharacterSheet).combat?.currentHp
    : (previous as TrainerSheet).currentHp !== (current as TrainerSheet).currentHp
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({
        ...input,
        reasonCode: 'ability.aa077.life-force.action',
        current: action,
      }),
      {
        kind: 'sheet-state',
        scope: {
          kind: 'sheet', sheetKind: input.context.actor.sheet.kind,
          sheetSlug: input.context.actor.sheet.slug,
        },
        expectedRevision: input.context.actor.sheet.revision,
        sourceOperationId: input.operationId,
        reasonCode: 'ability.aa077.life-force.heal-and-frequency',
        previous,
        current,
        changedFields: hpChanged ? ['abilityUsage', 'hp'] : ['abilityUsage'],
        compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
      },
    ]),
    presentationKey: hpChanged
      ? 'ability.aa077.life-force.healed'
      : 'ability.aa077.life-force.no-healing',
  })
}

const voluntaryDrop = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
  readonly canonicalId: 'Klutz' | 'Leek Mastery'
}): Aa077ActivatedExecution => {
  effectiveInstanceId(input.context, input.canonicalId)
  const branchId = selectedBranch(input.choices, 'drop.item', input.canonicalId)
  const action = actionEncounter({ ...input, resource: 'free' })
  const dropped = planAa077VoluntaryDrop({
    context: input.context,
    map: { ...input.context.map, encounterState: action },
    operationId: input.operationId,
    branchId,
    ...(input.canonicalId === 'Leek Mastery'
      ? { onlyCanonicalItemId: 'rare-leek' }
      : {}),
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([
      ...dropped.plan.changes,
      encounterChange({
        ...input,
        reasonCode: `ability.aa077.${input.canonicalId === 'Klutz' ? 'klutz' : 'leek-mastery'}.voluntary-drop`,
        current: dropped.currentMap.encounterState,
      }),
    ]),
    presentationKey: `ability.aa077.${input.canonicalId === 'Klutz' ? 'klutz' : 'leek-mastery'}.item-dropped`,
  })
}

export interface Aa077ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa077ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa077ActivatedExecution => {
  if (input.operation.mechanicId === 'aa077.klutz' && input.context.request.modeId === 'drop') {
    return voluntaryDrop({ ...input, canonicalId: 'Klutz' })
  }
  if (input.operation.mechanicId === 'aa077.leaf-gift') return leafGift(input)
  if (input.operation.mechanicId === 'aa077.leaf-guard') return leafGuard(input)
  if (input.operation.mechanicId === 'aa077.leaf-rush') return leafRush(input)
  if (input.operation.mechanicId === 'aa077.leafy-cloak' && input.context.request.modeId === 'activate') {
    return leafyCloak(input)
  }
  if (input.operation.mechanicId === 'aa077.leek-mastery' && input.context.request.modeId === 'drop') {
    return voluntaryDrop({ ...input, canonicalId: 'Leek Mastery' })
  }
  if (input.operation.mechanicId === 'aa077.life-force') return lifeForce(input)
  return fail(`AA-077 mechanic ${input.operation.mechanicId} is not directly invocable.`)
}
