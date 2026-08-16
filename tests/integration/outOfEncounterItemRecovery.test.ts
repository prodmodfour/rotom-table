import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ItemOperationPlanV1, ItemPendingDecisionV1, UseItemCommandV1 } from '#shared/itemAutomation/operations'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqliteItemGuidedRequestRepository } from '../../server/storage/itemGuidedRequestRepository'

const directories: string[] = []
const databases: RotomDatabase[] = []
afterEach(() => {
  while (databases.length) databases.pop()!.close()
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true })
})
const openFile = (path: string): RotomDatabase => {
  const database = openRotomDatabase({ path, enableWal: false })
  databases.push(database)
  return database
}
const close = (database: RotomDatabase): void => {
  database.close()
  databases.splice(databases.indexOf(database), 1)
}

const command: UseItemCommandV1 = {
  schemaVersion: 1,
  operationId: 'out_of_encounter_restart_operation_0001',
  context: 'sheet',
  offerId: 'sheet-item-offer:restart',
  sourceInstanceId: 'item-instance:trainer:medic:medicalKit:bandages-row',
  actorParticipantId: 'sheet:trainer:medic',
  actorSheet: { kind: 'trainer', slug: 'medic', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'medic', section: 'medicalKit', rowId: 'bandages-row', expectedRevision: 3 },
  targetIds: ['sheet:pokemon:volt'],
  choices: [{ choiceId: 'target', optionIds: ['sheet:pokemon:volt'] }],
  readSet: [
    { kind: 'sheet', sheetKind: 'trainer', id: 'medic', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'volt', revision: 2 },
    { kind: 'campaign-clock', id: 'campaign', revision: 0 },
  ],
}
const pendingDecision: ItemPendingDecisionV1 = {
  schemaVersion: 1,
  operationId: command.operationId,
  decisionId: 'item-decision:restart-certification',
  canonicalItemId: 'Bandages',
  sourceInstanceId: command.sourceInstanceId,
  reservation: { reservationId: 'item-reservation:restart-certification', quantity: 1 },
  choices: [{
    choiceId: 'target', kind: 'participant', minimum: 1, maximum: 1,
    options: [{ optionId: 'sheet:pokemon:volt', label: 'Volt' }], privateTo: 'actor-owner',
  }],
}
const plan: ItemOperationPlanV1 = {
  schemaVersion: 1,
  operationId: command.operationId,
  canonicalItemId: 'Bandages',
  canonicalDefinitionSha256: 'a'.repeat(64),
  readSet: command.readSet,
  operations: [{
    operationId: 'inventory.reserve.restart', ordinal: 0, kind: 'inventory',
    aggregate: { kind: 'sheet', sheetKind: 'trainer', id: 'medic', revision: 3 },
    subjectId: 'bandages-row',
    payload: { action: 'consume', quantity: 1, sourceInstanceId: command.sourceInstanceId, reservationOnly: true },
    label: 'Reserve one Bandages',
  }],
  receiptFacts: [],
}
const guidedAuthority = {
  schemaVersion: 1 as const,
  sourceKind: 'equipped-re-breather' as const,
  actorLabel: 'Mira', targetLabel: 'Mira', timingLabel: 'Standard Action',
  prompt: 'Confirm activation.', canonicalFacts: ['One hour.'], settlementFacts: ['Activate Gilled.'],
  reservationLabel: 'Exact equipped Re-Breather reserved', boundaryLabel: 'No change before acceptance.',
  trainerSlug: 'mira', ownerKind: 'trainer' as const, ownerSlug: 'mira',
  sheetRevision: 4, equipmentRevision: 0,
  instanceId: 'equipped-item:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', instanceRevision: 0,
  campaignClockRevision: 0, campaignMinute: 0, offerId: 'offer-safe', actionKind: 'activate' as const,
}

