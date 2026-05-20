import { computed, type ComputedRef, type Ref } from 'vue'
import {
  orderOptionsForPlacement,
  type TokenOrderMenuOption,
} from '~/utils/mapTokenOrders'
import {
  appendOrderLogEntry,
  buildOrderUseLogLines,
  DEFAULT_ORDER_LOG_ENTRIES,
} from '~/utils/orderLog'
import type { TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'

type SheetMapRef<T> = Ref<Map<string, T> | undefined>

export interface OrderActionEvent {
  userId: string
  orderName: string
}

export interface UseOrderActionPanelOptions {
  map: Ref<TabletopMap | null>
  spawnedPokemon: ComputedRef<SpawnedPokemon[]>
  trainerBySlug: SheetMapRef<TrainerSheet>
  canControlPlacement: (id: string) => boolean
  onBeforeOrderAction?: (event: OrderActionEvent) => void
  now?: () => number
  maxLogEntries?: number
}

export const useOrderActionPanel = ({
  map,
  spawnedPokemon,
  trainerBySlug,
  canControlPlacement,
  onBeforeOrderAction,
  now,
  maxLogEntries = DEFAULT_ORDER_LOG_ENTRIES,
}: UseOrderActionPanelOptions) => {
  const orderOptionsForId = (id: string | null | undefined): TokenOrderMenuOption[] => {
    if (!map.value || !id) return []
    return orderOptionsForPlacement(
      map.value.placements.find((item) => item.id === id),
      { trainer: trainerBySlug.value },
    )
  }

  const findSpawnedPokemon = (id: string | null | undefined): SpawnedPokemon | null =>
    id ? spawnedPokemon.value.find((pokemon) => pokemon.id === id) ?? null : null

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

  const useOrder = (input: { id: string; orderName?: string | null }): boolean => {
    if (!map.value || !canControlPlacement(input.id)) return false
    const orderName = input.orderName?.trim()
    if (!orderName) return false

    const user = findSpawnedPokemon(input.id)
    const order = orderOptionForUse(input.id, orderName)
    if (!user || !order) return false

    onBeforeOrderAction?.({ userId: user.id, orderName: order.name })
    map.value.metadata = appendOrderLogEntry(map.value.metadata, {
      userId: user.id,
      userName: user.species,
      orderName: order.name,
      lines: buildOrderUseLogLines(user, order),
    }, {
      now,
      maxLogEntries,
    })
    return true
  }

  return {
    tokenOrderOptionsById,
    useOrder,
  }
}
