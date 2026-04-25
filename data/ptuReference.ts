import abilitiesJson from '~/ptu-data/data/abilities.json'
import movesJson from '~/ptu-data/data/moves.json'
import capabilitiesJson from '~/ptu-data/data/capabilities.json'
import featuresJson from '~/ptu-data/data/features.json'
import edgesJson from '~/ptu-data/data/edges.json'
import type {
  PtuAbility, PtuCapability, PtuEdge, PtuFeature, PtuMove,
} from '~/types/ptuReference'

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

/**
 * Build a stable URL slug from a name. Handles accents (``Pok\u00e9 Ed``),
 * apostrophes (``Farfetch'd``), hyphens (``Power-Up Punch``) and any other
 * non-alphanumeric junk.
 *
 *   toSlug('Razor Leaf')      \u2192 'razor-leaf'
 *   toSlug('Power-Up Punch')  \u2192 'power-up-punch'
 *   toSlug('Pok\u00e9 Ed')          \u2192 'poke-ed'
 *   toSlug("Farfetch'd")      \u2192 'farfetchd'
 */
export const toSlug = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// ---------------------------------------------------------------------------
// Canonical sorted arrays + slug indexes
// ---------------------------------------------------------------------------

const abilitiesDict     = abilitiesJson     as Record<string, PtuAbility>
const movesDict         = movesJson         as Record<string, PtuMove>
const capabilitiesDict  = capabilitiesJson  as Record<string, PtuCapability>
const featuresDict      = featuresJson      as Record<string, PtuFeature>
const edgesDict         = edgesJson         as Record<string, PtuEdge>

const sortedByName = <T extends { name: string }>(dict: Record<string, T>): T[] =>
  Object.values(dict).sort((a, b) => a.name.localeCompare(b.name))

// The 18 canonical Pokémon types. Used to drop junk entries the upstream
// `parse_moves.py` occasionally captures from the rulebook's "How to Read
// Moves" intro paragraph (which gets mistaken for a real move definition).
const VALID_MOVE_TYPES = new Set<string>([
  'Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock',
  'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass',
  'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy',
])

export const abilities    = sortedByName(abilitiesDict)
export const moves        = sortedByName(movesDict).filter((m) => VALID_MOVE_TYPES.has(m.type))
export const capabilities = sortedByName(capabilitiesDict)
export const features     = sortedByName(featuresDict)
export const edges        = sortedByName(edgesDict)

/** Trainer Class Features (the ``[Class]``-tagged ones from features.json). */
export const trainerClasses: PtuFeature[] = features.filter(
  (f) => Array.isArray(f.tags) && f.tags.includes('Class'),
)

const buildSlugMap = <T extends { name: string }>(items: T[]): Map<string, T> => {
  const map = new Map<string, T>()
  for (const item of items) map.set(toSlug(item.name), item)
  return map
}

export const abilityBySlug    = buildSlugMap(abilities)
export const moveBySlug       = buildSlugMap(moves)
export const capabilityBySlug = buildSlugMap(capabilities)
export const featureBySlug    = buildSlugMap(features)
export const edgeBySlug       = buildSlugMap(edges)

// ---------------------------------------------------------------------------
// Name \u2192 entry resolution (handles loose input from pokedex / sheet data)
// ---------------------------------------------------------------------------

const exactByName = <T extends { name: string }>(items: T[]): Map<string, T> => {
  const map = new Map<string, T>()
  for (const item of items) map.set(item.name, item)
  return map
}

const abilityByName    = exactByName(abilities)
const moveByName       = exactByName(moves)
const capabilityByName = exactByName(capabilities)
const featureByName    = exactByName(features)
const edgeByName       = exactByName(edges)

const resolveByExactOrSlug = <T extends { name: string }>(
  raw: string,
  byName: Map<string, T>,
  bySlug: Map<string, T>,
): T | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  return byName.get(trimmed) ?? bySlug.get(toSlug(trimmed)) ?? null
}

/**
 * Strip the parenthetical parameter tail from an ability label as written on
 * the pokedex, leaving only the base lookup name.
 *
 *   'Type Aura (Electric)'              →  'Type Aura'
 *   'Frighten (Male)'                   →  'Frighten'
 *   'Reckless (Red Basculin Only)'      →  'Reckless'
 */
export const stripAbilityParams = (raw: string): string =>
  raw.replace(/\s*\([^)]*\)\s*$/g, '').trim()

