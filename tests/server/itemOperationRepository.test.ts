import { describe, expect, it } from 'vitest'
import { openRotomDatabase } from '../../server/storage/database'
import {
  createSqliteItemOperationRepository,
  itemOperationCommandSha256,
} from '../../server/storage/itemOperationRepository'
import type {
  ItemOperationPlanV1,
  ItemPendingDecisionV1,
  UseItemCommandV1,
} from '#shared/itemAutomation/operations'
import type { ResumeItemOperationCommandV1 } from '#shared/itemAutomation/resume'

const command = (): UseItemCommandV1 => ({
  schemaVersion: 1,
  operationId: 'op_item_repository_0001',
  context: 'encounter',
  offerId: 'offer:item:potion',
  sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
  actorParticipantId: 'ash-placement',
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 3 },
  targetIds: ['pikachu-placement'],
  choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
  readSet: [
    { kind: 'map', id: 'arena', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
  ],
})

const pendingDecision = (): ItemPendingDecisionV1 => ({
  schemaVersion: 1,
  operationId: command().operationId,
  decisionId: 'item-decision:repository',
  canonicalItemId: 'Potion',
  sourceInstanceId: command().sourceInstanceId,
  reservation: { reservationId: 'item-reservation:repository', quantity: 1 },
  choices: [{
    choiceId: 'target', kind: 'participant', minimum: 1, maximum: 1,
    options: [{ optionId: 'pikachu-placement', label: 'Pikachu' }], privateTo: 'actor-owner',
  }],
})

const resumeCommand = (optionId = 'resumed-target'): ResumeItemOperationCommandV1 => ({
  schemaVersion: 1,
  operationId: command().operationId,
  decisionId: pendingDecision().decisionId,
  choices: [{ choiceId: 'target', optionIds: [optionId] }],
})