describe('P8-060 out-of-encounter restart recovery', () => {
  it('reopens exact pending reservations and guided decisions, rejects drift, and releases without repair', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rotom-item-recovery-'))
    directories.push(directory)
    const path = join(directory, 'campaign.sqlite')
    const first = openFile(path)
    const items = createSqliteItemOperationRepository({ database: first, clock: () => 100 })
    const pending = items.createPending({
      command, canonicalItemId: 'Bandages', canonicalDefinitionSha256: 'a'.repeat(64), plan, pendingDecision,
    })
    const guided = createSqliteItemGuidedRequestRepository({ database: first, now: () => 100 })
    guided.create({
      requestId: 'item-guided:v1:11111111111111111111111111111111',
      requestKind: 're-breather-activation', canonicalItemId: 'Re-Breather',
      canonicalDefinitionSha256: 'b'.repeat(64), declarationPrincipalKey: 'profile_restart01',
      actorKind: 'trainer', actorSlug: 'mira', targetKind: 'trainer', targetSlug: 'mira', itemOperationId: null,
      declarationOperationId: 'item-guided-operation:v1:22222222222222222222222222222222',
      declarationCommand: {
        schemaVersion: 1, operationId: 'item-guided-operation:v1:22222222222222222222222222222222',
        action: 'declare-re-breather', ownerKind: 'trainer', ownerSlug: 'mira', ownerRevision: 4, offerId: 'offer-safe',
      },
      authority: guidedAuthority,
    })
    expect(items.reservedQuantity(command.sourceInstanceId)).toBe(1)
    close(first)

    const restarted = openFile(path)
    const restartedItems = createSqliteItemOperationRepository({ database: restarted, clock: () => 200 })
    const restartedGuided = createSqliteItemGuidedRequestRepository({ database: restarted, now: () => 200 })
    expect(restartedItems.get(command.operationId)).toEqual(pending)
    expect(restartedItems.reservedQuantity(command.sourceInstanceId)).toBe(1)
    expect(restartedGuided.listPending()).toEqual([
      expect.objectContaining({ requestId: 'item-guided:v1:11111111111111111111111111111111', revision: 0, status: 'pending' }),
    ])
    expect(() => restartedItems.createPending({
      command: { ...command, targetIds: ['sheet:pokemon:other'] },
      canonicalItemId: 'Bandages', canonicalDefinitionSha256: 'a'.repeat(64), plan, pendingDecision,
    })).toThrow('reused for a different command')

    restartedItems.complete({
      operationId: pending.operationId, commandSha256: pending.commandSha256, status: 'rejected',
      result: {
        schemaVersion: 1, operationId: pending.operationId, status: 'rejected', canonicalItemId: 'Bandages',
        reasonId: 'item.operation.cancelled', message: 'Cancelled without mechanics.', exactReplay: false,
      },
      updatedAt: 210,
    })
    const cancelled = restartedGuided.settle({
      requestId: 'item-guided:v1:11111111111111111111111111111111', expectedRevision: 0, status: 'cancelled',
      terminalPrincipalKey: 'profile_restart01',
      command: {
        schemaVersion: 1, operationId: 'item-guided-operation:v1:33333333333333333333333333333333',
        action: 'cancel', requestId: 'item-guided:v1:11111111111111111111111111111111', expectedRevision: 0,
      },
      outcomeOptionId: null,
      result: { schemaVersion: 1, status: 'cancelled', acceptedSummary: null }, updatedAt: 210,
    })
    expect(cancelled).toMatchObject({ kind: 'applied', record: { status: 'cancelled', revision: 1 } })
    expect(restartedItems.reservedQuantity(command.sourceInstanceId)).toBe(0)
    close(restarted)

    const secondRestart = openFile(path)
    expect(createSqliteItemOperationRepository({ database: secondRestart }).get(command.operationId))
      .toMatchObject({ status: 'rejected', result: { message: 'Cancelled without mechanics.' } })
    expect(createSqliteItemGuidedRequestRepository({ database: secondRestart }).get(
      'item-guided:v1:11111111111111111111111111111111',
    )).toMatchObject({ status: 'cancelled', revision: 1 })
  })
})
