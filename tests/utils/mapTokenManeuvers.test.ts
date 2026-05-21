import { describe, expect, it } from 'vitest'
import { maneuverOptionsForPlacement, trainerManeuverOptionsForSheet } from '~/utils/mapTokenManeuvers'
import type { TrainerSheet } from '~/types/trainerSheet'

describe('map token maneuver options', () => {
  it('offers reference maneuvers for Pokémon tokens', () => {
    const options = maneuverOptionsForPlacement(
      { sheetKind: 'pokemon', sheetSlug: 'pika' },
      {},
    )

    expect(options.map((option) => option.name)).toContain('Trip')
    expect(options.find((option) => option.name === 'Trip')).toMatchObject({
      action: 'Standard',
      ac: 6,
      range: 'Melee, 1 Target',
      source: 'reference',
    })
  })

  it('lets trainer sheet maneuvers override reference display data and add custom maneuvers', () => {
    const sheet = {
      slug: 'trainer',
      name: 'Trainer',
      level: 1,
      maneuvers: [
        { name: 'Trip', action: 'Free', category: 'Status', ac: 5, effect: 'Trip with style.' },
        { name: 'Pocket Sand', action: 'Standard', category: 'Status', ac: 4, range: 'Melee, 1 Target' },
      ],
    } as TrainerSheet

    const options = trainerManeuverOptionsForSheet(sheet)

    expect(options.find((option) => option.name === 'Trip')).toMatchObject({
      action: 'Free',
      ac: 5,
      maneuverClass: 'Status',
      effect: 'Trip with style.',
      source: 'sheet',
    })
    expect(options.find((option) => option.name === 'Pocket Sand')).toMatchObject({
      category: 'Combat Maneuver',
      source: 'sheet',
    })
  })
})
