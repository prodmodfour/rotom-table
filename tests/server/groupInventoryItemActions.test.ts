import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerProfile } from '#shared/playerProfiles'
import { itemCommandFromAuthorizedSheetAction, sheetItemTargetId } from '#shared/itemAutomation/sheetActions'
import type { ItemOperationPlanV1, ItemPendingDecisionV1, UseItemCommandV1 } from '#shared/itemAutomation/operations'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteGroupInventoryRepository } from '../../server/storage/groupInventoryRepository'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { loadGroupInventoryItemActionsUseCase } from '../../server/useCases/loadGroupInventoryItemActions'
import { declareGroupInventoryItemActionUseCase } from '../../server/useCases/declareGroupInventoryItemAction'
import { executeItemOperationUseCase } from '../../server/useCases/executeItemOperation'
import { loadGroupInventoryActionsUseCase } from '../../server/useCases/loadGroupInventoryActions'
import { transferGroupInventoryToTrainerUseCase } from '../../server/useCases/transferGroupInventoryToTrainer'
import { executeInventoryStackOperationUseCase } from '../../server/useCases/executeInventoryStackOperation'
import {
  loadItemGuidedAdjudicationUseCase,
  manageItemGuidedAdjudicationUseCase,
} from '../../server/useCases/manageItemGuidedAdjudication'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { createDefaultGroupInventoryDocument } from '~/types/groupInventory'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length) databases.pop()!.close()
})

const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3, currentTeam: ['pikachu'], inventory: {},
})
const pokemon = (): CharacterSheet => ({
  slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', level: 5, revision: 2,
  stats: { hp: { added: 0 } }, combat: { currentHp: 7 },
})
const profile = (linked = true): PlayerProfile => ({
  schemaVersion: 1,
  id: linked ? 'profile_group_item_01' : 'profile_group_item_02',
  displayName: 'Player',
  linkedCharacters: linked ? [{ sheetKind: 'trainer', sheetSlug: 'ash' }] : [],
})
const seed = (database: RotomDatabase, quantity = 2, itemName = 'Potion'): void => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({
    kind: 'trainer', slug: 'ash', revision: 3, updatedAt: 10,
    document: trainer() as unknown as Record<string, unknown>,
  })
  sheets.save({
    kind: 'pokemon', slug: 'pikachu', revision: 2, updatedAt: 10,
    document: pokemon() as unknown as Record<string, unknown>,
  })
  const group = createDefaultGroupInventoryDocument({ slug: 'main', now: 10 })
  group.revision = 4
  group.inventory.medicalKit = [{ id: 'private-group-potion', name: itemName, qty: quantity }]
  createSqliteGroupInventoryRepository(database).save({
    slug: 'main', revision: 4, updatedAt: 10, document: group,
  })
}

const declarePotion = (database: RotomDatabase, playerProfile: PlayerProfile = profile()) => {
  const projection = loadGroupInventoryItemActionsUseCase({
    role: 'player', playerProfile, groupSlug: 'main',
  }, { database, now: () => 100 })
  const potionOffer = projection.offers.find(offer => offer.source.canonicalId === 'Potion')!
  const declared = declareGroupInventoryItemActionUseCase({
    role: 'player', playerProfile,
    intent: {
      schemaVersion: 1,
      groupSlug: 'main',
      groupRevision: projection.groupRevision,
      actorSelectionId: projection.selectedActorSelectionId,
      offerId: potionOffer.offerId,
      action: 'use',
    },
  }, { database, now: () => 100 })
  return { projection, potionOffer, declared }
}

