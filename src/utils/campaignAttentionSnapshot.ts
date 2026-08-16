import {
  parseCampaignAttentionProjection,
  type CampaignAttentionProjectionV1,
} from '#shared/campaignAttention/projection'

export interface CampaignAttentionSnapshotState {
  readonly contextKey: string
  readonly latestRequestGeneration: number
  readonly appliedRequestGeneration: number
  readonly projection: CampaignAttentionProjectionV1 | null
}

export interface BegunCampaignAttentionSnapshotRequest {
  readonly state: CampaignAttentionSnapshotState
  readonly requestGeneration: number
}

const contextKey = (value: unknown): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 || /\p{C}/u.test(value)) {
    throw new Error('Campaign attention snapshot context must be one bounded client context key.')
  }
  return value
}

export const createCampaignAttentionSnapshotState = (
  principalContextKey: string,
): CampaignAttentionSnapshotState => Object.freeze({
  contextKey: contextKey(principalContextKey),
  latestRequestGeneration: 0,
  appliedRequestGeneration: 0,
  projection: null,
})

export const beginCampaignAttentionSnapshotRequest = (
  current: CampaignAttentionSnapshotState,
): BegunCampaignAttentionSnapshotRequest => {
  const next = current.latestRequestGeneration + 1
  if (!Number.isSafeInteger(next)) {
    throw new Error('Campaign attention request generation overflowed.')
  }
  return Object.freeze({
    state: Object.freeze({ ...current, latestRequestGeneration: next }),
    requestGeneration: next,
  })
}

export const applyCampaignAttentionSnapshotResponse = (input: {
  readonly current: CampaignAttentionSnapshotState
  readonly contextKey: string
  readonly requestGeneration: number
  readonly projection: unknown
}): CampaignAttentionSnapshotState => {
  const expectedContext = contextKey(input.contextKey)
  if (!Number.isSafeInteger(input.requestGeneration) || input.requestGeneration < 1) {
    throw new Error('Campaign attention response generation must be a positive safe integer.')
  }
  if (expectedContext !== input.current.contextKey
    || input.requestGeneration !== input.current.latestRequestGeneration) {
    return input.current
  }
  const projection = parseCampaignAttentionProjection(input.projection)
  return Object.freeze({
    ...input.current,
    appliedRequestGeneration: input.requestGeneration,
    projection: input.current.projection?.snapshotId === projection.snapshotId
      ? input.current.projection
      : projection,
  })
}

export const resetCampaignAttentionSnapshotContext = (
  current: CampaignAttentionSnapshotState,
  principalContextKey: string,
): CampaignAttentionSnapshotState => {
  const next = contextKey(principalContextKey)
  return next === current.contextKey ? current : createCampaignAttentionSnapshotState(next)
}
