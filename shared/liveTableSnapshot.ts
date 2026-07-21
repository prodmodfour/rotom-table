import type { AbilityClientCapabilityBundle } from './abilityAutomation/clientCapabilities'
import type { MapInteractionMode } from './mapInteractionMode'
import type { TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'

export const LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION = 2 as const

export interface LiveTableSnapshot {
  readonly schemaVersion: typeof LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly interactionMode: MapInteractionMode
  readonly interactionModeUpdatedAt: number
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
  /** Controller-only, revision-bound, manifest-selected ability menu projection. */
  readonly abilityCapabilities: AbilityClientCapabilityBundle
}
