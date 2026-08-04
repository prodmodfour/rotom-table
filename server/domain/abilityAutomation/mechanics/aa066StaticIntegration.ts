import { createHash } from 'node:crypto'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import type { EncounterCapabilityEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { MoveDamageModifier } from '~/utils/moveAutomationDamagePipeline'
import { computeFullMaxHp, resolveStats } from '~/utils/sheets/pokemonDerived'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'
import { aa061AuraBonusMultiplier } from './aa061MoveIntegration'
import { projectAuthoritativeEffectiveAbilities } from '../effectiveAbilities'
import { resolveSheetAndEdgeAbilityInstances } from '../../edgeAutomation/permanentGrants'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../registry'

export const AA066_DAZZLING_CAPABILITY_ID = 'aa066.dazzling.priority-and-initiative-block' as const
const DANCE_MOVE_IDS = new Set([
  'Victory Dance', 'Quiver Dance', 'Dragon Dance', 'Feather Dance',
  'Swords Dance', 'Teeter Dance', 'Lunar Dance', 'Rain Dance',
])

const maximumHp = (token: SpawnedPokemon): number => Math.max(1, token.fullMaxHp ?? token.maxHp)

export const aa066IsStatusDanceMove = (
  script: Pick<MoveAutomationScript, 'moveName' | 'damageClass'>,
): boolean => script.damageClass === 'Status' && DANCE_MOVE_IDS.has(script.moveName)

/** Aggregate each effective Dark Aura provider through current relationships and Aura Break inversion. */
export const aa066DarkAuraDamageBaseBonus = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly moveType: string
}): number => {
  if (input.moveType.trim().toLowerCase() !== 'dark') return 0
  const actorId = input.context.actor.placement.id
  const providers = input.context.queries.placements.all()
    .filter(placement => input.context.queries.abilities.has(placement.id, 'Dark Aura'))
    .filter(placement => placement.id === actorId
      || input.context.queries.relationships.resolve(actorId, placement.id).relationship === 'ally')
    .sort((left, right) => left.id.localeCompare(right.id))
  return providers.reduce((total, provider) => total + aa061AuraBonusMultiplier({
    context: input.context,
    sourcePlacementId: provider.id,
    sourceCanonicalId: 'Dark Aura',
  }), 0)
}

export const aa066MoveDamageModifiers = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly actor: SpawnedPokemon
  readonly recipient: SpawnedPokemon
  readonly moveType: string
}): readonly MoveDamageModifier[] => {
  const modifiers: MoveDamageModifier[] = []
  const hp = Math.max(0, input.actor.currentHp)
  const maxHp = maximumHp(input.actor)
  const darkArt = input.context.queries.abilities.activeForPlacement(input.actor.id)
    .find(ability => ability.canonicalId === 'Dark Art')
  if (input.moveType.trim().toLowerCase() === 'dark'
    && hp * 3 <= maxHp
    && darkArt) {
    modifiers.push({
      id: `ability.dark-art.damage.${input.operation.id}.${input.recipient.id}`,
      stage: 'pre-type-modifiers', priority: 36,
      source: { kind: 'ability', id: darkArt.instanceId }, stackingGroup: 'aa066-dark-art',
      reasonCode: 'ability.dark-art.last-chance', operation: 'add', value: 5,
    })
  }
  const defeatist = input.context.queries.abilities.activeForPlacement(input.actor.id)
    .find(ability => ability.canonicalId === 'Defeatist')
  if (defeatist) {
    const highHp = hp * 2 > maxHp
    const value = highHp
      ? input.context.random.snapshot().find(entry => (
          entry.rollId === defeatistRollId(input.operation.id, input.recipient.id)
        ))?.finalValue ?? 0
      : -5
    modifiers.push({
      id: `ability.defeatist.damage.${input.operation.id}.${input.recipient.id}`,
      stage: 'pre-type-modifiers', priority: 37,
      source: { kind: 'ability', id: defeatist.instanceId }, stackingGroup: 'aa066-defeatist',
      reasonCode: highHp ? 'ability.defeatist.high-hp-bonus' : 'ability.defeatist.low-hp-penalty',
      operation: 'add', value,
    })
  }
  return Object.freeze(modifiers)
}

