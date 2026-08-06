import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PlayerProfile } from '#shared/playerProfiles'
import { BREEDING_REFERENCE_SOURCE_IDS } from '../../shared/breeding/readSets'
import { BREEDING_ARCHIVE_MAXIMUM_BYTES, BreedingArchiveValidationError, parseBreedingArchiveImportRequestV1, parseBreedingArchiveRestoreReceiptV1, parseBreedingArchiveV1, parseBreedingLegacyLineageReviewV1, parseBreedingMigrationPackageV1 } from '../../shared/breeding/archives'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { createBreedingActorAuthorityV1 } from '../../server/domain/breeding/authorization'
import {
  BreedingArchiveAuthorityError,
  assertBreedingArchiveEnvelopeByteLengthV1,
  assertBreedingArchiveExactReplayV1,
  assertBreedingArchiveImportRequestExactReplayV1,
  assertBreedingArchiveRestoreReceiptExactReplayV1,
  assertBreedingLegacyReviewExactReplayV1,
  assertBreedingMigrationExactReplayV1,
  createBreedingArchiveImportRequestV1,
  createBreedingArchiveRestoreReceiptV1,
  createBreedingArchiveV1,
  createBreedingCampaignClockArchiveRecordV1,
  createBreedingLegacyLineageReviewV1,
  createBreedingMigrationPackageV1,
  parseAuthoritativeBreedingArchiveImportRequestV1,
  parseAuthoritativeBreedingArchiveRestoreReceiptV1,
  parseAuthoritativeBreedingArchiveV1,
  parseAuthoritativeBreedingLegacyLineageReviewV1,
  parseAuthoritativeBreedingMigrationPackageV1,
  validateBreedingArchiveImportV1,
  validateBreedingMigrationPackageForApplicationV1,
  validateLegacyLineageReviewAttachmentV1,
} from '../../server/domain/breeding/archives'
import { createBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/readSets'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const policy = readJson<Record<string, any>>('data/breeding-automation/archive-contract.json')
const ruleset = readJson<Record<string, any>>('data/breeding-automation/ruleset.json')
const security = readJson<Record<string, any>>('data/breeding-automation/security-policy.json')
const archiveId = (value: number): string => `breeding-archive:v1:${value.toString(16).padStart(32, '0')}`
const requestId = (value: number): string => `breeding-archive-request:v1:${value.toString(16).padStart(32, '0')}`
const migrationId = (value: number): string => `breeding-migration:v1:${value.toString(16).padStart(32, '0')}`
const reviewId = (value: number): string => `breeding-legacy-review:v1:${value.toString(16).padStart(32, '0')}`
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const PROJECT_ID = 'breeding-project:v1:11111111111111111111111111111111'
const referenceVersions = () => createBreedingReferenceVersionSnapshotV1({
  schemaVersion: 1,
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  sourceManifestSha256: '1'.repeat(64),
  semanticRegistryDefinitionSha256: '2'.repeat(64),
  compiledRegistryDefinitionSha256: '3'.repeat(64),
  canonicalIdsDefinitionSha256: '4'.repeat(64),
  campaignOptionSnapshotDefinitionSha256: '5'.repeat(64),
  referenceSources: BREEDING_REFERENCE_SOURCE_IDS.map((sourceId, index) => ({ sourceId, contentSha256: (index + 1).toString(16).padStart(64, '0') })),
  contractDefinitionHashes: [
    'breeding-archive-contract', 'breeding-authorization-contract', 'breeding-ledger-contract', 'breeding-lineage-contract',
    'breeding-operation-contract', 'breeding-project-contract', 'breeding-read-set-contract', 'breeding-security-policy', 'pokemon-egg-contract',
  ].map((contractId, index) => ({ contractId, definitionSha256: (index + 20).toString(16).padStart(64, '0') })),
})
const gmCommand = () => parseBreedingOperationCommandV1({ schemaVersion: 1, operationId: op(50), commandKind: 'preview-breeding', actor: { profileId: 'campaign-gm', selectedTrainerSlug: null }, ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 }, scopes: [], payload: { ownerTrainerSlug: 'trainer-owner', breederTrainerSlug: 'trainer-breeder', parentRefs: [{ pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 1 }, { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 1 }], optionSnapshotDefinitionSha256: '5'.repeat(64) } })
const gmActor = () => createBreedingActorAuthorityV1({ role: 'gm', command: gmCommand(), authenticatedPrincipalSha256: '6'.repeat(64), authenticationPolicyDefinitionSha256: '7'.repeat(64), profile: null, evaluatedAtCampaignMinute: 200 })
const clock = () => createBreedingCampaignClockArchiveRecordV1({ revision: 0, campaignMinute: 100, lastOperationId: null })
const backup = () => createBreedingArchiveV1({ archiveId: archiveId(1) as any, purpose: 'campaign-backup', campaignIdentitySha256: '8'.repeat(64), createdAtCampaignMinute: 100, rulesetId: ruleset.rulesetId, rulesetDefinitionSha256: ruleset.definitionSha256, referenceVersions: referenceVersions(), records: { 'campaign-clock': [clock()] } })
const ownerProjection = () => {
  const definition = {
    schemaVersion: 1,
    audience: 'owner',
    aggregateKind: 'breeding-project',
    projectId: PROJECT_ID,
    revision: 0,
    status: 'draft',
    ownerTrainerSlug: 'trainer-owner',
    breederTrainerSlug: 'trainer-breeder',
    parentSlots: [
      { parentIndex: 0, relationship: 'owned', pokemonSheetSlug: 'pokemon-parent-a', sheetRevision: 1, consentStatus: 'not-required' },
      { parentIndex: 1, relationship: 'owned', pokemonSheetSlug: 'pokemon-parent-b', sheetRevision: 1, consentStatus: 'not-required' },
    ],
    timeline: { initialRequiredCampaignMinutes: 240, initialAccumulatedCampaignMinutes: 0, additionalRequiredCampaignMinutes: 240, additionalAccumulatedCampaignMinutes: 0, checkReadyAtCampaignMinute: null, readyToProduceAtCampaignMinute: null },
    checkStatus: 'not-ready',
    offers: [],
    availableActions: [],
    explanationReasonIds: [],
    generatedAtCampaignMinute: 100,
    securityPolicyDefinitionSha256: security.definitionSha256,
  }
  return { ...definition, projectionDefinitionSha256: sha256(stableJsonStringify(definition)) }
}
const legacyReview = () => createBreedingLegacyLineageReviewV1({ reviewId: reviewId(1) as any, pokemonSheetSlug: 'pokemon-legacy-child', pokemonSheetRevision: 7, pokemonSheetDefinitionSha256: '9'.repeat(64), legacyEggMoveIds: ['light-screen'] as any, legacyInheritedMoveIds: ['water-gun'] as any, legacyFieldsDefinitionSha256: 'a'.repeat(64), decision: 'compatibility-only', existingOriginId: null, existingOriginDefinitionSha256: null, adjudicationDefinitionSha256: 'b'.repeat(64), reviewerPrincipalSha256: 'c'.repeat(64), reasonId: 'breeding.migration.compatibility-only', reviewedAtCampaignMinute: 100 })
const importRequest = (archive = backup(), actor = gmActor()) => createBreedingArchiveImportRequestV1({ requestId: requestId(1) as any, archiveId: archive.archiveId, archiveDefinitionSha256: archive.archiveDefinitionSha256, mode: 'restore-new-campaign', targetCampaignIdentitySha256: 'd'.repeat(64), expectedCurrentArchiveDefinitionSha256: null, actorAuthorityDefinitionSha256: actor.definitionSha256, requestedAtCampaignMinute: 200 })
const restoreReceipt = (archive = backup()) => createBreedingArchiveRestoreReceiptV1({ requestId: requestId(1) as any, archiveId: archive.archiveId, archiveDefinitionSha256: archive.archiveDefinitionSha256, accepted: true, reasonId: 'breeding.archive.accepted', recordCounts: [{ recordKind: 'campaign-clock', count: 1 }], committedAtCampaignMinute: 200, resultingArchiveDefinitionSha256: 'e'.repeat(64) })
const mapMigration = (contentSha256 = '2'.repeat(64)) => createBreedingMigrationPackageV1({ migrationId: migrationId(1) as any, migrationKind: 'legacy-map-metadata-quarantine', sourceSchemaId: 'legacy-map-metadata-v0', targetSchemaId: 'breeding-archive-v1', sourceCampaignIdentitySha256: '1'.repeat(64), sourceArtifacts: [{ sourceId: 'legacy-map-metadata', contentSha256, sizeBytes: 1024, privacyClass: 'campaign-private' }], legacyLineageReviews: [], resultArchiveDefinitionSha256: null, migrationToolDefinitionSha256: '3'.repeat(64), reviewerEvidenceDefinitionSha256: '4'.repeat(64), createdAtCampaignMinute: 100 })

