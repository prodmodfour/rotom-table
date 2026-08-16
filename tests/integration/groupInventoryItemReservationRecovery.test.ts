import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { ItemOperationPlanV1, ItemPendingDecisionV1, UseItemCommandV1 } from '#shared/itemAutomation/operations'
import { sheetItemTargetId } from '#shared/itemAutomation/sheetActions'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteGroupInventoryRepository } from '../../server/storage/groupInventoryRepository'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { loadGroupInventoryItemActionsUseCase } from '../../server/useCases/loadGroupInventoryItemActions'
import { recoverItemOperationUseCase } from '../../server/useCases/recoverItemOperation'
import { transferGroupInventoryToTrainerUseCase } from '../../server/useCases/transferGroupInventoryToTrainer'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { createDefaultGroupInventoryDocument } from '~/types/groupInventory'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const directories: string[] = []
const databases: RotomDatabase[] = []
afterEach(() => {
  while (databases.length) databases.pop()!.close()
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true })
})
const open = (path: string): RotomDatabase => {
  const database = openRotomDatabase({ path, enableWal: false })
  databases.push(database)
  return database
}
const close = (database: RotomDatabase): void => {
  database.close()
  databases.splice(databases.indexOf(database), 1)
}
const profile: PlayerProfile = {
  schemaVersion: 1, id: 'profile_group_recovery_01', displayName: 'Player',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
}
const sourceInstanceId = 'item-instance:group:main:medicalKit:shared-potion'
const targetId = sheetItemTargetId('pokemon', 'pikachu')
const command: UseItemCommandV1 = {
  schemaVersion: 1,
  operationId: 'group-sheet-item:v1:44444444444444444444444444444444',
  context: 'sheet', offerId: 'offer:group-restart-reservation', sourceInstanceId,
  actorParticipantId: null,
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'group', slug: 'main', section: 'medicalKit', rowId: 'shared-potion', expectedRevision: 4 },
  targetIds: [targetId], choices: [{ choiceId: 'target', optionIds: [targetId] }],
  readSet: [
    { kind: 'campaign-clock', id: 'campaign', revision: 0 },
    { kind: 'group-inventory', id: 'main', revision: 4 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
  ],
}
const decision: ItemPendingDecisionV1 = {
  schemaVersion: 1, operationId: command.operationId,
  decisionId: 'item-decision:group-restart', canonicalItemId: 'Potion', sourceInstanceId,
  reservation: { reservationId: 'item-reservation:group-restart', quantity: 1 },
  choices: [{
    choiceId: 'target', kind: 'participant', minimum: 1, maximum: 1,
    options: [{ optionId: targetId, label: 'Pikachu' }], privateTo: 'actor-owner',
  }],
}
const plan = (): ItemOperationPlanV1 => {
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Potion')
  return {
    schemaVersion: 1, operationId: command.operationId, canonicalItemId: 'Potion',
    canonicalDefinitionSha256: definition.definitionSha256, readSet: command.readSet,
    operations: [{
      operationId: 'inventory.reserve.group-restart', ordinal: 0, kind: 'inventory',
      aggregate: { kind: 'group-inventory', id: 'main', revision: 4 }, subjectId: 'shared-potion',
      payload: { action: 'consume', quantity: 1, sourceInstanceId, reservationOnly: true },
      label: 'Reserve one shared Potion',
    }],
    receiptFacts: [],
  }
}
const seed = (database: RotomDatabase): void => {
  const trainer: TrainerSheet = {
    slug: 'ash', name: 'Ash', level: 10, revision: 3, currentTeam: ['pikachu'], inventory: {},
  }
  const pokemon: CharacterSheet = {
    slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', level: 5, revision: 2,
    stats: { hp: { added: 0 } }, combat: { currentHp: 7 },
  }
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({ kind: 'trainer', slug: 'ash', revision: 3, updatedAt: 100, document: trainer as unknown as Record<string, unknown> })
  sheets.save({ kind: 'pokemon', slug: 'pikachu', revision: 2, updatedAt: 100, document: pokemon as unknown as Record<string, unknown> })
  const group = createDefaultGroupInventoryDocument({ slug: 'main', now: 100 })
  group.revision = 4
  group.inventory.medicalKit = [{ id: 'shared-potion', name: 'Potion', qty: 2 }]
  createSqliteGroupInventoryRepository(database).save({ slug: 'main', revision: 4, updatedAt: 100, document: group })
}

describe('group inventory item reservation restart recovery', () => {
  it('persists exact reservation, blocks transfer after restart, releases through authenticated recovery, and never needs storage repair', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rotom-group-item-recovery-'))
    directories.push(directory)
    const path = join(directory, 'campaign.sqlite')
    const first = open(path)
    seed(first)
    const firstOperations = createSqliteItemOperationRepository({ database: first, clock: () => 110 })
    const stored = firstOperations.createPending({
      command, canonicalItemId: 'Potion',
      canonicalDefinitionSha256: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Potion').definitionSha256,
      plan: plan(), pendingDecision: decision,
    })
    expect(firstOperations.reservedQuantity(sourceInstanceId)).toBe(1)
    close(first)

    const restarted = open(path)
    const restartedOperations = createSqliteItemOperationRepository({ database: restarted, clock: () => 200 })
    expect(restartedOperations.get(command.operationId)).toEqual(stored)
    expect(restartedOperations.reservedQuantity(sourceInstanceId)).toBe(1)
    expect(loadGroupInventoryItemActionsUseCase({
      role: 'player', playerProfile: profile, groupSlug: 'main',
    }, { database: restarted, now: () => 200 }).offers[0]?.source.quantity).toBe(1)
    const currentTrainerRevision = createSqliteSheetRepository<Record<string, unknown>>(restarted)
      .getByRef('trainer', 'ash')!.revision
    expect(() => transferGroupInventoryToTrainerUseCase({
      role: 'player', playerProfile: profile,
      groupSlug: 'main', groupRevision: 4, trainerSlug: 'ash', trainerRevision: currentTrainerRevision,
      section: 'medicalKit', itemId: 'shared-potion', quantity: 2,
    }, { database: restarted, now: () => 201 })).toThrow('not have enough unreserved quantity')

    const recoveryCommand = {
      schemaVersion: 1, operationId: command.operationId, action: 'abandon',
      reason: 'The table cancelled this unresolved shared item use.',
    }
    const recovered = recoverItemOperationUseCase({
      role: 'player', playerProfile: profile, command: recoveryCommand,
    }, { database: restarted, now: () => 202 })
    expect(recovered.result).toMatchObject({
      status: 'abandoned', inventoryDisposition: 'reservation-released', exactReplay: false,
    })
    expect(restartedOperations.reservedQuantity(sourceInstanceId)).toBe(0)
    const replay = recoverItemOperationUseCase({
      role: 'player', playerProfile: profile, command: recoveryCommand,
    }, { database: restarted, now: () => 203 })
    expect(replay.result).toMatchObject({ status: 'abandoned', exactReplay: true })

    const transferred = transferGroupInventoryToTrainerUseCase({
      role: 'player', playerProfile: profile,
      groupSlug: 'main', groupRevision: 4, trainerSlug: 'ash', trainerRevision: currentTrainerRevision,
      section: 'medicalKit', itemId: 'shared-potion', quantity: 2,
    }, { database: restarted, now: () => 204 })
    expect(transferred.groupInventory.inventory.medicalKit).toEqual([])
    expect((transferred.trainerSheet.sheet as unknown as TrainerSheet).inventory?.medicalKit?.[0]?.qty).toBe(2)
  })
})
