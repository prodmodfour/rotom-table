import type { PokemonCatalogEntry } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const METRE_HEIGHT_PATTERN = /^([0-9]+(?:[.,][0-9]+)?)\s*(?:m|metres?|meters?)?$/i
const TRAINER_TALL_CLEARANCE_THRESHOLD_METRES = 1.5

export const parseTrainerSheetHeightMetres = (height: TrainerSheet['height']): number | null => {
  if (typeof height === 'number') {
    return Number.isFinite(height) && height > 0 ? height : null
  }

  if (typeof height !== 'string') return null

  const match = height.trim().match(METRE_HEIGHT_PATTERN)
  if (!match) return null

  const metresText = match[1]
  if (!metresText) return null

  const parsed = Number.parseFloat(metresText.replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const trainerClearanceForHeightMetres = (heightMetres: number): number =>
  heightMetres < TRAINER_TALL_CLEARANCE_THRESHOLD_METRES ? 1 : 2

export const scaleTrainerSpriteToSheetHeight = (
  entry: PokemonCatalogEntry,
  sheetHeight: TrainerSheet['height'],
): PokemonCatalogEntry => {
  if (entry.entityKind !== 'trainer') return entry

  const targetHeight = parseTrainerSheetHeightMetres(sheetHeight)
  if (targetHeight === null || entry.height <= 0) return entry

  const scale = targetHeight / entry.height
  return {
    ...entry,
    width: entry.width * scale,
    height: targetHeight,
    clearance: trainerClearanceForHeightMetres(targetHeight),
  }
}
