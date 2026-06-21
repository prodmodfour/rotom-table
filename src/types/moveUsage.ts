export type MapTrackedMoveFrequency = 'eot' | 'scene' | 'daily'

export interface MapMoveUsageSceneAnchor {
  /** GM-provided scene label that this usage bucket belongs to. */
  name: string
  /** Server timestamp for when the scene was started. */
  startedAt?: number
}

export interface MapMoveUsageEntry {
  /** Display/canonical move name when the usage entry was recorded. */
  moveName: string
  /** Map-scoped frequencies reset by map Scene tooling, not by sheet rest. */
  frequency: MapTrackedMoveFrequency
  /** Number of times this placement has used the move in the current map Scene. */
  uses: number
  /** Initiative round of the latest use, when initiative is active. */
  lastUsedRound?: number | null
  /** Unix timestamp of the latest recorded use. */
  updatedAt?: number
}

export interface MapMoveUsageState {
  /** The map Scene this usage bucket is tied to. Omitted for pre-Scene/no-active-Scene usage. */
  scene?: MapMoveUsageSceneAnchor
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
