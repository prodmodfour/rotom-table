import { describe, expect, it } from 'vitest'
import {
  formatTrainerSkillCsvList,
  formatTrainerSkillCsvSingleOrList,
  normalizeTrainerSkillToken,
  parseTrainerSkillCsvList,
  trainerSkillKeyFromInput,
  trainerSkillLabel,
} from '~/utils/sheets/trainerSkillCsv'
import type { TrainerSkillKey } from '~/types/trainerSheet'

const allSkillKeys: TrainerSkillKey[] = [
  'acrobatics',
  'athletics',
  'charm',
  'combat',
  'command',
  'generalEd',
  'medicineEd',
  'occultEd',
  'pokeEd',
  'techEd',
  'focus',
  'guile',
  'intimidate',
  'intuition',
  'perception',
  'stealth',
  'survival',
]

describe('trainer skill CSV helpers', () => {
  it('normalizes skill input for forgiving label matching', () => {
    expect(normalizeTrainerSkillToken(' Pokémon Ed ')).toBe('pokemoned')
    expect(trainerSkillKeyFromInput('Medicine Ed')).toBe('medicineEd')
    expect(trainerSkillKeyFromInput('medicineEd')).toBe('medicineEd')
    expect(trainerSkillKeyFromInput('Tech Ed')).toBe('techEd')
    expect(trainerSkillKeyFromInput('not a skill')).toBeUndefined()
  })

  it('parses skill names, labels, aliases, and filters to allowed keys', () => {
    expect(parseTrainerSkillCsvList(
      'Survival, Medicine Ed, Pokemon Ed, nope, survival',
      allSkillKeys,
    )).toEqual(['survival', 'medicineEd', 'pokeEd'])

    expect(parseTrainerSkillCsvList('Combat, Intimidate', ['combat'])).toEqual(['combat'])
  })

  it('formats stored skill keys as user-facing labels', () => {
    expect(trainerSkillLabel('pokeEd')).toBe('Pokémon Ed')
    expect(formatTrainerSkillCsvList(['combat', 'intimidate'])).toBe('Combat, Intimidate')
    expect(formatTrainerSkillCsvSingleOrList('medicineEd')).toBe('Medicine Ed')
    expect(formatTrainerSkillCsvSingleOrList(undefined)).toBe('')
  })
})
