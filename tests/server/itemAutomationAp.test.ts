import { describe, expect, it } from 'vitest'
import type { ItemOperationPlanV1 } from '#shared/itemAutomation/operations'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  applyItemApDrain,
  assertPlannedItemApDrainsCurrent,
  itemApDrainId,
  previewItemApDrain,
} from '../../server/domain/itemAutomation/ap'
import { recoverFeaturesAtExtendedRest } from '../../server/domain/featureAutomation/recovery'
import { planItemOperationCorrection } from '../../server/domain/itemAutomation/correction'

const trainer = (): TrainerSheet => ({
  slug: 'medic', name: 'Medic', level: 10, revision: 3,
  ap: { max: 7 },
})

describe('item tool AP authority', () => {
  it('adds one source-bound drain without changing legacy AP fields and Extended Rest recovers it', () => {
    const sheet = trainer()
    const preview = previewItemApDrain({
      sheet,
      cost: { kind: 'ap', resourceId: 'drain', amount: 1, label: 'Drain 1 AP' },
      now: 100,
      round: null,
    })
    expect(preview).toMatchObject({ amount: 1, availableBefore: 7, availableAfter: 6 })
    const reduced = applyItemApDrain({
      sheet,
      operationId: 'op_item_ap_drain_0001',
      canonicalItemId: 'First Aid Kit',
      sourceInstanceId: 'item-instance:trainer:medic:medicalKit:first-aid-row',
      amount: 1,
      availableBefore: 7,
      availableAfter: 6,
      createdAt: 100,
      round: null,
    })
    expect(reduced.ap).toEqual({ max: 7 })
    expect(reduced.featureApState?.drains).toEqual([{
      drainId: itemApDrainId('op_item_ap_drain_0001'),
      sourceInstanceId: 'item-instance:trainer:medic:medicalKit:first-aid-row',
      canonicalId: 'First Aid Kit',
      amount: 1,
      recovery: 'extended-rest',
      createdAt: 100,
    }])
    expect(recoverFeaturesAtExtendedRest(reduced, { now: 200 }).featureApState?.drains).toEqual([])
    expect(sheet.featureApState).toBeUndefined()
  })

  it('corrects AP and target-sheet evidence without pretending the reusable source was restored', () => {
    const before = trainer()
    before.updatedAt = 10
    before.inventory = { medicalKit: [{ id: 'first-aid-row', name: 'First Aid Kit', qty: 1 }] }
    const after = {
      ...applyItemApDrain({
        sheet: before,
        operationId: 'op_item_ap_correct_0001',
        canonicalItemId: 'First Aid Kit',
        sourceInstanceId: 'item-instance:trainer:medic:medicalKit:first-aid-row',
        amount: 1,
        availableBefore: 7,
        availableAfter: 6,
        createdAt: 100,
        round: null,
      }),
      revision: 4,
      updatedAt: 100,
    }
    const plan: ItemOperationPlanV1 = {
      schemaVersion: 1,
      operationId: 'op_item_ap_correct_0001',
      canonicalItemId: 'First Aid Kit',
      canonicalDefinitionSha256: 'a'.repeat(64),
      readSet: [{ kind: 'sheet', sheetKind: 'trainer', id: 'medic', revision: 3 }],
      operations: [{
        operationId: 'actor.ap-drain.1', ordinal: 0, kind: 'resource',
        aggregate: { kind: 'sheet', sheetKind: 'trainer', id: 'medic', revision: 3 },
        subjectId: 'medic', label: 'Drain 1 AP',
        payload: {
          action: 'drain-ap', resourceId: 'ap', amount: 1,
          availableBefore: 7, availableAfter: 6,
          drainId: itemApDrainId('op_item_ap_correct_0001'),
          sourceInstanceId: 'item-instance:trainer:medic:medicalKit:first-aid-row',
          canonicalItemId: 'First Aid Kit', createdAt: 100, round: null,
        },
      }],
      receiptFacts: [],
    }
    const correction = planItemOperationCorrection({
      plan,
      compensation: {
        schemaVersion: 1,
        map: null,
        sheets: [{
          kind: 'trainer', slug: 'medic', beforeRevision: 3, afterRevision: 4,
          beforeSheet: structuredClone(before) as unknown as Record<string, unknown>,
          afterSheet: structuredClone(after) as unknown as Record<string, unknown>,
        }],
        groupInventory: null,
      },
      snapshot: {
        map: null,
        sheets: new Map([['trainer:medic', { kind: 'trainer', slug: 'medic', revision: 4, sheet: after }]]),
        groupInventory: null,
      },
      updatedAt: 200,
    })
    expect(correction.restoredInventory).toBe(false)
    expect((correction.sheets.get('trainer:medic') as TrainerSheet).featureApState).toBeUndefined()
    expect((correction.sheets.get('trainer:medic') as TrainerSheet).inventory?.medicalKit)
      .toEqual([{ id: 'first-aid-row', name: 'First Aid Kit', qty: 1 }])
  })

  it('revalidates expiring temporary AP at commit even when the sheet revision is unchanged', () => {
    const sheet = trainer()
    sheet.ap = { max: 0 }
    sheet.featureApState = {
      schemaVersion: 1,
      max: 0,
      spent: 0,
      bindings: [],
      drains: [],
      temporary: [{
        grantId: 'temporary-ap:test', sourceInstanceId: 'feature:test', amount: 1,
        expiresAtRound: null, expiresAt: 20,
      }],
    }
    const plan: ItemOperationPlanV1 = {
      schemaVersion: 1,
      operationId: 'op_item_ap_expiry_0001',
      canonicalItemId: 'First Aid Kit',
      canonicalDefinitionSha256: 'a'.repeat(64),
      readSet: [{ kind: 'sheet', sheetKind: 'trainer', id: 'medic', revision: 3 }],
      operations: [{
        operationId: 'actor.ap-drain.1', ordinal: 0, kind: 'resource',
        aggregate: { kind: 'sheet', sheetKind: 'trainer', id: 'medic', revision: 3 },
        subjectId: 'medic', label: 'Drain 1 AP',
        payload: {
          action: 'drain-ap', resourceId: 'ap', amount: 1,
          availableBefore: 1, availableAfter: 0,
          drainId: itemApDrainId('op_item_ap_expiry_0001'),
          sourceInstanceId: 'item-instance:trainer:medic:medicalKit:first-aid-row',
          canonicalItemId: 'First Aid Kit', createdAt: 10, round: null,
        },
      }],
      receiptFacts: [],
    }
    const sheets = new Map([['trainer:medic', sheet]])
    expect(() => assertPlannedItemApDrainsCurrent({ plan, sheets, now: 19 })).not.toThrow()
    expect(() => assertPlannedItemApDrainsCurrent({ plan, sheets, now: 20 }))
      .toThrow('requires 1 available AP')
  })
})
