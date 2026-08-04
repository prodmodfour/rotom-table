import campaignJson from '../../../data/feature-automation/campaign-operations.json'
import { resolveEffectiveFeatures } from './effectiveFeatures'
import { resolveFeatureGrants, type FeatureGrantKind } from '#shared/featureAutomation/grants'
import { FEATURE_AUTOMATION_MANIFEST_BY_ID } from '#shared/featureAutomation/manifest'
import type { TrainerSheet } from '~/types/trainerSheet'

export type FeatureCampaignOperationKind = 'craft' | 'tutor' | 'capture' | 'rest' | 'training' | 'adjudication'
export interface FeatureCampaignDefinition {
  readonly canonicalId: string
  readonly sourceEffectSha256: string
  readonly kind: FeatureCampaignOperationKind
  readonly baseMoneyCost: number
  readonly ingredients: string | readonly string[] | null
  readonly outputOptions: readonly string[]
  readonly outputMoneyCosts: Readonly<Record<string, number>>
  readonly requiresAdjudication: boolean
}
interface CampaignCatalog { readonly schemaVersion: 1, readonly entryCount: number, readonly entries: readonly FeatureCampaignDefinition[] }
const catalog = campaignJson as unknown as CampaignCatalog
if (catalog.schemaVersion !== 1 || catalog.entryCount !== catalog.entries.length) throw new Error('Feature campaign catalog is malformed.')
export const FEATURE_CAMPAIGN_DEFINITIONS = Object.freeze(catalog.entries)
const byId = new Map(catalog.entries.map(entry => [entry.canonicalId, entry]))

export interface FeatureCampaignRequest {
  readonly requestId: string
  readonly sourceInstanceId: string
  readonly outputId?: string
  readonly inputItems?: Readonly<Record<string, number>>
  readonly targetIds: readonly string[]
  readonly exactRetry?: boolean
}
export interface FeatureCampaignResources {
  readonly money: number
  readonly inventory: Readonly<Record<string, number>>
  readonly controlledTargetIds: ReadonlySet<string>
  readonly availableMinutes: number
  readonly locationIds: ReadonlySet<string>
  readonly toolIds: ReadonlySet<string>
}
export interface FeatureCampaignEffectIntent {
  readonly effectId: string
  readonly kind: 'grant' | 'craft' | 'capture' | 'rest' | 'training' | 'tutor' | 'adjudication'
  readonly grantKind: FeatureGrantKind | null
  readonly canonicalId: string | null
  readonly targetId: string | null
  readonly sourceInstanceId: string
}
export interface FeatureCampaignPlan {
  readonly accepted: boolean
  readonly reasonCode: string | null
  readonly requestId: string
  readonly canonicalId: string | null
  readonly kind: FeatureCampaignOperationKind | null
  readonly moneyDelta: number
  readonly itemDeltas: Readonly<Record<string, number>>
  readonly targetIds: readonly string[]
  readonly pendingAdjudication: { readonly adjudicationId: string, readonly boundedOutputIds: readonly string[], readonly proposedMoneyDelta: number, readonly proposedItemDeltas: Readonly<Record<string, number>> } | null
  readonly commitReady: boolean
  readonly effects: readonly FeatureCampaignEffectIntent[]
}
const rejected = (requestId: string, reasonCode: string): FeatureCampaignPlan => Object.freeze({ accepted: false, reasonCode, requestId, canonicalId: null, kind: null, moneyDelta: 0, itemDeltas: Object.freeze({}), targetIds: Object.freeze([]), pendingAdjudication: null, commitReady: false, effects: Object.freeze([]) })
const quantity = (resources: FeatureCampaignResources, name: string): number => Math.max(0, Math.floor(resources.inventory[name] ?? 0))

