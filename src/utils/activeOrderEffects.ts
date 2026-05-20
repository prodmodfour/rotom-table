import { appendOrderLogEntry } from '~/utils/orderLog'
import type { TokenOrderMenuOption } from '~/utils/mapTokenOrders'
import type { SpawnedPokemon } from '~/types/pokemon'

export type ActiveOrderExpirationKind = 'turn-start' | 'turn-end' | 'round-end'

export interface ActiveOrderTurnExpiration {
  kind: Extract<ActiveOrderExpirationKind, 'turn-start' | 'turn-end'>
  tokenId: string
  tokenName: string
  /** Turn-end expirations wait until the watched token has started a future turn, then expire when that turn ends. */
  seenTurnStart?: boolean
  description: string
}

export interface ActiveOrderRoundExpiration {
  kind: Extract<ActiveOrderExpirationKind, 'round-end'>
  round: number
  description: string
}

export type ActiveOrderExpiration = ActiveOrderTurnExpiration | ActiveOrderRoundExpiration

export interface ActiveOrderEffect {
  id: string
  orderName: string
  userId: string
  userName: string
  targetId?: string
  targetName?: string
  startedRound: number
  startedActiveId?: string | null
  expiration: ActiveOrderExpiration
}

export interface OrderTimelinePoint {
  activeId: string | null
  round: number
}

export interface OrderTimelineAdvance {
  before: OrderTimelinePoint
  after: OrderTimelinePoint
}

export interface CreateActiveOrderEffectInput {
  user: Pick<SpawnedPokemon, 'id' | 'species'>
  order: TokenOrderMenuOption
  target?: Pick<SpawnedPokemon, 'id' | 'species'> | null
  timeline: OrderTimelinePoint
  idFactory?: () => string
}

const ACTIVE_ORDER_METADATA_KEY = 'activeOrderEffects'

const nonBlank = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

const finiteInteger = (value: unknown): number | null => {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.floor(n)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeTimelineRound = (round: unknown): number => {
  const n = finiteInteger(round)
  return n && n > 0 ? n : 1
}

export const createActiveOrderEffectId = (): string =>
  `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const readExpiration = (value: unknown): ActiveOrderExpiration | null => {
  if (!isRecord(value)) return null
  const kind = value.kind
  const description = nonBlank(value.description)
  if (!description) return null

  if (kind === 'round-end') {
    const round = finiteInteger(value.round)
    return round && round > 0 ? { kind, round, description } : null
  }

  if (kind === 'turn-start' || kind === 'turn-end') {
    const tokenId = nonBlank(value.tokenId)
    const tokenName = nonBlank(value.tokenName)
    if (!tokenId || !tokenName) return null
    return {
      kind,
      tokenId,
      tokenName,
      ...(value.seenTurnStart === true ? { seenTurnStart: true } : {}),
      description,
    }
  }

  return null
}

const readActiveOrderEffect = (value: unknown): ActiveOrderEffect | null => {
  if (!isRecord(value)) return null
  const id = nonBlank(value.id)
  const orderName = nonBlank(value.orderName)
  const userId = nonBlank(value.userId)
  const userName = nonBlank(value.userName)
  const startedRound = finiteInteger(value.startedRound)
  const expiration = readExpiration(value.expiration)
  if (!id || !orderName || !userId || !userName || !startedRound || startedRound < 1 || !expiration) return null

  return {
    id,
    orderName,
    userId,
    userName,
    ...(nonBlank(value.targetId) ? { targetId: nonBlank(value.targetId) as string } : {}),
    ...(nonBlank(value.targetName) ? { targetName: nonBlank(value.targetName) as string } : {}),
    startedRound,
    ...(value.startedActiveId === null || nonBlank(value.startedActiveId)
      ? { startedActiveId: value.startedActiveId === null ? null : nonBlank(value.startedActiveId) }
      : {}),
    expiration,
  }
}

export const readActiveOrderEffects = (metadata: Record<string, unknown> | null | undefined): ActiveOrderEffect[] => {
  const raw = metadata?.[ACTIVE_ORDER_METADATA_KEY]
  if (!Array.isArray(raw)) return []
  return raw
    .map(readActiveOrderEffect)
    .filter((effect): effect is ActiveOrderEffect => Boolean(effect))
}

export const writeActiveOrderEffects = (
  metadata: Record<string, unknown> | undefined,
  effects: readonly ActiveOrderEffect[],
): Record<string, unknown> => {
  const next = { ...(metadata ?? {}) }
  if (effects.length) next[ACTIVE_ORDER_METADATA_KEY] = [...effects]
  else delete next[ACTIVE_ORDER_METADATA_KEY]
  return next
}

export const appendActiveOrderEffect = (
  metadata: Record<string, unknown> | undefined,
  effect: ActiveOrderEffect,
): Record<string, unknown> => writeActiveOrderEffects(metadata, [...readActiveOrderEffects(metadata), effect])

const normalizedOrderText = (order: TokenOrderMenuOption): string => [
  order.frequency,
  order.target,
  order.condition,
  order.effect,
  order.tags.join(' '),
]
  .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  .join(' ')
  .replace(/[’]/g, "'")
  .replace(/\s+/g, ' ')

const orderHasTag = (order: TokenOrderMenuOption, tagPattern: RegExp): boolean =>
  order.tags.some((tag) => tagPattern.test(tag))

const turnStartExpiration = (
  token: Pick<SpawnedPokemon, 'id' | 'species'>,
  description: string,
): ActiveOrderTurnExpiration => ({
  kind: 'turn-start',
  tokenId: token.id,
  tokenName: token.species,
  description,
})

const turnEndExpiration = (
  token: Pick<SpawnedPokemon, 'id' | 'species'>,
  description: string,
): ActiveOrderTurnExpiration => ({
  kind: 'turn-end',
  tokenId: token.id,
  tokenName: token.species,
  description,
})

export const resolveOrderExpiration = (
  order: TokenOrderMenuOption,
  user: Pick<SpawnedPokemon, 'id' | 'species'>,
  target: Pick<SpawnedPokemon, 'id' | 'species'> | null | undefined,
  timeline: OrderTimelinePoint,
): ActiveOrderExpiration | null => {
  const text = normalizedOrderText(order)

  // Bound Stratagems intentionally persist until the table manually unbinds them or combat ends.
  if (orderHasTag(order, /^stratagem$/i) || /\bBind\b[^.]*\bAP\b/i.test(text) || /\bwhile\b[^.]*\bbound\b/i.test(text)) {
    return null
  }

  if (orderHasTag(order, /^training$/i)) {
    return turnStartExpiration(user, `until the beginning of ${user.species}'s next turn`)
  }

  if (/until (?:the )?beginning of your next turn/i.test(text)) {
    return turnStartExpiration(user, `until the beginning of ${user.species}'s next turn`)
  }

  if (/until (?:the )?end of your next turn|before the end of your next turn/i.test(text)) {
    return turnEndExpiration(user, `until the end of ${user.species}'s next turn`)
  }

  if (/until (?:the )?end of (?:their|the target(?:'s)?) next turn|on (?:their|the target(?:'s)?) next turn|target(?:'s)? next turn/i.test(text)) {
    if (!target) return null
    return turnEndExpiration(target, `until the end of ${target.species}'s next turn`)
  }

  if (/\bthis round\b|\bremainder of the round\b/i.test(text)) {
    return {
      kind: 'round-end',
      round: normalizeTimelineRound(timeline.round),
      description: `until the end of round ${normalizeTimelineRound(timeline.round)}`,
    }
  }

  if (/(?:for|after) (?:one|1) full rounds?/i.test(text)) {
    return turnStartExpiration(user, `for one full round (until ${user.species}'s next turn)`)
  }

  return null
}

