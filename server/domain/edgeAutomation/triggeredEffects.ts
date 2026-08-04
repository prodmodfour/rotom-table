import type { TrainerSheet } from '~/types/trainerSheet'
import { resolvedSheetEdgeInstances } from '#shared/edgeAutomation/sheetEdges'
import { trainerStaminaTemporaryHp } from './trainerCombat'

export type TrainerEdgeEvent =
  | { readonly kind: 'take-breather' | 'massive-damage' | 'received-critical-hit' }
  | { readonly kind: 'dealt-critical-hit'; readonly targetPlacementId: string; readonly statusMoveNaturalRoll?: number | null; readonly criticalRangeExpansion?: number }
  | { readonly kind: 'social-move-hit'; readonly targetPlacementIds: readonly string[] }
  | { readonly kind: 'telepathy-attempt'; readonly sourcePlacementId: string; readonly successful: boolean }
  | { readonly kind: 'would-be-disarmed'; readonly weaponMatchesChoice: boolean; readonly availableAp: number; readonly acceptOptionalPrevention: boolean }

export type TrainerEdgeTriggeredEffect =
  | { readonly kind: 'temporary-hp'; readonly amount: number }
  | { readonly kind: 'apply-condition'; readonly targetPlacementId: string; readonly conditionId: 'Vulnerable' }
  | { readonly kind: 'save-modifier'; readonly targetPlacementId: string; readonly conditionGroup: 'volatile-status'; readonly value: -2; readonly rounds: 1 }
  | { readonly kind: 'private-information'; readonly informationId: 'telepathy-attempt'; readonly sourcePlacementId: string; readonly revealSuccess: false }
  | { readonly kind: 'prevent-disarm'; readonly apCost: 1 }

export interface TrainerEdgeTriggeredPlan {
  readonly effects: readonly TrainerEdgeTriggeredEffect[]
  readonly sources: readonly {
    readonly canonicalId: string
    readonly edgeInstanceId: string
    readonly definitionHash: string
  }[]
}

/**
 * Deterministic event subscription reducer. Callers derive the event from
 * authoritative resolution facts and commit the returned effects atomically
 * with the triggering action.
 */
export const planTrainerEdgeTriggeredEffects = (
  sheet: TrainerSheet,
  event: TrainerEdgeEvent,
): TrainerEdgeTriggeredPlan => {
  const instances = resolvedSheetEdgeInstances(sheet, 'trainer')
  const effects: TrainerEdgeTriggeredEffect[] = []
  const sourceIds = new Set<string>()
  const use = (canonicalId: string): typeof instances[number] | null => {
    const instance = instances.find(candidate => candidate.canonicalId === canonicalId) ?? null
    if (instance) sourceIds.add(instance.instanceId)
    return instance
  }

  if (event.kind === 'take-breather' || event.kind === 'massive-damage' || event.kind === 'received-critical-hit') {
    if (use('Stamina')) {
      const amount = trainerStaminaTemporaryHp(sheet)
      if (amount > 0) effects.push({ kind: 'temporary-hp', amount })
    }
  }
  if (event.kind === 'dealt-critical-hit') {
    const minimum = Math.max(1, 19 - Math.max(0, Math.floor(event.criticalRangeExpansion ?? 0)))
    const triggered = event.statusMoveNaturalRoll == null
      ? true
      : event.statusMoveNaturalRoll >= minimum
    if (triggered && use('Demoralize')) {
      effects.push({ kind: 'apply-condition', targetPlacementId: event.targetPlacementId, conditionId: 'Vulnerable' })
    }
  }
  if (event.kind === 'social-move-hit' && use('Flustering Charisma')) {
    for (const targetPlacementId of [...new Set(event.targetPlacementIds)]) {
      effects.push({ kind: 'save-modifier', targetPlacementId, conditionGroup: 'volatile-status', value: -2, rounds: 1 })
    }
  }
  if (event.kind === 'telepathy-attempt' && use('Iron Mind')) {
    effects.push({
      kind: 'private-information',
      informationId: 'telepathy-attempt',
      sourcePlacementId: event.sourcePlacementId,
      revealSuccess: false,
    })
  }
  if (event.kind === 'would-be-disarmed' && event.weaponMatchesChoice
    && event.availableAp >= 1 && event.acceptOptionalPrevention && use('Weapon of Choice')) {
    effects.push({ kind: 'prevent-disarm', apCost: 1 })
  }

  return Object.freeze({
    effects: Object.freeze(effects),
    sources: Object.freeze(instances.filter(instance => sourceIds.has(instance.instanceId)).map(instance => Object.freeze({
      canonicalId: instance.canonicalId,
      edgeInstanceId: instance.instanceId,
      definitionHash: instance.definitionHash,
    }))),
  })
}
