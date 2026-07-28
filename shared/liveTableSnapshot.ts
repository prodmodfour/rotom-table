import type { EncounterPresentationProjection } from './encounterPresentation'
import type { MapInteractionMode } from './mapInteractionMode'
import type { TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

export const LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION = 3 as const

export interface LiveTableSnapshot {
  readonly schemaVersion: typeof LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly interactionMode: MapInteractionMode
  readonly interactionModeUpdatedAt: number
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
  /** One role-specific, revision-bound action/passive/pending presentation bundle. */
  readonly encounterPresentation: EncounterPresentationProjection
}
