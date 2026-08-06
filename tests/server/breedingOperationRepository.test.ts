import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import ledgerContractJson from '../../data/breeding-automation/campaign-operation-ledger-contract.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import {
  parseBreedingOperationCommandV1,
  type BreedingConflictScopeV1,
  type BreedingOperationCommandV1,
} from '../../shared/breeding/operations'
import {
  BreedingOperationIdCollisionError,
  BreedingOperationResultConflictError,
  createBreedingOperationAcceptedV1,
  createBreedingOperationCommandHash,
  createBreedingOperationRejectedV1,
} from '../../server/domain/breeding/operations'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import {
  BreedingOperationRepositoryTransactionError,
  createSqliteBreedingOperationRepository,
} from '../../server/storage/breedingOperationRepository'
import { BreedingRepositoryCorruptionError } from '../../server/storage/breedingRepositorySupport'
import { executeCampaignOperation } from '../../server/useCases/executeCampaignOperation'

const databases: RotomDatabase[] = []
const tempRoots: string[] = []
const open = (path = ':memory:'): RotomDatabase => { const database = openRotomDatabase({ path, enableWal: path !== ':memory:' }); databases.push(database); return database }
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true })
})
const op = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const project = (value: number): string => `breeding-project:v1:${value.toString(16).padStart(32, '0')}`
const ruleset = rulesetJson as Record<string, any>
const previewCommand = (value = 1, parentRevision = 2): BreedingOperationCommandV1 => parseBreedingOperationCommandV1({
  schemaVersion: 1, operationId: op(value), commandKind: 'preview-breeding',
  actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
  ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 }, scopes: [],
  payload: {
    ownerTrainerSlug: 'trainer-owner', breederTrainerSlug: 'trainer-breeder',
    parentRefs: [
      { pokemonSheetSlug: 'parent-a', expectedSheetRevision: parentRevision },
      { pokemonSheetSlug: 'parent-b', expectedSheetRevision: 3 },
    ],
    optionSnapshotDefinitionSha256: 'a'.repeat(64),
  },
})
const projectCommand = (value = 10): BreedingOperationCommandV1 => {
  const projectId = project(value)
  return parseBreedingOperationCommandV1({
    schemaVersion: 1, operationId: op(value), commandKind: 'create-breeding-project',
    actor: { profileId: 'campaign-gm', selectedTrainerSlug: null },
    ruleset: { rulesetId: ruleset.rulesetId, definitionSha256: ruleset.definitionSha256 },
    scopes: [{ kind: 'breeding-project', projectId, expectedRevision: null }],
    payload: {
      projectId, ownerTrainerSlug: 'trainer-owner', breederTrainerSlug: 'trainer-breeder',
      parentRefs: [
        { pokemonSheetSlug: 'parent-a', expectedSheetRevision: 2 },
        { pokemonSheetSlug: 'parent-b', expectedSheetRevision: 3 },
      ],
      optionSnapshotDefinitionSha256: 'a'.repeat(64), consentPolicy: 'same-owner-control',
    },
  })
}
const accepted = (command: BreedingOperationCommandV1, settledAt = 101) => createBreedingOperationAcceptedV1({
  operationId: command.operationId, commandHash: createBreedingOperationCommandHash(command), commandKind: command.commandKind,
  outcomeKind: command.commandKind === 'preview-breeding' ? 'previewed' : 'project-created',
  aggregateRefs: command.commandKind === 'preview-breeding' ? [] : [{ kind: 'breeding-project', id: (command.payload as any).projectId, revision: 0 }],
  changedScopes: command.commandKind === 'preview-breeding' ? [] : command.scopes,
  committedAtCampaignMinute: command.commandKind === 'preview-breeding' ? null : settledAt,
} as any)
const rejected = (command: BreedingOperationCommandV1) => createBreedingOperationRejectedV1({
  operationId: command.operationId, commandHash: createBreedingOperationCommandHash(command), commandKind: command.commandKind,
  reasonId: 'breeding.operation.unavailable', currentAggregateRefs: [], conflictingScopes: [],
})

