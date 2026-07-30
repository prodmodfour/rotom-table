import { createHash } from 'node:crypto'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import { AA076_INTIMIDATE_TARGET_CAPABILITY_ID, aa076IntimidateTargetedThisScene } from '#shared/abilityAutomation/aa076'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { parseMoveEffectOperation, type MoveCombatStageEffectOperation } from '#shared/moveAutomation/effects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { AnyLiveSheet } from '~/utils/sheetMutations'
import { deepCloneJson } from '~/utils/serialization'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { resolveMoveAutomationItemRuleIdentity } from '../../moveAutomation/itemRuleData'
import { digestionBuffTradeCount, recordDigestionBuffTrade } from '../../moveAutomation/digestionBuffTrade'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveSheetStateField,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import { reduceMoveCoreTokenOperationState } from '../../moveAutomation/reducers/coreTokenEffects'
import { createStandardMoveCoreTokenEffectImmunityQueries } from '../../moveAutomation/reducers/immunities'
import { createMoveAutomationRelationshipResolver } from '../../moveAutomation/relationships'
import { createMoveAutomationCreatureRuleResolver } from '../../moveAutomation/creatureRules'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { AuthoritativeAbilityContext } from '../context'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'
import {
  abilityEffectiveCapabilitiesForPlacement,
  applyAbilityHpToSheet,
} from '../capabilityHpInvariants'
import { attachAbilityFrequencyPayment, planAbilityFrequencyPayment } from '../usage'

const SCENE_FREQUENCY = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)
const DAILY_FREQUENCY = Object.freeze({
  raw: 'Daily', actionText: '', kind: 'daily', uses: 1, exceptionId: null,
} satisfies AbilityFrequencyDeclaration)

export class Aa076ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa076ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa076ActivatedExecutionError(detail) }
const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

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

const actionEncounter = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'swift' | 'free'
}) => planEncounterMoveResourceCosts({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  canonicalMoveId: `ability:${input.canonicalId}`,
  moveKey: `ability:${input.canonicalId.toLowerCase().replaceAll(' ', '-')}`,
  range: `${input.resource[0]!.toUpperCase()}${input.resource.slice(1)} Action`,
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
  encounterState: unknown,
): AuthoritativeAbilityContext => ({
  ...context,
  map: { ...context.map, encounterState: parseEncounterState(encounterState) },
})

const paySceneAfterAction = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalId: string
  readonly resource: 'swift' | 'free'
}) => {
  const action = actionEncounter(input)
  const paidContext = contextWithEncounter(input.context, action)
  const frequency = planAbilityFrequencyPayment({
    context: paidContext,
    frequency: SCENE_FREQUENCY,
    abilityInstanceId: effectiveInstanceId(paidContext, input.canonicalId),
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    sceneId: paidContext.map.encounterState?.history.sceneId ?? undefined,
  })
  const change = frequency.plan.changes.find(candidate => candidate.kind === 'encounter-state')
    ?? fail(`${input.canonicalId} did not produce its Scene payment.`)
  return parseEncounterState(change.current)
}

