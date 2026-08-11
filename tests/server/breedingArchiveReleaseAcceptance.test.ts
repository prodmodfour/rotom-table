import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import securityPolicyJson from '../../data/breeding-automation/security-policy.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import {
  BREEDING_ARCHIVE_MAXIMUM_BYTES,
  type BreedingArchiveRecordKind,
  type BreedingArchiveV1,
} from '../../shared/breeding/archives'
import type { PokemonEggDocumentV1 } from '../../shared/breeding/egg'
import {
  parseBreedingOperationCommandV1,
  type BreedingOperationCommandV1,
} from '../../shared/breeding/operations'
import { BREEDING_REFERENCE_SOURCE_IDS } from '../../shared/breeding/readSets'
import {
  createBreedingArchiveImportRequestV1,
  createBreedingArchiveV1,
  createBreedingCampaignClockArchiveRecordV1,
  createBreedingLegacyLineageReviewV1,
  createBreedingMigrationPackageV1,
  createBreedingSpeciesAcquisitionArchiveRecordV1,
  validateBreedingCampaignBackupIntegrityV1,
  validateBreedingMigrationPackageForApplicationV1,
} from '../../server/domain/breeding/archives'
import {
  createBreedingActorAuthorityV1,
  createBreedingAuthorizationReceiptV1,
  createBreedingGmOverrideEvidenceV1,
} from '../../server/domain/breeding/authorization'
import {
  createPokemonBreedingOriginFromHatchedEgg,
  createPokemonEggOffspringBlueprintV1,
  parseAuthoritativePokemonEggDocumentV1,
} from '../../server/domain/breeding/lineage'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
} from '../../server/domain/breeding/operations'
import { compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import {
  createBreedingOperationReadSetV1,
  createBreedingReferenceVersionSnapshotV1,
  validateBreedingOperationReadSetCompleteness,
} from '../../server/domain/breeding/readSets'
import { parseAuthoritativePokemonEggTransferConsentV1 } from '../../server/domain/breeding/eggTransfer'
import {
  createBreedingSpeciesAcquisitionSourceEvidenceV1,
  createBreedingSpeciesAcquisitionSourceSettlementV1,
} from '../../server/domain/breeding/speciesAcquisitionIntegration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createBreedingArchiveManager } from '../../server/useCases/manageBreedingArchives'

const databases: RotomDatabase[] = []
const roots: string[] = []
const open = (path = ':memory:'): RotomDatabase => {
  const database = openRotomDatabase({ path, enableWal: path !== ':memory:' })
  databases.push(database)
  return database
}
const close = (database: RotomDatabase): void => {
  const index = databases.indexOf(database)
  if (index >= 0) databases.splice(index, 1)
  database.close()
}
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true })
})

const ruleset = Object.freeze({
  rulesetId: rulesetJson.rulesetId,
  definitionSha256: rulesetJson.definitionSha256,
})
const sha = (value: unknown): string => createHash('sha256')
  .update(typeof value === 'string' ? value : stableJsonStringify(value))
  .digest('hex')
const archiveId = (value: number): string => `breeding-archive:v1:${value.toString(16).padStart(32, '0')}`
const requestId = (value: number): string => `breeding-archive-request:v1:${value.toString(16).padStart(32, '0')}`
const migrationId = (value: number): string => `breeding-migration:v1:${value.toString(16).padStart(32, '0')}`
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const readSetId = (value: number): string => `breeding-read-set:v1:${value.toString(16).padStart(32, '0')}`
const overrideId = (value: number): string => `breeding-override:v1:${value.toString(16).padStart(32, '0')}`
const eggId = (value: number): string => `pokemon-egg:v1:${value.toString(16).padStart(32, '0')}`
const consentId = (value: number): string => `egg-transfer-consent:v1:${value.toString(16).padStart(32, '0')}`
const campaignIdentity = (value: string): string => value.repeat(64)

