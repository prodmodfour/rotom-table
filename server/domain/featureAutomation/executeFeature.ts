import { createHash } from 'node:crypto'
import type { FeatureMechanicDeclaration } from '#shared/featureAutomation/spec'
import { normalizedFeatureRuntimeState } from '#shared/featureAutomation/state'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { FeatureResourceScope } from './resources'
import { settleFeatureDeclarationResources } from './resources'
import { resolveEffectiveFeatures } from './effectiveFeatures'
import type { TrainerSheet } from '~/types/trainerSheet'

export interface FeatureExecutionRequest {
  readonly requestId: string
  readonly sourceInstanceId: string
  readonly actionId: 'execute'
  readonly actorId: string
  readonly targetIds: readonly string[]
  readonly choiceValues: Readonly<Record<string, readonly string[]>>
  readonly triggerEventId?: string
  readonly variableApAmount?: number
  readonly exactRetry?: boolean
}
export interface FeatureNativeEffectIntent {
  readonly effectId: string
  readonly canonicalId: string
  readonly sourceInstanceId: string
  readonly mechanic: FeatureMechanicDeclaration
  readonly actorId: string
  readonly targetIds: readonly string[]
  readonly choiceValues: Readonly<Record<string, readonly string[]>>
  readonly triggerEventId: string | null
}
export interface FeatureExecutionPlan {
  readonly accepted: boolean
  readonly reasonCode: string | null
  readonly requestId: string
  readonly canonicalId: string | null
  readonly sourceInstanceId: string
  readonly effects: readonly FeatureNativeEffectIntent[]
  readonly sheet: TrainerSheet
  readonly duplicate: boolean
}
const reject = (request: FeatureExecutionRequest, reasonCode: string): FeatureExecutionPlan => Object.freeze({ accepted: false, reasonCode, requestId: request.requestId, canonicalId: null, sourceInstanceId: request.sourceInstanceId, effects: Object.freeze([]), sheet: null as never, duplicate: false })
const boundedChoices = (value: Readonly<Record<string, readonly string[]>>): boolean => Object.entries(value).length <= 16 && Object.entries(value).every(([key, values]) => /^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/.test(key) && values.length <= 32 && new Set(values).size === values.length && values.every(item => typeof item === 'string' && item.trim() === item && item.length > 0 && item.length <= 160 && !/[\u0000-\u001f\u007f]/.test(item)))
const actionChoicesAuthorized = (definitions: readonly { id: string, minimum: number, maximum: number }[], selected: Readonly<Record<string, readonly string[]>>, authorized: ReadonlyMap<string, ReadonlySet<string>> | undefined): boolean => {
  if (Object.keys(selected).some(choiceId => !definitions.some(definition => definition.id === choiceId))) return false
  return definitions.every(definition => {
    const values = selected[definition.id] ?? []
    const offers = authorized?.get(definition.id)
    return values.length >= definition.minimum && values.length <= definition.maximum && Boolean(offers) && values.every(value => offers!.has(value))
  })
}

/**
 * Authoritative declaration boundary. Owning reducers consume the returned
 * hash-bound intents; clients can select only server-offered targets/choices.
 */