const interference = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
}): Aa076ActivatedExecution => {
  const paid = paySceneAfterAction({ ...input, canonicalId: 'Interference', resource: 'swift' })
  const actor = input.context.actor.token
  const foes = input.context.queries.tokens.all()
    .filter(token => token.id !== actor.id
      && input.context.queries.relationships.relation(actor.id, token.id) === 'enemy'
      && ptuGridDistanceBetweenFootprints(actor, token) <= 3)
    .map(token => token.id)
    .sort()
  const effects = [...paid.effects]
  if (foes.length > 0) {
    effects.push({
      id: `ability.interference.accuracy.${shortHash(input.operationId, actor.id)}`,
      kind: 'numeric-modifier',
      source: {
        operationId: input.operationId,
        moveId: 'ability.interference',
        placementId: actor.id,
      },
      affected: { placementIds: foes, sideIds: [], cells: [] },
      createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
      createdTurn: Math.max(0, paid.history.currentTurn?.turn ?? 0),
      duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
      stacks: 1,
      charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'aa076', 'interference', 'accuracy'],
      payload: { attribute: 'accuracy', operation: 'add', value: -2, rounding: 'none' },
      dispel: { policy: 'matching-tags', tags: ['interference'] },
      transferPolicy: 'expire',
      suppression: { sources: [] },
    } satisfies EncounterEffect)
  }
  const current = parseEncounterState({ ...paid, effects })
  return Object.freeze({
    plan: createMoveStateChangePlan([encounterChange({
      ...input,
      reasonCode: 'ability.aa076.interference.action-frequency-and-effect',
      current,
    })]),
    presentationKey: foes.length > 0
      ? 'ability.aa076.interference.applied'
      : 'ability.aa076.interference.no-foes',
  })
}

const moveContextForStage = (
  context: AuthoritativeAbilityContext,
  targetId: string,
): AuthoritativeMoveRulesContext => {
  const relationships = createMoveAutomationRelationshipResolver({
    placements: context.map.placements,
    sides: context.map.encounterState?.sides ?? {},
  })
  const capabilityPlacementIds = new Set<string>([
    context.actor.placement.id,
    targetId,
    ...(context.map.encounterState?.capabilityRuntime?.links ?? []).flatMap(link => [
      link.ownerPlacementId,
      ...link.participantPlacementIds,
    ]),
  ])
  const effectiveCapabilityIdentitiesByPlacement = new Map(
    [...capabilityPlacementIds].flatMap((placementId) => {
      if (!context.queries.placements.get(placementId)) return []
      const capabilities = abilityEffectiveCapabilitiesForPlacement({ context, placementId })
      return [[placementId, capabilities.instances.filter(instance => instance.effective).map(instance => ({
        instanceId: instance.instanceId,
        canonicalId: instance.canonicalId,
      }))] as const]
    }),
  )
  const creatureRules = createMoveAutomationCreatureRuleResolver({
    placements: context.placements,
    tokens: context.tokens,
    effects: context.map.encounterState?.effects,
    effectiveCapabilityIdentitiesByPlacement,
    recordSheetRead: placement => context.reads.recordPlacement(placement),
  })
  return {
    ...context,
    intent: {
      schemaVersion: 1,
      placementId: context.actor.placement.id,
      moveName: 'ability:Intimidate',
      selection: { kind: 'single-target', targetPlacementId: targetId },
    },
    selectedPlacements: context.map.placements.filter(placement => placement.id === targetId),
    candidatePlacements: context.map.placements,
    queries: {
      ...context.queries,
      abilities: {
        activeForPlacement: context.queries.effectiveAbilities.activeForPlacement,
        has: context.queries.effectiveAbilities.has,
      },
      relationships,
      creatureRules,
    },
  } as unknown as AuthoritativeMoveRulesContext
}

const intimidateMarker = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly targetId: string
}): EncounterEffect => ({
  id: `ability.intimidate.target.${shortHash(input.context.actor.placement.id, input.targetId)}`,
  kind: 'capability',
  source: {
    operationId: input.operationId,
    moveId: 'ability.intimidate',
    placementId: input.context.actor.placement.id,
  },
  affected: { placementIds: [input.targetId], sideIds: [], cells: [] },
  createdRound: Math.max(1, input.context.map.initiative?.round ?? 1),
  createdTurn: Math.max(0, input.context.map.encounterState?.history.currentTurn?.turn ?? 0),
  duration: { kind: 'scene', remaining: null },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['ability', 'aa076', 'intimidate', 'target-gate'],
  payload: { capabilityId: AA076_INTIMIDATE_TARGET_CAPABILITY_ID, action: 'grant' },
  dispel: { policy: 'none', tags: [] },
  transferPolicy: 'retain',
  suppression: { sources: [] },
})

