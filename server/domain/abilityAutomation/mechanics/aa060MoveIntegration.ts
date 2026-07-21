import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import { POKEMON_TYPES, type PokemonType } from '~/utils/typeChart'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveDamageClassResolution } from '../../moveAutomation/damageStats'
import type { MoveDamageTypeResolution } from '../../moveAutomation/damageTypes'
import { resolveAa060MoveMechanics, type Aa060MoveFact } from './aa060'
import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'

const canonicalTypeId = (value: string): Aa060MoveFact['moveType'] | null => {
  const normalized = value.trim().toLowerCase()
  return POKEMON_TYPES.some(type => type.toLowerCase() === normalized)
    ? normalized as Aa060MoveFact['moveType']
    : null
}
const markHash = (value: string): string => createHash('sha256')
  .update(stableJsonStringify(value)).digest('hex').slice(0, 24)
export const aa060MoveMarkId = (
  canonicalId: 'Accelerate' | 'Aerilate' | 'Ambush' | 'Anchored',
  moveName: string,
): string => `${canonicalId === 'Accelerate'
  ? 'aa060.accelerate.next-move'
  : canonicalId === 'Aerilate'
    ? 'aa060.aerilate.next-move'
    : canonicalId === 'Ambush'
      ? 'aa060.ambush.next-move'
      : 'aa060.anchored.next-move'}:${markHash(moveName)}`
export const hasAa060MoveMark = (
  context: AuthoritativeMoveRulesContext,
  canonicalId: 'Accelerate' | 'Aerilate' | 'Ambush' | 'Anchored',
  moveName: string,
): boolean => {
  const expected = aa060MoveMarkId(canonicalId, moveName)
  return (context.map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
    entry.ownerPlacementId === context.actor.placement.id
    && entry.canonicalId === canonicalId
    && entry.payload.kind === 'mark'
    && entry.payload.markId === expected
    && context.queries.abilities.activeForPlacement(context.actor.placement.id)
      .some(ability => ability.instanceId === entry.sourceAbilityInstanceId && ability.canonicalId === canonicalId)
  ))
}
const anchoredBonusRoll = (
  context: AuthoritativeMoveRulesContext,
  operation: MoveDamageEffectOperation,
): number | null => {
  if (!hasAa060MoveMark(context, 'Anchored', context.intent.moveName)) return null
  const rollId = `ability.anchored.${operation.id}.${context.actor.placement.id}`
  const prior = context.random.snapshot().find(entry => entry.rollId === rollId)
  if (!prior) throw new Error(`Missing authoritative Anchored roll ${rollId}.`)
  return prior.finalValue
}
export const hasPendingAa060AnchoredAttack = (
  context: AuthoritativeMoveRulesContext,
): boolean => (context.map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
  entry.ownerPlacementId === context.actor.placement.id
  && entry.canonicalId === 'Anchored'
  && entry.payload.kind === 'mark'
  && entry.payload.markId.startsWith('aa060.anchored.next-move:')
  && context.queries.abilities.activeForPlacement(context.actor.placement.id)
    .some(ability => ability.instanceId === entry.sourceAbilityInstanceId && ability.canonicalId === 'Anchored')
))
const adaptabilityRoll = (
  context: AuthoritativeMoveRulesContext,
  operation: MoveDamageEffectOperation,
): number | null => {
  const ability = context.queries.abilities.activeForPlacement(context.actor.placement.id)
    .find(entry => entry.canonicalId === 'Adaptability')
  if (!ability) return null
  const rollId = `ability.adaptability.${operation.id}.${context.actor.placement.id}`
  const prior = context.random.snapshot().find(entry => entry.rollId === rollId)
  if (!prior) throw new Error(`Missing authoritative Adaptability roll ${rollId}.`)
  return prior.finalValue
}
const relationFor = (multiplier: number): MoveDamageTypeResolution['finalRelation'] => (
  multiplier === 0 ? 'immune' : multiplier < 1 ? 'resistant' : multiplier > 1 ? 'weak' : 'neutral'
)

