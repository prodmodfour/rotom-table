import { createHash } from 'node:crypto'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityFrequencyDeclaration } from '#shared/abilityAutomation/frequency'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveConsumedItemRecord } from '../../moveAutomation/itemMutationTypes'
import { findMove } from '~~/data/ptuReference'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { normalizeConditionName } from '~/utils/statusConditions'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { buildMoveAutomationScriptFromMoveData } from '~/utils/move-automation/moveData'
import { findMoveDamageBase } from '~/utils/moveDamageBase'
import { resolveMoveAutomationTargetDamageBreakdown } from '~/utils/moveAutomationTargetResolution'
import {
  applyCombatStagesToSheet,
  applyConditionsToSheet,
  type AnyLiveSheet,
} from '~/utils/sheetMutations'
import {
  createMoveStateChangePlan,
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from '../../moveAutomation/plan'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { reduceMoveCoreTokenOperationState } from '../../moveAutomation/reducers/coreTokenEffects'
import { createStandardMoveCoreTokenEffectImmunityQueries } from '../../moveAutomation/reducers/immunities'
import { createMoveAutomationCreatureRuleResolver } from '../../moveAutomation/creatureRules'
import type { AuthoritativeAbilityContext } from '../context'
import { planAuthoritativeAbilityItemProviders } from '../itemProviders'
import {
  abilityEffectiveCapabilitiesForPlacement,
  applyAbilityHpToSheet,
} from '../capabilityHpInvariants'
import { reduceAbilityOwnedStateCommand } from '../ownedState'
import { planAbilityFrequencyPayment } from '../usage'
import { aa065CuriousMedicineEntryStateIds } from './aa065PresenceIntegration'
import { AA065_CUD_CHEW_CONSUMED_PREFIX } from './aa065ItemIntegration'
import { aa065CrushTrapGrappleStateIds } from './aa065ManeuverIntegration'
import { authoritativeAbilityHealingBlocked } from '../healingPrevention'
import { aa065CourageDamageModifiers } from './aa065StaticIntegration'

const SCENE_FREQUENCY: AbilityFrequencyDeclaration = Object.freeze({
  raw: 'Scene', actionText: '', kind: 'scene', uses: 1, exceptionId: null,
})

export class Aa065ActivatedExecutionError extends Error {
  constructor(detail: string) { super(detail); this.name = 'Aa065ActivatedExecutionError' }
}
const fail = (detail: string): never => { throw new Aa065ActivatedExecutionError(detail) }
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
  resource: 'swift' | 'free'
}) => planEncounterMoveResourceCosts({
  map: input.context.map,
  placementId: input.context.actor.placement.id,
  canonicalMoveId: `ability:${input.canonicalId}`,
  moveKey: `ability:${input.canonicalId.toLowerCase().replaceAll(' ', '-')}`,
  range: input.resource === 'swift' ? 'Swift Action' : 'Free Action',
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
const sheetChange = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  placementId: string
  previous: AnyLiveSheet
  current: AnyLiveSheet
  reasonCode: string
  changedFields?: readonly ('hp' | 'combatStages' | 'conditions')[]
}): MoveStateChangeInput => {
  const placement = input.context.queries.placements.get(input.placementId)
    ?? fail(`Ability sheet target ${input.placementId} disappeared.`)
  const resolved = input.context.queries.sheets.forPlacement(placement)
    ?? fail(`Ability sheet target ${input.placementId} has no sheet.`)
  input.current.revision = nextRevision(resolved.revision)
  return {
    kind: 'sheet-state', scope: { kind: 'sheet', sheetKind: resolved.kind, sheetSlug: resolved.slug },
    expectedRevision: resolved.revision, sourceOperationId: input.operationId, reasonCode: input.reasonCode,
    previous: input.previous, current: input.current, changedFields: input.changedFields ?? ['combatStages'],
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  }
}
const paySceneAbility = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  abilityInstanceId: string
  canonicalId: string
  resource: 'swift' | 'free'
}): ReturnType<typeof parseEncounterState> => {
  const action = actionPlan(input)
  const frequency = planAbilityFrequencyPayment({
    context: mapWithEncounter(input.context, action.currentEncounterState),
    frequency: SCENE_FREQUENCY, abilityInstanceId: input.abilityInstanceId,
    clauseId: 'base', operationId: `${input.operationId}:frequency`,
    sceneId: action.nextMap.encounterState?.history.sceneId ?? undefined,
  })
  return currentEncounter(frequency.plan, action.currentEncounterState)
}

