import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'

export const COMBAT_STAGE_KEYS = ['atk', 'def', 'satk', 'sdef', 'spd'] as const satisfies readonly CombatStageKey[]

export const COMBAT_STAGE_LABELS: Record<CombatStageKey, string> = {
  atk: 'Attack',
  def: 'Defense',
  satk: 'Sp. Atk',
  sdef: 'Sp. Def',
  spd: 'Speed',
}

export const COMBAT_STAGE_ROWS = COMBAT_STAGE_KEYS.map((key) => ({
  key,
  label: COMBAT_STAGE_LABELS[key],
}))

export const clampCombatStage = (value: unknown): number => {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(-6, Math.min(6, Math.trunc(parsed)))
}

export const normalizeCombatStages = (
  source?: Partial<Record<CombatStageKey, unknown>> | null,
): CombatStageMap => ({
  atk: clampCombatStage(source?.atk),
  def: clampCombatStage(source?.def),
  satk: clampCombatStage(source?.satk),
  sdef: clampCombatStage(source?.sdef),
  spd: clampCombatStage(source?.spd),
})
