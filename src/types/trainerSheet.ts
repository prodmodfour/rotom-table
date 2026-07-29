import type { AbilityInstanceData } from '#shared/abilityAutomation/parameters'
import type { AbilityDailyUsageLedger } from '#shared/abilityAutomation/resources'
import type { CapabilityUsageLedger } from '#shared/capabilityAutomation/state'
import type { PermanentMoveListEntryProvenance } from '#shared/moveAutomation/permanentMoveLists'
import type { CombatStageKey } from '~/types/combatStages'
import type { SheetMoveUsageState } from '~/types/moveUsage'

/**
 * Schema for a Trainer character sheet, modelled on the PTU "Fancy" trainer
 * spreadsheet (5 tabs: Trainer, Combat, Inventory, Features, Edges).
 *
 * As with the Pokémon sheet, almost everything is optional — the renderer
 * supplies sensible defaults (level-1 base stats of 5, untrained skills, the
 * baseline trainer capabilities, etc.) so a freshly-created sheet renders even
 * with the bare minimum (`slug`, `name`, `level`).
 */

/* ------------------------------------------------------------------ */
/* Stats                                                              */
/* ------------------------------------------------------------------ */

export type TrainerStatKey = 'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd'

export interface TrainerStatRow {
  /** Default Combat Stat floor (10 HP, 5 otherwise for Level 1 Trainers). */
  base?: number
  /** Bonus from Feats (purple column on the sheet). */
  feats?: number
  /** Bonus column (race / one-off bonuses). */
  bonus?: number
  /** Cumulative assigned Stat Points: 10 at character creation plus later level gains. */
  levelUp?: number
  /** Current Combat Stage modifier (-6 .. +6). */
  stage?: number
}

/* ------------------------------------------------------------------ */
/* Skills                                                             */
/* ------------------------------------------------------------------ */

export const TRAINER_SKILLS = [
  'acrobatics',
  'athletics',
  'charm',
  'combat',
  'command',
  'generalEd',
  'medicineEd',
  'occultEd',
  'pokeEd',
  'techEd',
  'focus',
  'guile',
  'intimidate',
  'intuition',
  'perception',
  'stealth',
  'survival',
] as const

export type TrainerSkillKey = (typeof TRAINER_SKILLS)[number]

export type SkillRank =
  | 'Pathetic'
  | 'Untrained'
  | 'Novice'
  | 'Adept'
  | 'Expert'
  | 'Master'

export interface TrainerSkillEntry {
  /** Miscellaneous rank-step bonus stacked on top of Skill Background/Edge rank calculation. */
  rankBonus?: number
  /** Non-rank flat modifier added to the dice roll (Skill Enhancement, gear, situational bonuses). */
  modifier?: number
}

/* ------------------------------------------------------------------ */
/* Skill Background                                                   */
/* ------------------------------------------------------------------ */

export interface TrainerSkillBackground {
  name?: string
  description?: string
  /** Skill (or skills) raised to Adept by the background. */
  adept?: TrainerSkillKey | TrainerSkillKey[]
  /** Skill raised to Novice by the background. */
  novice?: TrainerSkillKey | TrainerSkillKey[]
  /** Skills lowered to Pathetic by the background. */
  pathetic?: TrainerSkillKey[]
}

/* ------------------------------------------------------------------ */
/* Features, Edges, Classes (lookups by name into features.json /     */
/* edges.json — minimal extra fields here for sheet-specific notes).  */
/* ------------------------------------------------------------------ */

// Dotted keys represent nested selections, e.g. a Dilettante Feature choice of
// Tutoring can store the mastered Move as `feature.move`.
export type TrainerEntryChoices = Record<string, string>

export interface TrainerFeatureEntry {
  name: string
  /** Sheet-specific selections for Features that branch when chosen (type, stat, ability, etc.). */
  choices?: TrainerEntryChoices
  /** Optional GM/player override of the feature's source frequency line. */
  frequency?: string
  notes?: string
  /** Override or fill in tags (``["Class"]``, ``["Orders"]``, …). */
  tags?: string[]
}