const curiousMedicineExecution = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  abilityInstanceId: string
}): Aa065ActivatedExecution => {
  const entryMode = input.context.request.modeId === 'enter-field'
  const entryStateIds = aa065CuriousMedicineEntryStateIds({
    map: input.context.map,
    ownerPlacementId: input.context.actor.placement.id,
    abilityInstanceId: input.abilityInstanceId,
  })
  if (entryMode && entryStateIds.length === 0) {
    return fail('Curious Medicine enter-field mode requires a current authoritative entry reaction mark.')
  }
  let encounter = paySceneAbility({
    context: input.context, operationId: input.operationId,
    abilityInstanceId: input.abilityInstanceId, canonicalId: 'Curious Medicine',
    resource: entryMode ? 'free' : 'swift',
  })
  if (entryMode) {
    for (const stateId of entryStateIds) {
      const state = encounter.abilityOwnedState?.entries.find(entry => entry.stateId === stateId)
        ?? fail(`Curious Medicine state ${stateId} disappeared.`)
      const reduced = reduceAbilityOwnedStateCommand(encounter.abilityOwnedState, {
        operationId: `${input.operationId}:consume-entry:${createHash('sha256').update(stateId).digest('hex').slice(0, 16)}`,
        kind: 'remove', stateId, expectedVersion: state.version,
      })
      encounter = parseEncounterState({ ...encounter, abilityOwnedState: reduced.state })
    }
  }
  const changes: MoveStateChangeInput[] = [encounterChange({
    context: input.context, operationId: input.operationId,
    reasonCode: entryMode
      ? 'ability.aa065.curious-medicine.entry-reaction'
      : 'ability.aa065.curious-medicine.activation',
    current: encounter,
  })]
  const visited = new Set<string>()
  for (const placement of input.context.queries.placements.all()) {
    if (input.context.queries.relationships.relation(input.context.actor.placement.id, placement.id) !== 'ally') continue
    const token = input.context.queries.tokens.get(placement.id)
    const resolved = input.context.queries.sheets.forPlacement(placement)
    if (!token || !resolved
      || ptuGridDistanceBetweenFootprints(input.context.actor.token, token) > 2) continue
    const key = `${resolved.kind}:${resolved.slug}`
    if (visited.has(key)) continue
    visited.add(key)
    const previous = deepCloneJson(resolved.sheet) as AnyLiveSheet
    const defaults: CombatStageMap = { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 }
    const current = applyCombatStagesToSheet(resolved.kind, previous, defaults)
    if (sameJsonValue(previous, current)) continue
    changes.push(sheetChange({
      context: input.context, operationId: `${input.operationId}:reset:${placement.id}`,
      placementId: placement.id, previous, current,
      reasonCode: 'ability.aa065.curious-medicine.reset-ally-stages',
    }))
  }
  return Object.freeze({
    plan: createMoveStateChangePlan(changes),
    presentationKey: entryMode
      ? 'ability.aa065.curious-medicine.entry-applied'
      : 'ability.aa065.curious-medicine.applied',
  })
}

