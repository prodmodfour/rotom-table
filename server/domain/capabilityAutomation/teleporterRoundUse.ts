import type { TabletopMap } from '~/types/map'

export interface TeleporterRoundIdentity {
  readonly sceneId: string
  readonly round: number
}

export class TeleporterRoundIdentityError extends Error {
  readonly code = 'teleport-round-identity-required'

  constructor() {
    super('Combat Teleporter use requires authoritative encounter-history Scene and round identities.')
    this.name = 'TeleporterRoundIdentityError'
  }
}

const combatRoundIsActive = (map: TabletopMap): boolean => (
  typeof map.initiative?.activeId === 'string'
  || (map.encounterState?.history.sceneId !== null
    && map.encounterState?.history.sceneId !== undefined)
  || (map.encounterState?.history.currentRound !== null
    && map.encounterState?.history.currentRound !== undefined)
)

/** History is the only identity authority; mutable scene/initiative fields never key uses. */
export const teleporterRoundIdentity = (map: TabletopMap): TeleporterRoundIdentity | null => {
  if (!combatRoundIsActive(map)) return null
  const sceneId = map.encounterState?.history.sceneId
  const round = map.encounterState?.history.currentRound
  if (typeof sceneId !== 'string' || !sceneId.trim()
    || !Number.isSafeInteger(round) || (round ?? 0) < 1) {
    throw new TeleporterRoundIdentityError()
  }
  return { sceneId, round: round! }
}

interface TeleporterRoundUseRecord {
  readonly placementId: string
  readonly sceneId: string
  readonly round: number
  readonly sourceOperationId: string
}

const records = (map: TabletopMap): readonly TeleporterRoundUseRecord[] => (
  Array.isArray(map.metadata?.capabilityTeleportRoundUses)
    ? map.metadata.capabilityTeleportRoundUses.flatMap((raw): readonly TeleporterRoundUseRecord[] => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
        const record = raw as Record<string, unknown>
        return typeof record.placementId === 'string'
          && typeof record.sceneId === 'string'
          && Number.isSafeInteger(record.round)
          && typeof record.sourceOperationId === 'string'
          ? [{
              placementId: record.placementId,
              sceneId: record.sceneId,
              round: record.round as number,
              sourceOperationId: record.sourceOperationId,
            }]
          : []
      })
    : []
)

export const teleporterRoundUseSpent = (input: {
  readonly map: TabletopMap
  readonly placementId: string
  readonly identity: TeleporterRoundIdentity
}): boolean => records(input.map).some(record => (
  record.placementId === input.placementId
  && record.sceneId === input.identity.sceneId
  && record.round === input.identity.round
))

/** Append one bounded, operation-idempotent successful use. */
export const recordTeleporterRoundUse = (input: {
  readonly map: TabletopMap
  readonly placementId: string
  readonly identity: TeleporterRoundIdentity | null
  readonly sourceOperationId: string
}): TabletopMap => {
  if (input.identity === null) return input.map
  const retained = records(input.map).filter(record => (
    record.sourceOperationId !== input.sourceOperationId
    && !(record.placementId === input.placementId
      && record.sceneId === input.identity!.sceneId
      && record.round === input.identity!.round)
  ))
  return {
    ...input.map,
    metadata: {
      ...(input.map.metadata ?? {}),
      capabilityTeleportRoundUses: [...retained.slice(-255), {
        placementId: input.placementId,
        sceneId: input.identity.sceneId,
        round: input.identity.round,
        sourceOperationId: input.sourceOperationId,
      }],
    },
  }
}
