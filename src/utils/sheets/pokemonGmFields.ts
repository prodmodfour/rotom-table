import type { CharacterSheet, CharacterSheetGm } from '~/types/characterSheet'

export const POKEMON_GM_FIELD = 'gm'
export const POKEMON_SERVER_PRIVATE_FIELD = 'serverPrivate'
export const POKEMON_BABY_TEMPLATE_MECHANICS_FIELD = 'babyTemplateMechanics'

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
  if (!hasOwn(sheet, POKEMON_GM_FIELD) && !hasOwn(sheet, POKEMON_SERVER_PRIVATE_FIELD)) return sheet
  const redacted = { ...sheet }
  delete redacted[POKEMON_GM_FIELD]
  delete redacted[POKEMON_SERVER_PRIVATE_FIELD]
  return redacted as TSheet
}

const POKEMON_PLAYER_HIDDEN_AUTHORITY_FIELDS = Object.freeze([
  POKEMON_GM_FIELD,
  'loyalty',
] as const)

const PLAYER_HIDDEN_AUTOMATION_FIELDS = Object.freeze([
  'capabilityUsage',
  'capabilityCampaignState',
  POKEMON_SERVER_PRIVATE_FIELD,
  POKEMON_BABY_TEMPLATE_MECHANICS_FIELD,
] as const)

export const preservePlayerHiddenAutomationFieldsForSave = <TSheet extends Record<string, unknown>>(
  candidate: TSheet,
  current: Record<string, unknown>,
): TSheet => {
  const preserved: Record<string, unknown> = { ...candidate }
  for (const field of PLAYER_HIDDEN_AUTOMATION_FIELDS) {
    if (hasOwn(current, field)) preserved[field] = current[field]
    else delete preserved[field]
  }
  return preserved as TSheet
}

export const preservePokemonGmFieldsForPlayerSave = <TSheet extends Record<string, unknown>>(
  candidate: TSheet,
  current: Record<string, unknown>,
): TSheet => {
  const preserved: Record<string, unknown> = { ...candidate }
  // A whole-sheet setup save starts from the player-redacted document. Preserve
  // every omitted Pokémon authority field so that save cannot erase it, and
  // ignore a forged value if an old or modified client submits one anyway.
  for (const field of POKEMON_PLAYER_HIDDEN_AUTHORITY_FIELDS) {
    if (hasOwn(current, field)) preserved[field] = current[field]
    else delete preserved[field]
  }
  return preserved as TSheet
}

/** A sheet editor cannot create, replace, or delete server-owned mechanic evidence. */
export const preservePokemonServerPrivateFieldsForSave = <TSheet extends Record<string, unknown>>(
  candidate: TSheet,
  current: Record<string, unknown>,
): TSheet => {
  const preserved: Record<string, unknown> = { ...candidate }
  if (hasOwn(current, POKEMON_SERVER_PRIVATE_FIELD)) preserved[POKEMON_SERVER_PRIVATE_FIELD] = current[POKEMON_SERVER_PRIVATE_FIELD]
  else delete preserved[POKEMON_SERVER_PRIVATE_FIELD]
  const serverPrivate = isRecord(current[POKEMON_SERVER_PRIVATE_FIELD]) ? current[POKEMON_SERVER_PRIVATE_FIELD] : null
  if (serverPrivate && hasOwn(serverPrivate, 'breedingBabyTemplate') && hasOwn(current, POKEMON_BABY_TEMPLATE_MECHANICS_FIELD)) {
    preserved[POKEMON_BABY_TEMPLATE_MECHANICS_FIELD] = current[POKEMON_BABY_TEMPLATE_MECHANICS_FIELD]
  }
  else delete preserved[POKEMON_BABY_TEMPLATE_MECHANICS_FIELD]
  return preserved as TSheet
}
