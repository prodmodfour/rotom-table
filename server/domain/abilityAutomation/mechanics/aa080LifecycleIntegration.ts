import { createHash } from 'node:crypto'
import { AA080_MOODY_STAGE_BY_ROLL, type Aa080MoodyRoll } from '#shared/abilityAutomation/aa080'
import type { MoveCombatStageEffectOperation } from '#shared/moveAutomation/effects'
import { parseEncounterState, type EncounterState } from '#shared/moveAutomation/encounterState'
import {
  createEmptyAbilityEntityState,
  type AbilityEntityEntry,
} from '#shared/abilityAutomation/entities'
import {
  AA080_MINI_NOSE_TETHER_METERS,
  aa080EntityIsActive,
  aa080IsMiniNoseEntity,
} from '#shared/abilityAutomation/aa080'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TabletopMap } from '~/types/map'
import { footprintsOverlap, isAnchorWithinBounds } from '~/utils/gridGeometry'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { reduceAbilityEntityCommand } from '../entities'
import type {
  EncounterLifecycleTrigger,
  EncounterLifecycleTriggerHandler,
} from '../../moveAutomation/reduceLifecycle'
import type { AuthoritativeMoveRulesContext } from '../../moveAutomation/context'

export const AA080_MOODY_RAISE_REASON = 'ability.moody.turn-end-raise' as const
export const AA080_MOODY_LOWER_REASON = 'ability.moody.turn-end-lower' as const

const suffix = (eventId: string, placementId: string): string => createHash('sha256')
  .update(`${eventId}\u0000${placementId}\u0000Moody`)
  .digest('hex')
  .slice(0, 24)

const stageOperation = (input: {
  readonly id: string
  readonly eventId: string
  readonly reasonCode: typeof AA080_MOODY_RAISE_REASON | typeof AA080_MOODY_LOWER_REASON
  readonly stage: (typeof AA080_MOODY_STAGE_BY_ROLL)[Aa080MoodyRoll]
  readonly value: 2 | -1
}): MoveCombatStageEffectOperation => ({
  id: input.id,
  kind: 'combat-stage',
  source: { kind: 'lifecycle-event', id: input.eventId },
  recipients: { kind: 'actor' },
  phase: 'cleanup',
  reasonCode: input.reasonCode,
  payload: {
    action: 'modify', stage: input.stage, selectedStage: null,
    value: input.value, stageSource: null, rounding: null,
    applyTypeImmunity: false,
  },
})

export const aa080MoodyLifecycleRecipientIds = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: { readonly reasonCode: string }
  readonly candidateRecipientIds: readonly string[]
}): readonly string[] => (
  input.operation.reasonCode === AA080_MOODY_RAISE_REASON
  || input.operation.reasonCode === AA080_MOODY_LOWER_REASON
)
  ? input.candidateRecipientIds.filter(id => input.context.queries.abilities.has(id, 'Moody'))
  : input.candidateRecipientIds

/** Deterministic, ledger-backed turn-end Moody stage pair. */
const tetherDestination = (input: {
  readonly entity: AbilityEntityEntry
  readonly owner: Parameters<typeof ptuGridDistanceBetweenFootprints>[1]
  readonly movementSpeed: number
  readonly dimensions: TabletopMap['dimensions']
  readonly tokens: readonly SpawnedPokemon[]
  readonly entities: EncounterState['abilityEntities']
}): { readonly x: number; readonly y: number; readonly z: number } => {
  const { entity, owner, movementSpeed } = input
  const candidates = [] as Array<{ readonly x: number; readonly y: number; readonly z: number }>
  for (let y = entity.position.y - movementSpeed; y <= entity.position.y + movementSpeed; y += 1) {
    for (let z = entity.position.z - movementSpeed; z <= entity.position.z + movementSpeed; z += 1) {
      for (let x = entity.position.x - movementSpeed; x <= entity.position.x + movementSpeed; x += 1) {
        const candidate = { x, y, z }
        const inBounds = isAnchorWithinBounds(candidate, {
          base: entity.base, clearance: entity.clearance,
        }, input.dimensions)
        const placementCollision = input.tokens.some(token => footprintsOverlap(
          candidate, entity.base, entity.clearance,
          token.position, token.base, token.clearance,
        ))
        const entityCollision = input.entities?.entries.some(other => (
          other.entityId !== entity.entityId
          && aa080EntityIsActive(other)
          && footprintsOverlap(
            candidate, entity.base, entity.clearance,
            other.position, other.base, other.clearance,
          )
        )) ?? false
        if (inBounds && !placementCollision && !entityCollision
          && ptuGridDistanceBetweenFootprints(entity, { ...entity, position: candidate }) <= movementSpeed) {
          candidates.push(candidate)
        }
      }
    }
  }
  return candidates.sort((left, right) => {
    const leftDistance = ptuGridDistanceBetweenFootprints({ ...entity, position: left }, owner)
    const rightDistance = ptuGridDistanceBetweenFootprints({ ...entity, position: right }, owner)
    return leftDistance - rightDistance
      || left.y - right.y
      || left.z - right.z
      || left.x - right.x
  })[0] ?? { ...entity.position }
}

