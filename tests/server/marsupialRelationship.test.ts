import { describe, expect, it } from 'vitest'
import { createEmptyCapabilityCampaignState } from '#shared/capabilityAutomation/campaignState'
import {
  resolveMarsupialRelationship,
  withoutMarsupialTransientMapState,
} from '../../server/domain/capabilityAutomation/marsupialRelationship'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { createBreedingBabyTemplateAuthorityV1, createBreedingMarsupialProviderTraitV1, resolveBreedingMarsupialBabyTemplateV1 } from '../../server/domain/breeding/babyTemplate'

const pouch = (overrides: Record<string, unknown> = {}) => ({
  motherSheetSlug: 'kangaskhan-mother',
  babySheetSlug: 'kangaskhan-baby',
  experienceSharePercent: 20 as const,
  establishedAt: 100,
  sourceOperationId: 'shelter-operation',
  ...overrides,
})

const mother = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'kangaskhan-mother', nickname: 'Mother', species: 'Kangaskhan', level: 30,
  capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch() },
  ...overrides,
})

const template = resolveBreedingMarsupialBabyTemplateV1()
const babyAuthority = createBreedingBabyTemplateAuthorityV1({ sourceEggId: 'pokemon-egg:v1:94949494949494949494949494949494', babyTemplate: template, marsupial: createBreedingMarsupialProviderTraitV1() })
const baby = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'kangaskhan-baby', nickname: 'Baby', species: 'Kangaskhan', level: 10, babyTemplate: true,
  babyTemplateMechanics: { schemaVersion: 1, applicationKind: babyAuthority.applicationKind, effects: babyAuthority.effects },
  serverPrivate: { breedingBabyTemplate: babyAuthority },
  capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch() },
  ...overrides,
})

const sheets = (...values: CharacterSheet[]) => new Map(values.map(sheet => [sheet.slug, sheet]))

describe('authoritative Marsupial relationship resolution', () => {
  it('distinguishes absent and exact reciprocal valid state', () => {
    const unbound = baby({ capabilityCampaignState: undefined })
    expect(resolveMarsupialRelationship({ subjectSlug: unbound.slug, pokemonBySlug: sheets(unbound) }))
      .toEqual({ status: 'absent', subjectSlug: unbound.slug })

    const pokemonBySlug = sheets(mother(), baby())
    expect(resolveMarsupialRelationship({ subjectSlug: 'kangaskhan-mother', pokemonBySlug })).toMatchObject({
      status: 'valid', subjectRole: 'mother',
      pouch: { motherSheetSlug: 'kangaskhan-mother', babySheetSlug: 'kangaskhan-baby', experienceSharePercent: 20 },
    })
    expect(resolveMarsupialRelationship({ subjectSlug: 'kangaskhan-baby', pokemonBySlug })).toMatchObject({
      status: 'valid', subjectRole: 'baby',
    })
  })

  it.each([
    ['one-sided state', mother(), baby({ capabilityCampaignState: undefined }), 'marsupial-reciprocal-state-mismatch'],
    ['different share', mother(), baby({
      capabilityCampaignState: {
        ...createEmptyCapabilityCampaignState(),
        marsupialPouch: pouch({ experienceSharePercent: 0 }),
      },
    }), 'marsupial-reciprocal-state-mismatch'],
    ['different operation identity', mother(), baby({
      capabilityCampaignState: {
        ...createEmptyCapabilityCampaignState(),
        marsupialPouch: pouch({ sourceOperationId: 'different-operation' }),
      },
    }), 'marsupial-reciprocal-state-mismatch'],
    ['adult baby', mother(), baby({ level: 25, babyTemplate: false }), 'marsupial-baby-lifecycle-invalid'],
  ])('fails closed for %s', (_label, motherSheet, babySheet, reasonCode) => {
    expect(resolveMarsupialRelationship({
      subjectSlug: 'kangaskhan-mother',
      pokemonBySlug: sheets(motherSheet, babySheet),
    })).toMatchObject({ status: 'corrupt', reasonCode })
  })

  it('classifies malformed local pouch state as corrupt rather than absent', () => {
    const malformed = baby({
      capabilityCampaignState: {
        ...createEmptyCapabilityCampaignState(),
        marsupialPouch: { motherSheetSlug: 'kangaskhan-mother' },
      } as CharacterSheet['capabilityCampaignState'],
    })
    expect(resolveMarsupialRelationship({ subjectSlug: malformed.slug, pokemonBySlug: sheets(malformed) }))
      .toMatchObject({ status: 'corrupt', reasonCode: 'marsupial-subject-state-malformed' })
  })

  it('clears only the validated relationship transient map mirrors', () => {
    const relationship = resolveMarsupialRelationship({
      subjectSlug: 'kangaskhan-baby',
      pokemonBySlug: sheets(mother(), baby()),
    })
    if (relationship.status !== 'valid') throw new Error('expected valid relationship')
    const map = {
      schemaVersion: 2, slug: 'arena', name: 'Arena', revision: 2,
      dimensions: { x: 4, y: 2, z: 4 }, groundLevelY: 0, voxels: [],
      placements: [
        { id: 'mother-token', sheetKind: 'pokemon', sheetSlug: 'kangaskhan-mother', position: { x: 1, y: 0, z: 1 } },
        { id: 'baby-token', sheetKind: 'pokemon', sheetSlug: 'kangaskhan-baby', position: { x: 1, y: 0, z: 1 } },
      ],
      metadata: { capabilityMarsupialPouches: [{ motherPlacementId: 'mother-token', babyPlacementId: 'baby-token' }] },
      encounterState: {
        schemaVersion: 1, sides: {}, effects: [], counters: {}, turnResources: {}, zones: [], groundItems: [],
        pendingResolutionSummaries: [],
        capabilityRuntime: {
          schemaVersion: 1, modes: [], tasks: [], pendingAdjudications: [], checkPenalties: [],
          links: [{
            id: 'pouch-link', kind: 'marsupial-pouch', ownerPlacementId: 'mother-token',
            participantPlacementIds: ['baby-token'], capabilityInstanceId: 'marsupial-source', canonicalId: 'Marsupial',
            establishedAt: 100, configurationId: 'experience-share:20', sourceOperationId: 'shelter-operation',
          }],
        },
      },
    } as unknown as TabletopMap

    const cleared = withoutMarsupialTransientMapState(map, relationship)
    expect(cleared.metadata?.capabilityMarsupialPouches).toEqual([])
    expect(cleared.encounterState?.capabilityRuntime?.links).toEqual([])
    expect(cleared.placements).toHaveLength(2)
  })
})
