/**
 * Onboarding realtime events and role projections (P9-019).
 *
 * Two audiences, two access descriptors:
 *  - GM aggregate events on the `onboarding` channel with `gm-only` access.
 *  - Owner events on `onboarding:profile:<profileId>` with
 *    `player-profile-access`, which the platform delivers only to the
 *    matching selected profile.
 *
 * Events are durable rows in the ordinary realtime event log: ordered after
 * commit, replayable, and safe for duplicate delivery. Payloads carry state
 * and identity only — never build choices, comments, or validation detail;
 * clients refetch role-projected documents on receipt.
 */

import { isPlayerProfileId, type PlayerProfileId } from '../playerProfiles'
import {
  isOnboardingDraftState,
  type OnboardingDraftState,
} from './lifecycle'
import {
  OnboardingIdError,
  parseOnboardingDraftId,
  parseOnboardingPolicyId,
  parseOnboardingSlotId,
  type OnboardingDraftId,
  type OnboardingPolicyId,
  type OnboardingSlotId,
} from './ids'

export const onboardingGmChannel = 'onboarding' as const
export const onboardingProfileChannel = (
  profileId: PlayerProfileId,
): `onboarding:profile:${string}` => `onboarding:profile:${profileId}`

export const ONBOARDING_REALTIME_EVENT_TYPES = Object.freeze([
  'onboarding.policy.published',
  'onboarding.slot.changed',
  'onboarding.draft.changed',
  'onboarding.review.changed',
  'onboarding.completed',
] as const)
export type OnboardingRealtimeEventType = typeof ONBOARDING_REALTIME_EVENT_TYPES[number]

export class OnboardingRealtimeContractError extends Error {
  readonly field: string
  constructor(field: string, message: string) {
    super(message)
    this.name = 'OnboardingRealtimeContractError'
    this.field = field
  }
}

/* ------------------------------------------------------------------ */
/* Payloads                                                           */
/* ------------------------------------------------------------------ */

/** GM aggregate: a slot/draft moved through the queue. No private detail. */
export interface OnboardingSlotChangedPayloadV1 {
  readonly schemaVersion: 1
  readonly slotId: OnboardingSlotId
  readonly profileId: PlayerProfileId
  readonly state: OnboardingDraftState | 'unstarted'
  readonly policyVersion: number
  readonly updatedAt: number
}

/** Owner: the durable draft changed somewhere (another tab/device or GM). */
export interface OnboardingDraftChangedPayloadV1 {
  readonly schemaVersion: 1
  readonly draftId: OnboardingDraftId
  readonly slotId: OnboardingSlotId
  readonly revision: number
  readonly state: OnboardingDraftState
  readonly updatedAt: number
  readonly clientId: string | null
}

/** Owner: review state moved (changes requested, correction, approval). */
export interface OnboardingReviewChangedPayloadV1 {
  readonly schemaVersion: 1
  readonly draftId: OnboardingDraftId
  readonly slotId: OnboardingSlotId
  readonly state: OnboardingDraftState
  readonly submissionRevision: number
  readonly updatedAt: number
}

/** Published policy version identity (GM aggregate). */
export interface OnboardingPolicyPublishedPayloadV1 {
  readonly schemaVersion: 1
  readonly policyId: OnboardingPolicyId
  readonly version: number
  readonly publishedAt: number
}

/** Completion: the package is authoritative; both audiences get a variant. */
export interface OnboardingCompletedPayloadV1 {
  readonly schemaVersion: 1
  readonly slotId: OnboardingSlotId
  readonly profileId: PlayerProfileId
  readonly trainerSlug: string
  readonly pokemonSlugs: readonly string[]
  readonly completionRecordId: string
  readonly completedAt: number
}

/* ------------------------------------------------------------------ */
/* Parsing                                                            */
/* ------------------------------------------------------------------ */

type UnknownRecord = Record<string, unknown>
const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const expect = (condition: boolean, field: string, message: string): void => {
  if (!condition) throw new OnboardingRealtimeContractError(field, message)
}

const expectPayload = (value: unknown, label: string): UnknownRecord => {
  expect(isRecord(value), label, `${label} must be an object`)
  const record = value as UnknownRecord
  expect(record.schemaVersion === 1, `${label}.schemaVersion`, `${label}.schemaVersion must be 1`)
  return record
}

const expectTimestamp = (value: unknown, field: string): number => {
  expect(typeof value === 'number' && Number.isFinite(value) && value > 0, field, `${field} must be a positive timestamp`)
  return value as number
}

const expectNonNegativeInt = (value: unknown, field: string): number => {
  expect(typeof value === 'number' && Number.isInteger(value) && value >= 0, field, `${field} must be a non-negative integer`)
  return value as number
}

const parseIds = <T>(fn: () => T, label: string): T => {
  try {
    return fn()
  } catch (error) {
    throw new OnboardingRealtimeContractError(label, error instanceof OnboardingIdError ? error.message : 'invalid identifier')
  }
}

