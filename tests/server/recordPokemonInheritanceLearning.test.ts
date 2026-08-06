import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import lineageContractJson from '../../data/breeding-automation/lineage-contract.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { parsePokemonEggDocumentV1 } from '../../shared/breeding/egg'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { BREEDING_REFERENCE_SOURCE_IDS, parseBreedingReadResourceV1 } from '../../shared/breeding/readSets'
import {
  authorizeBreedingInheritanceLearningV1,
  createBreedingActorAuthorityV1,
  createBreedingGmOverrideEvidenceV1,
  createBreedingTrainerControlEvidenceV1,
} from '../../server/domain/breeding/authorization'
import {
  BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION_SHA256,
  breedingInheritanceLearningOptionIdV1,
  createBreedingInheritanceLearningOptionOffersV1,
} from '../../server/domain/breeding/inheritanceLearning'
import {
  createPokemonBreedingOriginFromHatchedEgg,
  createPokemonEggOffspringBlueprintV1,
} from '../../server/domain/breeding/lineage'
import { createBreedingOperationCommandHash } from '../../server/domain/breeding/operations'
import { COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256, compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import { createBreedingOperationReadSetV1, createBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/readSets'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteBreedingLineageRepository } from '../../server/storage/breedingLineageRepository'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqliteBreedingOptionOfferRepository } from '../../server/storage/breedingOptionOfferRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import {
  recordPokemonInheritanceLearning,
  type RecordPokemonInheritanceLearningOptions,
} from '../../server/useCases/recordPokemonInheritanceLearning'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TrainerSheet } from '../../src/types/trainerSheet'

const ORIGIN_ID = 'pokemon-breeding-origin:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const EGG_ID = 'pokemon-egg:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const OPERATION_ID = 'breeding-operation:v1:cccccccccccccccccccccccccccccccc'
const CHILD_SLUG = 'pokemon-learning-use-case'
const TRAINER_SLUG = 'trainer-learning-owner'
const PRINCIPAL = 'd'.repeat(64)
const sha = (value: unknown) => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const databases: RotomDatabase[] = []
const open = () => { const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database); return database }
afterEach(() => { vi.restoreAllMocks(); while (databases.length) databases.pop()?.close() })
const op = (value: number) => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const sourceEgg = () => {
  const species = compiledBreedingSpeciesSpec('bulbasaur')!
  const offspring = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1,
    speciesId: species.speciesId,
    familyRootSpeciesId: species.familyRootSpeciesId,
    speciesSpecDefinitionSha256: species.definitionSha256,
    nature: { valueId: 'cuddly', resolutionKind: 'rank-choice', rollRecordId: null, optionId: 'option:v1:10000000000000000000000000000000' as any, choiceEvidenceId: 'nature' },
    ability: { valueId: 'overgrow', resolutionKind: 'rank-choice', rollRecordId: null, optionId: 'option:v1:20000000000000000000000000000000' as any, choiceEvidenceId: 'ability' },
    gender: { valueId: 'female', resolutionKind: 'rank-choice', rollRecordId: null, optionId: 'option:v1:30000000000000000000000000000000' as any, choiceEvidenceId: 'gender' },
    inheritanceCandidates: [{ moveId: 'light-screen', sources: [{ kind: 'source-authority', authorityKind: 'gm', authorityId: 'gm-source', evidenceDefinitionSha256: '2'.repeat(64) }] }],
    startingLevel: 1,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
  })
  return parsePokemonEggDocumentV1({
    schemaVersion: 1, eggId: EGG_ID, revision: 4, status: 'hatched', ownerTrainerSlug: TRAINER_SLUG,
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: '3'.repeat(64) },
    ruleset: { rulesetId: rulesetJson.rulesetId, definitionSha256: rulesetJson.definitionSha256 },
    definitionHashes: [eggContractJson.definitionSha256, lineageContractJson.definitionSha256, rulesetJson.definitionSha256].sort(),
    parents: [], breeder: null, offspring,
    incubation: { averageCampaignMinutes: 10, targetCampaignMinutes: 10, accumulatedCampaignMinutes: 10, variationPolicyId: 'fixed-average', durationResultDefinitionSha256: '4'.repeat(64), lastAppliedClockRevision: 0, lastAppliedClockMinute: 0, readyAtCampaignMinute: 0, readinessKind: 'incubation-complete', readyOperationId: op(1), paused: false, pauseReasonId: null, pauseOperationId: null },
    special: { state: 'normal', rollRecordId: 'breeding-roll:v1:11111111111111111111111111111111', rollTotal: 50, triggerIds: [], adjudicationId: null, outcomeId: null, automaticShiny: false },
    hatchOperationId: op(2), childSheetSlug: CHILD_SLUG, terminal: null,
    createdAtCampaignMinute: 0, updatedAtCampaignMinute: 0, statusChangedAtCampaignMinute: 0, lastOperationId: op(3),
  })
}
const command = (actor: { readonly profileId: string, readonly selectedTrainerSlug: string | null } = { profileId: 'campaign-gm', selectedTrainerSlug: null }) => {
  const optionId = breedingInheritanceLearningOptionIdV1({ operationId: OPERATION_ID, checkpointLevel: 20, moveId: 'light-screen', slotMode: 'auto' })
  return parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: OPERATION_ID,
    commandKind: 'record-inheritance-learning',
    actor,
    ruleset: { rulesetId: rulesetJson.rulesetId, definitionSha256: rulesetJson.definitionSha256 },
    scopes: [{ kind: 'pokemon-sheet', sheetSlug: CHILD_SLUG, expectedRevision: 4, fields: ['lineage', 'moves'] }],
    payload: { originId: ORIGIN_ID, eggId: EGG_ID, childSheetSlug: CHILD_SLUG, checkpointLevels: [20], selectedOptionIds: [optionId] },
  })
}
const references = () => createBreedingReferenceVersionSnapshotV1({
  schemaVersion: 1,
  rulesetId: rulesetJson.rulesetId,
  rulesetDefinitionSha256: rulesetJson.definitionSha256,
  sourceManifestSha256: '5'.repeat(64),
  semanticRegistryDefinitionSha256: '6'.repeat(64),
  compiledRegistryDefinitionSha256: COMPILED_BREEDING_REGISTRY_DEFINITION_SHA256,
  canonicalIdsDefinitionSha256: '7'.repeat(64),
  campaignOptionSnapshotDefinitionSha256: '8'.repeat(64),
  referenceSources: BREEDING_REFERENCE_SOURCE_IDS.map((sourceId, index) => ({ sourceId, contentSha256: (index + 20).toString(16).padStart(64, '0') })),
  contractDefinitionHashes: ['breeding-authorization-contract','breeding-ledger-contract','breeding-lineage-contract','breeding-operation-contract','breeding-project-contract','breeding-read-set-contract','breeding-security-policy','pokemon-egg-contract'].map((contractId, index) => ({ contractId, definitionSha256: (index + 60).toString(16).padStart(64, '0') })),
})
const present = (kind: string, id: string, revision: number | null, hash: string, purposes: readonly string[], minute: number | null = null) => parseBreedingReadResourceV1({ resourceKind: kind, resourceId: id, existence: 'present', revision, definitionSha256: hash, observedCampaignMinute: minute, purposes: [...purposes].sort() })
const setup = (database: RotomDatabase, role: 'gm' | 'player' = 'gm') => {
  const sheets = createSqliteSheetRepository(database)
  const childDocument: CharacterSheet = { slug: CHILD_SLUG, nickname: 'Child', species: 'Bulbasaur', level: 20, totalExp: 1000, movelist: [{ name: 'Tackle' }], inheritedMoves: {}, eggMoves: [] }
  const trainerDocument: TrainerSheet = { slug: TRAINER_SLUG, name: 'Owner', level: 10, currentTeam: [], boxedPokemon: [CHILD_SLUG] }
  const child = sheets.save({ kind: 'pokemon', slug: CHILD_SLUG, revision: 4, updatedAt: 100, document: childDocument })
  const trainer = sheets.save({ kind: 'trainer', slug: TRAINER_SLUG, revision: 3, updatedAt: 100, document: trainerDocument })
  const egg = sourceEgg()
  const insertHistoricalOperation = database.connection.prepare(`
    INSERT INTO breeding_operations (
      operation_id, command_sha256, command_kind, command_json, status,
      result_json, result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
    ) VALUES (?, ?, 'create-source-egg', '{}', 'pending', NULL, NULL, 0, NULL)
  `)
  insertHistoricalOperation.run(egg.hatchOperationId, 'a'.repeat(64))
  insertHistoricalOperation.run(egg.lastOperationId, 'b'.repeat(64))
  database.connection.prepare(`
    INSERT INTO pokemon_eggs (
      egg_id, document_json, revision, status, owner_trainer_slug, source_kind,
      source_project_id, child_sheet_slug, last_operation_id,
      created_at_campaign_minute, updated_at_campaign_minute
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(egg.eggId, stableJsonStringify(egg), egg.revision, egg.status, egg.ownerTrainerSlug,
    egg.source.kind, null, egg.childSheetSlug, egg.lastOperationId,
    egg.createdAtCampaignMinute, egg.updatedAtCampaignMinute)
  const origin = createPokemonBreedingOriginFromHatchedEgg({ originId: ORIGIN_ID as any, egg })
  database.withTransaction(() => createSqliteBreedingLineageRepository(database).insertOrigin(origin))
  const profile = { schemaVersion: 1 as const, id: 'profile_learning_owner' as any, displayName: 'Learning Owner' as any, linkedCharacters: [{ sheetKind: 'trainer' as const, sheetSlug: TRAINER_SLUG }] }
  const operation = command(role === 'gm'
    ? { profileId: 'campaign-gm', selectedTrainerSlug: null }
    : { profileId: profile.id, selectedTrainerSlug: TRAINER_SLUG })
  database.withTransaction(() => createSqliteBreedingOperationRepository(database).reserve(operation, 0))
  const offers = createBreedingInheritanceLearningOptionOffersV1({ command: operation, origin, learningRecords: [], childSheet: { slug: child.slug, revision: child.revision, document: child.document }, issuedAtCampaignMinute: 0, expiresAtCampaignMinute: 100 })
  const selectedOffers = offers.filter(offer => offer.options.some(option => operation.payload.selectedOptionIds.includes(option.optionId)))
  database.withTransaction(() => { for (const offer of offers) createSqliteBreedingOptionOfferRepository(database).insert(offer) })
  const actor = createBreedingActorAuthorityV1({ role, command: operation, authenticatedPrincipalSha256: PRINCIPAL, authenticationPolicyDefinitionSha256: '9'.repeat(64), profile: role === 'player' ? profile : null, evaluatedAtCampaignMinute: 0 })
  const control = role === 'player' ? createBreedingTrainerControlEvidenceV1({ profile, trainerSheetSlug: trainer.slug, trainerSheetRevision: trainer.revision, trainerSheetDefinitionSha256: sha(trainer.document), evaluatedAtCampaignMinute: 0 }) : null
  const override = role === 'gm' ? createBreedingGmOverrideEvidenceV1({ overrideId: 'breeding-override:v1:cccccccccccccccccccccccccccccccc' as any, command: operation, actorAuthority: actor, overrideKind: 'owner-control', target: { kind: 'trainer-sheet', trainerSheetSlug: TRAINER_SLUG }, reasonId: 'breeding.override.owner-control', createdAtCampaignMinute: 0, securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256 }) : null
  const currentReferences = references()
  const dependencies = [{ providerKind: 'system' as const, providerId: 'breeding.inheritance-learning', subjectKind: 'pokemon-sheet' as const, subjectId: CHILD_SLUG, subjectRevision: child.revision, checkpoint: 'inheritance-learning' as const, providerDefinitionSha256: BREEDING_INHERITANCE_LEARNING_POLICY_DEFINITION_SHA256, effectiveEvidenceSha256: sha(origin) }]
  const attestation = { providerKind: 'system' as const, providerId: 'breeding-effective-dependency-set-v1', subjectKind: 'campaign' as const, subjectId: 'campaign', subjectRevision: null, checkpoint: 'authorization' as const, providerDefinitionSha256: securityPolicyJson.definitionSha256, effectiveEvidenceSha256: sha(dependencies) }
  const readSet = createBreedingOperationReadSetV1({
    readSetId: 'breeding-read-set:v1:cccccccccccccccccccccccccccccccc' as any,
    operationId: operation.operationId,
    commandSha256: createBreedingOperationCommandHash(operation),
    commandKind: operation.commandKind,
    capturedAtCampaignMinute: 0,
    resources: [
      present('breeding-offer', selectedOffers[0]!.offerId, 0, selectedOffers[0]!.definitionSha256, ['mechanics']),
      present('campaign-clock', 'campaign-clock', 0, sha({ schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null }), ['campaign-time'], 0),
      present('pokemon-egg', egg.eggId, egg.revision, sha(egg), ['snapshot']),
      present('pokemon-sheet', child.slug, child.revision, sha(child.document), ['conflict', 'mechanics']),
      present('trainer-sheet', trainer.slug, trainer.revision, sha(trainer.document), ['authorization']),
    ],
    referenceVersions: currentReferences,
    dependencyEvidence: [attestation, ...dependencies],
    writeExpectations: operation.scopes,
  })
  const receipt = authorizeBreedingInheritanceLearningV1({
    command: operation,
    readSet,
    actorAuthority: actor,
    trainerControl: control,
    ownerTrainer: { slug: trainer.slug, revision: trainer.revision, definitionSha256: sha(trainer.document), currentTeam: [], boxedPokemon: [CHILD_SLUG] },
    childSheet: { slug: child.slug, revision: child.revision, definitionSha256: sha(child.document) },
    origin,
    gmOverrides: override ? [override] : [],
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  return { operation, offers: selectedOffers, actor, control, override, readSet, receipt, currentReferences }
}
const options = (database: RotomDatabase, auth: ReturnType<typeof setup>, overrides: Partial<RecordPokemonInheritanceLearningOptions> = {}): RecordPokemonInheritanceLearningOptions => ({ database, realtimeTimestamp: 500, sheetUpdatedAt: 500, resolveCurrentReferenceVersions: () => auth.currentReferences, ...(auth.actor.role === 'gm' ? { validateCurrentGmAuthority: () => true } : {}), resumePending: true, ...overrides })
const input = (auth: ReturnType<typeof setup>) => ({ command: auth.operation, readSet: auth.readSet, authorizationReceipt: auth.receipt, actorAuthority: auth.actor, trainerControl: auth.control, gmOverrides: auth.override ? [auth.override] : [], referenceVersions: auth.currentReferences, audience: auth.actor.role === 'gm' ? 'gm' as const : 'owner' as const })

describe('recordPokemonInheritanceLearning', () => {
  it('atomically commits one sheet revision, lineage record, consumed offer, operation, and restricted refreshes', () => {
    const database = open(); const auth = setup(database)
    const result = recordPokemonInheritanceLearning(input(auth), options(database, auth))
    expect(result.execution?.kind).toBe('executed')
    expect(result.childSheet).toMatchObject({ revision: 5, sheet: { inheritedMoves: { 20: 'Light Screen' }, movelist: [{ name: 'Tackle' }, { name: 'Light Screen', permanentMoveSource: { kind: 'breeding-inheritance' } }] } })
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({ checkpointLevel: 20, outcome: { kind: 'learned', moveId: 'light-screen' } })
    expect(createSqliteBreedingOptionOfferRepository(database).get(auth.offers[0]!.offerId)).toMatchObject({ revision: 1, status: 'consumed' })
    expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 10 }).events).toHaveLength(2)
    const sheets = createSqliteSheetRepository(database)
    const advanced = sheets.getByRef('pokemon', CHILD_SLUG)!
    expect(sheets.replaceSetupSheet({ kind: 'pokemon', slug: CHILD_SLUG, expectedRevision: advanced.revision, sheet: { ...advanced.sheet, nickname: 'Later Revision' }, now: 600 })?.changed).toBe(true)
    const retry = recordPokemonInheritanceLearning(input(auth), options(database, auth))
    expect(retry.execution?.kind).toBe('exact-retry')
    expect(retry.execution?.committedRealtimeEvents).toEqual([])
    expect(retry.childSheet).toMatchObject({ revision: 6, sheet: { nickname: 'Later Revision' } })
    expect(createSqliteBreedingLineageRepository(database).listLearningByOrigin(ORIGIN_ID)).toHaveLength(1)
  })

  it('authorizes the current owning player but returns only owner-safe inheritance projections', () => {
    const database = open(); const auth = setup(database, 'player')
    const result = recordPokemonInheritanceLearning(input(auth), options(database, auth))
    expect(result.execution).toBeNull()
    expect(result.childSheet?.sheet).toMatchObject({ inheritedMoves: { 20: 'Light Screen' }, movelist: [expect.objectContaining({ name: 'Tackle' }), expect.objectContaining({ name: 'Light Screen' })] })
    expect((result.childSheet?.sheet.movelist as any[])[1]).not.toHaveProperty('permanentMoveSource')
    expect(result.records).toEqual([])
    expect(result.plan).toBeNull()
    expect(createSqliteBreedingLineageRepository(database).listLearningByOrigin(ORIGIN_ID)).toHaveLength(1)
  })

  it('rolls back sheet, record, offer, and realtime rows on settlement failure, then resumes without new choices', () => {
    const database = open(); const auth = setup(database)
    expect(() => recordPokemonInheritanceLearning(input(auth), options(database, auth, { beforeSettle: () => { throw new Error('interrupt') } }))).toThrow('interrupt')
    expect(createSqliteSheetRepository(database).get('pokemon', CHILD_SLUG)?.revision).toBe(4)
    expect(createSqliteBreedingLineageRepository(database).listLearningByOrigin(ORIGIN_ID)).toHaveLength(0)
    expect(createSqliteBreedingOptionOfferRepository(database).get(auth.offers[0]!.offerId)).toMatchObject({ revision: 0, status: 'active' })
    expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 10 }).events).toHaveLength(0)
    expect(createSqliteBreedingOperationRepository(database).get(OPERATION_ID)?.status).toBe('pending')
    const recovered = recordPokemonInheritanceLearning(input(auth), options(database, auth, { resumePending: true }))
    expect(recovered.execution?.kind).toBe('executed')
    expect(recovered.childSheet?.revision).toBe(5)
  })

  it('fails closed before reservation when current child, owner, offer, or reference authority drifts', () => {
    const database = open(); const auth = setup(database)
    const sheets = createSqliteSheetRepository(database)
    const child = sheets.getByRef('pokemon', CHILD_SLUG)!
    expect(sheets.replaceSetupSheet({ kind: 'pokemon', slug: CHILD_SLUG, expectedRevision: child.revision, sheet: { ...child.sheet, level: 19 }, now: 200 })?.changed).toBe(true)
    expect(() => recordPokemonInheritanceLearning(input(auth), options(database, auth))).toThrowError(expect.objectContaining({ code: 'breeding.inheritance-learning-use-case.invalid-authority' }))
    expect(createSqliteBreedingOperationRepository(database).get(OPERATION_ID)?.status).toBe('pending')
    expect(createSqliteBreedingLineageRepository(database).listLearningByOrigin(ORIGIN_ID)).toHaveLength(0)
  })
})
