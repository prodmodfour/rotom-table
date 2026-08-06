import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import fossilEggContractJson from '../../data/breeding-automation/fossil-egg-contract.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { parseAuthoritativePokemonEggDocumentV1 } from '../../server/domain/breeding/lineage'
import { parseBreedingReadResourceV1, BREEDING_REFERENCE_SOURCE_IDS } from '../../shared/breeding/readSets'
import {
  createBreedingActorAuthorityV1,
  createBreedingAuthorizationReceiptV1,
} from '../../server/domain/breeding/authorization'
import { resolveBreedingCampaignOptionSnapshot } from '../../server/domain/breeding/campaignOptions'
import { BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256 } from '../../server/domain/breeding/babyTemplate'
import { planPokemonEggChildSheetConstructionV1 } from '../../server/domain/breeding/childSheetConstruction'
import { createBreedingFeatureProviderHandoffV1 } from '../../server/domain/breeding/featureProviderHandoff'
import {
  BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256,
  breedingFossilEggDependencyEvidenceV1,
  breedingFossilOfferOptionId,
  BreedingFossilEggAuthorityError,
  consumeBreedingFossilSourceInventoryV1,
  createBreedingFossilEggOptionOffersV1,
  createBreedingFossilReanimationAuthorityV1,
  createBreedingFossilSourceAuthorityV1,
  planBreedingFossilEggV1,
} from '../../server/domain/breeding/fossilEgg'
import { createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import { COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256 } from '../../server/domain/breeding/registry'
import {
  createBreedingOperationReadSetV1,
  createBreedingReferenceVersionSnapshotV1,
} from '../../server/domain/breeding/readSets'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteSheetRepository, type StoredSheetDocument } from '../../server/storage/sheetRepository'
import {
  createBreedingFossilEgg,
  CreateBreedingFossilEggError,
  type CreateBreedingFossilEggOptions,
} from '../../server/useCases/createBreedingFossilEgg'
import type { TrainerSheet } from '../../src/types/trainerSheet'

const ruleset = rulesetJson as { readonly rulesetId: string, readonly definitionSha256: string }
const security = securityPolicyJson as { readonly definitionSha256: string }
const EGG_ID = 'pokemon-egg:v1:65656565656565656565656565656565'
const OPERATION_ID = 'breeding-operation:v1:65656565656565656565656565656565'
const sha = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const databases: RotomDatabase[] = []
const open = (): RotomDatabase => { const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database); return database }
afterEach(() => { vi.restoreAllMocks(); while (databases.length > 0) databases.pop()?.close() })

