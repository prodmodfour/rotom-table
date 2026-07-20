export const STATIC_GRAPPLE_MOVE_IDS = Object.freeze([
  'Bind',
  'Clamp',
  'Wrap',
] as const)

export type StaticGrappleMoveId = (typeof STATIC_GRAPPLE_MOVE_IDS)[number]

export interface StaticGrappleMoveBonuses {
  readonly sourceMoveIds: readonly StaticGrappleMoveId[]
  readonly initiateAccuracyBonus: number
  readonly initiateSkillCheckBonus: number
  readonly dominanceSkillCheckBonus: number
  readonly dominanceTargetHpLossPercent: 10
}

const STATIC_MOVE_SET = new Set<string>(STATIC_GRAPPLE_MOVE_IDS)

/**
 * Resolve the canonical shared passive once even if a transformed or migrated
 * move list contains more than one equivalent source. Grapple orchestration
 * consumes this server-owned result; these Static records are never declared
 * as ordinary attack commands.
 */
export const resolveStaticGrappleMoveBonuses = (
  canonicalMoveIds: readonly string[],
): StaticGrappleMoveBonuses | null => {
  const sourceMoveIds = STATIC_GRAPPLE_MOVE_IDS.filter(id => (
    canonicalMoveIds.includes(id) && STATIC_MOVE_SET.has(id)
  ))
  if (sourceMoveIds.length === 0) return null
  return Object.freeze({
    sourceMoveIds: Object.freeze([...sourceMoveIds]),
    initiateAccuracyBonus: 1,
    initiateSkillCheckBonus: 2,
    dominanceSkillCheckBonus: 2,
    dominanceTargetHpLossPercent: 10 as const,
  })
}

export const staticGrappleDominanceHpLoss = (
  targetFullMaxHp: number,
): number => {
  if (!Number.isSafeInteger(targetFullMaxHp) || targetFullMaxHp < 1) {
    throw new Error('Static grapple dominance HP requires positive authoritative full Max HP.')
  }
  return Math.max(1, Math.floor(targetFullMaxHp / 10))
}
