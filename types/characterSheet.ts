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
  /** Personal "Base" points spent on this stat. */
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
  contestStats?: string
}

export interface CharacterSheetAbility {
  name: string
  frequency?: string
  effect?: string
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

export interface CharacterSheetCombat {
  /** Override Max HP if you want to lock it instead of computing. */
  maxHp?: number
  currentHp?: number
  injuries?: number
  injuredHp?: number
  tick?: number
  evasion?: { vsAtk?: number; vsSatk?: number; vsAny?: number }
  dr?: number
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
  nickname: string
  /** Must match a `species` value in `ptu-data/data/pokedex.json`. */
  species: string
  level: number
  totalExp?: number
  toNextLevel?: number
  gender?: 'Male' | 'Female' | 'Genderless' | string
  shiny?: boolean

  /** PTU nature name, e.g. ``"Hardy"``, ``"Modest"``. */
  nature?: string
  /** Nature stat modifiers (``+1`` and ``-1`` from the spreadsheet's ``+2`` /
   *  ``-2``). Use stat keys (``"atk"``, ``"satk"``\u2026) for both fields. */
  natureMod?: { plus?: StatKey; minus?: StatKey }

  /** Optional override of types and egg groups. Defaults come from species. */
  types?: string[]
  eggGroups?: string[]

  stats?: Partial<Record<StatKey, CharacterSheetStat>>

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
