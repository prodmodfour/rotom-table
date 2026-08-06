import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import contractJson from '../../data/breeding-automation/persistence-conformance-contract.json'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { BREEDING_REFERENCE_SOURCE_IDS } from '../../shared/breeding/readSets'
import { createBreedingActorAuthorityV1 } from '../../server/domain/breeding/authorization'
import { createBreedingReferenceVersionSnapshotV1 } from '../../server/domain/breeding/readSets'
import { createSqliteBreedingArchiveRepository } from '../../server/storage/breedingArchiveRepository'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { BreedingRepositoryIdentityCollisionError } from '../../server/storage/breedingRepositorySupport'
import { advanceBreedingCampaignClock } from '../../server/useCases/advanceBreedingCampaignClock'
import { createBreedingArchiveManager } from '../../server/useCases/manageBreedingArchives'

const databases: RotomDatabase[] = []
const roots: string[] = []
const open = (path: string): RotomDatabase => {
  const value = openRotomDatabase({ path, enableWal: true })
  databases.push(value)
  return value
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})
const ruleset = rulesetJson as Record<string, string>
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const archiveId = (value: number): string => `breeding-archive:v1:${value.toString(16).padStart(32, '0')}`
const clockCommand = (value: number, expectedRevision: number, targetCampaignMinute: number) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(value),
  commandKind: 'advance-campaign-clock',
  actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  scopes: [{ kind: 'campaign-clock', expectedRevision }],
  payload: { targetCampaignMinute },
})
const actorCommand = () => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(100),
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
const actor = () => createBreedingActorAuthorityV1({
  role: 'gm',
  command: actorCommand(),
  authenticatedPrincipalSha256: '6'.repeat(64),
  authenticationPolicyDefinitionSha256: '7'.repeat(64),
  profile: null,
  evaluatedAtCampaignMinute: 0,
})
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
const manager = (database: RotomDatabase) => createBreedingArchiveManager({
  database,
  authorizeGm: () => true,
  authorizeOwnerExport: () => true,
  validateRecordDependencies: () => true,
})
const backupInput = (identity: number, campaignIdentitySha256 = '8'.repeat(64)) => ({
  archiveId: archiveId(identity) as never,
  campaignIdentitySha256,
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  referenceVersions: references(),
  actorAuthority: actor(),
})

const fileDatabasePair = (): readonly [RotomDatabase, RotomDatabase] => {
  const root = mkdtempSync(join(tmpdir(), 'breeding-persistence-conformance-'))
  roots.push(root)
  const path = join(root, 'campaign.sqlite')
  return [open(path), open(path)]
}

describe('Breeding Phase 4 persistence conformance', () => {
  it('binds every required migration, repository, retry, concurrency, rollback, and restart surface', () => {
    const contract = contractJson as Record<string, any>
    const digest = createHash('sha256').update(stableJsonStringify(contract.definition)).digest('hex')
    expect(contract.definitionSha256).toBe(digest)
    expect(contract.definition.surfaces).toHaveLength(8)
    expect(contract.definition.invariants).toMatchObject({
      staleWriter: 'typed-result-or-terminal-rejection-never-overwrite',
      exactRetry: 'same-stable-json-facts-only-no-second-mutation',
      rollback: 'all-caller-owned-transaction-participants',
      mapEncounterAuthority: 'none',
    })
    const root = resolve(import.meta.dirname, '../..')
    for (const surface of contract.definition.surfaces) {
      expect(existsSync(resolve(root, surface.testPath)), surface.id).toBe(true)
      expect(surface.requiredCases.length, surface.id).toBeGreaterThanOrEqual(4)
    }
  })

  it('serializes two database connections into one accepted clock write, one exact retry, and one stale rejection', () => {
    const [first, second] = fileDatabasePair()
    const acceptedCommand = clockCommand(1, 0, 60)
    const accepted = advanceBreedingCampaignClock(acceptedCommand, { database: first })
    const exactRetry = advanceBreedingCampaignClock(acceptedCommand, { database: second })
    const stale = advanceBreedingCampaignClock(clockCommand(2, 0, 120), { database: second })

    expect(accepted).toMatchObject({ kind: 'executed', record: { status: 'accepted' } })
    expect(exactRetry).toEqual({ kind: 'exact-retry', record: accepted.record })
    expect(stale).toMatchObject({ kind: 'executed', record: {
      status: 'rejected',
      result: { reasonId: 'breeding.operation.stale-revision' },
    } })
    expect(first.connection.prepare('SELECT revision, campaign_minute FROM campaign_clock').get())
      .toEqual({ revision: 1, campaign_minute: 60 })
    expect(second.connection.prepare('SELECT revision, campaign_minute FROM campaign_clock').get())
      .toEqual({ revision: 1, campaign_minute: 60 })
  })

  it('makes archive exact replay, changed identity collision, and failed-export rollback visible across connections', () => {
    const [first, second] = fileDatabasePair()
    const firstManager = manager(first)
    const secondManager = manager(second)
    const archive = firstManager.createCampaignBackup(backupInput(1))

    expect(secondManager.createCampaignBackup(backupInput(1))).toEqual(archive)
    expect(() => secondManager.createCampaignBackup(backupInput(1, '9'.repeat(64))))
      .toThrow(BreedingRepositoryIdentityCollisionError)
    expect(() => firstManager.createCampaignBackup({
      ...backupInput(2),
      beforePersist: () => { throw new Error('injected export rollback') },
    })).toThrow('injected export rollback')
    expect(createSqliteBreedingArchiveRepository(second).getArchive(archiveId(2))).toBeNull()
  })
})
