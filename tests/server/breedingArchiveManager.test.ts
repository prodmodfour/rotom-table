import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { BREEDING_REFERENCE_SOURCE_IDS } from '../../shared/breeding/readSets'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { createBreedingArchiveImportRequestV1 } from '../../server/domain/breeding/archives'
import { createBreedingActorAuthorityV1 } from '../../server/domain/breeding/authorization'
import { createBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/readSets'
import { createSqliteBreedingArchiveRepository } from '../../server/storage/breedingArchiveRepository'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { BreedingRepositoryCorruptionError, BreedingRepositoryIdentityCollisionError } from '../../server/storage/breedingRepositorySupport'
import { createBreedingArchiveManager } from '../../server/useCases/manageBreedingArchives'

const databases: RotomDatabase[] = []
const roots: string[] = []
const open = (path = ':memory:'): RotomDatabase => {
  const database = openRotomDatabase({ path, enableWal: path !== ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

const ruleset = rulesetJson as Record<string, string>
const archiveId = (value: number): string => `breeding-archive:v1:${value.toString(16).padStart(32, '0')}`
const requestId = (value: number): string => `breeding-archive-request:v1:${value.toString(16).padStart(32, '0')}`
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const campaignIdentity = (value: string): string => value.repeat(64)
const references = () => createBreedingReferenceVersionSnapshotV1({
  schemaVersion: 1,
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  sourceManifestSha256: '1'.repeat(64),
  semanticRegistryDefinitionSha256: '2'.repeat(64),
  compiledRegistryDefinitionSha256: '3'.repeat(64),
  canonicalIdsDefinitionSha256: '4'.repeat(64),
  campaignOptionSnapshotDefinitionSha256: '5'.repeat(64),
  referenceSources: BREEDING_REFERENCE_SOURCE_IDS.map((sourceId, index) => ({
    sourceId,
    contentSha256: (index + 1).toString(16).padStart(64, '0'),
  })),
  contractDefinitionHashes: [
    'breeding-archive-contract',
    'breeding-authorization-contract',
    'breeding-ledger-contract',
    'breeding-lineage-contract',
    'breeding-operation-contract',
    'breeding-project-contract',
    'breeding-read-set-contract',
    'breeding-security-policy',
    'pokemon-egg-contract',
  ].map((contractId, index) => ({
    contractId,
    definitionSha256: (index + 20).toString(16).padStart(64, '0'),
  })),
})
const command = (value = 50) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(value),
  commandKind: 'preview-breeding',
  actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  scopes: [],
  payload: {
    ownerTrainerSlug: 'trainer-owner',
    breederTrainerSlug: 'trainer-breeder',
    parentRefs: [
      { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 1 },
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 1 },
    ],
    optionSnapshotDefinitionSha256: '5'.repeat(64),
  },
})
const actor = (minute = 0) => createBreedingActorAuthorityV1({
  role: 'gm',
  command: command(),
  authenticatedPrincipalSha256: '6'.repeat(64),
  authenticationPolicyDefinitionSha256: '7'.repeat(64),
  profile: null,
  evaluatedAtCampaignMinute: minute,
})
const manager = (database: RotomDatabase) => createBreedingArchiveManager({
  database,
  authorizeGm: value => value.authenticatedPrincipalSha256 === '6'.repeat(64),
  authorizeOwnerExport: () => true,
  validateRecordDependencies: () => true,
})
const backupInput = (value = 1) => ({
  archiveId: archiveId(value) as never,
  campaignIdentitySha256: campaignIdentity('8'),
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  referenceVersions: references(),
  actorAuthority: actor(),
})
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

const createRequest = (input: {
  readonly archive: ReturnType<ReturnType<typeof manager>['createCampaignBackup']> | never
  readonly requestValue: number
  readonly targetIdentity?: string
}) => {
  const gm = actor()
  return createBreedingArchiveImportRequestV1({
    requestId: requestId(input.requestValue) as never,
    archiveId: input.archive.archiveId,
    archiveDefinitionSha256: input.archive.archiveDefinitionSha256,
    mode: 'restore-new-campaign',
    targetCampaignIdentitySha256: input.targetIdentity ?? campaignIdentity('9'),
    expectedCurrentArchiveDefinitionSha256: null,
    actorAuthorityDefinitionSha256: gm.definitionSha256,
    requestedAtCampaignMinute: 0,
  })
}

describe('Breeding archive repository and transaction manager', () => {
  it('creates a complete immutable backup, stores exact replay, and survives restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'breeding-archive-manager-'))
    roots.push(root)
    const path = join(root, 'campaign.sqlite')
    const database = open(path)
    const service = manager(database)
    const archive = service.createCampaignBackup(backupInput())

    expect(archive).toMatchObject({
      purpose: 'campaign-backup',
      campaignIdentitySha256: campaignIdentity('8'),
      createdAtCampaignMinute: 0,
      chunks: [{ recordKind: 'campaign-clock', recordCount: 1 }],
    })
    expect(service.createCampaignBackup(backupInput())).toEqual(archive)
    expect(service.archiveRepository.listArchiveSummaries(campaignIdentity('8'))).toEqual([{
      archiveId: archive.archiveId,
      purpose: 'campaign-backup',
      campaignIdentitySha256: campaignIdentity('8'),
      createdAtCampaignMinute: 0,
      archiveDefinitionSha256: archive.archiveDefinitionSha256,
    }])

    database.close()
    databases.splice(databases.indexOf(database), 1)
    const reopened = open(path)
    expect(createSqliteBreedingArchiveRepository(reopened).getArchive(archive.archiveId)).toEqual(archive)
  })

  it('rejects changed facts under archive identity and detects denormalized or JSON corruption', () => {
    const database = open()
    const service = manager(database)
    const archive = service.createCampaignBackup(backupInput())
    expect(() => service.createCampaignBackup({
      ...backupInput(),
      campaignIdentitySha256: campaignIdentity('a'),
    })).toThrow(BreedingRepositoryIdentityCollisionError)

    database.connection.prepare(`
      UPDATE breeding_archives SET purpose = 'gm-audit' WHERE archive_id = ?
    `).run(archive.archiveId)
    expect(() => service.archiveRepository.getArchive(archive.archiveId)).toThrow(BreedingRepositoryCorruptionError)
    database.connection.prepare(`
      UPDATE breeding_archives SET purpose = 'campaign-backup', archive_json = archive_json || ' '
      WHERE archive_id = ?
    `).run(archive.archiveId)
    expect(() => service.archiveRepository.getArchive(archive.archiveId)).toThrow(BreedingRepositoryCorruptionError)
  })

  it('restores one strict backup atomically, writes its receipt, exactly replays, and survives restart', () => {
    const source = open()
    const archive = manager(source).createCampaignBackup(backupInput())
    const request = createRequest({ archive, requestValue: 1 })

    const root = mkdtempSync(join(tmpdir(), 'breeding-archive-restore-'))
    roots.push(root)
    const path = join(root, 'target.sqlite')
    const target = open(path)
    const service = manager(target)
    const envelope = JSON.stringify(archive)
    const restored = service.restoreCampaign({
      envelope,
      request,
      actorAuthority: actor(),
      currentReferenceVersions: references(),
      currentCheckpointArchiveId: null,
    })
    expect(restored).toMatchObject({ kind: 'restored', archive, receipt: {
      accepted: true,
      reasonId: 'breeding.archive.accepted',
      committedAtCampaignMinute: 0,
      resultingArchiveDefinitionSha256: archive.archiveDefinitionSha256,
    } })
    expect(service.restoreCampaign({
      envelope: new TextEncoder().encode(envelope),
      request: structuredClone(request),
      actorAuthority: actor(),
      currentReferenceVersions: references(),
      currentCheckpointArchiveId: null,
    })).toMatchObject({ kind: 'exact-replay', archive, receipt: restored.receipt })

    target.close()
    databases.splice(databases.indexOf(target), 1)
    const reopened = open(path)
    const repository = createSqliteBreedingArchiveRepository(reopened)
    expect(repository.getImportRequest(request.requestId)).toEqual(request)
    expect(repository.getRestoreReceipt(request.requestId)).toEqual(restored.receipt)
  })

  it('rolls back archive, request, replacement, and receipt together at every restore injection point', () => {
    const source = open()
    const archive = manager(source).createCampaignBackup(backupInput())
    const envelope = JSON.stringify(archive)

    for (const [index, hook] of ['beforeReplace', 'afterReplaceBeforeReceipt'].entries()) {
      const target = open()
      const service = manager(target)
      const request = createRequest({ archive, requestValue: index + 2 })
      expect(() => service.restoreCampaign({
        envelope,
        request,
        actorAuthority: actor(),
        currentReferenceVersions: references(),
        currentCheckpointArchiveId: null,
        [hook]: () => { throw new Error(`injected-${hook}`) },
      })).toThrow(`injected-${hook}`)
      expect(service.archiveRepository.getArchive(archive.archiveId)).toBeNull()
      expect(service.archiveRepository.getImportRequest(request.requestId)).toBeNull()
      expect(service.archiveRepository.getRestoreReceipt(request.requestId)).toBeNull()
      expect(service.stateRepository.hasCampaignAuthority()).toBe(false)
    }
  })

  it('fails closed on unauthorized, stale, oversized, asynchronous, and nested boundaries', () => {
    const database = open()
    const service = manager(database)
    expect(() => service.createCampaignBackup({
      ...backupInput(),
      actorAuthority: actor(1),
    })).toThrowError(expect.objectContaining({ code: 'breeding.archive-manager.stale-authority' }))
    expect(() => service.parseEnvelope(new Uint8Array(64 * 1024 * 1024 + 1)))
      .toThrowError(expect.objectContaining({ code: 'breeding.archive-manager.oversized-envelope' }))
    expect(() => database.withTransaction(() => service.createCampaignBackup(backupInput())))
      .toThrowError(expect.objectContaining({ code: 'breeding.archive-manager.nested-boundary' }))

    const asyncService = createBreedingArchiveManager({
      database,
      authorizeGm: (() => Promise.resolve(true)) as never,
      authorizeOwnerExport: () => true,
      validateRecordDependencies: () => true,
    })
    expect(() => asyncService.createCampaignBackup(backupInput()))
      .toThrowError(expect.objectContaining({ code: 'breeding.archive-manager.async-hook' }))
  })

  it('reports strict integrity, orphan links, pending recovery, and quarantined legacy map metadata', () => {
    const database = open()
    const service = manager(database)
    const clean = service.runIntegrityDiagnostics({
      campaignIdentitySha256: campaignIdentity('8'),
      actorAuthority: actor(),
    })
    expect(clean).toMatchObject({ schemaVersion: 1, healthy: true, backupReady: true, diagnostics: [] })
    expect(clean.definitionSha256).toBe(digest(stableJsonStringify({
      schemaVersion: clean.schemaVersion,
      campaignIdentitySha256: clean.campaignIdentitySha256,
      checkedAtCampaignMinute: clean.checkedAtCampaignMinute,
      healthy: clean.healthy,
      backupReady: clean.backupReady,
      diagnostics: clean.diagnostics,
      tableCounts: clean.tableCounts,
    })))

    database.withTransaction(() => createSqliteBreedingOperationRepository(database)
      .reserve(command(51), 0))
    database.connection.prepare(`
      INSERT INTO maps (slug, document_json, revision, updated_at)
      VALUES ('legacy-egg-map', ?, 0, 0)
    `).run(JSON.stringify({ slug: 'legacy-egg-map', metadata: { capabilityEggs: [], hatchHours: 12 } }))
    const report = service.runIntegrityDiagnostics({
      campaignIdentitySha256: campaignIdentity('8'),
      actorAuthority: actor(),
    })
    expect(report).toMatchObject({ healthy: true, backupReady: false })
    expect(report.diagnostics.map(value => value.code)).toEqual([
      'breeding.integrity.legacy-map-egg-metadata',
      'breeding.integrity.pending-operation',
    ])
    expect(() => service.createCampaignBackup({ ...backupInput(), archiveId: archiveId(9) as never }))
      .toThrowError(expect.objectContaining({ code: 'breeding.archive.pending-operation' }))
  })

  it('rejects unavailable reference dependencies and rolls their imports back', () => {
    const source = open()
    const archive = manager(source).createCampaignBackup(backupInput())
    const target = open()
    const service = createBreedingArchiveManager({
      database: target,
      authorizeGm: () => true,
      authorizeOwnerExport: () => true,
      validateRecordDependencies: () => false,
    })
    const request = createRequest({ archive, requestValue: 10 })
    expect(() => service.restoreCampaign({
      envelope: JSON.stringify(archive),
      request,
      actorAuthority: actor(),
      currentReferenceVersions: references(),
      currentCheckpointArchiveId: null,
    })).toThrow()
    expect(service.archiveRepository.getArchive(archive.archiveId)).toBeNull()
    expect(service.archiveRepository.getImportRequest(request.requestId)).toBeNull()
  })
})
