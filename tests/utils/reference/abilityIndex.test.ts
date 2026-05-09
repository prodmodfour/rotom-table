import { describe, expect, it } from 'vitest'
import {
  abilityMatchesSearch,
  filterAbilitiesForIndex,
} from '~/utils/reference/abilityIndex'
import type { PtuAbility } from '~/types/ptuReference'

const ability = (overrides: Partial<PtuAbility> & Pick<PtuAbility, 'name'>): PtuAbility => ({
  name: overrides.name,
  frequency: overrides.frequency,
  trigger: overrides.trigger,
  effect: overrides.effect,
})

const sampleAbilities: PtuAbility[] = [
  ability({
    name: 'Overgrow',
    frequency: 'Static',
    effect: 'Grass-type Moves deal additional damage at low HP.',
  }),
  ability({
    name: 'Intimidate',
    frequency: 'Scene – Free Action',
    trigger: 'A foe comes within range.',
    effect: 'Lower the target\'s Attack.',
  }),
  ability({
    name: 'Pickup',
    frequency: 'Daily',
    effect: 'Find a useful item after an encounter.',
  }),
]

describe('ability index helpers', () => {
  it('matches ability search haystacks', () => {
    expect(abilityMatchesSearch(sampleAbilities[0]!, 'grass-type')).toBe(true)
    expect(abilityMatchesSearch(sampleAbilities[1]!, 'free action')).toBe(true)
    expect(abilityMatchesSearch(sampleAbilities[1]!, 'foe')).toBe(true)
    expect(abilityMatchesSearch(sampleAbilities[2]!, 'missing')).toBe(false)
  })

  it('filters by search term while preserving source order', () => {
    expect(filterAbilitiesForIndex(sampleAbilities, { searchTerm: 'action' }).map((a) => a.name)).toEqual([
      'Intimidate',
    ])
    expect(filterAbilitiesForIndex(sampleAbilities, { searchTerm: 'item' }).map((a) => a.name)).toEqual([
      'Pickup',
    ])
    expect(filterAbilitiesForIndex(sampleAbilities, {}).map((a) => a.name)).toEqual([
      'Overgrow',
      'Intimidate',
      'Pickup',
    ])
  })
})
