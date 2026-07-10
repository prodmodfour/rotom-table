import { computed, type ComputedRef, type Ref } from 'vue'
import {
  applyAttackOfOpportunityStateUpdate,
  attackOfOpportunityStatesEqual,
  readAttackOfOpportunityState,
  writeAttackOfOpportunityState,
  type AttackOfOpportunityPromptRecord,
  type AttackOfOpportunityReason,
  type AttackOfOpportunityStateUpdatePayload,
} from '#shared/attackOfOpportunityState'
import { isSameAnchor } from '~/utils/gridGeometry'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { conditionBaseName } from '~/utils/statusConditions'
import { isStruggleAttackMoveName } from '~/utils/struggleMoves'
import type { GridAnchor, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TokenMoveMenuOption } from '~/utils/mapTokenMoves'

export type { AttackOfOpportunityPromptRecord, AttackOfOpportunityReason } from '#shared/attackOfOpportunityState'

type MaybePromise<T> = T | Promise<T>

export interface AttackOfOpportunityStruggleOption {
  name: string
  type: string | null
  damageClass: string | null
  ac: number | string | null
  damageBase: number | null
}

export interface AttackOfOpportunityPrompt extends AttackOfOpportunityPromptRecord {
  attackerAccentColor?: string
  struggleOptions: AttackOfOpportunityStruggleOption[]
}

export interface AttackOfOpportunityMoveRequest {
  attackerId: string
  targetId: string
  moveName: string
  prompt: AttackOfOpportunityPrompt
}

export interface AttackOfOpportunitySuppressionContext {
  attacker: SpawnedPokemon
  provoker: SpawnedPokemon
  reason: AttackOfOpportunityReason
}

