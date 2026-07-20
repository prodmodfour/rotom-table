export type StrictJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly StrictJsonValue[]
  | StrictJsonObject

export type StrictJsonObject = {
  readonly [key: string]: StrictJsonValue
}

export interface StrictJsonLimits {
  readonly depth: number
  readonly nodes: number
  readonly objectFields: number
  readonly arrayEntries: number
  readonly stringLength: number
  readonly objectKeyLength: number
}

export interface StrictJsonCloneOptions {
  readonly limits: StrictJsonLimits
  readonly rootLabel: string
  readonly valueLabel: string
  readonly failNotJson: (path: string, detail: string) => never
  readonly failLimit: (path: string, detail: string) => never
}

type CloneState = {
  readonly ancestors: WeakSet<object>
  nodes: number
}

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const ARRAY_INDEX_PATTERN = /^(0|[1-9][0-9]*)$/

export const isPlainJsonObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const propertyPath = (path: string, key: string): string => `${path}.${key}`

const cloneNode = (
  value: unknown,
  path: string,
  depth: number,
  state: CloneState,
  options: StrictJsonCloneOptions,
): StrictJsonValue => {
  state.nodes += 1
  if (state.nodes > options.limits.nodes) {
    options.failLimit(
      path,
      `${options.rootLabel} must contain at most ${options.limits.nodes} JSON nodes.`,
    )
  }
  if (depth > options.limits.depth) {
    options.failLimit(
      path,
      `${options.rootLabel} must be at most ${options.limits.depth} levels deep.`,
    )
  }

  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (value.length > options.limits.stringLength) {
      options.failLimit(path, `must contain at most ${options.limits.stringLength} characters.`)
    }
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) options.failNotJson(path, 'non-finite numbers are not JSON values.')
    return value
  }
  if (
    value === undefined
    || typeof value === 'bigint'
    || typeof value === 'function'
    || typeof value === 'symbol'
  ) {
    return options.failNotJson(path, `${typeof value} values are not allowed in ${options.valueLabel}.`)
  }

  if (Array.isArray(value)) {
    if (state.ancestors.has(value)) options.failNotJson(path, 'circular references are not allowed.')
    if (value.length > options.limits.arrayEntries) {
      options.failLimit(path, `must contain at most ${options.limits.arrayEntries} entries.`)
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      options.failNotJson(path, 'symbol properties are not allowed.')
    }
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === 'length') continue
      const index = Number(key)
      if (!ARRAY_INDEX_PATTERN.test(key) || !Number.isSafeInteger(index) || index >= value.length) {
        options.failNotJson(propertyPath(path, key), 'arrays cannot contain named properties.')
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        options.failNotJson(`${path}[${key}]`, 'array entries must be enumerable data properties.')
      }
    }

    state.ancestors.add(value)
    const clone: StrictJsonValue[] = []
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        options.failNotJson(`${path}[${index}]`, 'sparse arrays are not allowed.')
      }
      clone.push(cloneNode(value[index], `${path}[${index}]`, depth + 1, state, options))
    }
    state.ancestors.delete(value)
    return clone
  }

  if (!isPlainJsonObject(value)) {
    return options.failNotJson(path, 'only plain JSON objects are allowed.')
  }
  if (state.ancestors.has(value)) options.failNotJson(path, 'circular references are not allowed.')
  if (Object.getOwnPropertySymbols(value).length > 0) {
    options.failNotJson(path, 'symbol properties are not allowed.')
  }

  const keys = Object.getOwnPropertyNames(value)
  if (keys.length > options.limits.objectFields) {
    options.failLimit(path, `must contain at most ${options.limits.objectFields} fields.`)
  }

  state.ancestors.add(value)
  const clone: Record<string, StrictJsonValue> = {}
  for (const key of keys) {
    const keyPath = propertyPath(path, key)
    if (
      key.length === 0
      || key.length > options.limits.objectKeyLength
      || CONTROL_CHARACTER_PATTERN.test(key)
    ) {
      options.failNotJson(keyPath, 'object keys must be non-empty, bounded, and free of control characters.')
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
      ?? options.failNotJson(keyPath, 'object fields must have property descriptors.')
    if (!descriptor.enumerable || !('value' in descriptor)) {
      options.failNotJson(keyPath, 'object fields must be enumerable data properties.')
    }
    const descriptorValue = (descriptor as PropertyDescriptor & { value: unknown }).value
    Object.defineProperty(clone, key, {
      value: cloneNode(descriptorValue, keyPath, depth + 1, state, options),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  state.ancestors.delete(value)
  return clone
}

/** Detach untrusted input without getters, toJSON hooks, sparse arrays, or lossy values. */
export const cloneStrictJson = (
  value: unknown,
  path: string,
  options: StrictJsonCloneOptions,
): StrictJsonValue => cloneNode(value, path, 0, {
  ancestors: new WeakSet<object>(),
  nodes: 0,
}, options)

export const deepFreezeStrictJson = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreezeStrictJson((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}
