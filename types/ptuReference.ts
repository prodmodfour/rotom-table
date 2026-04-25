/**
 * PTU reference-data shapes mirrored from `ptu-data/data/{abilities,moves,capabilities}.json`.
 *
 * Each JSON file is a dict keyed by name; we expose them as both the canonical
 * dict and a sorted array of records via ``data/ptuReference.ts``.
 */

export interface PtuAbility {
  name: string
  frequency?: string
  trigger?: string
  effect?: string
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
}

export interface PtuCapability {
  name: string
  effect?: string
  source?: string
}

/** A Pokémon-type tag string used for pill colouring on move/pokedex pages. */
export type PtuTypeName =
  | 'Normal' | 'Fighting' | 'Flying' | 'Poison' | 'Ground' | 'Rock'
  | 'Bug' | 'Ghost' | 'Steel' | 'Fire' | 'Water' | 'Grass'
  | 'Electric' | 'Psychic' | 'Ice' | 'Dragon' | 'Dark' | 'Fairy'
