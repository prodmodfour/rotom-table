import { createHash } from 'node:crypto'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { AbilityOwnedStateEntry } from '#shared/abilityAutomation/ownedState'

const shortHash = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 24)
const aquaBulletHash = shortHash
export const aa061AuraBreakMarkId = (abilityInstanceId: string): string => `aa061.aura-break.invert:${shortHash(abilityInstanceId)}`

export const aa061AuraBonusMultiplier = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly sourcePlacementId: string
  readonly sourceCanonicalId: string
}): 1 | -1 => {
  if (!input.sourceCanonicalId.toLowerCase().includes('aura')) return 1
  const targetInstances = input.context.queries.abilities.activeForPlacement(input.sourcePlacementId)
    .filter(ability => ability.canonicalId === input.sourceCanonicalId)
  const inverted = (input.context.map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
    entry.canonicalId === 'Aura Break'
    && entry.payload.kind === 'mark'
    && entry.targetPlacementIds.includes(input.sourcePlacementId)
    && targetInstances.some(instance => entry.payload.kind === 'mark'
      && entry.payload.markId === aa061AuraBreakMarkId(instance.instanceId))
    && input.context.queries.abilities.activeForPlacement(entry.ownerPlacementId)
      .some(ability => ability.instanceId === entry.sourceAbilityInstanceId && ability.canonicalId === 'Aura Break')
  ))
  return inverted ? -1 : 1
}
export const aa061AquaBulletMarkId = (moveName: string): string => `aa061.aqua-bullet.next-move:${aquaBulletHash(moveName)}`
export const hasPendingAa061AquaBulletAttack = (
  context: AuthoritativeMoveRulesContext,
): boolean => (context.map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
  entry.ownerPlacementId === context.actor.placement.id
  && entry.canonicalId === 'Aqua Bullet'
  && entry.payload.kind === 'mark'
  && entry.payload.markId.startsWith('aa061.aqua-bullet.next-move:')
  && context.queries.abilities.activeForPlacement(context.actor.placement.id)
    .some(ability => ability.instanceId === entry.sourceAbilityInstanceId && ability.canonicalId === 'Aqua Bullet')
))
export const hasAa061AquaBulletMark = (
  context: AuthoritativeMoveRulesContext,
  moveName: string,
): boolean => (context.map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
  entry.ownerPlacementId === context.actor.placement.id
  && entry.canonicalId === 'Aqua Bullet'
  && entry.payload.kind === 'mark'
  && entry.payload.markId === aa061AquaBulletMarkId(moveName)
  && context.queries.abilities.activeForPlacement(context.actor.placement.id)
    .some(ability => ability.instanceId === entry.sourceAbilityInstanceId && ability.canonicalId === 'Aqua Bullet')
))
export const mapHasAa061AquaBulletPrepaidMove = (input: {
  readonly map: { readonly encounterState?: { readonly abilityOwnedState?: { readonly entries: readonly AbilityOwnedStateEntry[] } } }
  readonly actorPlacementId: string
  readonly moveName: string
}): boolean => (input.map.encounterState?.abilityOwnedState?.entries ?? []).some(entry => (
  entry.ownerPlacementId === input.actorPlacementId
  && entry.canonicalId === 'Aqua Bullet'
  && entry.payload.kind === 'mark'
  && entry.payload.markId === aa061AquaBulletMarkId(input.moveName)
))

export const aa061AquaBulletStateIdsForMove = (
  context: AuthoritativeMoveRulesContext,
  moveName: string,
): readonly string[] => Object.freeze((context.map.encounterState?.abilityOwnedState?.entries ?? []).flatMap(entry => (
  entry.ownerPlacementId === context.actor.placement.id
  && entry.canonicalId === 'Aqua Bullet'
  && entry.payload.kind === 'mark'
  && entry.payload.markId === aa061AquaBulletMarkId(moveName)
  ? [entry.stateId]
  : []
)))

const batteryMarks = (context: AuthoritativeMoveRulesContext): readonly AbilityOwnedStateEntry[] => (
  context.map.encounterState?.abilityOwnedState?.entries ?? []
).filter(entry => (
  entry.canonicalId === 'Battery'
  && entry.payload.kind === 'mark'
  && entry.payload.markId === 'aa061.battery.next-special'
  && entry.targetPlacementIds.includes(context.actor.placement.id)
  && context.queries.abilities.activeForPlacement(entry.ownerPlacementId)
    .some(ability => ability.instanceId === entry.sourceAbilityInstanceId && ability.canonicalId === 'Battery')
))

