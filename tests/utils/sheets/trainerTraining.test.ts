import { describe, expect, it } from 'vitest'
import {
  pokemonTrainingExperienceGain,
  trainerExperienceTrainingBonus,
  trainerExperienceTrainingLimit,
  trainerSkillRankNameForTraining,
} from '~/utils/sheets/trainerTraining'
import type { TrainerSheet } from '~/types/trainerSheet'

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'trainer',
  name: 'Trainer',
  level: 1,
  ...overrides,
})

describe('trainer training helpers', () => {
  it('uses Command rank for Experience Training limits and rank bonus', () => {
    const sheet = trainer({
      skills: { command: { rank: 'Novice' } },
    })

    expect(trainerExperienceTrainingLimit(sheet)).toBe(3)
    expect(trainerExperienceTrainingBonus(sheet)).toBe(5)
    expect(pokemonTrainingExperienceGain(sheet, { level: 13 })).toBe(11)
  })

  it('includes Train the Reserves and Trainer of Champions', () => {
    const sheet = trainer({
      skills: { command: { rank: 'Expert' } },
      edges: [
        { name: 'Train the Reserves' },
        { name: 'Trainer of Champions' },
      ],
    })

    expect(trainerExperienceTrainingLimit(sheet)).toBe(10)
    expect(trainerExperienceTrainingBonus(sheet)).toBe(15)
    expect(pokemonTrainingExperienceGain(sheet, { level: 20 })).toBe(25)
  })

  it('can calculate Beast Master Intimidate-based training', () => {
    const sheet = trainer({
      skills: {
        command: { rank: 'Untrained' },
        intimidate: { rank: 'Adept' },
      },
      edges: [{ name: 'Beast Master' }],
    })

    expect(trainerExperienceTrainingLimit(sheet, 'intimidate')).toBe(4)
    expect(trainerExperienceTrainingBonus(sheet, 'intimidate')).toBe(5)
  })

  it('detects annotated Virtuoso Command as effective rank 8', () => {
    const sheet = trainer({
      skills: { command: { rank: 'Master' } },
      edges: [{ name: 'Virtuoso (Command)' }],
    })

    expect(trainerSkillRankNameForTraining(sheet)).toBe('Virtuoso')
    expect(trainerExperienceTrainingLimit(sheet)).toBe(8)
    expect(trainerExperienceTrainingBonus(sheet)).toBe(15)
  })
})
