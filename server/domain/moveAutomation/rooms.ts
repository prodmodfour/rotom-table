import type { MoveExpressionStat } from '#shared/moveAutomation/expressions'
import {
  isEncounterGlobalFieldZone,
  isEncounterGlobalFieldZoneActive,
  type EncounterGlobalFieldSuppressionSource,
  type EncounterGlobalFieldZone,
  type EncounterZoneDuration,
  type EncounterZoneSource,
} from '#shared/moveAutomation/encounterZones'
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

export type AuthoritativeRoomInactiveReason = 'suppressed' | 'starts-next-round'

export interface AuthoritativeRoomInstance {
  readonly kind: MapRoomKind
  readonly zoneId: string
  readonly source: EncounterZoneSource
  /** Accepted source-side ownership; battlefield mechanics remain field-wide. */
  readonly sideId: EncounterSideId | null
  /** Exact authoritative duration and MA-137 lifecycle policy; queries never tick either. */
  readonly duration: EncounterZoneDuration
  readonly priority: number
  readonly replacementGroup: string
  readonly suppressionSources: readonly EncounterGlobalFieldSuppressionSource[]
  readonly active: boolean
  readonly inactiveReason: AuthoritativeRoomInactiveReason | null
}

export interface AuthoritativeRoomState {
  readonly kind: MapRoomKind
  readonly active: boolean
  readonly instance: AuthoritativeRoomInstance | null
  readonly reasonCode:
    | 'room.active'
    | 'room.absent'
    | 'room.suppressed'
    | 'room.starts-next-round'
}

export interface MoveAutomationRoomResolver {
  /** Native-plus-compatibility Rooms, including retained inactive instances. */
  all(): readonly AuthoritativeRoomInstance[]
  /** Active native-plus-compatibility Rooms in authoritative map order. */
  active(): readonly AuthoritativeRoomInstance[]
  /** Presence, lifecycle metadata, and active state for one exact Room kind. */
  state(kind: MapRoomKind): AuthoritativeRoomState
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

type AuthoritativeRoomZone = EncounterGlobalFieldZone & { readonly kind: 'room' }

const roomInactiveReason = (
  zone: AuthoritativeRoomZone,
): AuthoritativeRoomInactiveReason | null => {
  if (zone.fieldPolicy.suppression.sources.length) return 'suppressed'
  if (zone.payload.startsNextRound) return 'starts-next-round'
  return null
}

const authoritativeRoomInstances = (
  map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
): readonly AuthoritativeRoomInstance[] => {
  const candidates: AuthoritativeRoomInstance[] = []
  for (const zone of queryBattlefieldZones(
    map,
    { kind: 'battlefield' },
    { kinds: ['room'], includeInactiveGlobalFields: true },
  )) {
    if (
      zone.kind !== 'room'
      || !isEncounterGlobalFieldZone(zone)
      || !isMapRoomKind(zone.payload.roomId)
    ) continue
    const inactiveReason = roomInactiveReason(zone)
    const instance: AuthoritativeRoomInstance = {
      kind: zone.payload.roomId,
      zoneId: zone.id,
      source: zone.source,
      sideId: zone.sideId,
      duration: zone.duration,
      priority: zone.fieldPolicy.priority,
      replacementGroup: zone.fieldPolicy.replacementGroup,
      suppressionSources: zone.fieldPolicy.suppression.sources,
      active: isEncounterGlobalFieldZoneActive(zone),
      inactiveReason,
    }
    candidates.push(instance)
  }
  const selectedByKind = new Map<MapRoomKind, AuthoritativeRoomInstance>()
  for (const candidate of candidates) {
    const existing = selectedByKind.get(candidate.kind)
    if (!existing || (!existing.active && candidate.active)) {
      selectedByKind.set(candidate.kind, candidate)
    }
  }
  // An active contributor wins over a retained inactive duplicate. Selected
  // contributors otherwise retain their exact authoritative map order.
  return deepFreeze(candidates.filter(candidate => (
    selectedByKind.get(candidate.kind) === candidate
  )))
}

const roomState = (
  kind: MapRoomKind,
  instance: AuthoritativeRoomInstance | null,
): AuthoritativeRoomState => deepFreeze(instance
  ? {
      kind,
      active: instance.active,
      instance,
      reasonCode: instance.active
        ? 'room.active'
        : instance.inactiveReason === 'suppressed'
          ? 'room.suppressed'
          : 'room.starts-next-round',
    }
  : {
      kind,
      active: false,
      instance: null,
      reasonCode: 'room.absent',
    })

/**
 * Build one immutable Room snapshot. Delayed and suppressed native Rooms retain
 * source, ownership, and duration while shadowing compatibility rows; only the
 * active projection contributes to existing Trick/Wonder mechanics.
 */
export const createMoveAutomationRoomResolver = (
  map: Pick<TabletopMap, 'dimensions' | 'hazards' | 'fieldEffects' | 'encounterState'>,
): MoveAutomationRoomResolver => {
  const all = authoritativeRoomInstances(map)
  const active = deepFreeze(all.filter(room => room.active))
  const byKind = new Map(active.map(room => [room.kind, room]))
  const allByKind = new Map(all.map(room => [room.kind, room]))

  return Object.freeze({
    all: () => all,
    active: () => active,
    state: (kind: MapRoomKind) => roomState(kind, allByKind.get(kind) ?? null),
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
