import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteItemGuidedRequestRepository } from '../../server/storage/itemGuidedRequestRepository'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => { const database = openRotomDatabase({ path: ':memory:' }); databases.push(database); return database }
afterEach(() => { while (databases.length) databases.pop()!.close() })
const requestId = 'item-guided:v1:11111111111111111111111111111111'
const terminalId = 'item-guided-operation:v1:22222222222222222222222222222222'

const authority = {
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

describe('guided item request repository', () => {
  it('stores immutable declaration evidence, one revision-CAS terminal command, and exact replay material', () => {
    const database = open()
    const repository = createSqliteItemGuidedRequestRepository({ database, now: () => 10 })
    const created = repository.create({
      requestId, requestKind: 're-breather-activation', canonicalItemId: 'Re-Breather',
      canonicalDefinitionSha256: 'a'.repeat(64), declarationPrincipalKey: 'profile_guided01',
      actorKind: 'trainer', actorSlug: 'mira', targetKind: 'trainer', targetSlug: 'mira',
      itemOperationId: null,
      declarationOperationId: 'item-guided-operation:v1:33333333333333333333333333333333',
      declarationCommand: {
        schemaVersion: 1, operationId: 'item-guided-operation:v1:33333333333333333333333333333333',
        action: 'declare-re-breather', ownerKind: 'trainer', ownerSlug: 'mira', ownerRevision: 4, offerId: 'offer-safe',
      },
      authority,
    })
    expect(created).toMatchObject({ status: 'pending', revision: 0, authority })
    expect(repository.listPending()).toHaveLength(1)
    const command = {
      schemaVersion: 1 as const, operationId: terminalId, action: 'resolve' as const,
      requestId, expectedRevision: 0, optionId: 'activate-for-one-hour',
    }
    const settled = repository.settle({
      requestId, expectedRevision: 0, status: 'accepted', terminalPrincipalKey: 'gm', command,
      outcomeOptionId: 'activate-for-one-hour',
      result: { schemaVersion: 1, status: 'accepted', acceptedSummary: 'Re-Breather activated.' },
      updatedAt: 20,
    })
    expect(settled).toMatchObject({ kind: 'applied', record: { status: 'accepted', revision: 1, terminalCommand: command } })
    expect(repository.getByTerminalOperation(terminalId)).toEqual(settled.record)
    expect(repository.settle({
      requestId, expectedRevision: 0, status: 'accepted', terminalPrincipalKey: 'gm', command,
      outcomeOptionId: 'activate-for-one-hour',
      result: { schemaVersion: 1, status: 'accepted', acceptedSummary: 'Re-Breather activated.' },
    })).toMatchObject({ kind: 'stale', record: { revision: 1 } })
  })

  it('rejects request identity reuse with changed declaration evidence', () => {
    const repository = createSqliteItemGuidedRequestRepository({ database: open() })
    const base = {
      requestId, requestKind: 're-breather-activation' as const, canonicalItemId: 'Re-Breather',
      canonicalDefinitionSha256: 'a'.repeat(64), declarationPrincipalKey: 'profile_guided01',
      actorKind: 'trainer' as const, actorSlug: 'mira', targetKind: 'trainer' as const, targetSlug: 'mira',
      itemOperationId: null,
      declarationOperationId: 'item-guided-operation:v1:33333333333333333333333333333333',
      declarationCommand: { schemaVersion: 1, marker: 'first' }, authority,
    }
    repository.create(base)
    expect(() => repository.create({ ...base, declarationCommand: { schemaVersion: 1, marker: 'changed' } }))
      .toThrow('reused for another declaration')
  })
})
