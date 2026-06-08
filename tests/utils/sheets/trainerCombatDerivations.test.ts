import { describe, expect, it } from 'vitest'
import {
  deriveTrainerAutomaticAbilities,
  deriveTrainerAutomaticMoves,
} from '~/utils/sheets/trainerCombatDerivations'
import { trainerOrderOptionsForSheet } from '~/utils/mapTokenOrders'
import { trainerAbilityEntriesForSheet } from '~/utils/mapTokenAbilities'
import { trainerMoveEntriesForSheet } from '~/utils/mapTokenMoves'
import type { TrainerSheet } from '~/types/trainerSheet'

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'trainer',
  name: 'Trainer',
  level: 1,
  ...overrides,
})

describe('trainer combat derivations', () => {
  it('derives trainer moves from selected trainer features, class features, and edges', () => {
    const sheet = trainer({
      classes: [{ name: 'Provocateur' }],
      features: [
        { name: 'Aura Guardian', choices: { move: 'Detect', move2: 'Force Palm' } },
        { name: 'Weather Systems', choices: { move: 'Rain Dance' } },
      ],
      edges: [{ name: 'Athletic Initiative' }, { name: 'Basic Martial Arts' }],
      movelist: [{ name: 'Detect' }],
    })

    expect(deriveTrainerAutomaticMoves(sheet).map((move) => move.entry.name)).toEqual([
      'Force Palm',
      'Sweet Kiss',
      'Taunt',
      'Agility',
      'Rock Smash',
    ])
  })

  it('derives trainer abilities without treating Pokémon-targeted feature choices as trainer abilities', () => {
    const sheet = trainer({
      features: [
        { name: 'Martial Artist', choices: { ability: 'Iron Fist' } },
        { name: 'Effective Methods', choices: { ability: 'Exploit' } },
        { name: 'Climatology' },
      ],
    })

    expect(deriveTrainerAutomaticAbilities(sheet).map((ability) => ability.entry.name)).toEqual([
      'Iron Fist',
      'Overcoat',
    ])
  })

  it('feeds derived moves and abilities into map token action menus', () => {
    const sheet = trainer({
      features: [
        { name: 'Aura Guardian', choices: { move: 'Detect', move2: 'Force Palm' } },
        { name: 'Martial Artist', choices: { ability: 'Iron Fist' } },
      ],
    })

    expect(trainerMoveEntriesForSheet(sheet)).toEqual(expect.arrayContaining([
      { move: { name: 'Detect' }, automatic: true },
      { move: { name: 'Force Palm' }, automatic: true },
    ]))
    expect(trainerAbilityEntriesForSheet(sheet).map((ability) => ability.name)).toContain('Iron Fist')
  })

  it('derives combat orders from feature subchoices', () => {
    const options = trainerOrderOptionsForSheet(trainer({
      features: [
        { name: 'Commander', choices: { orderFeature: 'Ravager Orders' } },
        { name: 'Elite Trainer', choices: { trainingFeature: 'Focused Training' } },
      ],
    }))

    expect(options.map((order) => order.name)).toEqual([
      'Reckless Advance',
      'Strike Again!',
      'Focused Training',
    ])
  })
})
