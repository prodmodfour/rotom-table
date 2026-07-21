import { describe, expect, it } from 'vitest'
import {
  AbilityPassiveProviderValidationError,
  aggregateAbilityPassiveProviders,
  applyNumericAbilityPassiveProviderGroup,
  parseAbilityPassiveProviders,
  type AbilityPassiveProvider,
  type AbilityPassiveProviderAttribute,
  type AbilityPassiveProviderDomain,
  type AbilityPassiveProviderOperation,
  type AbilityPassiveProviderValue,
  type AbilityPassiveStackingGroup,
  type AbilityPassiveStackingPolicy,
} from '#shared/abilityAutomation/passiveProviders'

const provider = (input: {
  readonly id: string
  readonly domain?: AbilityPassiveProviderDomain
  readonly attribute?: AbilityPassiveProviderAttribute
  readonly group?: AbilityPassiveStackingGroup
  readonly operation?: AbilityPassiveProviderOperation
  readonly value?: AbilityPassiveProviderValue
  readonly policy?: AbilityPassiveStackingPolicy
  readonly priority?: number
  readonly scopeKey?: string
}): AbilityPassiveProvider => ({
  schemaVersion: 1,
  providerId: input.id,
  abilityInstanceId: `ability:${input.id}`,
  canonicalId: 'Battle Armor',
  sourcePlacementId: 'actor-token',
  scopeKey: input.scopeKey ?? 'placement:actor-token',
  domain: input.domain ?? 'stat',
  attribute: input.attribute ?? 'stat.attack',
  operation: input.operation ?? 'add',
  value: input.value ?? 1,
  priority: input.priority ?? 0,
  stackingGroup: input.group ?? 'stat.base',
  stackingPolicy: input.policy ?? 'stack',
  reasonCode: `ability.passive.${input.id}`,
})

const expectProviderError = (callback: () => unknown, code: string): void => {
  try {
    callback()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityPassiveProviderValidationError)
    expect((error as AbilityPassiveProviderValidationError).code).toBe(code)
  }
}

