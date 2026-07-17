import { createHash } from 'node:crypto'
import type {
  EncounterZoneCell,
  EncounterZoneId,
} from '#shared/moveAutomation/encounterZones'
import type {
  MoveEffectHazardZoneKind,
} from '#shared/moveAutomation/effects'
import type { EncounterSideId } from '#shared/moveAutomation/encounterState'
import {
  compareMoveHazardCellSelectionCells,
  moveHazardCellSelectionCellKey,
} from '#shared/moveAutomation/hazardCellSelection'

/**
 * Stable identity for one side-owned layered hazard/pledge geometry. Ownership
 * is part of identity so transfer and side-swap operations cannot leave stale
 * aliases behind.
 */
export const battlefieldLayeredZoneId = (input: {
  readonly kind: MoveEffectHazardZoneKind
  readonly familyId: string
  readonly sideId: EncounterSideId | null
  readonly cells: readonly EncounterZoneCell[]
}): EncounterZoneId => {
  const cells = [...input.cells]
    .sort(compareMoveHazardCellSelectionCells)
    .map(moveHazardCellSelectionCellKey)
    .join('|')
  const digest = createHash('sha256')
    .update(`${input.kind}\u0000${input.familyId}\u0000${input.sideId ?? 'neutral'}\u0000${cells}`, 'utf8')
    .digest('hex')
    .slice(0, 32)
  return `zone.${input.kind}.${digest}`
}
