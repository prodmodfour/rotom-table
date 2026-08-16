import { createHash } from 'node:crypto'
import {
  parseEncounterEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import type { SheetPlacement } from '~/types/map'

export const ITEM_DIGESTION_EFFECT_TAG = 'item-digestion-buff-healing' as const
export const ITEM_DIGESTION_SHEET_TAG_PREFIX = 'item-digestion-sheet:' as const
export const ITEM_DIGESTION_SOURCE_TAG_PREFIX = 'item-digestion-source:' as const

const suffix = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 32)

export const itemDigestionSheetTag = (
  placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>,
): string => `${ITEM_DIGESTION_SHEET_TAG_PREFIX}${suffix(`${placement.sheetKind}:${placement.sheetSlug}`)}`

export const itemDigestionSourceTag = (canonicalItemId: string): string => (
  `${ITEM_DIGESTION_SOURCE_TAG_PREFIX}${suffix(canonicalItemId)}`
)

/**
 * Rebind a retained, sheet-owned Snack effect when that exact sheet is sent out
 * under a new placement identity. Effects for other sheets remain untouched.
 */
export const rebindItemDigestionEffectsForPlacement = (input: {
  readonly effects: readonly EncounterEffect[]
  readonly placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'>
}): readonly EncounterEffect[] => input.effects.map((effect) => {
  if (!effect.tags.includes(ITEM_DIGESTION_EFFECT_TAG)
    || !effect.tags.includes(itemDigestionSheetTag(input.placement))) return effect
  if (effect.kind !== 'capability'
    || effect.duration.kind !== 'encounter'
    || effect.affected.placementIds.length !== 1
    || effect.affected.sideIds.length !== 0
    || effect.affected.cells.length !== 0) {
    throw new Error(`Digestion effect ${effect.id} has invalid sheet-owned encounter scope.`)
  }
  const previousPlacementId = effect.affected.placementIds[0]!
  if (previousPlacementId === input.placement.id && effect.source.placementId === input.placement.id) return effect
  if (effect.source.placementId !== previousPlacementId) {
    throw new Error(`Digestion effect ${effect.id} has inconsistent source and target placement authority.`)
  }
  return parseEncounterEffect({
    ...effect,
    source: { ...effect.source, placementId: input.placement.id },
    affected: { ...effect.affected, placementIds: [input.placement.id] },
  }, `itemDigestionRebind.${effect.id}`)
})
