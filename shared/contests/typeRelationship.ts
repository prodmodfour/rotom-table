import { contestCatalog, contestStatById } from './catalog'
import type { ContestStatId } from './ids'

/** Canonical Contest-type relationship, independent of audience projections. */
export const explainContestTypeRelationship = (
  moveTypeId: ContestStatId,
  contestTypeId: ContestStatId,
): { readonly relationship: 'matching' | 'allied' | 'opposed', readonly dice: number, readonly explanation: string } => {
  if (moveTypeId === contestTypeId) return Object.freeze({
    relationship: 'matching',
    dice: contestCatalog.performance.appealTypeModifiers.matching,
    explanation: `${contestStatById.get(moveTypeId)!.label} matches the Contest: +1d6.`,
  })
  if (contestStatById.get(contestTypeId)!.alliedStatIds.includes(moveTypeId)) return Object.freeze({
    relationship: 'allied',
    dice: 0,
    explanation: `${contestStatById.get(moveTypeId)!.label} is allied: no modifier.`,
  })
  return Object.freeze({
    relationship: 'opposed',
    dice: -1,
    explanation: `${contestStatById.get(moveTypeId)!.label} is opposed: -1d6 (zero causes a fumble).`,
  })
}
