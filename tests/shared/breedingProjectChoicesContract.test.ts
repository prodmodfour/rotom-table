import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import projectChoicesContractJson from '../../data/breeding-automation/project-choices-presentation-contract.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import {
  BreedingProjectChoicesContractError,
  BreedingProjectChoicesVerificationError,
  createBreedingProjectDraftId,
  parseBreedingProjectChoicesRequestV1,
  parseBreedingProjectChoicesProjectionV1,
  verifyBreedingProjectChoicesProjectionV1,
} from '../../shared/breeding/projectChoices'
import {
  BREEDING_PROJECT_CHOICES_PRESENTATION_POLICY_DEFINITION_SHA256,
  createBreedingProjectChoicesProjectionV1,
} from '../../server/domain/breeding/projectChoices'
import { createBreedingProjectGuidanceProjectionV1 } from '../../server/domain/breeding/projectGuidance'
import { createBreedingProjectWizardProjectionV1 } from '../../server/domain/breeding/projectWizard'

const guidance = createBreedingProjectGuidanceProjectionV1({
  wizard: createBreedingProjectWizardProjectionV1({
    audience: 'owner',
    generatedAtCampaignMinute: 100,
    destination: { trainerSheetSlug: 'trainer-owner', trainerRevision: 4, displayName: 'Mira' },
    breeder: { trainerSheetSlug: 'trainer-owner', trainerRevision: 4, displayName: 'Mira' },
    parentDiscovery: {
      schemaVersion: 1,
      audience: 'owner',
      generatedAtCampaignMinute: 100,
      trainerSheets: [{ trainerSheetSlug: 'trainer-owner', trainerSheetRevision: 4, candidates: [] }],
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
  }),
  applicableReasonIds: ['breeding.project-guidance.parent-selection-incomplete'],
  sourceContributions: [{
    sourceKind: 'trainer-edge',
    sourceCanonicalId: 'Breeder',
    status: 'active',
    contributionIds: ['breeding-project-request', 'breeder-dc12-timeline'],
    skillApplication: { skillId: 'pokemon-education', rank: 'Adept', skillTotal: 7 },
    reasonId: null,
  }],
  gmDiagnostics: null,
})
const campaignSettings = [
  ['breeding.baby-template-policy', 'Baby Template', 'Disabled'],
  ['breeding.baby-template-stat-penalty', 'Baby Template stat penalty', '2'],
  ['breeding.check-failure-policy', 'Failed Breeder check', 'No Egg'],
  ['breeding.form-root-policy', 'Form root', 'Base Species'],
  ['breeding.fossil-hatch-level', 'Fossil hatch Level', '10'],
  ['breeding.fossil-inheritance-policy', 'Fossil inheritance', 'None'],
  ['breeding.genderless-policy', 'Genderless pairing', 'Ditto Required'],
  ['breeding.gm-hatch-duration-minutes', 'GM hatch duration', '1440'],
  ['breeding.hatch-duration-variation', 'Hatch duration variation', 'Disabled'],
  ['breeding.hatch-special-policy', 'Hatch special result', 'Disabled'],
  ['breeding.maturity-policy', 'Maturity', 'Minimum Level'],
  ['breeding.minimum-maturity-level', 'Minimum maturity Level', '20'],
  ['breeding.missing-hatch-duration-policy', 'Missing hatch duration', 'GM Adjudication Required'],
  ['breeding.parent-family-policy', 'Offspring family', 'Female Parent'],
  ['breeding.same-sex-policy', 'Same-sex pairing', 'GM Role Adjudication'],
].map(([campaignOptionId, label, valueLabel]) => ({ campaignOptionId, label, valueLabel }))
const projection = () => createBreedingProjectChoicesProjectionV1({
  guidance,
  skillChoice: { status: 'not-required', options: [] },
  traitChoices: [
    { traitKind: 'nature', requiredRank: 'Adept', effectiveRank: 'Adept', status: 'choice-authorised', resolutionCheckpoint: 'egg-production' },
    { traitKind: 'ability', requiredRank: 'Expert', effectiveRank: 'Adept', status: 'random-only', resolutionCheckpoint: 'egg-production' },
    { traitKind: 'gender', requiredRank: 'Master', effectiveRank: 'Adept', status: 'random-only', resolutionCheckpoint: 'egg-production' },
  ],
  campaignSettings,
  maturityChoices: [],
  parentRoleChoice: { status: 'not-required', options: [] },
  confirmation: {
    status: 'incomplete',
    setupStatus: 'not-evaluated',
    canConfirm: false,
    explicitConfirmationRequired: true,
    messageId: 'breeding.project-choices.selection-incomplete',
    project: null,
  },
})

describe('BR-073 Breeding Project choices shared contract', () => {
  it('binds the reviewed artifact to its exact definition and runtime presentation policy', () => {
    expect(createHash('sha256').update(stableJsonStringify(projectChoicesContractJson.definition)).digest('hex'))
      .toBe(projectChoicesContractJson.definitionSha256)
    expect(projectChoicesContractJson.definition.implementation.presentationPolicyDefinitionSha256)
      .toBe(BREEDING_PROJECT_CHOICES_PRESENTATION_POLICY_DEFINITION_SHA256)
    expect(projectChoicesContractJson.definition.scope.clientMechanicsAuthority).toBe('none')
    expect(projectChoicesContractJson.definition.creation.explicitConfirmation).toBe('mandatory')
  })

  it('accepts selectors and opaque options only, with explicit confirmation', () => {
    const draftId = createBreedingProjectDraftId(length => new Uint8Array(length).fill(7))
    const request = parseBreedingProjectChoicesRequestV1({
      schemaVersion: 1,
      draftId,
      profileId: 'profile_owner000',
      destinationTrainerSlug: 'trainer-owner',
      breederTrainerSlug: 'trainer-owner',
      parentRefs: [],
      selectedOptionIds: ['option:v1:11111111111111111111111111111111'],
      confirmed: true,
    })
    expect(request).toMatchObject({ draftId, confirmed: true })
    for (const enriched of [
      { ...request, natureId: 'adamant' },
      { ...request, effectiveRank: 'Master' },
      { ...request, selectedOptionIds: [...request.selectedOptionIds, ...request.selectedOptionIds] },
    ]) expect(() => parseBreedingProjectChoicesRequestV1(enriched)).toThrow(BreedingProjectChoicesContractError)
  })

  it('closes rank gates, campaign settings, and non-mutating trait checkpoints', () => {
    const value = projection()
    expect(parseBreedingProjectChoicesProjectionV1(value)).toStrictEqual(value)
    expect(value.traitChoices.map(choice => [choice.traitKind, choice.requiredRank, choice.status])).toEqual([
      ['nature', 'Adept', 'choice-authorised'],
      ['ability', 'Expert', 'random-only'],
      ['gender', 'Master', 'random-only'],
    ])
    expect(value.campaignSettings).toHaveLength(15)
    expect(value.traitChoices.every(choice => choice.resolutionCheckpoint === 'egg-production')).toBe(true)
  })

  it('rejects contradictory, enriched, sparse, and hash-tampered projections in server and browser parsing', async () => {
    const value = projection()
    expect(() => parseBreedingProjectChoicesProjectionV1({ ...value, privateEvidence: true }))
      .toThrow(BreedingProjectChoicesContractError)
    expect(() => parseBreedingProjectChoicesProjectionV1({
      ...value,
      traitChoices: [{ ...value.traitChoices[0], requiredRank: 'Master' }, ...value.traitChoices.slice(1)],
    })).toThrow(BreedingProjectChoicesContractError)
    expect(() => parseBreedingProjectChoicesProjectionV1({ ...value, campaignSettings: Array(1) }))
      .toThrow(BreedingProjectChoicesContractError)
    await expect(verifyBreedingProjectChoicesProjectionV1(value)).resolves.toStrictEqual(value)
    await expect(verifyBreedingProjectChoicesProjectionV1({
      ...value,
      campaignSettings: value.campaignSettings.map((setting, index) => index === 0
        ? { ...setting, label: 'Changed safe label' }
        : setting),
    })).rejects.toBeInstanceOf(BreedingProjectChoicesVerificationError)
  })
})
