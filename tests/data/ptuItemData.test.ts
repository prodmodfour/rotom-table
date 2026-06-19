import { describe, expect, it } from 'vitest'
import { findItem, items } from '~~/data/ptuReference'

const rodReferences = [
  {
    name: 'Old Rod',
    cost: '$1000',
    effect: 'Fishing Rods are used to Fish. They are two-handed items. Old Rods are capable only of fishing up small, unevolved Pokémon at level 10 or under.',
  },
  {
    name: 'Good Rod',
    cost: '$5,000',
    effect: 'Fishing Rods are used to Fish. They are two-handed items. Good Rods may catch unevolved Pokémon of a Level to your GM’s discretion.',
  },
  {
    name: 'Super Rod',
    cost: '$15,000',
    effect: 'Fishing Rods are used to Fish. They are two-handed items. Super Rods may catch Pokémon of any size and evolutionary stage, to your GM’s discretion.',
  },
] as const

const typeNames = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison',
  'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark',
  'Steel', 'Fairy',
] as const

describe('PTU item reference data', () => {
  it('exposes fishing rods as three distinct purchasable items', () => {
    expect(items.map((item) => item.name)).not.toContain('Fishing Rod')

    for (const rod of rodReferences) {
      expect(findItem(rod.name)).toMatchObject({
        name: rod.name,
        costs: [rod.cost],
        effects: [rod.effect],
      })
    }
  })

  it('exposes type boosters as one item per elemental type', () => {
    expect(items.map((item) => item.name)).not.toContain('Type Boosters')
    expect(findItem('Type Boosters')).toBeNull()

    for (const typeName of typeNames) {
      expect(findItem(`${typeName} Type Booster`)).toMatchObject({
        name: `${typeName} Type Booster`,
        costs: ['$1800'],
        effects: [
          `Grants a +5 Damage Bonus to all direct damage ${typeName} Type Moves when performed by the user. Accessory Item for Trainers.`,
        ],
      })
    }
  })
})