const crushTrapExecution = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  abilityInstanceId: string
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa065ActivatedExecution => {
  if (input.context.request.modeId !== 'crush') return fail('Crush Trap requires its marked Grapple response mode.')
  const selected = choiceValue(input.choices, 'crush.target')
  const targetId = selected?.kind === 'token' ? selected.placementId : null
  if (!targetId) return fail('Crush Trap requires one issued grappled target.')
  const stateIds = aa065CrushTrapGrappleStateIds({
    map: input.context.map, ownerPlacementId: input.context.actor.placement.id,
    abilityInstanceId: input.abilityInstanceId, targetPlacementId: targetId,
  })
  if (stateIds.length === 0) return fail('Crush Trap has no current authoritative successful-Grapple mark for that target.')
  const target = input.context.queries.tokens.get(targetId)
    ?? fail(`Crush Trap target ${targetId} disappeared.`)
  const targetPlacement = input.context.queries.placements.get(targetId)
    ?? fail(`Crush Trap target placement ${targetId} disappeared.`)
  if (ptuGridDistanceBetweenFootprints(input.context.actor.token, target) > 1) {
    return fail('Crush Trap target is no longer in Melee range.')
  }
  const damageBase = (input.context.actor.token.combatSkillRankValue ?? 0) >= 5 ? 5 : 4
  const formula = findMoveDamageBase(damageBase) ?? fail(`Crush Trap has no reviewed DB ${damageBase} formula.`)
  const roll = input.context.random.roll({
    rollId: `ability.crush-trap.damage.${createHash('sha256').update(input.operationId).digest('hex').slice(0, 24)}`,
    parentEffectId: input.operationId,
    reason: `ability.crush-trap.struggle-damage for ${targetId}`,
    formula: { kind: 'dice', count: formula.count, sides: formula.sides, modifier: formula.mod },
  })
  const canonical = findMove('Struggle') ?? fail('Canonical Struggle data is missing.')
  const script = {
    ...buildMoveAutomationScriptFromMoveData(canonical),
    damageBase,
  }
  const damageOperation: MoveDamageEffectOperation = {
    id: `ability.crush-trap.damage.${createHash('sha256').update(`${input.operationId}:${targetId}`).digest('hex').slice(0, 24)}`,
    kind: 'damage', source: { kind: 'move', id: 'ability.crush-trap' },
    recipients: { kind: 'response-owner' }, phase: 'after-damage',
    reasonCode: 'ability.crush-trap.struggle-damage',
    payload: {
      damageClass: 'physical', damageBase, moveType: 'normal', accuracyRollId: null, criticalRollId: null,
      criticalHit: { trigger: { kind: 'never' }, prevention: 'honor' },
    },
  }
  const capabilityPlacementIds = new Set<string>([
    input.context.actor.placement.id,
    targetId,
    ...(input.context.map.encounterState?.capabilityRuntime?.links ?? []).flatMap(link => [
      link.ownerPlacementId,
      ...link.participantPlacementIds,
    ]),
  ])
  const effectiveCapabilityIdentitiesByPlacement = new Map(
    [...capabilityPlacementIds].flatMap((placementId) => {
      if (!input.context.queries.placements.get(placementId)) return []
      const capabilities = abilityEffectiveCapabilitiesForPlacement({
        context: input.context,
        placementId,
      })
      return [[placementId, capabilities.instances.filter(instance => instance.effective).map(instance => ({
        instanceId: instance.instanceId,
        canonicalId: instance.canonicalId,
      }))] as const]
    }),
  )
  const creatureRules = createMoveAutomationCreatureRuleResolver({
    placements: input.context.placements,
    tokens: input.context.tokens,
    effects: input.context.map.encounterState?.effects,
    effectiveCapabilityIdentitiesByPlacement,
    recordSheetRead: placement => input.context.reads.recordPlacement(placement),
  })
  const moveContext = {
    ...input.context,
    queries: {
      ...input.context.queries,
      abilities: input.context.queries.effectiveAbilities,
      creatureRules,
    },
    intent: {
      schemaVersion: 1, placementId: input.context.actor.placement.id, moveName: 'Struggle',
      selection: { kind: 'single-target', targetPlacementId: targetId },
    },
    selectedPlacements: [targetPlacement],
    candidatePlacements: [targetPlacement],
  } as unknown as AuthoritativeMoveRulesContext
  const breakdown = resolveMoveAutomationTargetDamageBreakdown(
    script,
    input.context.actor.token,
    target,
    {
      accuracyRoll: '', hit: true, crit: false,
      damageRoll: {
        formula: `${formula.count}d${formula.sides}+${formula.mod}`,
        count: formula.count, sides: formula.sides, mod: formula.mod,
        rolls: [...roll.naturalResults], total: roll.finalValue,
      },
      manualHpLoss: '', applyDamage: true,
    },
    input.context.map.fieldEffects,
    [target],
    {
      damageBase,
      additionalModifiers: aa065CourageDamageModifiers({
        context: moveContext, operation: damageOperation,
        actor: input.context.actor.token, recipient: target,
      }),
    },
  )
  const reduced = reduceMoveCoreTokenOperationState({
    context: moveContext,
    operations: [{ operation: damageOperation, recipientIds: [targetId] }],
    dynamicRecipients: {
      attackedTargetIds: [targetId], hitTargetIds: [targetId], missedTargetIds: [],
      damagedTargetIds: breakdown.hpLoss > 0 ? [targetId] : [], faintedTargetIds: [],
    },
    damage: {
      resolve: () => ({
        hpLoss: breakdown.hpLoss,
        moveType: 'normal',
        preventedBy: null,
        consultedPlacementIds: [],
        details: { ability: 'Crush Trap', damageBase, critical: false },
      }),
    },
    immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'normal', context: moveContext }),
  })
  const reducedEncounter = reduced.stateChanges.changes.find(change => change.kind === 'encounter-state')
  const paymentContext = reducedEncounter
    ? {
        ...input.context,
        map: {
          ...input.context.map,
          encounterState: parseEncounterState(reducedEncounter.current),
        },
      }
    : input.context
  let encounter = paySceneAbility({
    context: paymentContext, operationId: input.operationId,
    abilityInstanceId: input.abilityInstanceId, canonicalId: 'Crush Trap', resource: 'free',
  })
  for (const stateId of stateIds) {
    const state = encounter.abilityOwnedState?.entries.find(entry => entry.stateId === stateId)
      ?? fail(`Crush Trap state ${stateId} disappeared.`)
    const removed = reduceAbilityOwnedStateCommand(encounter.abilityOwnedState, {
      operationId: `${input.operationId}:consume-grapple:${createHash('sha256').update(stateId).digest('hex').slice(0, 16)}`,
      kind: 'remove', stateId, expectedVersion: state.version,
    })
    encounter = parseEncounterState({ ...encounter, abilityOwnedState: removed.state })
  }
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({
        context: input.context, operationId: input.operationId,
        reasonCode: 'ability.aa065.crush-trap.action-frequency-and-mark', current: encounter,
      }),
      ...reduced.stateChanges.changes.filter(change => change.kind !== 'encounter-state'),
    ]),
    presentationKey: 'ability.aa065.crush-trap.damage-applied',
  })
}

