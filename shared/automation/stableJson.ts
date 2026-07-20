export interface StableJsonStringifyLimits {
  readonly maxDepth: number
  readonly maxNodes: number
  readonly maxObjectFields: number
  readonly maxArrayEntries: number
  readonly maxStringLength: number
}

export interface StableJsonStringifyOptions {
  readonly path?: string
  readonly limits?: Partial<StableJsonStringifyLimits>
}

export type StableJsonSerializationCode =
  | 'not-json'
  | 'limit-exceeded'

export class StableJsonSerializationError extends Error {
  readonly code: StableJsonSerializationCode
  readonly path: string

  constructor(code: StableJsonSerializationCode, path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'StableJsonSerializationError'
    this.code = code
    this.path = path
  }
}

const DEFAULT_LIMITS: StableJsonStringifyLimits = Object.freeze({
  maxDepth: 128,
  maxNodes: 100_000,
  maxObjectFields: 10_000,
  maxArrayEntries: 100_000,
  maxStringLength: 1_000_000,
})

const ARRAY_INDEX_PATTERN = /^(0|[1-9][0-9]*)$/

type SerializationState = {
  readonly ancestors: WeakSet<object>
  readonly limits: StableJsonStringifyLimits
  nodes: number
}

const fail = (
  code: StableJsonSerializationCode,
  path: string,
  message: string,
): never => {
  throw new StableJsonSerializationError(code, path, message)
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const propertyPath = (path: string, key: string): string => `${path}.${key}`

const resolveLimits = (
  overrides: Partial<StableJsonStringifyLimits> | undefined,
): StableJsonStringifyLimits => {
  const limits = { ...DEFAULT_LIMITS, ...overrides }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Stable JSON ${name} must be a non-negative safe integer.`)
    }
  }
  return limits
}

const enterNode = (
  state: SerializationState,
  path: string,
  depth: number,
): void => {
  if (depth > state.limits.maxDepth) {
    fail(
      'limit-exceeded',
      path,
      `JSON data must be at most ${state.limits.maxDepth} levels deep.`,
    )
  }
  state.nodes += 1
  if (state.nodes > state.limits.maxNodes) {
    fail(
      'limit-exceeded',
      path,
      `JSON data must contain at most ${state.limits.maxNodes} nodes.`,
    )
  }
}

const readEnumerableDataProperty = (
  owner: object,
  key: string,
  path: string,
): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key)
    ?? fail('not-json', path, 'must have a property descriptor.')
  if (!descriptor.enumerable || !('value' in descriptor)) {
    return fail('not-json', path, 'must be an enumerable data property.')
  }
  return (descriptor as PropertyDescriptor & { value: unknown }).value
}

const serializeArray = (
  value: readonly unknown[],
  path: string,
  depth: number,
  state: SerializationState,
): string => {
  if (value.length > state.limits.maxArrayEntries) {
    fail(
      'limit-exceeded',
      path,
      `arrays must contain at most ${state.limits.maxArrayEntries} entries.`,
    )
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('not-json', path, 'symbol properties are not allowed on arrays.')
  }

  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === 'length') continue
    const index = Number(key)
    if (!ARRAY_INDEX_PATTERN.test(key) || !Number.isSafeInteger(index) || index >= value.length) {
      fail('not-json', propertyPath(path, key), 'arrays cannot contain named properties.')
    }
    readEnumerableDataProperty(value, key, `${path}[${key}]`)
  }

  if (state.ancestors.has(value)) {
    fail('not-json', path, 'circular references are not allowed.')
  }
  state.ancestors.add(value)
  const entries: string[] = []
  for (let index = 0; index < value.length; index += 1) {
    const entryPath = `${path}[${index}]`
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      fail('not-json', entryPath, 'sparse arrays are not allowed.')
    }
    entries.push(serializeJsonValue(
      readEnumerableDataProperty(value, String(index), entryPath),
      entryPath,
      depth + 1,
      state,
    ))
  }
  state.ancestors.delete(value)
  return `[${entries.join(',')}]`
}

const serializeRecord = (
  value: Record<string, unknown>,
  path: string,
  depth: number,
  state: SerializationState,
): string => {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail('not-json', path, 'symbol properties are not allowed on objects.')
  }
  const keys = Object.getOwnPropertyNames(value)
  if (keys.length > state.limits.maxObjectFields) {
    fail(
      'limit-exceeded',
      path,
      `objects must contain at most ${state.limits.maxObjectFields} fields.`,
    )
  }

  if (state.ancestors.has(value)) {
    fail('not-json', path, 'circular references are not allowed.')
  }
  state.ancestors.add(value)
  const entries = keys
    .sort((left, right) => left === right ? 0 : left < right ? -1 : 1)
    .map((key) => {
      if (key.length > state.limits.maxStringLength) {
        fail(
          'limit-exceeded',
          propertyPath(path, key),
          `object keys must contain at most ${state.limits.maxStringLength} characters.`,
        )
      }
      const keyPath = propertyPath(path, key)
      return `${JSON.stringify(key)}:${serializeJsonValue(
        readEnumerableDataProperty(value, key, keyPath),
        keyPath,
        depth + 1,
        state,
      )}`
    })
  state.ancestors.delete(value)
  return `{${entries.join(',')}}`
}

const serializeJsonValue = (
  value: unknown,
  path: string,
  depth: number,
  state: SerializationState,
): string => {
  enterNode(state, path, depth)
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') {
    if (value.length > state.limits.maxStringLength) {
      fail(
        'limit-exceeded',
        path,
        `strings must contain at most ${state.limits.maxStringLength} characters.`,
      )
    }
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('not-json', path, 'non-finite numbers are not JSON values.')
    }
    return JSON.stringify(value)
  }
  if (
    value === undefined
    || typeof value === 'bigint'
    || typeof value === 'function'
    || typeof value === 'symbol'
  ) {
    return fail('not-json', path, `${typeof value} values are not allowed in JSON data.`)
  }
  if (Array.isArray(value)) return serializeArray(value, path, depth, state)
  if (!isPlainRecord(value)) {
    return fail('not-json', path, 'only plain JSON objects are allowed.')
  }
  return serializeRecord(value, path, depth, state)
}

/**
 * Serialize strict JSON data deterministically without invoking accessors or
 * `toJSON`. Object keys use deterministic UTF-16 code-unit ordering; array
 * order remains semantic.
 */
export const stableJsonStringify = (
  value: unknown,
  options: StableJsonStringifyOptions = {},
): string => serializeJsonValue(value, options.path ?? 'value', 0, {
  ancestors: new WeakSet<object>(),
  limits: resolveLimits(options.limits),
  nodes: 0,
})
