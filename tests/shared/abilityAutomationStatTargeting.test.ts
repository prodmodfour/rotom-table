import { describe, expect, it } from 'vitest'
import {
  AbilityStatOptionsPredicateValidationError,
  parseAbilityStatOptionsPredicate,
} from '#shared/abilityAutomation/statTargeting'

describe('ability stat option targeting predicate', () => {
  it('strictly parses, detaches, and freezes a canonical stat subset', () => {
    const source = {
      kind: 'ability-stat-options',
      statIds: ['attack', 'defense', 'special-attack', 'special-defense', 'speed'],
    }
    const parsed = parseAbilityStatOptionsPredicate(source)
    source.statIds[0] = 'hp'
    expect(parsed.statIds).toEqual(['attack', 'defense', 'special-attack', 'special-defense', 'speed'])
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.statIds)).toBe(true)
  })

  it.each([
    { kind: 'ability-stat-options', statIds: ['speed', 'attack'] },
    { kind: 'ability-stat-options', statIds: ['attack', 'luck'] },
    { kind: 'ability-stat-options', statIds: [], extra: true },
  ])('fails closed on unknown, unordered, or extra mechanics: %#', (value) => {
    expect(() => parseAbilityStatOptionsPredicate(value)).toThrow(AbilityStatOptionsPredicateValidationError)
  })
})