const aa060EffectiveMoveType = (context: AuthoritativeMoveRulesContext, script: MoveAutomationScript): Aa060MoveFact['moveType'] | null => {
  const original = canonicalTypeId(script.type)
  if (!original) return null
  return original === 'normal' && hasAa060MoveMark(context, 'Aerilate', script.moveName)
    ? 'flying'
    : original
}

export const aa060MovePriorityOverride = (
  context: AuthoritativeMoveRulesContext,
  script: MoveAutomationScript,
): boolean => {
  const damaging = script.damageClass === 'Physical' || script.damageClass === 'Special'
  if (!damaging) return false
  if (hasAa060MoveMark(context, 'Ambush', script.moveName)
    && script.damageBase !== null && script.damageBase <= 6) return true
  if (!hasAa060MoveMark(context, 'Accelerate', script.moveName)) return false
  const type = aa060EffectiveMoveType(context, script)
  return type !== null && context.actor.token.defenderTypes.some(actorType => canonicalTypeId(actorType) === type)
}

export const primeAa060MoveRandomness = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly damageOperationIds: readonly string[]
}): void => {
  const type = aa060EffectiveMoveType(input.context, input.script)
  const adaptability = input.context.queries.abilities.has(input.context.actor.placement.id, 'Adaptability')
    && type !== null
    && input.context.actor.token.defenderTypes.some(actorType => canonicalTypeId(actorType) === type)
  const anchored = hasAa060MoveMark(input.context, 'Anchored', input.script.moveName)
  for (const operationId of input.damageOperationIds) {
    if (adaptability) {
      const rollId = `ability.adaptability.${operationId}.${input.context.actor.placement.id}`
      if (!input.context.random.snapshot().some(entry => entry.rollId === rollId)) {
        input.context.random.roll({
          rollId,
          parentEffectId: operationId,
          reason: 'ability.adaptability.damage-bonus',
          formula: { kind: 'dice', count: 1, sides: 10, modifier: 0 },
        })
      }
    }
    if (anchored) {
      const rollId = `ability.anchored.${operationId}.${input.context.actor.placement.id}`
      if (!input.context.random.snapshot().some(entry => entry.rollId === rollId)) {
        input.context.random.roll({
          rollId,
          parentEffectId: operationId,
          reason: 'ability.anchored.damage-bonus',
          formula: { kind: 'dice', count: 2, sides: 6, modifier: 0 },
        })
      }
    }
  }
}

export const aa060MoveAccuracyBonus = (
  context: AuthoritativeMoveRulesContext,
  script: MoveAutomationScript,
): number => hasAa060MoveMark(context, 'Accelerate', script.moveName)
  && script.keywords.some(keyword => keyword.toLowerCase() === 'priority')
  && aa060MovePriorityOverride(context, script)
  ? 4
  : 0

export interface Aa060MoveDamageIntegration {
  readonly moveType: MoveDamageTypeResolution
  readonly modifiers: readonly MoveDamageModifier[]
  readonly appliedMechanicIds: ReturnType<typeof resolveAa060MoveMechanics>['appliedMechanicIds']
  readonly accelerateMarked: boolean
  readonly ambushMarked: boolean
}

