import { normalizedFeatureRuntimeState, normalizedFeatureUsageLedger } from '#shared/featureAutomation/state'
import { resolvedSheetFeatureClosure } from '#shared/featureAutomation/sheetFeatures'
import { recoverFeatureExtendedRest, releaseFeatureBindings, resolveTrainerFeatureApState } from './resources'
import { expireFeaturePendingWorkflows } from './workflows'
import type { TrainerSheet } from '~/types/trainerSheet'

/** Reconcile virtual provenance after retraining/removal without deleting audit receipts. */
export const reconcileFeatureSourceLoss = (sheet: TrainerSheet, now: number): TrainerSheet => {
  const next = structuredClone(sheet)
  const effectiveIds = new Set(resolvedSheetFeatureClosure(next).map(instance => instance.instanceId))
  const ap = resolveTrainerFeatureApState(next)
  next.featureApState = releaseFeatureBindings(ap, binding => !effectiveIds.has(binding.sourceInstanceId) && (binding.release === 'source-loss' || binding.release === 'effect-end'))
  const runtime = expireFeaturePendingWorkflows(next.featureRuntimeState, now)
  next.featureRuntimeState = Object.freeze({ ...runtime, pending: Object.freeze(runtime.pending.map(workflow => workflow.status === 'pending' && !effectiveIds.has(workflow.sourceInstanceId) ? Object.freeze({ ...workflow, status: 'cancelled' as const }) : workflow)) })
  return next
}

export const recoverFeaturesAtExtendedRest = (sheet: TrainerSheet, input: { readonly now: number, readonly nextDayId?: string }): TrainerSheet => {
  const next = reconcileFeatureSourceLoss(sheet, input.now)
  next.featureApState = recoverFeatureExtendedRest(resolveTrainerFeatureApState(next))
  const usage = normalizedFeatureUsageLedger(next.featureUsage)
  next.featureUsage = Object.freeze({ ...usage, entries: Object.freeze(usage.entries.filter(entry => entry.scope !== 'day' && entry.scope !== 'turn' && entry.scope !== 'round')) })
  const runtime = normalizedFeatureRuntimeState(next.featureRuntimeState)
  next.featureRuntimeState = Object.freeze({ ...runtime, pending: Object.freeze(runtime.pending.map(workflow => workflow.status === 'pending' && workflow.kind === 'reaction' ? Object.freeze({ ...workflow, status: 'expired' as const }) : workflow)) })
  return next
}

export const cleanupFeatureSceneState = (sheet: TrainerSheet, sceneId: string, now: number): TrainerSheet => {
  const next = reconcileFeatureSourceLoss(sheet, now)
  const usage = normalizedFeatureUsageLedger(next.featureUsage)
  next.featureUsage = Object.freeze({ ...usage, entries: Object.freeze(usage.entries.filter(entry => !(entry.scope === 'scene' && entry.scopeId === sceneId) && entry.scope !== 'round' && entry.scope !== 'turn')) })
  next.featureApState = releaseFeatureBindings(resolveTrainerFeatureApState(next), binding => binding.release === 'scene-end')
  return next
}