describe('group inventory item actions', () => {
  it('projects one authorised acting Trainer with safe shared-row labels and private exact declaration authority', () => {
    const database = open()
    seed(database)
    const { projection, potionOffer, declared } = declarePotion(database)

    expect(projection).toMatchObject({
      schemaVersion: 1,
      groupSlug: 'main',
      groupRevision: 4,
      generatedAt: 100,
      selectedActorSelectionId: expect.stringMatching(/^group-item-actor:v1:[a-f0-9]{32}$/u),
      actors: [{ label: 'Ash', revision: 3, selected: true }],
    })
    expect(potionOffer).toMatchObject({
      actor: { label: 'Ash', revision: 3 },
      source: {
        containerKind: 'group', containerLabel: 'Group inventory',
        sectionLabel: 'Medical Kit', rowLabel: 'Row 1', quantity: 2,
      },
      availability: { enabled: true },
      actions: [
        { kind: 'use', enabled: true },
        { kind: 'inspect', enabled: true, href: '/items/Potion' },
      ],
    })
    expect(potionOffer.targeting?.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: sheetItemTargetId('pokemon', 'pikachu'), enabled: true }),
    ]))
    expect(JSON.stringify(projection)).not.toMatch(/private-group-potion|item-instance:group|profile_group/u)
    expect(declared.offer.itemCommand).toMatchObject({
      context: 'sheet',
      actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
      source: {
        kind: 'group', slug: 'main', section: 'medicalKit',
        rowId: 'private-group-potion', expectedRevision: 4,
      },
      readSet: [
        { kind: 'campaign-clock', id: 'campaign', revision: 0 },
        { kind: 'group-inventory', id: 'main', revision: 4 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
      ],
    })

    const unlinked = loadGroupInventoryItemActionsUseCase({
      role: 'player', playerProfile: profile(false), groupSlug: 'main',
    }, { database, now: () => 100 })
    expect(unlinked).toMatchObject({ selectedActorSelectionId: null, actors: [], offers: [] })
    expect(() => loadGroupInventoryItemActionsUseCase({
      role: 'player', playerProfile: null, groupSlug: 'main',
    }, { database })).toThrow('Choose a player profile')
  })

  it('atomically consumes the exact shared source, heals an authorised roster target, publishes current group authority, and replays once', () => {
    const database = open()
    seed(database)
    const { declared } = declarePotion(database)
    const command = itemCommandFromAuthorizedSheetAction({
      offer: declared.offer,
      operationId: 'group-sheet-item:v1:11111111111111111111111111111111',
      targetIds: [sheetItemTargetId('pokemon', 'pikachu')],
    })
    const first = executeItemOperationUseCase({
      role: 'player', playerProfile: profile(), command, clientId: 'group-item-client',
    }, { database, now: () => 101 })
    expect(first.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Potion', exactReplay: false })
    expect(first.groupInventory).toMatchObject({ slug: 'main', revision: 5 })
    expect(first.groupInventory?.inventory.medicalKit).toEqual([
      { id: 'private-group-potion', name: 'Potion', qty: 1 },
    ])
    expect(first.sheets.map(sheet => `${sheet.kind}:${sheet.slug}`)).toEqual(['pokemon:pikachu'])
    expect((createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('pokemon', 'pikachu')!.sheet as unknown as CharacterSheet).combat?.currentHp).toBe(27)
    expect(createSqliteItemOperationRepository({ database }).get(command.operationId)).toMatchObject({
      status: 'accepted',
      command: { source: { kind: 'group', slug: 'main', rowId: 'private-group-potion' } },
    })

    const replay = executeItemOperationUseCase({
      role: 'player', playerProfile: profile(), command,
    }, { database, now: () => 200 })
    expect(replay.result).toMatchObject({ status: 'accepted', exactReplay: true })
    expect(replay.groupInventory).toBeUndefined()
    expect(createSqliteGroupInventoryRepository(database).get('main')?.document.inventory.medicalKit[0]?.qty).toBe(1)
  })

  it('creates a real guided shared-use reservation before mechanics and settles consumption through the existing GM queue', () => {
    const database = open()
    seed(database, 2, 'Energy Powder')
    const groups = createSqliteGroupInventoryRepository(database)
    const withUnrelatedRow = groups.get('main')!.document
    groups.save({
      slug: 'main', revision: 4, updatedAt: 10,
      document: {
        ...withUnrelatedRow,
        inventory: {
          ...withUnrelatedRow.inventory,
          medicalKit: [
            ...withUnrelatedRow.inventory.medicalKit,
            { id: 'unrelated-antidote', name: 'Antidote', qty: 1 },
          ],
        },
      },
    })
    const projection = loadGroupInventoryItemActionsUseCase({
      role: 'player', playerProfile: profile(), groupSlug: 'main',
    }, { database, now: () => 100 })
    const offer = projection.offers.find(candidate => candidate.source.canonicalId === 'Energy Powder')!
    expect(offer).toMatchObject({ source: { quantity: 2 }, availability: { enabled: true } })
    const declared = declareGroupInventoryItemActionUseCase({
      role: 'player', playerProfile: profile(), intent: {
        schemaVersion: 1, groupSlug: 'main', groupRevision: 4,
        actorSelectionId: projection.selectedActorSelectionId,
        offerId: offer.offerId, action: 'use',
      },
    }, { database, now: () => 100 })
    const command = itemCommandFromAuthorizedSheetAction({
      offer: declared.offer,
      operationId: 'group-sheet-item:v1:55555555555555555555555555555555',
      targetIds: [sheetItemTargetId('pokemon', 'pikachu')],
    })
    const pending = executeItemOperationUseCase({
      role: 'player', playerProfile: profile(), command,
    }, {
      database, now: () => 101,
      guidedRequestId: () => 'item-guided:v1:55555555555555555555555555555555',
    })
    expect(pending.result).toMatchObject({
      status: 'pending', canonicalItemId: 'Energy Powder', reservationId: expect.any(String),
    })
    expect(createSqliteGroupInventoryRepository(database).get('main')?.document.inventory.medicalKit[0]?.qty).toBe(2)
    const operations = createSqliteItemOperationRepository({ database })
    expect(operations.reservedQuantity(command.sourceInstanceId)).toBe(1)
    expect(loadGroupInventoryItemActionsUseCase({
      role: 'player', playerProfile: profile(), groupSlug: 'main',
    }, { database, now: () => 102 }).offers[0]?.source.quantity).toBe(1)
    expect(() => transferGroupInventoryToTrainerUseCase({
      role: 'player', playerProfile: profile(), groupSlug: 'main', groupRevision: 4,
      trainerSlug: 'ash', trainerRevision: 3, section: 'medicalKit',
      itemId: 'private-group-potion', quantity: 2,
    }, { database })).toThrow('not have enough unreserved quantity')
    executeInventoryStackOperationUseCase({
      role: 'gm', command: {
        schemaVersion: 1,
        kind: 'inventory-stack-operation',
        action: 'discard',
        containerKind: 'group',
        containerSlug: 'main',
        expectedRevision: 4,
        section: 'medicalKit',
        sourceRowId: 'unrelated-antidote',
        sourceRowBefore: { id: 'unrelated-antidote', name: 'Antidote', qty: 1 },
        destinationRowId: null,
        destinationRowBefore: null,
        splitRowId: null,
        quantity: 1,
      },
    }, { database, now: () => 102 })
    expect(groups.get('main')?.document).toMatchObject({
      revision: 5,
      inventory: { medicalKit: [{ id: 'private-group-potion', name: 'Energy Powder', qty: 2 }] },
    })
    expect(operations.reservedQuantity(command.sourceInstanceId)).toBe(1)
    const request = loadItemGuidedAdjudicationUseCase({ role: 'gm' }, { database }).requests[0]!
    const accepted = manageItemGuidedAdjudicationUseCase({
      role: 'gm', command: {
        schemaVersion: 1,
        operationId: 'item-guided-operation:v1:66666666666666666666666666666666',
        action: 'resolve',
        requestId: request.requestId,
        expectedRevision: request.revision,
        optionId: request.choices[0]!.optionId,
      },
    }, { database, now: () => 103 })
    expect(accepted.result.request).toMatchObject({ status: 'accepted', revision: 1 })
    expect(operations.reservedQuantity(command.sourceInstanceId)).toBe(0)
    expect(createSqliteGroupInventoryRepository(database).get('main')?.document).toMatchObject({
      revision: 6,
      inventory: { medicalKit: [{ id: 'private-group-potion', name: 'Energy Powder', qty: 1 }] },
    })
    expect((createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('pokemon', 'pikachu')!.sheet as unknown as CharacterSheet).combat?.currentHp).toBeGreaterThan(7)
  })

  it('reserves exact shared quantity across projections, transfer, stack operations, release, and restart-safe journal authority', () => {
    const database = open()
    seed(database)
    const sourceInstanceId = 'item-instance:group:main:medicalKit:private-group-potion'
    const command: UseItemCommandV1 = {
      schemaVersion: 1,
      operationId: 'group-sheet-item:v1:22222222222222222222222222222222',
      context: 'sheet',
      offerId: 'sheet-item-offer:group-reservation',
      sourceInstanceId,
      actorParticipantId: null,
      actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
      source: { kind: 'group', slug: 'main', section: 'medicalKit', rowId: 'private-group-potion', expectedRevision: 4 },
      targetIds: [sheetItemTargetId('pokemon', 'pikachu')],
      choices: [{ choiceId: 'target', optionIds: [sheetItemTargetId('pokemon', 'pikachu')] }],
      readSet: [
        { kind: 'campaign-clock', id: 'campaign', revision: 0 },
        { kind: 'group-inventory', id: 'main', revision: 4 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
      ],
    }
    const pendingDecision: ItemPendingDecisionV1 = {
      schemaVersion: 1,
      operationId: command.operationId,
      decisionId: 'item-decision:group-reservation',
      canonicalItemId: 'Potion',
      sourceInstanceId,
      reservation: { reservationId: 'item-reservation:group-reservation', quantity: 1 },
      choices: [{
        choiceId: 'target', kind: 'participant', minimum: 1, maximum: 1,
        options: [{ optionId: sheetItemTargetId('pokemon', 'pikachu'), label: 'Pikachu' }],
        privateTo: 'actor-owner',
      }],
    }
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Potion')
    const plan: ItemOperationPlanV1 = {
      schemaVersion: 1,
      operationId: command.operationId,
      canonicalItemId: 'Potion',
      canonicalDefinitionSha256: definition.definitionSha256,
      readSet: command.readSet,
      operations: [{
        operationId: 'inventory.reserve.group', ordinal: 0, kind: 'inventory',
        aggregate: { kind: 'group-inventory', id: 'main', revision: 4 },
        subjectId: 'private-group-potion',
        payload: { action: 'consume', quantity: 1, sourceInstanceId, reservationOnly: true },
        label: 'Reserve one Potion',
      }],
      receiptFacts: [],
    }
    const operations = createSqliteItemOperationRepository({ database, clock: () => 100 })
    const pending = operations.createPending({
      command,
      canonicalItemId: 'Potion',
      canonicalDefinitionSha256: definition.definitionSha256,
      plan,
      pendingDecision,
    })
    expect(operations.reservedQuantity(sourceInstanceId)).toBe(1)

    const itemProjection = loadGroupInventoryItemActionsUseCase({
      role: 'gm', groupSlug: 'main',
    }, { database, now: () => 110 })
    expect(itemProjection.offers.find(offer => offer.source.canonicalId === 'Potion')?.source.quantity).toBe(1)
    const inventoryProjection = loadGroupInventoryActionsUseCase({
      role: 'gm', groupSlug: 'main',
    }, { database, now: () => 110 })
    const transfer = inventoryProjection.offers.find(offer => (
      offer.action === 'transfer' && offer.source.locationKind === 'group-inventory'
    ))!
    const discard = inventoryProjection.offers.find(offer => offer.action === 'discard')!
    expect(transfer.quantity.maximum).toBe(1)
    expect(discard.quantity.maximum).toBe(1)

    expect(() => transferGroupInventoryToTrainerUseCase({
      role: 'gm', groupSlug: 'main', groupRevision: 4,
      trainerSlug: 'ash', trainerRevision: 3, section: 'medicalKit',
      itemId: 'private-group-potion', quantity: 2,
    }, { database })).toThrow('not have enough unreserved quantity')
    expect(createSqliteGroupInventoryRepository(database).get('main')?.document.inventory.medicalKit[0]?.qty).toBe(2)

    operations.complete({
      operationId: pending.operationId,
      commandSha256: pending.commandSha256,
      status: 'rejected',
      result: {
        schemaVersion: 1, operationId: pending.operationId, status: 'rejected', canonicalItemId: 'Potion',
        reasonId: 'item.operation.cancelled', message: 'Cancelled without mechanics.', exactReplay: false,
      },
      updatedAt: 120,
    })
    expect(operations.reservedQuantity(sourceInstanceId)).toBe(0)
    expect(loadGroupInventoryItemActionsUseCase({ role: 'gm', groupSlug: 'main' }, { database, now: () => 121 })
      .offers.find(offer => offer.source.canonicalId === 'Potion')?.source.quantity).toBe(2)
  })

  it('rejects stale actor, source revision, and manufactured source changes before mutation', () => {
    const database = open()
    seed(database)
    const { projection, potionOffer, declared } = declarePotion(database)
    expect(() => declareGroupInventoryItemActionUseCase({
      role: 'player', playerProfile: profile(), intent: {
        schemaVersion: 1, groupSlug: 'main', groupRevision: 3,
        actorSelectionId: projection.selectedActorSelectionId,
        offerId: potionOffer.offerId, action: 'use',
      },
    }, { database })).toThrow('group inventory changed')

    const command = itemCommandFromAuthorizedSheetAction({
      offer: declared.offer,
      operationId: 'group-sheet-item:v1:33333333333333333333333333333333',
      targetIds: [sheetItemTargetId('pokemon', 'pikachu')],
    })
    const forged = {
      ...command,
      source: { ...command.source, rowId: 'manufactured-row' },
      sourceInstanceId: 'item-instance:group:main:medicalKit:manufactured-row',
    }
    expect(() => executeItemOperationUseCase({
      role: 'player', playerProfile: profile(), command: forged,
    }, { database, now: () => 101 })).toThrow('command authority changed')
    expect(createSqliteGroupInventoryRepository(database).get('main')?.document.inventory.medicalKit[0]?.qty).toBe(2)
  })
})