const trainerDocument = (withFeatures = false): TrainerSheet => ({
  slug: 'trainer-fossil',
  name: 'Fossil Researcher',
  level: 20,
  skillBackground: withFeatures ? { adept: 'pokeEd', novice: 'survival' } : { novice: 'pokeEd' },
  ...(withFeatures ? { skills: { pokeEd: { rankBonus: 1 } } } : {}),
  edges: [{ name: 'Paleontologist' }],
  features: withFeatures ? [{ name: 'Fossil Restoration' }, { name: 'Prehistoric Bond' }] : [],
  currentTeam: [],
  boxedPokemon: [],
  inventory: {
    keyItems: [
      { id: 'fossil-unit-1', name: 'Unidentified Stone Sample', qty: 1, description: 'GM-designated fossil source.' },
      { id: 'reanimation-machine-1', name: 'Reanimation Machine', qty: 1 },
    ],
  },
})
const saveTrainer = (database: RotomDatabase, withFeatures = false, revision = 3): StoredSheetDocument<unknown> => createSqliteSheetRepository(database).save({
  kind: 'trainer', slug: 'trainer-fossil', document: trainerDocument(withFeatures), revision, updatedAt: 1_000,
})
const sourceAuthorities = (trainer: StoredSheetDocument<unknown>) => {
  const source = createBreedingFossilSourceAuthorityV1({
    eggId: EGG_ID,
    sourceId: 'fossil:helix-sample',
    ownerTrainerSheet: { slug: trainer.slug, revision: trainer.revision, document: trainer.document },
    custody: { inventoryEntryId: 'fossil-unit-1', unitOrdinal: 0 },
    capturedAtCampaignMinute: 0,
  })
  const reanimation = createBreedingFossilReanimationAuthorityV1({
    ownerTrainerSheet: { slug: trainer.slug, revision: trainer.revision, document: trainer.document },
    sourceAuthority: source,
    reanimationMachineCustody: { inventoryEntryId: 'reanimation-machine-1', unitOrdinal: 0 },
    capturedAtCampaignMinute: 0,
  })
  return { source, reanimation }
}
const option = (slot: Parameters<typeof breedingFossilOfferOptionId>[1], value: string): string => breedingFossilOfferOptionId(OPERATION_ID, slot, value)
const command = (sourceHash: string, requestedRollKinds: readonly string[] = [], babyTemplate = false) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: OPERATION_ID,
  commandKind: 'create-source-egg',
  actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  scopes: [
    { kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: null },
    { kind: 'trainer-sheet', sheetSlug: 'trainer-fossil', expectedRevision: 3, fields: ['inventory'] },
  ],
  payload: {
    eggId: EGG_ID,
    ownerTrainerSlug: 'trainer-fossil',
    source: { kind: 'fossil', sourceId: 'fossil:helix-sample', evidenceDefinitionSha256: sourceHash },
    speciesOptionId: option('species', 'omanyte'),
    resolutions: {
      selectedOptionIds: [option('nature', 'cuddly'), option('primary-ability', 'shell-armor'), option('gender', 'male'),
        ...(babyTemplate ? [option('baby-template', 'baby-template:apply:size-percent:70')] : [])].sort(),
      requestedRollKinds,
    },
  },
})
const offerChoicesFor = (babyTemplate = false) => ({
  species: ['omanyte'],
  nature: ['cuddly'],
  primaryAbility: ['shell-armor', 'weak-armor'],
  gender: ['female', 'male'],
  inheritanceMoves: [],
  restorationExtraAbility: [],
  prehistoricBondStat: [],
  hatchDuration: [],
  ...(babyTemplate ? { babyTemplate: ['baby-template:decline', 'baby-template:apply:size-percent:70'] } : {}),
})
const offerChoices = offerChoicesFor()
const featureHandoff = (trainer: StoredSheetDocument<unknown>, accessHash: string) => createBreedingFeatureProviderHandoffV1({
  trainerSheet: { slug: trainer.slug, revision: trainer.revision, document: trainer.document },
  accessMode: 'gm-authority', accessEvidenceDefinitionSha256: accessHash,
  checkpoint: 'hatch-transaction', capturedAtCampaignMinute: 0, facilityClaims: [],
})
const references = (optionsHash: string) => createBreedingReferenceVersionSnapshotV1({
  schemaVersion: 1,
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  sourceManifestSha256: '1'.repeat(64),
  semanticRegistryDefinitionSha256: '2'.repeat(64),
  compiledRegistryDefinitionSha256: COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  canonicalIdsDefinitionSha256: '3'.repeat(64),
  campaignOptionSnapshotDefinitionSha256: optionsHash,
  referenceSources: BREEDING_REFERENCE_SOURCE_IDS.map((sourceId, index) => ({ sourceId, contentSha256: (index + 10).toString(16).padStart(64, '0') })),
  contractDefinitionHashes: [
    'breeding-authorization-contract','breeding-ledger-contract','breeding-lineage-contract','breeding-operation-contract',
    'breeding-project-contract','breeding-read-set-contract','breeding-security-policy','pokemon-egg-contract',
  ].map((contractId, index) => ({ contractId, definitionSha256: (index + 40).toString(16).padStart(64, '0') })),
})
const present = (resourceKind: string, resourceId: string, revision: number, definitionSha256: string, purposes: readonly string[], observedCampaignMinute: number | null = null) => parseBreedingReadResourceV1({
  resourceKind, resourceId, existence: 'present', revision, definitionSha256, observedCampaignMinute, purposes: [...purposes].sort(),
})
const absent = (resourceKind: string, resourceId: string, purposes: readonly string[]) => parseBreedingReadResourceV1({
  resourceKind, resourceId, existence: 'absent', revision: null, definitionSha256: null, observedCampaignMinute: null, purposes: [...purposes].sort(),
})

