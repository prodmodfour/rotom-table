import type { AttackOfOpportunityTriggerPayload } from '#shared/attackOfOpportunityState'
import { isSameAnchor } from '~/utils/gridGeometry'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { conditionBaseName } from '~/utils/statusConditions'
import { isStruggleAttackMoveName } from '~/utils/struggleMoves'
import type { GridAnchor } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'

type MaybePromise<T> = T | Promise<T>

export interface AttackOfOpportunityStruggleOption {
  name: string
  type: string | null
  damageClass: string | null
  ac: number | string | null
  damageBase: number | null
}

export interface UseAttackOfOpportunityTriggersOptions {
  dispatchTrigger: (payload: AttackOfOpportunityTriggerPayload) => MaybePromise<boolean | undefined>
}

export interface MovementAttackOfOpportunityInput {
  provokerId: string
  from: GridAnchor
  to: GridAnchor
}

export interface RangedAttackOfOpportunityInput {
  provokerId: string
  targetIds: readonly string[]
}

const AOO_BLOCKING_CONDITIONS = new Set([
  'Sleep',
  'Flinch',
  'Paralysis',
  'Confused',
  'Fainted',
])

export const tokensAreAdjacent = (
  left: Pick<SpawnedPokemon, 'position' | 'base' | 'clearance'>,
  right: Pick<SpawnedPokemon, 'position' | 'base' | 'clearance'>,
): boolean => ptuGridDistanceBetweenFootprints(left, right) === 1

export const canMakeAttackOfOpportunity = (
  token: Pick<SpawnedPokemon, 'conditions' | 'currentHp'>,
): boolean => {
  if (token.currentHp <= 0) return false
  return !token.conditions.some((condition) => {
    const baseName = conditionBaseName(condition) ?? condition
    return AOO_BLOCKING_CONDITIONS.has(baseName)
  })
}

export const movementAttackOfOpportunityAttackerIds = (options: {
  provokerId: string
  from: GridAnchor
  to: GridAnchor
  tokens: readonly SpawnedPokemon[]
}): string[] => {
  if (isSameAnchor(options.from, options.to)) return []
  const provoker = options.tokens.find((token) => token.id === options.provokerId)
  if (!provoker) return []

  const provokerAtOrigin: SpawnedPokemon = {
    ...provoker,
    position: { ...options.from },
  }
  return options.tokens
    .filter((token) => token.id !== options.provokerId)
    .filter((token) => tokensAreAdjacent(token, provokerAtOrigin))
    .map((token) => token.id)
}

export const rangedAttackOfOpportunityAttackerIds = (options: {
  provokerId: string
  targetIds: readonly string[]
  tokens: readonly SpawnedPokemon[]
}): string[] => {
  const provoker = options.tokens.find((token) => token.id === options.provokerId)
  if (!provoker) return []

  const targets = options.targetIds
    .map((targetId) => options.tokens.find((token) => token.id === targetId))
    .filter((token): token is SpawnedPokemon => Boolean(token))
  if (targets.some((target) => tokensAreAdjacent(provoker, target))) return []

  return options.tokens
    .filter((token) => token.id !== options.provokerId)
    .filter((token) => tokensAreAdjacent(token, provoker))
    .map((token) => token.id)
}

export const attackOfOpportunityStruggleOptions = (
  moves: readonly TokenMoveMenuOption[] | undefined,
): AttackOfOpportunityStruggleOption[] => (moves ?? [])
  .filter((move) => isStruggleAttackMoveName(move.name))
  .filter((move) => move.hasAutomationScript && !move.disabledByAutomation)
  .filter((move) => !move.disabledByMoveList && !move.disabledByCondition && !move.disabledByUsage)
  .map((move) => ({
    name: move.name,
    type: move.type,
    damageClass: move.damageClass,
    ac: move.ac,
    damageBase: move.damageBase,
  }))

export const useAttackOfOpportunityTriggers = ({
  dispatchTrigger,
}: UseAttackOfOpportunityTriggersOptions) => {
  const provokeMovementAttackOfOpportunity = (
    input: MovementAttackOfOpportunityInput,
  ): MaybePromise<boolean | undefined> => dispatchTrigger({
    action: 'provoke',
    reason: 'movement',
    provokerId: input.provokerId,
    from: { ...input.from },
    to: { ...input.to },
  })

  const provokeRangedAttackOfOpportunity = (
    input: RangedAttackOfOpportunityInput,
  ): MaybePromise<boolean | undefined> => dispatchTrigger({
    action: 'provoke',
    reason: 'ranged-attack',
    provokerId: input.provokerId,
    targetIds: [...input.targetIds],
  })

  return {
    provokeMovementAttackOfOpportunity,
    provokeRangedAttackOfOpportunity,
  }
}
