import type { CombatStageKey } from '~/types/combatStages'

/**
 * Schema for a Pokémon character sheet, modelled on the PTU pokesheet
 * spreadsheet (`pokesheet.pdf`).
 *
 * Almost everything is optional: the renderer pulls species defaults from
 * `ptu-data/data/pokedex.json` (types, base stats, capabilities, skills…) and
 * lets a sheet author override or layer on top of those defaults.
 */

export type StatKey = 'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd'

export interface CharacterSheetStat {
  /** Legacy/manual Base override. Ignored by the sheet renderer; Base is Species + Nature Mod. */
  base?: number
  /** Stat points added on level-up. */
  added?: number
  /** Current combat stage (-6 .. +6). */
  stage?: number
}

export interface CharacterSheetMove {
  name: string
  type?: string
  category?: 'Physical' | 'Special' | 'Status'
  /** Damage Base. */
  db?: number
  /** Optional pre-rolled damage expression, e.g. ``"1d8+6"``. */
  damageRoll?: string
  damageRollMod?: number
  frequency?: string
  ac?: number | string
  range?: string
  effect?: string
  special?: string
  contestStats?: string
}

export interface CharacterSheetAbility {
  name: string
  frequency?: string
  trigger?: string
  effect?: string
  /** True when an ability's sheet-level toggle is active (for example, Sand Veil in a Sandstorm or Snow Cloak in Hail). */
  activated?: boolean
}

export interface CharacterSheetEdge {
  name: string
  cost?: number | string
  effect?: string
}

export interface CharacterSheetWeapon {
  name?: string
  dbMod?: number
  acMod?: number
  description?: string
}

export interface CharacterSheetEvasion {
  /** Legacy/manual total fields. Kept for old JSON; renderer now derives totals from stats. */
  vsAtk?: number
  vsSatk?: number
  vsAny?: number
  /** Editable modifier stacked on top of stat-derived evasion. */
  vsAtkBonus?: number
  vsSatkBonus?: number
  vsAnyBonus?: number
}

export interface CharacterSheetCombat {
  /** Legacy/manual Max HP. Renderer ignores this and derives Max HP from PTU formulas. */
  maxHp?: number
  currentHp?: number
  injuries?: number
  /** Legacy/manual injured HP. Renderer derives the injury-adjusted Max HP. */
  injuredHp?: number
  /** Legacy/manual Tick. Renderer derives Tick from formula Max HP. */
  tick?: number
  evasion?: CharacterSheetEvasion
  dr?: number
  /** PTU condition entries (for example, "Burned", "Tripped", or "Disabled: Tackle"). */
  conditions?: string[]
  /** Legacy/free-form status notes that do not map to a canonical condition. */
  statusAfflictions?: string
  vitamins?: string
  notes?: string
  trainingExp?: number
}

export interface CharacterSheetItems {
  held?: string
  itemDescription?: string
  digestionFood?: string
  extraItems?: string[]
  pointsLeft?: number
}

export interface CharacterSheetTutorPoints {
  earned?: number
  spent?: number
}

export interface CharacterSheetSkillBackground {
  description?: string
  raised?: string[]
  lowered?: string[]
}

export interface CharacterSheetCapabilities {
  overland?: number
  sky?: number
  swim?: number
  levitate?: number
  burrow?: number
  jump?: string
  power?: number
  weight?: number
  size?: string
  naturewalk?: string
  other?: string[]
}

export interface CharacterSheetSkills {
  acrobatics?: string
  athletics?: string
  charm?: string
  combat?: string
  command?: string
  generalEd?: string
  medicineEd?: string
  occultEd?: string
  pokeEd?: string
  techEd?: string
  focus?: string
  guile?: string
  intimidate?: string
  intuition?: string
  perception?: string
  stealth?: string
  survival?: string
}

export interface CharacterSheet {
  /** URL slug for the sheet's subpage (``/sheets/<slug>``). */
  slug: string
  /**
   * Optional folder label for grouping on the sheets index. When omitted,
   * the folder is derived from the file's directory under ``data/sheets/``
   * (e.g. ``data/sheets/team-alpha/foo.json`` → ``"team-alpha"``). Set this
   * explicitly to override the auto-derived label.
   */
  folder?: string
  nickname: string
  /** Matches a `species` value in `ptu-data/data/pokedex.json`; blank means no species selected yet. */
  species: string
  level: number
  totalExp?: number
  /** Legacy/manual cache. The sheet UI derives this from totalExp and the PTU experience chart. */
  toNextLevel?: number
  gender?: 'Male' | 'Female' | 'Genderless' | string
  shiny?: boolean
  /** Marks this sheet as a player-controlled character. */
  player?: boolean

  /** PTU nature name, e.g. ``"Hardy"``, ``"Modest"``. */
  nature?: string
  /** Cached/legacy Nature stat choices from the PTU Nature Chart. The renderer
   *  derives Nat +/- from `nature`, so these are not manually edited. */
  natureMod?: { plus?: StatKey; minus?: StatKey }

  /** Optional override of types and egg groups. Defaults come from species. */
  types?: string[]
  eggGroups?: string[]

  stats?: Partial<Record<StatKey, CharacterSheetStat>>
  /** Non-stat stage-like modifiers, such as Accuracy. Stat stages live in `stats.*.stage`. */
  combatStages?: Partial<Record<CombatStageKey, number>>

  combat?: CharacterSheetCombat
  items?: CharacterSheetItems
  weapon?: CharacterSheetWeapon

  tutorPoints?: CharacterSheetTutorPoints
  skillBackground?: CharacterSheetSkillBackground

  /** Dictionary keyed by level (``"20"``\u2026``"90"``) of inherited move names. */
  inheritedMoves?: Record<string, string>
  inheritedRemaining?: number

  movelist?: CharacterSheetMove[]

  /** Override capabilities. Defaults pull from species. */
  capabilities?: CharacterSheetCapabilities

  abilities?: CharacterSheetAbility[]
  edges?: CharacterSheetEdge[]

  /** Override skills. Defaults pull from species (mapped to skill keys). */
  skills?: CharacterSheetSkills

  /** Free-form party-context fields from the top of the spreadsheet. */
  scene?: { sceneXp?: number; pkmnCount?: number; modifiers?: number; newTotal?: number }
}
