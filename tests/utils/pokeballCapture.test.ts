import { describe, expect, it } from 'vitest'
import {
  applyPokeballCaptureOutcomeToPokemonSheet,
  applyPokeballCaptureOutcomeToTrainerSheet,
  buildTrainerPokeballOptions,
  resolvePokeballItem,
} from '~/utils/pokeballCapture'
import { pokemonCaughtBallName } from '~/utils/sheets/pokemonCaughtBall'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'trainer',
  name: 'Trainer',
  level: 1,
  ...overrides,
})

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'pidgey',
  nickname: 'Pidgey',
  species: 'Pidgey',
  level: 5,
  ...overrides,
})

describe('pokeballCapture inventory helpers', () => {
  it('finds Poké Balls from any trainer inventory section', () => {
    const sheet = trainer({
      inventory: {
        keyItems: [
          {
            name: 'Basic Ball',
            qty: 100,
            cost: '$250',
            description: 'Capture Modifier +0. Basic Poké Ball; often called just a “Poké Ball”.',
          },
        ],
        pokeBalls: [{ name: 'Basic Ball', qty: 0, mod: '+0' }],
      },
    })

    expect(buildTrainerPokeballOptions(sheet)).toEqual([
      expect.objectContaining({
        name: 'Basic Ball',
        quantity: 100,
        rollModifier: 0,
      }),
    ])
  })

  it('accepts common plural Poké Ball labels from sheets', () => {
    expect(resolvePokeballItem('Basic Balls')?.name).toBe('Basic Ball')
    expect(resolvePokeballItem('Poke Balls')?.name).toBe('Basic Ball')

    const sheet = trainer({
      inventory: {
        pokeBalls: [{ name: 'Basic Balls', qty: 2 }],
      },
    })

    expect(buildTrainerPokeballOptions(sheet)).toEqual([
      expect.objectContaining({
        name: 'Basic Ball',
        quantity: 2,
      }),
    ])
  })

  it('defaults existing Pokémon sheets to Basic Ball for display', () => {
    expect(pokemonCaughtBallName(pokemon())).toBe('Basic Ball')
  })

  it('records the successful capture ball on the Pokémon sheet', () => {
    const sheet = pokemon()

    const changed = applyPokeballCaptureOutcomeToPokemonSheet(sheet, {
      pokeballName: 'Great Ball',
      result: { success: true },
    } as Parameters<typeof applyPokeballCaptureOutcomeToPokemonSheet>[1])

    expect(changed).toBe(true)
    expect(sheet.caughtBall).toBe('Great Ball')
  })

  it('does not record missed or failed capture balls on the Pokémon sheet', () => {
    const sheet = pokemon({ caughtBall: 'Basic Ball' })

    const changed = applyPokeballCaptureOutcomeToPokemonSheet(sheet, {
      pokeballName: 'Ultra Ball',
      result: { success: false },
    } as Parameters<typeof applyPokeballCaptureOutcomeToPokemonSheet>[1])

    expect(changed).toBe(false)
    expect(sheet.caughtBall).toBe('Basic Ball')
  })

  it('consumes Poké Balls from the section where they were recorded', () => {
    const sheet = trainer({
      inventory: {
        keyItems: [{ name: 'Basic Ball', qty: 3 }],
        pokeBalls: [{ name: 'Great Ball', qty: 1 }],
      },
    })

    const result = applyPokeballCaptureOutcomeToTrainerSheet(sheet, {
      pokeballName: 'Basic Ball',
      targetSlug: 'pidgey',
      result: { success: false },
    } as Parameters<typeof applyPokeballCaptureOutcomeToTrainerSheet>[1])

    expect(result.consumed).toBe(true)
    expect(sheet.inventory?.keyItems?.[0]?.qty).toBe(2)
    expect(sheet.inventory?.pokeBalls?.[0]?.qty).toBe(1)
  })
})
