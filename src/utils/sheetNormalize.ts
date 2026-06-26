/**
 * Normalize a sheet so every nested object/array we want to bind via
 * ``v-model`` actually exists. Optional fields stay optional in the type
 * system but we materialise empty defaults at runtime to keep the editable
 * cells from binding to ``undefined.x``.
 *
 * The functions take a *clone* (the editable sheet, not the static one)
 * and mutate it in place.
 */
import { normalizeRevision } from '#shared/sessionRevisions'
import type { CharacterSheet, CharacterSheetAppliedMove, StatKey } from '~/types/characterSheet'
import type { InventoryEntry, TrainerSheet, TrainerStatKey } from '~/types/trainerSheet'
import { mergeLegacyConditions } from '~/utils/statusConditions'
import { normalizePokemonLoyalty } from '~/utils/sheets/pokemonLoyalty'
import { normalizePokemonGmSection } from '~/utils/sheets/pokemonGmFields'
import { normalizeTrainerAccentColor } from '~/utils/trainerAccent'
import { setPokemonCaughtBall } from '~/utils/sheets/pokemonCaughtBall'
import { normalizeTrainerInventoryLegacyFishingRodAutofill } from '~/utils/sheets/trainerInventoryItems'
import { stripLegacyTrainerSheetSkillRanks } from '~/utils/sheets/trainerSkillEntries'
import {
  POKEMON_RARE_CANDY_LIMIT,
  POKEMON_VITAMIN_STAT_KEYS,
  coercePokemonVitaminCount,
} from '~/utils/sheets/pokemonVitamins'

const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']
const TRAINER_STAT_KEYS: TrainerStatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']

const ensureObj = <T extends object>(host: any, key: string): T => {
  if (!host[key] || typeof host[key] !== 'object' || Array.isArray(host[key])) {
    host[key] = {}
  }
  return host[key] as T
}

const ensureArr = <T>(host: any, key: string): T[] => {
  if (!Array.isArray(host[key])) host[key] = []
  return host[key] as T[]
}

export const normalizeCharacterSheet = (sheet: CharacterSheet): CharacterSheet => {
  sheet.revision = normalizeRevision(sheet.revision)
  if (typeof sheet.player !== 'boolean') sheet.player = false
  normalizePokemonGmSection(sheet)
  const loyalty = normalizePokemonLoyalty(sheet.loyalty)
  if (loyalty == null) delete sheet.loyalty
  else sheet.loyalty = loyalty
  setPokemonCaughtBall(sheet, sheet.caughtBall)

  // Headline stats — give every key an entry so the stats table is editable.
  const stats = ensureObj<NonNullable<CharacterSheet['stats']>>(sheet, 'stats')
  for (const key of STAT_KEYS) {
    const row = ensureObj<Record<string, number>>(stats, key)
    if (typeof row.base  !== 'number') row.base  = 0
    if (typeof row.added !== 'number') row.added = 0
    if (typeof row.stage !== 'number') row.stage = 0
  }

  ensureObj<NonNullable<CharacterSheet['natureMod']>>(sheet, 'natureMod')

  const combat = ensureObj<NonNullable<CharacterSheet['combat']>>(sheet, 'combat')
  const evasion = ensureObj<NonNullable<NonNullable<CharacterSheet['combat']>['evasion']>>(combat, 'evasion')
  if (typeof evasion.vsAtkBonus  !== 'number') evasion.vsAtkBonus  = 0
  if (typeof evasion.vsSatkBonus !== 'number') evasion.vsSatkBonus = 0
  if (typeof evasion.vsAnyBonus  !== 'number') evasion.vsAnyBonus  = 0
  combat.conditions = mergeLegacyConditions(combat.conditions, combat.statusAfflictions)

  const vitamins = ensureObj<NonNullable<CharacterSheet['vitamins']>>(sheet, 'vitamins')
  const statBoosts = ensureObj<NonNullable<NonNullable<CharacterSheet['vitamins']>['statBoosts']>>(vitamins, 'statBoosts')
  const statSuppressants = ensureObj<NonNullable<NonNullable<CharacterSheet['vitamins']>['statSuppressants']>>(vitamins, 'statSuppressants')
  for (const key of POKEMON_VITAMIN_STAT_KEYS) {
    statBoosts[key] = coercePokemonVitaminCount(statBoosts[key])
    statSuppressants[key] = coercePokemonVitaminCount(statSuppressants[key])
  }
  vitamins.heartBooster = vitamins.heartBooster === true
  vitamins.ppUp = vitamins.ppUp === true
  vitamins.rareCandies = coercePokemonVitaminCount(vitamins.rareCandies, { max: POKEMON_RARE_CANDY_LIMIT })
  vitamins.heartScales = coercePokemonVitaminCount(vitamins.heartScales)
  if (typeof vitamins.ppUpMove !== 'string') vitamins.ppUpMove = ''
  if (typeof vitamins.notes !== 'string') vitamins.notes = ''
  if (typeof combat.vitamins === 'string' && combat.vitamins.trim() && !vitamins.notes.trim()) {
    vitamins.notes = combat.vitamins
  }
  delete combat.vitamins

  const combatStages = ensureObj<NonNullable<CharacterSheet['combatStages']>>(sheet, 'combatStages')
  if (typeof combatStages.acc !== 'number') combatStages.acc = 0

  ensureObj<NonNullable<CharacterSheet['items']>>(sheet, 'items')
  ensureArr<string>(sheet.items as Record<string, unknown>, 'extraItems')

  ensureObj<NonNullable<CharacterSheet['weapon']>>(sheet, 'weapon')
  ensureObj<NonNullable<CharacterSheet['tutorPoints']>>(sheet, 'tutorPoints')
  ensureObj<NonNullable<CharacterSheet['skillBackground']>>(sheet, 'skillBackground')

  ensureObj<NonNullable<CharacterSheet['inheritedMoves']>>(sheet, 'inheritedMoves')

  ensureArr(sheet, 'movelist')
  ensureArr(sheet, 'eggMoves')
  for (const move of ensureArr<CharacterSheetAppliedMove>(sheet, 'appliedMoves')) {
    const source = String(move.source ?? '').trim().toLowerCase()
    move.source = source === 'tutor' || source === 'tutoring' ? 'tutor' : 'tm'
  }
  ensureArr(sheet, 'abilities')
  ensureArr(sheet, 'edges')

  ensureObj<NonNullable<CharacterSheet['capabilities']>>(sheet, 'capabilities')
  ensureArr<string>(sheet.capabilities as Record<string, unknown>, 'other')

  ensureObj<NonNullable<CharacterSheet['skills']>>(sheet, 'skills')
  ensureObj<NonNullable<CharacterSheet['scene']>>(sheet, 'scene')

  return sheet
}

