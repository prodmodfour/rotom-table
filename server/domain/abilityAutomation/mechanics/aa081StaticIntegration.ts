import { createHash } from 'node:crypto'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import { getMaterialDefinition } from '~/utils/mapMaterials'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import { resistMultiplierOneStepFurther } from '~/utils/typeChart'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import type { MoveDamageTypeResolution } from '../../moveAutomation/damageTypes'

const shortHash = (...values: readonly string[]): string => createHash('sha256')
  .update(values.join('\u0000')).digest('hex').slice(0, 24)

const relation = (multiplier: number): MoveDamageTypeResolution['finalRelation'] => multiplier === 0
  ? 'immune'
  : multiplier < 1
    ? 'resistant'
    : multiplier > 1
      ? 'weak'
      : 'neutral'

const surfaceTags = (
  context: AuthoritativeMoveRulesContext,
  token: SpawnedPokemon,
): ReadonlySet<string> => {
  const tags = new Set<string>()
  const occupiedX = Array.from({ length: Math.max(1, token.base) }, (_, index) => token.position.x + index)
  const occupiedZ = Array.from({ length: Math.max(1, token.base) }, (_, index) => token.position.z + index)
  const topByCell = new Map<string, typeof context.map.voxels[number]>()
  for (const voxel of context.map.voxels) {
    if (!occupiedX.includes(voxel.x) || !occupiedZ.includes(voxel.z) || voxel.y > token.position.y) continue
    const key = `${voxel.x}:${voxel.z}`
    const current = topByCell.get(key)
    if (!current || voxel.y > current.y) topByCell.set(key, voxel)
  }
  for (const voxel of topByCell.values()) {
    const material = getMaterialDefinition(voxel.materialId)
    for (const value of [voxel.materialId, ...(voxel.tags ?? []), ...(material?.tags ?? [])]) {
      tags.add(value.trim().toLowerCase())
    }
  }
  return tags
}

/** Mud Shield's passive DR requires one structured mud/dirt tag and one Slow/Rough tag. */
export const aa081MudShieldTerrainApplies = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly recipient: SpawnedPokemon
}): boolean => {
  if (!input.context.queries.abilities.has(input.recipient.id, 'Mud Shield')) return false
  const tags = surfaceTags(input.context, input.recipient)
  const muddy = [...tags].some(tag => tag.includes('mud') || tag.includes('dirt'))
  const difficult = [...tags].some(tag => tag.includes('slow') || tag.includes('rough'))
  return muddy && difficult
}

/** Apply AA-081 effectiveness at the final reviewed type boundary. */
export const aa081DamageTypeOverlay = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly recipientId: string
  readonly resolved: MoveDamageTypeResolution
}): MoveDamageTypeResolution => {
  const actorId = input.context.actor.placement.id
  const recipient = input.context.queries.tokens.get(input.recipientId)
  if (!recipient) return input.resolved
  let passiveMultiplier = input.resolved.passiveMultiplier
  let finalMultiplier = input.resolved.finalMultiplier
  const sources = [...input.resolved.passiveSources]

  if (finalMultiplier !== 0 && input.context.queries.abilities.has(input.recipientId, 'Multiscale')) {
    const maximumHp = Math.max(1, recipient.fullMaxHp ?? recipient.maxHp)
    if (recipient.currentHp >= maximumHp) {
      passiveMultiplier = resistMultiplierOneStepFurther(passiveMultiplier)
      finalMultiplier = resistMultiplierOneStepFurther(finalMultiplier)
      sources.push('Multiscale')
    }
  }

  const outgoingNormalize = input.context.queries.abilities.has(actorId, 'Normalize')
  const incomingNormalize = input.context.queries.abilities.has(input.recipientId, 'Normalize')
  if (finalMultiplier !== 0 && (outgoingNormalize || incomingNormalize)) {
    passiveMultiplier = 1
    finalMultiplier = 1
    if (outgoingNormalize) sources.push('Normalize (attacker)')
    if (incomingNormalize) sources.push('Normalize (defender)')
  }

  return Object.freeze({
    ...input.resolved,
    passiveMultiplier,
    passiveSources: Object.freeze(sources),
    finalMultiplier,
    finalRelation: relation(finalMultiplier),
    immunitySource: finalMultiplier === 0 ? input.resolved.immunitySource : null,
  })
}

export const aa081MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly script: MoveAutomationScript
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: MoveDamageTypeResolution
  readonly damageClass: 'physical' | 'special'
}): readonly MoveDamageModifier[] => {
  const modifiers: MoveDamageModifier[] = []
  const actorAbilities = input.context.queries.abilities.activeForPlacement(input.actor.id)
  const suffix = shortHash(input.operation.id, input.actor.id, input.recipient.id)

  const neuroforce = actorAbilities.find(ability => ability.canonicalId === 'Neuroforce')
  if (neuroforce && input.moveType.finalMultiplier > 1) modifiers.push({
    id: `ability.aa081.neuroforce.${suffix}`,
    stage: 'pre-type-modifiers', priority: 46,
    source: { kind: 'ability', id: neuroforce.instanceId },
    stackingGroup: `aa081-neuroforce:${neuroforce.instanceId}`,
    reasonCode: 'ability.neuroforce.super-effective-damage',
    operation: 'add', value: 10,
  })

  const nimble = actorAbilities.find(ability => ability.canonicalId === 'Nimble Strikes')
  if (nimble
    && input.damageClass === 'physical'
    && input.moveType.moveType.trim().toLowerCase() === 'normal') {
    modifiers.push({
      id: `ability.aa081.nimble-strikes.${suffix}`,
      stage: 'pre-type-modifiers', priority: 47,
      source: { kind: 'ability', id: nimble.instanceId },
      stackingGroup: `aa081-nimble-strikes:${nimble.instanceId}`,
      reasonCode: 'ability.nimble-strikes.speed-damage',
      operation: 'add', value: Math.floor(Math.max(0, input.actor.spd ?? 0) / 2),
    })
  }

  const mudShield = input.context.queries.abilities.activeForPlacement(input.recipient.id)
    .find(ability => ability.canonicalId === 'Mud Shield')
  if (mudShield && aa081MudShieldTerrainApplies({ context: input.context, recipient: input.recipient })) {
    modifiers.push({
      id: `ability.aa081.mud-shield.${suffix}`,
      stage: 'post-damage-modifiers', priority: 40,
      source: { kind: 'ability', id: mudShield.instanceId },
      stackingGroup: `aa081-mud-shield:${mudShield.instanceId}`,
      reasonCode: 'ability.mud-shield.terrain-damage-reduction',
      operation: 'subtract', value: 5,
    })
  }

  return Object.freeze(modifiers)
}
