import type {
  MoveAutomationItemEffectScope,
  MoveAutomationItemEffectTiming,
} from '#shared/moveAutomation/globalFields'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { EncounterSideId } from '#shared/moveAutomation/encounterState'
import { moveItemEffectBindingId } from '#shared/moveAutomation/itemEffects'
import type { MoveItemReference } from '#shared/moveAutomation/items'
import type { SheetPlacement } from '~/types/map'
import type { MoveAutomationRemainingGlobalFieldResolver } from './remainingGlobalFields'

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
  readonly sourceEffectIds: readonly string[]
  readonly reasonCode:
    | 'item-effect.allowed'
    | 'item-effect.magic-room-suppressed'
    | 'item-effect.encounter-suppressed'
    | 'item-effect.magic-room-exempt'
    | 'item-effect.scope-not-applicable'
    | 'item-effect.placement-unavailable'
}

export interface MoveAutomationItemEffectQuery {
  readonly placementId: string
  readonly scope: MoveAutomationItemEffectScope
  readonly timing: MoveAutomationItemEffectTiming
  /** Exact private identity required for item-binding suppression effects. */
  readonly item?: MoveItemReference
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
 * Build the generic item-contribution suppression seam. Magic Room and active
 * typed item-suppression effects are read-only overlays; neither path unequips
 * or mutates the consulted item.
 */
export const createMoveAutomationItemEffectResolver = (input: {
  readonly placements: readonly SheetPlacement[]
  readonly globalFields: MoveAutomationRemainingGlobalFieldResolver
  readonly effects?: readonly EncounterEffect[]
  /** Item contributions consult their backing sheet even when Magic Room suppresses them. */
  readonly recordSheetRead?: (
    placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
  ) => void
}): MoveAutomationItemEffectResolver => {
  const placements = new Map(input.placements.map(placement => [placement.id, placement]))
  const effects = input.effects ?? []

  const encounterSuppressionIds = (
    query: MoveAutomationItemEffectQuery,
  ): readonly string[] => {
    const blocksBenefit = query.timing === 'static' || query.timing === 'trigger'
    const bindingId = query.item ? moveItemEffectBindingId(query.item) : null
    return effects.flatMap((effect) => {
      if (
        effect.kind !== 'item-suppression'
        || effect.suppression.sources.length > 0
        || !effect.affected.placementIds.includes(query.placementId)
        || (blocksBenefit ? !effect.payload.blocksBenefit : !effect.payload.blocksUse)
      ) return []
      if (effect.payload.scope === 'all-equipped') return [effect.id]
      return bindingId !== null && effect.payload.itemBindingIds.includes(bindingId)
        ? [effect.id]
        : []
    })
  }

  return Object.freeze({
    resolve: (query: MoveAutomationItemEffectQuery): MoveAutomationItemEffectResolution => {
      // The global-field seam owns strict scope/timing validation and the one
      // active/inactive Magic Room projection used by every item consumer.
      const magicRoom = input.globalFields.magicRoom({
        scope: query.scope,
        timing: query.timing,
      })
      const activeField = magicRoom.field.active ? magicRoom.field.instance : null
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
          sourceEffectIds: [],
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
          sourceEffectIds: [],
          reasonCode: 'item-effect.scope-not-applicable',
        })
      }

      input.recordSheetRead?.(placement)
      const sourceEffectIds = encounterSuppressionIds(query)
      if (sourceEffectIds.length > 0) {
        return deepFreeze({
          placementId: placement.id,
          scope: query.scope,
          timing: query.timing,
          outcome: 'suppressed',
          suppressed: true,
          sourceZoneId: null,
          sourceSideId: null,
          sourceEffectIds,
          reasonCode: 'item-effect.encounter-suppressed',
        })
      }
      if (magicRoom.suppressed && activeField) {
        return deepFreeze({
          placementId: placement.id,
          scope: query.scope,
          timing: query.timing,
          outcome: 'suppressed',
          suppressed: true,
          sourceZoneId: activeField.zoneId,
          sourceSideId: activeField.sideId,
          sourceEffectIds: [],
          reasonCode: 'item-effect.magic-room-suppressed',
        })
      }

      return deepFreeze({
        placementId: placement.id,
        scope: query.scope,
        timing: query.timing,
        outcome: 'allowed',
        suppressed: false,
        sourceZoneId: activeField?.zoneId ?? null,
        sourceSideId: activeField?.sideId ?? null,
        sourceEffectIds: [],
        reasonCode: activeField
          ? 'item-effect.magic-room-exempt'
          : 'item-effect.allowed',
      })
    },
  })
}
