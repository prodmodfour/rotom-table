import { createHash } from 'node:crypto'
import {
  AA077_LANCER_DISENGAGE_FLAG_ID,
  aa077LeafRushMarks,
} from '#shared/abilityAutomation/aa077'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import { applyCombatStageToStat } from '~/utils/combatStageStats'
import { projectAa077AbilityTokenStats } from '~/utils/nativeAbilityTokenStats'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { planEncounterMoveResourceCosts } from '../../moveAutomation/planMoveResources'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAbilityInstances } from '../instanceParameters'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../registry'

export const AA077_LIGHT_METAL_ABILITY = 'Light Metal' as const
export const AA077_LEVITATE_ABILITY = 'Levitate' as const

const activeRuntimeIds = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placement: Pick<SheetPlacement, 'id' | 'sideId' | 'position'>
  readonly sheet: Pick<CharacterSheet | TrainerSheet, 'abilities'>
}): readonly string[] => projectAuthoritativeEffectiveAbilities({
  baseAbilities: resolveSheetAbilityInstances(input.sheet.abilities),
  target: {
    placementId: input.placement.id,
    ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
    position: input.placement.position,
  },
  effects: input.map.encounterState?.effects ?? [],
  transformationSnapshots: input.map.encounterState?.abilityTransformations,
}).flatMap(ability => {
  if (!ability.effective) return []
  const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(ability.canonicalId)
  if (!runtime || (ability.definitionHash !== null && ability.definitionHash !== runtime.definitionHash)) return []
  return [ability.canonicalId]
})

/** Exact manifest-selected effective ability projection for non-Move server paths. */
export const aa077EffectiveAbilityIds = activeRuntimeIds

/**
 * Project Light Metal Base Stat/Weight adjustments and the Levitate ability's
 * 4-or-+2 movement benefit from exact effective abilities. Native sheet,
 * species, and Move-granted Levitate speed enters as the untouched base.
 */
export const aa077AdjustedToken = (input: {
  readonly token: SpawnedPokemon
  readonly effectiveAbilityIds: readonly string[]
}): SpawnedPokemon => {
  const abilities = new Set(input.effectiveAbilityIds)
  return projectAa077AbilityTokenStats(input.token, {
    lightMetal: abilities.has(AA077_LIGHT_METAL_ABILITY),
    levitate: abilities.has(AA077_LEVITATE_ABILITY),
  })
}

export const aa077LightMetalInitiativeSpeedOffset = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet
}): 0 | 2 => activeRuntimeIds(input).includes(AA077_LIGHT_METAL_ABILITY) ? 2 : 0

const lancerLedger = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
) => context.queries.resources.ledger(placementId)

export const aa077LancerCriticalRangeBonus = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
}): 0 | 3 => {
  if (!input.context.queries.abilities.has(input.placementId, 'Lancer')) return 0
  const ledger = lancerLedger(input.context, input.placementId)
  const shiftSpent = ledger
    ? ledger.actions.shift.spent + ledger.actions.full.spent
    : 0
  return ledger && ledger.movement.spent >= 3 && shiftSpent > 0 ? 3 : 0
}

export const aa077LancerDamageReductionActive = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
}): boolean => {
  if (!input.context.queries.abilities.has(input.placementId, 'Lancer')) return false
  const ledger = lancerLedger(input.context, input.placementId)
  return ledger !== null
    && ledger.movement.spent === 0
    && ledger.actions.shift.spent === 0
    && !ledger.oncePerTurnFlags.some(flag => flag.id === AA077_LANCER_DISENGAGE_FLAG_ID)
}

export const aa077LeafRushActiveForMove = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'type'>
}): boolean => {
  if (input.script.type.trim().toLowerCase() !== 'grass') return false
  const actorId = input.context.actor.placement.id
  const activeInstances = new Set(input.context.queries.abilities.activeForPlacement(actorId)
    .filter(ability => ability.canonicalId === 'Leaf Rush')
    .map(ability => ability.instanceId))
  return activeInstances.size > 0 && aa077LeafRushMarks({
    entries: input.context.map.encounterState?.abilityOwnedState?.entries,
    ownerPlacementId: actorId,
    activeAbilityInstanceIds: activeInstances,
  }).length > 0
}

export const aa077LeafRushStateIdsForMove = (
  context: AuthoritativeMoveRulesContext,
  script: Pick<MoveAutomationScript, 'type'>,
): readonly string[] => aa077LeafRushActiveForMove({ context, script })
  ? aa077LeafRushMarks({
      entries: context.map.encounterState?.abilityOwnedState?.entries,
      ownerPlacementId: context.actor.placement.id,
      activeAbilityInstanceIds: new Set(context.queries.abilities
        .activeForPlacement(context.actor.placement.id)
        .filter(ability => ability.canonicalId === 'Leaf Rush')
        .map(ability => ability.instanceId)),
    }).map(entry => entry.stateId)
  : Object.freeze([])

const lastChanceModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: string
}): readonly MoveDamageModifier[] => {
  const type = input.moveType.trim().toLowerCase()
  if (!['ground', 'normal'].includes(type)) return Object.freeze([])
  const maximumHp = Math.max(1, input.actor.fullMaxHp ?? input.actor.maxHp)
  if (Math.max(0, input.actor.currentHp) * 3 > maximumHp) return Object.freeze([])
  const canonicalId = type === 'ground' ? 'Landslide' : 'Last Chance'
  return Object.freeze(input.context.queries.abilities.activeForPlacement(input.actor.id)
    .filter(ability => ability.canonicalId === canonicalId)
    .map((ability, index): MoveDamageModifier => ({
      id: `ability.aa077.last-chance.${createHash('sha256')
        .update(`${input.operation.id}\u0000${input.recipient.id}\u0000${ability.instanceId}`)
        .digest('hex').slice(0, 24)}`,
      stage: 'pre-type-modifiers', priority: 39 + index,
      source: { kind: 'ability', id: ability.instanceId },
      stackingGroup: `aa077-last-chance:${createHash('sha256').update(ability.instanceId).digest('hex').slice(0, 24)}`,
      reasonCode: canonicalId === 'Landslide'
        ? 'ability.landslide.last-chance'
        : 'ability.last-chance.normal',
      operation: 'add', value: 5,
    })))
}

export const aa077MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: string
}): readonly MoveDamageModifier[] => {
  const modifiers: MoveDamageModifier[] = [...lastChanceModifiers(input)]
  if (aa077LeafRushActiveForMove({ context: input.context, script: { type: input.moveType } })) {
    const speed = applyCombatStageToStat(input.actor.spd, input.actor.combatStages?.spd)
    modifiers.push({
      id: `ability.leaf-rush.damage.${createHash('sha256').update(`${input.operation.id}\u0000${input.recipient.id}`).digest('hex').slice(0, 24)}`,
      stage: 'pre-type-modifiers', priority: 44,
      source: { kind: 'ability', id: 'Leaf Rush' },
      stackingGroup: 'aa077-leaf-rush',
      reasonCode: 'ability.leaf-rush.half-speed-damage',
      operation: 'add', value: Math.floor(speed / 2),
    })
  }
  const lancer = input.context.queries.abilities.activeForPlacement(input.recipient.id)
    .find(ability => ability.canonicalId === 'Lancer')
  if (lancer && aa077LancerDamageReductionActive({
    context: input.context,
    placementId: input.recipient.id,
  })) modifiers.push({
    id: `ability.lancer.reduction.${createHash('sha256').update(`${input.operation.id}\u0000${input.recipient.id}`).digest('hex').slice(0, 24)}`,
    stage: 'post-damage-modifiers', priority: 36,
    source: { kind: 'ability', id: lancer.instanceId },
    stackingGroup: `aa077-lancer-reduction:${createHash('sha256').update(lancer.instanceId).digest('hex').slice(0, 24)}`,
    reasonCode: 'ability.lancer.no-shift-damage-reduction',
    operation: 'subtract', value: 5,
  })
  return Object.freeze(modifiers)
}

export const aa077HasAuthoritativeDisengageWindow = (input: {
  readonly map: TabletopMap
  readonly placementId: string
}): boolean => (
  input.map.encounterState?.history.currentTurn?.placementId === input.placementId
  && input.map.encounterState.turnResources[input.placementId] !== undefined
)

/** Record exact Disengage identity and its Shift payment in one map-owned ledger. */
export const applyAa077DisengageResourceEvidence = (input: {
  readonly map: TabletopMap
  readonly placementId: string
  readonly operationId: string
}): TabletopMap => planEncounterMoveResourceCosts({
  map: input.map,
  placementId: input.placementId,
  canonicalMoveId: 'Disengage',
  moveKey: 'maneuver:disengage',
  range: 'Shift Action',
  resolutionId: input.operationId,
  sourceOperationId: input.operationId,
  movement: null,
  reviewedCosts: [{
    id: 'maneuver.disengage.shift', phase: 'pay',
    cost: { kind: 'action-resource', resource: 'shift', amount: 1 },
  }, {
    id: 'maneuver.disengage.evidence', phase: 'pay',
    cost: { kind: 'once-per-turn', flagId: AA077_LANCER_DISENGAGE_FLAG_ID },
  }],
  allowLegacyFallback: false,
  minimumPhaseExclusive: null,
  maximumPhaseInclusive: 'pay',
  markActedSinceEntry: true,
}).nextMap

export const aa077IsProtectedRareLeek = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly ownerPlacementId: string
  readonly canonicalItemId: string
  readonly voluntaryActorPlacementId?: string
}): boolean => input.canonicalItemId === 'rare-leek'
  && input.ownerPlacementId !== input.voluntaryActorPlacementId
  && input.context.queries.abilities.has(input.ownerPlacementId, 'Leek Mastery')
