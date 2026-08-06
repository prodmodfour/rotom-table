import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import clockContractJson from '../../data/breeding-automation/campaign-clock-contract.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { parseBreedingOperationCommandV1, type BreedingOperationCommandV1 } from '../../shared/breeding/operations'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteBreedingOperationRepository } from '../../server/storage/breedingOperationRepository'
import {
  CampaignClockRepositoryTransactionError,
  createSqliteCampaignClockRepository,
} from '../../server/storage/campaignClockRepository'
import { BreedingRepositoryCorruptionError } from '../../server/storage/breedingRepositorySupport'
import {
  CampaignClockCommandError,
  advanceBreedingCampaignClock,
} from '../../server/useCases/advanceBreedingCampaignClock'

const databases: RotomDatabase[] = []
const tempRoots: string[] = []
const open = (path = ':memory:'): RotomDatabase => { const database = openRotomDatabase({ path, enableWal: path !== ':memory:' }); databases.push(database); return database }
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true })
})
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const projectId = (value: number): string => `breeding-project:v1:${value.toString(16).padStart(32, '0')}`
const ruleset = rulesetJson as Record<string, any>
const command = (value: number, expectedRevision: number, targetCampaignMinute: number, overrides: Record<string, unknown> = {}): BreedingOperationCommandV1 => parseBreedingOperationCommandV1({
  schemaVersion: 1, operationId: operationId(value), commandKind: 'advance-campaign-clock',
  actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
  scopes: [{ kind: 'campaign-clock', expectedRevision }], payload: { targetCampaignMinute },
  ...overrides,
})

