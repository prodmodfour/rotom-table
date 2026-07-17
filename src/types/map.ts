/**
 * Tabletop map documents.
 *
 * Maps store sparse terrain voxels, sheet placements, and lighting state.
 */
import type { EncounterSideId, EncounterState } from '#shared/moveAutomation/encounterState'
import type { GridAnchor, GridDimensions } from './pokemon'
import type { MapMoveUsageState } from './moveUsage'
import type { TokenFacingDirection } from './tokenFacing'

export type { GridAnchor, GridDimensions }
export type { TokenFacingDirection }

export type SheetKind = 'pokemon' | 'trainer'

export interface SheetPlacement {
  /** Stable id used to address this placement (move, delete, turn). */
  id: string
  sheetKind: SheetKind
  sheetSlug: string
  position: GridAnchor
  /** Explicit map-local encounter side. Omitted means unknown/unaffiliated. */
  sideId?: EncounterSideId
  /** Map-local initiative value used by the encounter tracker. */
  initiative?: number | null
  /** Direction the sprite faces on the isometric map. */
  facing?: TokenFacingDirection
  /** @deprecated Use `facing`; kept for older map documents. */
  turned?: boolean
}

export interface InitiativeTrackerState {
  /** Placement id whose turn is currently active. */
  activeId?: string | null
  /** 1-based combat round counter. */
  round?: number
  /** Optional GM-authored turn order. Missing/null means derive order from initiative scores. */
  manualOrderIds?: string[]
}

export interface MapTemporaryHitPointsState {
  /** Scene that owns these temporary Hit Points; cleared when the active scene changes. */
  scene: MapSceneState
  /** Absolute temporary HP by map-local placement id. Missing/zero means no temporary HP. */
  byPlacementId: Record<string, number>
}

export interface MapSceneState {
  /** GM-provided scene label shown to everyone in live play. */
  name: string
  /** Server timestamp for when this scene was started. */
  startedAt?: number
}

export type MapMaterialId = string
export type VoxelMaterial = MapMaterialId

export type MapHazardKind = 'spikes' | 'toxic-spikes' | 'sticky-web' | 'stealth-rock' | 'fire'

export type MapWeatherKind = 'sunny' | 'rainy' | 'hail' | 'sandstorm'
export type MapTerrainKind = 'electric' | 'grassy' | 'misty' | 'psychic'
/** Psychic Rooms plus Gravity in the legacy/editor global-field compatibility lane. */
export type MapRoomKind = 'magic' | 'trick' | 'wonder' | 'gravity'

export interface MapWeatherEffect {
  kind: MapWeatherKind
  /** Compatibility projection of native field duration; `null` means sustained until removal. */
  rounds?: number | null
  source?: string
}

export interface MapTerrainEffect {
  kind: MapTerrainKind
  /** Field-wide by default. `area` is reserved for move-created local terrain. */
  scope?: 'field' | 'area'
  rounds?: number | null
  source?: string
}

export interface MapRoomEffect {
  kind: MapRoomKind
  rounds?: number | null
  /** Trick Room takes effect at the beginning of the next round. */
  startsNextRound?: boolean
  source?: string
}

export interface MapFieldEffects {
  /** PTU weather is one-at-a-time by default, but Climate Control can allow two. */
  weather?: MapWeatherEffect[]
  /** PTU terrain field effects. Multiple/local terrains are possible in later supplements. */
  terrains?: MapTerrainEffect[]
  /** Psychic Rooms are independent field effects. */
  rooms?: MapRoomEffect[]
}

export interface MapHazardV2 {
  kind: MapHazardKind
  x: number
  y: number
  z: number
  /** Toxic Spikes supports 2 layers. Other hazards ignore this field. */
  layer?: number
  /** Legacy/editor presentation label only; native mechanics use encounter-zone side IDs. */
  owner?: string
}

export interface MapShopInterface {
  /** Stable map-local id used to address this shop access point. */
  id: string
  /** References the authoritative shop table document; catalog, prices, and stock stay in shop_tables. */
  shopSlug: string
  label: string
  /** Optional 3D map point used by interaction/range UI. */
  position?: GridAnchor
  interactionRangeMeters?: number
  /** Players only see interfaces explicitly marked visible. */
  playerVisible?: boolean
}

export interface MapVoxelV2 {
  x: number
  y: number
  z: number
  materialId: MapMaterialId
  /** Optional `#rrggbb` override for one-off generated maps. */
  color?: string
  /** Marks a voxel for optional ghost-opacity rendering. */
  ghost?: boolean
  blocksMovement?: boolean
  blocksSight?: boolean
  tags?: string[]
}

export interface LightPlacement {
  id: string
  kind: 'ambient' | 'point' | 'emissive' | 'zone'
  position?: GridAnchor
  color?: string
  intensity?: number
  radius?: number
  zoneId?: string
}

export interface MaterialDefinition {
  id: string
  displayName: string
  color?: string
  texture?: string
  transparent?: boolean
  opacity?: number
  emissive?: string
  roughness?: number
  blocksMovementDefault?: boolean
  blocksSightDefault?: boolean
  tags?: string[]
}

export interface TabletopMapV2 {
  schemaVersion: 2
  /** Server-owned document revision used for command conflict control. */
  revision?: number
  /** URL slug, also the on-disk filename stem (`<slug>.json`). */
  slug: string
  name: string
  /** Optional logical library folder label stored with the SQLite map document. */
  folder?: string
  dimensions: GridDimensions
  /** Absolute Y coordinate that is displayed as map-specific/ground Y=0. */
  groundLevelY?: number
  voxels: MapVoxelV2[]
  /** Whether the map is visible to the shared player login. */
  playerVisible?: boolean
  /** Map access points that reference campaign shop tables without owning shop catalog state. */
  shopInterfaces?: MapShopInterface[]
  /** Sparse battlefield hazards placed on map squares. */
  hazards?: MapHazardV2[]
  /** Renderer/editor projection of zone-owned PTU Weather, Terrain, and Rooms. */
  fieldEffects?: MapFieldEffects
  placements: SheetPlacement[]
  lights?: LightPlacement[]
  /** Current turn + round state for the collapsible initiative tracker. */
  initiative?: InitiativeTrackerState
  /** Current GM-started scene shown to players in live play. */
  activeScene?: MapSceneState | null
  /** Per-placement temporary HP for the current map Scene. */
  temporaryHitPoints?: MapTemporaryHitPointsState
  /** Per-placement EOT/Scene/Daily move frequency usage for the current map Scene. */
  moveUsage?: MapMoveUsageState
  /** Versioned server-owned encounter mechanics state, including typed zones and map-ground items. */
  encounterState?: EncounterState
  metadata?: Record<string, unknown>
  createdAt?: number
  updatedAt?: number
}

export type TabletopMap = TabletopMapV2

export interface MapSummary {
  slug: string
  name: string
  folder: string
  dimensions: GridDimensions
  placementCount: number
  playerVisible?: boolean
  schemaVersion?: number
  revision?: number
  updatedAt?: number
}

export interface LayerVisibility {
  terrain: boolean
  shadows: boolean
  tokens: boolean
  grid: boolean
  hazards: boolean
  fieldEffects: boolean
}
