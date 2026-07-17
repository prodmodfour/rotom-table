import {
  magicRoomSuppressesItemEffect,
  type MoveAutomationItemEffectScope,
  type MoveAutomationItemEffectTiming,
} from '#shared/moveAutomation/globalFields'
import type { EncounterSideId } from '#shared/moveAutomation/encounterState'
import type { SheetPlacement } from '~/types/map'
import type { MoveAutomationRoomResolver } from './rooms'

export type MoveAutomationItemEffectOutcome =
  | 'allowed'
  | 'suppressed'
  | 'scope-not-applicable'
  | 'placement-unavailable'

export interface MoveAutomationItemEffectResolution {
  readonly placementId: string
  readonly scope: MoveAutomationItemEffectScope
  readonly timing: MoveAutomationItemEffectTiming
  readonly outcome: MoveAutomationItemEffectOutcome
  readonly suppressed: boolean
  readonly sourceZoneId: string | null
  readonly sourceSideId: EncounterSideId | null
  readonly reasonCode:
    | 'item-effect.allowed'
    | 'item-effect.magic-room-suppressed'
    | 'item-effect.magic-room-exempt'
    | 'item-effect.scope-not-applicable'
    | 'item-effect.placement-unavailable'
}

export interface MoveAutomationItemEffectQuery {
  readonly placementId: string
  readonly scope: MoveAutomationItemEffectScope
  readonly timing: MoveAutomationItemEffectTiming
}

export interface MoveAutomationItemEffectResolver {
  /**
   * Resolve whether one server-owned equipment contribution may apply. This
   * query never consumes, activates, equips, or otherwise mutates an item.
   */
  resolve(input: MoveAutomationItemEffectQuery): MoveAutomationItemEffectResolution
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const scopeApplies = (
  placement: SheetPlacement,
  scope: MoveAutomationItemEffectScope,
): boolean => (
  (placement.sheetKind === 'pokemon' && scope === 'pokemon-held')
  || (
    placement.sheetKind === 'trainer'
    && (scope === 'trainer-accessory' || scope === 'trainer-other-equipment')
  )
)

/**
 * Build the generic item-contribution suppression seam. Magic Room is queried
 * from active native-plus-compatibility field state; item identity and inventory
 * mutation remain outside this ticket and arrive through the item resource phase.
 */
export const createMoveAutomationItemEffectResolver = (input: {
  readonly placements: readonly SheetPlacement[]
  readonly rooms: MoveAutomationRoomResolver
  /** Item contributions consult their backing sheet even when Magic Room suppresses them. */
  readonly recordSheetRead?: (
    placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  ) => void
}): MoveAutomationItemEffectResolver => {
  const placements = new Map(input.placements.map(placement => [placement.id, placement]))
  const magicRoom = input.rooms.active().find(room => room.kind === 'magic') ?? null

  return Object.freeze({
    resolve: (query: MoveAutomationItemEffectQuery): MoveAutomationItemEffectResolution => {
      const placement = placements.get(query.placementId) ?? null
      if (!placement) {
        return deepFreeze({
          placementId: query.placementId,
          scope: query.scope,
          timing: query.timing,
          outcome: 'placement-unavailable',
          suppressed: false,
          sourceZoneId: null,
          sourceSideId: null,
          reasonCode: 'item-effect.placement-unavailable',
        })
      }
      if (!scopeApplies(placement, query.scope)) {
        return deepFreeze({
          placementId: placement.id,
          scope: query.scope,
          timing: query.timing,
          outcome: 'scope-not-applicable',
          suppressed: false,
          sourceZoneId: null,
          sourceSideId: null,
          reasonCode: 'item-effect.scope-not-applicable',
        })
      }

      input.recordSheetRead?.(placement)
      const suppressibleScope = query.scope === 'pokemon-held'
        || query.scope === 'trainer-accessory'
      const suppressedByMagicRoomPolicy = magicRoomSuppressesItemEffect(
        query.scope,
        query.timing,
      )
      if (magicRoom && suppressedByMagicRoomPolicy) {
        return deepFreeze({
          placementId: placement.id,
          scope: query.scope,
          timing: query.timing,
          outcome: 'suppressed',
          suppressed: true,
          sourceZoneId: magicRoom.zoneId,
          sourceSideId: magicRoom.sideId,
          reasonCode: 'item-effect.magic-room-suppressed',
        })
      }

      return deepFreeze({
        placementId: placement.id,
        scope: query.scope,
        timing: query.timing,
        outcome: 'allowed',
        suppressed: false,
        sourceZoneId: magicRoom?.zoneId ?? null,
        sourceSideId: magicRoom?.sideId ?? null,
        reasonCode: magicRoom && (!suppressibleScope || !suppressedByMagicRoomPolicy)
          ? 'item-effect.magic-room-exempt'
          : 'item-effect.allowed',
      })
    },
  })
}
