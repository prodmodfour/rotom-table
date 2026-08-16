import {
  parseCampaignContinuationProjection,
  type CampaignContinuationProjectionV1,
} from '#shared/campaignContinuation'

export interface CampaignContinuationSnapshotState {
  readonly contextKey: string
  readonly latestRequestGeneration: number
  readonly appliedRequestGeneration: number
  readonly projection: CampaignContinuationProjectionV1 | null
}

export interface BegunCampaignContinuationSnapshotRequest {
  readonly state: CampaignContinuationSnapshotState
  readonly requestGeneration: number
}

const contextKey = (value: unknown): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 || /\p{C}/u.test(value)) {
    throw new Error('Campaign continuation snapshot context must be one bounded client context key.')
  }
  return value
}

export const createCampaignContinuationSnapshotState = (
  principalContextKey: string,
): CampaignContinuationSnapshotState => Object.freeze({
  contextKey: contextKey(principalContextKey),
  latestRequestGeneration: 0,
  appliedRequestGeneration: 0,
  projection: null,
})

export const beginCampaignContinuationSnapshotRequest = (
  current: CampaignContinuationSnapshotState,
): BegunCampaignContinuationSnapshotRequest => {
  const next = current.latestRequestGeneration + 1
  if (!Number.isSafeInteger(next)) throw new Error('Campaign continuation request generation overflowed.')
  return Object.freeze({
    state: Object.freeze({ ...current, latestRequestGeneration: next }),
    requestGeneration: next,
  })
}

export const applyCampaignContinuationSnapshotResponse = (input: {
  readonly current: CampaignContinuationSnapshotState
  readonly contextKey: string
  readonly requestGeneration: number
  readonly projection: unknown
}): CampaignContinuationSnapshotState => {
  const expectedContext = contextKey(input.contextKey)
  if (!Number.isSafeInteger(input.requestGeneration) || input.requestGeneration < 1) {
    throw new Error('Campaign continuation response generation must be a positive safe integer.')
  }
  if (expectedContext !== input.current.contextKey
    || input.requestGeneration !== input.current.latestRequestGeneration) return input.current
  const projection = parseCampaignContinuationProjection(input.projection)
  return Object.freeze({
    ...input.current,
    appliedRequestGeneration: input.requestGeneration,
    projection: input.current.projection?.snapshotId === projection.snapshotId
      ? input.current.projection
      : projection,
  })
}

export const resetCampaignContinuationSnapshotContext = (
  current: CampaignContinuationSnapshotState,
  principalContextKey: string,
): CampaignContinuationSnapshotState => {
  const next = contextKey(principalContextKey)
  return next === current.contextKey ? current : createCampaignContinuationSnapshotState(next)
}
