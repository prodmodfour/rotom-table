import type { MapSceneState, TabletopMap } from '~/types/map'
import { mapSceneStatesEqual, normalizeMapSceneState } from '~/utils/mapSceneState'
import { deepCloneJson } from '~/utils/serialization'

export interface TemporaryHpDamageApplication {
  currentHp: number
  temporaryHp: number
  absorbedByTemporaryHp: number
  realHpLoss: number
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const nonNegativeWhole = (value: unknown): number => {
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue) || numberValue <= 0) return 0
  return Math.floor(numberValue)
}

export const normalizeTemporaryHpAmount = (value: unknown): number => nonNegativeWhole(value)

const normalizeTemporaryHpEntries = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) return {}

  const entries: Record<string, number> = {}
  for (const [placementId, amountValue] of Object.entries(value)) {
    if (!placementId.trim()) continue
    const amount = normalizeTemporaryHpAmount(amountValue)
    if (amount > 0) entries[placementId] = amount
  }
  return entries
}

export const normalizeMapTemporaryHitPointsState = (
  value: unknown,
  activeSceneValue: unknown,
): TabletopMap['temporaryHitPoints'] => {
  const activeScene = normalizeMapSceneState(activeSceneValue)
  if (!activeScene || !isRecord(value)) return undefined

  const scene = normalizeMapSceneState(value.scene)
  if (!mapSceneStatesEqual(scene, activeScene)) return undefined

  const byPlacementId = normalizeTemporaryHpEntries(value.byPlacementId)
  if (Object.keys(byPlacementId).length === 0) return undefined

  return {
    scene: deepCloneJson(activeScene) as MapSceneState,
    byPlacementId,
  }
}

export const temporaryHpForPlacement = (
  map: Pick<TabletopMap, 'activeScene' | 'temporaryHitPoints'> | null | undefined,
  placementId: string | null | undefined,
): number => {
  if (!map || !placementId) return 0
  const state = normalizeMapTemporaryHitPointsState(map.temporaryHitPoints, map.activeScene)
  return state?.byPlacementId[placementId] ?? 0
}

export const mapWithTemporaryHpForPlacement = <TMap extends TabletopMap>(
  map: TMap,
  placementId: string,
  temporaryHp: number,
): TMap => {
  const activeScene = normalizeMapSceneState(map.activeScene)
  const amount = normalizeTemporaryHpAmount(temporaryHp)
  const previousState = normalizeMapTemporaryHitPointsState(map.temporaryHitPoints, activeScene)
  const byPlacementId = { ...(previousState?.byPlacementId ?? {}) }

  if (amount > 0 && activeScene) byPlacementId[placementId] = amount
  else delete byPlacementId[placementId]

  const next = { ...map }
  if (activeScene && Object.keys(byPlacementId).length > 0) {
    next.temporaryHitPoints = {
      scene: deepCloneJson(activeScene) as MapSceneState,
      byPlacementId,
    }
  } else {
    delete next.temporaryHitPoints
  }
  return next
}

export const setTemporaryHpForPlacement = (
  map: TabletopMap,
  placementId: string,
  temporaryHp: number,
): void => {
  const next = mapWithTemporaryHpForPlacement(map, placementId, temporaryHp)
  if (next.temporaryHitPoints) map.temporaryHitPoints = next.temporaryHitPoints
  else delete map.temporaryHitPoints
}

export const applyDamageToTemporaryHp = (options: {
  currentHp: number
  temporaryHp?: number | null
  hpLoss: number
}): TemporaryHpDamageApplication => {
  const hpLoss = normalizeTemporaryHpAmount(options.hpLoss)
  const temporaryHp = normalizeTemporaryHpAmount(options.temporaryHp)
  const absorbedByTemporaryHp = Math.min(temporaryHp, hpLoss)
  const realHpLoss = hpLoss - absorbedByTemporaryHp
  return {
    currentHp: options.currentHp - realHpLoss,
    temporaryHp: temporaryHp - absorbedByTemporaryHp,
    absorbedByTemporaryHp,
    realHpLoss,
  }
}
