import { describe, expect, it } from 'vitest'
import type {
  EncounterCreatureRuleOverlayEffect,
  EncounterTransformationEffect,
} from '#shared/moveAutomation/encounterEffects'
import type { EncounterCreatureRuleOverlayEffectPayload } from '#shared/moveAutomation/creatureRuleOverlayPayloads'
import {
  EffectiveAbilityProjectionError,
  projectAuthoritativeEffectiveAbilities,
} from '../../server/domain/abilityAutomation/effectiveAbilities'
import {
  creatureRuleOverlayEncounterEffectFixture,
  transformationEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const target = {
  placementId: 'target-token',
  sideId: 'blue',
  position: { x: 2, y: 0, z: 2 },
}

const overlay = (
  id: string,
  payload: EncounterCreatureRuleOverlayEffectPayload,
): EncounterCreatureRuleOverlayEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture(payload),
  id,
  affected: { placementIds: ['target-token'], sideIds: [], cells: [] },
})

const projection = (
  baseAbilityNames: readonly string[],
  effects: readonly (EncounterCreatureRuleOverlayEffect | EncounterTransformationEffect)[] = [],
) => projectAuthoritativeEffectiveAbilities({ baseAbilityNames, effects, target })

describe('authoritative effective ability projection', () => {
  it('projects base, granted, copied, replaced, and transformed layers in durable order', () => {
    const granted = projection(['Blaze'], [overlay('effect.grant', {
      domain: 'ability',
      action: 'add',
      values: ['Soundproof'],
      referencePlacementId: null,
      suppressionScope: null,
    })])
    expect(granted.map(ability => [ability.canonicalId, ability.sourceKind, ability.effective])).toEqual([
      ['Blaze', 'base', true],
      ['Soundproof', 'granted', true],
    ])

    const copied = projection(['Blaze'], [overlay('effect.copy', {
      domain: 'ability',
      action: 'copy',
      values: ['Intimidate'],
      referencePlacementId: 'provider-token',
      suppressionScope: null,
    })])
    expect(copied).toMatchObject([
      { canonicalId: 'Blaze', sourceKind: 'base', effective: false, suppressionReasonCode: 'ability.replaced.copy' },
      { canonicalId: 'Intimidate', sourceKind: 'copied', effective: true, sourcePlacementId: 'provider-token' },
    ])

    const replaced = projection(['Blaze'], [overlay('effect.replace', {
      domain: 'ability',
      action: 'replace',
      values: ['Simple'],
      referencePlacementId: null,
      suppressionScope: null,
    })])
    expect(replaced.at(-1)).toMatchObject({ canonicalId: 'Simple', sourceKind: 'replaced', effective: true })

    const transformedEffect = transformationEncounterEffectFixture()
    const transformed = projectAuthoritativeEffectiveAbilities({
      baseAbilityNames: ['Blaze'],
      target: { ...target, placementId: 'actor-token' },
      effects: [transformedEffect],
    })
    expect(transformed.map(ability => [ability.canonicalId, ability.sourceKind, ability.effective])).toEqual([
      ['Blaze', 'base', false],
      ['Thick Fat', 'transformed', true],
      ['Immunity', 'transformed', true],
    ])
    expect(Object.isFrozen(transformed)).toBe(true)
    expect(Object.isFrozen(transformed[0])).toBe(true)
  })

  it('preserves immutable parameter data and provenance on reviewed ability grants', () => {
    const instanceId = 'granted:ability.receiver.copy.test:0'
    const projected = projection(['Blaze'], [overlay('effect.receiver', {
      domain: 'ability',
      action: 'add',
      values: ['Serpent’s Mark'],
      referencePlacementId: null,
      suppressionScope: null,
      abilitySnapshots: [{
        instanceId,
        canonicalId: 'Serpent’s Mark',
        definitionHash: null,
        sourcePlacementId: 'fainted-ally',
        parameterStatus: 'ready',
        parameterData: {
          schemaVersion: 1,
          instanceId,
          canonicalId: 'Serpent’s Mark',
          definitionVersion: null,
          selections: [{ parameterId: 'pattern', optionIds: ['attack'] }],
        },
      }],
    })])

    expect(projected.at(-1)).toMatchObject({
      instanceId,
      canonicalId: 'Serpent’s Mark',
      sourceKind: 'granted',
      sourcePlacementId: 'fainted-ally',
      parameterStatus: 'ready',
      parameterData: {
        instanceId,
        selections: [{ parameterId: 'pattern', optionIds: ['attack'] }],
      },
      effective: true,
    })
  })

  it('projects every reviewed Seasonal selection with deterministic provenance', () => {
    const expected = {
      spring: 'Run Away',
      summer: 'Grass Pelt',
      autumn: 'Rivalry',
      winter: 'Thick Fat',
    } as const
    for (const [season, grantedCanonicalId] of Object.entries(expected)) {
      const instanceId = `base:seasonal:${season}`
      const projected = projectAuthoritativeEffectiveAbilities({
        baseAbilities: [{
          instanceId,
          canonicalId: 'Seasonal',
          parameterStatus: 'ready',
          parameterData: {
            schemaVersion: 1,
            instanceId,
            canonicalId: 'Seasonal',
            definitionVersion: 1,
            selections: [{ parameterId: 'season', optionIds: [season] }],
          },
        }],
        effects: [],
        target,
      })
      expect(projected).toContainEqual(expect.objectContaining({
        instanceId: `${instanceId}:grant:${season}:0`,
        canonicalId: grantedCanonicalId,
        sourceKind: 'granted',
        sourcePlacementId: 'target-token',
        effective: true,
      }))
    }
  })

  it('applies listed and all suppression last without disabling protected abilities', () => {
    const suppressed = projection(['Blaze', 'Multitype', 'Sorcery'], [
      overlay('effect.late-grant', {
        domain: 'ability', action: 'add', values: ['Soundproof'],
        referencePlacementId: null, suppressionScope: null,
      }),
      overlay('effect.suppress-all', {
        domain: 'ability', action: 'suppress', values: [],
        referencePlacementId: null, suppressionScope: 'all',
      }),
    ])

    expect(suppressed.map(ability => [
      ability.canonicalId,
      ability.effective,
      ability.suppressionReasonCode,
    ])).toEqual([
      ['Blaze', false, 'ability.suppressed.all'],
      ['Multitype', true, null],
      ['Sorcery', true, null],
      ['Soundproof', false, 'ability.suppressed.all'],
    ])
  })

  it('fails closed when copy, transform, or swap violates canonical protection', () => {
    expect(() => projection(['Blaze'], [overlay('effect.copy', {
      domain: 'ability', action: 'copy', values: ['Multitype'],
      referencePlacementId: 'provider-token', suppressionScope: null,
    })])).toThrow(EffectiveAbilityProjectionError)

    const transformation = transformationEncounterEffectFixture()
    const protectedTransformation = {
      ...transformation,
      payload: { ...transformation.payload, abilityNames: ['Multitype'] },
    }
    expect(() => projectAuthoritativeEffectiveAbilities({
      baseAbilityNames: ['Blaze'],
      target: { ...target, placementId: 'actor-token' },
      effects: [protectedTransformation],
    })).toThrow(EffectiveAbilityProjectionError)

    expect(() => projection(['Splendorous Rider'], [overlay('effect.swap', {
      domain: 'ability', action: 'swap', values: ['Intimidate'],
      referencePlacementId: 'provider-token', suppressionScope: null,
    })])).toThrow(EffectiveAbilityProjectionError)
  })

  it('ignores noncanonical sheet labels and inactive or nonapplicable overlays', () => {
    const inactive = {
      ...overlay('effect.inactive', {
        domain: 'ability', action: 'add', values: ['Soundproof'],
        referencePlacementId: null, suppressionScope: null,
      }),
      suppression: {
        sources: [{ effectId: 'effect.suppressor', reasonCode: 'test.suppressed' }],
      },
    }
    const suppressor = {
      ...overlay('effect.suppressor', {
        domain: 'ability', action: 'add', values: ['Plus'],
        referencePlacementId: null, suppressionScope: null,
      }),
      affected: { placementIds: ['other-token'], sideIds: [], cells: [] },
    }
    const other = {
      ...overlay('effect.other', {
        domain: 'ability', action: 'add', values: ['Intimidate'],
        referencePlacementId: null, suppressionScope: null,
      }),
      affected: { placementIds: ['other-token'], sideIds: [], cells: [] },
    }

    expect(projection(
      ['Blaze', 'Homebrew Ability', 'Blaze'],
      [suppressor, inactive, other],
    )).toMatchObject([
      { canonicalId: 'Blaze', sourceKind: 'base', effective: true },
    ])
  })

  it('is deterministic and does not retain mutable effect input', () => {
    const values = ['Soundproof']
    const effect = overlay('effect.grant', {
      domain: 'ability', action: 'add', values,
      referencePlacementId: null, suppressionScope: null,
    })
    const first = projection(['Blaze'], [effect])
    const second = projection(['Blaze'], [structuredClone(effect)])
    values[0] = 'Intimidate'

    expect(first).toEqual(second)
    expect(first[1]?.canonicalId).toBe('Soundproof')
  })
})
