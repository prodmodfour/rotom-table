import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_TRANSFORMATION_LIMITS,
  EncounterTransformationValidationError,
  parseEncounterTransformationEffectPayload,
} from '#shared/moveAutomation/transformationSnapshots'
import { transformationEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

describe('encounter transformation snapshots', () => {
  it('strictly detaches every copied form field as JSON data', () => {
    const input = transformationEncounterEffectFixture().payload
    const parsed = parseEncounterTransformationEffectPayload(structuredClone(input))

    expect(parsed).toEqual(input)
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(input)
    expect(parsed).not.toBe(input)
    expect(parsed.moves).not.toBe(input.moves)
    expect(parsed.capabilities).not.toBe(input.capabilities)
    expect(parsed.appearance).not.toBe(input.appearance)
    expect(parsed.appearance.spriteAnimation).not.toBe(input.appearance.spriteAnimation)
  })

  it('rejects executable/remote appearance data, inconsistent animation, and unknown fields', () => {
    const input = transformationEncounterEffectFixture().payload
    const invalidValues = [
      {
        ...input,
        script: 'return arbitraryState',
      },
      {
        ...input,
        appearance: { ...input.appearance, spriteUrl: 'https://private.invalid/form.gif' },
      },
      {
        ...input,
        appearance: {
          ...input.appearance,
          spriteAnimation: {
            ...input.appearance.spriteAnimation!,
            durationsMs: [100],
          },
        },
      },
    ]

    expect(() => parseEncounterTransformationEffectPayload(invalidValues[0]))
      .toThrow('unknown script')
    expect(() => parseEncounterTransformationEffectPayload(invalidValues[1]))
      .toThrow('must be a root-relative asset path')
    expect(() => parseEncounterTransformationEffectPayload(invalidValues[2]))
      .toThrow('must contain exactly one duration per frame')
  })

  it('bounds copied lists and rejects duplicate semantic identities', () => {
    const input = transformationEncounterEffectFixture().payload
    const oversizedAbilities = Array.from(
      { length: ENCOUNTER_TRANSFORMATION_LIMITS.abilities + 1 },
      (_, index) => `Ability ${index}`,
    )

    expect(() => parseEncounterTransformationEffectPayload({
      ...input,
      abilityNames: oversizedAbilities,
    })).toThrowError(expect.objectContaining({
      name: EncounterTransformationValidationError.name,
      code: 'limit-exceeded',
    }))
    expect(() => parseEncounterTransformationEffectPayload({
      ...input,
      typeIds: ['normal', 'Normal'],
    })).toThrowError(expect.objectContaining({
      code: 'duplicate-id',
    }))
  })
})
