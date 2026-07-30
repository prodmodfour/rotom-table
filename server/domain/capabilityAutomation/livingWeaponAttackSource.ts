import { createHash } from 'node:crypto'
import {
  MOVE_ATTACK_SOURCE_ID_PREFIX,
  type MoveAttackSourceId,
} from '#shared/moveAutomation/attackSource'
import type { CapabilityLinkState } from '#shared/capabilityAutomation/state'

/** Bounded public label shared by map and Move-offer projection. */
export const livingWeaponAttackSourceLabel = (
  displayName: string,
  attackSourceId: MoveAttackSourceId,
): string => `${displayName.trim().slice(0, 90) || 'Living Weapon'} Living Weapon · ${attackSourceId.slice(-6)}`

/**
 * Produce a stable, opaque selector for one actor and one exact Living Weapon
 * link incarnation. Re-engagement changes sourceOperationId and therefore the
 * selector. Raw link and Capability authority never cross the client boundary.
 */
export const livingWeaponAttackSourceId = (input: {
  readonly mapSlug: string
  readonly actingPlacementId: string
  readonly link: CapabilityLinkState
}): MoveAttackSourceId => {
  const digest = createHash('sha256').update(JSON.stringify({
    version: 1,
    mapSlug: input.mapSlug,
    actingPlacementId: input.actingPlacementId,
    link: {
      id: input.link.id,
      kind: input.link.kind,
      ownerPlacementId: input.link.ownerPlacementId,
      participantPlacementIds: [...input.link.participantPlacementIds],
      capabilityInstanceId: input.link.capabilityInstanceId,
      canonicalId: input.link.canonicalId,
      sourceOperationId: input.link.sourceOperationId,
    },
  })).digest('hex')
  return `${MOVE_ATTACK_SOURCE_ID_PREFIX}${digest}`
}