const defeatistRollId = (operationId: string, recipientId: string): string => (
  `ability.defeatist.${createHash('sha256')
    .update(`${operationId}\u0000${recipientId}`)
    .digest('hex')
    .slice(0, 32)}`
)

export const primeAa066MoveRandomness = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly damageOperationIds: readonly string[]
  readonly damageRecipientId?: string
}): void => {
  const actor = input.context.actor.token
  if (!input.damageRecipientId
    || !input.context.queries.abilities.has(actor.id, 'Defeatist')
    || Math.max(0, actor.currentHp) * 2 <= maximumHp(actor)) return
  for (const operationId of input.damageOperationIds) {
    const rollId = defeatistRollId(operationId, input.damageRecipientId)
    if (input.context.random.snapshot().some(entry => entry.rollId === rollId)) continue
    input.context.random.roll({
      rollId, parentEffectId: operationId,
      reason: 'ability.defeatist.high-hp-damage-bonus',
      formula: { kind: 'dice', count: 2, sides: 6, modifier: 0 },
    })
  }
}

export const aa066DazzlingAffects = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placementId: string
}): boolean => (input.map.encounterState?.effects ?? []).some(effect => (
  effect.kind === 'capability'
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === AA066_DAZZLING_CAPABILITY_ID
  && effect.suppression.sources.length === 0
  && effect.affected.placementIds.includes(input.placementId)
))

export const aa066DazzlingInitiativePenalty = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placementId: string
}): number => aa066DazzlingAffects(input) ? -10 : 0

export const aa066DazzlingBlocksPriorityMove = aa066DazzlingAffects

export const aa066DazzlingBlocksInterruptMovesAgainst = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly actionSourcePlacementId: string
}): boolean => input.context.queries.abilities.has(input.actionSourcePlacementId, 'Dazzling')

export const aa066DecoyEvasionBonus = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placementId: string
}): number => (input.map.encounterState?.effects ?? []).some(effect => (
  effect.kind === 'capability'
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === 'aa066.decoy.evasion-bonus'
  && effect.suppression.sources.length === 0
  && effect.affected.placementIds.includes(input.placementId)
)) ? 2 : 0

export const aa066DazzlingDefinition = (): Omit<EncounterCapabilityEffect, 'id' | 'source' | 'affected' | 'createdRound' | 'createdTurn'> => ({
  kind: 'capability', duration: { kind: 'scene', remaining: null }, stacks: 1, charges: null,
  stackPolicy: { kind: 'refresh', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
  tags: ['ability', 'aa066', 'dazzling', 'initiative', 'priority-block'],
  // Capability values are unsigned magnitudes; the projection applies this as a -10 penalty.
  payload: { capabilityId: AA066_DAZZLING_CAPABILITY_ID, action: 'grant', value: 10 },
  dispel: { policy: 'matching-tags', tags: ['dazzling', 'priority-block'] },
  transferPolicy: 'expire', suppression: { sources: [] },
})

/** Dynamic Initiative policy for Defeatist, including suppression and exact runtime selection. */
export const aa066DefeatistInitiativeBonus = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet
}): number => {
  const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve('Defeatist')
  if (!runtime) return 0
  const active = projectAuthoritativeEffectiveAbilities({
    baseAbilities: resolveSheetAndEdgeAbilityInstances(input.sheet),
    target: {
      placementId: input.placement.id,
      ...(input.placement.sideId ? { sideId: input.placement.sideId } : {}),
      position: input.placement.position,
    },
    effects: input.map.encounterState?.effects ?? [],
    transformationSnapshots: input.map.encounterState?.abilityTransformations,
  }).some(ability => ability.effective
    && ability.canonicalId === 'Defeatist'
    && (ability.definitionHash === null || ability.definitionHash === runtime.definitionHash))
  if (!active) return 0
  const hpTotal = resolveStats(input.sheet).find(stat => stat.key === 'hp')?.total ?? 0
  const maxHp = Math.max(1, computeFullMaxHp(input.sheet, hpTotal))
  const currentHp = Math.max(0, Math.floor(input.sheet.combat?.currentHp ?? maxHp))
  return currentHp * 2 <= maxHp ? 10 : 0
}
