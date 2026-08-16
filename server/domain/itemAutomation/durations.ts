import durationAuthorityJson from '~~/data/complete-play-loop/duration-authority.v1.json'
import { CAMPAIGN_DAY_MINUTES } from '#shared/campaignDay'
import type { ItemDurationSpec } from '#shared/itemAutomation/spec'
import {
  ENCOUNTER_EFFECT_LIMITS,
  type EncounterEffectDuration,
} from '#shared/moveAutomation/encounterEffects'

interface ReviewedItemDurationAuthorityV1 {
  readonly schemaVersion: 1
  readonly authorityId: 'complete-play-loop-item-duration-authority-v1'
  readonly status: 'reviewed'
  readonly campaignClock: {
    readonly authority: 'singleton-campaign-clock'
    readonly unit: 'campaign-minute'
    readonly campaignMinutesPerDay: number
    readonly allowedInputs: readonly string[]
    readonly forbiddenInputs: readonly string[]
    readonly expiryRepresentation: 'absolute-start-plus-duration-campaign-minute'
    readonly sourceEvidence: readonly { readonly path: string, readonly sha256: string }[]
  }
  readonly boundaries: {
    readonly turns: 'authoritative-initiative-turn-boundary'
    readonly rounds: 'authoritative-initiative-round-boundary'
    readonly scene: 'scene-end'
    readonly encounter: 'encounter-end'
    readonly daily: 'campaign-time-advanced'
    readonly 'explicit-dismissal': 'effect-removed'
  }
  readonly cleanup: {
    readonly switchOrRecall: 'effect-transfer-policy'
    readonly encounterEndAlsoExpires: readonly string[]
    readonly sceneAndEncounterAreDistinct: true
    readonly lifecycleBudgetBypassAllowed: false
  }
}

const authority = durationAuthorityJson as ReviewedItemDurationAuthorityV1
const exactArray = (actual: readonly string[], expected: readonly string[]): boolean => (
  Array.isArray(actual)
  && actual.length === expected.length
  && actual.every((value, index) => value === expected[index])
)
if (authority.schemaVersion !== 1
  || authority.authorityId !== 'complete-play-loop-item-duration-authority-v1'
  || authority.status !== 'reviewed'
  || authority.campaignClock.authority !== 'singleton-campaign-clock'
  || authority.campaignClock.unit !== 'campaign-minute'
  || !exactArray(authority.campaignClock.allowedInputs, ['campaign-clock-repository'])
  || !exactArray(authority.campaignClock.forbiddenInputs, [
    'browser-clock', 'wall-clock', 'process-uptime', 'scene-time',
    'encounter-time', 'initiative-time', 'timezone-or-calendar',
  ])
  || !Array.isArray(authority.campaignClock.sourceEvidence)
  || !exactArray(authority.campaignClock.sourceEvidence.map(evidence => `${evidence?.path}:${evidence?.sha256}`), [
    'data/breeding-automation/campaign-clock-contract.json:2a1d6a2dd918df34e9f8058758e909579f6067bbba9d7327a93d9b8701aecd1e',
    'data/breeding-automation/hatch-duration-policy.json:56578c840a7a518dc57ec3a49c9e80e3acf617d4b541ed6f0935ea40afa8ca38',
    'data/breeding-automation/ruleset.json:e33d629f871bfcde02a426df14cb525a45d56f932f4dfbaab6d0819bd8ae5364',
  ])
  || authority.campaignClock.expiryRepresentation !== 'absolute-start-plus-duration-campaign-minute'
  || authority.boundaries.turns !== 'authoritative-initiative-turn-boundary'
  || authority.boundaries.rounds !== 'authoritative-initiative-round-boundary'
  || authority.boundaries.scene !== 'scene-end'
  || authority.boundaries.encounter !== 'encounter-end'
  || authority.boundaries.daily !== 'campaign-time-advanced'
  || authority.boundaries['explicit-dismissal'] !== 'effect-removed'
  || authority.cleanup.switchOrRecall !== 'effect-transfer-policy'
  || !exactArray(authority.cleanup.encounterEndAlsoExpires, ['turns', 'rounds', 'encounter'])
  || authority.cleanup.sceneAndEncounterAreDistinct !== true
  || authority.cleanup.lifecycleBudgetBypassAllowed !== false) {
  throw new Error('Reviewed item duration authority is invalid or incomplete.')
}

export const ITEM_CAMPAIGN_MINUTES_PER_DAY = (() => {
  const value = authority.campaignClock.campaignMinutesPerDay
  if (!Number.isSafeInteger(value) || value !== CAMPAIGN_DAY_MINUTES) {
    throw new Error(`Reviewed item campaign minutes per day must equal the v1 campaign-day contract (${CAMPAIGN_DAY_MINUTES}).`)
  }
  return value
})()

const countedAmount = (duration: ItemDurationSpec): number => {
  if (!Number.isSafeInteger(duration.amount) || Number(duration.amount) < 1) {
    throw new Error(`${duration.kind} item durations require a positive safe integer amount.`)
  }
  return Number(duration.amount)
}

/**
 * Convert reviewed item duration semantics into durable encounter-effect authority.
 * No ambient clock is consulted: callers must supply the persisted campaign minute
 * when materializing a daily effect.
 */
export const resolveItemEncounterEffectDuration = (input: {
  readonly duration: ItemDurationSpec
  readonly campaignMinute?: number
}): EncounterEffectDuration => {
  const { duration } = input
  if (duration.kind === 'turns' || duration.kind === 'rounds') {
    const amount = countedAmount(duration)
    if (amount > ENCOUNTER_EFFECT_LIMITS.turn) {
      throw new Error(`${duration.kind} item duration exceeds the bounded encounter lifecycle range.`)
    }
    return duration.kind === 'turns'
      ? { kind: 'turns', subject: 'target', boundary: 'end', remaining: amount }
      : { kind: 'rounds', boundary: 'end', remaining: amount }
  }
  if (duration.kind === 'scene') return { kind: 'scene', remaining: null }
  if (duration.kind === 'encounter') return { kind: 'encounter', remaining: null }
  if (duration.kind === 'explicit-dismissal') return { kind: 'explicit-dismissal', remaining: null }
  if (duration.kind === 'daily') {
    const campaignMinute = input.campaignMinute
    if (!Number.isSafeInteger(campaignMinute) || Number(campaignMinute) < 0) {
      throw new Error('Daily item durations require the authoritative nonnegative campaign minute.')
    }
    const days = countedAmount(duration)
    if (days > Math.floor(Number.MAX_SAFE_INTEGER / ITEM_CAMPAIGN_MINUTES_PER_DAY)) {
      throw new Error('Daily item duration exceeds the safe campaign-minute range.')
    }
    const durationMinutes = days * ITEM_CAMPAIGN_MINUTES_PER_DAY
    if (Number(campaignMinute) > Number.MAX_SAFE_INTEGER - durationMinutes) {
      throw new Error('Daily item expiry exceeds the safe campaign-minute range.')
    }
    return {
      kind: 'campaign-time',
      remaining: null,
      startedAtCampaignMinute: Number(campaignMinute),
      expiresAtCampaignMinute: Number(campaignMinute) + durationMinutes,
      durationMinutes,
    }
  }
  throw new Error('Instant item effects cannot be materialized as durable encounter effects.')
}
