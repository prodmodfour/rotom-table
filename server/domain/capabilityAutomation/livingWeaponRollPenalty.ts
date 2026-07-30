import { livingWeaponMoveNames } from '#shared/capabilityAutomation/weaponMoves'
import type { CharacterSheet } from '~/types/characterSheet'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { isStruggleAttackMoveName } from '~/utils/struggleMoves'
import type { AuthoritativeMoveRulesContext } from '../moveAutomation/context'
import { capabilityActorIsFainted } from './actionEligibility'
import { resolveLivingWeaponAttackSources } from './weaponMoveGrants'

export interface FaintedLivingWeaponRollPenalty {
  readonly sourcePlacementId: string
  readonly value: -2
}

/**
 * Resolve only the exact opaque Living Weapon source selected by this attack.
 * Native/source-less attacks never inherit another linked weapon's penalty.
 */
export const faintedLivingWeaponRollPenalty = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: Pick<MoveAutomationScript, 'moveName'> | null | undefined
}): FaintedLivingWeaponRollPenalty | null => {
  const attackSourceId = input.context.intent.attackSourceId
  if (!input.script || !attackSourceId) return null

  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const resolved of input.context.resolvedSheets) {
    if (resolved.kind === 'pokemon') pokemon.set(resolved.slug, resolved.sheet as CharacterSheet)
    else trainer.set(resolved.slug, resolved.sheet as TrainerSheet)
  }
  const source = resolveLivingWeaponAttackSources({
    map: input.context.map,
    placement: input.context.actor.placement,
    sheet: input.context.actor.sheet.sheet,
    token: input.context.actor.token,
    pokemonSheets: pokemon,
    trainerSheets: trainer,
    tokenForPlacement: placementId => input.context.queries.tokens.get(placementId),
  }).find(candidate => candidate.attackSourceId === attackSourceId)
  if (!source || !capabilityActorIsFainted(source.ownerSheet)) return null

  const grantedMoves = new Set<string>(livingWeaponMoveNames(
    source.ownerSheet.species.trim().toLocaleLowerCase('en-US'),
    source.wielderToken.combatSkillRankValue,
  ))
  if (!grantedMoves.has(input.script.moveName)
    && !(source.actorIsWielder && isStruggleAttackMoveName(input.script.moveName))) return null

  // The exact source and rank-provider sheets participate in the durable CAS set.
  input.context.reads.recordPlacement(source.ownerPlacement)
  const wielderPlacement = input.context.queries.placements.get(source.wielderPlacementId)
  if (wielderPlacement) input.context.reads.recordPlacement(wielderPlacement)
  return Object.freeze({ sourcePlacementId: source.ownerPlacement.id, value: -2 })
}
