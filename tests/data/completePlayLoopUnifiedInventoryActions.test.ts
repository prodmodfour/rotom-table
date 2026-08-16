import { describe, expect, it } from 'vitest'
import contractJson from '../../data/complete-play-loop/unified-inventory-actions.v1.json'
import {
  INVENTORY_ACTION_CONTRACT,
  INVENTORY_ACTION_KINDS,
} from '#shared/itemAutomation/inventoryActions'

const contract = contractJson as any

describe('P8-061 unified inventory action data contract', () => {
  it('covers every action once and exactly matches the runtime routing anatomy', () => {
    expect(contract).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-061',
      status: 'interface-contract-only',
      runtimeContract: 'shared/itemAutomation/inventoryActions.ts',
    })
    expect(contract.actions.map((row: any) => row.kind)).toEqual(INVENTORY_ACTION_KINDS)
    expect(new Set(contract.actions.map((row: any) => row.kind)).size).toBe(INVENTORY_ACTION_KINDS.length)
    for (const row of contract.actions) {
      const runtime = INVENTORY_ACTION_CONTRACT[row.kind as keyof typeof INVENTORY_ACTION_CONTRACT]
      expect(row, row.kind).toEqual({
        kind: row.kind,
        executionMode: runtime.executionMode,
        handoff: runtime.handoff,
        sourceKinds: [...runtime.sourceKinds],
        quantityMode: runtime.quantityMode,
        destinationMode: runtime.destinationMode,
        destinationKinds: [...runtime.destinationKinds],
        confirmationMode: runtime.confirmationMode,
      })
    }
  })

  it('advertises authority, revisions, destinations, irreversible consequences, and exact commit revalidation', () => {
    expect(contract.offerContract).toEqual(expect.objectContaining({
      authority: expect.stringMatching(/authenticated role/u),
      revisions: expect.stringMatching(/exact/u),
      destinations: expect.stringMatching(/bounded current options/u),
      consequences: expect.stringMatching(/irreversible/u),
    }))
    expect(contract.declarationContract.clientFields).toEqual([
      'operationId', 'offerId', 'action', 'sourceSelectionId', 'quantity',
      'destinationId', 'confirmationOptionId', 'expectedRevisions',
    ])
    expect(contract.declarationContract.commitBoundary).toMatch(/not commit authorization/u)
    expect(contract.failurePolicy).toEqual(expect.arrayContaining([
      expect.stringMatching(/stale, missing, added, or changed revisions fail closed/u),
      expect.stringMatching(/irreversible discard requires/u),
      expect.stringMatching(/commit-time revalidation/u),
    ]))
  })

  it('forbids private authority and provenance from safe projections', () => {
    expect(contract.privacy.forbiddenProjectionFields).toEqual([
      'profileId', 'rowId', 'sourceInstanceId', 'serializedInstanceId',
      'operationId', 'canonicalDefinitionSha256', 'ownershipEvidence', 'privateNotes', 'provenance',
    ])
    expect(contract.authority).toMatch(/grants no mechanics, identity, ownership, custody, compatibility, quantity, destination, or mutation authority/u)
  })
})
