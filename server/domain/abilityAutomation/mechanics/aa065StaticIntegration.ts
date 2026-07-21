import { createHash } from 'node:crypto'
import pokedexData from '~~/data/reference/pokedex.json'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { EncounterCapabilityEffect } from '#shared/moveAutomation/encounterEffects'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import { gridFootprintCells } from '~/utils/gridGeometry'
import { getMaterialDefinition } from '~/utils/mapMaterials'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { PokedexRecord } from '~/types/pokemon'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import {
  authoritativeAbilityHealingBlocked,
  CRUELTY_HEALING_BLOCK_CAPABILITY_ID,
} from '../healingPrevention'

export const AA065_CRUELTY_HEALING_BLOCK_CAPABILITY_ID = CRUELTY_HEALING_BLOCK_CAPABILITY_ID

const POKEDEX_BY_SPECIES = new Map(
  (pokedexData as PokedexRecord[]).map(entry => [entry.species.trim().toLowerCase(), entry]),
)

const HABITAT_TAGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  arctic: ['snow', 'ice', 'cryo'],
  beach: ['shoreline', 'sand', 'water'],
  cave: ['cave', 'stone', 'shadow', 'burrow'],
  desert: ['desert', 'sand', 'scrub', 'dirt'],
  forest: ['grove', 'grass', 'leaf', 'organic'],
  'fresh water': ['water', 'river', 'wetland', 'shoreline'],
  freshwater: ['water', 'river', 'wetland', 'shoreline'],
  grassland: ['grass', 'meadow', 'flowers', 'scrub'],
  marsh: ['wetland', 'mud', 'peat', 'muck', 'silt'],
  mountain: ['stone', 'cave', 'thermal', 'gravel'],
  mountian: ['stone', 'cave', 'thermal', 'gravel'],
  moutnain: ['stone', 'cave', 'thermal', 'gravel'],
  ocean: ['water', 'deep', 'shoreline'],
  plains: ['grass', 'meadow', 'scrub'],
  rainforest: ['grove', 'grass', 'leaf', 'organic', 'wetland'],
  taiga: ['snow', 'ice', 'grove', 'leaf'],
  tundra: ['snow', 'ice', 'cryo'],
  urban: ['airship', 'facility', 'floor', 'tile', 'metal', 'nursery'],
  wetland: ['wetland', 'mud', 'peat', 'muck', 'silt', 'water'],
})

const naturalHabitatTags = (token: SpawnedPokemon, canonicalSpecies: string): ReadonlySet<string> => {
  const record = POKEDEX_BY_SPECIES.get(canonicalSpecies.trim().toLowerCase())
  const tags = new Set<string>()
  for (const habitat of record?.habitat ?? []) {
    for (const tag of HABITAT_TAGS[habitat.trim().toLowerCase()] ?? []) tags.add(tag)
  }
  const naturewalk = token.ruleCapabilities?.naturewalk
  if (naturewalk) {
    for (const habitat of naturewalk.split(',').map(value => value.trim().toLowerCase())) {
      for (const tag of HABITAT_TAGS[habitat] ?? []) tags.add(tag)
    }
  }
  return tags
}

const supportingTerrainTags = (
  map: Pick<TabletopMap, 'voxels'>,
  token: SpawnedPokemon,
): ReadonlySet<string> => {
  const footprint = gridFootprintCells(token.position, token)
  const horizontal = new Set(footprint.map(cell => `${cell.x}:${cell.z}`))
  const topByCell = new Map<string, TabletopMap['voxels'][number]>()
  for (const voxel of map.voxels) {
    const key = `${voxel.x}:${voxel.z}`
    if (!horizontal.has(key) || voxel.y > token.position.y) continue
    const current = topByCell.get(key)
    if (!current || voxel.y > current.y) topByCell.set(key, voxel)
  }
  const tags = new Set<string>()
  for (const voxel of topByCell.values()) {
    const definition = getMaterialDefinition(voxel.materialId)
    for (const tag of [...(definition.tags ?? []), ...(voxel.tags ?? [])]) {
      const normalized = tag.trim().toLowerCase()
      if (normalized) tags.add(normalized)
    }
  }
  return tags
}

/** Covert is active only while an effective owner physically stands on matching map material. */
export const aa065CovertEvasionBonus = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
}): number => {
  if (!input.context.queries.abilities.has(input.placementId, 'Covert')) return 0
  const token = input.context.queries.tokens.get(input.placementId)
  const placement = input.context.queries.placements.get(input.placementId)
  const resolved = placement ? input.context.queries.sheets.forPlacement(placement) : null
  const canonicalSpecies = resolved?.kind === 'pokemon'
    ? (resolved.sheet as { readonly species?: string }).species?.trim() ?? ''
    : ''
  if (!token || token.entityKind !== 'pokemon' || !canonicalSpecies) return 0
  const habitatTags = naturalHabitatTags(token, canonicalSpecies)
  if (habitatTags.size === 0) return 0
  const terrainTags = supportingTerrainTags(input.context.map, token)
  return [...terrainTags].some(tag => habitatTags.has(tag)) ? 2 : 0
}

