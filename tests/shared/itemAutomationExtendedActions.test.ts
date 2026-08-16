import { describe, expect, it } from 'vitest'
import {
  parseItemExtendedActionCommand,
  parseItemExtendedActionProjection,
  parseItemExtendedActionResult,
} from '#shared/itemAutomation/extendedActions'

const activityId = 'item-activity:v1:00000000000000000000000000000001'
const operationId = 'item-activity-operation:v1:00000000000000000000000000000002'

const projection = () => ({
  schemaVersion: 1,
  activityId,
  revision: 0,
  status: 'in-progress',
  item: { canonicalId: 'First Aid Kit', label: 'First Aid Kit' },
  actor: { sheetKind: 'trainer', sheetSlug: 'medic', label: 'Rook', href: '/sheets/trainers/medic' },
  target: {
    sheetKind: 'pokemon', sheetSlug: 'volt', label: 'Volt', href: '/sheets/volt',
    summary: 'HP 12 / 46', conditionLabels: ['Burned'],
  },
  startedAtCampaignMinute: 4321,
  updatedAtCampaignMinute: 4321,
  completion: {
    costs: ['Medicine Education check', '1 AP on completion', 'Reusable kit'],
    sourceNotice: 'The kit remains in inventory after accepted completion.',
    safePendingNotice: 'No roll, AP, HP, condition, or inventory change has been applied yet.',
  },
  permissions: { canComplete: true, canInterrupt: true, unavailableReason: null },
  terminal: null,
})

describe('item Extended Action contracts', () => {
  it('strictly parses and freezes start, completion, and interruption commands', () => {
    const start = parseItemExtendedActionCommand({
      schemaVersion: 1,
      kind: 'start',
      operationId,
      activityId,
      settlementOperationId: 'sheet-item:v1:00000000000000000000000000000003',
      trainerSlug: 'medic',
      trainerRevision: 3,
      offerId: 'offer:sheet-item:medic:first-aid',
      targetIds: ['sheet-target:pokemon:volt'],
      choices: [{
        choiceId: 'permanent-move',
        optionIds: ['move-choice:v1:11111111111111111111111111111111'],
      }],
    })
    expect(start).toMatchObject({
      kind: 'start', trainerSlug: 'medic', trainerRevision: 3,
      choices: [{
        choiceId: 'permanent-move',
        optionIds: ['move-choice:v1:11111111111111111111111111111111'],
      }],
    })
    expect(Object.isFrozen(start)).toBe(true)
    expect(parseItemExtendedActionCommand({
      schemaVersion: 1, kind: 'complete', operationId, activityId, expectedRevision: 0,
    })).toMatchObject({ kind: 'complete', expectedRevision: 0 })
    expect(parseItemExtendedActionCommand({
      schemaVersion: 1, kind: 'interrupt', operationId, activityId, expectedRevision: 0,
      reason: 'user-cancelled',
    })).toMatchObject({ kind: 'interrupt', reason: 'user-cancelled' })
  })

  it('rejects extra fields, weak identities, duplicate targets, and unsupported interruption reasons', () => {
    const base = {
      schemaVersion: 1, kind: 'start', operationId, activityId,
      settlementOperationId: 'sheet-item:v1:00000000000000000000000000000003',
      trainerSlug: 'medic', trainerRevision: 3, offerId: 'offer:test', targetIds: ['target:a'],
    }
    expect(() => parseItemExtendedActionCommand({ ...base, extra: true })).toThrow('invalid shape')
    expect(() => parseItemExtendedActionCommand({ ...base, activityId: 'item-activity:v1:weak' })).toThrow('stable identity')
    expect(() => parseItemExtendedActionCommand({ ...base, targetIds: ['target:a', 'target:a'] })).toThrow('unique')
    expect(() => parseItemExtendedActionCommand({
      ...base,
      choices: [
        { choiceId: 'permanent-stat', optionIds: ['atk'] },
        { choiceId: 'permanent-stat', optionIds: ['def'] },
      ],
    })).toThrow('unique choice identities')
    expect(() => parseItemExtendedActionCommand({
      ...base,
      choices: [{ choiceId: 'permanent-stat', optionIds: ['atk', 'atk'] }],
    })).toThrow('unique')
    expect(() => parseItemExtendedActionCommand({
      schemaVersion: 1, kind: 'interrupt', operationId, activityId, expectedRevision: 0, reason: 'maybe',
    })).toThrow('unsupported interruption reason')
  })

  it('parses privacy-safe active and terminal projections while enforcing status invariants', () => {
    expect(parseItemExtendedActionProjection(projection())).toEqual(projection())
    expect(() => parseItemExtendedActionProjection({
      ...projection(),
      status: 'completed',
      permissions: { canComplete: false, canInterrupt: false, unavailableReason: null },
      terminal: null,
    })).toThrow('must match activity status')
    expect(() => parseItemExtendedActionProjection({
      ...projection(),
      permissions: { canComplete: false, canInterrupt: false, unavailableReason: null },
    })).toThrow('requires a reason')
    expect(JSON.stringify(parseItemExtendedActionProjection(projection()))).not.toContain('first-aid-row')
  })

  it('requires an accepted item receipt only for completed results', () => {
    expect(parseItemExtendedActionResult({
      schemaVersion: 1, operationId, activityId, status: 'in-progress', revision: 0,
      exactReplay: false, itemResult: null,
    })).toMatchObject({ status: 'in-progress', itemResult: null })
    expect(() => parseItemExtendedActionResult({
      schemaVersion: 1, operationId, activityId, status: 'completed', revision: 1,
      exactReplay: false, itemResult: null,
    })).toThrow('requires an item result')
    expect(() => parseItemExtendedActionResult({
      schemaVersion: 1, operationId, activityId, status: 'interrupted', revision: 1,
      exactReplay: false, itemResult: { anything: true },
    })).toThrow('cannot carry an item result')
  })
})