export const planFeatureExecution = (input: {
  readonly sheet: TrainerSheet
  readonly request: FeatureExecutionRequest
  readonly scope: FeatureResourceScope
  readonly authorizedActorId: string
  readonly authorizedTargetIds: ReadonlySet<string>
  readonly acceptedTriggerEventIds?: ReadonlySet<string>
  readonly authorizedActionTypes?: ReadonlySet<string>
  readonly authorizedChoiceValues?: ReadonlyMap<string, ReadonlySet<string>>
  readonly conditionSatisfied?: boolean
}): FeatureExecutionPlan => {
  const rejected = (code: string): FeatureExecutionPlan => ({ ...reject(input.request, code), sheet: input.sheet })
  if (!/^[A-Za-z0-9]+(?:[._:/-][A-Za-z0-9]+)*$/.test(input.request.requestId)) return rejected('feature.request.invalid')
  const runtime = normalizedFeatureRuntimeState(input.sheet.featureRuntimeState)
  const requestHash = createHash('sha256').update(stableJsonStringify(Object.fromEntries(Object.entries(input.request).filter(([key, value]) => key !== 'exactRetry' && value !== undefined)))).digest('hex')
  const priorReceipt = runtime.receipts.find(receipt => receipt.requestId === input.request.requestId)
  if (priorReceipt && priorReceipt.requestHash !== requestHash) return rejected('feature.retry.conflict')
  if (input.request.actorId !== input.authorizedActorId) return rejected('feature.actor.unauthorized')
  if (!boundedChoices(input.request.choiceValues)) return rejected('feature.choices.invalid')
  if (input.request.targetIds.length > 32 || new Set(input.request.targetIds).size !== input.request.targetIds.length || input.request.targetIds.some(id => !input.authorizedTargetIds.has(id))) return rejected('feature.targets.unauthorized')
  if (priorReceipt) return Object.freeze({ accepted: true, reasonCode: null, requestId: input.request.requestId, canonicalId: priorReceipt.canonicalId, sourceInstanceId: priorReceipt.sourceInstanceId, effects: Object.freeze([]), sheet: input.sheet, duplicate: true })
  const feature = resolveEffectiveFeatures({ ownerId: input.sheet.slug, sheet: input.sheet }).instances.find(instance => instance.instanceId === input.request.sourceInstanceId)
  if (!feature?.effective) return rejected('feature.source.unavailable')
  const action = feature.actions.find(candidate => candidate.id === input.request.actionId)
  if (!action) return rejected('feature.action.unavailable')
  if (!actionChoicesAuthorized(action.choices, input.request.choiceValues, input.authorizedChoiceValues)) return rejected('feature.choices.unauthorized')
  if (action.targetRequired && input.request.targetIds.length === 0) return rejected('feature.target.required')
  if (action.conditionRequired && input.conditionSatisfied !== true) return rejected('feature.condition.unmet')
  if (action.frequency.action && input.authorizedActionTypes && !input.authorizedActionTypes.has(action.frequency.action)) return rejected('feature.action-economy.unavailable')
  if (action.triggered && (!input.request.triggerEventId || !input.acceptedTriggerEventIds?.has(input.request.triggerEventId))) return rejected('feature.trigger.invalid')
  const settlement = settleFeatureDeclarationResources({ sheet: input.sheet, canonicalId: feature.canonicalId, sourceInstanceId: feature.instanceId, frequency: action.frequency, scope: input.scope, variableApAmount: input.request.variableApAmount, retryAlreadySettled: Boolean(priorReceipt), operationId: input.request.requestId })
  if (!settlement.accepted) return rejected(settlement.code ?? 'feature.resources.unavailable')
  const next = structuredClone(input.sheet)
  next.featureApState = settlement.apState
  next.featureUsage = settlement.usage
  next.featureRuntimeState = Object.freeze({ ...runtime, receipts: Object.freeze([...runtime.receipts, Object.freeze({ requestId: input.request.requestId, requestHash, canonicalId: feature.canonicalId, sourceInstanceId: feature.instanceId, acceptedAt: input.scope.now })].slice(-4096)) })
  const effects = feature.mechanics.filter(mechanic => ['action-provider', 'event-subscription', 'campaign-operation'].includes(mechanic.kind)).map((mechanic, index): FeatureNativeEffectIntent => Object.freeze({ effectId: `${input.request.requestId}:${index}`, canonicalId: feature.canonicalId, sourceInstanceId: feature.instanceId, mechanic, actorId: input.request.actorId, targetIds: Object.freeze([...input.request.targetIds]), choiceValues: Object.freeze({ ...input.request.choiceValues }), triggerEventId: input.request.triggerEventId ?? null }))
  return Object.freeze({ accepted: true, reasonCode: null, requestId: input.request.requestId, canonicalId: feature.canonicalId, sourceInstanceId: feature.instanceId, effects: Object.freeze(effects), sheet: next, duplicate: false })
}