/** Exact native move damage seam for effective manifest-selected AA-060 runtimes. */
export const resolveAa060MoveDamageIntegration = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly script: MoveAutomationScript
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly damageClass: MoveDamageClassResolution
  readonly moveType: MoveDamageTypeResolution
}): Aa060MoveDamageIntegration => {
  const actorAbilities = input.context.queries.abilities.activeForPlacement(input.actor.id)
  const activeMechanics: Aa060MoveFact['activeMechanics'][number][] = []
  const add = (canonicalId: string, mechanic: Aa060MoveFact['activeMechanics'][number]): void => {
    if (actorAbilities.some(ability => ability.canonicalId === canonicalId)) activeMechanics.push(mechanic)
  }
  add('Abominable', 'aa060.abominable')
  add('Accelerate', 'aa060.accelerate')
  add('Adaptability', 'aa060.adaptability')
  if (hasAa060MoveMark(input.context, 'Aerilate', input.script.moveName)) {
    activeMechanics.push('aa060.aerilate')
  }
  add('Ambush', 'aa060.ambush')
  add('Analytic', 'aa060.analytic')
  if (input.moveType.passiveSources.includes('Absorb Force')) activeMechanics.push('aa060.absorb-force')
  const accelerateMarked = hasAa060MoveMark(input.context, 'Accelerate', input.script.moveName)
  const ambushMarked = hasAa060MoveMark(input.context, 'Ambush', input.script.moveName)
  const moveTypeId = canonicalTypeId(input.moveType.moveType) ?? 'normal'
  const actorTypeIds = input.actor.defenderTypes.flatMap(type => {
    const canonical = canonicalTypeId(type)
    return canonical ? [canonical] : []
  })
  const hasAdaptability = activeMechanics.includes('aa060.adaptability')
    && actorTypeIds.includes(moveTypeId)
  const resolution = resolveAa060MoveMechanics({
    actorPlacementId: input.actor.id,
    targetPlacementId: input.recipient.id,
    moveInstanceId: input.script.moveName,
    moveType: moveTypeId,
    actorTypeIds,
    damageClass: input.damageClass.damageClass,
    damageBaseBeforeStab: input.script.damageBase,
    keywords: input.script.keywords,
    actorSpeed: input.actor.spd ?? 0,
    actorInitiativeOrder: 1,
    targetInitiativeOrder: input.context.queries.history.actedThisRound(input.recipient.id) ? 0 : null,
    hit: true,
    baseTypeMultiplier: input.moveType.finalMultiplier,
    adaptabilityRoll: hasAdaptability ? adaptabilityRoll(input.context, input.operation) : null,
    activeMechanics,
    accelerateMoveInstanceId: accelerateMarked ? input.script.moveName : null,
    ambushMoveInstanceId: ambushMarked ? input.script.moveName : null,
  })
  const adjustedType = resolution.resistanceSteps === 0
    || input.moveType.passiveSources.includes('Absorb Force')
    ? input.moveType : {
    ...input.moveType,
    passiveMultiplier: resolution.finalTypeMultiplier,
    passiveSources: [...input.moveType.passiveSources, 'Absorb Force'],
    finalMultiplier: resolution.finalTypeMultiplier,
    finalRelation: relationFor(resolution.finalTypeMultiplier),
  }
  const modifiers: MoveDamageModifier[] = resolution.preTypeDamageBonus === 0 ? [] : [{
    id: `ability.aa060.damage.${input.operation.id}.${input.recipient.id}`,
    stage: 'pre-type-modifiers', priority: 50,
    source: { kind: 'ability', id: input.actor.id },
    stackingGroup: 'aa060-damage-bonus',
    reasonCode: `ability.${resolution.appliedMechanicIds.filter(id => (
      id === 'aa060.accelerate' || id === 'aa060.adaptability' || id === 'aa060.analytic'
    )).join('+')}`,
    operation: 'add', value: resolution.preTypeDamageBonus,
  }]
  const anchoredBonus = anchoredBonusRoll(input.context, input.operation)
  if (anchoredBonus !== null) {
    modifiers.push({
      id: `ability.anchored.damage.${input.operation.id}.${input.recipient.id}`,
      stage: 'pre-type-modifiers', priority: 40,
      source: { kind: 'ability', id: input.actor.id },
      stackingGroup: 'aa060-anchored-damage-bonus',
      reasonCode: 'ability.anchored.damage-bonus',
      operation: 'add', value: anchoredBonus,
    })
  }
  return Object.freeze({
    moveType: Object.freeze(adjustedType),
    modifiers: Object.freeze(modifiers),
    appliedMechanicIds: resolution.appliedMechanicIds,
    accelerateMarked,
    ambushMarked,
  })
}
