import type { ActiveOrderEffect } from '~/utils/activeOrderEffects'
import type { TokenOrderMenuOption } from '~/utils/mapTokenOrders'
import type { SpawnedPokemon } from '~/types/pokemon'

export const DEFAULT_ORDER_LOG_ENTRIES = 100

export interface OrderLogTransaction {
  userId: string
  userName: string
  orderName: string
  lines: string[]
}

export const buildOrderUseLogLines = (
  user: Pick<SpawnedPokemon, 'species'>,
  order: TokenOrderMenuOption,
  options: {
    target?: Pick<SpawnedPokemon, 'species'> | null
    activeEffect?: ActiveOrderEffect | null
  } = {},
): string[] => [
  `${user.species} used ${order.name}.`,
  ...(options.target ? [`Target: ${options.target.species}`] : []),
  ...(options.activeEffect ? [`Wears off: ${options.activeEffect.expiration.description}`] : []),
  ...(order.frequency ? [`Frequency: ${order.frequency}`] : []),
  ...(order.trigger ? [`Trigger: ${order.trigger}`] : []),
  ...(order.target ? [`Order Target: ${order.target}`] : []),
  ...(order.condition ? [`Condition: ${order.condition}`] : []),
  ...(order.effect ? [`Effect: ${order.effect}`] : []),
]

export const appendOrderLogEntry = (
  metadata: Record<string, unknown> | undefined,
  transaction: OrderLogTransaction,
  options: { now?: () => number; maxLogEntries?: number } = {},
): Record<string, unknown> => {
  const next = { ...(metadata ?? {}) }
  const previous = Array.isArray(next.orderLog) ? next.orderLog : []
  next.orderLog = [
    ...previous,
    {
      at: options.now?.() ?? Date.now(),
      userId: transaction.userId,
      userName: transaction.userName,
      orderName: transaction.orderName,
      lines: transaction.lines,
    },
  ].slice(-(options.maxLogEntries ?? DEFAULT_ORDER_LOG_ENTRIES))
  return next
}
