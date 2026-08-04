import { normalizedFeatureRuntimeState, type FeaturePendingWorkflow, type FeatureRuntimeState } from '#shared/featureAutomation/state'

const stableId = (value: string): boolean => /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/.test(value)
const boundedText = (value: string): boolean => value.trim() === value && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value)

export const createFeaturePendingWorkflow = (input: {
  readonly state: FeatureRuntimeState | undefined
  readonly workflowId: string
  readonly requestId: string
  readonly sourceInstanceId: string
  readonly canonicalId: string
  readonly kind: FeaturePendingWorkflow['kind']
  readonly allowedResponderIds: readonly string[]
  readonly boundedOptionIds: readonly string[]
  readonly createdAt: number
  readonly expiresAt?: number | null
}): FeatureRuntimeState => {
  if (![input.workflowId, input.requestId, input.sourceInstanceId, ...input.allowedResponderIds].every(stableId) || !boundedText(input.canonicalId) || input.allowedResponderIds.length < 1 || input.allowedResponderIds.length > 64 || input.boundedOptionIds.length > 128 || !input.boundedOptionIds.every(boundedText)) throw new Error('Feature pending workflow is invalid.')
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0 || (input.expiresAt != null && (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= input.createdAt))) throw new Error('Feature pending workflow timing is invalid.')
  const state = normalizedFeatureRuntimeState(input.state)
  const prior = state.pending.find(workflow => workflow.workflowId === input.workflowId)
  if (prior) return state
  const workflow: FeaturePendingWorkflow = Object.freeze({ workflowId: input.workflowId, requestId: input.requestId, sourceInstanceId: input.sourceInstanceId, canonicalId: input.canonicalId, kind: input.kind, status: 'pending', allowedResponderIds: Object.freeze([...new Set(input.allowedResponderIds)]), boundedOptionIds: Object.freeze([...new Set(input.boundedOptionIds)]), createdAt: input.createdAt, expiresAt: input.expiresAt ?? null })
  return Object.freeze({ ...state, pending: Object.freeze([...state.pending, workflow].slice(-1024)) })
}

export interface ResolveFeatureWorkflowResult {
  readonly accepted: boolean
  readonly reasonCode: string | null
  readonly state: FeatureRuntimeState
}
export const resolveFeaturePendingWorkflow = (input: {
  readonly state: FeatureRuntimeState | undefined
  readonly workflowId: string
  readonly responderId: string
  readonly resolution: 'resolve' | 'pass' | 'cancel'
  readonly optionId?: string
  readonly now: number
  readonly gmAuthorized?: boolean
}): ResolveFeatureWorkflowResult => {
  const state = normalizedFeatureRuntimeState(input.state)
  const workflow = state.pending.find(candidate => candidate.workflowId === input.workflowId)
  if (!workflow || workflow.status !== 'pending') return { accepted: false, reasonCode: 'feature.workflow.unavailable', state }
  if (workflow.expiresAt !== null && workflow.expiresAt <= input.now) return { accepted: false, reasonCode: 'feature.workflow.expired', state: expireFeaturePendingWorkflows(state, input.now) }
  if (!workflow.allowedResponderIds.includes(input.responderId) && !input.gmAuthorized) return { accepted: false, reasonCode: 'feature.workflow.unauthorized', state }
  if (input.resolution === 'resolve' && workflow.boundedOptionIds.length && (!input.optionId || !workflow.boundedOptionIds.includes(input.optionId))) return { accepted: false, reasonCode: 'feature.workflow.option-invalid', state }
  const status: FeaturePendingWorkflow['status'] = input.resolution === 'resolve' ? 'resolved' : input.resolution === 'pass' ? 'passed' : 'cancelled'
  return { accepted: true, reasonCode: null, state: Object.freeze({ ...state, pending: Object.freeze(state.pending.map(candidate => candidate.workflowId === workflow.workflowId ? Object.freeze({ ...candidate, status }) : candidate)) }) }
}

export const expireFeaturePendingWorkflows = (state: FeatureRuntimeState | undefined, now: number): FeatureRuntimeState => {
  const normalized = normalizedFeatureRuntimeState(state)
  return Object.freeze({ ...normalized, pending: Object.freeze(normalized.pending.map(workflow => workflow.status === 'pending' && workflow.expiresAt !== null && workflow.expiresAt <= now ? Object.freeze({ ...workflow, status: 'expired' as const }) : workflow)) })
}
