import { afterEach, describe, expect, it } from 'vitest'
import type { PlayerProfile } from '#shared/playerProfiles'
import { itemCommandFromAuthorizedSheetAction, sheetItemTargetId } from '#shared/itemAutomation/sheetActions'
import type { TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { loadSheetItemActionsUseCase } from '../../server/useCases/loadSheetItemActions'
import { declareSheetItemActionUseCase } from '../../server/useCases/declareSheetItemAction'
import { executeItemOperationUseCase } from '../../server/useCases/executeItemOperation'
import {
  loadItemGuidedAdjudicationUseCase,
  manageItemGuidedAdjudicationUseCase,
} from '../../server/useCases/manageItemGuidedAdjudication'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => { while (databases.length) databases.pop()!.close() })

const profile = (): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_guided_sheet',
  displayName: 'Ash',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
})
const trainer = (canonicalItemId: string, rowId: string, quantity: number): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3,
  inventory: { keyItems: [{ id: rowId, name: canonicalItemId, qty: quantity }] },
})
const seed = (database: RotomDatabase, sheet: TrainerSheet): void => {
  createSqliteSheetRepository<Record<string, unknown>>(database).save({
    kind: 'trainer', slug: 'ash', revision: 3, updatedAt: 10,
    document: sheet as unknown as Record<string, unknown>,
  })
}
const requestId = (suffix: string): string => `item-guided:v1:${suffix.repeat(32)}`
const terminalOperationId = (suffix: string): string => `item-guided-operation:v1:${suffix.repeat(32)}`

const declare = (input: {
  database: RotomDatabase
  canonicalItemId: string
  itemOperationId: string
  requestId: string
}) => {
  const projection = loadSheetItemActionsUseCase({
    role: 'player', playerProfile: profile(), trainerSlug: 'ash',
  }, { database: input.database, now: () => 100 })
  const offer = projection.offers.find(candidate => candidate.source.canonicalId === input.canonicalItemId)!
  expect(offer).toMatchObject({
    availability: { enabled: true, unavailableReason: null },
    actions: expect.arrayContaining([expect.objectContaining({ kind: 'use', enabled: true })]),
  })
  const authorized = declareSheetItemActionUseCase({
    role: 'player', playerProfile: profile(),
    intent: {
      schemaVersion: 1,
      trainerSlug: 'ash',
      trainerRevision: projection.trainerRevision,
      offerId: offer.offerId,
      action: 'use',
    },
  }, { database: input.database, now: () => 100 })
  const command = itemCommandFromAuthorizedSheetAction({
    offer: authorized,
    operationId: input.itemOperationId,
    targetIds: [sheetItemTargetId('trainer', 'ash')],
  })
  return executeItemOperationUseCase({
    role: 'player', playerProfile: profile(), command,
  }, {
    database: input.database,
    guidedRequestId: () => input.requestId,
    now: () => 100,
    publishPersistedRealtimeEvent: () => undefined,
  })
}

const acceptOnlyChoice = (database: RotomDatabase, operationId: string, now: number) => {
  const request = loadItemGuidedAdjudicationUseCase({ role: 'gm' }, { database }).requests[0]!
  expect(request.choices).toEqual([expect.objectContaining({ optionId: 'accept-reviewed-use' })])
  return manageItemGuidedAdjudicationUseCase({
    role: 'gm',
    command: {
      schemaVersion: 1,
      operationId,
      action: 'resolve',
      requestId: request.requestId,
      expectedRevision: 0,
      optionId: 'accept-reviewed-use',
    },
  }, { database, now: () => now, publishPersistedRealtimeEvent: () => undefined })
}

describe('guided catalog sheet-context settlement', () => {
  it('retains an exact reusable field tool and records one private reviewed receipt', () => {
    const database = open()
    seed(database, trainer('Collection Jar', 'collection-jar-row', 1))
    expect(declare({
      database,
      canonicalItemId: 'Collection Jar',
      itemOperationId: 'sheet-item:v1:11111111111111111111111111111111',
      requestId: requestId('1'),
    }).result).toMatchObject({ status: 'pending', canonicalItemId: 'Collection Jar' })
    expect(acceptOnlyChoice(database, terminalOperationId('2'), 200).result.request.status).toBe('accepted')

    const accepted = createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet
    expect(accepted.inventory?.keyItems).toMatchObject([{ id: 'collection-jar-row', qty: 1 }])
    expect(accepted.serverPrivate?.itemGuidedCampaignTools).toMatchObject({
      receipts: [expect.objectContaining({
        canonicalItemId: 'Collection Jar',
        sourceDisposition: 'retained-reusable',
        outcomeOptionId: 'accept-reviewed-use',
      })],
    })
  })

  it('releases a consumable crafting reservation on cancellation without source or receipt mutation', () => {
    const database = open()
    seed(database, trainer('Mulch', 'mulch-row', 2))
    declare({
      database,
      canonicalItemId: 'Mulch',
      itemOperationId: 'sheet-item:v1:55555555555555555555555555555555',
      requestId: requestId('5'),
    })
    const request = loadItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: profile(), ownerKind: 'trainer', ownerSlug: 'ash',
    }, { database }).requests[0]!
    expect(request).toMatchObject({
      requestKind: 'campaign-tool-adjudication',
      reservationLabel: '1 Mulch reserved',
      choices: [],
      canCancel: true,
    })
    const cancelled = manageItemGuidedAdjudicationUseCase({
      role: 'player', playerProfile: profile(),
      command: {
        schemaVersion: 1,
        operationId: terminalOperationId('6'),
        action: 'cancel',
        requestId: request.requestId,
        expectedRevision: 0,
      },
    }, { database, now: () => 180, publishPersistedRealtimeEvent: () => undefined })
    expect(cancelled.result.request.status).toBe('cancelled')
    const current = createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet
    expect(current.inventory?.keyItems).toMatchObject([{ id: 'mulch-row', qty: 2 }])
    expect(current.serverPrivate?.itemGuidedCampaignTools).toBeUndefined()
  })

  it('consumes one exact crafting material only after the bounded GM acceptance', () => {
    const database = open()
    seed(database, trainer('Mulch', 'mulch-row', 2))
    expect(declare({
      database,
      canonicalItemId: 'Mulch',
      itemOperationId: 'sheet-item:v1:33333333333333333333333333333333',
      requestId: requestId('3'),
    }).result).toMatchObject({ status: 'pending', canonicalItemId: 'Mulch' })
    const before = createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet
    expect(before.inventory?.keyItems?.[0]?.qty).toBe(2)

    expect(acceptOnlyChoice(database, terminalOperationId('4'), 210).result.request.status).toBe('accepted')
    const accepted = createSqliteSheetRepository<Record<string, unknown>>(database)
      .getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet
    expect(accepted.inventory?.keyItems).toMatchObject([{ id: 'mulch-row', qty: 1 }])
    expect(accepted.serverPrivate?.itemGuidedCampaignTools).toMatchObject({
      receipts: [expect.objectContaining({ canonicalItemId: 'Mulch', sourceDisposition: 'consumed-one' })],
    })
  })
})