const intimidate = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa076ActivatedExecution => {
  effectiveInstanceId(input.context, 'Intimidate')
  const selected = selectedValues(input.choices, 'activate.target')[0]
  const targetId = selected?.kind === 'token' ? selected.placementId : fail('Intimidate requires one issued target.')
  const target = input.context.queries.tokens.get(targetId) ?? fail('Intimidate target disappeared.')
  if (input.context.queries.relationships.relation(input.context.actor.placement.id, targetId) !== 'enemy'
    || ptuGridDistanceBetweenFootprints(input.context.actor.token, target) > 5) {
    fail('Intimidate target is no longer an eligible foe within 5 meters.')
  }
  if (aa076IntimidateTargetedThisScene({
    effects: input.context.map.encounterState?.effects,
    actorPlacementId: input.context.actor.placement.id,
    targetPlacementId: targetId,
  })) fail('Intimidate already targeted this foe during the current Scene.')

  const moveContext = moveContextForStage(input.context, targetId)
  const stageOperation = parseMoveEffectOperation({
    id: `ability.intimidate.attack.${shortHash(input.operationId, targetId)}`,
    kind: 'combat-stage',
    source: { kind: 'move', id: 'ability.intimidate' },
    recipients: { kind: 'selected-targets' },
    phase: 'hit',
    reasonCode: 'ability.intimidate.lower-attack',
    payload: {
      action: 'modify', stage: 'atk', selectedStage: null, value: -1,
      stageSource: null, rounding: null,
    },
  }) as MoveCombatStageEffectOperation
  const reduced = reduceMoveCoreTokenOperationState({
    context: moveContext,
    operations: [{ operation: stageOperation, recipientIds: [targetId] }],
    dynamicRecipients: {
      attackedTargetIds: [targetId], hitTargetIds: [targetId], missedTargetIds: [],
      damagedTargetIds: [], faintedTargetIds: [],
    },
    damage: { resolve: () => fail('Intimidate cannot resolve damage.') },
    immunities: createStandardMoveCoreTokenEffectImmunityQueries({
      moveType: null,
      context: moveContext,
    }),
  })
  const paid = parseEncounterState(actionEncounter({
    ...input,
    canonicalId: 'Intimidate',
    resource: 'swift',
  }))
  const current = parseEncounterState({
    ...paid,
    effects: [...paid.effects, intimidateMarker({ ...input, targetId })],
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({
        ...input,
        reasonCode: 'ability.aa076.intimidate.action-and-target-gate',
        current,
      }),
      ...reduced.stateChanges.changes,
    ]),
    presentationKey: 'ability.aa076.intimidate.resolved',
  })
}

export interface Aa076BerryJuiceBuffSlot {
  readonly branchId: string
  readonly storage: 'regular' | 'honey-paws'
  readonly index: number
}

const digestionNames = (
  sheetKind: 'pokemon' | 'trainer',
  sheet: CharacterSheet | TrainerSheet,
): { readonly regular: readonly string[]; readonly honeyPaws: string | null } => {
  const legacy: unknown = sheetKind === 'pokemon'
    ? (sheet as CharacterSheet).items?.digestionFood
    : (sheet as TrainerSheet).digestion
  const extras: unknown = sheetKind === 'pokemon'
    ? (sheet as CharacterSheet).items?.digestionFoods
    : (sheet as TrainerSheet).digestionFoods
  const honey: unknown = sheetKind === 'pokemon'
    ? (sheet as CharacterSheet).items?.honeyPawsFood
    : (sheet as TrainerSheet).honeyPawsFood
  if (extras !== undefined && (!Array.isArray(extras) || extras.length > 3)) {
    return fail('Digestion buff storage is malformed.')
  }
  const values = (extras ?? []) as unknown[]
  if (values.some(value => typeof value !== 'string' || !value.trim())) {
    return fail('Digestion buff storage is malformed.')
  }
  const regular: string[] = []
  if (typeof legacy === 'string' && legacy.trim()) regular.push(legacy.trim())
  else if (legacy !== undefined && legacy !== null && legacy !== '') fail('Digestion buff storage is malformed.')
  regular.push(...values.map(value => (value as string).trim()))
  if (regular.length > 3) fail('Digestion buff storage exceeds its bounded capacity.')
  const honeyPaws = typeof honey === 'string' && honey.trim()
    ? honey.trim()
    : honey === undefined || honey === null || honey === ''
      ? null
      : fail('Honey Paws digestion storage is malformed.')
  return { regular, honeyPaws }
}

