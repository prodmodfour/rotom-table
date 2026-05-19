import type { PokemonCatalogEntry } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

const METRE_HEIGHT_PATTERN = /^([0-9]+(?:[.,][0-9]+)?)\s*(?:m|metres?|meters?)?$/i
const TRAINER_TALL_CLEARANCE_THRESHOLD_METRES = 1.5
export const DEFAULT_TRAINER_HEIGHT_METRES = 1.7

const validTrainerHeightMetres = (value: number): number | null =>
  Number.isFinite(value) && value > 0 ? value : null

export const parseTrainerSheetHeightMetres = (height: TrainerSheet['height'] | number): number => {
  if (typeof height === 'number') {
    return validTrainerHeightMetres(height) ?? DEFAULT_TRAINER_HEIGHT_METRES
  }

  if (typeof height !== 'string') return DEFAULT_TRAINER_HEIGHT_METRES

  const match = height.trim().match(METRE_HEIGHT_PATTERN)
  if (!match) return DEFAULT_TRAINER_HEIGHT_METRES

  const metresText = match[1]
  if (!metresText) return DEFAULT_TRAINER_HEIGHT_METRES

  const parsed = Number.parseFloat(metresText.replace(',', '.'))
  return validTrainerHeightMetres(parsed) ?? DEFAULT_TRAINER_HEIGHT_METRES
}

const trainerClearanceForHeightMetres = (heightMetres: number): number =>
  heightMetres < TRAINER_TALL_CLEARANCE_THRESHOLD_METRES ? 1 : 2

export const scaleTrainerSpriteToSheetHeight = (
  entry: PokemonCatalogEntry,
  sheetHeight: TrainerSheet['height'],
): PokemonCatalogEntry => {
  if (entry.entityKind !== 'trainer') return entry

  const targetHeight = parseTrainerSheetHeightMetres(sheetHeight)
  if (entry.height <= 0) return entry

  const scale = targetHeight / entry.height
  return {
    ...entry,
    width: entry.width * scale,
    height: targetHeight,
    clearance: trainerClearanceForHeightMetres(targetHeight),
  }
}
