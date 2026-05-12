import { clampCombatStage } from '~/utils/combatStages'

export const combatStageMultiplier = (stage: unknown): number => {
  const clamped = clampCombatStage(stage)
  return clamped >= 0
    ? 1 + clamped * 0.2
    : 1 + clamped * 0.1
}

export const applyCombatStageToStat = (stat: number | null | undefined, stage: unknown): number => {
  const base = typeof stat === 'number' && Number.isFinite(stat) ? stat : 0
  if (base <= 0) return 0
  return Math.max(1, Math.floor(base * combatStageMultiplier(stage)))
}

export const formatCombatStage = (stage: unknown): string => {
  const clamped = clampCombatStage(stage)
  return clamped > 0 ? `+${clamped}` : String(clamped)
}
