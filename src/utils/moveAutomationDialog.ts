import { COMBAT_STAGE_KEYS, clampCombatStage } from '~/utils/combatStages'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import type { GridAnchor } from '~/types/pokemon'

export const parsePositiveInt = (value: string): number | null => {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n < 0) return null
  return n
}

export const applyHpSuggestion = (
  current: number,
  max: number,
  amount: number,
  mode: string,
): number => {
  if (mode.startsWith('heal')) return Math.min(max, current + amount)
  return Math.max(0, current - amount)
}

export const addCombatStageDeltas = (
  base: CombatStageMap,
  delta: Partial<Record<CombatStageKey, number>>,
): CombatStageMap => {
  const next = { ...base }
  for (const key of COMBAT_STAGE_KEYS) {
    next[key] = clampCombatStage((next[key] ?? 0) + (delta[key] ?? 0))
  }
  return next
}

export const nonZeroStageDeltas = (
  source: Record<CombatStageKey, number>,
): Partial<Record<CombatStageKey, number>> => {
  const out: Partial<Record<CombatStageKey, number>> = {}
  for (const key of COMBAT_STAGE_KEYS) {
    const delta = Number(source[key])
    if (Number.isFinite(delta) && delta !== 0) out[key] = Math.trunc(delta)
  }
  return out
}

export const parseHazardCellText = (
  text: string,
  fallbackY: number,
): GridAnchor[] => {
  const cells: GridAnchor[] = []
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/[\s,]+/).map((part) => Number(part))
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      cells.push({ x: Math.round(parts[0]), y: Math.round(parts[1]), z: Math.round(parts[2]) })
    } else if (parts.length >= 2 && parts.slice(0, 2).every(Number.isFinite)) {
      cells.push({ x: Math.round(parts[0]), y: fallbackY, z: Math.round(parts[1]) })
    }
  }
  return cells
}

export const stageDeltaLabel = (delta: number): string => delta > 0 ? `+${delta}` : String(delta)
