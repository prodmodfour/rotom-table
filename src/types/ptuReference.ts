/**
 * PTU reference-data shapes mirrored from Rotom Table's app-owned `data/reference/*.json`.
 *
 * Each JSON file is a dict keyed by name; we expose them as both the canonical
 * dict and a sorted array of records via ``data/ptuReference.ts``.
 */

export interface PtuAbility {
  name: string
  frequency?: string
  trigger?: string
  effect?: string
  bonus?: string
}

export interface PtuMove {
  name: string
  type: string
  frequency?: string
  ac?: number | null
  damage_base?: number | null
  damage_roll?: string | null
  damage_class?: 'Physical' | 'Special' | 'Status' | string
  range?: string
  effect?: string
  special?: string
}

export interface PtuManeuver {
  name: string
  category: string
  action?: string
  ac?: number | null
  maneuver_class?: 'Physical' | 'Special' | 'Status' | string
  range?: string
  trigger?: string
  effect?: string
  special?: string
  aliases?: string[]
  source?: string
}

export interface PtuCapability {
  name: string
  effect?: string
  source?: string
}

export interface PtuItem {
  name: string
  categories: string[]
  effects: string[]
  costs: string[]
  sections: string[]
  aliases: string[]
  notes: string[]
  source: string
}

export interface PtuCondition {
  name: string
  category: string
  effect?: string
  aliases?: string[]
  source?: string
}

export type PtuStatPointFormulaKey = 'pokemonAdded' | 'trainerLevelUp' | 'trainerTotalAtLevel'

export interface PtuLevelOffsetFormula {
  kind: 'levelOffset'
  offset: number
  min?: number
  minLevel?: number
  maxLevel?: number
}

export interface PtuRule {
  name: string
  category: string
  text?: string
  aliases?: string[]
  source?: string
  statPointFormulas?: Partial<Record<PtuStatPointFormulaKey, PtuLevelOffsetFormula>>
}

/**
 * A trainer Feature entry shaped from PTU Skills/Edges/Features and Trainer
 * Classes source material (plus errata patches). Class Features are
 * marked by the ``Class`` tag; Branching Classes additionally carry ``Branch``.
 */
export interface PtuFeature {
  name: string
  /** Bracketed tags from the source: ``Class``, ``Orders``, ``Training``,
   *  ``Branch``, ``Stratagem``, ``Weapon``, ``Ranked X``, ``+HP`` etc. */
  tags: string[]
  prerequisites?: string | null
  /** ``Static``, ``At-Will – Free Action``, ``Drain 1 AP – Extended Action``… */
  frequency?: string | null
  trigger?: string | null
  target?: string | null
  condition?: string | null
  effect?: string | null
  /** Typed recipe metadata repaired from parser-merged source fields. */
  cost?: string
  ingredients?: string | string[]
  /** For class features, the parent Trainer Class name (matches a ``Class``-
   *  tagged feature). */
  className?: string
}

/**
 * A trainer Edge — a smaller character-building unit than a Feature, with
 * just Prereqs + Effect (and no Frequency/Action line).
 */
export interface PtuEdge {
  name: string
  tags: string[]
  prerequisites?: string | null
  frequency?: string | null
  trigger?: string | null
  target?: string | null
  condition?: string | null
  effect?: string | null
}

/** A Pokémon-type tag string used for pill colouring on move/pokedex pages. */
export type PtuTypeName =
  | 'Normal' | 'Fighting' | 'Flying' | 'Poison' | 'Ground' | 'Rock'
  | 'Bug' | 'Ghost' | 'Steel' | 'Fire' | 'Water' | 'Grass'
  | 'Electric' | 'Psychic' | 'Ice' | 'Dragon' | 'Dark' | 'Fairy'

/** A trainer Skill key as used by the trainer sheet. */
export type PtuSkillKey =
  | 'acrobatics' | 'athletics' | 'charm' | 'combat' | 'command'
  | 'generalEd' | 'medicineEd' | 'occultEd' | 'pokeEd' | 'techEd'
  | 'focus' | 'guile' | 'intimidate' | 'intuition'
  | 'perception' | 'stealth' | 'survival'