/** Courage contributes both sides of its exact low-HP damage rule. */
export const aa065CourageDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
}): readonly MoveDamageModifier[] => {
  const modifiers: MoveDamageModifier[] = []
  const actorMaximum = Math.max(1, input.actor.fullMaxHp ?? input.actor.maxHp)
  const actorCourage = input.context.queries.abilities.activeForPlacement(input.actor.id)
    .find(ability => ability.canonicalId === 'Courage')
  if (input.actor.currentHp * 3 <= actorMaximum && actorCourage) {
    modifiers.push({
      id: `ability.courage.damage.${input.operation.id}.${input.recipient.id}`,
      stage: 'pre-type-modifiers', priority: 35,
      source: { kind: 'ability', id: actorCourage.instanceId }, stackingGroup: 'aa065-courage-damage',
      reasonCode: 'ability.courage.low-hp-damage-bonus', operation: 'add', value: 5,
    })
  }
  const recipientMaximum = Math.max(1, input.recipient.fullMaxHp ?? input.recipient.maxHp)
  const recipientCourage = input.context.queries.abilities.activeForPlacement(input.recipient.id)
    .find(ability => ability.canonicalId === 'Courage')
  if (input.recipient.currentHp * 3 <= recipientMaximum && recipientCourage) {
    modifiers.push({
      id: `ability.courage.reduction.${input.operation.id}.${input.recipient.id}`,
      stage: 'post-damage-modifiers', priority: 35,
      source: { kind: 'ability', id: recipientCourage.instanceId }, stackingGroup: 'aa065-courage-reduction',
      reasonCode: 'ability.courage.low-hp-damage-reduction', operation: 'subtract', value: 5,
    })
  }
  return Object.freeze(modifiers)
}

const dampRollId = (operationId: string, recipientId: string): string => (
  `ability.damp.${createHash('sha256')
    .update(`${operationId}\u0000${recipientId}`)
    .digest('hex')
    .slice(0, 32)}`
)

/** Roll Damp's supplemental Water die once for each authoritative damage roll. */
export const primeAa065MoveRandomness = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly damageOperationIds: readonly string[]
  readonly damageRecipientId?: string
}): void => {
  if (!input.damageRecipientId
    || input.script.type.trim().toLowerCase() !== 'water'
    || !input.context.queries.abilities.has(input.context.actor.placement.id, 'Damp')) return
  for (const operationId of input.damageOperationIds) {
    const rollId = dampRollId(operationId, input.damageRecipientId)
    if (input.context.random.snapshot().some(entry => entry.rollId === rollId)) continue
    input.context.random.roll({
      rollId, parentEffectId: operationId, reason: 'ability.damp.water-damage-bonus',
      formula: { kind: 'dice', count: 1, sides: 10, modifier: 0 },
    })
  }
}

export const aa065DampDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: string
}): readonly MoveDamageModifier[] => {
  const damp = input.context.queries.abilities.activeForPlacement(input.actor.id)
    .find(ability => ability.canonicalId === 'Damp')
  if (!damp || input.moveType.trim().toLowerCase() !== 'water') return Object.freeze([])
  const value = input.context.random.snapshot()
    .find(entry => entry.rollId === dampRollId(input.operation.id, input.recipient.id))?.finalValue ?? 0
  return Object.freeze([{
    id: `ability.damp.damage.${input.operation.id}.${input.recipient.id}`,
    stage: 'pre-type-modifiers', priority: 35,
    source: { kind: 'ability', id: damp.instanceId }, stackingGroup: 'aa065-damp-water',
    reasonCode: 'ability.damp.water-damage-bonus', operation: 'add', value,
  }])
}

/** Resolve the nearest effective Damp provider without revealing its identity to clients. */
export const aa065DampPrevents = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly subjectPlacementId: string
}): boolean => {
  const subject = input.context.queries.tokens.get(input.subjectPlacementId)
  if (!subject) return false
  return input.context.queries.placements.all().some(placement => {
    if (!input.context.queries.abilities.has(placement.id, 'Damp')) return false
    const provider = input.context.queries.tokens.get(placement.id)
    return Boolean(provider && ptuGridDistanceBetweenFootprints(provider, subject) <= 10)
  })
}

export const aa065DampCancelsMove = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName'>
}): boolean => ['Self-Destruct', 'Explosion'].includes(input.script.moveName)
  && aa065DampPrevents({ context: input.context, subjectPlacementId: input.context.actor.placement.id })

export const aa065CrueltyHealingBlocked = (input: {
  readonly context: Pick<AuthoritativeMoveRulesContext, 'map'>
  readonly placementId: string
}): boolean => authoritativeAbilityHealingBlocked({
  map: input.context.map,
  placementId: input.placementId,
})

/** An accepted Take a Breather action ends only matching Cruelty healing blocks on its actor. */
export const cleanupAa065CrueltyHealingBlockForBreather = (input: {
  readonly map: TabletopMap
  readonly placementId: string
}): TabletopMap => {
  const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const effects = encounter.effects.filter(effect => !(
    effect.kind === 'capability'
    && effect.payload.capabilityId === AA065_CRUELTY_HEALING_BLOCK_CAPABILITY_ID
    && effect.affected.placementIds.includes(input.placementId)
  ))
  if (effects.length === encounter.effects.length) return input.map
  return {
    ...input.map,
    encounterState: parseEncounterState({ ...encounter, effects }),
  }
}

export const aa065CrueltyHealingBlockDefinition = (): Omit<EncounterCapabilityEffect, 'id' | 'source' | 'affected' | 'createdRound' | 'createdTurn'> => ({
  kind: 'capability', duration: { kind: 'scene', remaining: null }, stacks: 1, charges: null,
  stackPolicy: { kind: 'refresh', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
  tags: ['ability', 'aa065', 'cruelty', 'healing-blocked'],
  payload: { capabilityId: AA065_CRUELTY_HEALING_BLOCK_CAPABILITY_ID, action: 'grant' },
  dispel: { policy: 'matching-tags', tags: ['cruelty', 'healing-blocked'] },
  transferPolicy: 'expire', suppression: { sources: [] },
})
