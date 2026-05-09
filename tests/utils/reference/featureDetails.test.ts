import { describe, expect, it } from 'vitest'
import { siblingFeaturesInClass } from '~/utils/reference/featureDetails'
import type { PtuFeature } from '~/types/ptuReference'

const feature = (overrides: Partial<PtuFeature> & Pick<PtuFeature, 'name'>): PtuFeature => ({
  name: overrides.name,
  tags: overrides.tags ?? [],
  prerequisites: overrides.prerequisites,
  frequency: overrides.frequency,
  trigger: overrides.trigger,
  target: overrides.target,
  condition: overrides.condition,
  effect: overrides.effect,
  className: overrides.className,
})

const aceTrainer = feature({ name: 'Ace Trainer', className: 'Ace Trainer', tags: ['Class'] })
const signatureTechnique = feature({ name: 'Signature Technique', className: 'Ace Trainer', tags: ['Ranked 2'] })
const eliteTraining = feature({ name: 'Elite Training', className: 'Ace Trainer', tags: ['Training'] })
const typeAce = feature({ name: 'Type Ace', className: 'Type Ace', tags: ['Class'] })
const standalone = feature({ name: 'Command Versatility' })

describe('feature detail helpers', () => {
  it('finds sibling features from the same trainer class', () => {
    expect(siblingFeaturesInClass(aceTrainer, [aceTrainer, signatureTechnique, typeAce, eliteTraining]).map((f) => f.name)).toEqual([
      'Signature Technique',
      'Elite Training',
    ])
  })

  it('does not include the current feature by name', () => {
    const duplicate = feature({ name: 'Ace Trainer', className: 'Ace Trainer' })
    expect(siblingFeaturesInClass(aceTrainer, [duplicate, signatureTechnique]).map((f) => f.name)).toEqual([
      'Signature Technique',
    ])
  })

  it('respects the sibling limit', () => {
    expect(siblingFeaturesInClass(aceTrainer, [signatureTechnique, eliteTraining], { limit: 1 }).map((f) => f.name)).toEqual([
      'Signature Technique',
    ])
  })

  it('returns no siblings without a current class name', () => {
    expect(siblingFeaturesInClass(null, [aceTrainer])).toEqual([])
    expect(siblingFeaturesInClass(standalone, [aceTrainer])).toEqual([])
  })
})
