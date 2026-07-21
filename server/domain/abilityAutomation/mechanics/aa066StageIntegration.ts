import type { CombatStageMap } from '~/types/combatStages'
import { clampCombatStage } from '~/utils/combatStages'
import type { Aa064StageAbilityQueries } from './aa064StageIntegration'

/** Dauntless Shield shifts only the effective default Defense stage. */
export const aa066EffectiveCombatStages = (input: {
  readonly stages: CombatStageMap
  readonly abilityNames: readonly string[]
}): CombatStageMap => input.abilityNames.includes('Dauntless Shield')
  ? { ...input.stages, def: clampCombatStage(input.stages.def + 1) }
  : input.stages

/** Defiant triggers once per external lowering operation, after Competitive and through Contrary. */
export const aa066ApplyDefiant = (input: {
  readonly recipientId: string
  readonly sourceOwnerId: string | null
  /** Captured before Competitive or any other post-lowering trigger mutates the operation result. */
  readonly externallyLowered: boolean
  readonly next: CombatStageMap
  readonly abilities?: Aa064StageAbilityQueries
}): { readonly stages: CombatStageMap; readonly appliedDelta: number } => {
  const abilities = input.abilities
  if (!abilities?.has(input.recipientId, 'Defiant')
    || input.sourceOwnerId === input.recipientId
    || !input.externallyLowered) {
    return { stages: input.next, appliedDelta: 0 }
  }
  const requestedDelta = abilities.has(input.recipientId, 'Contrary') ? -2 : 2
  const current = input.next.atk
  const updated = clampCombatStage(current + requestedDelta)
  return { stages: { ...input.next, atk: updated }, appliedDelta: updated - current }
}