const references = (sourceManifestSha256 = '1'.repeat(64)) => createBreedingReferenceVersionSnapshotV1({
  schemaVersion: 1,
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  sourceManifestSha256,
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
const actor = (command: BreedingOperationCommandV1, minute = 0) => createBreedingActorAuthorityV1({
  role: 'gm',
  command,
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
const clockResource = () => Object.freeze({
  resourceKind: 'campaign-clock' as const,
  resourceId: 'campaign-clock',
  existence: 'present' as const,
  revision: 0,
  definitionSha256: sha({ schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null }),
  observedCampaignMinute: 0,
  purposes: Object.freeze(['campaign-time' as const]),
})
const absentEggResource = (id: string) => Object.freeze({
  resourceKind: 'pokemon-egg' as const,
  resourceId: id,
  existence: 'absent' as const,
  revision: null,
  definitionSha256: null,
  observedCampaignMinute: null,
  purposes: Object.freeze(['conflict' as const]),
})
const trainerResource = (slug: string, purposes: readonly ('authorization' | 'mechanics')[]) => Object.freeze({
  resourceKind: 'trainer-sheet' as const,
  resourceId: slug,
  existence: 'present' as const,
  revision: 0,
  definitionSha256: '8'.repeat(64),
  observedCampaignMinute: null,
  purposes: Object.freeze([...purposes].sort()),
})
const pokemonResource = (slug: string) => Object.freeze({
  resourceKind: 'pokemon-sheet' as const,
  resourceId: slug,
  existence: 'present' as const,
  revision: 1,
  definitionSha256: '9'.repeat(64),
  observedCampaignMinute: null,
  purposes: Object.freeze(['snapshot' as const]),
})

const sourceCommand = () => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(1),
  commandKind: 'create-source-egg',
  actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
  ruleset,
  scopes: [{ kind: 'pokemon-egg', eggId: eggId(1), expectedRevision: null }],
  payload: {
    eggId: eggId(1),
    ownerTrainerSlug: 'trainer-source',
    source: {
      kind: 'gm',
      reasonId: 'breeding.egg-source.reviewed',
      evidenceDefinitionSha256: 'a'.repeat(64),
    },
    speciesOptionId: 'option:v1:11111111111111111111111111111111',
    resolutions: { selectedOptionIds: [], requestedRollKinds: [] },
  },
})
const auditCommand = () => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: operationId(2),
  commandKind: 'preview-breeding',
  actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
  ruleset,
  scopes: [],
  payload: {
    ownerTrainerSlug: 'trainer-source',
    breederTrainerSlug: 'trainer-breeder',
    parentRefs: [
      { pokemonSheetSlug: 'pokemon-parent-a', expectedSheetRevision: 1 },
      { pokemonSheetSlug: 'pokemon-parent-b', expectedSheetRevision: 1 },
    ],
    optionSnapshotDefinitionSha256: '5'.repeat(64),
  },
})
const operationEvidence = (input: {
  readonly command: BreedingOperationCommandV1
  readonly ordinal: number
  readonly resources: readonly ReturnType<typeof clockResource>[] | readonly any[]
  readonly gmOverrides?: readonly ReturnType<typeof createBreedingGmOverrideEvidenceV1>[]
  readonly outcomeKind: 'source-egg-created' | 'previewed'
}) => {
  const commandHash = createBreedingOperationCommandHash(input.command)
  const readSet = createBreedingOperationReadSetV1({
    readSetId: readSetId(input.ordinal) as never,
    operationId: input.command.operationId,
    commandSha256: commandHash,
    commandKind: input.command.commandKind,
    capturedAtCampaignMinute: 0,
    resources: input.resources,
    referenceVersions: references(),
    dependencyEvidence: [{
      providerKind: 'system',
      providerId: 'breeding-effective-dependency-set-v1',
      subjectKind: 'campaign',
      subjectId: 'campaign',
      subjectRevision: null,
      checkpoint: 'authorization',
      providerDefinitionSha256: securityPolicyJson.definitionSha256,
      effectiveEvidenceSha256: sha([]),
    }],
    writeExpectations: input.command.scopes,
  })
  validateBreedingOperationReadSetCompleteness(input.command, readSet)
  const authority = actor(input.command)
  const gmOverrides = input.gmOverrides ?? []
  const receipt = createBreedingAuthorizationReceiptV1({
    operationId: input.command.operationId,
    commandSha256: commandHash,
    commandKind: input.command.commandKind,
    actorAuthorityDefinitionSha256: authority.definitionSha256,
    readSetDefinitionSha256: readSet.definitionSha256,
    evidenceDefinitionHashes: [authority.definitionSha256],
    gmOverrideIds: gmOverrides.map(value => value.overrideId),
    authorized: true,
    reasonId: 'breeding.authorization.authorized',
    evaluatedAtCampaignMinute: 0,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  const result = createBreedingOperationAcceptedV1({
    operationId: input.command.operationId,
    commandHash,
    commandKind: input.command.commandKind,
    outcomeKind: input.outcomeKind,
    aggregateRefs: input.outcomeKind === 'source-egg-created'
      ? [{ kind: 'pokemon-egg', id: eggId(1), revision: 0 }]
      : [],
    changedScopes: input.outcomeKind === 'source-egg-created' ? input.command.scopes : [],
    committedAtCampaignMinute: input.outcomeKind === 'source-egg-created' ? 0 : null,
  } as never)
  return Object.freeze({ readSet, receipt, result, gmOverrides })
}

const egg = (): PokemonEggDocumentV1 => {
  const species = compiledBreedingSpeciesSpec('bulbasaur')!
  const blueprint = createPokemonEggOffspringBlueprintV1({
    schemaVersion: 1,
    speciesId: species.speciesId,
    familyRootSpeciesId: species.familyRootSpeciesId,
    speciesSpecDefinitionSha256: species.definitionSha256,
    nature: { valueId: 'cuddly', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    ability: { valueId: species.basicAbilityIds[0]!, resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    gender: { valueId: 'female', resolutionKind: 'fixed', rollRecordId: null, optionId: null, choiceEvidenceId: null },
    inheritanceCandidates: [],
    startingLevel: 1,
    babyTemplate: { applied: false, choiceOptionId: null, choiceEvidenceId: null, effects: null },
  })
  return parseAuthoritativePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId: eggId(1),
    revision: 0,
    status: 'incubating',
    ownerTrainerSlug: 'trainer-source',
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'a'.repeat(64) },
    ruleset,
    definitionHashes: [blueprint.definitionSha256, ruleset.definitionSha256].sort(),
    parents: [],
    breeder: null,
    offspring: blueprint,
    incubation: {
      averageCampaignMinutes: 600,
      targetCampaignMinutes: 600,
      accumulatedCampaignMinutes: 0,
      variationPolicyId: 'fixed-average',
      durationResultDefinitionSha256: 'c'.repeat(64),
      lastAppliedClockRevision: 0,
      lastAppliedClockMinute: 0,
      readyAtCampaignMinute: null,
      readinessKind: null,
      readyOperationId: null,
      paused: false,
      pauseReasonId: null,
      pauseOperationId: null,
    },
    special: {
      state: 'not-rolled',
      rollRecordId: null,
      rollTotal: null,
      triggerIds: [],
      adjudicationId: null,
      outcomeId: null,
      automaticShiny: false,
    },
    hatchOperationId: null,
    childSheetSlug: null,
    terminal: null,
    createdAtCampaignMinute: 0,
    updatedAtCampaignMinute: 0,
    statusChangedAtCampaignMinute: 0,
    lastOperationId: operationId(1),
  })
}
const transferConsent = (role: 'source-gift' | 'recipient-acceptance') => {
  const definition = {
    schemaVersion: 1 as const,
    consentId: consentId(role === 'source-gift' ? 1 : 2),
    revision: 0 as const,
    status: 'active' as const,
    role,
    eggId: eggId(1),
    eggRevision: 0,
    sourceTrainerSlug: 'trainer-source',
    destinationTrainerSlug: 'trainer-destination',
    consentingProfileId: role === 'source-gift' ? 'profile_source1234' : 'profile_destination1234',
    consentingTrainerSlug: role === 'source-gift' ? 'trainer-source' : 'trainer-destination',
    consentingTrainerRevision: 0,
    consentingTrainerDefinitionSha256: 'd'.repeat(64),
    trainerControlDefinitionSha256: 'e'.repeat(64),
    counterpartConsentId: role === 'source-gift' ? null : consentId(1),
    grantedAtCampaignMinute: 0,
    expiresAtCampaignMinute: 100,
    settlementOperationId: null,
    settledAtCampaignMinute: null,
  }
  return parseAuthoritativePokemonEggTransferConsentV1({
    ...definition,
    definitionSha256: sha(definition),
  })
}

const completeBackup = (): BreedingArchiveV1 => {
  const create = sourceCommand()
  const createEvidence = operationEvidence({
    command: create,
    ordinal: 1,
    resources: [
      clockResource(),
      absentEggResource(eggId(1)),
      trainerResource('trainer-source', ['authorization']),
    ],
    outcomeKind: 'source-egg-created',
  })
  const audit = auditCommand()
  const auditActor = actor(audit)
  const override = createBreedingGmOverrideEvidenceV1({
    overrideId: overrideId(1) as never,
    command: audit,
    actorAuthority: auditActor,
    overrideKind: 'owner-control',
    target: { kind: 'trainer-sheet', trainerSheetSlug: 'trainer-source' },
    reasonId: 'breeding.override.owner-control',
    createdAtCampaignMinute: 0,
    securityPolicyDefinitionSha256: securityPolicyJson.definitionSha256,
  })
  const auditEvidence = operationEvidence({
    command: audit,
    ordinal: 2,
    resources: [
      clockResource(),
      trainerResource('trainer-source', ['authorization']),
      trainerResource('trainer-breeder', ['mechanics']),
      pokemonResource('pokemon-parent-a'),
      pokemonResource('pokemon-parent-b'),
    ],
    gmOverrides: [override],
    outcomeKind: 'previewed',
  })
  const sourceEvidence = createBreedingSpeciesAcquisitionSourceEvidenceV1({
    sourceKind: 'migration',
    sourceAuthorityKind: 'reviewed-migration',
    sourceEventId: 'reviewed-migration:bulbasaur:1',
    sourceAuthorityDefinitionSha256: 'f'.repeat(64),
    trainerSheetSlug: 'trainer-source',
    trainerRevisionBeforeReward: 2,
    speciesId: 'bulbasaur',
    pokemonSheetSlug: null,
    pokemonSheetRevision: null,
    campaignMinute: 0,
  })
  const acquisition = createBreedingSpeciesAcquisitionArchiveRecordV1({
    trainerSheetSlug: 'trainer-source',
    trainerRevisionBeforeReward: 2,
    trainerSheetUpdatedAt: 1_700_000_000_000,
    speciesId: 'bulbasaur',
    sourceKind: 'migration',
    firstAcquiredAtCampaignMinute: 0,
    sourceEggId: null,
    operationId: sourceEvidence.operationId,
  })
  const settlement = createBreedingSpeciesAcquisitionSourceSettlementV1({
    evidence: sourceEvidence,
    outcome: 'first-acquisition-rewarded',
    acquisitionDefinitionSha256: acquisition.definitionSha256,
    trainerRevisionAfterReward: 3,
    trainerDexExpAfterReward: 1,
    appliedRewardAmount: 1,
    settledAtCampaignMinute: 0,
  })
  const archive = createBreedingArchiveV1({
    archiveId: archiveId(100) as never,
    purpose: 'campaign-backup',
    campaignIdentitySha256: campaignIdentity('8'),
    createdAtCampaignMinute: 0,
    rulesetId: ruleset.rulesetId,
    rulesetDefinitionSha256: ruleset.definitionSha256,
    referenceVersions: references(),
    records: {
      'campaign-clock': [createBreedingCampaignClockArchiveRecordV1({ revision: 0, campaignMinute: 0, lastOperationId: null })],
      egg: [egg()],
      'egg-transfer-consent': [transferConsent('source-gift'), transferConsent('recipient-acceptance')],
      'gm-override': [override],
      'operation-command': [create, audit],
      'operation-result': [createEvidence.result, auditEvidence.result],
      'read-set': [createEvidence.readSet, auditEvidence.readSet],
      'authorization-receipt': [createEvidence.receipt, auditEvidence.receipt],
      'species-acquisition': [acquisition],
      'species-acquisition-source-settlement': [settlement],
    },
  })
  return validateBreedingCampaignBackupIntegrityV1(archive)
}
const restoreRequest = (archive: BreedingArchiveV1, value: number, currentActor = actor(auditCommand())) => createBreedingArchiveImportRequestV1({
  requestId: requestId(value) as never,
  archiveId: archive.archiveId,
  archiveDefinitionSha256: archive.archiveDefinitionSha256,
  mode: 'restore-new-campaign',
  targetCampaignIdentitySha256: campaignIdentity('9'),
  expectedCurrentArchiveDefinitionSha256: null,
  actorAuthorityDefinitionSha256: currentActor.definitionSha256,
  requestedAtCampaignMinute: 0,
})
const recordCounts = (archive: BreedingArchiveV1): Readonly<Record<string, number>> => Object.freeze(Object.fromEntries(
  archive.chunks.map(chunk => [chunk.recordKind, chunk.recordCount]),
))

const emptyBackup = (value = 200): BreedingArchiveV1 => validateBreedingCampaignBackupIntegrityV1(createBreedingArchiveV1({
  archiveId: archiveId(value) as never,
  purpose: 'campaign-backup',
  campaignIdentitySha256: campaignIdentity('8'),
  createdAtCampaignMinute: 0,
  rulesetId: ruleset.rulesetId,
  rulesetDefinitionSha256: ruleset.definitionSha256,
  referenceVersions: references(),
  records: {
    'campaign-clock': [createBreedingCampaignClockArchiveRecordV1({ revision: 0, campaignMinute: 0, lastOperationId: null })],
  },
}))

const orphanOrigin = () => {
  const source = egg()
  const hatched = parseAuthoritativePokemonEggDocumentV1({
    ...source,
    revision: 3,
    status: 'hatched',
    incubation: {
      ...source.incubation,
      accumulatedCampaignMinutes: 600,
      readyAtCampaignMinute: 10,
      readinessKind: 'incubation-complete',
      readyOperationId: operationId(3),
    },
    special: {
      state: 'normal',
      rollRecordId: 'breeding-roll:v1:11111111111111111111111111111111',
      rollTotal: 50,
      triggerIds: [],
      adjudicationId: null,
      outcomeId: null,
      automaticShiny: false,
    },
    hatchOperationId: operationId(4),
    childSheetSlug: 'pokemon-orphan-child',
    updatedAtCampaignMinute: 10,
    statusChangedAtCampaignMinute: 10,
    lastOperationId: operationId(5),
  })
  return createPokemonBreedingOriginFromHatchedEgg({
    originId: 'pokemon-breeding-origin:v1:11111111111111111111111111111111' as never,
    egg: hatched,
  })
}

describe('BR-085 archive, migration, reference-version, and orphan-repair release acceptance', () => {
  it('round-trips every private durable authority family without omitting overrides, transfer consent, or external acquisition settlement', () => {
    const archive = completeBackup()
    expect(recordCounts(archive)).toMatchObject({
      'campaign-clock': 1,
      egg: 1,
      'egg-transfer-consent': 2,
      'gm-override': 1,
      'operation-command': 2,
      'operation-result': 2,
      'read-set': 2,
      'authorization-receipt': 2,
      'species-acquisition': 1,
      'species-acquisition-source-settlement': 1,
    })
    const target = open()
    const service = manager(target)
    const currentActor = actor(auditCommand())
    const request = restoreRequest(archive, 1, currentActor)
    expect(service.restoreCampaign({
      envelope: stableJsonStringify(archive),
      request,
      actorAuthority: currentActor,
      currentReferenceVersions: references(),
      currentCheckpointArchiveId: null,
    }).kind).toBe('restored')

    const restoredRecords = service.stateRepository.readRecords({ purpose: 'campaign-backup' })
    expect(restoredRecords['gm-override']).toEqual(archive.chunks.find(chunk => chunk.recordKind === 'gm-override')?.records)
    expect(restoredRecords['egg-transfer-consent']).toEqual(archive.chunks.find(chunk => chunk.recordKind === 'egg-transfer-consent')?.records)
    expect(restoredRecords['species-acquisition-source-settlement']).toEqual(archive.chunks.find(chunk => chunk.recordKind === 'species-acquisition-source-settlement')?.records)

    const second = service.createCampaignBackup({
      archiveId: archiveId(101) as never,
      campaignIdentitySha256: campaignIdentity('9'),
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      referenceVersions: references(),
      actorAuthority: currentActor,
    })
    expect(recordCounts(second)).toEqual(recordCounts(archive))
    expect(second.chunks.map(chunk => [chunk.recordKind, chunk.recordsSha256]))
      .toEqual(archive.chunks.map(chunk => [chunk.recordKind, chunk.recordsSha256]))
  })

  it('rejects stale reference authority before writes and accepts exactly the 64 MiB UTF-8 envelope boundary', () => {
    const archive = emptyBackup()
    const target = open()
    const service = manager(target)
    const currentActor = actor(auditCommand())
    const request = restoreRequest(archive, 2, currentActor)
    expect(() => service.restoreCampaign({
      envelope: stableJsonStringify(archive),
      request,
      actorAuthority: currentActor,
      currentReferenceVersions: references('f'.repeat(64)),
      currentCheckpointArchiveId: null,
    })).toThrowError(expect.objectContaining({ code: 'breeding.archive.cross-link' }))
    expect(service.archiveRepository.getArchive(archive.archiveId)).toBeNull()
    expect(service.archiveRepository.getImportRequest(request.requestId)).toBeNull()
    expect(service.stateRepository.hasCampaignAuthority()).toBe(false)

    const encoded = stableJsonStringify(archive)
    const exactBoundary = `${encoded}${' '.repeat(BREEDING_ARCHIVE_MAXIMUM_BYTES - Buffer.byteLength(encoded, 'utf8'))}`
    expect(Buffer.byteLength(exactBoundary, 'utf8')).toBe(BREEDING_ARCHIVE_MAXIMUM_BYTES)
    expect(service.parseEnvelope(exactBoundary)).toEqual(archive)
    expect(() => service.parseEnvelope(`${exactBoundary} `))
      .toThrowError(expect.objectContaining({ code: 'breeding.archive-manager.oversized-envelope' }))
  })

  it('source-hash-validates a reviewed legacy migration and applies only its exact result archive', () => {
    const resultArchive = emptyBackup(201)
    const review = createBreedingLegacyLineageReviewV1({
      reviewId: 'breeding-legacy-review:v1:11111111111111111111111111111111' as never,
      pokemonSheetSlug: 'pokemon-legacy-child',
      pokemonSheetRevision: 7,
      pokemonSheetDefinitionSha256: '9'.repeat(64),
      legacyEggMoveIds: ['light-screen'] as never,
      legacyInheritedMoveIds: ['water-gun'] as never,
      legacyFieldsDefinitionSha256: '0'.repeat(64),
      decision: 'compatibility-only',
      existingOriginId: null,
      existingOriginDefinitionSha256: null,
      adjudicationDefinitionSha256: 'a'.repeat(64),
      reviewerPrincipalSha256: 'b'.repeat(64),
      reasonId: 'breeding.migration.compatibility-only',
      reviewedAtCampaignMinute: 0,
    })
    const migration = createBreedingMigrationPackageV1({
      migrationId: migrationId(1) as never,
      migrationKind: 'legacy-lineage-review',
      sourceSchemaId: 'legacy-sheet-v0',
      targetSchemaId: 'breeding-archive-v1',
      sourceCampaignIdentitySha256: resultArchive.campaignIdentitySha256,
      sourceArtifacts: [{
        sourceId: 'legacy-campaign-export',
        contentSha256: 'c'.repeat(64),
        sizeBytes: 4_096,
        privacyClass: 'campaign-private',
      }],
      legacyLineageReviews: [review],
      resultArchiveDefinitionSha256: resultArchive.archiveDefinitionSha256,
      migrationToolDefinitionSha256: 'd'.repeat(64),
      reviewerEvidenceDefinitionSha256: 'e'.repeat(64),
      createdAtCampaignMinute: 0,
    })
    const validated = validateBreedingMigrationPackageForApplicationV1({
      migration,
      observedSourceArtifacts: migration.sourceArtifacts,
      expectedMigrationToolDefinitionSha256: 'd'.repeat(64),
      validateReviewerEvidence: value => value === 'e'.repeat(64),
      validateLegacyReviewEvidence: value => value.definitionSha256 === review.definitionSha256,
      resultArchive,
    })
    expect(validated.resultArchive).toEqual(resultArchive)
    expect(() => validateBreedingMigrationPackageForApplicationV1({
      migration,
      observedSourceArtifacts: [{ ...migration.sourceArtifacts[0]!, contentSha256: 'f'.repeat(64) }],
      expectedMigrationToolDefinitionSha256: 'd'.repeat(64),
      validateReviewerEvidence: () => true,
      validateLegacyReviewEvidence: () => true,
      resultArchive,
    })).toThrowError(expect.objectContaining({ code: 'breeding.archive.cross-link' }))

    const target = open()
    const service = manager(target)
    const currentActor = actor(auditCommand())
    const request = restoreRequest(resultArchive, 3, currentActor)
    expect(service.restoreCampaign({
      envelope: stableJsonStringify(validated.resultArchive!),
      request,
      actorAuthority: currentActor,
      currentReferenceVersions: references(),
      currentCheckpointArchiveId: null,
    })).toMatchObject({ kind: 'restored', archive: resultArchive })
    expect(service.stateRepository.readRecords({ purpose: 'campaign-backup' })).toEqual({
      'campaign-clock': resultArchive.chunks[0]!.records,
    })
  })

  it('detects an orphan, refuses unsafe in-place new-campaign repair, and repairs through an atomic clean-target restore', () => {
    const knownGood = emptyBackup(202)
    const corrupted = open()
    const origin = orphanOrigin()
    corrupted.connection.exec('PRAGMA foreign_keys = OFF')
    corrupted.connection.prepare(`
      INSERT INTO pokemon_breeding_origins (
        origin_id, egg_id, child_sheet_slug, document_json,
        lineage_definition_sha256, hatch_operation_id, created_at_campaign_minute
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      origin.originId,
      origin.eggId,
      origin.childSheetSlug,
      stableJsonStringify(origin),
      origin.lineageDefinitionSha256,
      origin.hatchOperationId,
      origin.hatchedAtCampaignMinute,
    )
    corrupted.connection.exec('PRAGMA foreign_keys = ON')
    const corruptedService = manager(corrupted)
    const currentActor = actor(auditCommand())
    const report = corruptedService.runIntegrityDiagnostics({
      campaignIdentitySha256: campaignIdentity('8'),
      actorAuthority: currentActor,
    })
    expect(report.healthy).toBe(false)
    expect(report.backupReady).toBe(false)
    expect(report.diagnostics.map(value => value.code)).toContain('breeding.integrity.orphan-origin')
    expect(() => corruptedService.restoreCampaign({
      envelope: stableJsonStringify(knownGood),
      request: restoreRequest(knownGood, 4, currentActor),
      actorAuthority: currentActor,
      currentReferenceVersions: references(),
      currentCheckpointArchiveId: null,
    })).toThrowError(expect.objectContaining({ code: 'breeding.archive-manager.nonempty-target' }))

    const root = mkdtempSync(join(tmpdir(), 'breeding-orphan-repair-'))
    roots.push(root)
    const repairedPath = join(root, 'repaired.sqlite')
    const repaired = open(repairedPath)
    const repairedService = manager(repaired)
    const repairedRequest = restoreRequest(knownGood, 5, currentActor)
    expect(repairedService.restoreCampaign({
      envelope: stableJsonStringify(knownGood),
      request: repairedRequest,
      actorAuthority: currentActor,
      currentReferenceVersions: references(),
      currentCheckpointArchiveId: null,
    }).kind).toBe('restored')
    expect(repairedService.runIntegrityDiagnostics({
      campaignIdentitySha256: campaignIdentity('9'),
      actorAuthority: currentActor,
    })).toMatchObject({ healthy: true, backupReady: true, diagnostics: [] })

    close(repaired)
    const reopened = open(repairedPath)
    const reopenedService = manager(reopened)
    expect(reopenedService.archiveRepository.getRestoreReceipt(repairedRequest.requestId)).not.toBeNull()
    expect(reopenedService.runIntegrityDiagnostics({
      campaignIdentitySha256: campaignIdentity('9'),
      actorAuthority: currentActor,
    })).toMatchObject({ healthy: true, backupReady: true, diagnostics: [] })
  })

  it('keeps record dependency validation synchronous and covers every declared backup record kind', () => {
    const archive = completeBackup()
    const target = open()
    const asyncManager = createBreedingArchiveManager({
      database: target,
      authorizeGm: () => true,
      authorizeOwnerExport: () => true,
      validateRecordDependencies: (() => Promise.resolve(true)) as never,
    })
    const currentActor = actor(auditCommand())
    expect(() => asyncManager.restoreCampaign({
      envelope: stableJsonStringify(archive),
      request: restoreRequest(archive, 6, currentActor),
      actorAuthority: currentActor,
      currentReferenceVersions: references(),
      currentCheckpointArchiveId: null,
    })).toThrowError(expect.objectContaining({
      code: 'breeding.archive-manager.async-hook',
      message: 'Archive dependency validation must be synchronous.',
    }))
    expect(asyncManager.stateRepository.hasCampaignAuthority()).toBe(false)
    const kinds = new Set<BreedingArchiveRecordKind>(archive.chunks.map(chunk => chunk.recordKind))
    for (const kind of [
      'egg-transfer-consent',
      'gm-override',
      'species-acquisition-source-settlement',
    ] as const) expect(kinds.has(kind)).toBe(true)
  })
})
