import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { FeatureExecutionRequest, FeatureNativeEffectIntent } from './executeFeature'
import { planFeatureExecution } from './executeFeature'
import type { FeatureAuthoritativeContext, FeatureReadSetEntry } from './context'
import type { TrainerSheet } from '~/types/trainerSheet'

export interface FeatureRollLedgerEntry {
  readonly rollId: string
  readonly expression: string
  readonly rolls: readonly number[]
  readonly total: number
  readonly reasonCode: string
}
export interface FeatureResolutionTraceEntry {
  readonly sequence: number
  readonly phase: 'authority' | 'ownership' | 'resources' | 'mechanics' | 'commit'
  readonly code: string
  readonly sourceInstanceId: string
}
export interface FeatureStatePlan {
  readonly schemaVersion: 1
  readonly planId: string
  readonly requestId: string
  readonly requestHash: string
  readonly canonicalId: string
  readonly sourceInstanceId: string
  readonly readSet: readonly FeatureReadSetEntry[]
  readonly sheetWrite: TrainerSheet
  readonly effects: readonly FeatureNativeEffectIntent[]
  readonly rolls: readonly FeatureRollLedgerEntry[]
  readonly trace: readonly FeatureResolutionTraceEntry[]
  readonly duplicate: boolean
}
export interface FeatureStatePlanResult {
  readonly accepted: boolean
  readonly reasonCode: string | null
  readonly plan: FeatureStatePlan | null
}

const hashRequest = (request: FeatureExecutionRequest): string => createHash('sha256')
  .update(stableJsonStringify(Object.fromEntries(Object.entries(request).filter(([key, value]) => key !== 'exactRetry' && value !== undefined))))
  .digest('hex')

/** Compile a complete optimistic read/write plan; no authoritative object is mutated. */
export const compileFeatureStatePlan = (input: {
  readonly context: FeatureAuthoritativeContext
  readonly request: FeatureExecutionRequest
  readonly conditionSatisfied?: boolean
}): FeatureStatePlanResult => {
  const execution = planFeatureExecution({
    sheet: input.context.trainerSheet,
    request: input.request,
    scope: input.context.scope,
    authorizedActorId: input.context.actorId,
    authorizedTargetIds: input.context.authorizedTargetIds,
    acceptedTriggerEventIds: input.context.acceptedTriggerEventIds,
    authorizedActionTypes: input.context.authorizedActionTypes,
    authorizedChoiceValues: input.context.authorizedChoiceValues,
    conditionSatisfied: input.conditionSatisfied,
  })
  if (!execution.accepted || !execution.canonicalId) return Object.freeze({ accepted: false, reasonCode: execution.reasonCode, plan: null })
  const requestHash = hashRequest(input.request)
  const planId = `feature-plan:${input.request.requestId}`
  const trace: FeatureResolutionTraceEntry[] = [
    { sequence: 1, phase: 'authority', code: 'feature.authority.accepted', sourceInstanceId: execution.sourceInstanceId },
    { sequence: 2, phase: 'ownership', code: 'feature.ownership.effective', sourceInstanceId: execution.sourceInstanceId },
    { sequence: 3, phase: 'resources', code: execution.duplicate ? 'feature.resources.already-settled' : 'feature.resources.settled', sourceInstanceId: execution.sourceInstanceId },
    { sequence: 4, phase: 'mechanics', code: execution.duplicate ? 'feature.retry.duplicate' : 'feature.mechanics.planned', sourceInstanceId: execution.sourceInstanceId },
  ]
  return Object.freeze({ accepted: true, reasonCode: null, plan: Object.freeze({
    schemaVersion: 1,
    planId,
    requestId: input.request.requestId,
    requestHash,
    canonicalId: execution.canonicalId,
    sourceInstanceId: execution.sourceInstanceId,
    readSet: Object.freeze(input.context.readSet.map(entry => Object.freeze({ ...entry }))),
    sheetWrite: execution.sheet,
    effects: execution.effects,
    rolls: Object.freeze([]),
    trace: Object.freeze(trace.map(entry => Object.freeze(entry))),
    duplicate: execution.duplicate,
  }) })
}

export interface FeatureStatePlanCommitResult {
  readonly status: 'committed' | 'duplicate' | 'stale'
  readonly reasonCode: string | null
  readonly sheet: TrainerSheet | null
}

/** Validate all consulted revisions before an outer transaction commits writes. */
export const validateFeatureStatePlanCommit = (input: {
  readonly plan: FeatureStatePlan
  readonly currentRevisions: ReadonlyMap<string, number>
  readonly committedPlanIds: ReadonlySet<string>
}): FeatureStatePlanCommitResult => {
  if (input.committedPlanIds.has(input.plan.planId) || input.plan.duplicate) return Object.freeze({ status: 'duplicate', reasonCode: null, sheet: input.plan.sheetWrite })
  const stale = input.plan.readSet.some(entry => input.currentRevisions.get(entry.resourceId) !== entry.revision)
  if (stale) return Object.freeze({ status: 'stale', reasonCode: 'feature.state.stale', sheet: null })
  return Object.freeze({ status: 'committed', reasonCode: null, sheet: input.plan.sheetWrite })
}