export const normalizeTrainerSheet = (sheet: TrainerSheet): TrainerSheet => {
  sheet.revision = normalizeRevision(sheet.revision)
  if (typeof sheet.player !== 'boolean') sheet.player = false
  const accentColor = normalizeTrainerAccentColor(sheet.accentColor)
  if (accentColor) sheet.accentColor = accentColor
  else delete sheet.accentColor

  const stats = ensureObj<NonNullable<TrainerSheet['stats']>>(sheet, 'stats')
  for (const key of TRAINER_STAT_KEYS) {
    const row = ensureObj<Record<string, number>>(stats, key)
    if (typeof row.base    !== 'number') row.base    = key === 'hp' ? 10 : 5
    if (typeof row.feats   !== 'number') row.feats   = 0
    if (typeof row.bonus   !== 'number') row.bonus   = 0
    if (typeof row.levelUp !== 'number') row.levelUp = 0
    if (typeof row.stage   !== 'number') row.stage   = 0
  }

  ensureObj<NonNullable<TrainerSheet['ap']>>(sheet, 'ap')
  const evasion = ensureObj<NonNullable<TrainerSheet['evasion']>>(sheet, 'evasion')
  if (typeof evasion.speedBonus    !== 'number') evasion.speedBonus    = 0
  if (typeof evasion.physicalBonus !== 'number') evasion.physicalBonus = 0
  if (typeof evasion.specialBonus  !== 'number') evasion.specialBonus  = 0
  sheet.conditions = mergeLegacyConditions(sheet.conditions, sheet.statusAfflictions)
  const combatStages = ensureObj<NonNullable<TrainerSheet['combatStages']>>(sheet, 'combatStages')
  if (typeof combatStages.acc !== 'number') combatStages.acc = 0

  ensureObj<NonNullable<TrainerSheet['capabilities']>>(sheet, 'capabilities')
  ensureArr<string>(sheet.capabilities as Record<string, unknown>, 'other')

  ensureObj<NonNullable<TrainerSheet['skillBackground']>>(sheet, 'skillBackground')
  ensureArr<string>(sheet.skillBackground as Record<string, unknown>, 'pathetic')

  ensureObj<NonNullable<TrainerSheet['skills']>>(sheet, 'skills')
  stripLegacyTrainerSheetSkillRanks(sheet)
  ensureObj<NonNullable<TrainerSheet['equipmentSlots']>>(sheet, 'equipmentSlots')

  const inv = ensureObj<NonNullable<TrainerSheet['inventory']>>(sheet, 'inventory')
  for (const key of ['keyItems', 'pokemonItems', 'medicalKit', 'pokeBalls', 'foodStuff', 'equipment']) {
    for (const entry of ensureArr<InventoryEntry>(inv, key)) {
      normalizeTrainerInventoryLegacyFishingRodAutofill(entry)
    }
  }

  ensureArr(sheet, 'movelist')
  ensureArr(sheet, 'abilities')
  ensureArr(sheet, 'maneuvers')
  ensureArr(sheet, 'orders')
  ensureArr(sheet, 'classes')
  ensureArr(sheet, 'features')
  ensureArr(sheet, 'edges')
  ensureArr(sheet, 'advancement')
  ensureArr<string>(sheet, 'currentTeam')
  ensureArr<string>(sheet, 'boxedPokemon')
  ensureArr<string>(sheet, 'wishlist')

  return sheet
}
