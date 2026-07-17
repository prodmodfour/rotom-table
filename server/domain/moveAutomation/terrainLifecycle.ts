import { createHash } from 'node:crypto'
import {
  parseMoveEffectOperation,
  type MoveEffectOperation,
  type MoveHealEffectOperation,
} from '#shared/moveAutomation/effects'
import type { EncounterState } from '#shared/moveAutomation/encounterState'
import {
  isEncounterGlobalFieldZone,
  isEncounterGlobalFieldZoneActive,
} from '#shared/moveAutomation/encounterZones'
import {
  GRASSY_TERRAIN_TURN_HEAL_PERCENT,
} from '#shared/moveAutomation/terrain'
import type { TabletopMap } from '~/types/map'
import { projectBattlefieldZones } from './battlefieldZones'
import type { AuthoritativeMoveRulesContext } from './context'
import type { EncounterLifecycleTriggerHandler } from './reduceLifecycle'

export const GRASSY_TERRAIN_LIFECYCLE_HANDLER_ID =
  'handler.grassy-terrain-turn-healing' as const
export const GRASSY_TERRAIN_HEAL_REASON_CODE =
  'terrain.grassy.turn-start-healing' as const

const operationId = (eventId: string): string => `terrain.grassy.healing.${createHash('sha256')
  .update(`${eventId}\u0000${GRASSY_TERRAIN_HEAL_REASON_CODE}`)
  .digest('hex')
  .slice(0, 32)}`

const healingOperation = (eventId: string): MoveHealEffectOperation => parseMoveEffectOperation({
  id: operationId(eventId),
  kind: 'heal',
  source: { kind: 'lifecycle-event', id: eventId },
  recipients: { kind: 'actor' },
  phase: 'cleanup',
  reasonCode: GRASSY_TERRAIN_HEAL_REASON_CODE,
  payload: {
    mode: 'gain',
    pool: 'hit-points',
    calculation: {
      kind: 'percent-max',
      percent: GRASSY_TERRAIN_TURN_HEAL_PERCENT,
    },
    bounds: { minimum: null, maximum: null },
    rounding: 'floor',
    injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  },
}, 'terrain.grassy.turnHealing') as MoveHealEffectOperation

const activeGrassyTerrain = (state: EncounterState): boolean => state.zones.some(zone => (
  zone.kind === 'terrain'
  && zone.payload.terrainId === 'grassy'
  && (!isEncounterGlobalFieldZone(zone) || isEncounterGlobalFieldZoneActive(zone))
))

/**
 * Materialize the built-in Grassy Terrain start-turn trigger. The initiative
 * planner supplies materialized global fields, so the handler's current state
 * observes suppression, expiry, and local zones in event order.
 */
export const createGrassyTerrainLifecycleHandler = (
  map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
): EncounterLifecycleTriggerHandler | null => {
  const retainedGrassy = projectBattlefieldZones(map).zones.some(zone => (
    zone.kind === 'terrain' && zone.payload.terrainId === 'grassy'
  ))
  if (!retainedGrassy) return null

  return Object.freeze({
    id: GRASSY_TERRAIN_LIFECYCLE_HANDLER_ID,
    resolve: ({ event, state }: Parameters<EncounterLifecycleTriggerHandler['resolve']>[0]) => {
      if (event.kind !== 'turn-start' || !activeGrassyTerrain(state)) return []
      return [{
        effectId: null,
        reasonCode: `${GRASSY_TERRAIN_HEAL_REASON_CODE}-trigger`,
        operations: [healingOperation(event.eventId)],
        emittedEvents: [],
      }]
    },
  })
}

/** Match only server-materialized Grassy Terrain lifecycle work. */
export const isGrassyTerrainHealingOperation = (
  operation: MoveEffectOperation,
): operation is MoveHealEffectOperation => (
  operation.kind === 'heal'
  && operation.reasonCode === GRASSY_TERRAIN_HEAL_REASON_CODE
  && operation.id.startsWith('terrain.grassy.healing.')
)

/**
 * Narrow the event actor through fresh authoritative grounding and complete
 * footprint geometry. Empty recipients retain a traced lifecycle no-op.
 */
export const terrainLifecycleRecipientIds = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveEffectOperation
  readonly candidateRecipientIds: readonly string[]
}): readonly string[] => {
  if (!isGrassyTerrainHealingOperation(input.operation)) {
    return [...input.candidateRecipientIds]
  }
  return input.candidateRecipientIds.filter(placementId => (
    input.context.queries.terrain.turnHealing({ placementId }).applies
  ))
}