const authority = (database: RotomDatabase, withFeatures = false, randomDuration = false, babyTemplate = false) => {
  const trainer = saveTrainer(database, withFeatures)
  const { source, reanimation } = sourceAuthorities(trainer)
  const options = resolveBreedingCampaignOptionSnapshot({
    ...(randomDuration ? { 'breeding.hatch-duration-variation': 'server-random-half-to-double' } : {}),
    ...(babyTemplate ? { 'breeding.baby-template-policy': 'per-egg-gm-choice', 'breeding.baby-template-stat-penalty': 4 } : {}),
  })
  const operation = command(source.definitionSha256, randomDuration ? ['hatch-duration'] : [], babyTemplate)
  const actor = createBreedingActorAuthorityV1({
    role: 'gm', command: operation, authenticatedPrincipalSha256: 'a'.repeat(64),
    authenticationPolicyDefinitionSha256: 'b'.repeat(64), profile: null, evaluatedAtCampaignMinute: 0,
  })
  const feature = featureHandoff(trainer, actor.definitionSha256)
  const choices = offerChoicesFor(babyTemplate)
  const offers = createBreedingFossilEggOptionOffersV1({ command: operation, sourceAuthority: source, trainerSheetRevision: trainer.revision, campaignOptionSnapshot: options, choices, issuedAtCampaignMinute: 0, expiresAtCampaignMinute: 500 })
  const dependencies = breedingFossilEggDependencyEvidenceV1({ sourceAuthority: source, reanimationAuthority: reanimation, featureProviderHandoff: feature, campaignOptionSnapshot: options, speciesId: 'omanyte' })
  const attestation = {
    providerKind: 'system' as const, providerId: 'breeding-effective-dependency-set-v1', subjectKind: 'campaign' as const,
    subjectId: 'campaign', subjectRevision: null, checkpoint: 'authorization' as const,
    providerDefinitionSha256: security.definitionSha256, effectiveEvidenceSha256: sha(dependencies),
  }
  const currentReferences = references(options.definitionSha256)
  const readSet = createBreedingOperationReadSetV1({
    readSetId: 'breeding-read-set:v1:65656565656565656565656565656565' as never,
    operationId: operation.operationId,
    commandSha256: createBreedingOperationCommandHash(operation),
    commandKind: operation.commandKind,
    capturedAtCampaignMinute: 0,
    resources: [
      present('campaign-clock', 'campaign-clock', 0, sha({ schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null }), ['campaign-time'], 0),
      absent('pokemon-egg', EGG_ID, ['conflict']),
      present('trainer-sheet', trainer.slug, trainer.revision, sha(trainer.document), ['authorization','conflict','mechanics']),
      ...offers.map(offer => present('breeding-offer', offer.offerId, 0, offer.definitionSha256, ['mechanics'])),
    ],
    referenceVersions: currentReferences,
    dependencyEvidence: [attestation, ...dependencies],
    writeExpectations: operation.scopes,
  })
  const receipt = createBreedingAuthorizationReceiptV1({
    operationId: operation.operationId,
    commandSha256: createBreedingOperationCommandHash(operation),
    commandKind: operation.commandKind,
    actorAuthorityDefinitionSha256: actor.definitionSha256,
    readSetDefinitionSha256: readSet.definitionSha256,
    evidenceDefinitionHashes: [actor.definitionSha256, source.definitionSha256, reanimation.definitionSha256, feature.definitionSha256, options.definitionSha256, BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256, ...offers.map(offer => offer.definitionSha256)],
    gmOverrideIds: [], authorized: true, reasonId: 'breeding.authorization.authorized',
    evaluatedAtCampaignMinute: 0, securityPolicyDefinitionSha256: security.definitionSha256,
  })
  return { trainer, source, reanimation, options, operation, actor, feature, choices, offers, currentReferences, readSet, receipt }
}
const useCaseOptions = (database: RotomDatabase, auth: ReturnType<typeof authority>, overrides: Partial<CreateBreedingFossilEggOptions> = {}): CreateBreedingFossilEggOptions => ({
  database,
  validateCurrentGmAuthority: () => true,
  resolveCurrentCampaignOptionSnapshot: () => auth.options,
  resolveCurrentReferenceVersions: () => auth.currentReferences,
  resolveCurrentOfferChoices: () => auth.choices,
  offerLifetimeCampaignMinutes: 500,
  campaignProjectionKey: 'fossil-test-campaign-projection-key-0001',
  realtimeTimestamp: 2_000,
  sheetUpdatedAt: 2_000,
  ...overrides,
})
const useCaseInput = (auth: ReturnType<typeof authority>) => ({
  command: auth.operation,
  readSet: auth.readSet,
  authorizationReceipt: auth.receipt,
  actorAuthority: auth.actor,
  sourceAuthority: auth.source,
  reanimationAuthority: auth.reanimation,
  featureProviderHandoff: auth.feature,
  campaignOptionSnapshot: auth.options,
  audience: 'gm',
})
const expectDomainCode = (callback: () => unknown, code: string): void => {
  try { callback(); throw new Error('Expected fossil authority failure.') }
  catch (error) { expect(error).toBeInstanceOf(BreedingFossilEggAuthorityError); expect((error as BreedingFossilEggAuthorityError).code).toBe(code) }
}
const expectUseCaseCode = (callback: () => unknown, code: string): void => {
  try { callback(); throw new Error('Expected fossil use-case failure.') }
  catch (error) { expect(error).toBeInstanceOf(CreateBreedingFossilEggError); expect((error as CreateBreedingFossilEggError).code).toBe(code) }
}