describe('Breeding archives, restore, migration, and legacy lineage', () => {
  it('binds strict purpose, chunk, digest, privacy, restore, and migration policy', () => {
    expect(policy).toMatchObject({ schemaVersion: 1, contractId: 'ptu-1.05-breeding-archive-migration-v1', rulesetDefinitionSha256: ruleset.definitionSha256, sourceManifestSha256: sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))) })
    expect(policy.definitionSha256).toBe(sha256(stableJsonStringify(policy.definition)))
    expect(policy.definition.archive.maximumBytes).toBe(64 * 1024 * 1024)
    expect(policy.definition.legacyLineageReview).toMatchObject({ createOrigin: 'forbidden', manufactureParents: 'forbidden' })
    expect(policy.definition.authority).toMatchObject({ exportBuilder: 'server-only', restoreTransaction: 'caller-owned-single-transaction', legacyMapEggAuthority: 'none' })
  })

  it('creates a deterministic digest-bound campaign backup with strict record chunks', () => {
    const archive = backup()
    expect(archive).toMatchObject({ purpose: 'campaign-backup', payloadDefinitionSha256: expect.stringMatching(/^[0-9a-f]{64}$/), chunks: [{ index: 0, recordKind: 'campaign-clock', recordCount: 1 }] })
    expect(parseAuthoritativeBreedingArchiveV1(structuredClone(archive))).toEqual(archive)
    expect(JSON.stringify(archive)).not.toContain('/home/')
    const tampered = structuredClone(archive)
    ;(tampered.chunks[0]!.records[0] as any).campaignMinute = 101
    expect(() => parseAuthoritativeBreedingArchiveV1(tampered)).toThrowError(expect.objectContaining({ code: 'breeding.archive.hash-mismatch' }))
  })

  it('keeps owner-portable exports presentation-only and rejects them as backups', () => {
    const portable = createBreedingArchiveV1({ archiveId: archiveId(2) as any, purpose: 'owner-portable', campaignIdentitySha256: '8'.repeat(64), createdAtCampaignMinute: 100, rulesetId: ruleset.rulesetId, rulesetDefinitionSha256: ruleset.definitionSha256, referenceVersions: referenceVersions(), records: { 'owner-projection': [ownerProjection()] } })
    expect(portable.chunks[0]).toMatchObject({ recordKind: 'owner-projection' })
    expect(JSON.stringify(portable)).not.toContain('rollRecordId')
    expect(() => createBreedingArchiveV1({ archiveId: archiveId(3) as any, purpose: 'campaign-backup', campaignIdentitySha256: '8'.repeat(64), createdAtCampaignMinute: 100, rulesetId: ruleset.rulesetId, rulesetDefinitionSha256: ruleset.definitionSha256, referenceVersions: referenceVersions(), records: { 'owner-projection': [ownerProjection()], 'campaign-clock': [clock()] } })).toThrowError(expect.objectContaining({ code: 'breeding.archive.disallowed-record' }))
  })

  it('validates a GM-bound new-campaign restore against exact current references and canonical records', () => {
    const archive = backup(); const actor = gmActor()
    const request = createBreedingArchiveImportRequestV1({ requestId: requestId(1) as any, archiveId: archive.archiveId, archiveDefinitionSha256: archive.archiveDefinitionSha256, mode: 'restore-new-campaign', targetCampaignIdentitySha256: 'd'.repeat(64), expectedCurrentArchiveDefinitionSha256: null, actorAuthorityDefinitionSha256: actor.definitionSha256, requestedAtCampaignMinute: 200 })
    const result = validateBreedingArchiveImportV1({ archive, request, actorAuthority: actor, currentReferenceVersions: referenceVersions(), currentArchiveDefinitionSha256: null, validateRecordDependencies: () => true })
    expect(result.recordCounts).toEqual([{ recordKind: 'campaign-clock', count: 1 }])
    expect(() => validateBreedingArchiveImportV1({ archive, request, actorAuthority: actor, currentReferenceVersions: referenceVersions(), currentArchiveDefinitionSha256: null, validateRecordDependencies: () => false })).toThrowError(expect.objectContaining({ code: 'breeding.archive.cross-link' }))
    const player = createBreedingActorAuthorityV1({ role: 'player', command: { ...gmCommand(), actor: { profileId: 'profile_owner1234', selectedTrainerSlug: 'trainer-owner' } }, authenticatedPrincipalSha256: '6'.repeat(64), authenticationPolicyDefinitionSha256: '7'.repeat(64), profile: { schemaVersion: 1, id: 'profile_owner1234', displayName: 'Owner', linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }] } as PlayerProfile, evaluatedAtCampaignMinute: 200 })
    const playerRequest = createBreedingArchiveImportRequestV1({ ...request, requestId: requestId(2) as any, actorAuthorityDefinitionSha256: player.definitionSha256 } as any)
    expect(() => validateBreedingArchiveImportV1({ archive, request: playerRequest, actorAuthority: player, currentReferenceVersions: referenceVersions(), currentArchiveDefinitionSha256: null, validateRecordDependencies: () => true })).toThrowError(expect.objectContaining({ code: 'breeding.archive.unauthorized' }))
  })

  it('produces self-hashed accepted restore receipts with canonical bounded counts', () => {
    const archive = backup()
    const receipt = createBreedingArchiveRestoreReceiptV1({ requestId: requestId(1) as any, archiveId: archive.archiveId, archiveDefinitionSha256: archive.archiveDefinitionSha256, accepted: true, reasonId: 'breeding.archive.accepted', recordCounts: [{ recordKind: 'campaign-clock', count: 1 }], committedAtCampaignMinute: 200, resultingArchiveDefinitionSha256: 'e'.repeat(64) })
    expect(receipt).toMatchObject({ accepted: true, reasonId: 'breeding.archive.accepted', committedAtCampaignMinute: 200 })
    expect(() => createBreedingArchiveRestoreReceiptV1({ ...receipt, accepted: false } as any)).toThrow(BreedingArchiveValidationError)
  })

  it('preserves legacy Move fields as compatibility data without manufacturing lineage', () => {
    const review = legacyReview()
    expect(validateLegacyLineageReviewAttachmentV1({ review, pokemonSheet: { slug: 'pokemon-legacy-child', revision: 7, definitionSha256: '9'.repeat(64) }, origin: null })).toEqual({ decision: 'compatibility-only', origin: null })
    expect(() => parseBreedingLegacyLineageReviewV1({ ...review, decision: 'attach-existing-origin' })).toThrow(BreedingArchiveValidationError)
    expect(JSON.stringify(review)).not.toContain('parentIndex')
    expect(JSON.stringify(review)).not.toContain('parentSpeciesId')
  })

  it('source-hash-binds migrations and quarantines legacy map metadata without runtime output', () => {
    const migration = createBreedingMigrationPackageV1({ migrationId: migrationId(1) as any, migrationKind: 'legacy-map-metadata-quarantine', sourceSchemaId: 'legacy-map-metadata-v0', targetSchemaId: 'breeding-archive-v1', sourceCampaignIdentitySha256: '1'.repeat(64), sourceArtifacts: [{ sourceId: 'legacy-map-metadata', contentSha256: '2'.repeat(64), sizeBytes: 1024, privacyClass: 'campaign-private' }], legacyLineageReviews: [], resultArchiveDefinitionSha256: null, migrationToolDefinitionSha256: '3'.repeat(64), reviewerEvidenceDefinitionSha256: '4'.repeat(64), createdAtCampaignMinute: 100 })
    expect(migration).toMatchObject({ migrationKind: 'legacy-map-metadata-quarantine', resultArchiveDefinitionSha256: null })
    expect(validateBreedingMigrationPackageForApplicationV1({ migration, observedSourceArtifacts: migration.sourceArtifacts, expectedMigrationToolDefinitionSha256: '3'.repeat(64), validateReviewerEvidence: hash => hash === '4'.repeat(64), validateLegacyReviewEvidence: () => true, resultArchive: null })).toEqual({ migration, resultArchive: null })
    expect(() => validateBreedingMigrationPackageForApplicationV1({ migration, observedSourceArtifacts: [{ ...migration.sourceArtifacts[0]!, contentSha256: '9'.repeat(64) }], expectedMigrationToolDefinitionSha256: '3'.repeat(64), validateReviewerEvidence: () => true, validateLegacyReviewEvidence: () => true, resultArchive: null })).toThrowError(expect.objectContaining({ code: 'breeding.archive.cross-link' }))
    expect(() => parseBreedingMigrationPackageV1({ ...migration, resultArchiveDefinitionSha256: '5'.repeat(64) })).toThrow(BreedingArchiveValidationError)
    const lineageMigration = createBreedingMigrationPackageV1({ migrationId: migrationId(2) as any, migrationKind: 'legacy-lineage-review', sourceSchemaId: 'legacy-sheet-v0', targetSchemaId: 'breeding-archive-v1', sourceCampaignIdentitySha256: '1'.repeat(64), sourceArtifacts: [{ sourceId: 'legacy-sheet-export', contentSha256: '2'.repeat(64), sizeBytes: 2048, privacyClass: 'campaign-private' }], legacyLineageReviews: [legacyReview()], resultArchiveDefinitionSha256: null, migrationToolDefinitionSha256: '3'.repeat(64), reviewerEvidenceDefinitionSha256: '4'.repeat(64), createdAtCampaignMinute: 100 })
    expect(lineageMigration.legacyLineageReviews).toHaveLength(1)
    expect(() => parseBreedingArchiveV1({ ...backup(), schemaVersion: 2 })).toThrow(BreedingArchiveValidationError)
  })

  it('rejects non-plain, accessor-backed, sparse, enriched, duplicate, and hash-drifted documents', () => {
    const archive = backup()
    expect(() => parseBreedingArchiveV1({ ...archive, unexpected: true })).toThrowError(expect.objectContaining({ code: 'breeding.archive.unknown-field' }))
    const accessor = structuredClone(archive) as any
    Object.defineProperty(accessor, 'purpose', { enumerable: true, configurable: true, get: () => 'campaign-backup' })
    expect(() => parseBreedingArchiveV1(accessor)).toThrowError(expect.objectContaining({ code: 'breeding.archive.invalid-document' }))
    const inherited = structuredClone(archive)
    Object.setPrototypeOf(inherited, { poisoned: true })
    expect(() => parseBreedingArchiveV1(inherited)).toThrowError(expect.objectContaining({ code: 'breeding.archive.invalid-document' }))
    const enriched = structuredClone(archive) as any
    Object.defineProperty(enriched.chunks, 'hiddenCampaignData', { value: 'never', enumerable: false })
    expect(() => parseBreedingArchiveV1(enriched)).toThrowError(expect.objectContaining({ code: 'breeding.archive.unknown-field' }))
    const sparse = structuredClone(archive) as any
    sparse.chunks.length = 2
    expect(() => parseBreedingArchiveV1(sparse)).toThrowError(expect.objectContaining({ code: 'breeding.archive.unknown-field' }))
    expect(() => createBreedingArchiveV1({ archiveId: archiveId(9) as any, purpose: 'gm-audit', campaignIdentitySha256: '8'.repeat(64), createdAtCampaignMinute: 100, rulesetId: ruleset.rulesetId, rulesetDefinitionSha256: ruleset.definitionSha256, referenceVersions: referenceVersions(), records: { 'campaign-clock': [clock(), clock()] } })).toThrowError(expect.objectContaining({ code: 'breeding.archive.identity-collision' }))
  })

  it('enforces byte limits and rejects unsafe identifiers, traversal, controls, and unbounded source metadata', () => {
    expect(assertBreedingArchiveEnvelopeByteLengthV1(BREEDING_ARCHIVE_MAXIMUM_BYTES)).toBe(BREEDING_ARCHIVE_MAXIMUM_BYTES)
    expect(() => assertBreedingArchiveEnvelopeByteLengthV1(BREEDING_ARCHIVE_MAXIMUM_BYTES + 1)).toThrowError(expect.objectContaining({ code: 'breeding.archive.oversized' }))
    expect(() => assertBreedingArchiveEnvelopeByteLengthV1(Number.MAX_SAFE_INTEGER + 1)).toThrow(BreedingArchiveAuthorityError)
    const migration = mapMigration()
    expect(() => parseBreedingMigrationPackageV1({ ...migration, sourceSchemaId: '../campaign.sqlite' })).toThrowError(expect.objectContaining({ code: 'breeding.archive.invalid-id' }))
    expect(() => parseBreedingMigrationPackageV1({ ...migration, sourceArtifacts: [{ ...migration.sourceArtifacts[0]!, sourceId: 'safe/../../secret' }] })).toThrowError(expect.objectContaining({ code: 'breeding.archive.invalid-id' }))
    expect(() => parseBreedingMigrationPackageV1({ ...migration, sourceArtifacts: [{ ...migration.sourceArtifacts[0]!, sizeBytes: BREEDING_ARCHIVE_MAXIMUM_BYTES + 1 }] })).toThrowError(expect.objectContaining({ code: 'breeding.archive.invalid-document' }))
    const unsafeReason = 'breeding.migration.review\nPRIVATE-NOTE'
    let unsafeError: unknown = null
    try { parseBreedingLegacyLineageReviewV1({ ...legacyReview(), reasonId: unsafeReason }) } catch (error) { unsafeError = error }
    expect(unsafeError).toBeInstanceOf(BreedingArchiveValidationError)
    expect((unsafeError as Error).message).not.toContain('PRIVATE-NOTE')
  })

  it('rejects unknown versions at every portable boundary', () => {
    const archive = backup(); const request = importRequest(archive); const receipt = restoreReceipt(archive); const review = legacyReview(); const migration = mapMigration()
    expect(() => parseBreedingArchiveV1({ ...archive, schemaVersion: 2 })).toThrow(BreedingArchiveValidationError)
    expect(() => parseBreedingArchiveV1({ ...archive, chunks: [{ ...archive.chunks[0]!, schemaVersion: 2 }] })).toThrow(BreedingArchiveValidationError)
    expect(() => parseBreedingArchiveImportRequestV1({ ...request, schemaVersion: 2 })).toThrow(BreedingArchiveValidationError)
    expect(() => parseBreedingArchiveRestoreReceiptV1({ ...receipt, schemaVersion: 2 })).toThrow(BreedingArchiveValidationError)
    expect(() => parseBreedingLegacyLineageReviewV1({ ...review, schemaVersion: 2 })).toThrow(BreedingArchiveValidationError)
    expect(() => parseBreedingMigrationPackageV1({ ...migration, schemaVersion: 2 })).toThrow(BreedingArchiveValidationError)
  })

  it('keeps owner exports projection-only and privacy-safe under adversarial record injection', () => {
    const portable = createBreedingArchiveV1({ archiveId: archiveId(12) as any, purpose: 'owner-portable', campaignIdentitySha256: '8'.repeat(64), createdAtCampaignMinute: 100, rulesetId: ruleset.rulesetId, rulesetDefinitionSha256: ruleset.definitionSha256, referenceVersions: referenceVersions(), records: { 'owner-projection': [ownerProjection()] } })
    const serialized = stableJsonStringify(portable)
    for (const forbidden of ['rollRecordId', 'commandSha256', 'consentingProfileId', 'adjudicationId', 'authorityDefinitionHashes', 'effectiveMoveIds', 'raw-rolls']) expect(serialized).not.toContain(forbidden)
    try {
      createBreedingArchiveV1({ archiveId: archiveId(13) as any, purpose: 'owner-portable', campaignIdentitySha256: '8'.repeat(64), createdAtCampaignMinute: 100, rulesetId: ruleset.rulesetId, rulesetDefinitionSha256: ruleset.definitionSha256, referenceVersions: referenceVersions(), records: { 'operation-command': [gmCommand()] } })
      throw new Error('expected owner export rejection')
    }
    catch (error) {
      expect(error).toBeInstanceOf(BreedingArchiveValidationError)
      expect((error as Error).message).not.toContain('pokemon-parent-a')
      expect((error as Error).message).not.toContain('trainer-owner')
    }
  })

  it('round-trips archives, requests, receipts, reviews, and migrations through stable JSON without authority drift', () => {
    const archive = backup(); const actor = gmActor(); const request = importRequest(archive, actor); const receipt = restoreReceipt(archive); const review = legacyReview(); const migration = mapMigration()
    const roundTrip = <Value>(value: Value): unknown => JSON.parse(stableJsonStringify(value))
    expect(parseAuthoritativeBreedingArchiveV1(roundTrip(archive))).toEqual(archive)
    expect(parseAuthoritativeBreedingArchiveImportRequestV1(roundTrip(request))).toEqual(request)
    expect(parseAuthoritativeBreedingArchiveRestoreReceiptV1(roundTrip(receipt))).toEqual(receipt)
    expect(parseAuthoritativeBreedingLegacyLineageReviewV1(roundTrip(review))).toEqual(review)
    expect(parseAuthoritativeBreedingMigrationPackageV1(roundTrip(migration))).toEqual(migration)
    expect(validateBreedingArchiveImportV1({ archive: roundTrip(archive), request: roundTrip(request), actorAuthority: actor, currentReferenceVersions: referenceVersions(), currentArchiveDefinitionSha256: null, validateRecordDependencies: () => true }).archive.archiveDefinitionSha256).toBe(archive.archiveDefinitionSha256)
  })

  it('allows exact identity replay only and rejects changed archive, request, receipt, review, and migration facts', () => {
    const archive = backup(); const request = importRequest(archive); const receipt = restoreReceipt(archive); const review = legacyReview(); const migration = mapMigration()
    expect(assertBreedingArchiveExactReplayV1(archive, structuredClone(archive))).toEqual(archive)
    expect(assertBreedingArchiveImportRequestExactReplayV1(request, structuredClone(request))).toEqual(request)
    expect(assertBreedingArchiveRestoreReceiptExactReplayV1(receipt, structuredClone(receipt))).toEqual(receipt)
    expect(assertBreedingLegacyReviewExactReplayV1(review, structuredClone(review))).toEqual(review)
    expect(assertBreedingMigrationExactReplayV1(migration, structuredClone(migration))).toEqual(migration)
    const changedArchive = createBreedingArchiveV1({ archiveId: archive.archiveId, purpose: 'campaign-backup', campaignIdentitySha256: archive.campaignIdentitySha256, createdAtCampaignMinute: 101, rulesetId: ruleset.rulesetId, rulesetDefinitionSha256: ruleset.definitionSha256, referenceVersions: referenceVersions(), records: { 'campaign-clock': [createBreedingCampaignClockArchiveRecordV1({ revision: 0, campaignMinute: 101, lastOperationId: null })] } })
    const changedRequest = createBreedingArchiveImportRequestV1({ ...request, targetCampaignIdentitySha256: 'f'.repeat(64) } as any)
    const changedReceipt = createBreedingArchiveRestoreReceiptV1({ ...receipt, resultingArchiveDefinitionSha256: 'f'.repeat(64) } as any)
    const changedReview = createBreedingLegacyLineageReviewV1({ ...review, legacyEggMoveIds: ['tackle'] } as any)
    const changedMigration = mapMigration('f'.repeat(64))
    for (const assertion of [
      () => assertBreedingArchiveExactReplayV1(archive, changedArchive),
      () => assertBreedingArchiveImportRequestExactReplayV1(request, changedRequest),
      () => assertBreedingArchiveRestoreReceiptExactReplayV1(receipt, changedReceipt),
      () => assertBreedingLegacyReviewExactReplayV1(review, changedReview),
      () => assertBreedingMigrationExactReplayV1(migration, changedMigration),
    ]) expect(assertion).toThrowError(expect.objectContaining({ code: 'breeding.archive.identity-collision' }))
  })
})
