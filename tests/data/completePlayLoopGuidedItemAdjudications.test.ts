import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/guided-item-adjudications.v1.json'
import items from '../../data/reference/items.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import {
  equipmentGrantDefinitionFor,
  equipmentGrantDefinitionSha256,
} from '../../server/domain/itemAutomation/equipmentGrantRegistry'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const valueSha256 = (value: unknown): string => sha256(stableJsonStringify(value))

describe('P8-059 reviewed guided-item adjudication authority', () => {
  it('locks five inventory items and one Re-Breather workflow to exact structured authority', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P8-059', status: 'reviewed', runtimeProseParsing: false })
    expect(contract.inventoryItems.map(row => row.canonicalId)).toEqual([
      'Energy Powder', 'Energy Root', 'Heal Powder', 'Revival Herb', 'Poultices',
    ])
    for (const row of contract.inventoryItems) {
      expect(valueSha256(items[row.canonicalId as keyof typeof items])).toBe(row.canonicalRecordSha256)
      expect(ITEM_AUTOMATION_RUNTIME_REGISTRY.require(row.canonicalId)).toMatchObject({
        spec: { implementationState: 'guided', registeredHandlerId: 'item.guided.v1' },
      })
    }
    const definition = equipmentGrantDefinitionFor('Re-Breather')
    expect(definition).toMatchObject({
      canonicalRecordSha256: contract.reBreather.canonicalRecordSha256,
      equipmentDefinitionSha256: contract.reBreather.equipmentDefinitionSha256,
    })
    expect(equipmentGrantDefinitionSha256('Re-Breather')).toBe(contract.reBreather.equipmentGrantDefinitionSha256)
    expect(contract.reBreather).toMatchObject({
      actionId: 'equipment.re-breather.activate', capabilityId: 'Gilled',
      activeMinutes: 60, openAirRefillMinutes: 5, openAirAuthority: 'bounded-gm-confirmation',
    })
  })

  it('hash-locks every structured source and forbids freeform mechanics or early settlement', () => {
    for (const source of contract.sources) expect(sha256(readFileSync(source.path))).toBe(source.fileSha256)
    expect(contract.loyalty).toMatchObject({
      choiceId: 'gm-loyalty-outcome', minimum: 1, maximum: 1,
      defaultLoyaltyWhenAbsent: 3, minimumLoyalty: 0, maximumLoyalty: 6,
      decisionRole: 'gm', freeformMechanics: false,
    })
    expect(contract.consumption).toEqual({
      phase: 'gm-adjudication', quantity: 1, reserveWhilePending: true,
      refundableOnCancel: true, reusable: false,
    })
    expect(contract.boundaries).toMatchObject({
      declaration: expect.stringContaining('without applying mechanics'),
      cancellation: expect.stringContaining('without item, HP, condition, Loyalty, capability, action, or clock mutation'),
      privacy: expect.stringContaining('exclude operation IDs'),
    })
  })
})
