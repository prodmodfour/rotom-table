import { describe, expect, it } from 'vitest'
import {
  BREEDING_PROJECT_GUIDANCE_REASON_CATALOG,
  BreedingProjectGuidanceContractError,
  BreedingProjectGuidanceVerificationError,
  breedingProjectGuidanceReason,
  parseBreedingProjectGuidanceProjectionV1,
  verifyBreedingProjectGuidanceProjectionV1,
} from '../../shared/breeding/projectGuidance'
import { createBreedingProjectGuidanceProjectionV1 } from '../../server/domain/breeding/projectGuidance'
import { createBreedingProjectWizardProjectionV1 } from '../../server/domain/breeding/projectWizard'

const wizard = (audience: 'gm' | 'owner' = 'owner') => createBreedingProjectWizardProjectionV1({
  audience,
  generatedAtCampaignMinute: 100,
  destination: { trainerSheetSlug: 'trainer-owner', trainerRevision: 4, displayName: 'Mira' },
  breeder: { trainerSheetSlug: 'trainer-owner', trainerRevision: 4, displayName: 'Mira' },
  parentDiscovery: {
    schemaVersion: 1,
    audience,
    generatedAtCampaignMinute: 100,
    trainerSheets: [{
      trainerSheetSlug: 'trainer-owner',
      trainerSheetRevision: 4,
      candidates: [{
        parentSheetSlug: 'pokemon-parent-a',
        parentSheetRevision: 2,
        ownerTrainerSlug: 'trainer-owner',
        ownerTrainerRevision: 4,
        rosterField: 'current-team',
        label: 'Leaf',
        speciesId: 'bulbasaur',
        genderId: 'female',
        level: 25,
        availability: { status: 'selectable', reasonIds: [] },
      }],
    }],
    selectedParentRefs: [],
    compatibilityPreview: null,
  },
  timeline: {
    timeAuthority: 'campaign-clock',
    initialCampaignMinutes: 240,
    breederCheckDifficultyClass: 12,
    additionalCampaignMinutes: 240,
    minimumCampaignMinutesBeforeEgg: 480,
  },
  consentStatus: 'selection-incomplete',
  reviewStatus: 'selection-incomplete',
})
const projection = (audience: 'gm' | 'owner' = 'owner') => createBreedingProjectGuidanceProjectionV1({
  wizard: wizard(audience),
  applicableReasonIds: [
    'breeding.project-guidance.breeder-edge-unavailable',
    'breeding.project-guidance.parent-selection-incomplete',
  ],
  sourceContributions: [{
    sourceKind: 'trainer-edge',
    sourceCanonicalId: 'Breeder',
    status: 'unavailable',
    contributionIds: ['breeding-project-request', 'breeder-dc12-timeline'],
    skillApplication: null,
    reasonId: 'breeding.project-guidance.breeder-edge-unavailable',
  }],
  gmDiagnostics: audience === 'gm' ? {
    candidateCount: 1,
    selectableCandidateCount: 1,
    unavailableCandidateCount: 0,
    selectedParentCount: 0,
    ownershipTopology: 'incomplete',
    breederAuthorityStatus: 'unavailable',
    maturityPolicy: 'gm-confirmed-per-parent',
    minimumMaturityLevel: null,
    consentStatus: 'selection-incomplete',
    compatibilityPreviewStatus: 'not-evaluated',
    locationPolicyId: 'campaign-workshop-off-map-v1',
    facilityRegistryState: 'empty-no-authority',
    finalValidationStatus: 'required-before-creation',
  } : null,
})

describe('BR-072 Breeding Project guidance shared contract', () => {
  it('closes human explanations over every candidate, pair, and wizard reason', () => {
    expect(BREEDING_PROJECT_GUIDANCE_REASON_CATALOG.length).toBeGreaterThan(20)
    expect(new Set(BREEDING_PROJECT_GUIDANCE_REASON_CATALOG.map(row => row.reasonId)).size)
      .toBe(BREEDING_PROJECT_GUIDANCE_REASON_CATALOG.length)
    expect(breedingProjectGuidanceReason('breeding.compatibility.no-shared-egg-group'))
      .toMatchObject({
        severity: 'error',
        title: 'No shared Egg Group',
      })
    for (const row of BREEDING_PROJECT_GUIDANCE_REASON_CATALOG) {
      expect(row.summary.length).toBeGreaterThan(10)
      expect(row.recovery.length).toBeGreaterThan(5)
      expect(Object.isFrozen(row)).toBe(true)
    }
  })

  it('parses and deeply freezes bounded owner source guidance without GM diagnostics', () => {
    const value = projection()
    expect(parseBreedingProjectGuidanceProjectionV1(value)).toStrictEqual(value)
    expect(value.gmDiagnostics).toBeNull()
    expect(Object.isFrozen(value.sourceContributions[0])).toBe(true)
    expect(Object.isFrozen(value.wizard.parentDiscovery)).toBe(true)
  })

  it('requires diagnostics only for GM and binds counts and source status to the wizard', () => {
    const value = projection('gm')
    expect(parseBreedingProjectGuidanceProjectionV1(value).gmDiagnostics).toMatchObject({
      candidateCount: 1,
      selectableCandidateCount: 1,
      breederAuthorityStatus: 'unavailable',
    })
    expect(() => parseBreedingProjectGuidanceProjectionV1({
      ...projection(),
      gmDiagnostics: value.gmDiagnostics,
    })).toThrow(BreedingProjectGuidanceContractError)
    expect(() => parseBreedingProjectGuidanceProjectionV1({
      ...value,
      gmDiagnostics: { ...value.gmDiagnostics!, candidateCount: 2 },
    })).toThrowError(expect.objectContaining({
      code: 'breeding.project-guidance.invalid-invariant',
    }))
  })

  it('rejects enriched, malformed, contradictory, and hash-drifted guidance', async () => {
    const value = projection()
    expect(() => parseBreedingProjectGuidanceProjectionV1({ ...value, privateHash: 'nope' }))
      .toThrow(BreedingProjectGuidanceContractError)
    expect(() => parseBreedingProjectGuidanceProjectionV1({
      ...value,
      sourceContributions: [{
        ...value.sourceContributions[0],
        status: 'active',
      }],
    })).toThrow(BreedingProjectGuidanceContractError)
    const sparse = { ...value, applicableReasonIds: Array(1) }
    expect(() => parseBreedingProjectGuidanceProjectionV1(sparse))
      .toThrow(BreedingProjectGuidanceContractError)

    await expect(verifyBreedingProjectGuidanceProjectionV1(value)).resolves.toStrictEqual(value)
    await expect(verifyBreedingProjectGuidanceProjectionV1({
      ...value,
      applicableReasonIds: [
        'breeding.project-guidance.breeder-edge-unavailable',
        'breeding.project-guidance.maturity-confirmation-required',
        'breeding.project-guidance.parent-selection-incomplete',
      ],
    })).rejects.toBeInstanceOf(BreedingProjectGuidanceVerificationError)
  })
})
