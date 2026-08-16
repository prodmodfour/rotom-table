import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import serialization from '~~/data/complete-play-loop/inventory-serialization.v1.json'
import equipmentOperations from '~~/data/complete-play-loop/equipment-operations.v1.json'
import equipmentMigration from '~~/data/complete-play-loop/equipment-migration.v1.json'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-045 inventory serialization policy', () => {
  it('binds stack, whole-row, and serialized behavior to one reviewed fail-closed contract', () => {
    expect(serialization).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-045',
      rowKinds: {
        stack: { partialTransfer: true, partialConsumption: true, merge: expect.stringContaining('never fuzzy') },
        wholeRow: { section: 'equipment', quantity: 1, partialTransfer: false, merge: false },
        serialized: {
          field: 'serializedEquipment', quantity: 1, partialTransfer: false, merge: false,
          identity: 'equipped-item:v1:<32 lowercase hex>',
        },
      },
      extraction: {
        stackToEquipment: expect.stringContaining('decrement exactly one'),
        serializedToEquipment: expect.stringContaining('preserve identity'),
        returnToInventory: expect.stringContaining('preserve identity'),
      },
      chargedAndDurableTools: { storage: 'serializedEquipment.state', proseInference: false },
    })
    expect(serialization.failurePolicy).toMatchObject({
      fuzzyNameMerge: 'keep separate',
      serializedQuantityOtherThanOne: 'reject',
      duplicateSerializedIdentity: 'reject',
      unsafeRevisionIncrement: 'reject',
    })
  })

  it('keeps dependent migration and operation evidence bound to the current equipment contract', () => {
    const contractHash = sha256('data/complete-play-loop/equipment-contract.v1.json')
    expect(equipmentOperations.equipmentContractSha256).toBe(contractHash)
    expect(equipmentMigration.equipmentContractSha256).toBe(contractHash)
    expect(equipmentOperations.custody.serializedItemPolicy).toContain('P8-045')
  })
})
