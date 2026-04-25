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
  /** Personal "Base" points (defaults to 10 for HP, 5 otherwise per PTU). */
  base?: number
  /** Bonus from Feats (purple column on the sheet). */
  feats?: number
  /** Bonus column (race / one-off bonuses). */
  bonus?: number
  /** Cumulative level-up additions. */
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
  rank?: SkillRank
  /** Flat modifier added to the dice roll (Edges, Features, gear). */
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

export interface TrainerFeatureEntry {
  name: string
  /** Optional GM/player override of the feature's source frequency line. */
  frequency?: string
  notes?: string
  /** Override or fill in tags (``["Class"]``, ``["Orders"]``, …). */
  tags?: string[]
}

export interface TrainerEdgeEntry {
  name: string
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
  /** ``"MH"`` (main hand), ``"OH"`` (off hand), ``"EW"`` (energy weapon),
   *  ``"Adept"`` / ``"Master"``. Used to colour-tag the movelist row. */
  weaponSlot?: 'MH' | 'OH' | 'EW' | 'Adept' | 'Master' | 'Natural'
}

export interface TrainerAbilityEntry {
  name: string
  frequency?: string
  effect?: string
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
  /** URL slug for the sheet's subpage (``/sheets/trainers/<slug>``). */
  slug: string
  name: string
  /** Player handle / portrait alt. */
  playedBy?: string
  age?: string | number
  sex?: string
  height?: string
  weight?: string

  level: number
  currentInjuries?: number
  money?: number

  /** Optional URL of a portrait image to drop into the silhouette frame. */
  portraitUrl?: string

  stats?: Partial<Record<TrainerStatKey, TrainerStatRow>>
  /** Override Max HP if you've already computed it elsewhere. */
  maxHp?: number
  currentHp?: number

  ap?: TrainerApPool
  capabilities?: TrainerCapabilities
  damageReduction?: number
  evasion?: { speed?: number; physical?: number; special?: number }
  combatStages?: Partial<Record<TrainerStatKey, number>>
  statusAfflictions?: string
  digestion?: string

  /** Trainer's natural / weapon-attack moves. */
  movelist?: TrainerMove[]
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

  /** Sheet slugs of party Pokémon. */
  currentTeam?: string[]
  /** Free-form wishlist labels. */
  wishlist?: string[]

  /** Inventory + equipped gear. */
  inventory?: TrainerInventory
  equipmentSlots?: TrainerEquipmentSlots
}
