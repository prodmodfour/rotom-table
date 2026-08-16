import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_DAY_MINUTES,
  CampaignDayContractError,
  parseCampaignDayOperationAcceptedV1,
  parseCampaignDayOperationCommandV1,
  parseCampaignNextDayResult,
  projectCampaignNextDayResult,
} from '#shared/campaignDay'

const operationId = 'campaign-day:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const accepted = () => ({
  schemaVersion: 1,
  operationId,
  commandSha256: 'b'.repeat(64),
  ok: true,
  totalSheets: 3,
  updatedSheets: 2,
  pokemonSheets: 2,
  trainerSheets: 1,
  pokemonUpdated: 1,
  trainerUpdated: 1,
  hitPointsRestored: 10,
  injuriesHealed: 2,
  dailyMoveUsesCleared: 1,
  dailyMoveEntriesCleared: 1,
  conditionsCleared: 2,
  trainerApRestored: 3,
  campaignClock: {
    previousRevision: 4,
    revision: 5,
    previousCampaignMinute: 5_760,
    campaignMinute: 7_200,
    minutesAdvanced: CAMPAIGN_DAY_MINUTES,
    clockOperationId: 'breeding-operation:v1:cccccccccccccccccccccccccccccccc',
    reconciledEggs: 2,
    creditedEggCampaignMinutes: 1_440,
    skippedPausedEggCampaignMinutes: 1_440,
    eggBatchComplete: true,
  },
  expiredEffects: [
    {
      mapSlug: 'arena-a', effectId: 'effect.daily.a', durationKind: 'campaign-time',
      expiresAtCampaignMinute: 7_200,
    },
    {
      mapSlug: 'arena-b', effectId: 'effect.daily.b', durationKind: 'campaign-time',
      expiresAtCampaignMinute: 6_000,
    },
  ],
})

const expectContractError = (work: () => unknown, path: string): void => {
  try {
    work()
    expect.unreachable('Expected campaign-day contract rejection')
  }
  catch (error) {
    expect(error).toBeInstanceOf(CampaignDayContractError)
    expect((error as CampaignDayContractError).path).toBe(path)
  }
}

describe('campaign-day v1 contract', () => {
  it('accepts exactly one day under a durable lowercase operation identity', () => {
    const source = {
      schemaVersion: 1,
      operationId,
      kind: 'advance-one-day',
      days: 1,
    }
    const parsed = parseCampaignDayOperationCommandV1(source)
    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)
    expect(Object.isFrozen(parsed)).toBe(true)

    expectContractError(() => parseCampaignDayOperationCommandV1({ ...source, days: 2 }), 'campaignDayCommand')
    expectContractError(() => parseCampaignDayOperationCommandV1({ ...source, operationId: 'campaign-day:v1:ABC' }), 'campaignDayCommand.operationId')
    expectContractError(() => parseCampaignDayOperationCommandV1({ ...source, expectedClockRevision: 4 }), 'campaignDayCommand')
  })

  it('strictly reconciles accepted summary, clock, and sorted expiry evidence', () => {
    const source = accepted()
    const parsed = parseCampaignDayOperationAcceptedV1(source)
    expect(parsed).toEqual(source)
    expect(parsed).not.toBe(source)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.campaignClock)).toBe(true)
    expect(Object.isFrozen(parsed.expiredEffects)).toBe(true)
    expect(projectCampaignNextDayResult(parsed, true)).toEqual({ ...source, replayed: true })
    expect(parseCampaignNextDayResult({ ...source, replayed: false })).toEqual({ ...source, replayed: false })
    expectContractError(() => parseCampaignNextDayResult({ ...source, replayed: false, privatePath: '/tmp' }), 'campaignNextDayResult')

    expectContractError(() => parseCampaignDayOperationAcceptedV1({
      ...source,
      campaignClock: { ...source.campaignClock, minutesAdvanced: 1 },
    }), 'campaignDayResult.campaignClock')
    expectContractError(() => parseCampaignDayOperationAcceptedV1({
      ...source,
      campaignClock: { ...source.campaignClock, eggBatchComplete: false },
    }), 'campaignDayResult.campaignClock.eggBatchComplete')
    expectContractError(() => parseCampaignDayOperationAcceptedV1({
      ...source,
      campaignClock: {
        ...source.campaignClock,
        reconciledEggs: 0,
        creditedEggCampaignMinutes: 1,
      },
    }), 'campaignDayResult.campaignClock')
    expectContractError(() => parseCampaignDayOperationAcceptedV1({
      ...source,
      updatedSheets: 3,
    }), 'campaignDayResult')
    expectContractError(() => parseCampaignDayOperationAcceptedV1({
      ...source,
      pokemonUpdated: 3,
      updatedSheets: 4,
    }), 'campaignDayResult')
    expectContractError(() => parseCampaignDayOperationAcceptedV1({
      ...source,
      expiredEffects: [...source.expiredEffects].reverse(),
    }), 'campaignDayResult.expiredEffects')
    expectContractError(() => parseCampaignDayOperationAcceptedV1({
      ...source,
      expiredEffects: [source.expiredEffects[0], source.expiredEffects[0]],
    }), 'campaignDayResult.expiredEffects')
    expectContractError(() => parseCampaignDayOperationAcceptedV1({
      ...source,
      expiredEffects: [{ ...source.expiredEffects[0], expiresAtCampaignMinute: 7_201 }],
    }), 'campaignDayResult.expiredEffects[0].expiresAtCampaignMinute')
    expectContractError(() => parseCampaignDayOperationAcceptedV1({
      ...source,
      wallClockTimestamp: Date.now(),
    }), 'campaignDayResult')
  })
})