export const findAbility = (name: string): PtuAbility | null => {
  const direct = resolveByExactOrSlug(name, abilityByName, abilityBySlug)
  if (direct) return direct
  const stripped = stripAbilityParams(name)
  if (stripped && stripped !== name) {
    return resolveByExactOrSlug(stripped, abilityByName, abilityBySlug)
  }
  return null
}

export const findMove = (name: string): PtuMove | null =>
  resolveByExactOrSlug(name, moveByName, moveBySlug)

/**
 * Strip a trailing parenthetical specialisation off a feature/edge label.
 * E.g. ``Type Ace (Fire)`` → ``Type Ace`` so a Branching-Class label still
 * resolves to the base Class Feature.
 */
const stripFeatureParams = (raw: string): string =>
  raw.replace(/\s*\([^)]*\)\s*$/g, '').trim()

export const findFeature = (name: string): PtuFeature | null => {
  const direct = resolveByExactOrSlug(name, featureByName, featureBySlug)
  if (direct) return direct
  const stripped = stripFeatureParams(name)
  if (stripped && stripped !== name) {
    return resolveByExactOrSlug(stripped, featureByName, featureBySlug)
  }
  return null
}

export const findEdge = (name: string): PtuEdge | null => {
  const direct = resolveByExactOrSlug(name, edgeByName, edgeBySlug)
  if (direct) return direct
  const stripped = stripFeatureParams(name)
  if (stripped && stripped !== name) {
    return resolveByExactOrSlug(stripped, edgeByName, edgeBySlug)
  }
  return null
}

// ---------------------------------------------------------------------------
// Capability resolution — needs to handle parameterised input from the pokedex
// ---------------------------------------------------------------------------

/**
 * Strip the parameter tail from a capability label as written on a pokedex
 * entry, leaving only the lookup name.
 *
 *   'Naturewalk (Grassland, Forest)'  \u2192  'Naturewalk'
 *   'Mountable 2'                     \u2192  'Mountable'
 *   'Teleporter 2'                    \u2192  'Teleporter'
 *   'Mount able'                      \u2192  'Mountable'   (fix soft-hyphen split)
 */
export const stripCapabilityParams = (raw: string): string => {
  let name = raw
    .replace(/\s*\([^)]*\)\s*$/g, '')   // drop "(args)"
    .replace(/\s+\d+(?:\/\d+)?\s*$/g, '') // drop trailing "2" or "1/1"
    .trim()
  // Reverse soft-hyphen splits like "Mount able"
  name = name.replace(/([a-z])\s+([a-z])/g, '$1$2')
  return name
}

/**
 * Capability JSON aliases. The PTU rulebook stores some entries with a
 * placeholder suffix (``Mountable X``); pokedex labels drop the placeholder.
 * The numeric movement caps (Overland, Sky, Swim, Levitate, Burrow, Jump,
 * Power) are core mechanics and intentionally not in capabilities.json.
 */
const CAPABILITY_ALIASES: Record<string, string> = {
  Mountable: 'Mountable X',
  Teleporter: 'Teleporter X',
  // Fix common upstream typo where two spaces appear between words.
  'Aura  Reader': 'Aura Reader',
}

export const findCapability = (raw: string): PtuCapability | null => {
  const stripped = stripCapabilityParams(raw)
  const aliased = CAPABILITY_ALIASES[stripped] ?? stripped
  return resolveByExactOrSlug(aliased, capabilityByName, capabilityBySlug)
}

// ---------------------------------------------------------------------------
// Convenience: a "ref descriptor" for templates that want to maybe-link.
// ---------------------------------------------------------------------------

export type RefKind = 'move' | 'ability' | 'capability' | 'feature' | 'edge'

export interface RefDescriptor {
  kind: RefKind
  /** Original / display name. */
  name: string
  /** Resolved canonical name from the JSON, if found. */
  canonical?: string
  /** URL slug if the entry was found, else null. */
  slug: string | null
}

const KIND_FINDERS: Record<RefKind, (name: string) => { name: string } | null> = {
  move:       findMove,
  ability:    findAbility,
  capability: findCapability,
  feature:    findFeature,
  edge:       findEdge,
}

export const describeRef = (kind: RefKind, name: string): RefDescriptor => {
  const found = KIND_FINDERS[kind](name)
  return {
    kind,
    name,
    canonical: found?.name,
    slug: found ? toSlug(found.name) : null,
  }
}
