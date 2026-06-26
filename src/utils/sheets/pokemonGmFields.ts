import type { CharacterSheet, CharacterSheetGm } from '~/types/characterSheet'

export const POKEMON_GM_FIELD = 'gm'

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)

export const ensurePokemonGmSection = (sheet: CharacterSheet): CharacterSheetGm => {
  if (!isRecord(sheet.gm)) sheet.gm = {}
  if (typeof sheet.gm.notes !== 'string') sheet.gm.notes = ''
  return sheet.gm
}

export const normalizePokemonGmSection = (sheet: CharacterSheet): void => {
  if (!hasOwn(sheet, POKEMON_GM_FIELD)) return
  if (!isRecord(sheet.gm)) {
    sheet.gm = {}
    return
  }
  if (sheet.gm.notes !== undefined && typeof sheet.gm.notes !== 'string') {
    sheet.gm.notes = String(sheet.gm.notes)
  }
}

export const redactPokemonGmFields = <TSheet extends Record<string, unknown>>(sheet: TSheet): TSheet => {
  if (!hasOwn(sheet, POKEMON_GM_FIELD)) return sheet
  const redacted = { ...sheet }
  delete redacted[POKEMON_GM_FIELD]
  return redacted as TSheet
}

export const preservePokemonGmFieldsForPlayerSave = <TSheet extends Record<string, unknown>>(
  candidate: TSheet,
  current: Record<string, unknown>,
): TSheet => {
  const preserved: Record<string, unknown> = { ...candidate }
  if (hasOwn(current, POKEMON_GM_FIELD)) preserved[POKEMON_GM_FIELD] = current[POKEMON_GM_FIELD]
  else delete preserved[POKEMON_GM_FIELD]
  return preserved as TSheet
}
