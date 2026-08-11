import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import authorityJson from '../fixtures/breeding/egg-production-cross-owner-authority-v1.json'
import eggContractJson from '../../data/breeding-automation/egg-contract.json'
import hatchDurationPolicyJson from '../../data/breeding-automation/hatch-duration-policy.json'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { parseBreedingCampaignClockEggBatchProjectionV1 } from '../../shared/breeding/campaignClockBatch'
import { BREEDING_PERFORMANCE_BUDGET_POLICY_V1 } from '../../shared/breeding/performanceBudgets'
import type { PokemonEggDocumentV1 } from '../../shared/breeding/egg'
import { parseBreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { createBreedingActorAuthorityV1 } from '../../server/domain/breeding/authorization'
import {
  deriveBreedingCampaignClockBatchChildOperationIdV1,
} from '../../server/domain/breeding/campaignClockBatch'
import {
  createPokemonEggOffspringBlueprintV1,
  parseAuthoritativePokemonEggDocumentV1,
} from '../../server/domain/breeding/lineage'
import {
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
} from '../../server/domain/breeding/operations'
import { compiledBreedingSpeciesSpec } from '../../server/domain/breeding/registry'
import { createSqliteBreedingIncubationSegmentRepository } from '../../server/storage/breedingIncubationSegmentRepository'
import { createSqliteBreedingOperationEvidenceRepository } from '../../server/storage/breedingOperationEvidenceRepository'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqlitePokemonEggRepository } from '../../server/storage/pokemonEggRepository'
import { advanceBreedingCampaignClock } from '../../server/useCases/advanceBreedingCampaignClock'
import {
  advanceBreedingCampaignClockIncubationBatch,
  discoverBreedingCampaignClockIncubationBatchScopes,
} from '../../server/useCases/advanceBreedingCampaignClockBatch'

const authority = authorityJson as any
const ruleset = Object.freeze({
  rulesetId: rulesetJson.rulesetId,
  definitionSha256: rulesetJson.definitionSha256,
})
const databases: RotomDatabase[] = []
const tempRoots: string[] = []
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
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true })
})
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const eggId = (value: number): string => `pokemon-egg:v1:${value.toString(16).padStart(32, '0')}`
const optionId = (value: number): string => `option:v1:${value.toString(16).padStart(32, '0')}`
const sha = (value: unknown): string => createHash('sha256')
  .update(typeof value === 'string' ? value : stableJsonStringify(value))
  .digest('hex')