/** Pull out-of-tether active Mini-Noses toward their conscious owner at turn start. */
export const reconcileAa080MiniNoseTether = (input: {
  readonly state: EncounterState
  readonly eventIdsByOwner: ReadonlyMap<string, string>
  readonly owners: ReadonlyMap<string, SpawnedPokemon>
  readonly dimensions: TabletopMap['dimensions']
  readonly tokens: readonly SpawnedPokemon[]
}): EncounterState => {
  let entities = input.state.abilityEntities ?? createEmptyAbilityEntityState()
  for (const [ownerId, eventId] of [...input.eventIdsByOwner].sort(([left], [right]) => left.localeCompare(right))) {
    const owner = input.owners.get(ownerId)
    if (!owner || owner.currentHp <= 0) continue
    const miniNoses = entities.entries.filter(entity => (
      entity.ownerPlacementId === ownerId
      && aa080IsMiniNoseEntity(entity)
      && aa080EntityIsActive(entity)
      && ptuGridDistanceBetweenFootprints(owner, entity) > AA080_MINI_NOSE_TETHER_METERS
    )).sort((left, right) => left.entityId.localeCompare(right.entityId))
    for (const entity of miniNoses) {
      const destination = tetherDestination({
        entity,
        owner,
        movementSpeed: entity.movementSpeed,
        dimensions: input.dimensions,
        tokens: input.tokens,
        entities,
      })
      entities = reduceAbilityEntityCommand(entities, {
        operationId: `ability.mini-noses.tether.${createHash('sha256')
          .update(`${eventId}\u0000${entity.entityId}\u0000${entity.version}`)
          .digest('hex').slice(0, 24)}`,
        kind: 'move', entityId: entity.entityId,
        expectedVersion: entity.version, position: destination,
      }).state
    }
  }
  return parseEncounterState({ ...input.state, abilityEntities: entities })
}

export const createAa080MoodyLifecycleHandler = (
  moodyPlacementIds: readonly string[],
): EncounterLifecycleTriggerHandler => {
  const owners = new Set(moodyPlacementIds)
  return Object.freeze({
    id: 'handler.ability.aa080.moody',
    resolve: ({ event, random }: Parameters<EncounterLifecycleTriggerHandler['resolve']>[0]): readonly EncounterLifecycleTrigger[] => {
      if (event.kind !== 'turn-end' || !owners.has(event.placementId)) return []
      const idSuffix = suffix(event.eventId, event.placementId)
      const raisedRoll = random.roll({
        rollId: `ability.moody.raise.${idSuffix}`,
        parentEffectId: `ability.moody.turn-end.${idSuffix}`,
        reason: `Moody raised Stat for ${event.placementId}`,
        formula: { kind: 'dice', count: 1, sides: 6, modifier: 0 },
      }).finalValue as Aa080MoodyRoll
      const rawLoweredRoll = random.roll({
        rollId: `ability.moody.lower.${idSuffix}`,
        parentEffectId: `ability.moody.turn-end.${idSuffix}`,
        reason: `Moody lowered Stat for ${event.placementId}`,
        formula: { kind: 'dice', count: 1, sides: 6, modifier: 0 },
      }).finalValue as Aa080MoodyRoll
      const loweredRoll = (rawLoweredRoll === raisedRoll
        ? (rawLoweredRoll % 6) + 1
        : rawLoweredRoll) as Aa080MoodyRoll
      return [{
        effectId: null,
        reasonCode: 'ability.moody.turn-end-trigger',
        operations: [
          stageOperation({
            id: `ability.moody.raise.${idSuffix}`,
            eventId: event.eventId,
            reasonCode: AA080_MOODY_RAISE_REASON,
            stage: AA080_MOODY_STAGE_BY_ROLL[raisedRoll],
            value: 2,
          }),
          stageOperation({
            id: `ability.moody.lower.${idSuffix}`,
            eventId: event.eventId,
            reasonCode: AA080_MOODY_LOWER_REASON,
            stage: AA080_MOODY_STAGE_BY_ROLL[loweredRoll],
            value: -1,
          }),
        ],
        emittedEvents: [],
      }]
    },
  })
}
