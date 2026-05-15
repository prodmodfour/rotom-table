import { describe, expect, it } from 'vitest'
import { makeMoveLookupRows } from '~/utils/sheetMoveLookup'
import type { CharacterSheetMove } from '~/types/characterSheet'

const move = (overrides: Partial<CharacterSheetMove> & Pick<CharacterSheetMove, 'name'>): CharacterSheetMove => ({
  ...overrides,
})

describe('sheet move lookup', () => {
  it('uses the normal damage-class offensive stat without Weird Power', () => {
    const [row] = makeMoveLookupRows([
      move({ name: 'Custom Blast', category: 'Special', db: 6 }),
    ], {
      physicalAttack: 10,
      specialAttack: 8,
      physicalAttackStage: 2,
      specialAttackStage: 0,
    })

    expect(row).toMatchObject({
      attackStat: 8,
      baseAttackStat: 8,
      attackStage: 0,
      attackStatKey: 'satk',
      attackStatLabel: 'Special Attack',
      attackStatAbility: null,
      additionalAttackStat: null,
      additionalAttackStatKey: null,
      damageFormula: '2d6+8+8',
    })
  })

  it('adds Attack to Special damage rolls when Weird Power Attack is higher', () => {
    const [row] = makeMoveLookupRows([
      move({ name: 'Custom Blast', category: 'Special', db: 6 }),
    ], {
      physicalAttack: 10,
      specialAttack: 8,
      physicalAttackStage: 2,
      specialAttackStage: 0,
      abilities: [{ name: 'weird power' }],
    })

    expect(row).toMatchObject({
      attackStat: 22,
      baseAttackStat: 8,
      attackStage: 0,
      attackStatKey: 'satk',
      attackStatLabel: 'Special Attack',
      attackStatAbility: 'Weird Power',
      additionalAttackStat: 14,
      additionalBaseAttackStat: 10,
      additionalAttackStage: 2,
      additionalAttackStatKey: 'atk',
      additionalAttackStatLabel: 'Attack',
      damageFormula: '2d6+8+22',
    })
  })

  it('adds Special Attack to Physical damage rolls when Weird Power Special Attack is higher', () => {
    const [row] = makeMoveLookupRows([
      move({ name: 'Custom Strike', category: 'Physical', db: 4 }),
    ], {
      physicalAttack: 8,
      specialAttack: 10,
      physicalAttackStage: 0,
      specialAttackStage: 1,
      abilities: ['Weird Power'],
    })

    expect(row).toMatchObject({
      attackStat: 20,
      baseAttackStat: 8,
      attackStage: 0,
      attackStatKey: 'atk',
      attackStatLabel: 'Attack',
      attackStatAbility: 'Weird Power',
      additionalAttackStat: 12,
      additionalBaseAttackStat: 10,
      additionalAttackStage: 1,
      additionalAttackStatKey: 'satk',
      additionalAttackStatLabel: 'Special Attack',
      damageFormula: '1d8+6+20',
    })
  })

  it('does not add the opposite stat when Weird Power stats are tied', () => {
    const [row] = makeMoveLookupRows([
      move({ name: 'Custom Blast', category: 'Special', db: 6 }),
    ], {
      physicalAttack: 10,
      specialAttack: 10,
      abilities: ['Weird Power'],
    })

    expect(row).toMatchObject({
      attackStat: 10,
      attackStatKey: 'satk',
      attackStatAbility: null,
      additionalAttackStat: null,
      damageFormula: '2d6+8+10',
    })
  })
})
