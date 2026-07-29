import capabilityReferenceJson from '../../data/reference/capabilities.json'

export const CAPABILITY_REFERENCE_SCHEMA_VERSION = 1 as const
export const CAPABILITY_CANONICAL_COUNT = 83 as const

export interface CanonicalCapabilityReference {
  readonly name: string
  readonly effect: string
  readonly source: string
}

const reference = capabilityReferenceJson as Readonly<Record<string, CanonicalCapabilityReference>>

/** Frozen Unicode-code-point identity order; locale collation is deliberately not used. */
export const CANONICAL_CAPABILITY_IDS = Object.freeze(Object.keys(reference).sort())
export type CanonicalCapabilityId = string

if (CANONICAL_CAPABILITY_IDS.length !== CAPABILITY_CANONICAL_COUNT) {
  throw new Error(`Capability reference must contain ${CAPABILITY_CANONICAL_COUNT} entries.`)
}

export const CANONICAL_CAPABILITY_ID_SET: ReadonlySet<string> = new Set(CANONICAL_CAPABILITY_IDS)
export const CANONICAL_CAPABILITY_REFERENCE: Readonly<Record<string, CanonicalCapabilityReference>> = Object.freeze(
  Object.fromEntries(CANONICAL_CAPABILITY_IDS.map(id => [id, Object.freeze({ ...reference[id]! })])),
)

const canonicalByLookup = new Map(CANONICAL_CAPABILITY_IDS.map(id => [id.toLocaleLowerCase('en-US'), id]))
const COMPATIBILITY_ALIASES = new Map<string, string>([
  ['mind lock', 'Mindlock'],
  ['telekinesis', 'Telekinetic'],
  ['telepathy', 'Telepath'],
  ['delta evolver', 'Delta Evolution'],
  ['x- ray vision', 'X-Ray Vision'],
  ['invisbility', 'Invisibility'],
])

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const TRAILING_NUMBER_PATTERN = /^(.+?)\s+(\d+)$/
const JUMP_PATTERN = /^(?:jump\s+)?(\d+)\s*\/\s*(\d+)$/i
const NATUREWALK_PATTERN = /^naturewalk\s*\(([^)]*)\)$/i
const REVIEWED_PARAMETERIZED_PATTERN = /^(planter|alluring|milk collection)\s*\(([^)]*)\)$/i

export const normalizeCapabilityLabel = (value: string): string => value
  .normalize('NFKC')
  .replace(/\u00ad/g, '')
  .trim()
  .replace(/\s+/g, ' ')

export type CapabilityParameters =
  | { readonly kind: 'none' }
  | { readonly kind: 'value'; readonly value: number }
  | { readonly kind: 'jump'; readonly long: number; readonly high: number }
  | { readonly kind: 'terrains'; readonly terrains: readonly string[] }
  | { readonly kind: 'categories'; readonly categories: readonly string[] }
  | { readonly kind: 'qualifiers'; readonly qualifiers: readonly string[] }
  | { readonly kind: 'rider-capacity'; readonly riders: number }

export interface ParsedCanonicalCapabilityLabel {
  readonly canonicalId: CanonicalCapabilityId
  readonly parameters: CapabilityParameters
  readonly normalizedLabel: string
  readonly matchedBy: 'canonical' | 'parameterized' | 'compatibility-alias'
}

export interface UnresolvedCapabilityLabel {
  readonly canonicalId: null
  readonly parameters: { readonly kind: 'none' }
  readonly normalizedLabel: string
  readonly matchedBy: 'unresolved'
}

export type ParsedCapabilityLabel = ParsedCanonicalCapabilityLabel | UnresolvedCapabilityLabel

const positiveInteger = (value: string): number | null => {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1_000_000 ? parsed : null
}

const normalizeTerrain = (value: string): string => value.trim().replace(/\s+/g, ' ')
const parseTerrains = (value: string): readonly string[] => Object.freeze([
  ...new Set(value
    .split(/\s*(?:,|\band\b)\s*/i)
    .map(normalizeTerrain)
    .filter(Boolean)),
])

/**
 * Resolve only reviewed identities and syntax. Unknown sheet prose remains
 * visible to editors but never gains executable semantics by fuzzy matching.
 */