describe('BR-065 fossil Eggs through the shared lifecycle', () => {
  it('requires exact inventory custody, current effective Paleontologist authority, its Skill prerequisite, and a Reanimation Machine', () => {
    expect(sha(fossilEggContractJson.definition)).toBe(fossilEggContractJson.definitionSha256)
    expect(fossilEggContractJson.definition.bindings.runtimePolicyDefinitionSha256).toBe(BREEDING_FOSSIL_EGG_POLICY_DEFINITION_SHA256)
    expect(fossilEggContractJson.definition.egg).toMatchObject({ aggregate: 'PokemonEggDocumentV1', defaultStartingLevel: 10, parallelFossilHatchPath: 'forbidden' })
    const database = open(); const trainer = saveTrainer(database); const { source, reanimation } = sourceAuthorities(trainer)
    expect(source).toMatchObject({ eggId: EGG_ID, sourceInventoryEntryId: 'fossil-unit-1', sourceUnitOrdinal: 0, designationReasonId: 'breeding.fossil-source.gm-designated' })
    expect(reanimation).toMatchObject({ paleontologistEdgeInstanceId: expect.stringContaining('paleontologist'), prerequisiteSkillId: 'pokemon-education', prerequisiteSkillRank: 'Novice', reanimationMachineInventoryEntryId: 'reanimation-machine-1' })
    const rawHeld = structuredClone(trainer.document) as TrainerSheet
    rawHeld.inventory = { keyItems: [{ id: 'fossil-unit-1', name: 'Unidentified Stone Sample', qty: 1 }] }
    ;(rawHeld as TrainerSheet & { equipmentSlots: { mainHand: string } }).equipmentSlots = { mainHand: 'Reanimation Machine' }
    expectDomainCode(() => createBreedingFossilReanimationAuthorityV1({ ownerTrainerSheet: { slug: trainer.slug, revision: trainer.revision, document: rawHeld }, sourceAuthority: source, reanimationMachineCustody: { inventoryEntryId: 'Reanimation Machine', unitOrdinal: 0 }, capturedAtCampaignMinute: 0 }), 'breeding.fossil-egg.stale-authority')
    const noEdge = createSqliteSheetRepository(database).save({ kind: 'trainer', slug: trainer.slug, revision: 4, updatedAt: 2_000, document: { ...trainerDocument(), edges: [] } })
    const source2 = createBreedingFossilSourceAuthorityV1({ eggId: EGG_ID, sourceId: 'fossil:helix-sample', ownerTrainerSheet: { slug: noEdge.slug, revision: noEdge.revision, document: noEdge.document }, custody: { inventoryEntryId: 'fossil-unit-1', unitOrdinal: 0 }, capturedAtCampaignMinute: 0 })
    expectDomainCode(() => createBreedingFossilReanimationAuthorityV1({ ownerTrainerSheet: { slug: noEdge.slug, revision: noEdge.revision, document: noEdge.document }, sourceAuthority: source2, reanimationMachineCustody: { inventoryEntryId: 'reanimation-machine-1', unitOrdinal: 0 }, capturedAtCampaignMinute: 0 }), 'breeding.fossil-egg.provider-unavailable')
    const malformedInventory = structuredClone(trainer.document) as TrainerSheet & { inventory: Record<string, unknown> }
    malformedInventory.inventory.invalid = { id: 'silently-ignored-before-br-065' }
    expectDomainCode(() => createBreedingFossilSourceAuthorityV1({ eggId: EGG_ID, sourceId: 'fossil:helix-sample', ownerTrainerSheet: { slug: trainer.slug, revision: trainer.revision, document: malformedInventory }, custody: { inventoryEntryId: 'fossil-unit-1', unitOrdinal: 0 }, capturedAtCampaignMinute: 0 }), 'breeding.fossil-egg.invalid-request')
  })

  it('creates a normal parentless Egg at default Level 10 and consumes only bounded offers', () => {
    const database = open(); const auth = authority(database)
    const planned = planBreedingFossilEggV1({ command: auth.operation, sourceAuthority: auth.source, reanimationAuthority: auth.reanimation, featureProviderHandoff: auth.feature, campaignOptionSnapshot: auth.options, offers: auth.offers, campaignClock: { schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null }, hatchDurationRoll: null })
    expect(planned.egg).toMatchObject({ eggId: EGG_ID, revision: 0, status: 'incubating', source: { kind: 'fossil' }, parents: [], breeder: null, offspring: { speciesId: 'omanyte', startingLevel: 10, providerTraits: { fossilRestoration: null, prehistoricBond: null } } })
    expect(planned.egg.incubation).toMatchObject({ averageCampaignMinutes: 23_040, targetCampaignMinutes: 23_040, accumulatedCampaignMinutes: 0 })
    expect(planned.consumedOffers).toHaveLength(4)
    expect(planned.consumedOffers.every(offer => offer.status === 'consumed')).toBe(true)
    const forged = structuredClone(auth.operation)
    forged.payload.resolutions.selectedOptionIds = [...forged.payload.resolutions.selectedOptionIds, 'option:v1:ffffffffffffffffffffffffffffffff'].sort()
    expectDomainCode(() => planBreedingFossilEggV1({ command: forged, sourceAuthority: auth.source, reanimationAuthority: auth.reanimation, featureProviderHandoff: auth.feature, campaignOptionSnapshot: auth.options, offers: auth.offers, campaignClock: { schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null }, hatchDurationRoll: null }), 'breeding.fossil-egg.invalid-choice')
    const coercion = vi.fn(() => 'omanyte')
    expectDomainCode(() => createBreedingFossilEggOptionOffersV1({ command: auth.operation, sourceAuthority: auth.source, trainerSheetRevision: 3, campaignOptionSnapshot: auth.options, choices: { ...offerChoices, species: [{ toString: coercion }] }, issuedAtCampaignMinute: 0, expiresAtCampaignMinute: 500 }), 'breeding.fossil-egg.invalid-choice')
    expect(coercion).not.toHaveBeenCalled()
  })

  it('freezes one bounded optional Baby Template choice without creating a parallel fossil path', () => {
    const database = open(); const auth = authority(database, false, false, true)
    const result = createBreedingFossilEgg(useCaseInput(auth), useCaseOptions(database, auth))
    expect(result.execution.kind).toBe('executed')
    expect(result.egg?.offspring).toMatchObject({
      startingLevel: 10,
      babyTemplate: { applied: true, choiceOptionId: option('baby-template', 'baby-template:apply:size-percent:70'),
        effects: { baseStatPenaltyEach: 4, sizePercentOfAdult: 70, recoveryStepCount: 4 } },
      providerTraits: { marsupial: null, playingGod: null },
    })
    expect(result.egg?.definitionHashes).toContain(BREEDING_BABY_TEMPLATE_POLICY_DEFINITION_SHA256)
    const staleOptions = resolveBreedingCampaignOptionSnapshot({
      'breeding.baby-template-policy': 'per-egg-gm-choice',
      'breeding.baby-template-stat-penalty': 3,
    })
    expectDomainCode(() => planBreedingFossilEggV1({ command: auth.operation, sourceAuthority: auth.source,
      reanimationAuthority: auth.reanimation, featureProviderHandoff: auth.feature,
      campaignOptionSnapshot: staleOptions, offers: auth.offers,
      campaignClock: { schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null },
      hatchDurationRoll: null }), 'breeding.fossil-egg.invalid-choice')
  })

  it('forces Marsupial for a fossil-source Kangaskhan without issuing a campaign substitute', () => {
    const database = open(); const auth = authority(database)
    const operation = parseBreedingOperationCommandV1({
      ...auth.operation,
      payload: { ...auth.operation.payload,
        speciesOptionId: option('species', 'kangaskhan'),
        resolutions: { selectedOptionIds: [option('nature', 'cuddly'), option('primary-ability', 'early-bird'), option('gender', 'female')].sort(), requestedRollKinds: [] },
      },
    })
    const options = resolveBreedingCampaignOptionSnapshot({
      'breeding.baby-template-policy': 'per-egg-gm-choice',
      'breeding.baby-template-stat-penalty': 4,
    })
    const offers = createBreedingFossilEggOptionOffersV1({ command: operation, sourceAuthority: auth.source,
      trainerSheetRevision: auth.trainer.revision, campaignOptionSnapshot: options,
      choices: { ...offerChoices, species: ['kangaskhan'], primaryAbility: ['early-bird'] },
      issuedAtCampaignMinute: 0, expiresAtCampaignMinute: 500 })
    const planned = planBreedingFossilEggV1({ command: operation, sourceAuthority: auth.source,
      reanimationAuthority: auth.reanimation, featureProviderHandoff: auth.feature,
      campaignOptionSnapshot: options, offers,
      campaignClock: { schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null }, hatchDurationRoll: null })
    expect(planned.egg.offspring).toMatchObject({ speciesId: 'kangaskhan',
      babyTemplate: { applied: true, effects: { baseStatPenaltyEach: 5 } },
      providerTraits: { marsupial: { motherPouchRequired: true, removalLevel: 25 } } })
  })

  it('uses one explicit bounded Advanced Ability only when the fossil Species has one Basic Ability', () => {
    const database = open()
    const trainer = createSqliteSheetRepository(database).save({
      kind: 'trainer', slug: 'trainer-fossil', revision: 3, updatedAt: 1_000,
      document: { ...trainerDocument(false), skillBackground: { adept: 'pokeEd' }, skills: { pokeEd: { rankBonus: 1 } }, features: [{ name: 'Fossil Restoration' }] },
    })
    const { source, reanimation } = sourceAuthorities(trainer)
    const archenCommand = parseBreedingOperationCommandV1({
      ...command(source.definitionSha256),
      payload: {
        ...command(source.definitionSha256).payload,
        speciesOptionId: option('species', 'archen'),
        resolutions: {
          selectedOptionIds: [option('nature', 'cuddly'), option('primary-ability', 'defeatist'), option('gender', 'male'), option('restoration-extra-ability', 'rattled')].sort(),
          requestedRollKinds: [],
        },
      },
    })
    const feature = featureHandoff(trainer, 'a'.repeat(64))
    const options = resolveBreedingCampaignOptionSnapshot()
    const offers = createBreedingFossilEggOptionOffersV1({
      command: archenCommand, sourceAuthority: source, trainerSheetRevision: 3, campaignOptionSnapshot: options,
      choices: { species: ['archen'], nature: ['cuddly'], primaryAbility: ['defeatist'], gender: ['female','male'], inheritanceMoves: [], restorationExtraAbility: ['rattled','early-bird','dodge'], prehistoricBondStat: [], hatchDuration: [] },
      issuedAtCampaignMinute: 0, expiresAtCampaignMinute: 500,
    })
    const planned = planBreedingFossilEggV1({ command: archenCommand, sourceAuthority: source, reanimationAuthority: reanimation, featureProviderHandoff: feature, campaignOptionSnapshot: options, offers, campaignClock: { schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null }, hatchDurationRoll: null })
    expect(planned.egg.offspring.providerTraits.fossilRestoration).toMatchObject({ extraAbilityId: 'rattled', extraAbilityTier: 'advanced', tutorPointDelta: -2 })
    const noChoice = structuredClone(archenCommand)
    noChoice.payload.resolutions.selectedOptionIds = noChoice.payload.resolutions.selectedOptionIds.filter((id: string) => id !== option('restoration-extra-ability', 'rattled'))
    expectDomainCode(() => planBreedingFossilEggV1({ command: noChoice, sourceAuthority: source, reanimationAuthority: reanimation, featureProviderHandoff: feature, campaignOptionSnapshot: options, offers, campaignClock: { schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null }, hatchDurationRoll: null }), 'breeding.fossil-egg.invalid-choice')
  })

  it('freezes Fossil Restoration and unique-stat Prehistoric Bond into child-facing provider traits', () => {
    const database = open(); const auth = authority(database, true)
    const planned = planBreedingFossilEggV1({ command: auth.operation, sourceAuthority: auth.source, reanimationAuthority: auth.reanimation, featureProviderHandoff: auth.feature, campaignOptionSnapshot: auth.options, offers: auth.offers, campaignClock: { schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null }, hatchDurationRoll: null })
    expect(planned.egg.offspring.providerTraits.fossilRestoration).toMatchObject({ tutorPointDelta: -2, extraAbilityId: 'weak-armor', extraAbilityTier: 'basic', sourceTrainerSlug: 'trainer-fossil' })
    expect(planned.egg.offspring.providerTraits.prehistoricBond).toMatchObject({ highestBaseStatId: 'def', selectionKind: 'unique-highest', heldItemId: 'prehistoric-razors', heldItemName: 'Prehistoric Razors' })
    expect(planned.egg.offspring.providerTraits.prehistoricBond?.selectionOptionId).toBeNull()
  })

  it('requires a bounded GM offer only for exact tied Nature-adjusted highest Base Stats', () => {
    const database = open(); const trainer = saveTrainer(database, true); const { source, reanimation } = sourceAuthorities(trainer)
    const tiedCommand = parseBreedingOperationCommandV1({
      ...command(source.definitionSha256),
      payload: {
        ...command(source.definitionSha256).payload,
        speciesOptionId: option('species', 'arbok'),
        resolutions: {
          selectedOptionIds: [option('nature', 'cuddly'), option('primary-ability', 'shed-skin'), option('gender', 'female'), option('prehistoric-bond-stat', 'fossil-held-item-stat:sdef')].sort(),
          requestedRollKinds: [],
        },
      },
    })
    const feature = featureHandoff(trainer, 'b'.repeat(64)); const options = resolveBreedingCampaignOptionSnapshot()
    const offers = createBreedingFossilEggOptionOffersV1({
      command: tiedCommand, sourceAuthority: source, trainerSheetRevision: 3, campaignOptionSnapshot: options,
      choices: { species: ['arbok'], nature: ['cuddly'], primaryAbility: ['shed-skin','intimidate'], gender: ['female','male'], inheritanceMoves: [], restorationExtraAbility: [], prehistoricBondStat: ['fossil-held-item-stat:sdef','fossil-held-item-stat:spd'], hatchDuration: [] },
      issuedAtCampaignMinute: 0, expiresAtCampaignMinute: 500,
    })
    const planned = planBreedingFossilEggV1({ command: tiedCommand, sourceAuthority: source, reanimationAuthority: reanimation, featureProviderHandoff: feature, campaignOptionSnapshot: options, offers, campaignClock: { schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null }, hatchDurationRoll: null })
    expect(planned.egg.offspring.providerTraits.prehistoricBond).toMatchObject({ highestBaseStatId: 'sdef', selectionKind: 'bounded-gm-tie', heldItemId: 'prehistoric-aegis', selectionOptionId: option('prehistoric-bond-stat', 'fossil-held-item-stat:sdef') })
    expect(planned.egg.offspring.providerTraits.prehistoricBond?.heldItemEffect).toContain('may only be used by Pokémon revived from Fossils')
  })

  it('routes the frozen fossil Egg through the ordinary child builder with Restoration Tutor Points, Ability, and Bond item', () => {
    const database = open(); const auth = authority(database, true)
    const planned = planBreedingFossilEggV1({ command: auth.operation, sourceAuthority: auth.source, reanimationAuthority: auth.reanimation, featureProviderHandoff: auth.feature, campaignOptionSnapshot: auth.options, offers: auth.offers, campaignClock: { schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null }, hatchDurationRoll: null })
    const hatchOperationId = 'breeding-operation:v1:65656565656565656565656565656566'
    const readyOperationId = 'breeding-operation:v1:65656565656565656565656565656567'
    const egg = parseAuthoritativePokemonEggDocumentV1({
      ...planned.egg,
      revision: 2,
      status: 'hatching',
      incubation: {
        ...planned.egg.incubation,
        accumulatedCampaignMinutes: planned.egg.incubation.targetCampaignMinutes,
        readyAtCampaignMinute: planned.egg.incubation.targetCampaignMinutes,
        readinessKind: 'incubation-complete',
        readyOperationId,
      },
      special: {
        state: 'normal', rollRecordId: 'breeding-roll:v1:65656565656565656565656565656565', rollTotal: 50,
        triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false,
      },
      hatchOperationId,
      updatedAtCampaignMinute: planned.egg.incubation.targetCampaignMinutes,
      statusChangedAtCampaignMinute: planned.egg.incubation.targetCampaignMinutes,
      lastOperationId: hatchOperationId,
    })
    const complete = parseBreedingOperationCommandV1({
      schemaVersion: 1,
      operationId: 'breeding-operation:v1:65656565656565656565656565656568',
      commandKind: 'complete-hatch',
      actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
      ruleset: egg.ruleset,
      scopes: [
        { kind: 'pokemon-egg', eggId: EGG_ID, expectedRevision: 2 },
        { kind: 'trainer-sheet', sheetSlug: 'trainer-fossil', expectedRevision: 4, fields: ['experience','roster'] },
        { kind: 'pokemon-sheet-allocation', namespace: 'pokemon' },
        { kind: 'species-acquisition', trainerSheetSlug: 'trainer-fossil', speciesId: 'omanyte' },
      ],
      payload: {
        eggId: EGG_ID,
        originId: 'pokemon-breeding-origin:v1:65656565656565656565656565656565',
        destination: { kind: 'box', trainerSheetSlug: 'trainer-fossil' },
      },
    })
    const child = planPokemonEggChildSheetConstructionV1({ egg, command: complete })
    expect(child.document).toMatchObject({
      species: 'Omanyte', level: 10,
      tutorPoints: { earned: 1, spent: 2 },
      abilities: [{ name: 'Shell Armor' }, { name: 'Weak Armor' }],
      items: { held: 'Prehistoric Razors', itemDescription: expect.stringContaining('damaging Melee Attack') },
      serverPrivate: { breedingProviderTraits: {
        fossilRestoration: { tutorPointDelta: -2, extraAbilityId: 'weak-armor', sourceEggId: EGG_ID },
        prehistoricBond: { highestBaseStatId: 'def', heldItemId: 'prehistoric-razors', sourceEggId: EGG_ID },
      } },
    })
  })

  it('atomically consumes one fossil unit, persists the shared Egg, offers, result, and restricted refresh rows', () => {
    const database = open(); const auth = authority(database)
    const result = createBreedingFossilEgg(useCaseInput(auth), useCaseOptions(database, auth))
    expect(result.execution.kind).toBe('executed')
    expect(result.execution.record.status).toBe('accepted')
    expect(result.egg).toMatchObject({ eggId: EGG_ID, source: { kind: 'fossil' }, status: 'incubating', revision: 0 })
    expect(result.projection).toMatchObject({ audience: 'gm', sourceKind: 'fossil', startingLevel: 10, parentSnapshotCount: 0, traitsBounded: true })
    expect(result.sourceTrainerSheet?.revision).toBe(4)
    const inventory = (result.sourceTrainerSheet?.sheet as unknown as TrainerSheet).inventory?.keyItems ?? []
    expect(inventory.some(row => row.id === 'fossil-unit-1')).toBe(false)
    expect(inventory.some(row => row.id === 'reanimation-machine-1' && row.qty === 1)).toBe(true)
    expect(createSqlitePokemonEggRepository(database).get(EGG_ID)).toEqual(result.egg)
    const events = createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 20 })
    expect(events.events).toHaveLength(6)
    const eggRefreshes = events.events.filter(event => event.event.type === 'breeding-aggregate-refresh')
    expect(eggRefreshes).toHaveLength(4)
    expect(JSON.stringify(eggRefreshes)).not.toMatch(/shell-armor|weak-armor|helix-sample|reanimation-machine|paleontologist|fossil-unit/iu)
  })

  it('reuses one persisted duration roll and never redraws on exact retry', () => {
    const database = open(); const auth = authority(database, false, true); const draw = vi.fn(() => 150)
    const first = createBreedingFossilEgg(useCaseInput(auth), useCaseOptions(database, auth, { drawHatchDurationPercentage: draw }))
    expect(first.egg?.incubation.targetCampaignMinutes).toBe(34_560)
    expect(draw).toHaveBeenCalledTimes(1)
    const retry = createBreedingFossilEgg(useCaseInput(auth), useCaseOptions(database, auth, { drawHatchDurationPercentage: () => { throw new Error('must not redraw') } }))
    expect(retry.execution.kind).toBe('exact-retry')
    expect(retry.egg).toEqual(first.egg)
    expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 20 }).events).toHaveLength(6)
  })

  it('returns a silent terminal retry even after later aggregate revisions make the creation projection historical', () => {
    const database = open(); const auth = authority(database)
    const first = createBreedingFossilEgg(useCaseInput(auth), useCaseOptions(database, auth))
    const currentTrainer = first.sourceTrainerSheet!
    createSqliteSheetRepository(database).save({ kind: 'trainer', slug: currentTrainer.slug, revision: currentTrainer.revision + 1, updatedAt: 4_000, document: currentTrainer.sheet })
    const retry = createBreedingFossilEgg(useCaseInput(auth), useCaseOptions(database, auth, { drawHatchDurationPercentage: () => { throw new Error('must remain silent') } }))
    expect(retry).toMatchObject({ execution: { kind: 'exact-retry', record: { status: 'accepted' } }, egg: null, sourceTrainerSheet: null, projection: null })
    expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 20 }).events).toHaveLength(6)
  })

  it('rolls back source, Egg, offers, and realtime writes together and resumes the pending operation', () => {
    const database = open(); const auth = authority(database)
    expect(() => createBreedingFossilEgg(useCaseInput(auth), useCaseOptions(database, auth, { beforeSettle: () => { throw new Error('fossil-rollback') } }))).toThrow('fossil-rollback')
    expect(createSqlitePokemonEggRepository(database).get(EGG_ID)).toBeNull()
    expect(createSqliteSheetRepository(database).get('trainer', 'trainer-fossil')?.revision).toBe(3)
    expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 20 }).events).toEqual([])
    expect(createSqliteBreedingOperationRepository(database).get(OPERATION_ID)?.status).toBe('pending')
    const resumed = createBreedingFossilEgg(useCaseInput(auth), useCaseOptions(database, auth, { resumePending: true }))
    expect(resumed.execution.record.status).toBe('accepted')
    expect(resumed.sourceTrainerSheet?.revision).toBe(4)
  })

  it('fails stale, forged, asynchronous, and non-GM authority without source or Egg mutation', () => {
    const database = open(); const auth = authority(database)
    expectUseCaseCode(() => createBreedingFossilEgg(useCaseInput(auth), useCaseOptions(database, auth, { validateCurrentGmAuthority: () => false })), 'breeding.fossil-egg-use-case.invalid-authority')
    expectUseCaseCode(() => createBreedingFossilEgg(useCaseInput(auth), useCaseOptions(database, auth, { resolveCurrentOfferChoices: (() => Promise.resolve(offerChoices)) as never })), 'breeding.fossil-egg-use-case.unavailable')
    const forged = { ...useCaseInput(auth), sourceAuthority: { ...auth.source, sourceInventoryEntryDefinitionSha256: 'f'.repeat(64) } }
    expect(() => createBreedingFossilEgg(forged, useCaseOptions(database, auth))).toThrow()
    expect(createSqlitePokemonEggRepository(database).get(EGG_ID)).toBeNull()
    expect(createSqliteSheetRepository(database).get('trainer', 'trainer-fossil')?.revision).toBe(3)
  })

  it('consumes quantity-backed source units deterministically and rejects changed source evidence', () => {
    const database = open(); const trainer = saveTrainer(database)
    const { source } = sourceAuthorities(trainer)
    const next = consumeBreedingFossilSourceInventoryV1({ trainerSheet: { slug: trainer.slug, revision: trainer.revision, document: trainer.document }, sourceAuthority: source, operationId: OPERATION_ID, updatedAt: 3_000 })
    expect(((next as unknown as TrainerSheet).inventory?.keyItems ?? []).some(row => row.id === 'fossil-unit-1')).toBe(false)
    const changed = structuredClone(trainer.document) as TrainerSheet
    changed.inventory!.keyItems![0]!.description = 'changed after designation'
    expectDomainCode(() => consumeBreedingFossilSourceInventoryV1({ trainerSheet: { slug: trainer.slug, revision: trainer.revision, document: changed }, sourceAuthority: source, operationId: OPERATION_ID, updatedAt: 3_000 }), 'breeding.fossil-egg.stale-authority')
  })
})
