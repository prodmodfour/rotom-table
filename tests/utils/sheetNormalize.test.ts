import { describe, expect, it } from 'vitest'
import { normalizeTrainerSheet } from '~/utils/sheetNormalize'
import type { TrainerSheet } from '~/types/trainerSheet'

const legacyAllFishingRodsDescription = 'Fishing Rods are used to Fish. They are two-handed items. They come in three varieties; Old Rods, Good Rods, and Super Rods. Old Rods cost $1000, Good Rods cost $5,000, and Super Rods cost $15,000.'
const legacyAllFishingRodsCost = 'Old Rods cost $1000, Good Rods cost $5,000, and Super Rods cost $15,000'

describe('sheetNormalize', () => {
  it('repairs legacy all-rod descriptions when trainer inventory opens', () => {
    const sheet: TrainerSheet = {
      slug: 'angler',
      name: 'Angler',
      level: 1,
      inventory: {
        equipment: [
          {
            name: 'Old Rod',
            cost: legacyAllFishingRodsCost,
            description: legacyAllFishingRodsDescription,
          },
        ],
      },
    }

    normalizeTrainerSheet(sheet)

    expect(sheet.inventory?.equipment?.[0]).toMatchObject({
      name: 'Old Rod',
      cost: '$1000',
      description: 'Fishing Rods are used to Fish. They are two-handed items. Old Rods are capable only of fishing up small, unevolved Pokémon at level 10 or under.',
    })
  })
})
