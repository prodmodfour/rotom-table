import {
  isEncounterGlobalFieldZone,
  isEncounterGlobalFieldZoneActive,
} from '#shared/moveAutomation/encounterZones'
import type { InitiativeOrderDirection } from '#shared/initiativeOrder'
import type {
  MapFieldEffects,
  MapRoomKind,
  TabletopMap,
} from '~/types/map'
import { isMapRoomKind } from '~/utils/mapFieldEffectDefinitions'

const legacyRoomIsActive = (
  room: NonNullable<MapFieldEffects['rooms']>[number],
): boolean => (
  room.startsNextRound !== true
  && room.rounds !== 0
)

/**
 * Resolve the active Room kinds needed by browser presentation. Native Room
 * identities shadow their compatibility rows even while delayed or suppressed,
 * matching the authoritative battlefield-zone projection.
 */
export const activeEncounterRoomKinds = (
  map: Pick<TabletopMap, 'fieldEffects' | 'encounterState'>,
): ReadonlySet<MapRoomKind> => {
  const nativeKinds = new Set<MapRoomKind>()
  const activeKinds = new Set<MapRoomKind>()
  for (const zone of map.encounterState?.zones ?? []) {
    if (
      !isEncounterGlobalFieldZone(zone)
      || zone.kind !== 'room'
      || !isMapRoomKind(zone.payload.roomId)
    ) continue
    nativeKinds.add(zone.payload.roomId)
    if (isEncounterGlobalFieldZoneActive(zone)) activeKinds.add(zone.payload.roomId)
  }
  for (const room of map.fieldEffects?.rooms ?? []) {
    if (
      isMapRoomKind(room.kind)
      && !nativeKinds.has(room.kind)
      && legacyRoomIsActive(room)
    ) activeKinds.add(room.kind)
  }
  return activeKinds
}

export const encounterCalculatedInitiativeDirection = (
  map: Pick<TabletopMap, 'fieldEffects' | 'encounterState'>,
): InitiativeOrderDirection => (
  activeEncounterRoomKinds(map).has('trick') ? 'lowest-first' : 'highest-first'
)

/** Compatibility projection check used by the retained v1 damage calculator. */
export const mapFieldEffectsHaveActiveRoom = (
  fieldEffects: MapFieldEffects | null | undefined,
  kind: MapRoomKind,
): boolean => (fieldEffects?.rooms ?? []).some(room => (
  room.kind === kind && legacyRoomIsActive(room)
))