/** Plan campaign writes without mutating sheets or inventory; callers commit atomically. */
export const planFeatureCampaignOperation = (input: {
  readonly sheet: TrainerSheet
  readonly request: FeatureCampaignRequest
  readonly resources: FeatureCampaignResources
}): FeatureCampaignPlan => {
  const feature = resolveEffectiveFeatures({ ownerId: input.sheet.slug, sheet: input.sheet }).instances.find(instance => instance.instanceId === input.request.sourceInstanceId)
  if (!feature?.effective) return rejected(input.request.requestId, 'feature.campaign.source-unavailable')
  const definition = byId.get(feature.canonicalId)
  if (!definition) return rejected(input.request.requestId, 'feature.campaign.operation-unavailable')
  const manifest = FEATURE_AUTOMATION_MANIFEST_BY_ID.get(feature.canonicalId)!
  if (manifest.actions.some(action => action.domain === 'campaign' && action.targetRequired) && input.request.targetIds.length === 0) return rejected(input.request.requestId, 'feature.campaign.target-required')
  if (input.resources.availableMinutes <= 0) return rejected(input.request.requestId, 'feature.campaign.time-unavailable')
  if (input.request.targetIds.length > 32 || new Set(input.request.targetIds).size !== input.request.targetIds.length || input.request.targetIds.some(id => !input.resources.controlledTargetIds.has(id))) return rejected(input.request.requestId, 'feature.campaign.target-unauthorized')
  const inputs = input.request.inputItems ?? {}
  if (Object.keys(inputs).length > 32 || Object.entries(inputs).some(([name, amount]) => !name.trim() || !Number.isSafeInteger(amount) || amount <= 0 || quantity(input.resources, name) < amount)) return rejected(input.request.requestId, 'feature.campaign.ingredients-unavailable')
  if (definition.ingredients && Object.keys(inputs).length === 0) return rejected(input.request.requestId, 'feature.campaign.ingredients-required')
  const output = input.request.outputId
  if (definition.outputOptions.length && (!output || !definition.outputOptions.includes(output))) return rejected(input.request.requestId, 'feature.campaign.output-invalid')
  const cost = output ? definition.outputMoneyCosts[output] ?? definition.baseMoneyCost : definition.baseMoneyCost
  if (cost > input.resources.money) return rejected(input.request.requestId, 'feature.campaign.money-insufficient')
  const itemDeltas: Record<string, number> = Object.fromEntries(Object.entries(inputs).map(([name, amount]) => [name, -amount]))
  if (output) itemDeltas[output] = (itemDeltas[output] ?? 0) + 1
  const proposedMoneyDelta = -cost
  const proposedItemDeltas = Object.freeze(itemDeltas)
  const pendingAdjudication = definition.requiresAdjudication ? Object.freeze({ adjudicationId: `feature-adjudication:${input.request.requestId}`, boundedOutputIds: Object.freeze([...definition.outputOptions]), proposedMoneyDelta, proposedItemDeltas }) : null
  const grantEffects = resolveFeatureGrants(feature.instance).flatMap((grant, grantIndex): FeatureCampaignEffectIntent[] => grant.targetPolicy === 'target-pokemon'
    ? input.request.targetIds.map((targetId, targetIndex) => Object.freeze({ effectId: `${input.request.requestId}:grant:${grantIndex}:${targetIndex}`, kind: 'grant' as const, grantKind: grant.kind, canonicalId: grant.canonicalId, targetId, sourceInstanceId: feature.instanceId }))
    : [])
  const operationEffect: FeatureCampaignEffectIntent = Object.freeze({ effectId: `${input.request.requestId}:operation`, kind: definition.requiresAdjudication ? 'adjudication' : definition.kind, grantKind: null, canonicalId: output ?? null, targetId: input.request.targetIds[0] ?? null, sourceInstanceId: feature.instanceId })
  return Object.freeze({ accepted: true, reasonCode: null, requestId: input.request.requestId, canonicalId: feature.canonicalId, kind: definition.kind, moneyDelta: pendingAdjudication ? 0 : proposedMoneyDelta, itemDeltas: pendingAdjudication ? Object.freeze({}) : proposedItemDeltas, targetIds: Object.freeze([...input.request.targetIds]), pendingAdjudication, commitReady: !pendingAdjudication, effects: Object.freeze(pendingAdjudication ? [] : [...grantEffects, operationEffect]) })
}