export const createActiveOrderEffect = ({
  user,
  order,
  target,
  timeline,
  idFactory = createActiveOrderEffectId,
}: CreateActiveOrderEffectInput): ActiveOrderEffect | null => {
  const expiration = resolveOrderExpiration(order, user, target, timeline)
  if (!expiration) return null

  return {
    id: idFactory(),
    orderName: order.name,
    userId: user.id,
    userName: user.species,
    ...(target ? { targetId: target.id, targetName: target.species } : {}),
    startedRound: normalizeTimelineRound(timeline.round),
    startedActiveId: timeline.activeId,
    expiration,
  }
}

export const activeOrderEffectSummary = (effect: Pick<ActiveOrderEffect, 'expiration'>): string =>
  effect.expiration.description

export const activeOrderWoreOffLine = (effect: ActiveOrderEffect): string => {
  const target = effect.targetName ? ` on ${effect.targetName}` : ''
  return `${effect.orderName}${target} wore off.`
}

const startsWatchedTurn = (effect: ActiveOrderEffect, advance: OrderTimelineAdvance): boolean => {
  const expiration = effect.expiration
  if (expiration.kind !== 'turn-start' && expiration.kind !== 'turn-end') return false
  return advance.after.activeId === expiration.tokenId
    && (advance.before.activeId !== expiration.tokenId || advance.before.round !== advance.after.round)
}

const endsWatchedTurn = (effect: ActiveOrderEffect, advance: OrderTimelineAdvance): boolean => {
  const expiration = effect.expiration
  if (expiration.kind !== 'turn-end') return false
  return advance.before.activeId === expiration.tokenId
    && (advance.after.activeId !== expiration.tokenId || advance.before.round !== advance.after.round)
}

const shouldExpireOrderEffect = (effect: ActiveOrderEffect, advance: OrderTimelineAdvance): boolean => {
  const expiration = effect.expiration
  if (expiration.kind === 'round-end') return advance.after.round > expiration.round
  if (expiration.kind === 'turn-start') return startsWatchedTurn(effect, advance)
  return Boolean(expiration.seenTurnStart && endsWatchedTurn(effect, advance))
}

const markTurnEndWatcherProgress = (effect: ActiveOrderEffect, advance: OrderTimelineAdvance): ActiveOrderEffect => {
  if (effect.expiration.kind !== 'turn-end') return effect
  if (!startsWatchedTurn(effect, advance)) return effect
  return {
    ...effect,
    expiration: {
      ...effect.expiration,
      seenTurnStart: true,
    },
  }
}

export const expireActiveOrderEffectsForInitiativeAdvance = (
  metadata: Record<string, unknown> | undefined,
  advance: OrderTimelineAdvance,
  options: { now?: () => number; maxLogEntries?: number } = {},
): Record<string, unknown> => {
  const activeEffects = readActiveOrderEffects(metadata)
  if (!activeEffects.length) return metadata ?? {}

  const kept: ActiveOrderEffect[] = []
  const expired: ActiveOrderEffect[] = []
  for (const effect of activeEffects) {
    if (shouldExpireOrderEffect(effect, advance)) expired.push(effect)
    else kept.push(markTurnEndWatcherProgress(effect, advance))
  }

  let next = writeActiveOrderEffects(metadata, kept)
  for (const effect of expired) {
    next = appendOrderLogEntry(next, {
      userId: effect.userId,
      userName: effect.userName,
      orderName: effect.orderName,
      lines: [activeOrderWoreOffLine(effect)],
    }, options)
  }
  return next
}