export const aa076BerryJuiceBuffSlots = (
  sheetKind: 'pokemon' | 'trainer',
  sheet: CharacterSheet | TrainerSheet,
  options: { readonly honeyPawsAvailable?: boolean } = {},
): readonly Aa076BerryJuiceBuffSlot[] => {
  const names = digestionNames(sheetKind, sheet)
  return Object.freeze([
    ...names.regular.map((name, index) => ({ name, storage: 'regular' as const, index })),
    ...(names.honeyPaws && options.honeyPawsAvailable
      ? [{ name: names.honeyPaws, storage: 'honey-paws' as const, index: 0 }]
      : []),
  ].filter(entry => resolveMoveAutomationItemRuleIdentity(entry.name)?.canonicalItemId === 'shuckles-berry-juice')
    .map(entry => Object.freeze({
      branchId: `digestion.${entry.storage}.${entry.index + 1}`,
      storage: entry.storage,
      index: entry.index,
    })))
}

const consumeBerryJuice = (input: {
  readonly sheetKind: 'pokemon' | 'trainer'
  readonly sheet: AnyLiveSheet
  readonly slot: Aa076BerryJuiceBuffSlot
}): MoveSheetStateField => {
  const names = digestionNames(input.sheetKind, input.sheet)
  if (input.slot.storage === 'honey-paws') {
    if (!names.honeyPaws
      || resolveMoveAutomationItemRuleIdentity(names.honeyPaws)?.canonicalItemId !== 'shuckles-berry-juice') {
      fail('Selected Berry Juice Food Buff is no longer stored.')
    }
    if (input.sheetKind === 'pokemon') {
      const items = { ...((input.sheet as CharacterSheet).items ?? {}) }
      delete items.honeyPawsFood
      ;(input.sheet as CharacterSheet).items = items
      return 'items'
    }
    delete (input.sheet as TrainerSheet).honeyPawsFood
    return 'digestion'
  }
  const selected = names.regular[input.slot.index]
  if (!selected || resolveMoveAutomationItemRuleIdentity(selected)?.canonicalItemId !== 'shuckles-berry-juice') {
    fail('Selected Berry Juice Food Buff is no longer stored.')
  }
  const retained = names.regular.filter((_name, index) => index !== input.slot.index)
  if (input.sheetKind === 'pokemon') {
    const items = { ...((input.sheet as CharacterSheet).items ?? {}) }
    delete items.digestionFood
    if (retained.length > 0) items.digestionFoods = retained
    else delete items.digestionFoods
    ;(input.sheet as CharacterSheet).items = items
    return 'items'
  }
  const trainer = input.sheet as TrainerSheet
  delete trainer.digestion
  if (retained.length > 0) trainer.digestionFoods = retained
  else delete trainer.digestionFoods
  return 'digestion'
}

