import { createHash } from 'node:crypto'
import {
  parseEncounterEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import { AA075_ICE_FACE_FORM_MARKER_CAPABILITY } from '#shared/abilityAutomation/aa075'
import type { MoveSpecEmittedOperation } from '../../moveAutomation/executeSpec'
import type { TabletopMap } from '~/types/map'

const markerId = (placementId: string, sourceId: string): string => `ability.ice-face.temporary-hp.${createHash('sha256')
  .update(`${placementId}\u0000${sourceId}`)
  .digest('hex').slice(0, 24)}`

export const createAa075IceFaceTemporaryHpMarker = (input: {
  readonly map: TabletopMap
  readonly placementId: string
  readonly sourceOperationId: string
  readonly sourceAbilityInstanceId?: string
}): EncounterEffect => parseEncounterEffect({
  id: markerId(input.placementId, input.sourceAbilityInstanceId ?? input.sourceOperationId),
  kind: 'capability',
  source: {
    operationId: input.sourceOperationId,
    moveId: 'ability.ice-face',
    placementId: input.placementId,
  },
  affected: { placementIds: [input.placementId], sideIds: [], cells: [] },
  createdRound: Math.max(1, input.map.initiative?.round ?? 1),
  createdTurn: Math.max(0, input.map.encounterState?.history.currentTurn?.turn ?? 0),
  duration: { kind: 'scene', remaining: null },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: [
    'ability', 'aa075', 'ice-face', 'temporary-hp',
    ...(input.sourceAbilityInstanceId ? [`ability-instance:${input.sourceAbilityInstanceId}`] : []),
  ],
  payload: { capabilityId: AA075_ICE_FACE_FORM_MARKER_CAPABILITY, action: 'grant' },
  dispel: { policy: 'none', tags: [] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
})

const temporaryHpOperation = (emission: MoveSpecEmittedOperation): boolean => {
  const operation = emission.operation
  return (operation.kind === 'heal' || operation.kind === 'direct-hp')
    && operation.payload.pool === 'temporary-hit-points'
}

const iceFaceMarker = (effect: EncounterEffect): boolean => effect.kind === 'capability'
  && effect.payload.action === 'grant'
  && effect.payload.capabilityId === AA075_ICE_FACE_FORM_MARKER_CAPABILITY

/**
 * Keep Ice Face ownership attached only to the non-stacking Temporary HP pool
 * that it created. Damage may reduce that pool, while a larger pool from any
 * other source replaces it and clears ownership.
 */
export const reconcileAa075IceFaceTemporaryHpOwnershipAfterMove = (input: {
  readonly previousMap: TabletopMap
  readonly nextMap: TabletopMap
  readonly operations: readonly MoveSpecEmittedOperation[]
  /** Exact recipients whose increase is known to come from Ice Face itself. */
  readonly featureOwnedIncreasePlacementIds?: ReadonlySet<string>
}): TabletopMap => {
  const previousEffects = input.previousMap.encounterState?.effects ?? []
  const markerOwners = new Set(previousEffects
    .filter(iceFaceMarker)
    .flatMap(effect => effect.affected.placementIds))
  if (markerOwners.size === 0) return input.nextMap

  const removeOwners = new Set<string>()
  for (const placementId of markerOwners) {
    const previousPool = input.previousMap.temporaryHitPoints?.byPlacementId[placementId] ?? 0
    const nextPool = input.nextMap.temporaryHitPoints?.byPlacementId[placementId] ?? 0
    if (nextPool <= 0) {
      removeOwners.add(placementId)
      continue
    }
    if (nextPool <= previousPool) continue
    if (input.featureOwnedIncreasePlacementIds?.has(placementId)) continue
    const latestGrant = [...input.operations].reverse().find(emission => (
      temporaryHpOperation(emission) && emission.recipientIds.includes(placementId)
    ))
    if (!latestGrant || !latestGrant.operation.reasonCode.startsWith('ability.ice-face.')) {
      removeOwners.add(placementId)
    }
  }
  if (removeOwners.size === 0 || !input.nextMap.encounterState) return input.nextMap
  return {
    ...input.nextMap,
    encounterState: parseEncounterState({
      ...input.nextMap.encounterState,
      effects: input.nextMap.encounterState.effects.filter(effect => !(
        iceFaceMarker(effect)
        && effect.affected.placementIds.some(id => removeOwners.has(id))
      )),
    }),
  }
}
