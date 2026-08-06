import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PlayerProfile } from '#shared/playerProfiles'
import { BREEDING_CONSENT_SCOPES, parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { parsePokemonEggDocumentV1 } from '../../shared/breeding/egg'
import { parseBreedingProjectDocumentV1 } from '../../shared/breeding/project'
import { BreedingProjectionValidationError, parseBreedingPublicProjectionV1 } from '../../shared/breeding/projections'
import { createBreedingActorAuthorityV1, createBreedingParentControlEvidenceV1, createBreedingTrainerControlEvidenceV1 } from '../../server/domain/breeding/authorization'
import { createBreedingOptionOfferRecordV1 } from '../../server/domain/breeding/ledgers'
import {
  BreedingProjectionAuthorityError,
  assertBreedingProjectionAudience,
  buildBreedingDiagnosticProjectionV1,
  buildBreedingGmProjectionV1,
  buildBreedingOwnerEggProjectionV1,
  buildBreedingOwnerProjectProjectionV1,
  buildBreedingParticipatingOwnerProjectionV1,
  buildBreedingPublicProjectionV1,
  createBreedingDiagnosticOperatorAuthorityV1,
  parseAuthoritativeBreedingPresentationProjectionV1,
} from '../../server/domain/breeding/projections'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const policy = readJson<Record<string, any>>('data/breeding-automation/projection-contract.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const security = readJson<Record<string, any>>('data/breeding-automation/security-policy.json')
const PROJECT_ID = 'breeding-project:v1:11111111111111111111111111111111'
const EGG_ID = 'pokemon-egg:v1:22222222222222222222222222222222'
const CONSENT_ID = 'breeding-consent:v1:33333333333333333333333333333333'
const PROFILE_OWNER = 'profile_owner1234'
const PROFILE_OTHER = 'profile_other1234'
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const profile = (id: string, trainer: string): PlayerProfile => ({ schemaVersion: 1, id: id as any, displayName: (id === PROFILE_OWNER ? 'Owner' : 'Participant') as any, linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainer }] })
const ownerProfile = profile(PROFILE_OWNER, 'trainer-owner')
const otherProfile = profile(PROFILE_OTHER, 'trainer-other')
const project = () => parseBreedingProjectDocumentV1({
  schemaVersion: 1,
  projectId: PROJECT_ID,
  revision: 1,
  status: 'awaiting-parent-consent',
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  projectCreationOptionSnapshotSha256: 'a'.repeat(64),
  ownerTrainerSlug: 'trainer-owner',
  breederTrainerSlug: 'trainer-breeder',
  parentRefs: [
    { pokemonSheetSlug: 'pokemon-parent-a', ownerTrainerSlug: 'trainer-owner', expectedSheetRevision: 3 },
    { pokemonSheetSlug: 'pokemon-parent-b', ownerTrainerSlug: 'trainer-other', expectedSheetRevision: 5 },
  ],
  consentPolicy: 'cross-owner-current-revision-consent',
  timeline: { initialRequiredCampaignMinutes: 240, initialAccumulatedCampaignMinutes: 0, additionalRequiredCampaignMinutes: 240, additionalAccumulatedCampaignMinutes: 0, initialStartedAtCampaignMinute: null, checkReadyAtCampaignMinute: null, additionalStartedAtCampaignMinute: null, readyToProduceAtCampaignMinute: null, eggProducedAtCampaignMinute: null, lastAppliedClockRevision: null, lastAppliedClockMinute: null },
  check: null,
  producedEggId: null,
  terminal: null,
  createdAtCampaignMinute: 100,
  updatedAtCampaignMinute: 100,
  statusChangedAtCampaignMinute: 100,
  lastOperationId: op(1),
})
const egg = () => parsePokemonEggDocumentV1({
  schemaVersion: 1,
  eggId: EGG_ID,
  revision: 0,
  status: 'incubating',
  ownerTrainerSlug: 'trainer-owner',
  source: { kind: 'fossil', sourceId: 'fossil:helix', evidenceDefinitionSha256: '1'.repeat(64) },
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  definitionHashes: ['1'.repeat(64), '2'.repeat(64)],
  parents: [],
  breeder: null,
  offspring: {
    schemaVersion: 1,
    speciesId: 'omanyte',
    familyRootSpeciesId: 'omanyte',
    speciesSpecDefinitionSha256: '2'.repeat(64),
    nature: { valueId: 'cuddly', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    ability: { valueId: 'swift-swim', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    gender: { valueId: 'female', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    inheritanceCandidates: [{ moveId: 'water-gun', sources: [{ kind: 'source-authority', authorityKind: 'fossil', authorityId: 'fossil:helix', evidenceDefinitionSha256: '1'.repeat(64) }] }],
    providerTraits: { serpentsMark: null, fossilRestoration: null, prehistoricBond: null },
    startingLevel: 10,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
    definitionSha256: '3'.repeat(64),
  },
  incubation: { averageCampaignMinutes: 14_400, targetCampaignMinutes: 14_400, accumulatedCampaignMinutes: 120, variationPolicyId: 'fixed-average', durationResultDefinitionSha256: '4'.repeat(64), lastAppliedClockRevision: 4, lastAppliedClockMinute: 100, readyAtCampaignMinute: null, readinessKind: null, readyOperationId: null, paused: false, pauseReasonId: null, pauseOperationId: null },
  special: { state: 'not-rolled', rollRecordId: null, rollTotal: null, triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false },
  hatchOperationId: null,
  childSheetSlug: null,
  terminal: null,
  createdAtCampaignMinute: 90,
  updatedAtCampaignMinute: 100,
  statusChangedAtCampaignMinute: 90,
  lastOperationId: op(2),
})
const actorCommand = (profileId: string, trainer: string, value: number) => parseBreedingOperationCommandV1({ schemaVersion: 1, operationId: op(value), commandKind: 'preview-breeding', actor: { profileId, selectedTrainerSlug: trainer }, ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 }, scopes: [], payload: { ownerTrainerSlug: trainer, breederTrainerSlug: trainer, parentRefs: [{ pokemonSheetSlug: `pokemon-${value}-a`, expectedSheetRevision: 1 }, { pokemonSheetSlug: `pokemon-${value}-b`, expectedSheetRevision: 1 }], optionSnapshotDefinitionSha256: 'a'.repeat(64) } })
const actor = (which: 'gm' | 'owner' | 'other') => createBreedingActorAuthorityV1({ role: which === 'gm' ? 'gm' : 'player', command: actorCommand(which === 'gm' ? 'campaign-gm' : which === 'owner' ? PROFILE_OWNER : PROFILE_OTHER, which === 'other' ? 'trainer-other' : 'trainer-owner', which === 'gm' ? 30 : which === 'owner' ? 31 : 32), authenticatedPrincipalSha256: 'b'.repeat(64), authenticationPolicyDefinitionSha256: 'c'.repeat(64), profile: which === 'gm' ? null : which === 'owner' ? ownerProfile : otherProfile, evaluatedAtCampaignMinute: 100 })
const ownerControl = () => createBreedingTrainerControlEvidenceV1({ profile: ownerProfile, trainerSheetSlug: 'trainer-owner', trainerSheetRevision: 8, trainerSheetDefinitionSha256: 'd'.repeat(64), evaluatedAtCampaignMinute: 100 })
const otherControl = () => createBreedingTrainerControlEvidenceV1({ profile: otherProfile, trainerSheetSlug: 'trainer-other', trainerSheetRevision: 9, trainerSheetDefinitionSha256: 'e'.repeat(64), evaluatedAtCampaignMinute: 100 })
const otherParentControl = () => createBreedingParentControlEvidenceV1({ parentSheetSlug: 'pokemon-parent-b', parentSheetRevision: 5, parentSheetDefinitionSha256: 'f'.repeat(64), ownerTrainer: { slug: 'trainer-other', revision: 9, definitionSha256: 'e'.repeat(64), currentTeam: [], boxedPokemon: ['pokemon-parent-b'] }, trainerControl: otherControl(), verificationMode: 'profile-control', evaluatedAtCampaignMinute: 100 })
const ownerOffer = (chooserProfileId = PROFILE_OWNER, expiresAtCampaignMinute = 200, digit = '4') => createBreedingOptionOfferRecordV1({ schemaVersion: 1, offerId: `breeding-offer:v1:${digit.repeat(32)}` as any, choiceKind: 'nature', target: { kind: 'breeding-project', projectId: PROJECT_ID as any, revision: 1 }, chooserProfileId, minimumPokemonEducationRank: 'Adept', options: [{ optionId: `option:v1:${String(Number(digit) + 1).repeat(32)}` as any, kind: 'nature', canonicalValueId: 'cuddly', valueDefinitionSha256: '1'.repeat(64), authorityEvidenceIds: ['nature:cuddly'] }], issuedOperationId: op(40 + Number(digit)) as any, issuedCommandSha256: digit.repeat(64), issuedAtCampaignMinute: 90, expiresAtCampaignMinute })
const KEY = Buffer.alloc(32, 7)

describe('Breeding audience presentation projections', () => {
  it('binds five structurally separate audience schemas and keyed identity policy', () => {
    expect(policy).toMatchObject({ schemaVersion: 1, contractId: 'ptu-1.05-breeding-presentation-projections-v1', rulesetDefinitionSha256: ruleset.definitionSha256, sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))) })
    expect(policy.definitionSha256).toBe(sha256(stableJsonStringify(policy.definition)))
    expect(policy.definition.audiences).toEqual(['diagnostic', 'gm', 'owner', 'participating-owner', 'public'])
    expect(policy.definition.authority).toMatchObject({ projectionBuilder: 'server-only', clientInference: 'none', mapEncounterDependency: 'none' })
  })

  it('projects public summaries without raw IDs, identities, revisions, exact time, or mechanics', () => {
    const publicProjection = buildBreedingPublicProjectionV1({ aggregateKind: 'breeding-project', aggregateId: PROJECT_ID, status: 'awaiting-parent-consent', accumulatedCampaignMinutes: 0, targetCampaignMinutes: 240, campaignProjectionKey: KEY, securityPolicyDefinitionSha256: security.definitionSha256 })
    expect(publicProjection).toMatchObject({ audience: 'public', coarseStatus: 'awaiting-consent', summaryId: 'breeding.public.project', progressBand: 'none' })
    const serialized = JSON.stringify(publicProjection)
    expect(serialized).not.toContain(PROJECT_ID)
    expect(serialized).not.toContain('trainer-owner')
    expect(serialized).not.toContain('revision')
    expect(serialized).not.toContain('generatedAtCampaignMinute')
    expect(buildBreedingPublicProjectionV1({ aggregateKind: 'breeding-project', aggregateId: PROJECT_ID, status: 'awaiting-parent-consent', accumulatedCampaignMinutes: 0, targetCampaignMinutes: 240, campaignProjectionKey: Buffer.alloc(32, 8), securityPolicyDefinitionSha256: security.definitionSha256 }).aggregateIdentitySha256).not.toBe(publicProjection.aggregateIdentitySha256)
    expect(() => buildBreedingPublicProjectionV1({ aggregateKind: 'breeding-project', aggregateId: PROJECT_ID, status: 'draft', accumulatedCampaignMinutes: 0, targetCampaignMinutes: 240, campaignProjectionKey: 'short', securityPolicyDefinitionSha256: security.definitionSha256 })).toThrow(BreedingProjectionAuthorityError)
  })

  it('gives the owner workflow facts while structurally hiding the participating parent and raw checks', () => {
    const ownerProjection = buildBreedingOwnerProjectProjectionV1({ project: project(), actorAuthority: actor('owner'), ownerTrainerControl: ownerControl(), consents: [], offers: [ownerOffer(), ownerOffer('profile_other1234', 200, '6'), ownerOffer(PROFILE_OWNER, 99, '8')], availableActions: ['grant-breeding-consent', 'cancel-breeding-project'], explanationReasonIds: ['breeding.projection.awaiting-consent'], generatedAtCampaignMinute: 100, securityPolicyDefinitionSha256: security.definitionSha256 })
    expect(ownerProjection.parentSlots).toEqual([
      { parentIndex: 0, relationship: 'owned', pokemonSheetSlug: 'pokemon-parent-a', sheetRevision: 3, consentStatus: 'not-required' },
      { parentIndex: 1, relationship: 'participating', pokemonSheetSlug: null, sheetRevision: null, consentStatus: 'waiting' },
    ])
    expect(JSON.stringify(ownerProjection)).not.toContain('pokemon-parent-b')
    expect(JSON.stringify(ownerProjection)).not.toContain('roll')
    expect(ownerProjection.availableActions).toEqual(['cancel-breeding-project', 'grant-breeding-consent'])
    expect(ownerProjection.offers).toEqual([{ offerId: 'breeding-offer:v1:44444444444444444444444444444444', revision: 0, choiceKind: 'nature', expiresAtCampaignMinute: 200, options: [{ optionId: 'option:v1:55555555555555555555555555555555', canonicalValueId: 'cuddly' }] }])
    expect(() => buildBreedingOwnerProjectProjectionV1({ project: project(), actorAuthority: actor('other'), ownerTrainerControl: otherControl(), consents: [], offers: [], availableActions: [], explanationReasonIds: [], generatedAtCampaignMinute: 100, securityPolicyDefinitionSha256: security.definitionSha256 })).toThrowError(expect.objectContaining({ code: 'breeding.projection.unauthorized' }))
  })

  it('projects owner Egg traits and candidate Move IDs without parent attribution or special-roll data', () => {
    const projection = buildBreedingOwnerEggProjectionV1({ egg: egg(), actorAuthority: actor('owner'), ownerTrainerControl: ownerControl(), offers: [], availableActions: ['advance-egg-incubation'], explanationReasonIds: [], generatedAtCampaignMinute: 100, securityPolicyDefinitionSha256: security.definitionSha256 })
    expect(projection).toMatchObject({ audience: 'owner', aggregateKind: 'pokemon-egg', offspring: { speciesId: 'omanyte', abilityId: 'swift-swim' }, inheritanceMoveIds: ['water-gun'], specialStatus: 'not-rolled' })
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('fossil:helix')
    expect(serialized).not.toContain('source-authority')
    expect(serialized).not.toContain('rollTotal')
    expect(serialized).not.toContain('automaticShiny')
  })

  it('limits participating owners to their parent, consent request, and own contribution attribution', () => {
    const projection = buildBreedingParticipatingOwnerProjectionV1({ project: project(), actorAuthority: actor('other'), trainerControl: otherControl(), parentControl: otherParentControl(), ownParentSafeSummary: { pokemonSheetSlug: 'pokemon-parent-b', sheetRevision: 5, displayName: 'My Parent', speciesId: 'bulbasaur' }, consentRequest: { consentId: CONSENT_ID, scopes: [...BREEDING_CONSENT_SCOPES].sort(), expiresAtCampaignMinute: 200 }, consentRecord: null, ownContributionMoveIds: ['light-screen'], generatedAtCampaignMinute: 100, securityPolicyDefinitionSha256: security.definitionSha256 })
    expect(projection).toMatchObject({ audience: 'participating-owner', ownParent: { pokemonSheetSlug: 'pokemon-parent-b' }, consent: { status: 'waiting' }, ownContributionMoveIds: ['light-screen'], otherParentPresent: true, availableActions: ['grant-breeding-consent'] })
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain('trainer-owner')
    expect(serialized).not.toContain('pokemon-parent-a')
    expect(serialized).not.toContain(PROFILE_OTHER)
    expect(serialized).not.toContain('initialRequiredCampaignMinutes')
  })

  it('gives full strict mechanics only to GM and hash-only traces only to diagnostic operators', () => {
    const gm = buildBreedingGmProjectionV1({ audience: 'gm', aggregateKind: 'breeding-project', document: project(), rolls: [], checks: [], offers: [], consents: [], adjudications: [], authorizationReceipts: [], readSets: [], availableActions: ['mark-egg-ready'], generatedAtCampaignMinute: 100, securityPolicyDefinitionSha256: security.definitionSha256, actorAuthority: actor('gm') })
    expect(JSON.stringify(gm)).toContain('pokemon-parent-b')
    expect(() => buildBreedingGmProjectionV1({ audience: 'gm', aggregateKind: 'breeding-project', document: project(), rolls: [], checks: [], offers: [], consents: [], adjudications: [], authorizationReceipts: [], readSets: [], availableActions: [], generatedAtCampaignMinute: 100, securityPolicyDefinitionSha256: security.definitionSha256, actorAuthority: actor('owner') })).toThrowError(expect.objectContaining({ code: 'breeding.projection.unauthorized' }))
    const authority = createBreedingDiagnosticOperatorAuthorityV1({ principalSha256: '1'.repeat(64), policyDefinitionSha256: '2'.repeat(64), evaluatedAtCampaignMinute: 100 })
    const diagnostic = buildBreedingDiagnosticProjectionV1({ aggregateKind: 'breeding-project', aggregateId: PROJECT_ID, revision: 1, aggregateDefinitionSha256: '3'.repeat(64), rulesetDefinitionSha256: ruleset.definitionSha256, operationDefinitionHashes: ['4'.repeat(64)], traces: [{ stage: 'authorize', status: 'ok', definitionHashes: ['5'.repeat(64)] }], reasonIds: ['breeding.projection.ok'], generatedAtCampaignMinute: 100, operatorAuthority: authority, campaignProjectionKey: KEY, securityPolicyDefinitionSha256: security.definitionSha256 })
    const serialized = JSON.stringify(diagnostic)
    expect(serialized).not.toContain(PROJECT_ID)
    expect(serialized).not.toContain('pokemon-parent')
    expect(serialized).not.toContain('profile_')
    expect(serialized).not.toContain('command')
  })

  it('self-hashes each schema and rejects cross-audience adoption, enrichment, and tampering', () => {
    const projection = buildBreedingPublicProjectionV1({ aggregateKind: 'pokemon-egg', aggregateId: EGG_ID, status: 'incubating', accumulatedCampaignMinutes: 120, targetCampaignMinutes: 14_400, campaignProjectionKey: KEY, securityPolicyDefinitionSha256: security.definitionSha256 })
    expect(parseAuthoritativeBreedingPresentationProjectionV1(projection)).toEqual(projection)
    expect(assertBreedingProjectionAudience(projection, 'public')).toEqual(projection)
    expect(() => assertBreedingProjectionAudience(projection, 'owner')).toThrowError(expect.objectContaining({ code: 'breeding.projection.unauthorized' }))
    expect(() => parseBreedingPublicProjectionV1({ ...projection, parentSlug: 'pokemon-hidden' })).toThrowError(expect.objectContaining({ code: 'breeding.projection.unknown-field' }))
    expect(() => parseAuthoritativeBreedingPresentationProjectionV1({ ...projection, coarseStatus: 'ready' })).toThrowError(expect.objectContaining({ code: 'breeding.projection.hash-mismatch' }))
    const accessor = structuredClone(projection)
    Object.defineProperty(accessor, 'audience', { enumerable: true, get: () => 'public' })
    expect(() => parseBreedingPublicProjectionV1(accessor)).toThrow(BreedingProjectionValidationError)
  })
})