describe('durable generic campaign-operation integration', () => {
  it('binds the reviewed two-phase generic operation ledger contract', () => {
    const policy = ledgerContractJson as Record<string, any>
    expect(policy.definitionSha256).toBe(createHash('sha256').update(stableJsonStringify(policy.definition)).digest('hex'))
    expect(policy.definition.reservation).toMatchObject({ phase: 1, durableBeforeMechanicsAtTopLevel: true, sameOperationSameCommandPending: 'return-pending-without-execution' })
    expect(policy.definition.execution).toMatchObject({ phase: 2, exactRetryExecutesMechanics: false, aggregateWritesAndSettlement: 'same-caller-owned-SQLite-transaction-and-savepoint' })
    expect(policy.definition.settlement).toMatchObject({ transition: 'pending-to-exactly-one-terminal-status', terminalExactReplay: 'exact-stable-json-only' })
    expect(policy.definition.authority).toMatchObject({ mapExecutorDependency: 'none', encounterDependency: 'none', realtime: 'post-commit-refresh-only' })
  })

  it('reserves, executes, terminally settles, and exact-replays without rerunning mechanics', () => {
    const database = open(); const repository = createSqliteBreedingOperationRepository(database); const command = previewCommand()
    let calls = 0
    const first = executeCampaignOperation({
      repository, command, createdAtCampaignMinute: 100, settledAtCampaignMinute: 101,
      execute: canonical => { calls += 1; return accepted(canonical) },
    })
    const retry = executeCampaignOperation({
      repository, command, createdAtCampaignMinute: 999, settledAtCampaignMinute: 999,
      execute: canonical => { calls += 1; return accepted(canonical) },
    })
    expect(first).toMatchObject({ kind: 'executed', record: { status: 'accepted', createdAtCampaignMinute: 100, settledAtCampaignMinute: 101 } })
    expect(retry).toEqual({ kind: 'exact-retry', record: first.record })
    expect(calls).toBe(1)
    expect(repository.get(command.operationId)).toEqual(first.record)
  })

  it('fails closed on operation-ID command collisions before mechanics', () => {
    const database = open(); const repository = createSqliteBreedingOperationRepository(database); const original = previewCommand(2); let calls = 0
    executeCampaignOperation({ repository, command: original, createdAtCampaignMinute: 100, settledAtCampaignMinute: 101, execute: canonical => accepted(canonical) })
    expect(() => executeCampaignOperation({
      repository, command: previewCommand(2, 9), createdAtCampaignMinute: 102, settledAtCampaignMinute: 103,
      execute: canonical => { calls += 1; return accepted(canonical) },
    })).toThrow(BreedingOperationIdCollisionError)
    expect(calls).toBe(0)
  })

  it('returns pending to ordinary duplicates and executes it only through explicit resume', () => {
    const database = open(); const repository = createSqliteBreedingOperationRepository(database); const command = previewCommand(3)
    database.withTransaction(() => expect(repository.reserve(command, 100).kind).toBe('reserved'))
    let calls = 0
    expect(executeCampaignOperation({ repository, command, createdAtCampaignMinute: 100, settledAtCampaignMinute: 101, execute: canonical => { calls += 1; return accepted(canonical) } })).toMatchObject({ kind: 'pending' })
    expect(calls).toBe(0)
    expect(executeCampaignOperation({ repository, command, createdAtCampaignMinute: 100, settledAtCampaignMinute: 101, resumePending: true, execute: canonical => { calls += 1; return accepted(canonical) } })).toMatchObject({ kind: 'executed', record: { status: 'accepted' } })
    expect(calls).toBe(1)
  })

  it('rolls aggregate effects back while retaining durable pending evidence, then resumes atomically', () => {
    const database = open(); database.connection.exec('CREATE TABLE operation_test_effects (id TEXT PRIMARY KEY)')
    const repository = createSqliteBreedingOperationRepository(database); const command = previewCommand(4)
    expect(() => executeCampaignOperation({
      repository, command, createdAtCampaignMinute: 100, settledAtCampaignMinute: 101,
      execute: canonical => { database.connection.prepare("INSERT INTO operation_test_effects (id) VALUES ('effect')").run(); return accepted(canonical) },
      beforeSettle: () => { throw new Error('injected before settlement') },
    })).toThrow('injected before settlement')
    expect(database.connection.prepare('SELECT id FROM operation_test_effects').all()).toEqual([])
    expect(repository.get(command.operationId)).toMatchObject({ status: 'pending', result: null })
    const resumed = executeCampaignOperation({
      repository, command, createdAtCampaignMinute: 100, settledAtCampaignMinute: 102, resumePending: true,
      execute: canonical => { database.connection.prepare("INSERT INTO operation_test_effects (id) VALUES ('effect')").run(); return accepted(canonical) },
    })
    expect(resumed).toMatchObject({ kind: 'executed', record: { status: 'accepted', settledAtCampaignMinute: 102 } })
    expect(database.connection.prepare('SELECT id FROM operation_test_effects').all()).toEqual([{ id: 'effect' }])
  })

  it('persists canonical scopes, finds accepted overlap, and forbids changing a terminal result', () => {
    const database = open(); const repository = createSqliteBreedingOperationRepository(database); const command = projectCommand()
    const terminal = executeCampaignOperation({ repository, command, createdAtCampaignMinute: 100, settledAtCampaignMinute: 105, execute: canonical => accepted(canonical, 105) })
    expect(terminal.record.scopes).toEqual(command.scopes)
    expect(repository.listAcceptedForScopes({ scopes: command.scopes as readonly BreedingConflictScopeV1[], minimumSettledAtCampaignMinute: 105 })).toEqual([terminal.record])
    expect(repository.listAcceptedForScopes({ scopes: command.scopes as readonly BreedingConflictScopeV1[], minimumSettledAtCampaignMinute: 106 })).toEqual([])
    expect(() => database.withTransaction(() => repository.settle(command, rejected(command), 106))).toThrow(BreedingOperationResultConflictError)
  })

  it('enforces caller-owned writes and detects stored command/scope corruption without exposing payloads', () => {
    const database = open(); const repository = createSqliteBreedingOperationRepository(database); const command = projectCommand(11)
    expect(() => repository.reserve(command, 100)).toThrow(BreedingOperationRepositoryTransactionError)
    database.withTransaction(() => repository.reserve(command, 100))
    database.connection.prepare(`UPDATE breeding_operation_scopes SET scope_kind = 'pokemon-egg' WHERE operation_id = ?`).run(command.operationId)
    expect(() => repository.get(command.operationId)).toThrowError(expect.objectContaining({ name: 'BreedingRepositoryCorruptionError', table: 'breeding_operation_scopes' }))
    expect(() => repository.get(command.operationId)).toThrow(BreedingRepositoryCorruptionError)
  })

  it('retains pending commands across restart and bounds recovery listings', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-operation-ledger-')); tempRoots.push(root); const path = join(root, 'campaign.sqlite')
    let database = open(path); let repository = createSqliteBreedingOperationRepository(database); const command = previewCommand(12)
    database.withTransaction(() => repository.reserve(command, 100))
    database.close(); databases.splice(databases.indexOf(database), 1)
    database = open(path); repository = createSqliteBreedingOperationRepository(database)
    expect(repository.listPending()).toEqual([repository.get(command.operationId)])
    expect(executeCampaignOperation({ repository, command, createdAtCampaignMinute: 100, settledAtCampaignMinute: 101, resumePending: true, execute: canonical => rejected(canonical) })).toMatchObject({ kind: 'executed', record: { status: 'rejected' } })
    expect(repository.listPending()).toEqual([])
  })
})