export interface UseAttackOfOpportunityPanelOptions {
  map: Ref<TabletopMap | null>
  spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  tokenMoveOptionsById: ComputedRef<Record<string, TokenMoveMenuOption[]>>
  canControlPlacement: (id: string) => boolean
  shouldSuppressAttackOfOpportunity?: (context: AttackOfOpportunitySuppressionContext) => boolean
  performStruggleAttack: (request: AttackOfOpportunityMoveRequest) => boolean | Promise<boolean>
  dispatchStateUpdate?: (payload: AttackOfOpportunityStateUpdatePayload) => MaybePromise<boolean | undefined>
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

const currentRoundForMap = (map: TabletopMap | null): number | null => map?.initiative?.round ?? null

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
  .filter((move) => !move.disabledByCondition && !move.disabledByUsage)
  .map((move) => ({
    name: move.name,
    type: move.type,
    damageClass: move.damageClass,
    ac: move.ac,
    damageBase: move.damageBase,
  }))

export const useAttackOfOpportunityPanel = ({
  map,
  spawnedPokemon,
  tokenMoveOptionsById,
  canControlPlacement,
  shouldSuppressAttackOfOpportunity,
  performStruggleAttack,
  dispatchStateUpdate,
}: UseAttackOfOpportunityPanelOptions) => {
  let nextPromptSequence = 1

  const currentRound = () => currentRoundForMap(map.value)
  const currentState = () => readAttackOfOpportunityState(map.value?.metadata)

  const applyStateUpdateLocally = (payload: AttackOfOpportunityStateUpdatePayload): boolean => {
    if (!map.value) return false
    const previous = currentState()
    const next = applyAttackOfOpportunityStateUpdate(previous, payload)
    if (attackOfOpportunityStatesEqual(previous, next)) return false
    map.value.metadata = writeAttackOfOpportunityState(map.value.metadata, next)
    return true
  }

  const updateState = (payload: AttackOfOpportunityStateUpdatePayload): MaybePromise<boolean | undefined> => {
    const externalResult = dispatchStateUpdate?.(payload)
    if (externalResult !== undefined) return externalResult
    return applyStateUpdateLocally(payload)
  }

  const tokenById = (id: string): SpawnedPokemon | null =>
    spawnedPokemon.value.find((token) => token.id === id) ?? null

  const attackerHasUsedThisRound = (attackerId: string): boolean =>
    currentState().usedRoundByAttackerId[attackerId] === currentRound()

  const struggleOptionsForAttacker = (attackerId: string): AttackOfOpportunityStruggleOption[] =>
    attackOfOpportunityStruggleOptions(tokenMoveOptionsById.value[attackerId])

  const storedPromptIsStillUsable = (record: AttackOfOpportunityPromptRecord): boolean => {
    const attacker = tokenById(record.attackerId)
    const provoker = tokenById(record.provokerId)
    return Boolean(
      attacker
      && provoker
      && record.round === currentRound()
      && !shouldSuppressAttackOfOpportunity?.({ attacker, provoker, reason: record.reason })
      && canMakeAttackOfOpportunity(attacker)
      && !attackerHasUsedThisRound(record.attackerId)
      && struggleOptionsForAttacker(record.attackerId).length > 0,
    )
  }

  const visiblePromptIsStillUsable = (record: AttackOfOpportunityPromptRecord): boolean => (
    storedPromptIsStillUsable(record) && canControlPlacement(record.attackerId)
  )

  const attackOfOpportunityPrompts = computed<AttackOfOpportunityPrompt[]>(() => currentState().prompts
    .filter(visiblePromptIsStillUsable)
    .map((record) => {
      const attacker = tokenById(record.attackerId)
      return {
        ...record,
        ...(attacker?.accentColor ? { attackerAccentColor: attacker.accentColor } : {}),
        struggleOptions: struggleOptionsForAttacker(record.attackerId),
      }
    }))

  const clearAttackOfOpportunityPrompts = (actorId?: string): MaybePromise<boolean | undefined> => {
    if (!currentState().prompts.length) return false
    return updateState({
      action: 'clear-all',
      ...(actorId ? { actorId } : {}),
    })
  }

  const clearAttackOfOpportunityPromptsForNonImmediateAction = (actorId?: string): MaybePromise<boolean | undefined> => (
    clearAttackOfOpportunityPrompts(actorId)
  )

  const queuePrompts = (input: {
    provokerId: string
    attackerIds: readonly string[]
    reason: AttackOfOpportunityReason
  }): MaybePromise<boolean | undefined> => {
    const provoker = tokenById(input.provokerId)
    if (!provoker) return false

    const records = input.attackerIds.flatMap((attackerId): AttackOfOpportunityPromptRecord[] => {
      const attacker = tokenById(attackerId)
      if (!attacker) return []
      if (shouldSuppressAttackOfOpportunity?.({ attacker, provoker, reason: input.reason })) return []
      if (!canMakeAttackOfOpportunity(attacker)) return []
      if (attackerHasUsedThisRound(attacker.id)) return []
      if (!struggleOptionsForAttacker(attacker.id).length) return []

      const id = `aoo-${nextPromptSequence++}-${attacker.id}-${provoker.id}`
      return [{
        id,
        attackerId: attacker.id,
        attackerName: attacker.species,
        provokerId: provoker.id,
        provokerName: provoker.species,
        reason: input.reason,
        round: currentRound(),
      }]
    })

    if (!records.length) return false
    return updateState({ action: 'queue', records })
  }

  const provokeMovementAttackOfOpportunity = (input: MovementAttackOfOpportunityInput): MaybePromise<boolean | undefined> => (
    queuePrompts({
      provokerId: input.provokerId,
      reason: 'movement',
      attackerIds: movementAttackOfOpportunityAttackerIds({
        ...input,
        tokens: spawnedPokemon.value,
      }),
    })
  )

  const provokeRangedAttackOfOpportunity = (input: RangedAttackOfOpportunityInput): MaybePromise<boolean | undefined> => (
    queuePrompts({
      provokerId: input.provokerId,
      reason: 'ranged-attack',
      attackerIds: rangedAttackOfOpportunityAttackerIds({
        ...input,
        tokens: spawnedPokemon.value,
      }),
    })
  )

  const clearAttackOfOpportunityPrompt = (promptId: string): MaybePromise<boolean | undefined> => {
    if (!attackOfOpportunityPrompts.value.some((prompt) => prompt.id === promptId)) return false
    return updateState({ action: 'clear-prompt', promptId })
  }

  const markAttackerUsed = (attackerId: string): MaybePromise<boolean | undefined> => (
    updateState({ action: 'mark-attacker-used', attackerId, round: currentRound() })
  )

  const useAttackOfOpportunity = async (input: { promptId: string; moveName: string }) => {
    const prompt = attackOfOpportunityPrompts.value.find((record) => record.id === input.promptId)
    if (!prompt) return false
    if (!prompt.struggleOptions.some((option) => option.name === input.moveName)) return false

    const applied = await performStruggleAttack({
      attackerId: prompt.attackerId,
      targetId: prompt.provokerId,
      moveName: input.moveName,
      prompt,
    })
    if (!applied) return false

    await markAttackerUsed(prompt.attackerId)
    return true
  }

  return {
    attackOfOpportunityPrompts,
    clearAttackOfOpportunityPrompts,
    clearAttackOfOpportunityPromptsForNonImmediateAction,
    provokeMovementAttackOfOpportunity,
    provokeRangedAttackOfOpportunity,
    removeAttackOfOpportunityPrompt: clearAttackOfOpportunityPrompt,
    useAttackOfOpportunity,
  }
}
