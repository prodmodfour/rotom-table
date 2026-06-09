import { ref, type ComputedRef } from 'vue'
import type { MapActionSplashPayload } from '#shared/mapActionEvents'
import type { MapActionSplashProfileEntry, MapActionSplashState } from '~/types/mapActionSplash'

type MaybePromise<T> = T | Promise<T>

export const ACTION_SPLASH_DURATION_MS = 1850
export const ACTION_SPLASH_LEAD_IN_MS = ACTION_SPLASH_DURATION_MS

export interface MapActionSplashRequest {
  userId: string
  actionName: string
  verb?: string
}

export interface MapActionSplashPublishRequest {
  actorPlacementId: string
  payload: MapActionSplashPayload
}

export type MapActionSplashPublishHandler = (
  request: MapActionSplashPublishRequest,
) => MaybePromise<unknown>

interface ActionSplashActor {
  id: string
  species: string
  accentColor?: string | null
}

interface ActionSplashInitiativeEntry extends MapActionSplashProfileEntry {
  id: string
}

export interface UseMapActionSplashOptions {
  spawnedPokemon: ComputedRef<readonly ActionSplashActor[]>
  initiativeRows: ComputedRef<readonly ActionSplashInitiativeEntry[]>
  publishActionSplash?: MapActionSplashPublishHandler
  durationMs?: number
  leadInMs?: number
}

interface NormalizedActionSplashRequest {
  actor: ActionSplashActor
  actionName: string
  verb?: string
  profileEntry: MapActionSplashProfileEntry
  payload: MapActionSplashPayload
}

const warnActionSplashPublishFailure = (error: unknown) => {
  console.warn('[useMapActionSplash] action splash publish failed', error)
}

const normalizeActionSplashRequest = (
  request: MapActionSplashRequest,
  options: Pick<UseMapActionSplashOptions, 'spawnedPokemon' | 'initiativeRows'>,
): NormalizedActionSplashRequest | null => {
  const actionName = request.actionName.trim()
  if (!actionName) return null

  const actor = options.spawnedPokemon.value.find((pokemon) => pokemon.id === request.userId)
  if (!actor) return null

  const profileEntry = options.initiativeRows.value.find((entry) => entry.id === actor.id)
  if (!profileEntry) return null

  const verb = request.verb?.trim() || undefined
  const payload: MapActionSplashPayload = verb ? { actionName, verb } : { actionName }

  return {
    actor,
    actionName,
    verb,
    profileEntry,
    payload,
  }
}

export const useMapActionSplash = (options: UseMapActionSplashOptions) => {
  const durationMs = Math.max(0, options.durationMs ?? ACTION_SPLASH_DURATION_MS)
  const leadInMs = Math.max(0, Math.min(options.leadInMs ?? ACTION_SPLASH_LEAD_IN_MS, durationMs))
  const actionSplash = ref<MapActionSplashState | null>(null)
  let actionSplashSequence = 0
  let actionSplashTimer: ReturnType<typeof setTimeout> | null = null

  const clearActionSplashTimer = () => {
    if (!actionSplashTimer) return
    clearTimeout(actionSplashTimer)
    actionSplashTimer = null
  }

  const clearActionSplash = () => {
    clearActionSplashTimer()
    actionSplash.value = null
  }

  const renderActionSplash = (normalized: NormalizedActionSplashRequest): Promise<void> => {
    const id = ++actionSplashSequence
    actionSplash.value = {
      id,
      userId: normalized.actor.id,
      actorName: normalized.actor.species,
      actionLabel: `${normalized.verb ?? 'uses'} ${normalized.actionName}`,
      profileEntry: normalized.profileEntry,
      accentColor: normalized.actor.accentColor ?? null,
    }

    clearActionSplashTimer()
    actionSplashTimer = setTimeout(() => {
      if (actionSplash.value?.id === id) actionSplash.value = null
      actionSplashTimer = null
    }, durationMs)

    return new Promise((resolve) => {
      setTimeout(resolve, leadInMs)
    })
  }

  const publishActionSplash = (normalized: NormalizedActionSplashRequest) => {
    if (!options.publishActionSplash) return

    try {
      void Promise.resolve(options.publishActionSplash({
        actorPlacementId: normalized.actor.id,
        payload: normalized.payload,
      })).catch(warnActionSplashPublishFailure)
    } catch (error) {
      warnActionSplashPublishFailure(error)
    }
  }

  const showActionSplash = (request: MapActionSplashRequest): Promise<void> => {
    const normalized = normalizeActionSplashRequest(request, options)
    if (!normalized) return Promise.resolve()

    publishActionSplash(normalized)
    return renderActionSplash(normalized)
  }

  const replayActionSplash = (request: MapActionSplashRequest): Promise<void> => {
    const normalized = normalizeActionSplashRequest(request, options)
    return normalized ? renderActionSplash(normalized) : Promise.resolve()
  }

  return {
    actionSplash,
    showActionSplash,
    replayActionSplash,
    clearActionSplash,
  }
}
