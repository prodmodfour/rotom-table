import { describe, expect, it } from 'vitest'
import type { ItemDurationSpec } from '#shared/itemAutomation/spec'
import {
  ITEM_CAMPAIGN_MINUTES_PER_DAY,
  resolveItemEncounterEffectDuration,
} from '../../server/domain/itemAutomation/durations'

const resolve = (duration: ItemDurationSpec, campaignMinute?: number) => (
  resolveItemEncounterEffectDuration({
    duration,
    ...(campaignMinute === undefined ? {} : { campaignMinute }),
  })
)

describe('authoritative item duration conversion', () => {
  it('maps lifecycle boundaries without consulting ambient time', () => {
    expect(ITEM_CAMPAIGN_MINUTES_PER_DAY).toBe(1_440)
    expect(resolve({ kind: 'turns', amount: 3 })).toEqual({
      kind: 'turns', subject: 'target', boundary: 'end', remaining: 3,
    })
    expect(resolve({ kind: 'rounds', amount: 2 })).toEqual({
      kind: 'rounds', boundary: 'end', remaining: 2,
    })
    expect(resolve({ kind: 'scene', amount: null })).toEqual({ kind: 'scene', remaining: null })
    expect(resolve({ kind: 'encounter', amount: null })).toEqual({ kind: 'encounter', remaining: null })
    expect(resolve({ kind: 'explicit-dismissal', amount: null })).toEqual({
      kind: 'explicit-dismissal', remaining: null,
    })
  })

  it('anchors daily effects to exact persisted campaign minutes', () => {
    expect(resolve({ kind: 'daily', amount: 2 }, 4_321)).toEqual({
      kind: 'campaign-time',
      remaining: null,
      startedAtCampaignMinute: 4_321,
      expiresAtCampaignMinute: 7_201,
      durationMinutes: 2_880,
    })
    expect(() => resolve({ kind: 'daily', amount: 1 })).toThrow(
      'Daily item durations require the authoritative nonnegative campaign minute.',
    )
    expect(() => resolve({ kind: 'daily', amount: 1 }, -1)).toThrow(
      'Daily item durations require the authoritative nonnegative campaign minute.',
    )
    expect(() => resolve({ kind: 'daily', amount: 1 }, Number.MAX_SAFE_INTEGER)).toThrow(
      'Daily item expiry exceeds the safe campaign-minute range.',
    )
  })

  it('fails closed for malformed counted amounts and instant materialization', () => {
    for (const amount of [null, 0, -1, 1.5, Number.NaN]) {
      expect(() => resolve({ kind: 'turns', amount } as ItemDurationSpec)).toThrow(
        'turns item durations require a positive safe integer amount.',
      )
    }
    expect(() => resolve({ kind: 'rounds', amount: 1_000_001 })).toThrow(
      'rounds item duration exceeds the bounded encounter lifecycle range.',
    )
    expect(() => resolve({ kind: 'instant', amount: null })).toThrow(
      'Instant item effects cannot be materialized as durable encounter effects.',
    )
    expect(() => resolve({ kind: 'daily', amount: Number.MAX_SAFE_INTEGER }, 0)).toThrow(
      'Daily item duration exceeds the safe campaign-minute range.',
    )
  })
})
