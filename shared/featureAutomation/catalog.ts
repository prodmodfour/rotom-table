import featureReferenceJson from '../../data/reference/features.json'

export const FEATURE_CATALOG_SCHEMA_VERSION = 1 as const
export const FEATURE_CANONICAL_COUNT = 444 as const
export type CanonicalFeatureId = string

export interface CanonicalFeatureReference {
  readonly name: string
  readonly tags: readonly string[]
  readonly prerequisites: string
  readonly frequency: string | null
  readonly trigger: string | null
  readonly target: string | null
  readonly condition: string | null
  readonly effect: string
  readonly className?: string
  readonly cost?: string
  readonly ingredients?: string | readonly string[]
}

const source = featureReferenceJson as Readonly<Record<string, CanonicalFeatureReference>>
export const CANONICAL_FEATURE_IDS = Object.freeze(Object.keys(source).sort())
if (CANONICAL_FEATURE_IDS.length !== FEATURE_CANONICAL_COUNT) {
  throw new Error(`Feature catalog must contain exactly ${FEATURE_CANONICAL_COUNT} rows.`)
}

export const CANONICAL_FEATURE_REFERENCE: Readonly<Record<string, CanonicalFeatureReference>> = Object.freeze(
  Object.fromEntries(CANONICAL_FEATURE_IDS.map(id => [id, Object.freeze({ ...source[id]! })])),
)

const ids = new Set(CANONICAL_FEATURE_IDS)
export const normalizedFeatureIdentityKey = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[’‘]/g, "'")
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('en-US')

const lookup = new Map(CANONICAL_FEATURE_IDS.map(id => [normalizedFeatureIdentityKey(id), id]))
const aliases = new Map<string, string>([
  ['im a doctor', 'I’m a Doctor'],
  ["gotta catch 'em all", 'Gotta Catch ‘Em All'],
])

export const isCanonicalFeatureId = (value: unknown): value is CanonicalFeatureId => typeof value === 'string' && ids.has(value)

export interface ParsedFeatureLabel {
  readonly canonicalId: CanonicalFeatureId | null
  readonly normalizedLabel: string
  readonly selectionHints: readonly string[]
  readonly matchedBy: 'canonical' | 'compatibility-alias' | 'legacy-parameterized' | 'unresolved'
}

const suffix = /^(.+?)\s*\(([^()]*)\)\s*$/
const control = /[\u0000-\u001f\u007f]/
export const parseFeatureLabel = (raw: unknown): ParsedFeatureLabel => {
  if (typeof raw !== 'string' || control.test(raw)) return { canonicalId: null, normalizedLabel: '', selectionHints: [], matchedBy: 'unresolved' }
  const normalizedLabel = raw.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!normalizedLabel || normalizedLabel.length > 240) return { canonicalId: null, normalizedLabel, selectionHints: [], matchedBy: 'unresolved' }
  const key = normalizedFeatureIdentityKey(normalizedLabel)
  const direct = lookup.get(key)
  if (direct) return { canonicalId: direct, normalizedLabel, selectionHints: [], matchedBy: 'canonical' }
  const alias = aliases.get(key)
  if (alias) return { canonicalId: alias, normalizedLabel, selectionHints: [], matchedBy: 'compatibility-alias' }
  const match = suffix.exec(normalizedLabel)
  if (match) {
    const canonicalId = lookup.get(normalizedFeatureIdentityKey(match[1] ?? ''))
    const selectionHints = [...new Set((match[2] ?? '').split(/\s*(?:,|;|\/|\band\b|&)\s*/i).map(value => value.trim()).filter(Boolean))].slice(0, 8)
    if (canonicalId && selectionHints.length) return { canonicalId, normalizedLabel, selectionHints, matchedBy: 'legacy-parameterized' }
  }
  return { canonicalId: null, normalizedLabel, selectionHints: [], matchedBy: 'unresolved' }
}

export const canonicalFeatureReference = (canonicalId: unknown): CanonicalFeatureReference | null => (
  isCanonicalFeatureId(canonicalId) ? CANONICAL_FEATURE_REFERENCE[canonicalId] ?? null : null
)
