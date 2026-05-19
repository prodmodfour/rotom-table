export type MapTrackedMoveFrequency = 'eot' | 'scene'

export interface MapMoveUsageEntry {
  /** Display/canonical move name when the usage entry was recorded. */
  moveName: string
  /** Map-scoped frequencies reset by encounter/scene tooling, not by sheet rest. */
  frequency: MapTrackedMoveFrequency
  /** Number of times this placement has used the move in the current map scene. */
  uses: number
  /** Initiative round of the latest use, when initiative is active. */
  lastUsedRound?: number | null
  /** Unix timestamp of the latest recorded use. */
  updatedAt?: number
}

export interface MapMoveUsageState {
  /** Placement id -> move key -> usage entry. */
  byPlacementId: Record<string, Record<string, MapMoveUsageEntry>>
}

export interface SheetDailyMoveUsageEntry {
  /** Display/canonical move name when the usage entry was recorded. */
  moveName: string
  /** Number of daily uses spent since the sheet was last manually reset. */
  uses: number
  /** Unix timestamp of the latest recorded use. */
  updatedAt?: number
}

export interface SheetMoveUsageState {
  /** Move key -> daily usage entry. */
  daily: Record<string, SheetDailyMoveUsageEntry>
}
