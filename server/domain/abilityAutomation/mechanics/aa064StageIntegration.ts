import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import { clampCombatStage } from '~/utils/combatStages'

export interface Aa064StageAbilityQueries {
  readonly has: (placementId: string, canonicalId: 'Competitive' | 'Contrary' | 'Defiant') => boolean
}

/** Contrary transforms the uncapped requested delta before normal stage bounds apply. */
export const aa064ContraryRequestedValue = (input: {
  readonly recipientId: string
  readonly current: number
  readonly unboundedRequested: number
  readonly abilities?: Aa064StageAbilityQueries
}): number => input.abilities?.has(input.recipientId, 'Contrary')
  ? input.current - (input.unboundedRequested - input.current)
  : input.unboundedRequested

/**
 * Apply Competitive exactly once after one operation actually lowers at least
 * one stage from a source other than the recipient's own Move or Ability.
 * Contrary also transforms Competitive's own +2 Ability increase.
 */
export const aa064ApplyCompetitive = (input: {
  readonly recipientId: string
  readonly sourceOwnerId: string | null
  readonly previous: CombatStageMap
  readonly next: CombatStageMap
  readonly abilities?: Aa064StageAbilityQueries
}): { readonly stages: CombatStageMap; readonly appliedDelta: number } => {
  const abilities = input.abilities
  const externallyLowered = input.sourceOwnerId !== input.recipientId
    && (Object.keys(input.previous) as CombatStageKey[]).some(stage => input.next[stage] < input.previous[stage])
  if (!abilities?.has(input.recipientId, 'Competitive') || !externallyLowered) {
    return { stages: input.next, appliedDelta: 0 }
  }
  const requestedDelta = abilities.has(input.recipientId, 'Contrary') ? -2 : 2
  const current = input.next.satk
  const updated = clampCombatStage(current + requestedDelta)
  return {
    stages: { ...input.next, satk: updated },
    appliedDelta: updated - current,
  }
}
