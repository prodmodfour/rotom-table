import { describe, expect, it } from 'vitest'
import {
  AuthoritativeAbilityRandomError,
  createAuthoritativeAbilityRandom,
  createFiniteAuthoritativeAbilityRandomStream,
} from '../../server/domain/abilityAutomation/random'
import { parseAbilityAutomationRollLedger } from '#shared/abilityAutomation/random'

describe('authoritative ability randomness', () => {
  it('records stable server-owned rolls through the shared deterministic kernel', () => {
    const stream = createFiniteAuthoritativeAbilityRandomStream([0.5, 0.75])
    const random = createAuthoritativeAbilityRandom(stream)

    expect(random.roll({
      rollId: 'roll.ability-check',
      parentEffectId: 'operation.effect-check',
      reason: 'Ability check',
      formula: { kind: 'dice', count: 2, sides: 6, modifier: 1 },
      modifiers: [{ sourceId: 'ability.modifier', reason: 'Ability modifier', value: 2 }],
    })).toEqual({
      naturalResults: [4, 5],
      naturalResult: 9,
      modifiedResult: 12,
      finalValue: 12,
    })

    const ledger = random.complete()
    expect(parseAbilityAutomationRollLedger(ledger)).toEqual(ledger)
    expect(ledger[0]).toMatchObject({
      rollId: 'roll.ability-check',
      parentEffectId: 'operation.effect-check',
      naturalResults: [4, 5],
      finalValue: 12,
    })
    expect(Object.isFrozen(ledger)).toBe(true)
    expect(Object.isFrozen(ledger[0]!.modifiers)).toBe(true)
  })

  it('rejects missing/excess draws, duplicate IDs, and post-completion draws with ability errors', () => {
    const missing = createAuthoritativeAbilityRandom(
      createFiniteAuthoritativeAbilityRandomStream([]),
    )
    expect(() => missing.roll({
      rollId: 'roll.missing',
      parentEffectId: 'effect.missing',
      reason: 'Missing',
      formula: { kind: 'dice', count: 1, sides: 6, modifier: 0 },
    })).toThrowError(expect.objectContaining({
      name: 'AuthoritativeAbilityRandomError',
      code: 'missing-random-draw',
    }))

    const excess = createAuthoritativeAbilityRandom(
      createFiniteAuthoritativeAbilityRandomStream([0, 0.5]),
    )
    excess.roll({
      rollId: 'roll.one',
      parentEffectId: 'effect.one',
      reason: 'One',
      formula: { kind: 'dice', count: 1, sides: 6, modifier: 0 },
    })
    expect(() => excess.complete()).toThrowError(expect.objectContaining({
      code: 'excess-random-draws',
    }))

    const duplicate = createAuthoritativeAbilityRandom(() => 0)
    const request = {
      rollId: 'roll.duplicate',
      parentEffectId: 'effect.duplicate',
      reason: 'Duplicate',
      formula: { kind: 'dice' as const, count: 1, sides: 6, modifier: 0 },
    }
    duplicate.roll(request)
    expect(() => duplicate.roll(request)).toThrowError(expect.objectContaining({
      code: 'duplicate-roll-id',
    }))

    const completed = createAuthoritativeAbilityRandom(
      createFiniteAuthoritativeAbilityRandomStream([]),
    )
    completed.complete()
    expect(() => completed.roll({ ...request, rollId: 'roll.after-complete' }))
      .toThrowError(AuthoritativeAbilityRandomError)
  })

  it('translates invalid finite entropy at the ability boundary', () => {
    expect(() => createFiniteAuthoritativeAbilityRandomStream([1]))
      .toThrowError(expect.objectContaining({
        name: 'AuthoritativeAbilityRandomError',
        code: 'invalid-random-source-value',
      }))
  })
})
