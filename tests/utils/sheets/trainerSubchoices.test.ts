import { describe, expect, it } from 'vitest'
import {
  setTrainerSubchoiceValue,
  trainerEdgeSubchoices,
  trainerFeatureSubchoices,
  trainerSubchoiceDisplayValue,
  trainerSubchoiceValue,
  updateTrainerChoiceEntryName,
} from '~/utils/sheets/trainerSubchoices'
import type { TrainerEdgeEntry, TrainerFeatureEntry } from '~/types/trainerSheet'

describe('trainer subchoice helpers', () => {
  it('exposes type selectors for Type Ace feature rows', () => {
    const feature: TrainerFeatureEntry = { name: 'Type Ace' }

    const definitions = trainerFeatureSubchoices(feature)

    expect(definitions.map((definition) => definition.label)).toEqual(['Type'])
    expect(definitions[0].options.map((option) => option.value)).toContain('Fire')
  })

  it('stores feature subchoices separately from the feature name', () => {
    const feature: TrainerFeatureEntry = { name: 'Type Ace' }
    const [definition] = trainerFeatureSubchoices(feature)

    setTrainerSubchoiceValue(feature, definition, 'Water')

    expect(feature.name).toBe('Type Ace')
    expect(feature.choices).toEqual({ type: 'Water' })
    expect(trainerSubchoiceValue(feature, definition, trainerFeatureSubchoices(feature))).toBe('Water')
  })

  it('parses legacy parenthetical edge labels into selectors', () => {
    const edge: TrainerEdgeEntry = { name: 'Virtuoso (Command)' }
    const [definition] = trainerEdgeSubchoices(edge)

    expect(trainerSubchoiceValue(edge, definition, trainerEdgeSubchoices(edge))).toBe('command')
    expect(trainerSubchoiceDisplayValue(definition, 'command')).toBe('Command')
  })

  it('keeps Basic Skills compatible with its legacy basicSkill field', () => {
    const edge: TrainerEdgeEntry = { name: 'Basic Skills (General Ed)' }

    updateTrainerChoiceEntryName(edge, edge.name, trainerEdgeSubchoices)

    expect(edge.name).toBe('Basic Skills')
    expect(edge.basicSkill).toBe('generalEd')
    expect(edge.choices).toBeUndefined()
  })

  it('supports multi-selector features like Researcher', () => {
    const feature: TrainerFeatureEntry = { name: 'Researcher' }
    const definitions = trainerFeatureSubchoices(feature)

    expect(definitions.map((definition) => definition.key)).toEqual(['researcherField', 'researcherField2'])

    updateTrainerChoiceEntryName(feature, 'Researcher (Apothecary, Occultism)', trainerFeatureSubchoices)

    expect(feature).toMatchObject({
      name: 'Researcher',
      choices: {
        researcherField: 'Apothecary',
        researcherField2: 'Occultism',
      },
    })
  })

  it('exposes Capture Specialist technique choices', () => {
    const feature: TrainerFeatureEntry = { name: 'Capture Specialist' }
    const definitions = trainerFeatureSubchoices(feature)

    expect(definitions.map((definition) => definition.key)).toEqual(['captureTechnique', 'captureTechnique2'])
    expect(trainerFeatureSubchoices({ name: 'Advanced Capture Techniques' }).map((definition) => definition.key))
      .toEqual(['captureTechnique', 'captureTechnique2'])
    expect(definitions[0].options.map((option) => option.value)).toEqual([
      'Capture Skills',
      'Curve Ball',
      'Devitalizing Throw',
      'Fast Pitch',
      'Snare',
      'Tools of the Trade',
      'Catch Combo',
      'False Strike',
      'Relentless Pursuit',
    ])

    updateTrainerChoiceEntryName(feature, 'Capture Specialist (Curve Ball, Fast Pitch)', trainerFeatureSubchoices)

    expect(feature).toMatchObject({
      name: 'Capture Specialist',
      choices: {
        captureTechnique: 'Curve Ball',
        captureTechnique2: 'Fast Pitch',
      },
    })
  })

  it('exposes nested subchoices for selected feature references', () => {
    const feature: TrainerFeatureEntry = { name: 'Dilettante', choices: { feature: 'Tutoring' } }
    const definitions = trainerFeatureSubchoices(feature)
    const moveDefinition = definitions.find((definition) => definition.key === 'feature.move')

    expect(definitions.map((definition) => definition.key)).toEqual(['edge', 'feature', 'feature.move'])
    expect(moveDefinition?.label).toBe('Feature / Move')

    setTrainerSubchoiceValue(feature, moveDefinition!, 'Thunderbolt')

    expect(feature.choices).toEqual({
      feature: 'Tutoring',
      'feature.move': 'Thunderbolt',
    })
  })

  it('stores nested edge subchoices without using top-level edge legacy fields', () => {
    const feature: TrainerFeatureEntry = { name: 'Dilettante', choices: { edge: 'Basic Skills' } }
    const definitions = trainerFeatureSubchoices(feature)
    const skillDefinition = definitions.find((definition) => definition.key === 'edge.skill')

    expect(skillDefinition?.label).toBe('Edge / Skill')

    setTrainerSubchoiceValue(feature, skillDefinition!, 'Command')

    expect(feature.choices).toEqual({
      edge: 'Basic Skills',
      'edge.skill': 'command',
    })
    expect((feature as TrainerEdgeEntry).basicSkill).toBeUndefined()
  })

  it('clears nested values when their parent subchoice changes', () => {
    const feature: TrainerFeatureEntry = {
      name: 'Dilettante',
      choices: { feature: 'Tutoring', 'feature.move': 'Thunderbolt' },
    }
    const featureDefinition = trainerFeatureSubchoices(feature).find((definition) => definition.key === 'feature')

    setTrainerSubchoiceValue(feature, featureDefinition!, 'Dive')

    expect(feature.choices).toEqual({ feature: 'Dive' })
  })

  it('supports conditional subchoices on subchoice values', () => {
    expect(trainerFeatureSubchoices({ name: 'Chronicler' }).map((definition) => definition.key)).toEqual(['archive'])

    const feature: TrainerFeatureEntry = {
      name: 'Chronicler',
      choices: { archive: 'Travel Archive', travelArchiveAbility: 'Keen Eye' },
    }
    const definitions = trainerFeatureSubchoices(feature)
    const abilityDefinition = definitions.find((definition) => definition.key === 'archive.travelArchiveAbility')

    expect(definitions.map((definition) => definition.key)).toEqual(['archive', 'archive.travelArchiveAbility'])
    expect(trainerSubchoiceValue(feature, abilityDefinition!, definitions)).toBe('Keen Eye')

    setTrainerSubchoiceValue(feature, abilityDefinition!, 'Perception')

    expect(feature.choices).toEqual({
      archive: 'Travel Archive',
      'archive.travelArchiveAbility': 'Perception',
    })
  })

  it('parses legacy parenthetical labels into conditional nested subchoices', () => {
    const feature: TrainerFeatureEntry = { name: '' }

    updateTrainerChoiceEntryName(feature, 'Chronicler (Travel Archive, Keen Eye)', trainerFeatureSubchoices)

    expect(feature).toEqual({
      name: 'Chronicler',
      choices: {
        archive: 'Travel Archive',
        'archive.travelArchiveAbility': 'Keen Eye',
      },
    })
  })
})
