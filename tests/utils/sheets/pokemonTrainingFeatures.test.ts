import { describe, expect, it } from 'vitest'
import {
  normalizePokemonTrainingFeatureName,
  POKEMON_TRAINING_FEATURE_OPTIONS,
  pokemonTrainingFeatureAccuracyRollBonus,
  pokemonTrainingFeatureEvasionBonus,
  pokemonTrainingFeatureInitiativeBonus,
  pokemonTrainingFeatureMovementCapabilityAdjustment,
  resolvePokemonTrainingFeatureEffects,
} from '~/utils/sheets/pokemonTrainingFeatures'

describe('pokemon training feature helpers', () => {
  it('normalizes canonical feature names and common state labels', () => {
    expect(POKEMON_TRAINING_FEATURE_OPTIONS).toContain('Agility Training')
    expect(normalizePokemonTrainingFeatureName(' focused ')).toBe('Focused Training')
    expect(normalizePokemonTrainingFeatureName('Inspired Training')).toBe('Inspired Training')
    expect(normalizePokemonTrainingFeatureName('Experience Training')).toBeNull()
  })

  it('resolves Training Feature bonuses from the reference-backed names', () => {
    expect(resolvePokemonTrainingFeatureEffects('Brutal Training')).toMatchObject({
      featureName: 'Brutal Training',
      stateName: 'Brutal',
      criticalHitRangeBonus: 1,
      effectRangeBonus: 1,
      reference: expect.objectContaining({ name: 'Brutal Training' }),
    })
    expect(pokemonTrainingFeatureInitiativeBonus('Agility Training')).toBe(4)
    expect(pokemonTrainingFeatureAccuracyRollBonus('Focused Training')).toBe(1)
    expect(pokemonTrainingFeatureEvasionBonus('Inspired Training')).toBe(1)
  })

  it('describes Agility Training movement capability adjustments only for movement speeds', () => {
    expect(pokemonTrainingFeatureMovementCapabilityAdjustment('Overland', 6, 'Agile')).toMatchObject({
      featureName: 'Agility Training',
      movementCapabilityBonus: 1,
      adjustedValue: 7,
      displayValue: '+1',
    })
    expect(pokemonTrainingFeatureMovementCapabilityAdjustment('Power', 6, 'Agility Training')).toBeNull()
    expect(pokemonTrainingFeatureMovementCapabilityAdjustment('Sky', 0, 'Agility Training')).toBeNull()
  })
})