const sourceCommand = (value: number, id: string) => parseBreedingOperationCommandV1({
  schemaVersion: 1,
  operationId: op(value),
  commandKind: 'create-source-egg',
  actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
  ruleset,
  scopes: [{ kind: 'pokemon-egg', eggId: id, expectedRevision: null }],
  payload: {
    eggId: id,
    ownerTrainerSlug: `trainer-owner-${value}`,
    source: {
      kind: 'gm',
      reasonId: 'breeding.egg-source.reviewed',
      evidenceDefinitionSha256: 'e'.repeat(64),
    },
    speciesOptionId: optionId(value),
    resolutions: { selectedOptionIds: [], requestedRollKinds: [] },
  },
})
const egg = (value: number, paused = false): PokemonEggDocumentV1 => {
  const id = eggId(value)
  const source = sourceCommand(value, id)
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
  const durationResultDefinitionSha256 = sha(`duration-${value}`)
  return parseAuthoritativePokemonEggDocumentV1({
    schemaVersion: 1,
    eggId: id,
    revision: 0,
    status: 'incubating',
    ownerTrainerSlug: `trainer-owner-${value}`,
    source: { kind: 'gm', reasonId: 'breeding.egg-source.reviewed', evidenceDefinitionSha256: 'e'.repeat(64) },
    ruleset,
    definitionHashes: [
      blueprint.definitionSha256,
      durationResultDefinitionSha256,
      eggContractJson.definitionSha256,
      hatchDurationPolicyJson.definitionSha256,
      ruleset.definitionSha256,
    ].sort(),
    parents: [],
    breeder: null,
    offspring: blueprint,
    incubation: {
      averageCampaignMinutes: 600,
      targetCampaignMinutes: 600,
      accumulatedCampaignMinutes: 0,
      variationPolicyId: 'fixed-average',
      durationResultDefinitionSha256,
      lastAppliedClockRevision: 1,
      lastAppliedClockMinute: 100,
      readyAtCampaignMinute: null,
      readinessKind: null,
      readyOperationId: null,
      paused,
      pauseReasonId: paused ? 'breeding.incubation-pause.gm-maintenance' : null,
      pauseOperationId: paused ? source.operationId : null,
    },
    special: {
      state: 'not-rolled', rollRecordId: null, rollTotal: null, triggerIds: [],
      adjudicationId: null, outcomeId: null, automaticShiny: false,
    },
    hatchOperationId: null,
    childSheetSlug: null,
    terminal: null,
    createdAtCampaignMinute: 100,
    updatedAtCampaignMinute: 100,
    statusChangedAtCampaignMinute: 100,
    lastOperationId: source.operationId,
  })
}
const seed = (values: readonly { readonly value: number, readonly paused?: boolean }[], path = ':memory:') => {
  const database = open(path)
  const eggs = values.map(entry => egg(entry.value, entry.paused ?? false))
  database.withTransaction(() => {
    const operations = createSqliteBreedingOperationRepository(database)
    const repository = createSqlitePokemonEggRepository(database)
    for (const document of eggs) {
      const value = Number.parseInt(document.eggId.slice(-4), 16)
      const command = sourceCommand(value, document.eggId)
      operations.reserve(command, 100)
      repository.insert(document)
      operations.settle(command, createBreedingOperationAcceptedV1({
        operationId: command.operationId,
        commandHash: createBreedingOperationCommandHash(command),
        commandKind: command.commandKind,
        outcomeKind: 'source-egg-created',
        aggregateRefs: [{ kind: 'pokemon-egg', id: document.eggId, revision: 0 }],
        changedScopes: command.scopes,
        committedAtCampaignMinute: 100,
      }), 100)
    }
    database.connection.prepare(`
      UPDATE campaign_clock
      SET revision = 1, campaign_minute = 100, last_operation_id = ?
      WHERE singleton = 1
    `).run(eggs.at(-1)?.lastOperationId ?? op(1))
  })
  return { database, eggs }
}
const batchCommand = (database: RotomDatabase, value: number, targetCampaignMinute: number) => {
  const clock = createSqliteCampaignClockRepository(database).get()
  const scopes = discoverBreedingCampaignClockIncubationBatchScopes({
    expectedClockRevision: clock.revision,
    targetCampaignMinute,
  }, { database })
  return parseBreedingOperationCommandV1({
    schemaVersion: 1,
    operationId: op(value),
    commandKind: 'advance-campaign-clock',
    actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
    ruleset,
    scopes,
    payload: { targetCampaignMinute },
  })
}
const actorFor = (command: ReturnType<typeof batchCommand>, campaignMinute: number) => createBreedingActorAuthorityV1({
  role: 'gm',
  command,
  authenticatedPrincipalSha256: 'a'.repeat(64),
  authenticationPolicyDefinitionSha256: 'b'.repeat(64),
  profile: null,
  evaluatedAtCampaignMinute: campaignMinute,
})
const request = (command: ReturnType<typeof batchCommand>, campaignMinute: number) => ({
  command,
  actorAuthority: actorFor(command, campaignMinute),
  referenceVersions: authority.readSet.referenceVersions,
})
const options = (database: RotomDatabase, extra: Record<string, unknown> = {}) => ({
  database,
  campaignProjectionKey: 'campaign-secret-key-with-at-least-32-bytes',
  realtimeTimestamp: 1_700_000_000_000,
  validateCurrentGmAuthority: () => true,
  ...extra,
})
const eventCount = (database: RotomDatabase): number => Number((database.connection.prepare(
  'SELECT COUNT(*) AS count FROM realtime_events',
).get() as { readonly count: number }).count)


