import { describe, expect, it } from 'vitest'
import {
  applyAceTrainerTrainedStat,
  normalizeAceTrainerStatKey,
  pokemonTrainingExperienceGain,
  trainerCanApplyAceTrainerTraining,
  trainerCanSelectPerPokemonTrainingFeatures,
  trainerExperienceTrainingBonus,
  trainerExperienceTrainingLimit,
  trainerOwnedPokemonTrainingFeatures,
  trainerSkillRankNameForTraining,
} from '~/utils/sheets/trainerTraining'
import type { CharacterSheet } from '~/types/characterSheet'
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

  it('awards at least 1 Experience Training XP', () => {
    const sheet = trainer({
      skills: { command: { rank: 'Untrained' } },
    })

    expect(pokemonTrainingExperienceGain(sheet, { level: 1 })).toBe(1)
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

  it('detects Virtuoso Command stored as a subchoice selection', () => {
    const sheet = trainer({
      skills: { command: { rank: 'Master' } },
      edges: [{ name: 'Virtuoso', choices: { skill: 'command' } }],
    })

    expect(trainerSkillRankNameForTraining(sheet)).toBe('Virtuoso')
    expect(trainerExperienceTrainingLimit(sheet)).toBe(8)
    expect(trainerExperienceTrainingBonus(sheet)).toBe(15)
  })

  it('gates per-Pokémon Training Feature selection behind Elite Trainer', () => {
    expect(trainerCanSelectPerPokemonTrainingFeatures(trainer())).toBe(false)
    expect(trainerCanSelectPerPokemonTrainingFeatures(trainer({
      features: [{ name: 'Elite Trainer' }],
    }))).toBe(true)
  })

  it('detects Training Features granted through Elite Trainer subchoices', () => {
    const sheet = trainer({
      features: [{ name: 'Elite Trainer', choices: { trainingFeature: 'Focused Training' } }],
    })

    expect([...trainerOwnedPokemonTrainingFeatures(sheet)]).toEqual(['Focused Training'])
  })

  it('detects nested subchoice-granted Elite Trainer training features', () => {
    const sheet = trainer({
      features: [{
        name: 'Dilettante',
        choices: {
          feature: 'Elite Trainer',
          'feature.trainingFeature': 'Focused Training',
        },
      }],
    })

    expect(trainerCanSelectPerPokemonTrainingFeatures(sheet)).toBe(true)
    expect([...trainerOwnedPokemonTrainingFeatures(sheet)]).toEqual(['Focused Training'])
  })

  it('gates Ace Trainer trained stats behind the Ace Trainer class feature', () => {
    expect(trainerCanApplyAceTrainerTraining(trainer())).toBe(false)
    expect(trainerCanApplyAceTrainerTraining(trainer({
      features: [{ name: 'Ace Trainer' }],
    }))).toBe(true)
    expect(trainerCanApplyAceTrainerTraining(trainer({
      classes: [{ name: 'Ace Trainer' }],
    }))).toBe(true)
  })

  it('normalizes and applies Ace Trainer trained stats to Pokémon sheets', () => {
    expect(normalizeAceTrainerStatKey('Sp. Atk')).toBe('satk')
    expect(normalizeAceTrainerStatKey('HP')).toBeNull()

    const pokemon: CharacterSheet = {
      slug: 'pikachu',
      nickname: 'Pikachu',
      species: 'Pikachu',
      level: 10,
      trainedStat: 'atk',
      stats: {
        atk: { stage: 1 },
        spd: { stage: 3 },
      },
    }

    expect(applyAceTrainerTrainedStat(pokemon, 'Speed')).toBe('spd')
    expect(pokemon.trainedStat).toBe('spd')
    expect(pokemon.stats?.atk?.stage).toBe(0)
    expect(pokemon.stats?.spd?.stage).toBe(3)
  })
})
