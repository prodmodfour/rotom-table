import type { CharacterSheet } from '~/types/characterSheet'

export const BREEDING_READ_ONLY_COMPATIBILITY_FIELDS = Object.freeze([
  'eggMoves',
  'inheritedMoves',
  'inheritedRemaining',
] as const)

export type BreedingReadOnlyCompatibilityField = typeof BREEDING_READ_ONLY_COMPATIBILITY_FIELDS[number]

export class BreedingLegacyCompatibilityValidationError extends Error {
  constructor(
    readonly source: 'current' | 'requested',
    readonly path: string,
    detail: string,
  ) {
    super(`${path}: ${detail}`)
    this.name = 'BreedingLegacyCompatibilityValidationError'
  }
}

interface CloneBudget {
  nodes: number
}

const fail = (
  source: BreedingLegacyCompatibilityValidationError['source'],
  path: string,
  detail: string,
): never => {
  throw new BreedingLegacyCompatibilityValidationError(source, path, detail)
}

const cloneStrictJson = (
  value: unknown,
  source: BreedingLegacyCompatibilityValidationError['source'],
  path: string,
  depth: number,
  budget: CloneBudget,
  ancestors: ReadonlySet<object>,
): unknown => {
  budget.nodes += 1
  if (budget.nodes > 50_000) fail(source, path, 'exceeds the bounded compatibility projection size.')
  if (depth > 32) fail(source, path, 'exceeds the bounded compatibility projection depth.')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(source, path, 'must contain finite JSON numbers only.')
    return value
  }
  if (typeof value !== 'object') return fail(source, path, 'must contain plain JSON data only.')
  if (ancestors.has(value)) return fail(source, path, 'must not contain cycles.')

  const nextAncestors = new Set(ancestors)
  nextAncestors.add(value)
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
      fail(source, path, 'must be an ordinary symbol-free array.')
    }
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== value.length + 1 || !names.includes('length')) {
      fail(source, path, 'must be dense and have no extra properties.')
    }
    const result: unknown[] = []
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        return fail(source, `${path}[${index}]`, 'must be enumerable plain data.')
      }
      result.push(cloneStrictJson(descriptor.value, source, `${path}[${index}]`, depth + 1, budget, nextAncestors))
    }
    return result
  }

  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    fail(source, path, 'must be a plain symbol-free object.')
  }
  const result: Record<string, unknown> = {}
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail(source, `${path}.${key}`, 'must be enumerable plain data.')
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: cloneStrictJson(descriptor.value, source, `${path}.${key}`, depth + 1, budget, nextAncestors),
    })
  }
  return result
}

const shallowPlainRecord = (
  value: CharacterSheet,
  source: BreedingLegacyCompatibilityValidationError['source'],
): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(source, `${source}Sheet`, 'must be one plain sheet object.')
  }
  const prototype = Object.getPrototypeOf(value)
  if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0) {
    return fail(source, `${source}Sheet`, 'must be one plain symbol-free sheet object.')
  }
  const result: Record<string, unknown> = {}
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return fail(source, `${source}Sheet.${key}`, 'must be enumerable plain data.')
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: descriptor.value,
    })
  }
  return result
}

/**
 * Keep legacy inheritance-shaped fields as immutable compatibility projection.
 * A setup save may retain existing rows, but it may neither create, rewrite,
 * nor delete them. Dedicated Breeding hatch and inheritance transactions remain
 * their only production writers.
 */
export const preserveReadOnlyBreedingCompatibilityFields = (
  current: CharacterSheet,
  requested: CharacterSheet,
): CharacterSheet => {
  const currentRecord = shallowPlainRecord(current, 'current')
  const next = shallowPlainRecord(requested, 'requested')

  for (const field of BREEDING_READ_ONLY_COMPATIBILITY_FIELDS) {
    if (!Object.hasOwn(currentRecord, field) || currentRecord[field] === undefined) {
      delete next[field]
      continue
    }
    next[field] = cloneStrictJson(
      currentRecord[field],
      'current',
      `currentSheet.${field}`,
      0,
      { nodes: 0 },
      new Set(),
    )
  }
  return next as unknown as CharacterSheet
}
