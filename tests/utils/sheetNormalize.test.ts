import { describe, expect, it } from 'vitest'
import { normalizeTrainerSheet } from '~/utils/sheetNormalize'
import type { TrainerSheet } from '~/types/trainerSheet'

const legacyAllFishingRodsDescription = 'Fishing Rods are used to Fish. They are two-handed items. They come in three varieties; Old Rods, Good Rods, and Super Rods. Old Rods cost $1000, Good Rods cost $5,000, and Super Rods cost $15,000.'
const legacyAllFishingRodsCost = 'Old Rods cost $1000, Good Rods cost $5,000, and Super Rods cost $15,000'

describe('sheetNormalize', () => {
  it('strips retired legacy trainer skill rank entries', () => {
    const sheet: TrainerSheet = {
      slug: 'mentor',
      name: 'Mentor',
      level: 1,
      skills: {
        command: { rank: 'Master', modifier: 2 } as unknown as NonNullable<TrainerSheet['skills']>['command'],
        focus: { rank: 'Adept' } as unknown as NonNullable<TrainerSheet['skills']>['focus'],
      },
    }

    normalizeTrainerSheet(sheet)

    expect(sheet.skills?.command).toEqual({ modifier: 2 })
    expect(sheet.skills?.focus).toBeUndefined()
  })

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
