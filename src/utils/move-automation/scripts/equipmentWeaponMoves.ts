import { CAPABILITY_WEAPON_MOVES } from '#shared/capabilityAutomation/weaponMoves'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { buildMoveAutomationScriptFromMoveData } from '~/utils/move-automation/moveData'

/**
 * Presentation scripts for server-authoritative Living Weapon and equipment
 * Move sources. Runtime execution remains owned by the native server specs.
 */
export const REVIEWED_EQUIPMENT_WEAPON_MOVE_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map(
  Object.values(CAPABILITY_WEAPON_MOVES).map(move => [move.name, buildMoveAutomationScriptFromMoveData({
    name: move.name,
    type: move.type,
    frequency: move.frequency,
    ac: move.ac,
    damage_base: move.db,
    damage_class: move.category,
    range: move.range,
    effect: move.effect,
  })]),
)