export interface TrainerEdgeEntry {
  name: string
  /** Sheet-specific selections for Edges that branch when chosen (type, skill, category, etc.). */
  choices?: TrainerEntryChoices
  /** For the Basic Skills Edge, the skill being raised. */
  basicSkill?: TrainerSkillKey
  notes?: string
}

export interface TrainerClassEntry {
  /** Class name as it appears in features.json with the ``Class`` tag. */
  name: string
  /** For [Branch] classes, the chosen specialisation (e.g. ``"Fire"``). */
  specialisation?: string
  notes?: string
}

/* ------------------------------------------------------------------ */
/* Trainer advancement table (Lv 5/10/20/30/40 stat tiers)            */
/* ------------------------------------------------------------------ */

export interface TrainerAdvancementRow {
  level: number
  stats?: number
  attack?: number
  spAttack?: number
  notes?: string
}

/* ------------------------------------------------------------------ */
/* Combat tab — AP, capabilities, movelist, abilities, orders         */
/* ------------------------------------------------------------------ */

export interface TrainerApPool {
  left?: number
  spent?: number
  bound?: number
  drained?: number
  /** Override Max AP if you don't want the default ``5 + floor(level/5)``. */
  max?: number
}

export interface TrainerCapabilities {
  /** Defaults to 5. */
  overland?: number
  /** Defaults to floor(athletics rank value) + 4 = 6 for level-1. */
  throwingRange?: number
  highJump?: number
  longJump?: number
  swim?: number
  /** Defaults to athletics-derived value, usually 4. */
  power?: number
  /** Optional sky / levitate / burrow for trainers with mobility features. */
  sky?: number
  levitate?: number
  burrow?: number
  /** Free-form extra capabilities (e.g. "Telepath", "Aura Reader"). */
  other?: string[]
}

export interface TrainerEvasion {
  /** Legacy/manual total fields. Kept for old JSON; renderer now derives totals from stats. */
  speed?: number
  physical?: number
  special?: number
  /** Editable modifier stacked on top of stat-derived evasion. */
  speedBonus?: number
  physicalBonus?: number
  specialBonus?: number
}

export interface TrainerMove {
  name: string
  type?: string
  category?: 'Physical' | 'Special' | 'Status'
  db?: number
  damageRoll?: string
  damageRollMod?: number
  frequency?: string
  ac?: number | string
  range?: string
  effect?: string
  special?: string
  /** ``"MH"`` (main hand), ``"OH"`` (off hand), ``"EW"`` (energy weapon),
   *  ``"Adept"`` / ``"Master"``. Used to colour-tag the movelist row. */
  weaponSlot?: 'MH' | 'OH' | 'EW' | 'Adept' | 'Master' | 'Natural'
  /** Server-authored origin for a move learned through permanent move automation. */
  permanentMoveSource?: PermanentMoveListEntryProvenance
}

export interface TrainerAbilityEntry {
  name: string
  frequency?: string
  trigger?: string
  effect?: string
  /** True when a sheet-level ability toggle is active. Mostly used by Pokémon sheets, but kept here for shared ability automation. */
  activated?: boolean
  /** Stable canonical instance identity and reviewed parameter choices. */
  automation?: AbilityInstanceData
}

export interface TrainerManeuver {
  name: string
  action?: string
  category?: string
  ac?: number | string
  range?: string
  effect?: string
}

export interface TrainerOrder {
  name: string
  tags?: string[]
  effect?: string
}

/* ------------------------------------------------------------------ */
/* Inventory tab                                                      */
/* ------------------------------------------------------------------ */

export interface InventoryEntry {
  /** Optional stable row identity used by authoritative live-play item mutations. */
  id?: string
  name: string
  qty?: number
  cost?: number | string
  description?: string
  /** Pokéballs only — modifier value (e.g. "x4"). */
  mod?: string
  /** Equipment only — slot label. */
  slot?: string
}

export interface TrainerInventory {
  keyItems?: InventoryEntry[]
  pokemonItems?: InventoryEntry[]
  medicalKit?: InventoryEntry[]
  pokeBalls?: InventoryEntry[]
  foodStuff?: InventoryEntry[]
  equipment?: InventoryEntry[]
}