export const aa061BatteryStateIdsForMove = (
  context: AuthoritativeMoveRulesContext,
  script: MoveAutomationScript,
): readonly string[] => script.damageClass === 'Special'
  ? Object.freeze(batteryMarks(context).map(entry => entry.stateId))
  : Object.freeze([])

export const primeAa061MoveRandomness = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly damageOperationIds: readonly string[]
}): void => {
  if (input.script.damageClass !== 'Special') return
  const electric = input.script.type.trim().toLowerCase() === 'electric'
  for (const mark of batteryMarks(input.context)) {
    for (const operationId of input.damageOperationIds) {
      const rollId = `ability.battery.${mark.stateId}.${operationId}`
      if (input.context.random.snapshot().some(entry => entry.rollId === rollId)) continue
      input.context.random.roll({
        rollId,
        parentEffectId: operationId,
        reason: electric ? 'ability.battery.electric-damage-bonus' : 'ability.battery.damage-bonus',
        formula: electric
          ? { kind: 'dice', count: 3, sides: 6, modifier: 6 }
          : { kind: 'dice', count: 2, sides: 6, modifier: 4 },
      })
    }
  }
}

export const aa061BeamCannonMinimum = (
  context: AuthoritativeMoveRulesContext,
  minimum: number,
): number => {
  if (!context.queries.abilities.has(context.actor.placement.id, 'Beam Cannon')) return minimum
  const entry = context.queries.resolveActorMoveEntry(context.intent.moveName)
  if (!entry.ok
    || entry.entry.script.targetMode !== 'one-target'
    || entry.entry.script.range.toLowerCase().includes('melee')) return minimum
  return Math.max(1, minimum - 3)
}

/** Exact manifest-selected AA-061 damage bonuses shared by roll projection and reduction. */
export const aa061MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly script: MoveAutomationScript
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveTypeSources: readonly string[]
}): readonly MoveDamageModifier[] => {
  const modifiers: MoveDamageModifier[] = []
  if (input.context.queries.abilities.has(input.actor.id, 'Aura Storm')) {
    const injuries = Math.max(0, input.actor.injuries ?? 0)
    if (injuries > 0) {
      modifiers.push({
        id: `ability.aura-storm.damage.${input.operation.id}.${input.recipient.id}`,
        stage: 'pre-type-modifiers', priority: 30,
        source: { kind: 'ability', id: input.actor.id },
        stackingGroup: 'aa061-aura-storm',
        reasonCode: 'ability.aura-storm.injury-bonus',
        operation: 'add', value: injuries * 3 * aa061AuraBonusMultiplier({
          context: input.context,
          sourcePlacementId: input.actor.id,
          sourceCanonicalId: 'Aura Storm',
        }),
      })
    }
  }
  if (input.moveTypeSources.includes('Aqua Boost')) {
    modifiers.push({
      id: `ability.aqua-boost.damage.${input.operation.id}.${input.recipient.id}`,
      stage: 'pre-type-modifiers', priority: 35,
      source: { kind: 'ability', id: input.actor.id },
      stackingGroup: 'aa061-aqua-boost',
      reasonCode: 'ability.aqua-boost.damage-bonus',
      operation: 'add', value: 5,
    })
  }
  if (input.script.damageClass === 'Special') {
    for (const mark of batteryMarks(input.context)) {
      const rollId = `ability.battery.${mark.stateId}.${input.operation.id}`
      const roll = input.context.random.snapshot().find(entry => entry.rollId === rollId)
      if (!roll) throw new Error(`Missing authoritative Battery roll ${rollId}.`)
      modifiers.push({
        id: `ability.battery.damage.${mark.stateId}.${input.operation.id}.${input.recipient.id}`,
        stage: 'pre-type-modifiers', priority: 32,
        source: { kind: 'ability', id: mark.ownerPlacementId },
        stackingGroup: `aa061-battery:${mark.sourceAbilityInstanceId}`,
        reasonCode: input.script.type.trim().toLowerCase() === 'electric'
          ? 'ability.battery.electric-damage-bonus'
          : 'ability.battery.damage-bonus',
        operation: 'add', value: roll.finalValue,
      })
    }
  }
  return Object.freeze(modifiers)
}
