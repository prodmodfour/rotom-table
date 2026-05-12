import { describe, expect, it } from 'vitest'
import {
  deepCloneJson,
  omitUndefinedJsonFields,
  sameJsonValue,
  stableJsonStringify,
} from '~/utils/serialization'

describe('JSON serialization helpers', () => {
  it('sorts object keys recursively for stable comparisons', () => {
    const a = { b: 1, a: { d: 4, c: 3 } }
    const b = { a: { c: 3, d: 4 }, b: 1 }

    expect(stableJsonStringify(a)).toBe('{"a":{"c":3,"d":4},"b":1}')
    expect(stableJsonStringify(a)).toBe(stableJsonStringify(b))
    expect(sameJsonValue(a, b)).toBe(true)
  })

  it('omits undefined object fields while preserving JSON array semantics', () => {
    expect(stableJsonStringify({ a: undefined, b: 2 })).toBe('{"b":2}')
    expect(stableJsonStringify([undefined, 2])).toBe('[null,2]')
    expect(omitUndefinedJsonFields({ a: undefined, b: 2 })).toEqual({ b: 2 })
  })

  it('deep-clones JSON values without retaining nested references', () => {
    const original = { nested: { value: 1 } }
    const clone = deepCloneJson(original)
    clone.nested.value = 2

    expect(original.nested.value).toBe(1)
    expect(clone).toEqual({ nested: { value: 2 } })
  })
})
