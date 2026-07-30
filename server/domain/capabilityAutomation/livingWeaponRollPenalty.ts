import { livingWeaponMoveNames } from '#shared/capabilityAutomation/weaponMoves'
import type { CharacterSheet } from '~/types/characterSheet'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import { isStruggleAttackMoveName } from '~/utils/struggleMoves'
import type { AuthoritativeMoveRulesContext } from '../moveAutomation/context'
import { capabilityActorIsFainted } from './actionEligibility'

export interface FaintedLivingWeaponRollPenalty {
  readonly sourcePlacementId: string
  readonly value: -2
}

/**
 * Resolve the exact source-effective Living Weapon used by this attack.
 * The penalty applies to both the Accuracy and Damage rolls made with it.
 */
export const faintedLivingWeaponRollPenalty = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName'> | null | undefined
}): FaintedLivingWeaponRollPenalty | null => {
  if (!input.script) return null
  const link = (input.context.map.encounterState?.capabilityRuntime?.links ?? []).find(candidate => (
    candidate.kind === 'living-weapon'
    && candidate.participantPlacementIds.includes(input.context.actor.placement.id)
    && input.context.queries.creatureRules.hasCapabilityInstance(
      candidate.ownerPlacementId,
      candidate.capabilityInstanceId,
      candidate.canonicalId,
    )
    && (() => {
      const placement = input.context.queries.placements.get(candidate.ownerPlacementId)
      const sheet = placement ? input.context.queries.sheets.forPlacement(placement) : null
      return sheet ? capabilityActorIsFainted(sheet.sheet as CharacterSheet) : false
    })()
  ))
  if (!link) return null
  const placement = input.context.queries.placements.get(link.ownerPlacementId)
  const sheet = placement ? input.context.queries.sheets.forPlacement(placement) : null
  const species = placement?.sheetKind === 'pokemon'
    ? (sheet?.sheet as CharacterSheet | undefined)?.species.trim().toLocaleLowerCase('en-US') ?? null
    : null
  const grantedMoves = new Set<string>(livingWeaponMoveNames(
    species,
    input.context.actor.token.combatSkillRankValue,
  ))
  if (!grantedMoves.has(input.script.moveName) && !isStruggleAttackMoveName(input.script.moveName)) {
    return null
  }
  return Object.freeze({ sourcePlacementId: link.ownerPlacementId, value: -2 })
}