export const parseOnboardingSlotChangedPayload = (value: unknown, label = 'slotChanged'): OnboardingSlotChangedPayloadV1 => {
  const record = expectPayload(value, label)
  const slotId = parseIds(() => parseOnboardingSlotId(record.slotId, `${label}.slotId`), label)
  expect(isPlayerProfileId(record.profileId), `${label}.profileId`, 'must be a player profile ID')
  const state = record.state
  expect(state === 'unstarted' || isOnboardingDraftState(state), `${label}.state`, 'must be a draft state or unstarted')
  return {
    schemaVersion: 1,
    slotId,
    profileId: record.profileId as PlayerProfileId,
    state: state as OnboardingDraftState | 'unstarted',
    policyVersion: expectNonNegativeInt(record.policyVersion, `${label}.policyVersion`),
    updatedAt: expectTimestamp(record.updatedAt, `${label}.updatedAt`),
  }
}

export const parseOnboardingDraftChangedPayload = (value: unknown, label = 'draftChanged'): OnboardingDraftChangedPayloadV1 => {
  const record = expectPayload(value, label)
  const draftId = parseIds(() => parseOnboardingDraftId(record.draftId, `${label}.draftId`), label)
  const slotId = parseIds(() => parseOnboardingSlotId(record.slotId, `${label}.slotId`), label)
  expect(isOnboardingDraftState(record.state), `${label}.state`, 'must be a draft state')
  const clientId = record.clientId ?? null
  expect(clientId === null || (typeof clientId === 'string' && clientId.length <= 100), `${label}.clientId`, 'must be a bounded string or null')
  return {
    schemaVersion: 1,
    draftId,
    slotId,
    revision: expectNonNegativeInt(record.revision, `${label}.revision`),
    state: record.state as OnboardingDraftState,
    updatedAt: expectTimestamp(record.updatedAt, `${label}.updatedAt`),
    clientId: clientId as string | null,
  }
}

export const parseOnboardingReviewChangedPayload = (value: unknown, label = 'reviewChanged'): OnboardingReviewChangedPayloadV1 => {
  const record = expectPayload(value, label)
  const draftId = parseIds(() => parseOnboardingDraftId(record.draftId, `${label}.draftId`), label)
  const slotId = parseIds(() => parseOnboardingSlotId(record.slotId, `${label}.slotId`), label)
  expect(isOnboardingDraftState(record.state), `${label}.state`, 'must be a draft state')
  return {
    schemaVersion: 1,
    draftId,
    slotId,
    state: record.state as OnboardingDraftState,
    submissionRevision: expectNonNegativeInt(record.submissionRevision, `${label}.submissionRevision`),
    updatedAt: expectTimestamp(record.updatedAt, `${label}.updatedAt`),
  }
}

export const parseOnboardingPolicyPublishedPayload = (value: unknown, label = 'policyPublished'): OnboardingPolicyPublishedPayloadV1 => {
  const record = expectPayload(value, label)
  const policyId = parseIds(() => parseOnboardingPolicyId(record.policyId, `${label}.policyId`), label)
  return {
    schemaVersion: 1,
    policyId,
    version: expectNonNegativeInt(record.version, `${label}.version`),
    publishedAt: expectTimestamp(record.publishedAt, `${label}.publishedAt`),
  }
}

export const parseOnboardingCompletedPayload = (value: unknown, label = 'completed'): OnboardingCompletedPayloadV1 => {
  const record = expectPayload(value, label)
  const slotId = parseIds(() => parseOnboardingSlotId(record.slotId, `${label}.slotId`), label)
  expect(isPlayerProfileId(record.profileId), `${label}.profileId`, 'must be a player profile ID')
  expect(typeof record.trainerSlug === 'string' && record.trainerSlug.length > 0, `${label}.trainerSlug`, 'must be a slug')
  expect(Array.isArray(record.pokemonSlugs) && record.pokemonSlugs.length <= 6, `${label}.pokemonSlugs`, 'must be an array of at most 6 slugs')
  expect(typeof record.completionRecordId === 'string' && record.completionRecordId.length > 0, `${label}.completionRecordId`, 'must be present')
  return {
    schemaVersion: 1,
    slotId,
    profileId: record.profileId as PlayerProfileId,
    trainerSlug: record.trainerSlug as string,
    pokemonSlugs: (record.pokemonSlugs as unknown[]).map(String),
    completionRecordId: record.completionRecordId as string,
    completedAt: expectTimestamp(record.completedAt, `${label}.completedAt`),
  }
}

/* ------------------------------------------------------------------ */
/* Projection rules                                                   */
/* ------------------------------------------------------------------ */

/**
 * Which audience sees which event type. This is the executable statement of
 * the P9-006 projection contract for realtime.
 */
export const ONBOARDING_EVENT_AUDIENCES: Readonly<Record<OnboardingRealtimeEventType, readonly ('gm' | 'owner')[]>> = Object.freeze({
  'onboarding.policy.published': ['gm'],
  'onboarding.slot.changed': ['gm'],
  'onboarding.draft.changed': ['owner'],
  'onboarding.review.changed': ['owner'],
  'onboarding.completed': ['gm', 'owner'],
})
