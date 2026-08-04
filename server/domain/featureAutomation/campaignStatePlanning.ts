import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { createFeaturePendingWorkflow } from './workflows'
import { planFeatureCampaignOperation, type FeatureCampaignEffectIntent, type FeatureCampaignRequest, type FeatureCampaignResources } from './campaignOperations'
import type { FeatureReadSetEntry } from './context'
import type { TrainerSheet } from '~/types/trainerSheet'

export interface FeatureCampaignStatePlan {
  readonly schemaVersion: 1
  readonly planId: string
  readonly requestHash: string
  readonly requestId: string
  readonly canonicalId: string
  readonly readSet: readonly FeatureReadSetEntry[]
  readonly sheetWrite: TrainerSheet
  readonly moneyWrite: number
  readonly inventoryWrite: Readonly<Record<string, number>>
  readonly effects: readonly FeatureCampaignEffectIntent[]
  readonly pending: boolean
}
export interface FeatureCampaignStatePlanResult { readonly accepted: boolean, readonly reasonCode: string | null, readonly plan: FeatureCampaignStatePlan | null }

export const compileFeatureCampaignStatePlan = (input: {
  readonly sheet: TrainerSheet
  readonly request: FeatureCampaignRequest
  readonly resources: FeatureCampaignResources
  readonly readSet: readonly FeatureReadSetEntry[]
  readonly gmResponderIds: readonly string[]
  readonly now: number
}): FeatureCampaignStatePlanResult => {
  const planned = planFeatureCampaignOperation({ sheet: input.sheet, request: input.request, resources: input.resources })
  if (!planned.accepted || !planned.canonicalId) return Object.freeze({ accepted: false, reasonCode: planned.reasonCode, plan: null })
  const sheetWrite = structuredClone(input.sheet)
  if (planned.pendingAdjudication) {
    sheetWrite.featureRuntimeState = createFeaturePendingWorkflow({
      state: sheetWrite.featureRuntimeState,
      workflowId: planned.pendingAdjudication.adjudicationId,
      requestId: input.request.requestId,
      sourceInstanceId: input.request.sourceInstanceId,
      canonicalId: planned.canonicalId,
      kind: 'campaign',
      allowedResponderIds: input.gmResponderIds,
      boundedOptionIds: planned.pendingAdjudication.boundedOutputIds,
      createdAt: input.now,
    })
  }
  const inventoryWrite = { ...input.resources.inventory }
  for (const [item, delta] of Object.entries(planned.itemDeltas)) inventoryWrite[item] = Math.max(0, Math.floor(inventoryWrite[item] ?? 0) + delta)
  const requestHash = createHash('sha256').update(stableJsonStringify(Object.fromEntries(Object.entries(input.request).filter(([key, value]) => key !== 'exactRetry' && value !== undefined)))).digest('hex')
  return Object.freeze({ accepted: true, reasonCode: null, plan: Object.freeze({
    schemaVersion: 1,
    planId: `feature-campaign-plan:${input.request.requestId}`,
    requestHash,
    requestId: input.request.requestId,
    canonicalId: planned.canonicalId,
    readSet: Object.freeze(input.readSet.map(entry => Object.freeze({ ...entry }))),
    sheetWrite,
    moneyWrite: input.resources.money + planned.moneyDelta,
    inventoryWrite: Object.freeze(inventoryWrite),
    effects: planned.effects,
    pending: !planned.commitReady,
  }) })
}