export const parseCapabilityLabel = (raw: unknown): ParsedCapabilityLabel => {
  if (typeof raw !== 'string' || CONTROL_CHARACTER_PATTERN.test(raw)) {
    return { canonicalId: null, parameters: { kind: 'none' }, normalizedLabel: '', matchedBy: 'unresolved' }
  }
  const normalizedLabel = normalizeCapabilityLabel(raw)
  if (!normalizedLabel) {
    return { canonicalId: null, parameters: { kind: 'none' }, normalizedLabel, matchedBy: 'unresolved' }
  }
  const lookup = normalizedLabel.toLocaleLowerCase('en-US')
  const direct = canonicalByLookup.get(lookup)
  if (direct) {
    return { canonicalId: direct, parameters: { kind: 'none' }, normalizedLabel, matchedBy: 'canonical' }
  }

  const naturewalk = NATUREWALK_PATTERN.exec(normalizedLabel)
  if (naturewalk) {
    const terrains = parseTerrains(naturewalk[1] ?? '')
    if (terrains.length > 0) {
      return {
        canonicalId: 'Naturewalk',
        parameters: { kind: 'terrains', terrains },
        normalizedLabel,
        matchedBy: 'parameterized',
      }
    }
  }

  const parameterized = REVIEWED_PARAMETERIZED_PATTERN.exec(normalizedLabel)
  if (parameterized) {
    const base = canonicalByLookup.get((parameterized[1] ?? '').toLocaleLowerCase('en-US'))
    const values = parseTerrains(parameterized[2] ?? '')
    if (base && values.length > 0) {
      return {
        canonicalId: base,
        parameters: base === 'Planter'
          ? { kind: 'categories', categories: values }
          : { kind: 'qualifiers', qualifiers: values },
        normalizedLabel,
        matchedBy: 'parameterized',
      }
    }
  }

  const jump = JUMP_PATTERN.exec(normalizedLabel)
  if (jump) {
    const long = positiveInteger(jump[1] ?? '') ?? (jump[1] === '0' ? 0 : null)
    const high = positiveInteger(jump[2] ?? '') ?? (jump[2] === '0' ? 0 : null)
    if (long !== null && high !== null) {
      return {
        canonicalId: 'Jump',
        parameters: { kind: 'jump', long, high },
        normalizedLabel,
        matchedBy: 'parameterized',
      }
    }
  }

  const trailing = TRAILING_NUMBER_PATTERN.exec(normalizedLabel)
  if (trailing) {
    const baseLookup = normalizeCapabilityLabel(trailing[1] ?? '').toLocaleLowerCase('en-US')
    const value = positiveInteger(trailing[2] ?? '')
    const base = canonicalByLookup.get(baseLookup) ?? COMPATIBILITY_ALIASES.get(baseLookup)
    if (value !== null && base === 'Mountable X') {
      return {
        canonicalId: base,
        parameters: { kind: 'rider-capacity', riders: value },
        normalizedLabel,
        matchedBy: 'parameterized',
      }
    }
    if (value !== null && base) {
      return {
        canonicalId: base,
        parameters: { kind: 'value', value },
        normalizedLabel,
        matchedBy: 'parameterized',
      }
    }
    if (value !== null && baseLookup === 'mountable') {
      return {
        canonicalId: 'Mountable X',
        parameters: { kind: 'rider-capacity', riders: value },
        normalizedLabel,
        matchedBy: 'parameterized',
      }
    }
  }

  const alias = COMPATIBILITY_ALIASES.get(lookup)
  if (alias) {
    return {
      canonicalId: alias,
      parameters: { kind: 'none' },
      normalizedLabel,
      matchedBy: 'compatibility-alias',
    }
  }
  return { canonicalId: null, parameters: { kind: 'none' }, normalizedLabel, matchedBy: 'unresolved' }
}

export const isCanonicalCapabilityId = (value: unknown): value is CanonicalCapabilityId => (
  typeof value === 'string' && CANONICAL_CAPABILITY_ID_SET.has(value)
)

export const canonicalCapabilityReference = (
  value: unknown,
): CanonicalCapabilityReference | null => isCanonicalCapabilityId(value)
  ? CANONICAL_CAPABILITY_REFERENCE[value] ?? null
  : null
