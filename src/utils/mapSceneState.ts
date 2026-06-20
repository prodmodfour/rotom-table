import type { MapSceneState } from '~/types/map'

export const MAP_SCENE_NAME_MAX_LENGTH = 120

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

export const normalizeMapSceneName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (!name || name.length > MAP_SCENE_NAME_MAX_LENGTH) return null
  return name
}

export const normalizeMapSceneState = (value: unknown): MapSceneState | null => {
  if (!isRecord(value)) return null
  const name = normalizeMapSceneName(value.name)
  if (!name) return null
  const startedAt = typeof value.startedAt === 'number' && Number.isFinite(value.startedAt)
    ? Math.max(0, Math.trunc(value.startedAt))
    : undefined
  return {
    name,
    ...(startedAt === undefined ? {} : { startedAt }),
  }
}

export const createMapSceneState = (name: string, startedAt: number): MapSceneState => ({
  name,
  startedAt: Math.max(0, Math.trunc(startedAt)),
})

export const mapSceneStatesEqual = (
  left: MapSceneState | null | undefined,
  right: MapSceneState | null | undefined,
): boolean => {
  const normalizedLeft = normalizeMapSceneState(left)
  const normalizedRight = normalizeMapSceneState(right)
  return normalizedLeft?.name === normalizedRight?.name
    && (normalizedLeft?.startedAt ?? null) === (normalizedRight?.startedAt ?? null)
}
