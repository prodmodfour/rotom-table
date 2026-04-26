/**
 * Normalize a sheet so every nested object/array we want to bind via
 * ``v-model`` actually exists. Optional fields stay optional in the type
 * system but we materialise empty defaults at runtime to keep the editable
 * cells from binding to ``undefined.x``.
 *
 * The functions take a *clone* (the editable sheet, not the static one)
 * and mutate it in place.
 */
import type { CharacterSheet, StatKey } from '~/types/characterSheet'
import type { TrainerSheet, TrainerStatKey } from '~/types/trainerSheet'

const STAT_KEYS: StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']
const TRAINER_STAT_KEYS: TrainerStatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']

const ensureObj = <T extends Record<string, unknown>>(host: any, key: string): T => {
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
  ensureObj<NonNullable<NonNullable<CharacterSheet['combat']>['evasion']>>(combat, 'evasion')

  ensureObj<NonNullable<CharacterSheet['items']>>(sheet, 'items')
  ensureArr<string>(sheet.items as Record<string, unknown>, 'extraItems')

  ensureObj<NonNullable<CharacterSheet['weapon']>>(sheet, 'weapon')
  ensureObj<NonNullable<CharacterSheet['tutorPoints']>>(sheet, 'tutorPoints')
  ensureObj<NonNullable<CharacterSheet['skillBackground']>>(sheet, 'skillBackground')

  ensureObj<NonNullable<CharacterSheet['inheritedMoves']>>(sheet, 'inheritedMoves')

  ensureArr(sheet, 'movelist')
  ensureArr(sheet, 'abilities')
  ensureArr(sheet, 'edges')

  ensureObj<NonNullable<CharacterSheet['capabilities']>>(sheet, 'capabilities')
  ensureArr<string>(sheet.capabilities as Record<string, unknown>, 'other')

  ensureObj<NonNullable<CharacterSheet['skills']>>(sheet, 'skills')
  ensureObj<NonNullable<CharacterSheet['scene']>>(sheet, 'scene')

  return sheet
}

export const normalizeTrainerSheet = (sheet: TrainerSheet): TrainerSheet => {
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
  ensureObj<NonNullable<TrainerSheet['evasion']>>(sheet, 'evasion')
  ensureObj<NonNullable<TrainerSheet['capabilities']>>(sheet, 'capabilities')
  ensureArr<string>(sheet.capabilities as Record<string, unknown>, 'other')

  ensureObj<NonNullable<TrainerSheet['skillBackground']>>(sheet, 'skillBackground')
  ensureArr<string>(sheet.skillBackground as Record<string, unknown>, 'pathetic')

  ensureObj<NonNullable<TrainerSheet['skills']>>(sheet, 'skills')
  ensureObj<NonNullable<TrainerSheet['equipmentSlots']>>(sheet, 'equipmentSlots')

  const inv = ensureObj<NonNullable<TrainerSheet['inventory']>>(sheet, 'inventory')
  for (const key of ['keyItems', 'pokemonItems', 'medicalKit', 'pokeBalls', 'foodStuff', 'equipment']) {
    ensureArr(inv, key)
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
  ensureArr<string>(sheet, 'wishlist')

  return sheet
}