describe('authoritative campaign clock', () => {
  it('binds the reviewed campaign-time-only contract and strict genesis aggregate', () => {
    const policy = clockContractJson as Record<string, any>
    expect(policy.definitionSha256).toBe(createHash('sha256').update(stableJsonStringify(policy.definition)).digest('hex'))
    expect(policy.definition.timeAuthority).toMatchObject({ lifecycleClock: 'campaignMinute-only', browserClock: 'forbidden', mapSceneEncounterInitiative: 'no-authority' })
    expect(policy.definition.advance).toMatchObject({ expectedRevision: 'required-current', forwardTarget: 'revision-plus-one-and-strictly-later-minute', equalTarget: 'accepted-no-op-no-clock-revision' })
    expect(policy.definition.idempotency).toMatchObject({ exactRetry: 'stored-terminal-result-no-clock-write', acceptedMutationAndTerminalResult: 'one-SQLite-transaction-and-savepoint' })
    const clock = createSqliteCampaignClockRepository(open()).get()
    expect(clock).toEqual({ schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null })
    expect(Object.isFrozen(clock)).toBe(true)
  })

  it('advances strictly forward once and returns the stored terminal result on exact retry', () => {
    const database = open(); const clock = createSqliteCampaignClockRepository(database); const operation = createSqliteBreedingOperationRepository(database); const advance = command(1, 0, 100)
    const first = advanceBreedingCampaignClock(advance, { database, clockRepository: clock, operationRepository: operation })
    const retry = advanceBreedingCampaignClock(advance, { database, clockRepository: clock, operationRepository: operation })
    expect(first).toMatchObject({ kind: 'executed', record: { status: 'accepted', createdAtCampaignMinute: 0, settledAtCampaignMinute: 100, result: { ok: true, outcomeKind: 'clock-advanced', aggregateRefs: [{ kind: 'campaign-clock', id: 'campaign-clock', revision: 1 }], changedScopes: advance.scopes, committedAtCampaignMinute: 100 } } })
    expect(retry).toEqual({ kind: 'exact-retry', record: first.record })
    expect(clock.get()).toEqual({ schemaVersion: 1, revision: 1, campaignMinute: 100, lastOperationId: advance.operationId })
  })

  it('accepts an equal target as an auditable no-op without changing clock revision or last operation', () => {
    const database = open(); const clock = createSqliteCampaignClockRepository(database)
    const first = command(2, 0, 100); advanceBreedingCampaignClock(first, { database, clockRepository: clock })
    const noOp = command(3, 1, 100); const result = advanceBreedingCampaignClock(noOp, { database, clockRepository: clock })
    expect(result).toMatchObject({ kind: 'executed', record: { status: 'accepted', settledAtCampaignMinute: 100, result: { changedScopes: [], aggregateRefs: [{ revision: 1 }], committedAtCampaignMinute: 100 } } })
    expect(clock.get()).toEqual({ schemaVersion: 1, revision: 1, campaignMinute: 100, lastOperationId: first.operationId })
  })

  it('terminally rejects stale revisions and backwards targets without mutating time', () => {
    const database = open(); const clock = createSqliteCampaignClockRepository(database)
    advanceBreedingCampaignClock(command(4, 0, 100), { database, clockRepository: clock })
    const stale = advanceBreedingCampaignClock(command(5, 0, 200), { database, clockRepository: clock })
    const backwardsCommand = command(6, 1, 90)
    const backwards = advanceBreedingCampaignClock(backwardsCommand, { database, clockRepository: clock })
    expect(stale).toMatchObject({ kind: 'executed', record: { status: 'rejected', settledAtCampaignMinute: 100, result: { reasonId: 'breeding.operation.stale-revision', retryable: true, currentAggregateRefs: [{ revision: 1 }] } } })
    expect(backwards).toMatchObject({ kind: 'executed', record: { status: 'rejected', result: { reasonId: 'breeding.operation.stale-revision' } } })
    expect(advanceBreedingCampaignClock(backwardsCommand, { database, clockRepository: clock })).toEqual({ kind: 'exact-retry', record: backwards.record })
    expect(clock.get()).toMatchObject({ revision: 1, campaignMinute: 100 })
  })

  it('serializes competing expected revisions so only the first operation advances', () => {
    const database = open(); const clock = createSqliteCampaignClockRepository(database)
    const first = advanceBreedingCampaignClock(command(7, 0, 60), { database, clockRepository: clock })
    const second = advanceBreedingCampaignClock(command(8, 0, 120), { database, clockRepository: clock })
    expect(first.record.status).toBe('accepted')
    expect(second).toMatchObject({ record: { status: 'rejected', result: { reasonId: 'breeding.operation.stale-revision' } } })
    expect(clock.get()).toMatchObject({ revision: 1, campaignMinute: 60, lastOperationId: operationId(7) })
  })

  it('rolls back clock mutation before terminal settlement, retains pending evidence, and explicitly resumes', () => {
    const database = open(); const clock = createSqliteCampaignClockRepository(database); const operations = createSqliteBreedingOperationRepository(database); const pending = command(9, 0, 240)
    expect(() => advanceBreedingCampaignClock(pending, { database, clockRepository: clock, operationRepository: operations, beforeSettle: () => { throw new Error('injected clock failure') } })).toThrow('injected clock failure')
    expect(clock.get()).toEqual({ schemaVersion: 1, revision: 0, campaignMinute: 0, lastOperationId: null })
    expect(operations.get(pending.operationId)).toMatchObject({ status: 'pending', result: null })
    expect(advanceBreedingCampaignClock(pending, { database, clockRepository: clock, operationRepository: operations })).toMatchObject({ kind: 'pending' })
    expect(advanceBreedingCampaignClock(pending, { database, clockRepository: clock, operationRepository: operations, resumePending: true })).toMatchObject({ kind: 'executed', record: { status: 'accepted' } })
    expect(clock.get()).toMatchObject({ revision: 1, campaignMinute: 240 })
  })

  it('rejects stale rulesets and unsupported dependent scopes before reservation', () => {
    const database = open(); const operations = createSqliteBreedingOperationRepository(database)
    const staleRuleset = command(10, 0, 10, { ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: 'f'.repeat(64) } })
    const withDependent = command(11, 0, 10, { scopes: [
      { kind: 'campaign-clock', expectedRevision: 0 },
      { kind: 'breeding-project', projectId: projectId(1), expectedRevision: 0 },
    ] })
    expect(() => advanceBreedingCampaignClock(staleRuleset, { database, operationRepository: operations })).toThrowError(expect.objectContaining({ code: 'campaign-clock.stale-ruleset' }))
    expect(() => advanceBreedingCampaignClock(withDependent, { database, operationRepository: operations })).toThrow(CampaignClockCommandError)
    expect(operations.get(staleRuleset.operationId)).toBeNull()
    expect(operations.get(withDependent.operationId)).toBeNull()
  })

  it('enforces caller-owned repository writes, detects corruption, and persists across restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-campaign-clock-')); tempRoots.push(root); const path = join(root, 'campaign.sqlite')
    let database = open(path); let clock = createSqliteCampaignClockRepository(database)
    expect(() => clock.advance({ expectedRevision: 0, targetCampaignMinute: 1, operationId: operationId(12) })).toThrow(CampaignClockRepositoryTransactionError)
    advanceBreedingCampaignClock(command(12, 0, 1_440), { database, clockRepository: clock })
    database.close(); databases.splice(databases.indexOf(database), 1)
    database = open(path); clock = createSqliteCampaignClockRepository(database)
    expect(clock.get()).toMatchObject({ revision: 1, campaignMinute: 1_440, lastOperationId: operationId(12) })
    database.connection.exec('PRAGMA ignore_check_constraints = ON')
    database.connection.prepare('UPDATE campaign_clock SET revision = 0 WHERE singleton = 1').run()
    expect(() => clock.get()).toThrow(BreedingRepositoryCorruptionError)
  })
})
