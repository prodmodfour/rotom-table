import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { InventoryActionOfferV1 } from '#shared/itemAutomation/inventoryActions'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteGroupInventoryRepository } from '../../server/storage/groupInventoryRepository'
import { createSqliteInventoryActionOperationRepository } from '../../server/storage/inventoryActionOperationRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { executeGroupInventoryActionUseCase } from '../../server/useCases/executeGroupInventoryAction'
import { executeInventoryStackOperationUseCase } from '../../server/useCases/executeInventoryStackOperation'
import { executeTrainerInventoryActionUseCase } from '../../server/useCases/executeTrainerInventoryAction'
import { loadGroupInventoryActionsUseCase } from '../../server/useCases/loadGroupInventoryActions'
import { loadTrainerInventoryActionsUseCase } from '../../server/useCases/loadTrainerInventoryActions'

const databases: RotomDatabase[] = []
const temporaryRoots: string[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length) databases.pop()!.close()
  while (temporaryRoots.length) rmSync(temporaryRoots.pop()!, { recursive: true, force: true })
})

const serializedEquipment = {
  schemaVersion: 1 as const,
  instanceId: `equipped-item:v1:${'1'.repeat(32)}`,
  revision: 2,
  canonicalItemId: 'Light Armor',
  canonicalRecordSha256: 'b'.repeat(64),
  equipmentDefinitionSha256: 'c'.repeat(64),
  configuration: null,
  activity: { status: 'active' as const, reasons: [] },
  state: { durability: 5 },
}

const seed = (database: RotomDatabase): void => {
  createSqliteSheetRepository<Record<string, unknown>>(database).save({
    kind: 'trainer',
    slug: 'ash',
    revision: 3,
    updatedAt: 10,
    document: {
      slug: 'ash', name: 'Ash', level: 10, revision: 3, updatedAt: 10,
      inventory: {
        medicalKit: [
          { id: 'potion-source', name: 'Potion', qty: 5, cost: '$200' },
          { id: 'potion-target', name: 'Potion', qty: 2, cost: '$200' },
          { id: 'antidote-source', name: 'Antidote', qty: 3, cost: '$200' },
        ],
        equipment: [{ id: 'armor-source', name: 'Light Armor', serializedEquipment }],
      },
    },
  })
  createSqliteGroupInventoryRepository(database).save({
    slug: 'main', revision: 2, updatedAt: 10,
    document: {
      slug: 'main', revision: 2, updatedAt: 10, money: 0,
      inventory: {
        medicalKit: [
          { id: 'group-potion-source', name: 'Potion', qty: 4, cost: '$200' },
          { id: 'group-potion-target', name: 'Potion', qty: 1, cost: '$200' },
        ],
      },
    },
  })
}

const declaration = (
  offer: InventoryActionOfferV1,
  operationId: string,
  options: { readonly quantity?: number, readonly destinationLabel?: string, readonly confirmed?: boolean } = {},
) => {
  const destination = options.destinationLabel
    ? offer.destination.options.find(candidate => candidate.label.includes(options.destinationLabel!))
    : offer.destination.options.find(candidate => candidate.enabled)
  return {
    schemaVersion: 1,
    operationId,
    offerId: offer.offerId,
    action: offer.action,
    sourceSelectionId: offer.source.sourceSelectionId,
    quantity: options.quantity ?? offer.quantity.defaultValue ?? 1,
    destinationId: offer.destination.mode === 'required' ? destination?.destinationId ?? null : null,
    confirmationOptionId: options.confirmed ? offer.confirmation.optionId : null,
    expectedRevisions: [...offer.revisionRequirements, ...(destination?.revisionRequirements ?? [])]
      .map(requirement => ({
        requirementId: requirement.requirementId,
        expectedRevision: requirement.expectedRevision,
      })),
  }
}

const trainerOffer = (
  database: RotomDatabase,
  action: 'split' | 'merge' | 'discard',
  rowLabel: string,
  section = 'medicalKit',
): InventoryActionOfferV1 => {
  const projection = loadTrainerInventoryActionsUseCase(
    { role: 'gm', trainerSlug: 'ash' },
    { database, now: () => 100 },
  )
  return projection.offers.find(offer => (
    offer.action === action && offer.source.section === section && offer.source.rowLabel === rowLabel
  ))!
}