const plan = (): ItemOperationPlanV1 => ({
  schemaVersion: 1,
  operationId: 'op_item_repository_0001',
  canonicalItemId: 'Potion',
  canonicalDefinitionSha256: 'a'.repeat(64),
  readSet: command().readSet,
  operations: [{
    operationId: 'inventory.consume',
    ordinal: 0,
    kind: 'inventory',
    aggregate: { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    subjectId: 'potion-row',
    payload: { action: 'consume', quantity: 1 },
    label: 'Consume one Potion',
  }],
  receiptFacts: [{ factId: 'potion-used', audience: 'public', label: 'Potion was used.' }],
})

describe('SQLite item operation repository', () => {
  it('persists command evidence, ordered plans, revision scopes, and terminal results', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    const repository = createSqliteItemOperationRepository({ database, clock: () => 100 })
    const pending = repository.createPending({
      command: command(),
      canonicalItemId: 'Potion',
      canonicalDefinitionSha256: 'a'.repeat(64),
      plan: plan(),
    })
    expect(pending).toMatchObject({
      operationId: 'op_item_repository_0001',
      status: 'pending',
      canonicalItemId: 'Potion',
      createdAt: 100,
      updatedAt: 100,
      result: null,
    })
    expect(pending.scopes).toHaveLength(3)
    expect(pending.commandSha256).toBe(itemOperationCommandSha256(command()))
    expect(repository.listPending().map(row => row.operationId)).toEqual([pending.operationId])
    expect(repository.listForMap('arena').map(row => row.operationId)).toEqual([pending.operationId])
    expect(repository.listForMap('another-map')).toEqual([])
    expect(repository.reservedQuantity(command().sourceInstanceId)).toBe(0)

    const accepted = repository.complete({
      operationId: pending.operationId,
      commandSha256: pending.commandSha256,
      status: 'accepted',
      result: {
        schemaVersion: 1,
        operationId: pending.operationId,
        status: 'accepted',
        canonicalItemId: 'Potion',
        aggregateRefs: command().readSet,
        receiptId: 'item-receipt:potion-use',
        exactReplay: false,
      },
      updatedAt: 110,
    })
    expect(accepted.status).toBe('accepted')
    expect(accepted.result).toMatchObject({ status: 'accepted', exactReplay: false })
    expect(repository.get(pending.operationId)).toEqual(accepted)
    expect(repository.listForMap('arena')).toEqual([accepted])
  })

  it('persists immutable rolled-healing evidence without rerolling on repository replay', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    const repository = createSqliteItemOperationRepository({ database, clock: () => 100 })
    const rolledPlan = structuredClone(plan())
    rolledPlan.operations.push({
      operationId: 'target.rolled-healing', ordinal: 1, kind: 'hp',
      aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
      subjectId: 'pikachu-placement',
      payload: {
        action: 'heal', calculationKind: 'rolled', currentHp: 7,
        fullFormulaMaximumHp: 42, effectiveMaximumHp: 42, injuries: 0,
        requestedHealing: 13, effectiveHealing: 13, overheal: 0, resultingHp: 20,
        roll: { expression: '2d6+3', rolls: [4, 6], modifier: 3, total: 13 },
        cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve',
      },
      label: 'Resolve rolled healing once',
    })
    const first = repository.createPending({
      command: command(), canonicalItemId: 'Potion', canonicalDefinitionSha256: 'a'.repeat(64), plan: rolledPlan,
    })
    const replay = repository.createPending({
      command: command(), canonicalItemId: 'Potion', canonicalDefinitionSha256: 'a'.repeat(64), plan: rolledPlan,
    })
    expect(first.plan?.operations[1]?.payload.roll).toEqual({
      expression: '2d6+3', rolls: [4, 6], modifier: 3, total: 13,
    })
    expect(replay).toEqual(first)
  })

  it('sums durable source reservations from pending plans only', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    const repository = createSqliteItemOperationRepository({ database, clock: () => 100 })
    const reservedPlan = structuredClone(plan())
    reservedPlan.operations[0]!.payload = {
      action: 'consume', quantity: 1, sourceInstanceId: command().sourceInstanceId,
    }
    repository.createPending({
      command: command(), canonicalItemId: 'Potion', canonicalDefinitionSha256: 'a'.repeat(64), plan: reservedPlan,
    })
    expect(repository.reservedQuantity(command().sourceInstanceId)).toBe(1)
    expect(repository.reservedQuantity(command().sourceInstanceId, command().operationId)).toBe(0)
  })

  it('persists and atomically replaces exact pending-choice authority on resume', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    const repository = createSqliteItemOperationRepository({ database, clock: () => 100 })
    const pending = repository.createPending({
      command: command(), canonicalItemId: 'Potion', canonicalDefinitionSha256: 'a'.repeat(64),
      plan: plan(), pendingDecision: pendingDecision(),
    })
    expect(pending.pendingDecision).toEqual(pendingDecision())
    const resumed = structuredClone(command())
    resumed.targetIds = ['resumed-target']
    resumed.choices = [{ choiceId: 'target', optionIds: ['resumed-target'] }]
    const replacement = {
      operationId: pending.operationId,
      expectedCommandSha256: pending.commandSha256,
      command: resumed,
      resumeCommand: resumeCommand(),
      plan: { ...plan(), readSet: resumed.readSet },
      updatedAt: 110,
    }
    const replaced = repository.replacePendingCommand(replacement)
    expect(replaced.pendingDecision).toEqual(pendingDecision())
    expect(replaced.command).toEqual(command())
    expect(replaced.commandSha256).toBe(pending.commandSha256)
    expect(replaced.resumeCommand).toEqual(resumeCommand())
    expect(repository.replacePendingCommand(replacement)).toEqual(replaced)
    expect(() => repository.replacePendingCommand({
      ...replacement,
      resumeCommand: resumeCommand('different-target'),
    })).toThrow('different choices')
  })

  it('returns the existing operation for the same command and rejects operation-ID reuse', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    const repository = createSqliteItemOperationRepository({ database, clock: () => 100 })
    const first = repository.createPending({
      command: command(), canonicalItemId: 'Potion', canonicalDefinitionSha256: 'a'.repeat(64), plan: plan(),
    })
    expect(repository.createPending({
      command: command(), canonicalItemId: 'Potion', canonicalDefinitionSha256: 'a'.repeat(64), plan: plan(),
    })).toEqual(first)

    const changed = structuredClone(command())
    changed.targetIds = ['another-target']
    expect(() => repository.createPending({
      command: changed,
      canonicalItemId: 'Potion',
      canonicalDefinitionSha256: 'a'.repeat(64),
      plan: { ...plan(), readSet: changed.readSet },
    })).toThrow('reused for a different command')
  })

  it('returns the exact terminal row for repeated completion and rejects divergent replay', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    const repository = createSqliteItemOperationRepository({ database, clock: () => 100 })
    const pending = repository.createPending({
      command: command(), canonicalItemId: 'Potion', canonicalDefinitionSha256: 'a'.repeat(64), plan: plan(),
    })
    const completion = {
      operationId: pending.operationId,
      commandSha256: pending.commandSha256,
      status: 'rejected' as const,
      result: {
        schemaVersion: 1 as const,
        operationId: pending.operationId,
        status: 'rejected' as const,
        canonicalItemId: 'Potion',
        reasonId: 'item.target.invalid',
        message: 'The target is no longer eligible.',
        exactReplay: false,
      },
      updatedAt: 110,
    }
    const first = repository.complete(completion)
    expect(repository.complete(completion)).toEqual(first)
    expect(() => repository.complete({
      ...completion,
      result: { ...completion.result, message: 'Different terminal result.' },
    })).toThrow('different terminal result')
  })
})
