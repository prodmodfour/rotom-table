import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  appendActiveOrderEffect,
  createActiveOrderEffect,
  expireActiveOrderEffectsForInitiativeAdvance,
  type OrderTimelineAdvance,
  type OrderTimelinePoint,
} from '~/utils/activeOrderEffects'
import {
  orderOptionsForPlacement,
  type TokenOrderMenuOption,
} from '~/utils/mapTokenOrders'
import {
  appendOrderLogEntry,
  buildOrderUseLogLines,
  DEFAULT_ORDER_LOG_ENTRIES,
} from '~/utils/orderLog'
import type { MoveAutomationTargetingOverlayState } from '~/types/moveAutomation'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

type SheetMapRef<T> = Ref<Map<string, T> | undefined>
type MaybePromise<T> = T | Promise<T>
type ActionDispatchResult = boolean | undefined

export interface OrderActionEvent {
  userId: string
  orderName: string
}

export interface UseOrderActionPanelOptions {
  map: Ref<TabletopMap | null>
  spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  trainerBySlug: SheetMapRef<TrainerSheet>
  canControlPlacement: (id: string) => boolean
  onBeforeOrderAction?: (event: OrderActionEvent) => MaybePromise<unknown>
  dispatchOrderUse?: (event: OrderActionEvent & { targetTokenId?: string }) => MaybePromise<ActionDispatchResult>
  now?: () => number
  idFactory?: () => string
  maxLogEntries?: number
}

interface ActiveOrderTargetingRequest {
  userId: string
  orderName: string
  order: TokenOrderMenuOption
  targetLabel: string
}

const normalizeRound = (round: unknown): number => {
  const n = Math.floor(Number(round ?? 1))
  return Number.isFinite(n) && n > 0 ? n : 1
}

const hasOrderTag = (order: TokenOrderMenuOption, pattern: RegExp): boolean =>
  order.tags.some((tag) => pattern.test(tag))

const orderTargetLabel = (order: TokenOrderMenuOption): string | null => {
  const explicit = order.target?.trim()
  if (explicit) return explicit
  if (hasOrderTag(order, /^training$/i)) return 'Your Pokémon'
  return null
}

const isPokemonTargetLabel = (label: string, order: TokenOrderMenuOption): boolean =>
  hasOrderTag(order, /^training$/i) || /pok[eé]mon|channeled|chic/i.test(label)

const trainerTeamSlugs = (trainer: TrainerSheet | null | undefined): Set<string> =>
  new Set((trainer?.currentTeam ?? []).map((slug) => slug.trim()).filter(Boolean))

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> => (
  value !== null
  && (typeof value === 'object' || typeof value === 'function')
  && typeof (value as { then?: unknown }).then === 'function'
)

