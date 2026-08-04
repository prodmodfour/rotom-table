import trainerReferenceJson from '../../data/reference/edges.json'
import pokeReferenceJson from '../../data/reference/poke-edges.json'

export const EDGE_CATALOG_SCHEMA_VERSION = 1 as const
export const TRAINER_EDGE_CANONICAL_COUNT = 61 as const
export const POKE_EDGE_CANONICAL_COUNT = 20 as const
export const EDGE_CANONICAL_COUNT = 81 as const

export type EdgeFamily = 'trainer' | 'poke'
export type CanonicalEdgeId = string

export interface CanonicalTrainerEdgeReference {
  readonly name: string
  readonly tags: readonly string[]
  readonly prerequisites: string | null
  readonly frequency: string | null
  readonly trigger: string | null
  readonly target: string | null
  readonly condition: string | null
  readonly effect: string
}

export type PokeEdgeChoiceKind =
  | 'ability'
  | 'move'
  | 'movement-capability'
  | 'attack-stat'
  | 'elemental-struggle-capability'
  | 'power-or-jump-capability'
  | 'final-evolution'
  | 'skill'

export interface CanonicalPokeEdgeChoice {
  readonly kind: PokeEdgeChoiceKind
  readonly minimum: number
  readonly maximum: number
  readonly sameAcrossRanks: boolean
}

export interface CanonicalPokeEdgeReference {
  readonly name: string
  readonly tags: readonly string[]
  readonly prerequisites: string
  readonly cost: number
  readonly choices: readonly CanonicalPokeEdgeChoice[]
  readonly repeatability: {
    readonly kind: 'once' | 'different-choice' | 'ranked'
    readonly maximum: number | null
  }
  readonly effect: string
  readonly replaces: string | null
  readonly catalogVersion: 1
}

const trainer = trainerReferenceJson as Readonly<Record<string, CanonicalTrainerEdgeReference>>
const poke = pokeReferenceJson as Readonly<Record<string, CanonicalPokeEdgeReference>>

export const CANONICAL_TRAINER_EDGE_IDS = Object.freeze(Object.keys(trainer).sort())
export const CANONICAL_POKE_EDGE_IDS = Object.freeze(Object.keys(poke).sort())
export const CANONICAL_EDGE_KEYS = Object.freeze([
  ...CANONICAL_TRAINER_EDGE_IDS.map(id => `trainer:${id}`),
  ...CANONICAL_POKE_EDGE_IDS.map(id => `poke:${id}`),
])

if (CANONICAL_TRAINER_EDGE_IDS.length !== TRAINER_EDGE_CANONICAL_COUNT
  || CANONICAL_POKE_EDGE_IDS.length !== POKE_EDGE_CANONICAL_COUNT) {
  throw new Error('Edge catalogs must contain exactly 61 Trainer and 20 Poké Edge rows.')
}

export const CANONICAL_TRAINER_EDGE_REFERENCE: Readonly<Record<string, CanonicalTrainerEdgeReference>> = Object.freeze(
  Object.fromEntries(CANONICAL_TRAINER_EDGE_IDS.map(id => [id, Object.freeze({ ...trainer[id]! })])),
)
export const CANONICAL_POKE_EDGE_REFERENCE: Readonly<Record<string, CanonicalPokeEdgeReference>> = Object.freeze(
  Object.fromEntries(CANONICAL_POKE_EDGE_IDS.map(id => [id, Object.freeze({ ...poke[id]! })])),
)

const trainerIds = new Set(CANONICAL_TRAINER_EDGE_IDS)
const pokeIds = new Set(CANONICAL_POKE_EDGE_IDS)

/** Typography-only identity key. It does not perform fuzzy matching. */
export const normalizedEdgeIdentityKey = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[’‘]/g, "'")
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('en-US')

const trainerLookup = new Map(CANONICAL_TRAINER_EDGE_IDS.map(id => [normalizedEdgeIdentityKey(id), id]))
const pokeLookup = new Map(CANONICAL_POKE_EDGE_IDS.map(id => [normalizedEdgeIdentityKey(id), id]))

