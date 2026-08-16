import { describe, expect, it } from 'vitest'
import {
  ItemIdentityError,
  createItemIdentityRegistry,
  normalizeItemAliasIdentity,
} from '#shared/itemAutomation/identity'

const expectIdentityError = (work: () => unknown, code: ItemIdentityError['code']): void => {
  try {
    work()
    throw new Error('Expected item identity resolution to fail.')
  }
  catch (error) {
    expect(error).toBeInstanceOf(ItemIdentityError)
    expect((error as ItemIdentityError).code).toBe(code)
  }
}

describe('reviewed canonical item identity', () => {
  it('resolves only exact canonical names and reviewed aliases', () => {
    const registry = createItemIdentityRegistry([
      { canonicalId: 'Basic Ball', aliases: ['Poké Ball', 'Poke Ball'] },
      { canonicalId: 'Shuckle’s Berry Juice', aliases: [] },
    ])

    expect(registry.resolve('Basic Ball')).toBe('Basic Ball')
    expect(registry.resolve(' poké ball ')).toBe('Basic Ball')
    expect(registry.resolve("Shuckle's Berry Juice")).toBe('Shuckle’s Berry Juice')
    expect(registry.resolve('Basic-Ball')).toBeNull()
    expect(registry.resolve('Basic  Ball')).toBeNull()
    expect(registry.resolve('basicball')).toBeNull()
    expect(registry.resolve('Ball')).toBeNull()
  })

  it('fails closed on unknown, ambiguous, duplicate, blank, and control-character identities', () => {
    const registry = createItemIdentityRegistry([{ canonicalId: 'Potion', aliases: [] }])
    expectIdentityError(() => registry.require('Potion-ish'), 'missing')
    expectIdentityError(() => createItemIdentityRegistry([
      { canonicalId: 'One', aliases: ['Shared'] },
      { canonicalId: 'Two', aliases: ['shared'] },
    ]), 'ambiguous')
    expectIdentityError(() => createItemIdentityRegistry([
      { canonicalId: 'One', aliases: [] },
      { canonicalId: 'One', aliases: [] },
    ]), 'ambiguous')
    expectIdentityError(() => createItemIdentityRegistry([{ canonicalId: ' ', aliases: [] }]), 'missing')
    expectIdentityError(() => createItemIdentityRegistry([{ canonicalId: 'One', aliases: ['bad\nname'] }]), 'missing')
  })

  it('uses deterministic Unicode/apostrophe case folding without fuzzy punctuation removal', () => {
    expect(normalizeItemAliasIdentity('  King’s Rock  ')).toBe("king's rock")
    expect(normalizeItemAliasIdentity("KING'S ROCK")).toBe("king's rock")
    expect(normalizeItemAliasIdentity('Kings Rock')).toBe('kings rock')
  })
})