const trainerInventory = (database: RotomDatabase): TrainerSheet['inventory'] => (
  createSqliteSheetRepository<Record<string, unknown>>(database)
    .getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet
).inventory

describe('inventory stack action execution and recovery', () => {
  it('journals one deterministic split, commits it atomically, and exact-replays without creating another row', () => {
    const database = open()
    seed(database)
    const offer = trainerOffer(database, 'split', 'Row 1')
    const command = declaration(offer, `inventory-action:v1:${'1'.repeat(32)}`, { quantity: 2 })

    const accepted = executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration: command, clientId: 'client-one',
    }, { database, now: () => 101 })
    expect(accepted.result).toMatchObject({ action: 'split', exactReplay: false })
    const rows = (accepted.sheets[0]!.sheet as unknown as TrainerSheet).inventory!.medicalKit!
    expect(rows).toEqual([
      expect.objectContaining({ id: 'potion-source', name: 'Potion', qty: 3, cost: '$200' }),
      expect.objectContaining({ id: expect.stringMatching(/^item-split-[a-f0-9]{32}$/u), name: 'Potion', qty: 2, cost: '$200' }),
      expect.objectContaining({ id: 'potion-target', qty: 2 }),
      expect.objectContaining({ id: 'antidote-source', qty: 3 }),
    ])
    const realtimeBeforeReplay = database.connection.prepare('SELECT dedupe_key, event_json FROM realtime_events ORDER BY sequence').all()
    expect(JSON.stringify(realtimeBeforeReplay)).toContain('inventory-stack')
    const stored = createSqliteInventoryActionOperationRepository(database).find(command.operationId)
    expect(stored).toMatchObject({
      status: 'accepted',
      downstreamCommand: {
        kind: 'inventory-stack-operation', action: 'split', sourceRowId: 'potion-source',
        sourceRowBefore: { qty: 5, cost: '$200' }, quantity: 2,
      },
    })

    const replay = executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration: command, clientId: 'client-two',
    }, { database, now: () => 500 })
    expect(replay.result).toMatchObject({ action: 'split', exactReplay: true })
    expect((replay.sheets[0]!.sheet as unknown as TrainerSheet).inventory!.medicalKit).toHaveLength(4)
    expect(trainerInventory(database)!.medicalKit).toHaveLength(4)
    expect(database.connection.prepare('SELECT dedupe_key, event_json FROM realtime_events ORDER BY sequence').all()).toEqual(realtimeBeforeReplay)
  })

  it('merges a whole exact source into one selected compatible row and preserves the destination row ID', () => {
    const database = open()
    seed(database)
    const offer = trainerOffer(database, 'merge', 'Row 1')
    expect(offer.destination.options).toEqual([
      expect.objectContaining({ label: 'Medical Kit · Row 2 · Potion', enabled: true }),
    ])
    const command = declaration(offer, `inventory-action:v1:${'2'.repeat(32)}`, {
      quantity: 5,
      destinationLabel: 'Row 2',
    })
    const accepted = executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration: command,
    }, { database, now: () => 101 })

    expect(accepted.result).toMatchObject({ action: 'merge', exactReplay: false })
    expect((accepted.sheets[0]!.sheet as unknown as TrainerSheet).inventory!.medicalKit).toEqual([
      expect.objectContaining({ id: 'potion-target', name: 'Potion', qty: 7, cost: '$200' }),
      expect.objectContaining({ id: 'antidote-source', qty: 3 }),
    ])
    expect(createSqliteInventoryActionOperationRepository(database).find(command.operationId)).toMatchObject({
      downstreamCommand: {
        action: 'merge',
        sourceRowId: 'potion-source',
        destinationRowId: 'potion-target',
        sourceRowBefore: { qty: 5 },
        destinationRowBefore: { qty: 2 },
      },
      accepted: { result: { action: 'merge', exactReplay: false } },
    })
  })

  it('requires the exact destructive confirmation and stores correction-ready before/after evidence', () => {
    const database = open()
    seed(database)
    const offer = trainerOffer(database, 'discard', 'Row 3')
    expect(offer).toMatchObject({
      confirmation: { mode: 'explicit-choice', optionId: expect.any(String) },
      consequences: [{ kind: 'discard', reversibility: 'irreversible' }],
    })
    const missingConfirmation = declaration(offer, `inventory-action:v1:${'3'.repeat(32)}`, { quantity: 2 })
    expect(() => executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration: missingConfirmation,
    }, { database, now: () => 101 })).toThrow('does not match the discard confirmation contract')
    expect(createSqliteInventoryActionOperationRepository(database).find(missingConfirmation.operationId)).toBeNull()

    const command = declaration(offer, `inventory-action:v1:${'4'.repeat(32)}`, { quantity: 2, confirmed: true })
    const accepted = executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration: command,
    }, { database, now: () => 102 })
    expect(accepted.result).toMatchObject({ action: 'discard', exactReplay: false })
    expect((accepted.sheets[0]!.sheet as unknown as TrainerSheet).inventory!.medicalKit).toEqual([
      expect.objectContaining({ id: 'potion-source', qty: 5 }),
      expect.objectContaining({ id: 'potion-target', qty: 2 }),
      expect.objectContaining({ id: 'antidote-source', qty: 1 }),
    ])
    expect(createSqliteInventoryActionOperationRepository(database).find(command.operationId)).toMatchObject({
      status: 'accepted',
      downstreamCommand: {
        kind: 'inventory-stack-operation', action: 'discard', sourceRowId: 'antidote-source',
        sourceRowBefore: { name: 'Antidote', qty: 3, cost: '$200' }, quantity: 2,
      },
      accepted: {
        result: { action: 'discard', exactReplay: false },
        sheets: [{ revision: 4, sheet: { inventory: { medicalKit: expect.any(Array) } } }],
      },
    })
  })

  it('discards serialized equipment only as one whole item while retaining private state in the receipt command', () => {
    const database = open()
    seed(database)
    const offer = trainerOffer(database, 'discard', 'Row 1', 'equipment')
    expect(offer).toMatchObject({
      source: { itemForm: 'whole-item', availableQuantity: 1 },
      quantity: { minimum: 1, maximum: 1 },
    })
    const command = declaration(offer, `inventory-action:v1:${'5'.repeat(32)}`, { confirmed: true })
    const accepted = executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration: command,
    }, { database, now: () => 101 })
    expect((accepted.sheets[0]!.sheet as unknown as TrainerSheet).inventory!.equipment).toEqual([])
    expect(createSqliteInventoryActionOperationRepository(database).find(command.operationId)).toMatchObject({
      downstreamCommand: {
        action: 'discard',
        quantity: 1,
        sourceRowBefore: { serializedEquipment: { instanceId: serializedEquipment.instanceId, state: { durability: 5 } } },
      },
    })
  })

  it('rolls back the stack mutation when its adapter receipt cannot be accepted', () => {
    const database = open()
    seed(database)
    const offer = trainerOffer(database, 'split', 'Row 1')
    const command = declaration(offer, `inventory-action:v1:${'6'.repeat(32)}`, { quantity: 2 })
    const repository = createSqliteInventoryActionOperationRepository(database)

    expect(() => executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration: command,
    }, {
      database,
      operationRepository: {
        ...repository,
        accept: () => { throw new Error('simulated stack receipt failure') },
      },
      now: () => 101,
    })).toThrow('simulated stack receipt failure')
    expect(trainerInventory(database)!.medicalKit).toEqual([
      expect.objectContaining({ id: 'potion-source', qty: 5 }),
      expect.objectContaining({ id: 'potion-target', qty: 2 }),
      expect.objectContaining({ id: 'antidote-source', qty: 3 }),
    ])
    expect(repository.find(command.operationId)).toMatchObject({ status: 'pending' })
  })

  it('rechecks reservations inside the mutation transaction even after a valid declaration', () => {
    const database = open()
    seed(database)
    expect(() => executeInventoryStackOperationUseCase({
      role: 'gm',
      command: {
        schemaVersion: 1,
        kind: 'inventory-stack-operation',
        action: 'discard',
        containerKind: 'trainer',
        containerSlug: 'ash',
        expectedRevision: 3,
        section: 'medicalKit',
        sourceRowId: 'antidote-source',
        sourceRowBefore: { id: 'antidote-source', name: 'Antidote', qty: 3, cost: '$200' },
        destinationRowId: null,
        destinationRowBefore: null,
        splitRowId: null,
        quantity: 2,
      },
    }, {
      database,
      itemOperationRepository: { reservedQuantity: () => 2 },
      now: () => 101,
    })).toThrow('does not have enough unreserved quantity')
    expect(trainerInventory(database)!.medicalKit![2]).toMatchObject({ id: 'antidote-source', qty: 3 })
  })

  it('allows only a GM to reshape shared stacks and exact-replays the accepted group result', () => {
    const database = open()
    seed(database)
    const player = {
      schemaVersion: 1,
      id: 'profile_fixture01',
      displayName: 'Ash player',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
    } as unknown as PlayerProfile
    const playerProjection = loadGroupInventoryActionsUseCase({
      role: 'player', playerProfile: player, groupSlug: 'main',
    }, { database, now: () => 100 })
    expect(playerProjection.offers.filter(offer => (
      offer.source.locationKind === 'group-inventory' && ['split', 'merge', 'discard'].includes(offer.action)
    )).every(offer => !offer.enabled && offer.authority.requiredRole === 'gm')).toBe(true)

    const gmProjection = loadGroupInventoryActionsUseCase({ role: 'gm', groupSlug: 'main' }, { database, now: () => 100 })
    const offer = gmProjection.offers.find(candidate => (
      candidate.action === 'split'
      && candidate.source.locationKind === 'group-inventory'
      && candidate.source.rowLabel === 'Row 1'
    ))!
    const command = declaration(offer, `inventory-action:v1:${'7'.repeat(32)}`, { quantity: 2 })
    expect(() => executeGroupInventoryActionUseCase({
      role: 'player', playerProfile: player, groupSlug: 'main', declaration: command,
    }, { database, now: () => 101 })).toThrow('references an unavailable offer')

    const accepted = executeGroupInventoryActionUseCase({
      role: 'gm', groupSlug: 'main', declaration: command,
    }, { database, now: () => 102 })
    expect(accepted.result).toMatchObject({ action: 'split', exactReplay: false })
    expect(accepted.groupInventories[0]!.inventory.medicalKit).toEqual([
      expect.objectContaining({ id: 'group-potion-source', qty: 2 }),
      expect.objectContaining({ id: expect.stringMatching(/^group-item-split-[a-f0-9]{32}$/u), qty: 2 }),
      expect.objectContaining({ id: 'group-potion-target', qty: 1 }),
    ])
    const replay = executeGroupInventoryActionUseCase({
      role: 'gm', groupSlug: 'main', declaration: command,
    }, { database, now: () => 500 })
    expect(replay.result).toMatchObject({ action: 'split', exactReplay: true })
    expect(replay.groupInventories[0]!.inventory.medicalKit).toHaveLength(3)
  })

  it('recovers an accepted split from the persisted journal after process restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-inventory-stack-'))
    temporaryRoots.push(root)
    const path = join(root, 'campaign.sqlite')
    const firstDatabase = openRotomDatabase({ path, enableWal: false })
    seed(firstDatabase)
    const offer = trainerOffer(firstDatabase, 'split', 'Row 1')
    const command = declaration(offer, `inventory-action:v1:${'8'.repeat(32)}`, { quantity: 2 })
    executeTrainerInventoryActionUseCase({ role: 'gm', trainerSlug: 'ash', declaration: command }, { database: firstDatabase, now: () => 101 })
    firstDatabase.close()

    const reopened = openRotomDatabase({ path, enableWal: false })
    databases.push(reopened)
    const recovered = executeTrainerInventoryActionUseCase({
      role: 'gm', trainerSlug: 'ash', declaration: command,
    }, { database: reopened, now: () => 500 })
    expect(recovered.result).toMatchObject({ action: 'split', exactReplay: true })
    expect((recovered.sheets[0]!.sheet as unknown as TrainerSheet).inventory!.medicalKit).toHaveLength(4)
    expect(createSqliteInventoryActionOperationRepository(reopened).find(command.operationId)).toMatchObject({ status: 'accepted' })
  })
})