const aliases: Readonly<Record<EdgeFamily, ReadonlyMap<string, string>>> = Object.freeze({
  trainer: new Map([
    ['pokepsychologist', 'PokéPsychologist'],
    ["sneak's tricks", 'Sneak’s Tricks'],
  ]),
  poke: new Map([
    ['mixed sweeper', 'Mixed Power'],
    ["underdog's lessons", 'Underdog’s Lessons'],
    ["underdog's strength", 'Underdog’s Strength'],
    ['basic ranged attack', 'Basic Ranged Attacks'],
  ]),
})

export interface ParsedEdgeLabel {
  readonly family: EdgeFamily
  readonly canonicalId: CanonicalEdgeId | null
  readonly normalizedLabel: string
  readonly selectionHints: readonly string[]
  readonly matchedBy: 'canonical' | 'compatibility-alias' | 'legacy-parameterized' | 'unresolved'
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/
const SUFFIX = /^(.+?)\s*\(([^()]*)\)\s*$/
const COLON_CHOICE = /^(.+?)\s*(?::|—)\s*([^:;]{1,160})$/

const splitHints = (value: string): readonly string[] => Object.freeze([
  ...new Set(value.split(/\s*(?:,|;|\/|\band\b|&)\s*/i).map(part => part.trim()).filter(Boolean)),
].slice(0, 8))

export const isCanonicalEdgeId = (family: EdgeFamily, value: unknown): value is CanonicalEdgeId => (
  typeof value === 'string' && (family === 'trainer' ? trainerIds : pokeIds).has(value)
)

export const parseEdgeLabel = (family: EdgeFamily, raw: unknown): ParsedEdgeLabel => {
  if (typeof raw !== 'string' || CONTROL_CHARACTERS.test(raw)) {
    return { family, canonicalId: null, normalizedLabel: '', selectionHints: [], matchedBy: 'unresolved' }
  }
  const normalizedLabel = raw.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!normalizedLabel || normalizedLabel.length > 240) {
    return { family, canonicalId: null, normalizedLabel, selectionHints: [], matchedBy: 'unresolved' }
  }
  const lookup = family === 'trainer' ? trainerLookup : pokeLookup
  const key = normalizedEdgeIdentityKey(normalizedLabel)
  const direct = lookup.get(key)
  if (direct) return { family, canonicalId: direct, normalizedLabel, selectionHints: [], matchedBy: 'canonical' }
  const alias = aliases[family].get(key)
  if (alias) return { family, canonicalId: alias, normalizedLabel, selectionHints: [], matchedBy: 'compatibility-alias' }

  const match = SUFFIX.exec(normalizedLabel) ?? COLON_CHOICE.exec(normalizedLabel)
  if (match) {
    const baseKey = normalizedEdgeIdentityKey(match[1] ?? '')
    const canonicalId = lookup.get(baseKey) ?? aliases[family].get(baseKey)
    const hints = splitHints(match[2] ?? '')
    if (canonicalId && hints.length > 0) {
      return { family, canonicalId, normalizedLabel, selectionHints: hints, matchedBy: 'legacy-parameterized' }
    }
  }
  return { family, canonicalId: null, normalizedLabel, selectionHints: [], matchedBy: 'unresolved' }
}

export const canonicalEdgeReference = (
  family: EdgeFamily,
  canonicalId: unknown,
): CanonicalTrainerEdgeReference | CanonicalPokeEdgeReference | null => {
  if (!isCanonicalEdgeId(family, canonicalId)) return null
  return family === 'trainer'
    ? CANONICAL_TRAINER_EDGE_REFERENCE[canonicalId] ?? null
    : CANONICAL_POKE_EDGE_REFERENCE[canonicalId] ?? null
}

export const canonicalEdgeKey = (family: EdgeFamily, canonicalId: string): string => `${family}:${canonicalId}`