const CUD_CHEW_FIXED_HEALING: Readonly<Record<string, number>> = Object.freeze({
  potion: 20,
  'oran-berry': 5,
  'sitrus-berry': 15,
  'enriched-water': 20,
  'shuckles-berry-juice': 30,
  'super-soda-pop': 30,
})
const CUD_CHEW_CONDITION_CURES: Readonly<Record<string, string>> = Object.freeze({
  'cheri-berry': 'Paralysis',
  'chesto-berry': 'Sleep',
  'pecha-berry': 'Poisoned',
  'rawst-berry': 'Burned',
  'aspear-berry': 'Frozen',
  'persim-berry': 'Confused',
  'cornn-berry': 'Disabled',
  'magost-berry': 'Enraged',
  'rabuta-berry': 'Suppressed',
  'nomel-berry': 'Infatuation',
})

/** Replay only reviewed structured consumable effects; unknown item prose fails closed. */
const cudChewEffectChanges = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operationId: string
  readonly canonicalItemId: string
}): readonly MoveStateChangeInput[] => {
  const previous = deepCloneJson(input.context.actor.sheet.sheet) as AnyLiveSheet
  const healing = CUD_CHEW_FIXED_HEALING[input.canonicalItemId]
  if (healing !== undefined) {
    if (authoritativeAbilityHealingBlocked({
      map: input.context.map,
      placementId: input.context.actor.placement.id,
    })) return Object.freeze([])
    const maximum = input.context.actor.token.fullMaxHp ?? input.context.actor.token.maxHp
    const hp = Math.min(maximum, input.context.actor.token.currentHp + healing)
    if (hp === input.context.actor.token.currentHp) return Object.freeze([])
    const current = applyAbilityHpToSheet({
      context: input.context,
      placementId: input.context.actor.placement.id,
      sheet: previous,
      currentHp: hp,
    })
    return Object.freeze([sheetChange({
      context: input.context,
      operationId: `${input.operationId}:consumable-effect`,
      placementId: input.context.actor.placement.id,
      previous,
      current,
      reasonCode: 'ability.aa065.cud-chew.replay-healing',
      changedFields: ['hp'],
    })])
  }
  const curedCondition = CUD_CHEW_CONDITION_CURES[input.canonicalItemId]
  if (curedCondition) {
    const conditions = input.context.actor.token.conditions.filter(condition => {
      const canonical = normalizeConditionName(condition) ?? condition
      if (curedCondition === 'Poisoned') return canonical !== 'Poisoned' && canonical !== 'Badly Poisoned'
      return canonical !== curedCondition
    })
    if (conditions.length === input.context.actor.token.conditions.length) return Object.freeze([])
    const current = applyConditionsToSheet(input.context.actor.sheet.kind, previous, conditions)
    return Object.freeze([sheetChange({
      context: input.context,
      operationId: `${input.operationId}:consumable-effect`,
      placementId: input.context.actor.placement.id,
      previous,
      current,
      reasonCode: 'ability.aa065.cud-chew.replay-condition-cure',
      changedFields: ['conditions'],
    })])
  }
  return fail(`Cud Chew has no registered authoritative effect for consumed item ${input.canonicalItemId}.`)
}