describe('ability passive provider aggregation', () => {
  it('applies ordered numeric stacks independent of input order', () => {
    const add = provider({ id: 'add', priority: 10, value: 3 })
    const multiply = provider({ id: 'multiply', priority: 20, operation: 'multiply', value: 2 })
    const forward = aggregateAbilityPassiveProviders([multiply, add])
    const reverse = aggregateAbilityPassiveProviders([add, multiply])

    expect(forward).toEqual(reverse)
    expect(forward[0]?.providers.map(entry => entry.providerId)).toEqual(['add', 'multiply'])
    expect(applyNumericAbilityPassiveProviderGroup(5, forward[0]!)).toBe(16)
    expect(Object.isFrozen(forward)).toBe(true)
    expect(Object.isFrozen(forward[0]!.providers)).toBe(true)
  })

  it('resolves highest, lowest, priority, union, and exclusive policies explicitly', () => {
    const highest = aggregateAbilityPassiveProviders([
      provider({ id: 'high-3', policy: 'highest', value: 3 }),
      provider({ id: 'high-8', policy: 'highest', value: 8 }),
    ])[0]!
    expect(highest.providers.map(entry => entry.providerId)).toEqual(['high-8'])

    const lowest = aggregateAbilityPassiveProviders([
      provider({ id: 'low-3', policy: 'lowest', value: 3 }),
      provider({ id: 'low-8', policy: 'lowest', value: 8 }),
    ])[0]!
    expect(lowest.providers.map(entry => entry.providerId)).toEqual(['low-3'])

    const priority = aggregateAbilityPassiveProviders([
      provider({ id: 'priority-low', operation: 'grant', value: true, policy: 'priority', priority: 1 }),
      provider({ id: 'priority-high', operation: 'deny', value: false, policy: 'priority', priority: 9 }),
    ])[0]!
    expect(priority.providers.map(entry => entry.providerId)).toEqual(['priority-high'])

    const union = aggregateAbilityPassiveProviders([
      provider({
        id: 'union-b', domain: 'immunity', attribute: 'immunity.type', group: 'immunity.conditional',
        operation: 'grant', value: ['water', 'fire'], policy: 'union',
      }),
      provider({
        id: 'union-a', domain: 'immunity', attribute: 'immunity.type', group: 'immunity.conditional',
        operation: 'grant', value: ['electric', 'fire'], policy: 'union',
      }),
    ])[0]!
    expect(union.unionValues).toEqual(['electric', 'fire', 'water'])

    const exclusive = aggregateAbilityPassiveProviders([
      provider({ id: 'exclusive', operation: 'grant', value: 'sun', policy: 'exclusive' }),
    ])[0]!
    expect(exclusive.providers).toHaveLength(1)
  })

  it('covers every closed passive provider domain and stable stacking family', () => {
    const providers = [
      provider({ id: 'stat', domain: 'stat', attribute: 'stat.attack', group: 'stat.base' }),
      provider({ id: 'damage', domain: 'damage', attribute: 'damage.outgoing', group: 'damage.outgoing' }),
      provider({ id: 'accuracy', domain: 'accuracy', attribute: 'accuracy.attack', group: 'accuracy.roll' }),
      provider({ id: 'evasion', domain: 'evasion', attribute: 'evasion.physical', group: 'evasion.value' }),
      provider({
        id: 'immunity', domain: 'immunity', attribute: 'immunity.move', group: 'immunity.absolute',
        operation: 'grant', value: 'powder', policy: 'union',
      }),
      provider({ id: 'movement', domain: 'movement', attribute: 'movement.overland', group: 'movement.speed' }),
      provider({
        id: 'side', domain: 'side', attribute: 'side.condition', group: 'side.condition',
        operation: 'grant', value: 'reflect', policy: 'union', scopeKey: 'side:red',
      }),
      provider({
        id: 'field', domain: 'field', attribute: 'field.weather', group: 'field.condition',
        operation: 'grant', value: 'sun', policy: 'union', scopeKey: 'field:map',
      }),
    ]
    const groups = aggregateAbilityPassiveProviders(providers)

    expect(new Set(groups.map(group => group.domain))).toEqual(new Set([
      'stat', 'damage', 'accuracy', 'evasion', 'immunity', 'movement', 'side', 'field',
    ]))
    expect(groups).toEqual(aggregateAbilityPassiveProviders([...providers].reverse()))
  })

  it('fails closed on policy disagreements and exclusive collisions', () => {
    expectProviderError(() => aggregateAbilityPassiveProviders([
      provider({ id: 'stack', policy: 'stack' }),
      provider({ id: 'highest', policy: 'highest' }),
    ]), 'stacking-policy-conflict')

    expectProviderError(() => aggregateAbilityPassiveProviders([
      provider({ id: 'exclusive-a', operation: 'grant', value: true, policy: 'exclusive' }),
      provider({ id: 'exclusive-b', operation: 'grant', value: true, policy: 'exclusive' }),
    ]), 'exclusive-provider-conflict')
  })

  it('rejects duplicates, cross-domain groups, invalid values, callbacks, and unknown fields', () => {
    const valid = provider({ id: 'valid' })
    expectProviderError(() => parseAbilityPassiveProviders([valid, valid]), 'duplicate-provider-id')
    expectProviderError(() => parseAbilityPassiveProviders([{
      ...valid,
      stackingGroup: 'damage.outgoing',
    }]), 'invalid-provider')
    expectProviderError(() => parseAbilityPassiveProviders([{
      ...valid,
      value: Number.NaN,
    }]), 'not-json')
    expectProviderError(() => parseAbilityPassiveProviders([{
      ...valid,
      callback: () => true,
    }]), 'not-json')
    expectProviderError(() => parseAbilityPassiveProviders([{
      ...valid,
      unknown: true,
    }]), 'invalid-provider')
  })

  it('detaches and freezes accepted values without normalizing semantic provider order', () => {
    const source = [provider({ id: 'source', value: 2 })]
    const parsed = parseAbilityPassiveProviders(source)
    ;(source[0] as { value: number }).value = 99

    expect(parsed[0]?.value).toBe(2)
    expect(parsed).not.toBe(source)
    expect(Object.isFrozen(parsed)).toBe(true)
  })
})
