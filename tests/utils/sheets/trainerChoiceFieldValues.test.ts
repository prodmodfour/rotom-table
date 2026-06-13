import { describe, expect, it } from 'vitest'
import { trainerEdgeFieldValue } from '~/utils/sheets/trainerEdges'
import { trainerFeatureFieldValue } from '~/utils/sheets/trainerFeatures'
import type { TrainerEdgeEntry, TrainerFeatureEntry } from '~/types/trainerSheet'

describe('trainer feature and edge field values', () => {
  it('appends selected feature subchoice descriptions beneath parent feature effects', () => {
    const feature: TrainerFeatureEntry = {
      name: 'Elite Trainer',
      choices: { trainingFeature: 'Focused Training' },
    }

    const effect = trainerFeatureFieldValue(feature, 'effect')

    expect(effect).toContain('Choose Agility Training, Brutal Training, Focused Training, or Inspired Training.')
    expect(effect).toContain('Training feature — Focused Training:')
    expect(effect).toContain('Focused Pokémon gain a +1 bonus to Accuracy Rolls')
  })

  it('formats the free trainer Training Feature as a prerequisite-waived choice', () => {
    const feature: TrainerFeatureEntry = {
      name: 'Free Training Feature',
      choices: { trainingFeature: 'Focused Training' },
    }

    expect(trainerFeatureFieldValue(feature, 'tags')).toBe('Orders, Training')
    expect(trainerFeatureFieldValue(feature, 'prerequisites')).toBe('Free trainer choice; prerequisites waived.')
    expect(trainerFeatureFieldValue(feature, 'effect')).toBe('The target becomes Focused until the end of the effect duration. Focused Pokémon gain a +1 bonus to Accuracy Rolls and +2 to Skill Checks.')
  })

  it('prompts for the free trainer Training Feature while no choice is selected', () => {
    const feature: TrainerFeatureEntry = { name: 'Free Training Feature' }

    expect(trainerFeatureFieldValue(feature, 'effect')).toContain('Choose one free Training Feature')
  })

  it('appends mixed edge and feature subchoice descriptions when a feature grants both', () => {
    const feature: TrainerFeatureEntry = {
      name: 'Dilettante',
      choices: { edge: 'Medic Training', feature: 'Tutoring' },
    }

    const effect = trainerFeatureFieldValue(feature, 'effect')

    expect(effect).toContain('Edge — Medic Training: When you use Restorative Items on others')
    expect(effect).toContain('Feature — Tutoring: When activating this Feature')
  })

  it('appends nested subchoice descriptions beneath selected subchoice references', () => {
    const feature: TrainerFeatureEntry = {
      name: 'Dilettante',
      choices: { feature: 'Tutoring', 'feature.move': 'Thunderbolt' },
    }

    const effect = trainerFeatureFieldValue(feature, 'effect')

    expect(effect).toContain('Feature — Tutoring: When activating this Feature')
    expect(effect).toContain('Feature / Move — Thunderbolt: Electric')
    expect(effect).toContain('DB 9 (2d10+10 / 21)')
  })

  it('appends custom descriptions for non-reference subchoices', () => {
    const feature: TrainerFeatureEntry = {
      name: 'Capture Specialist',
      choices: { captureTechnique: 'Curve Ball', captureTechnique2: 'Fast Pitch' },
    }

    const effect = trainerFeatureFieldValue(feature, 'effect')

    expect(effect).toContain('Technique 1 — Curve Ball: Static')
    expect(effect).toContain('damage as if you had hit them with a Struggle Attack')
    expect(effect).toContain('Technique 2 — Fast Pitch: 1 AP – Standard Action')
  })

  it('does not append descriptions for skill-only edge subchoices', () => {
    const edge: TrainerEdgeEntry = { name: 'Basic Skills', basicSkill: 'command' }

    const effect = trainerEdgeFieldValue(edge, 'effect')

    expect(effect).toBe('You Rank Up a Skill from Pathetic to Untrained, or Untrained to Novice. You may take this Edge multiple times.')
  })
})