const juicyEnergy = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa076ActivatedExecution => {
  const instanceId = effectiveInstanceId(input.context, 'Juicy Energy')
  const selected = selectedValues(input.choices, 'activate.buff')[0]
  const branchId = selected?.kind === 'branch' ? selected.branchId : fail('Juicy Energy requires one issued Food Buff.')
  const slot = aa076BerryJuiceBuffSlots(
    input.context.actor.sheet.kind,
    input.context.actor.sheet.sheet,
    {
      honeyPawsAvailable: input.context.queries.effectiveAbilities.has(
        input.context.actor.placement.id,
        'Honey Paws',
      ),
    },
  ).find(candidate => candidate.branchId === branchId) ?? fail('Selected Berry Juice Food Buff is no longer available.')
  const useLimit = input.context.queries.effectiveAbilities.has(input.context.actor.placement.id, 'Gluttony') ? 3 : 1
  if (digestionBuffTradeCount({
    effects: input.context.map.encounterState?.effects ?? [],
    placement: input.context.actor.placement,
  }) >= useLimit) fail('The user cannot trade another Food Buff during this Scene.')

  const action = actionEncounter({ ...input, canonicalId: 'Juicy Energy', resource: 'free' })
  const actionMap = { ...input.context.map, encounterState: action }
  const tradedMap = recordDigestionBuffTrade({
    map: actionMap,
    placement: input.context.actor.placement,
    operationId: `${input.operationId}:digestion-trade`,
    moveId: 'ability.juicy-energy',
  })
  const previous = deepCloneJson(input.context.actor.sheet.sheet) as AnyLiveSheet
  let current = deepCloneJson(previous) as AnyLiveSheet
  const changedItemField = consumeBerryJuice({
    sheetKind: input.context.actor.sheet.kind,
    sheet: current,
    slot,
  })
  if (!authoritativeAbilityHealingBlocked({
    map: input.context.map,
    placementId: input.context.actor.placement.id,
  })) {
    const healing = Math.max(0, Math.floor(input.context.actor.token.level))
    current = applyAbilityHpToSheet({
      context: input.context,
      placementId: input.context.actor.placement.id,
      sheet: current,
      currentHp: input.context.actor.token.currentHp + healing,
    })
  }
  current.revision = nextRevision(input.context.actor.sheet.revision)
  const hpChanged = input.context.actor.sheet.kind === 'pokemon'
    ? (previous as CharacterSheet).combat?.currentHp !== (current as CharacterSheet).combat?.currentHp
    : (previous as TrainerSheet).currentHp !== (current as TrainerSheet).currentHp
  const effectsPlan = createMoveStateChangePlan([
    encounterChange({
      ...input,
      reasonCode: 'ability.aa076.juicy-energy.action-and-digestion-trade',
      current: tradedMap.encounterState,
    }),
    {
      kind: 'sheet-state',
      scope: {
        kind: 'sheet', sheetKind: input.context.actor.sheet.kind,
        sheetSlug: input.context.actor.sheet.slug,
      },
      expectedRevision: input.context.actor.sheet.revision,
      sourceOperationId: input.operationId,
      reasonCode: 'ability.aa076.juicy-energy.consume-and-heal',
      previous,
      current,
      changedFields: hpChanged ? [changedItemField, 'hp'] : [changedItemField],
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    },
  ])
  const payment = planAbilityFrequencyPayment({
    context: input.context,
    frequency: DAILY_FREQUENCY,
    abilityInstanceId: instanceId,
    clauseId: 'base',
    operationId: `${input.operationId}:frequency`,
    dayKey: input.context.actor.sheet.sheet.abilityUsage?.dayKey ?? 'campaign-day:initial',
  })
  return Object.freeze({
    plan: attachAbilityFrequencyPayment(effectsPlan, payment),
    presentationKey: 'ability.aa076.juicy-energy.traded',
  })
}

export interface Aa076ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa076ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa076ActivatedExecution => {
  if (input.operation.mechanicId === 'aa076.interference') return interference(input)
  if (input.operation.mechanicId === 'aa076.intimidate') return intimidate(input)
  if (input.operation.mechanicId === 'aa076.juicy-energy') return juicyEnergy(input)
  return fail(`AA-076 mechanic ${input.operation.mechanicId} is not directly invocable.`)
}
