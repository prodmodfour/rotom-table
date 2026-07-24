import type { GridAnchor, TabletopMap } from '~/types/map'

export const AA072_GORILLA_LOCK_CAPABILITY = 'aa072.gorilla-tactics.move-lock' as const
export const AA072_GLUTTONY_FOOD_BUFF_CAPACITY = 3 as const
export const AA072_GLUTTONY_FOOD_BUFF_USES_PER_SCENE = 3 as const
export const AA072_GLUTTONY_REFRESHMENTS_PER_HALF_HOUR = 2 as const

export const aa072PlantCellId = (cell: GridAnchor): string => `${cell.x}:${cell.y}:${cell.z}`
export const aa072IsYieldingPlantCell = (map: Pick<TabletopMap, 'voxels'>, cell: GridAnchor): boolean => (
  map.voxels.some(voxel => (
    voxel.x === cell.x && voxel.y === cell.y && voxel.z === cell.z
    && (voxel.tags ?? []).some(tag => ['yielding-plant', 'yielding plant'].includes(tag.trim().toLowerCase()))
  ))
)

export interface Aa072GardenerPlantState {
  readonly soilQuality: number
  readonly lastAppliedDayKey: string | null
}
export interface Aa072GardenerMetadata {
  readonly schemaVersion: 1
  readonly plants: Readonly<Record<string, Aa072GardenerPlantState>>
}

export const AA072_GARDENER_METADATA_KEY = 'aa072Gardener' as const
export const emptyAa072GardenerMetadata = (): Aa072GardenerMetadata => Object.freeze({
  schemaVersion: 1,
  plants: Object.freeze({}),
})

/** Strict bounded reader for the permanent map-owned Gardener plant state. */
export const parseAa072GardenerMetadata = (value: unknown): Aa072GardenerMetadata => {
  if (value === undefined || value === null) return emptyAa072GardenerMetadata()
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('AA-072 Gardener metadata must be an object.')
  const input = value as Record<string, unknown>
  const rootKeys = Object.keys(input)
  if (rootKeys.length !== 2 || !rootKeys.includes('schemaVersion') || !rootKeys.includes('plants')
    || input.schemaVersion !== 1 || typeof input.plants !== 'object' || input.plants === null || Array.isArray(input.plants)) {
    throw new Error('AA-072 Gardener metadata has an unsupported schema.')
  }
  const entries = Object.entries(input.plants as Record<string, unknown>)
  if (entries.length > 512) throw new Error('AA-072 Gardener metadata exceeds its plant bound.')
  const plants: Record<string, Aa072GardenerPlantState> = {}
  for (const [cellId, raw] of entries) {
    if (!/^(?:0|[1-9]\d{0,5}):(?:0|[1-9]\d{0,5}):(?:0|[1-9]\d{0,5})$/.test(cellId)
      || typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('AA-072 Gardener metadata contains an invalid plant entry.')
    }
    const plant = raw as Record<string, unknown>
    const plantKeys = Object.keys(plant)
    if (plantKeys.length !== 2 || !plantKeys.includes('soilQuality') || !plantKeys.includes('lastAppliedDayKey')
      || !Number.isSafeInteger(plant.soilQuality) || (plant.soilQuality as number) < 0 || (plant.soilQuality as number) > 1_000
      || (plant.lastAppliedDayKey !== null && (typeof plant.lastAppliedDayKey !== 'string'
        || plant.lastAppliedDayKey.length === 0 || plant.lastAppliedDayKey.length > 200))) {
      throw new Error('AA-072 Gardener plant state is invalid.')
    }
    plants[cellId] = Object.freeze({
      soilQuality: plant.soilQuality as number,
      lastAppliedDayKey: plant.lastAppliedDayKey as string | null,
    })
  }
  return Object.freeze({ schemaVersion: 1, plants: Object.freeze(plants) })
}
