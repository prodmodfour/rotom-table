import { describe, expect, it } from 'vitest'
import {
  ItemNonEncounterContextValidationError,
  parseItemNonEncounterExecutionSnapshot,
} from '#shared/itemAutomation/nonEncounter'

const immediate = () => ({
  schemaVersion: 1,
  context: 'campaign',
  campaignTime: { clockRevision: 7, campaignMinute: 4_321 },
  actor: { sheetKind: 'trainer', sheetSlug: 'ash', sheetRevision: 3 },
  targetAuthorities: [{
    targetId: 'sheet-target:v1:pokemon:pikachu',
    sheetKind: 'pokemon',
    sheetSlug: 'pikachu',
    sheetRevision: 2,
    ownerTrainerSlug: 'ash',
    authority: 'actor-roster',
  }],
  extendedAction: {
    mode: 'immediate', phase: 'completion', activityId: null,
    activityRevision: null, startedAtCampaignMinute: null,
  },
  gmConfirmation: { required: false, status: 'not-required', evidenceId: null },
})

describe('non-encounter item execution context contract', () => {
  it('strictly detaches and freezes campaign, actor, ownership, and immediate completion evidence', () => {
    const input = immediate()
    const parsed = parseItemNonEncounterExecutionSnapshot(input)
    expect(parsed).toEqual(input)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.targetAuthorities)).toBe(true)
    input.campaignTime.campaignMinute = 9_999
    expect(parsed.campaignTime.campaignMinute).toBe(4_321)
  })

  it('models an exact durable Extended Action completion boundary', () => {
    const parsed = parseItemNonEncounterExecutionSnapshot({
      ...immediate(),
      context: 'extended-action',
      extendedAction: {
        mode: 'extended', phase: 'completion',
        activityId: 'item-activity:v1:12345678', activityRevision: 2,
        startedAtCampaignMinute: 4_300,
      },
      gmConfirmation: {
        required: true,
        status: 'confirmed',
        evidenceId: 'item-gm-confirmation:operation-12345678',
      },
    })
    expect(parsed.extendedAction).toMatchObject({
      mode: 'extended', phase: 'completion', activityRevision: 2,
      startedAtCampaignMinute: 4_300,
    })
    expect(parsed.gmConfirmation.status).toBe('confirmed')
  })

  it.each([
    [{ ...immediate(), unknown: true }, 'invalid shape'],
    [{ ...immediate(), campaignTime: { clockRevision: 7, campaignMinute: -1 } }, 'safe non-negative integer'],
    [{
      ...immediate(),
      targetAuthorities: [immediate().targetAuthorities[0], immediate().targetAuthorities[0]],
    }, 'unique target'],
    [{
      ...immediate(),
      extendedAction: {
        mode: 'extended', phase: 'completion', activityId: null,
        activityRevision: null, startedAtCampaignMinute: null,
      },
    }, 'only declaration may omit all activity authority'],
    [{
      ...immediate(),
      gmConfirmation: { required: true, status: 'confirmed', evidenceId: null },
    }, 'must carry exactly one evidence'],
  ])('fails closed on malformed or contradictory context evidence', (value, message) => {
    expect(() => parseItemNonEncounterExecutionSnapshot(value)).toThrow(ItemNonEncounterContextValidationError)
    expect(() => parseItemNonEncounterExecutionSnapshot(value)).toThrow(message)
  })
})
