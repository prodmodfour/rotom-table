import type { MoveExpressionStat } from '#shared/moveAutomation/expressions'
import type { EncounterZoneSource } from '#shared/moveAutomation/encounterZones'
import type { EncounterSideId } from '#shared/moveAutomation/encounterState'
import type { InitiativeOrderDirection } from '#shared/initiativeOrder'
import type {
  MapFieldEffects,
  MapRoomKind,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'
import { cloneMapFieldEffects } from '~/utils/mapFieldEffects'
import { isMapRoomKind } from '~/utils/mapFieldEffectDefinitions'
import { queryBattlefieldZones } from './battlefieldZones'
import type { MoveAutomationStatOverlay } from './stats'

export interface AuthoritativeRoomInstance {
  readonly kind: MapRoomKind
  readonly zoneId: string
  readonly source: EncounterZoneSource
  /** Accepted source-side ownership; battlefield mechanics remain field-wide. */
  readonly sideId: EncounterSideId | null
}

export interface MoveAutomationRoomResolver {
  /** Active native-plus-compatibility Rooms in authoritative map order. */
  active(): readonly AuthoritativeRoomInstance[]
  /** Calculated order only; callers must preserve a complete GM-authored order. */
  calculatedInitiativeDirection(): InitiativeOrderDirection
  /** Map a requested stat through active non-destructive Room overlays. */
  statOverlay(input: {
    readonly placement: Pick<SheetPlacement, 'sheetKind'>
    readonly stat: MoveExpressionStat
  }): MoveAutomationStatOverlay | null
  /** Replace only the compatibility Room lane with active mechanics contributors. */
  projectFieldEffects(base?: MapFieldEffects | null): Required<MapFieldEffects>
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const activeRoomInstances = (
  map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
): readonly AuthoritativeRoomInstance[] => {
  const seenKinds = new Set<MapRoomKind>()
  const rooms: AuthoritativeRoomInstance[] = []
  for (const zone of queryBattlefieldZones(
    map,
    { kind: 'battlefield' },
    { kinds: ['room'] },
  )) {
    if (zone.kind !== 'room' || !isMapRoomKind(zone.payload.roomId)) continue
    if (seenKinds.has(zone.payload.roomId)) continue
    seenKinds.add(zone.payload.roomId)
    rooms.push({
      kind: zone.payload.roomId,
      zoneId: zone.id,
      source: zone.source,
      sideId: zone.sideId,
    })
  }
  return deepFreeze(rooms)
}

/**
 * Build one immutable query over active Rooms. Delayed and suppressed native
 * Rooms shadow their compatibility rows through the battlefield-zone query but
 * do not contribute mechanics until active.
 */
export const createMoveAutomationRoomResolver = (
  map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
): MoveAutomationRoomResolver => {
  const active = activeRoomInstances(map)
  const byKind = new Map(active.map(room => [room.kind, room]))

  return Object.freeze({
    active: () => active,
    calculatedInitiativeDirection: () => (
      byKind.has('trick') ? 'lowest-first' : 'highest-first'
    ),
    statOverlay: (input: {
      readonly placement: Pick<SheetPlacement, 'sheetKind'>
      readonly stat: MoveExpressionStat
    }): MoveAutomationStatOverlay | null => {
      const wonder = byKind.get('wonder') ?? null
      if (
        !wonder
        || input.placement.sheetKind !== 'pokemon'
        || (input.stat !== 'defense' && input.stat !== 'special-defense')
      ) return null
      return deepFreeze({
        sourceStat: input.stat === 'defense' ? 'special-defense' : 'defense',
        sourceId: wonder.zoneId,
        reasonCode: 'room.wonder.defenses-switched',
      })
    },
    projectFieldEffects: (base: MapFieldEffects | null = map.fieldEffects ?? null) => {
      const projected = cloneMapFieldEffects(base)
      projected.rooms = active.map(room => ({
        kind: room.kind,
        ...(room.kind === 'trick' ? { startsNextRound: false } : {}),
        source: room.zoneId,
      }))
      return deepFreeze(projected)
    },
  })
}
