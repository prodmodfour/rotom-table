import { describe, expect, it } from 'vitest'
import {
  orderOptionsForPlacement,
  trainerOrderOptionsForSheet,
} from '~/utils/mapTokenOrders'
import type { TrainerSheet } from '~/types/trainerSheet'

describe('map token order menu options', () => {
  it('uses custom sheet orders and enriches matching PTU orders from reference data', () => {
    const [custom, mobilize] = trainerOrderOptionsForSheet({
      slug: 'trainer',
      name: 'Trainer',
      level: 1,
      orders: [
        { name: 'Soothe', tags: ['Orders'], effect: 'Calm a nervous Pokémon.' },
        { name: 'Mobilize' },
      ],
    })

    expect(custom).toMatchObject({
      name: 'Soothe',
      tags: ['Orders'],
      effect: 'Calm a nervous Pokémon.',
      source: 'sheet-order',
    })
    expect(mobilize).toMatchObject({
      name: 'Mobilize',
      tags: ['Orders'],
      frequency: 'At-Will – Free Action',
      target: 'Any Ally',
      effect: expect.stringContaining('Attacks of Opportunity'),
    })
  })

  it('adds order-capable trainer features without duplicating manual order rows', () => {
    const options = trainerOrderOptionsForSheet({
      slug: 'trainer',
      name: 'Trainer',
      level: 1,
      orders: [{ name: 'Agility Training', effect: 'Manual override.' }],
      trainingFeature: 'Focused Training',
      features: [
        { name: 'Agility Training' },
        { name: 'Inspired Training' },
        { name: 'Complex Orders' },
      ],
    })

    expect(options.map((order) => order.name)).toEqual([
      'Agility Training',
      'Focused Training',
      'Inspired Training',
    ])
    expect(options[0]).toMatchObject({ source: 'sheet-order', effect: 'Manual override.' })
    expect(options[1]).toMatchObject({ sourceLabel: 'Training Feature', effect: expect.stringContaining('Focused') })
    expect(options[2]).toMatchObject({
      source: 'feature',
      tags: ['Orders', 'Training'],
      effect: expect.stringContaining('Inspired'),
    })
  })

  it('expands static order-granting features from their embedded reference definitions', () => {
    const options = trainerOrderOptionsForSheet({
      slug: 'commander',
      name: 'Commander',
      level: 1,
      features: [{ name: 'Ravager Orders' }],
    })

    expect(options.map((order) => order.name)).toEqual(['Reckless Advance', 'Strike Again!'])
    expect(options[0]).toMatchObject({
      source: 'granted-feature',
      sourceLabel: 'Ravager Orders',
      tags: ['Orders', 'Stratagem'],
      frequency: 'Bind 2 AP – Standard Action',
      target: 'Your Pokémon',
      effect: expect.stringContaining('melee attacks'),
    })
    expect(options[1]).toMatchObject({
      frequency: 'Scene – Standard Action',
      effect: expect.stringContaining('additional Standard Action'),
    })
  })

  it('pulls order options only from trainer placements', () => {
    const trainerSheet = {
      slug: 'trainer',
      name: 'Trainer',
      level: 1,
      orders: [{ name: 'Soothe' }],
    } as TrainerSheet
    const lookup = {
      trainer: new Map([[trainerSheet.slug, trainerSheet]]),
    }

    expect(orderOptionsForPlacement({ sheetKind: 'pokemon', sheetSlug: 'pikachu' }, lookup)).toEqual([])
    expect(orderOptionsForPlacement({ sheetKind: 'trainer', sheetSlug: 'trainer' }, lookup))
      .toMatchObject([{ name: 'Soothe' }])
  })
})
