import type { FeatureFrequencyDefinition } from '#shared/featureAutomation/manifest'
import { emptyFeatureApState, featureApAvailable, normalizedFeatureApState, normalizedFeatureUsageLedger, type FeatureApBinding, type FeatureApDrain, type FeatureApState, type FeatureUsageLedger } from '#shared/featureAutomation/state'
import type { TrainerSheet } from '~/types/trainerSheet'

export interface FeatureResourceScope {
  readonly turnId?: string
  readonly roundId?: string
  readonly sceneId?: string
  readonly dayId?: string
  readonly campaignId: string
  readonly targetId?: string
  readonly now: number
  readonly roundNumber: number | null
}
export interface FeatureResourceSettlement {
  readonly accepted: boolean
  readonly code: string | null
  readonly apState: FeatureApState
  readonly usage: FeatureUsageLedger
}

export const trainerFeatureApMaximum = (sheet: TrainerSheet): number => Math.max(0, Math.floor(sheet.ap?.max ?? (5 + Math.floor(Math.max(1, sheet.level || 1) / 5))))
export const resolveTrainerFeatureApState = (sheet: TrainerSheet): FeatureApState => {
  if (sheet.featureApState?.schemaVersion === 1) return normalizedFeatureApState(sheet.featureApState, trainerFeatureApMaximum(sheet))
  const state = emptyFeatureApState(trainerFeatureApMaximum(sheet))
  return Object.freeze({
    ...state,
    spent: Math.max(0, Math.floor(sheet.ap?.spent ?? 0)),
    bindings: Object.freeze((sheet.ap?.bound ?? 0) > 0 ? [{
      bindingId: 'legacy:bound', sourceInstanceId: 'legacy', canonicalId: 'legacy',
      amount: Math.floor(sheet.ap!.bound!), release: 'manual' as const, createdAt: 0,
    }] : []),
    drains: Object.freeze((sheet.ap?.drained ?? 0) > 0 ? [{
      drainId: 'legacy:drained', sourceInstanceId: 'legacy', canonicalId: 'legacy',
      amount: Math.floor(sheet.ap!.drained!), recovery: 'extended-rest' as const, createdAt: 0,
    }] : []),
  })
}
const usageScope = (frequency: FeatureFrequencyDefinition, scope: FeatureResourceScope): { scope: 'round' | 'scene' | 'day' | 'campaign', scopeId: string } | null => {
  if (frequency.mode === 'eot') return scope.roundNumber !== null ? { scope: 'round', scopeId: `round:${scope.roundNumber}` } : null
  if (frequency.mode === 'scene') return scope.sceneId ? { scope: 'scene', scopeId: scope.sceneId } : null
  if (frequency.mode === 'daily') return scope.dayId ? { scope: 'day', scopeId: scope.dayId } : null
  if (frequency.mode === 'one-time') return { scope: 'campaign', scopeId: scope.campaignId }
  return null
}

export const settleFeatureDeclarationResources = (input: {
  readonly sheet: TrainerSheet
  readonly canonicalId: string
  readonly sourceInstanceId: string
  readonly frequency: FeatureFrequencyDefinition
  readonly scope: FeatureResourceScope
  readonly variableApAmount?: number
  readonly retryAlreadySettled?: boolean
  readonly operationId?: string
}): FeatureResourceSettlement => {
  const ap = resolveTrainerFeatureApState(input.sheet)
  const usage = normalizedFeatureUsageLedger(input.sheet.featureUsage)
  if (input.retryAlreadySettled) return { accepted: true, code: null, apState: ap, usage }
  const usageKey = usageScope(input.frequency, input.scope)
  if ((input.frequency.mode === 'scene' && !input.scope.sceneId) || (input.frequency.mode === 'daily' && !input.scope.dayId) || (input.frequency.mode === 'eot' && input.scope.roundNumber === null)) return { accepted: false, code: 'feature.frequency.scope-missing', apState: ap, usage }
  const used = usageKey ? usage.entries.filter(entry => entry.sourceInstanceId === input.sourceInstanceId && entry.scope === usageKey.scope && entry.scopeId === usageKey.scopeId && (!input.scope.targetId || entry.targetId === input.scope.targetId)).reduce((sum, entry) => sum + entry.uses, 0) : 0
  const roundNumber = input.scope.roundNumber
  if (input.frequency.mode === 'eot' && roundNumber !== null && usage.entries.some(entry => (
    entry.sourceInstanceId === input.sourceInstanceId
    && entry.scope === 'round'
    && entry.scopeId === `round:${roundNumber - 1}`
  ))) return { accepted: false, code: 'feature.frequency.eot', apState: ap, usage }
  const usageLimit = input.frequency.mode === 'eot' ? 1 : input.frequency.uses
  if (usageKey && usageLimit !== null && used >= usageLimit) return { accepted: false, code: 'feature.frequency.exhausted', apState: ap, usage }
  const payment = input.frequency.payment
  const amount = payment ? payment.variable ? Math.max(0, Math.floor(input.variableApAmount ?? -1)) : payment.amount ?? 0 : 0
  if (payment?.variable && input.variableApAmount === undefined) return { accepted: false, code: 'feature.ap.variable-required', apState: ap, usage }
  if (amount > featureApAvailable(ap, input.scope.now, input.scope.roundNumber)) return { accepted: false, code: 'feature.ap.insufficient', apState: ap, usage }

  const suffix = `${input.sourceInstanceId}:${input.operationId ?? input.scope.now}`
  const bindings: readonly FeatureApBinding[] = payment?.mode === 'bind' && amount > 0 ? Object.freeze([...ap.bindings, Object.freeze({ bindingId: `feature-bind:${suffix}`, sourceInstanceId: input.sourceInstanceId, canonicalId: input.canonicalId, amount, release: 'effect-end' as const, createdAt: input.scope.now })]) : ap.bindings
  const drains: readonly FeatureApDrain[] = payment?.mode === 'drain' && amount > 0 ? Object.freeze([...ap.drains, Object.freeze({ drainId: `feature-drain:${suffix}`, sourceInstanceId: input.sourceInstanceId, canonicalId: input.canonicalId, amount, recovery: 'extended-rest' as const, createdAt: input.scope.now })]) : ap.drains
  const apState = Object.freeze({ ...ap, spent: payment?.mode === 'spend' ? ap.spent + amount : ap.spent, bindings, drains })
  const entries = usageKey ? Object.freeze([...usage.entries, Object.freeze({ sourceInstanceId: input.sourceInstanceId, canonicalId: input.canonicalId, scope: usageKey.scope, scopeId: usageKey.scopeId, uses: 1, ...(input.scope.targetId ? { targetId: input.scope.targetId } : {}), updatedAt: input.scope.now })]) : usage.entries
  return { accepted: true, code: null, apState, usage: Object.freeze({ schemaVersion: 1, entries }) }
}

export const releaseFeatureBindings = (state: FeatureApState, predicate: (binding: FeatureApBinding) => boolean): FeatureApState => Object.freeze({ ...state, bindings: Object.freeze(state.bindings.filter(binding => !predicate(binding))) })
export const recoverFeatureExtendedRest = (state: FeatureApState): FeatureApState => Object.freeze({ ...state, spent: 0, bindings: Object.freeze(state.bindings.filter(binding => binding.release !== 'extended-rest')), drains: Object.freeze(state.drains.filter(drain => drain.recovery !== 'extended-rest')) })