describe('campaign-clock incubation batching', () => {
  it('discovers a canonical multi-Egg page and advances credited and paused downtime through durable child operations', () => {
    const seeded = seed([{ value: 1 }, { value: 2, paused: true }])
    const command = batchCommand(seeded.database, 100, 250)
    expect(command.scopes).toEqual([
      { kind: 'campaign-clock', expectedRevision: 1 },
      { kind: 'pokemon-egg', eggId: eggId(1), expectedRevision: 0 },
      { kind: 'pokemon-egg', eggId: eggId(2), expectedRevision: 0 },
    ])
    const result = advanceBreedingCampaignClockIncubationBatch(
      request(command, 100),
      options(seeded.database),
    )
    expect(createSqliteCampaignClockRepository(seeded.database).get()).toMatchObject({ revision: 2, campaignMinute: 250 })
    expect(result.projection).toMatchObject({
      audience: 'gm',
      parentStatus: 'accepted',
      clockRevision: 2,
      campaignMinute: 250,
      hasMoreDueEggs: false,
      entries: [
        { eggId: eggId(1), status: 'accepted', creditedCampaignMinutes: 150, skippedCampaignMinutes: 0 },
        { eggId: eggId(2), status: 'accepted', creditedCampaignMinutes: 0, skippedCampaignMinutes: 150 },
      ],
    })
    expect(parseBreedingCampaignClockEggBatchProjectionV1(result.projection)).toEqual(result.projection)
    expect(createSqlitePokemonEggRepository(seeded.database).get(eggId(1))).toMatchObject({
      revision: 1, incubation: { accumulatedCampaignMinutes: 150, lastAppliedClockRevision: 2 },
    })
    expect(createSqlitePokemonEggRepository(seeded.database).get(eggId(2))).toMatchObject({
      revision: 1, incubation: { accumulatedCampaignMinutes: 0, lastAppliedClockRevision: 2, paused: true },
    })
    expect(eventCount(seeded.database)).toBe(8)
    const evidenceRepository = createSqliteBreedingOperationEvidenceRepository(seeded.database)
    const persistedOverrides = [
      evidenceRepository.get(command.operationId),
      ...command.scopes.filter(scope => scope.kind === 'pokemon-egg').map(scope => (
        evidenceRepository.get(deriveBreedingCampaignClockBatchChildOperationIdV1(command.operationId, scope.eggId))
      )),
    ]
    expect(persistedOverrides.every(evidence => evidence?.gmOverrides.length === 1)).toBe(true)
    expect(persistedOverrides.every(evidence => (
      evidence?.authorizationReceipt.gmOverrideIds[0] === evidence?.gmOverrides[0]?.overrideId
    ))).toBe(true)
    expect(JSON.stringify(result.projection)).not.toMatch(/species|nature|ability|gender|parentSheet|breeder|profile|definition|sha256|receipt|readSet/iu)
  })

  it('settles long downtime at the exact readiness threshold and retains overflow only in the child segment', () => {
    const seeded = seed([{ value: 3 }])
    const command = batchCommand(seeded.database, 101, 1_000)
    const result = advanceBreedingCampaignClockIncubationBatch(request(command, 100), options(seeded.database))
    expect(result.projection.entries[0]).toMatchObject({
      creditedCampaignMinutes: 600,
      skippedCampaignMinutes: 0,
      overflowCampaignMinutes: 300,
      reachedReady: true,
    })
    expect(createSqlitePokemonEggRepository(seeded.database).get(eggId(3))).toMatchObject({
      status: 'ready',
      incubation: {
        accumulatedCampaignMinutes: 600,
        readyAtCampaignMinute: 700,
        readinessKind: 'incubation-complete',
      },
    })
  })

  it('accepts equal-clock catch-up after an earlier clock-only advance and dedupes exact parent and child retries', () => {
    const seeded = seed([{ value: 4 }, { value: 5 }])
    const clockOnly = parseBreedingOperationCommandV1({
      schemaVersion: 1,
      operationId: op(102),
      commandKind: 'advance-campaign-clock',
      actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
      ruleset,
      scopes: [{ kind: 'campaign-clock', expectedRevision: 1 }],
      payload: { targetCampaignMinute: 250 },
    })
    advanceBreedingCampaignClock(clockOnly, { database: seeded.database })
    const command = batchCommand(seeded.database, 103, 250)
    const first = advanceBreedingCampaignClockIncubationBatch(request(command, 250), options(seeded.database))
    expect(first.execution.record.result).toMatchObject({ changedScopes: [] })
    expect(first.projection.entries).toHaveLength(2)
    expect(eventCount(seeded.database)).toBe(8)

    const retry = advanceBreedingCampaignClockIncubationBatch(request(command, 250), options(seeded.database))
    expect(retry.execution.kind).toBe('exact-retry')
    expect(retry.projection.entries.every(entry => entry.executionKind === 'exact-retry')).toBe(true)
    expect(eventCount(seeded.database)).toBe(8)
    expect(createSqlitePokemonEggRepository(seeded.database).get(eggId(4))?.revision).toBe(1)
  })

  it('continues a bounded 100-Egg page with an equal-target command without losing or duplicating progress', () => {
    const seeded = seed(Array.from({ length: 101 }, (_, index) => ({ value: index + 20 })))
    const firstCommand = batchCommand(seeded.database, 200, 110)
    expect(firstCommand.scopes).toHaveLength(101)
    const startedAt = performance.now()
    const first = advanceBreedingCampaignClockIncubationBatch(
      request(firstCommand, 100),
      options(seeded.database),
    )
    const elapsed = performance.now() - startedAt
    expect(first.projection).toMatchObject({
      clockRevision: 2,
      campaignMinute: 110,
      hasMoreDueEggs: true,
    })
    expect(first.projection.entries).toHaveLength(
      BREEDING_PERFORMANCE_BUDGET_POLICY_V1.batchClock.maximumEggsPerBatch,
    )
    expect(elapsed).toBeLessThanOrEqual(
      BREEDING_PERFORMANCE_BUDGET_POLICY_V1.batchClock.maximumElapsedMilliseconds,
    )
    expect(eventCount(seeded.database)).toBe(400)

    const continuation = batchCommand(seeded.database, 201, 110)
    expect(continuation.scopes).toEqual([
      { kind: 'campaign-clock', expectedRevision: 2 },
      { kind: 'pokemon-egg', eggId: eggId(120), expectedRevision: 0 },
    ])
    const second = advanceBreedingCampaignClockIncubationBatch(
      request(continuation, 110),
      options(seeded.database),
    )
    expect(second.projection).toMatchObject({ hasMoreDueEggs: false })
    expect(second.projection.entries).toHaveLength(1)
    expect(eventCount(seeded.database)).toBe(404)
    expect(createSqlitePokemonEggRepository(seeded.database).listIncubatingBehindClock({
      revision: 2,
      campaignMinute: 110,
      limit: 1,
    })).toEqual([])
  })

  it('rolls back the parent clock before settlement, retains authority evidence, and requires explicit resume', () => {
    const seeded = seed([{ value: 6 }])
    const command = batchCommand(seeded.database, 104, 250)
    expect(() => advanceBreedingCampaignClockIncubationBatch(
      request(command, 100),
      options(seeded.database, { beforeParentSettle: () => { throw new Error('parent-batch-rollback') } }),
    )).toThrow('parent-batch-rollback')
    expect(createSqliteCampaignClockRepository(seeded.database).get()).toMatchObject({ revision: 1, campaignMinute: 100 })
    expect(createSqlitePokemonEggRepository(seeded.database).get(eggId(6))?.revision).toBe(0)
    expect(createSqliteBreedingOperationRepository(seeded.database).get(command.operationId)?.status).toBe('pending')
    expect(createSqliteBreedingOperationEvidenceRepository(seeded.database).get(command.operationId)).not.toBeNull()

    const pending = advanceBreedingCampaignClockIncubationBatch(request(command, 100), options(seeded.database))
    expect(pending.projection).toMatchObject({ parentStatus: 'pending', entries: [] })
    const resumed = advanceBreedingCampaignClockIncubationBatch(
      request(command, 100),
      options(seeded.database, { resumePending: true }),
    )
    expect(resumed.projection).toMatchObject({ parentStatus: 'accepted', entries: [{ status: 'accepted' }] })
  })

  it('recovers a durable child prefix without reprocessing earlier Eggs or duplicating refreshes', () => {
    const seeded = seed([{ value: 7 }, { value: 8 }])
    const command = batchCommand(seeded.database, 105, 250)
    expect(() => advanceBreedingCampaignClockIncubationBatch(
      request(command, 100),
      options(seeded.database, {
        beforeChildSettle: ({ index }: { readonly index: number }) => {
          if (index === 1) throw new Error('second-child-rollback')
        },
      }),
    )).toThrow('second-child-rollback')
    expect(createSqliteCampaignClockRepository(seeded.database).get()).toMatchObject({ revision: 2, campaignMinute: 250 })
    expect(createSqlitePokemonEggRepository(seeded.database).get(eggId(7))?.revision).toBe(1)
    expect(createSqlitePokemonEggRepository(seeded.database).get(eggId(8))?.revision).toBe(0)
    expect(eventCount(seeded.database)).toBe(4)
    const secondOperationId = deriveBreedingCampaignClockBatchChildOperationIdV1(command.operationId, eggId(8))
    expect(createSqliteBreedingOperationRepository(seeded.database).get(secondOperationId)?.status).toBe('pending')

    const currentRequest = request(command, 250)
    const pending = advanceBreedingCampaignClockIncubationBatch(currentRequest, options(seeded.database))
    expect(pending.projection.entries).toMatchObject([
      { eggId: eggId(7), executionKind: 'exact-retry', status: 'accepted' },
      { eggId: eggId(8), executionKind: 'pending', status: 'pending' },
    ])
    expect(eventCount(seeded.database)).toBe(4)
    const recovered = advanceBreedingCampaignClockIncubationBatch(
      currentRequest,
      options(seeded.database, { resumePending: true }),
    )
    expect(recovered.projection.entries).toMatchObject([
      { eggId: eggId(7), executionKind: 'exact-retry', status: 'accepted' },
      { eggId: eggId(8), status: 'accepted' },
    ])
    expect(eventCount(seeded.database)).toBe(8)
  })

  it('rejects omitted or stale discovered scopes, verifier faults, stale references, and enriched input before reservation', () => {
    const seeded = seed([{ value: 9 }, { value: 10 }])
    const command = batchCommand(seeded.database, 106, 250)
    const omitted = parseBreedingOperationCommandV1({
      ...command,
      operationId: op(107),
      scopes: command.scopes.slice(0, 2),
    })
    expect(() => advanceBreedingCampaignClockIncubationBatch(
      request(omitted, 100),
      options(seeded.database),
    )).toThrowError(expect.objectContaining({ code: 'breeding.clock-batch.scope-mismatch' }))
    expect(createSqliteBreedingOperationRepository(seeded.database).get(omitted.operationId)).toBeNull()

    expect(() => advanceBreedingCampaignClockIncubationBatch(
      request(command, 100),
      options(seeded.database, { validateCurrentGmAuthority: () => { throw new Error('verifier-fault') } }),
    )).toThrowError(expect.objectContaining({ code: 'breeding.clock-batch-use-case.invalid-authority' }))
    const staleReference = {
      ...authority.readSet.referenceVersions,
      semanticRegistryDefinitionSha256: 'f'.repeat(64),
    }
    expect(() => advanceBreedingCampaignClockIncubationBatch({
      ...request(command, 100),
      referenceVersions: staleReference,
    }, options(seeded.database))).toThrow()
    expect(() => advanceBreedingCampaignClockIncubationBatch({
      ...request(command, 100),
      mapId: 'forbidden',
    } as any, options(seeded.database))).toThrowError(expect.objectContaining({
      code: 'breeding.clock-batch-use-case.invalid-request',
    }))
    expect(createSqliteCampaignClockRepository(seeded.database).get().revision).toBe(1)
  })

  it('persists parent, child, segment, and exact replay across a file-database restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'breeding-clock-batch-'))
    tempRoots.push(directory)
    const path = join(directory, 'campaign.sqlite')
    const first = seed([{ value: 11 }], path)
    const command = batchCommand(first.database, 108, 250)
    const accepted = advanceBreedingCampaignClockIncubationBatch(request(command, 100), options(first.database))
    const childId = accepted.projection.entries[0]!.operationId
    close(first.database)

    const reopened = open(path)
    const replay = advanceBreedingCampaignClockIncubationBatch(request(command, 250), options(reopened))
    expect(replay.execution.kind).toBe('exact-retry')
    expect(replay.projection.entries[0]).toMatchObject({ operationId: childId, executionKind: 'exact-retry' })
    expect(createSqliteBreedingIncubationSegmentRepository(reopened).get(childId)).not.toBeNull()
    expect(eventCount(reopened)).toBe(4)
  })
})