export interface TrainerEquipmentSlots {
  mainHand?: string
  offHand?: string
  head?: string
  body?: string
  feet?: string
  accessory?: string
}

/* ------------------------------------------------------------------ */
/* Top-level sheet                                                    */
/* ------------------------------------------------------------------ */

export interface TrainerSheet {
  /** Server-owned document revision used for command conflict control. */
  revision?: number
  /** URL slug for the sheet's subpage (``/sheets/trainers/<slug>``). */
  slug: string
  /** Logical SQLite library folder label for grouping on the sheets index. */
  folder?: string
  name: string
  /** Marks this sheet as broadly visible to players. */
  player?: boolean
  /** Runtime API marker: this private sheet is linked to the selected player profile. */
  playerProfileAccessible?: boolean
  /** Runtime API marker: this private sheet is visible through a legacy session grant. */
  sessionPlayerAccessible?: boolean
  /** Player handle / portrait alt. */
  playedBy?: string
  age?: string | number
  sex?: string
  height?: string
  weight?: string

  level: number
  currentInjuries?: number
  /** Injuries restored during the current campaign day; capped by PTU's daily Injury-healing limit. */
  injuriesHealedToday?: number
  money?: number

  /** Optional URL of a portrait image to drop into the silhouette frame. */
  portraitUrl?: string
  /** Optional per-trainer UI accent colour (`#rrggbb`). Defaults to white when omitted. */
  accentColor?: string

  stats?: Partial<Record<TrainerStatKey, TrainerStatRow>>
  /** Legacy/manual Max HP. Renderer ignores this and derives Max HP from PTU formulas. */
  maxHp?: number
  currentHp?: number

  ap?: TrainerApPool
  capabilities?: TrainerCapabilities
  damageReduction?: number
  evasion?: TrainerEvasion
  /** Legacy stat stages and non-stat modifiers such as Accuracy. */
  combatStages?: Partial<Record<CombatStageKey, number>>
  /** PTU condition entries (for example, "Burned", "Tripped", or "Disabled: Tackle"). */
  conditions?: string[]
  /** Legacy/free-form status notes that do not map to a canonical condition. */
  statusAfflictions?: string
  /** Legacy single-slot digestion buff. New Gluttony-aware writes use digestionFoods. */
  digestion?: string
  digestionFoods?: string[]
  /** Honey Paws' separate Leftovers-equivalent buff; does not consume a normal slot. */
  honeyPawsFood?: string

  /** Trainer's natural / weapon-attack moves. */
  movelist?: TrainerMove[]
  /** Persistent Daily move frequency usage. EOT/Scene and per-Scene Daily locks are map-scoped. */
  moveUsage?: SheetMoveUsageState
  /** Lasting server-owned Daily ability usage for the current campaign day. */
  abilityUsage?: AbilityDailyUsageLedger
  /** Server-owned Daily/Weekly/hourly Capability resources. */
  capabilityUsage?: CapabilityUsageLedger
  abilities?: TrainerAbilityEntry[]
  maneuvers?: TrainerManeuver[]
  /** Pokémon Training & Orders that the trainer can apply to their team. */
  orders?: TrainerOrder[]

  classes?: TrainerClassEntry[]
  features?: TrainerFeatureEntry[]
  edges?: TrainerEdgeEntry[]
  trainingFeature?: string

  skillBackground?: TrainerSkillBackground
  skills?: Partial<Record<TrainerSkillKey, TrainerSkillEntry>>

  advancement?: TrainerAdvancementRow[]

  milestones?: number
  dexExp?: number
  miscExp?: number
  bonusSkillEdges?: number
  remainingFeatures?: number
  remainingEdges?: number

  /** Narrative blocks (Tab 1 footer). */
  physicalDescription?: string
  background?: string
  personality?: string
  goalsAndDreams?: string

  /** Sheet slugs of the trainer's active party Pokémon (max 6 in the UI). */
  currentTeam?: string[]
  /** Sheet slugs of linked Pokémon currently kept in storage. */
  boxedPokemon?: string[]
  /** Free-form wishlist labels. */
  wishlist?: string[]

  /** Inventory + equipped gear. */
  inventory?: TrainerInventory
  equipmentSlots?: TrainerEquipmentSlots
}