export const useOrderActionPanel = ({
  map,
  spawnedPokemon,
  trainerBySlug,
  canControlPlacement,
  onBeforeOrderAction,
  dispatchOrderUse,
  now,
  idFactory,
  maxLogEntries = DEFAULT_ORDER_LOG_ENTRIES,
}: UseOrderActionPanelOptions) => {
  const activeOrderTargeting = ref<ActiveOrderTargetingRequest | null>(null)

  const orderOptionsForId = (id: string | null | undefined): TokenOrderMenuOption[] => {
    if (!map.value || !id) return []
    return orderOptionsForPlacement(
      map.value.placements.find((item) => item.id === id),
      { trainer: trainerBySlug.value },
    )
  }

  const findSpawnedPokemon = (id: string | null | undefined): SpawnedPokemon | null =>
    id ? spawnedPokemon.value.find((pokemon) => pokemon.id === id) ?? null : null

  const trainerForToken = (token: SpawnedPokemon): TrainerSheet | null =>
    token.sheetKind === 'trainer' ? trainerBySlug.value?.get(token.sheetSlug) ?? null : null

  const currentTimeline = (): OrderTimelinePoint => ({
    activeId: map.value?.initiative?.activeId ?? null,
    round: normalizeRound(map.value?.initiative?.round),
  })

  const tokenOrderOptionsById = computed(() => {
    const out: Record<string, TokenOrderMenuOption[]> = {}
    if (!map.value) return out
    for (const token of spawnedPokemon.value) {
      if (token.sheetKind === 'trainer') out[token.id] = orderOptionsForId(token.id)
    }
    return out
  })

  const orderOptionForUse = (
    id: string,
    orderName: string,
  ): TokenOrderMenuOption | null => {
    const normalizedOrderName = orderName.trim().toLocaleLowerCase()
    if (!normalizedOrderName) return null
    return tokenOrderOptionsById.value[id]?.find((option) =>
      option.name.toLocaleLowerCase() === normalizedOrderName,
    ) ?? null
  }

  const targetCandidatesForOrder = (
    user: SpawnedPokemon,
    order: TokenOrderMenuOption,
    targetLabel: string,
  ): SpawnedPokemon[] => {
    const candidates = spawnedPokemon.value.filter((token) => token.id !== user.id)
    if (/trainer/i.test(targetLabel)) return candidates.filter((token) => token.sheetKind === 'trainer')

    if (isPokemonTargetLabel(targetLabel, order)) {
      let pokemon = candidates.filter((token) => token.sheetKind === 'pokemon')
      const teamSlugs = trainerTeamSlugs(trainerForToken(user))
      if (/\byour\b/i.test(targetLabel) && teamSlugs.size) {
        pokemon = pokemon.filter((token) => teamSlugs.has(token.sheetSlug))
      }
      return pokemon
    }

    if (/all(?:ied|y|ies)|ally/i.test(targetLabel)) return candidates
    return candidates
  }

  const orderActionTargeting = computed<MoveAutomationTargetingOverlayState | null>(() => {
    const request = activeOrderTargeting.value
    const user = findSpawnedPokemon(request?.userId)
    if (!request || !user || !canControlPlacement(request.userId)) return null

    return {
      userId: request.userId,
      moveName: request.orderName,
      mode: 'target',
      rangeLabel: request.targetLabel,
      rangeMeters: 0,
      targetPrompt: `Choose a target for ${request.orderName} (${request.targetLabel}).`,
      candidateIds: targetCandidatesForOrder(user, request.order, request.targetLabel).map((token) => token.id),
    }
  })

  const appendLocalOrderUse = (
    user: SpawnedPokemon,
    order: TokenOrderMenuOption,
    target: SpawnedPokemon | null,
  ): boolean => {
    if (!map.value || !canControlPlacement(user.id)) return false

    const activeEffect = createActiveOrderEffect({
      user,
      order,
      target,
      timeline: currentTimeline(),
      idFactory,
    })

    let metadata = map.value.metadata
    if (activeEffect) metadata = appendActiveOrderEffect(metadata, activeEffect)
    metadata = appendOrderLogEntry(metadata, {
      userId: user.id,
      userName: user.species,
      orderName: order.name,
      lines: buildOrderUseLogLines(user, order, { target, activeEffect }),
    }, {
      now,
      maxLogEntries,
    })
    map.value.metadata = metadata
    return true
  }

  const finishOrderDispatch = (
    dispatchResult: ActionDispatchResult,
    user: SpawnedPokemon,
    order: TokenOrderMenuOption,
    target: SpawnedPokemon | null,
  ): boolean => (
    dispatchResult !== undefined
      ? dispatchResult
      : appendLocalOrderUse(user, order, target)
  )

  const finishOrderUse = (
    user: SpawnedPokemon,
    order: TokenOrderMenuOption,
    target: SpawnedPokemon | null = null,
  ): MaybePromise<boolean> => {
    if (!map.value || !canControlPlacement(user.id)) return false

    try {
      const dispatchResult = dispatchOrderUse?.({
        userId: user.id,
        orderName: order.name,
        ...(target === null ? {} : { targetTokenId: target.id }),
      })
      if (isPromiseLike(dispatchResult)) {
        return Promise.resolve(dispatchResult)
          .then((result) => finishOrderDispatch(result, user, order, target))
          .catch(() => false)
      }
      return finishOrderDispatch(dispatchResult, user, order, target)
    } catch {
      return false
    }
  }

  const performOrderUse = (
    user: SpawnedPokemon,
    order: TokenOrderMenuOption,
    target: SpawnedPokemon | null = null,
  ): MaybePromise<boolean> => {
    if (!map.value || !canControlPlacement(user.id)) return false

    const notification = onBeforeOrderAction?.({ userId: user.id, orderName: order.name })
    if (isPromiseLike(notification)) {
      return Promise.resolve(notification).then(() => finishOrderUse(user, order, target))
    }

    return finishOrderUse(user, order, target)
  }

  const useOrder = (input: { id: string; orderName?: string | null }): MaybePromise<boolean> => {
    if (!map.value || !canControlPlacement(input.id)) return false
    const orderName = input.orderName?.trim()
    if (!orderName) return false

    const user = findSpawnedPokemon(input.id)
    const order = orderOptionForUse(input.id, orderName)
    if (!user || !order) return false

    const targetLabel = orderTargetLabel(order)
    if (targetLabel) {
      activeOrderTargeting.value = {
        userId: user.id,
        orderName: order.name,
        order,
        targetLabel,
      }
      return true
    }

    activeOrderTargeting.value = null
    return performOrderUse(user, order)
  }

  const cancelOrderActionTargeting = () => {
    activeOrderTargeting.value = null
  }

  const selectOrderActionTarget = (targetId: string): MaybePromise<boolean> => {
    const request = activeOrderTargeting.value
    const overlay = orderActionTargeting.value
    if (!request || !overlay?.candidateIds.includes(targetId)) return false

    const user = findSpawnedPokemon(request.userId)
    const target = findSpawnedPokemon(targetId)
    if (!user || !target) return false

    const result = performOrderUse(user, request.order, target)
    if (isPromiseLike(result)) {
      return Promise.resolve(result).then((handled) => {
        if (handled) activeOrderTargeting.value = null
        return handled
      })
    }
    if (result) activeOrderTargeting.value = null
    return result
  }

  const expireActiveOrdersAfterInitiativeAdvance = (advance: OrderTimelineAdvance) => {
    if (!map.value) return
    map.value.metadata = expireActiveOrderEffectsForInitiativeAdvance(map.value.metadata, advance, {
      now,
      maxLogEntries,
    })
  }

  return {
    orderActionTargeting,
    tokenOrderOptionsById,
    useOrder,
    cancelOrderActionTargeting,
    selectOrderActionTarget,
    expireActiveOrdersAfterInitiativeAdvance,
  }
}

export type { OrderTimelineAdvance, OrderTimelinePoint }
