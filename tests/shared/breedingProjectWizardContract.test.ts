import { describe, expect, it } from 'vitest'
import {
  BreedingProjectWizardContractError,
  BreedingProjectWizardVerificationError,
  parseBreedingProjectWizardProjectionV1,
  parseBreedingProjectWizardRequestV1,
  verifyBreedingProjectWizardProjectionV1,
} from '../../shared/breeding/projectWizard'
import { createBreedingProjectWizardProjectionV1 } from '../../server/domain/breeding/projectWizard'

const candidate = (slug: string, genderId: 'female' | 'male') => ({
  parentSheetSlug: slug,
  parentSheetRevision: 2,
  ownerTrainerSlug: 'trainer-owner',
  ownerTrainerRevision: 4,
  rosterField: 'current-team' as const,
  label: slug === 'pokemon-parent-a' ? 'Leaf' : 'Bloom',
  speciesId: slug === 'pokemon-parent-a' ? 'bulbasaur' as const : 'ivysaur' as const,
  genderId,
  level: 25,
  availability: { status: 'selectable' as const, reasonIds: [] },
})
const requiredValidationIds = [
  'breeding.parent-validation.compatibility',
  'breeding.parent-validation.consent',
  'breeding.parent-validation.current-revisions',
  'breeding.parent-validation.location-facility',
  'breeding.parent-validation.maturity',
  'breeding.parent-validation.ownership-control',
] as const
const projection = (selected = true) => createBreedingProjectWizardProjectionV1({
  audience: 'owner',
  generatedAtCampaignMinute: 600,
  destination: { trainerSheetSlug: 'trainer-owner', trainerRevision: 4, displayName: 'Mira' },
  breeder: { trainerSheetSlug: 'trainer-owner', trainerRevision: 4, displayName: 'Mira' },
  parentDiscovery: {
    schemaVersion: 1,
    audience: 'owner',
    generatedAtCampaignMinute: 600,
    trainerSheets: [{
      trainerSheetSlug: 'trainer-owner',
      trainerSheetRevision: 4,
      candidates: [
        candidate('pokemon-parent-a', 'female'),
        candidate('pokemon-parent-b', 'male'),
      ],
    }],
    selectedParentRefs: selected ? [
      { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 },
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 2 },
    ] : [],
    compatibilityPreview: selected ? {
      previewId: 'breeding-parent-preview:v1:11111111111111111111111111111111',
      status: 'requires-validation',
      reasonIds: [],
      requiredValidationIds,
    } : null,
  },
  timeline: {
    timeAuthority: 'campaign-clock',
    initialCampaignMinutes: 240,
    breederCheckDifficultyClass: 12,
    additionalCampaignMinutes: 240,
    minimumCampaignMinutesBeforeEgg: 480,
  },
  consentStatus: selected ? 'not-required' : 'selection-incomplete',
  reviewStatus: selected ? 'requires-final-validation' : 'selection-incomplete',
})

describe('BR-071 Breeding Project wizard shared contract', () => {
  it('parses only exact bounded requests and deeply freezes parent selectors', () => {
    const parsed = parseBreedingProjectWizardRequestV1({
      schemaVersion: 1,
      profileId: 'profile_owner000',
      destinationTrainerSlug: 'trainer-owner',
      breederTrainerSlug: 'trainer-breeder',
      parentRefs: [{ pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 2 }],
    })
    expect(parsed).toMatchObject({
      profileId: 'profile_owner000',
      destinationTrainerSlug: 'trainer-owner',
      parentRefs: [{ pokemonSheetSlug: 'pokemon-parent-a' }],
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.parentRefs)).toBe(true)
    expect(() => parseBreedingProjectWizardRequestV1({ ...parsed, facilityId: 'secret' }))
      .toThrow(BreedingProjectWizardContractError)
    const accessor = { ...parsed }
    Object.defineProperty(accessor, 'profileId', { enumerable: true, get: () => null })
    expect(() => parseBreedingProjectWizardRequestV1(accessor))
      .toThrow(BreedingProjectWizardContractError)
    expect(() => parseBreedingProjectWizardRequestV1({ ...parsed, parentRefs: Array(1) }))
      .toThrow(BreedingProjectWizardContractError)
  })

  it('enforces exact timeline, audience, selection, consent, and review invariants', () => {
    const value = projection()
    expect(parseBreedingProjectWizardProjectionV1(value)).toStrictEqual(value)
    expect(Object.isFrozen(value.parentDiscovery.trainerSheets[0]?.candidates[0])).toBe(true)

    expect(() => parseBreedingProjectWizardProjectionV1({
      ...value,
      timeline: { ...value.timeline, initialCampaignMinutes: 239 },
    })).toThrowError(expect.objectContaining({
      code: 'breeding.project-wizard.invalid-invariant',
    }))
    expect(() => parseBreedingProjectWizardProjectionV1({
      ...value,
      consentStatus: 'review-required',
    })).toThrow(BreedingProjectWizardContractError)
    expect(() => parseBreedingProjectWizardProjectionV1({
      ...value,
      audience: 'gm',
    })).toThrow(BreedingProjectWizardContractError)
  })

  it('verifies the exact browser-compatible self-hash and current security policy', async () => {
    const value = projection(false)
    await expect(verifyBreedingProjectWizardProjectionV1(value)).resolves.toStrictEqual(value)
    await expect(verifyBreedingProjectWizardProjectionV1({
      ...value,
      destination: { ...value.destination, displayName: 'Changed' },
    })).rejects.toBeInstanceOf(BreedingProjectWizardVerificationError)
    await expect(verifyBreedingProjectWizardProjectionV1({
      ...value,
      securityPolicyDefinitionSha256: '0'.repeat(64),
    })).rejects.toBeInstanceOf(BreedingProjectWizardVerificationError)
  })
})