const cudChewExecution = (input: {
  context: AuthoritativeAbilityContext
  operationId: string
  abilityInstanceId: string
  choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa065ActivatedExecution => {
  const selected = choiceValue(input.choices, 'activate.item')
  const stateId = selected?.kind === 'item' ? selected.itemId : null
  const state = stateId
    ? input.context.map.encounterState?.abilityOwnedState?.entries.find(entry => (
        entry.stateId === stateId
        && entry.ownerPlacementId === input.context.actor.placement.id
        && entry.sourceAbilityInstanceId === input.abilityInstanceId
        && entry.canonicalId === 'Cud Chew'
        && entry.payload.kind === 'mark'
      ))
    : null
  if (!state || state.payload.kind !== 'mark'
    || !state.payload.markId.startsWith(AA065_CUD_CHEW_CONSUMED_PREFIX)) {
    return fail('Cud Chew requires one issued consumed-item choice.')
  }
  const scene = input.context.map.activeScene
    ?? fail('Cud Chew requires an active Scene.')
  const actorSheet = input.context.actor.sheet.kind === 'pokemon'
    ? input.context.actor.sheet.sheet as CharacterSheet
    : null
  const sceneStartedAt = Number.isSafeInteger(scene.startedAt) ? scene.startedAt! : 0
  const evidence = actorSheet?.serverPrivate?.abilityItemEvidence?.find(record => (
    record.stateId === state.stateId
    && record.sceneName === scene.name
    && record.sceneStartedAt === sceneStartedAt
  ))
  const durableEvidence = evidence
    ?? fail('Cud Chew private consumed-item evidence is unavailable.')
  const canonicalItemId = durableEvidence.canonicalItemId
  const digest = createHash('sha256').update(state.stateId).digest('hex').slice(0, 24)
  const consumptionId = `ability.cud-chew.consumption.${digest}`
  const consumed: MoveConsumedItemRecord = {
    consumptionId,
    sourceOperationId: durableEvidence.sourceOperationId,
    source: {
      schemaVersion: 1, kind: 'pokemon-held', itemId: `cud-chew-${digest}`,
      canonicalItemId,
      owner: {
        kind: 'sheet', sheetKind: 'pokemon', slug: input.context.actor.sheet.slug,
        revision: input.context.actor.sheet.revision,
      },
      quantity: 1, stack: 'singleton', equip: 'pokemon-held',
    },
    canonicalItemId, quantity: 1,
  }
  const itemContext: AuthoritativeAbilityContext = {
    ...input.context,
    queries: {
      ...input.context.queries,
      items: {
        ...input.context.queries.items,
        consumedById: id => id === consumptionId ? consumed : null,
        consumedItems: () => Object.freeze([consumed]),
      },
    },
  }
  const item = planAuthoritativeAbilityItemProviders({
    context: itemContext,
    parentOperationId: input.operationId,
    providers: [{
      schemaVersion: 1, providerId: `aa065.cud-chew.${digest}`,
      abilityInstanceId: input.abilityInstanceId, canonicalId: 'Cud Chew',
      sourcePlacementId: input.context.actor.placement.id,
      ownerPlacementId: input.context.actor.placement.id,
      recipientPlacementIds: [input.context.actor.placement.id], priority: 0,
      reasonCode: 'ability.aa065.cud-chew.reuse-consumed-effect',
      payload: {
        action: 'restore', consumptionId, mode: 'effect', destination: null,
        onUnavailable: 'reject',
      },
    }],
  })
  if (!item.mutations.operationResults.some(result => (
    result.kind === 'reuse-consumed' && result.consumptionId === consumptionId
  ))) return fail('Cud Chew failed to replay its authoritative consumed-item effect.')
  const effectChanges = cudChewEffectChanges({
    context: input.context,
    operationId: input.operationId,
    canonicalItemId,
  })
  const encounter = paySceneAbility({
    context: input.context, operationId: input.operationId,
    abilityInstanceId: input.abilityInstanceId, canonicalId: 'Cud Chew', resource: 'swift',
  })
  return Object.freeze({
    plan: createMoveStateChangePlan([
      encounterChange({
        context: input.context, operationId: input.operationId,
        reasonCode: 'ability.aa065.cud-chew.action-frequency-and-replay', current: encounter,
      }),
      ...item.mutations.stateChanges.changes,
      ...effectChanges,
    ]),
    presentationKey: 'ability.aa065.cud-chew.replayed',
  })
}

export interface Aa065ActivatedExecution {
  readonly plan: MoveStateChangePlan
  readonly presentationKey: string
}

export const executeAa065ActivatedMechanic = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly operation: AbilityMechanicOperation
  readonly operationId: string
  readonly abilityInstanceId: string
  readonly choices: readonly { readonly declarationId: string; readonly options: readonly { readonly value: AbilityDeclarationOptionValue }[] }[]
}): Aa065ActivatedExecution | null => {
  if (input.context.runtime.canonicalId === 'Curious Medicine'
    && input.operation.mechanicId === 'aa065.curious-medicine') return curiousMedicineExecution(input)
  if (input.context.runtime.canonicalId === 'Cud Chew'
    && input.operation.mechanicId === 'aa065.cud-chew') return cudChewExecution(input)
  if (input.context.runtime.canonicalId === 'Crush Trap'
    && input.operation.mechanicId === 'aa065.crush-trap') return crushTrapExecution(input)
  return null
}
