export * from './livePlayBatchCommands'

import { isSlug, SLUG_PATTERN_DESCRIPTION } from './paths'
import type { ClearFieldEffectsPayload, ClearHazardsPayload, EditHazardsPayload, EditTerrainVoxelsPayload } from './livePlayBatchCommands'
import { isSheetKind, type SheetKind } from './sheets'
import type {
  GridAnchor,
  MapFieldEffects,
  MapHazardKind,
  MapHazardV2,
  MapRoomKind,
  MapSceneState,
  MapTerrainKind,
  MapVoxelV2,
  MapWeatherKind,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { ShopEntrySectionKey, ShopStockValue, ShopTableDocument } from '~/types/shop'
import type { TokenFacingDirection } from '~/types/tokenFacing'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { AttackOfOpportunityStateUpdatePayload } from './attackOfOpportunityState'
import type { StartTurnModalStateUpdatePayload } from './startTurnModalState'
import type { ResolveMoveIntent } from './livePlayMoveResolution'
import type { LivePlayMoveStatePatchPayload } from './livePlayMoveState'
import type { EncounterEventKind } from './moveAutomation/events'
import type { EncounterState } from './moveAutomation/encounterState'

type Brand<TValue, TName extends string> = TValue & { readonly __brand: TName }

export type LivePlayOpId = Brand<string, 'LivePlayOpId'>
export type LivePlayMapSlug = Brand<string, 'LivePlayMapSlug'>
export type LivePlayRevision = Brand<number, 'LivePlayRevision'>
export type LivePlayBaseRevision = LivePlayRevision

export const LIVE_PLAY_COMMAND_SCHEMA_VERSION = 1 as const

export const LIVE_PLAY_OP_ID_PREFIX = 'op_'
export const LIVE_PLAY_OP_ID_PATTERN_DESCRIPTION = '/^op_[A-Za-z0-9_-]{8,96}$/'
export const LIVE_PLAY_OP_ID_RE = /^op_[A-Za-z0-9_-]{8,96}$/

export const LIVE_PLAY_COMMAND_TYPES = {
  MOVE_TOKEN: 'moveToken',
  TURN_TOKEN: 'turnToken',
  MODIFY_HP: 'modifyHp',
  MODIFY_COMBAT_STAGES: 'modifyCombatStages',
  MODIFY_CONDITIONS: 'modifyConditions',
  GRANT_EXPERIENCE: 'grantExperience',
  USE_MOVE: 'useMove',
  RESOLVE_MOVE: 'resolveMove',
  USE_MANEUVER: 'useManeuver',
  USE_ABILITY: 'useAbility',
  USE_ORDER: 'useOrder',
  SET_INITIATIVE: 'setInitiative',
  NEXT_INITIATIVE: 'nextInitiative',
  PREVIOUS_INITIATIVE: 'previousInitiative',
  PLACE_HAZARD: 'placeHazard',
  REMOVE_HAZARD: 'removeHazard',
  CLEAR_HAZARDS: 'clearHazards',
  EDIT_HAZARDS: 'editHazards',
  CLEAR_FIELD_EFFECTS: 'clearFieldEffects',
  SET_FIELD_EFFECT: 'setFieldEffect',
  REMOVE_FIELD_EFFECT: 'removeFieldEffect',
  TICK_FIELD_EFFECT_DURATIONS: 'tickFieldEffectDurations',
  BUILD_TERRAIN_VOXEL: 'buildTerrainVoxel',
  REMOVE_TERRAIN_VOXEL: 'removeTerrainVoxel',
  EDIT_TERRAIN_VOXELS: 'editTerrainVoxels',
  SPAWN_TOKEN: 'spawnToken',
  SEND_OUT_POKEMON: 'sendOutPokemon',
  DELETE_TOKEN: 'deleteToken',
  THROW_POKEBALL: 'throwPokeball',
  SET_SCENE: 'setScene',
  UPDATE_ATTACK_OF_OPPORTUNITY: 'updateAttackOfOpportunity',
  UPDATE_START_TURN_MODAL: 'updateStartTurnModal',
  SHOP_CHECKOUT: 'shopCheckout',
} as const

export type LivePlayCommandType = (typeof LIVE_PLAY_COMMAND_TYPES)[keyof typeof LIVE_PLAY_COMMAND_TYPES]
export type LivePlayShopCheckoutCommandType = typeof LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT
export type LivePlayMapCommandType = Exclude<LivePlayCommandType, LivePlayShopCheckoutCommandType>

export const LIVE_PLAY_MAP_COMMAND_TYPE_VALUES = [
  LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
  LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
  LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES,
  LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
  LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE,
  LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
  LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
  LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
  LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
  LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
  LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
  LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
  LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
  LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
  LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
  LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
  LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS,
  LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
  LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
  LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
  LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS,
  LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
  LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL,
  LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS,
  LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
  LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON,
  LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
  LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
  LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
  LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
  LIVE_PLAY_COMMAND_TYPES.UPDATE_START_TURN_MODAL,
] as const satisfies readonly LivePlayMapCommandType[]

export const LIVE_PLAY_COMMAND_TYPE_VALUES = [
  ...LIVE_PLAY_MAP_COMMAND_TYPE_VALUES,
  LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
] as const satisfies readonly LivePlayCommandType[]

export const LIVE_PLAY_PATCH_TYPES = {
  TOKEN_POSITION: 'token.position',
  TOKEN_FACING: 'token.facing',
  TOKEN_HP: 'token.hp',
  TOKEN_CONDITIONS: 'token.conditions',
  TOKEN_COMBAT_STAGES: 'token.combatStages',
  TOKEN_EXPERIENCE: 'token.experience',
  TOKEN_MOVE_USAGE: 'token.moveUsage',
  TOKEN_ACTION: 'token.action',
  MAP_INITIATIVE: 'map.initiative',
  MAP_HAZARDS: 'map.hazards',
  MAP_FIELD_EFFECTS: 'map.fieldEffects',
  MAP_TERRAIN: 'map.terrain',
  MAP_PLACEMENTS: 'map.placements',
  MAP_SCENE: 'map.scene',
  MAP_METADATA: 'map.metadata',
  SHEET_FIELD: 'sheet.field',
  MOVE_STATE: 'move.state',
  RECONCILIATION_REQUIRED: 'reconciliation.required',
} as const

export type LivePlayPatchType = (typeof LIVE_PLAY_PATCH_TYPES)[keyof typeof LIVE_PLAY_PATCH_TYPES]

export const LIVE_PLAY_PATCH_TYPE_VALUES = [
  LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
  LIVE_PLAY_PATCH_TYPES.TOKEN_FACING,
  LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
  LIVE_PLAY_PATCH_TYPES.TOKEN_CONDITIONS,
  LIVE_PLAY_PATCH_TYPES.TOKEN_COMBAT_STAGES,
  LIVE_PLAY_PATCH_TYPES.TOKEN_EXPERIENCE,
  LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE,
  LIVE_PLAY_PATCH_TYPES.TOKEN_ACTION,
  LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE,
  LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS,
  LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS,
  LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN,
  LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS,
  LIVE_PLAY_PATCH_TYPES.MAP_SCENE,
  LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
  LIVE_PLAY_PATCH_TYPES.SHEET_FIELD,
  LIVE_PLAY_PATCH_TYPES.MOVE_STATE,
  LIVE_PLAY_PATCH_TYPES.RECONCILIATION_REQUIRED,
] as const satisfies readonly LivePlayPatchType[]

export const LIVE_PLAY_MAP_SCOPE_LANES = [
  'initiative',
  'hazards',
  'fieldEffects',
  'terrain',
  'placements',
  'scene',
  'metadata',
] as const
export type LivePlayMapScopeLane = (typeof LIVE_PLAY_MAP_SCOPE_LANES)[number]

export const LIVE_PLAY_TOKEN_SCOPE_FIELDS = [
  'position',
  'facing',
  'hp',
  'conditions',
  'combatStages',
  'experience',
  'moveUsage',
  'action',
  'spawn',
  'sendOut',
  'delete',
] as const
export type LivePlayTokenScopeField = (typeof LIVE_PLAY_TOKEN_SCOPE_FIELDS)[number]

export const LIVE_PLAY_SHOP_SCOPE_FIELDS = ['stock', 'purchase'] as const
export type LivePlayShopScopeField = (typeof LIVE_PLAY_SHOP_SCOPE_FIELDS)[number]

export const LIVE_PLAY_GROUP_INVENTORY_SCOPE_FIELDS = ['money', 'inventory'] as const
export type LivePlayGroupInventoryScopeField = (typeof LIVE_PLAY_GROUP_INVENTORY_SCOPE_FIELDS)[number]

export const SHOP_CHECKOUT_TRAINER_SHEET_SCOPE_FIELDS = ['money', 'inventory'] as const
export type ShopCheckoutTrainerSheetScopeField = (typeof SHOP_CHECKOUT_TRAINER_SHEET_SCOPE_FIELDS)[number]

export interface LivePlayMapScope {
  readonly kind: 'map'
  readonly lane: LivePlayMapScopeLane
}

export interface LivePlayTokenScope {
  readonly kind: 'token'
  readonly placementId: string
  readonly field: LivePlayTokenScopeField
}

export interface LivePlaySheetScope {
  readonly kind: 'sheet'
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly field: string
}

export interface LivePlayShopScope {
  readonly kind: 'shop'
  readonly shopSlug: string
  readonly field: LivePlayShopScopeField
}

export interface LivePlayGroupInventoryScope {
  readonly kind: 'groupInventory'
  readonly slug: string
  readonly field: LivePlayGroupInventoryScopeField
}

export type ShopCheckoutTrainerSheetScope = LivePlaySheetScope & {
  readonly sheetKind: 'trainer'
  readonly field: ShopCheckoutTrainerSheetScopeField
}

export type LivePlayScope = LivePlayMapScope | LivePlayTokenScope | LivePlaySheetScope

export type LivePlayHazardsScope = LivePlayMapScope & { readonly lane: 'hazards' }
export type LivePlayHazardCellScope = LivePlayHazardsScope & { readonly cell: GridAnchor }
export type ClearHazardsLivePlayScope = LivePlayHazardsScope | LivePlayHazardCellScope
export type EditHazardsLivePlayScope = LivePlayHazardsScope | LivePlayHazardCellScope
export type LivePlayFieldEffectsScope = LivePlayMapScope & { readonly lane: 'fieldEffects' }
export type ClearFieldEffectsLivePlayScope = LivePlayFieldEffectsScope
export type LivePlayTerrainScope = LivePlayMapScope & { readonly lane: 'terrain' }
export type LivePlayTerrainCellScope = LivePlayTerrainScope & { readonly cell: GridAnchor }
export type EditTerrainVoxelsLivePlayScope = LivePlayTerrainScope | LivePlayTerrainCellScope

export type ShopCheckoutLivePlayScope =
  | LivePlayShopScope
  | LivePlayGroupInventoryScope
  | ShopCheckoutTrainerSheetScope

export interface LivePlayCommandCoreEnvelope<
  TType extends string = LivePlayCommandType,
  TPayload = unknown,
  TScope = unknown,
> {
  readonly schemaVersion: typeof LIVE_PLAY_COMMAND_SCHEMA_VERSION
  readonly opId: string
  readonly type: TType
  readonly scopes: readonly TScope[]
  readonly payload: TPayload
}

export interface LivePlayCommandEnvelope<
  TType extends LivePlayMapCommandType = LivePlayMapCommandType,
  TPayload = unknown,
  TScope extends LivePlayScope = LivePlayScope,
> extends LivePlayCommandCoreEnvelope<TType, TPayload, TScope> {
  readonly mapSlug: string
  readonly baseRevision: number
}

export interface MoveTokenPayload {
  readonly placementId: string
  readonly position: GridAnchor
  readonly pathLength?: number | null
}

export interface TurnTokenPayload {
  readonly placementId: string
  readonly facing: TokenFacingDirection
}

export interface SpawnTokenPayload {
  readonly placement: SheetPlacement
}

export interface DeleteTokenPayload {
  readonly placementId: string
}

export interface SendOutPokemonPayload {
  readonly trainerId: string
  readonly pokemonSlug: string
  readonly tokenId: string
  readonly position: GridAnchor
  readonly facing?: TokenFacingDirection
}

export interface ThrowPokeballPayload {
  readonly trainerPlacementId: string
  readonly targetPlacementId: string
  readonly pokeballName: string
}

export interface ModifyHpPayload {
  readonly placementId: string
  readonly currentHp: number
  /** Absolute scene-local temporary HP. Undefined leaves it unchanged. */
  readonly temporaryHp?: number
  readonly injuries?: number
}

export interface ModifyCombatStagesPayload {
  readonly placementId: string
  readonly stages: {
    readonly atk: number
    readonly def: number
    readonly satk: number
    readonly sdef: number
    readonly spd: number
    readonly acc: number
  }
}

export type ModifyConditionsAction = 'add' | 'remove' | 'replace'

export interface ModifyConditionsPayload {
  readonly placementId: string
  readonly action: ModifyConditionsAction
  readonly conditions: readonly string[]
}

export interface GrantExperiencePayload {
  readonly placementId: string
  readonly amount: number
}

export interface UseMovePayload {
  readonly placementId: string
  readonly moveName: string
}

export interface UseManeuverPayload {
  readonly placementId: string
  readonly maneuverName: string
  readonly targetPlacementId?: string
}

export interface UseAbilityPayload {
  readonly placementId: string
  readonly abilityName: string
  readonly targetPlacementId?: string
}

export interface UseOrderPayload {
  readonly placementId: string
  readonly orderName: string
  readonly targetPlacementId?: string
}

export const LIVE_PLAY_INITIATIVE_MIN_VALUE = -999 as const
export const LIVE_PLAY_INITIATIVE_MAX_VALUE = 999 as const

export interface SetInitiativePayload {
  readonly tokenId?: string
  readonly initiative?: number | null
  readonly activeId?: string | null
  readonly round?: number
  readonly manualOrderIds?: readonly string[] | null
}

export interface AdvanceInitiativePayload {
  /** Exact visible initiative bar order at the time the user clicked. */
  readonly orderIds: readonly string[]
  /** Client-visible active initiative placement id at click time. */
  readonly activeId: string | null
  /** Client-visible initiative round at click time. */
  readonly round: number
  /** Optional client/server order checksum for diagnostics. */
  readonly orderFingerprint?: string
}

export type NextInitiativePayload = AdvanceInitiativePayload
export type PreviousInitiativePayload = AdvanceInitiativePayload

export interface PlaceHazardPayload {
  readonly hazard: MapHazardV2
}

export interface RemoveHazardPayload {
  readonly cell: {
    readonly x: number
    readonly y: number
    readonly z: number
    readonly kind?: MapHazardKind
  }
}

export type FieldEffectCategory = 'weather' | 'terrain' | 'room'
export type FieldEffectRemoveCategory = FieldEffectCategory | 'all'
export type FieldEffectKind = MapWeatherKind | MapTerrainKind | MapRoomKind

export interface SetFieldEffectPayload {
  readonly category: FieldEffectCategory
  readonly kind: FieldEffectKind
  readonly rounds?: number | null
  readonly source?: string
  readonly weatherMode?: 'replace' | 'append'
  readonly terrainScope?: 'field' | 'area'
  readonly startsNextRound?: boolean
}

export interface RemoveFieldEffectPayload {
  readonly category: FieldEffectRemoveCategory
  readonly kind?: FieldEffectKind
}

export interface TickFieldEffectDurationsPayload {
  readonly amount?: number
}

export interface BuildTerrainVoxelPayload {
  readonly voxel: MapVoxelV2
}

export interface RemoveTerrainVoxelPayload {
  readonly cell: GridAnchor
}

export interface SetScenePayload {
  /** Non-empty name starts/replaces the active scene; null ends it. */
  readonly name: string | null
}

export type ShopCheckoutParticipantReference =
  | { readonly kind: 'groupInventory'; readonly slug: string; readonly revision: number }
  | { readonly kind: 'trainer'; readonly slug: string; readonly revision: number }

export type ShopCheckoutPaymentSource = ShopCheckoutParticipantReference
export type ShopCheckoutDeliveryTarget = ShopCheckoutParticipantReference

export interface ShopCheckoutLineInput {
  readonly entryId: string
  readonly quantity: number
}

export type ShopCheckoutOrigin =
  | { readonly kind: 'shopPage' }
  | {
      readonly kind: 'mapInterface'
      readonly mapSlug: string
      readonly interfaceId: string
      readonly actorPlacementId?: string
    }

export interface ShopCheckoutPayload {
  readonly shopSlug: string
  readonly shopRevision: number
  readonly paymentSource: ShopCheckoutPaymentSource
  readonly deliveryTarget: ShopCheckoutDeliveryTarget
  readonly lines: readonly ShopCheckoutLineInput[]
  readonly origin?: ShopCheckoutOrigin
}

export type ShopCheckoutLivePlayCommand = LivePlayCommandCoreEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
  ShopCheckoutPayload,
  ShopCheckoutLivePlayScope
>

export const shopCheckoutScopeKey = (scope: ShopCheckoutLivePlayScope): string => {
  if (scope.kind === 'shop') return `shop:${scope.shopSlug}:${scope.field}`
  if (scope.kind === 'groupInventory') return `groupInventory:${scope.slug}:${scope.field}`
  return `sheet:trainer:${scope.sheetSlug}:${scope.field}`
}

const createShopCheckoutPaymentSourceScope = (
  source: ShopCheckoutPaymentSource,
): LivePlayGroupInventoryScope | ShopCheckoutTrainerSheetScope => (
  source.kind === 'groupInventory'
    ? { kind: 'groupInventory', slug: source.slug, field: 'money' }
    : { kind: 'sheet', sheetKind: 'trainer', sheetSlug: source.slug, field: 'money' }
)

const createShopCheckoutDeliveryTargetScope = (
  target: ShopCheckoutDeliveryTarget,
): LivePlayGroupInventoryScope | ShopCheckoutTrainerSheetScope => (
  target.kind === 'groupInventory'
    ? { kind: 'groupInventory', slug: target.slug, field: 'inventory' }
    : { kind: 'sheet', sheetKind: 'trainer', sheetSlug: target.slug, field: 'inventory' }
)

export const createShopCheckoutCommandScopes = (
  payload: Pick<ShopCheckoutPayload, 'shopSlug' | 'paymentSource' | 'deliveryTarget'>,
): readonly ShopCheckoutLivePlayScope[] => [
  { kind: 'shop', shopSlug: payload.shopSlug, field: 'purchase' },
  { kind: 'shop', shopSlug: payload.shopSlug, field: 'stock' },
  createShopCheckoutPaymentSourceScope(payload.paymentSource),
  createShopCheckoutDeliveryTargetScope(payload.deliveryTarget),
]

const cloneScopeCell = (cell: GridAnchor): GridAnchor => ({
  x: cell.x,
  y: cell.y,
  z: cell.z,
})

export const createLivePlayHazardsScope = (): LivePlayHazardsScope => ({
  kind: 'map',
  lane: 'hazards',
})

export const createLivePlayHazardCellScope = (cell: GridAnchor): LivePlayHazardCellScope => ({
  ...createLivePlayHazardsScope(),
  cell: cloneScopeCell(cell),
})

export const createClearHazardsCommandScopes = (
  payload: ClearHazardsPayload,
): readonly ClearHazardsLivePlayScope[] => (
  payload.mode === 'cells'
    ? payload.cells.map((cell) => createLivePlayHazardCellScope(cell))
    : [createLivePlayHazardsScope()]
)

export const LIVE_PLAY_EDIT_HAZARDS_EXPLICIT_SCOPE_LIMIT = 32 as const

const editHazardOperationCell = (
  operation: EditHazardsPayload['operations'][number],
): GridAnchor => (operation.action === 'upsert' ? operation.hazard : operation.cell)

export const createEditHazardsCommandScopes = (
  payload: EditHazardsPayload,
): readonly EditHazardsLivePlayScope[] => {
  const cellsByKey = new Map<string, GridAnchor>()
  for (const operation of payload.operations) {
    const cell = editHazardOperationCell(operation)
    const key = `${cell.x},${cell.y},${cell.z}`
    if (!cellsByKey.has(key)) cellsByKey.set(key, cloneScopeCell(cell))
  }

  const cells = [...cellsByKey.values()]
  if (cells.length === 0 || cells.length > LIVE_PLAY_EDIT_HAZARDS_EXPLICIT_SCOPE_LIMIT) {
    return [createLivePlayHazardsScope()]
  }
  return cells.map((cell) => createLivePlayHazardCellScope(cell))
}

export const createLivePlayFieldEffectsScope = (): LivePlayFieldEffectsScope => ({
  kind: 'map',
  lane: 'fieldEffects',
})

export const createClearFieldEffectsCommandScopes = (
  _payload: ClearFieldEffectsPayload,
): readonly ClearFieldEffectsLivePlayScope[] => [createLivePlayFieldEffectsScope()]

export const LIVE_PLAY_EDIT_TERRAIN_VOXELS_EXPLICIT_SCOPE_LIMIT = 32 as const

export const createLivePlayTerrainScope = (): LivePlayTerrainScope => ({
  kind: 'map',
  lane: 'terrain',
})

export const createLivePlayTerrainCellScope = (cell: GridAnchor): LivePlayTerrainCellScope => ({
  ...createLivePlayTerrainScope(),
  cell: cloneScopeCell(cell),
})

const editTerrainVoxelOperationCell = (
  operation: EditTerrainVoxelsPayload['operations'][number],
): GridAnchor => (operation.action === 'upsert' ? operation.voxel : operation.cell)

export const createEditTerrainVoxelsCommandScopes = (
  payload: EditTerrainVoxelsPayload,
): readonly EditTerrainVoxelsLivePlayScope[] => {
  const cellsByKey = new Map<string, GridAnchor>()
  for (const operation of payload.operations) {
    const cell = editTerrainVoxelOperationCell(operation)
    const key = `${cell.x},${cell.y},${cell.z}`
    if (!cellsByKey.has(key)) cellsByKey.set(key, cloneScopeCell(cell))
  }

  const cells = [...cellsByKey.values()]
  if (cells.length === 0 || cells.length > LIVE_PLAY_EDIT_TERRAIN_VOXELS_EXPLICIT_SCOPE_LIMIT) {
    return [createLivePlayTerrainScope()]
  }
  return cells.map((cell) => createLivePlayTerrainCellScope(cell))
}

export type MoveTokenLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  MoveTokenPayload,
  LivePlayTokenScope
>

export type TurnTokenLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
  TurnTokenPayload,
  LivePlayTokenScope
>

export type SpawnTokenLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
  SpawnTokenPayload,
  LivePlayTokenScope
>

export type DeleteTokenLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
  DeleteTokenPayload,
  LivePlayTokenScope
>

export type SendOutPokemonLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON,
  SendOutPokemonPayload,
  LivePlayTokenScope
>

export type ThrowPokeballLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
  ThrowPokeballPayload,
  LivePlayScope
>

export type SetSceneLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
  SetScenePayload,
  LivePlayMapScope
>

export type ModifyHpLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
  ModifyHpPayload,
  LivePlayScope
>

export type ModifyCombatStagesLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES,
  ModifyCombatStagesPayload,
  LivePlayScope
>

export type ModifyConditionsLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
  ModifyConditionsPayload,
  LivePlayScope
>

export type GrantExperienceLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE,
  GrantExperiencePayload,
  LivePlayScope
>

export type UseMoveLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
  UseMovePayload,
  LivePlayScope
>

export type ResolveMoveLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
  ResolveMoveIntent,
  LivePlayScope
>

export type UseManeuverLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
  UseManeuverPayload,
  LivePlayScope
>

export type UseAbilityLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
  UseAbilityPayload,
  LivePlayScope
>

export type UseOrderLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
  UseOrderPayload,
  LivePlayScope
>

export type SetInitiativeLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
  SetInitiativePayload,
  LivePlayMapScope
>

export type NextInitiativeLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
  NextInitiativePayload,
  LivePlayMapScope
>

export type PreviousInitiativeLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
  PreviousInitiativePayload,
  LivePlayMapScope
>

export type PlaceHazardLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
  PlaceHazardPayload,
  LivePlayMapScope
>

export type RemoveHazardLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
  RemoveHazardPayload,
  LivePlayMapScope
>

export type ClearHazardsLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
  ClearHazardsPayload,
  ClearHazardsLivePlayScope
>

export type EditHazardsLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS,
  EditHazardsPayload,
  EditHazardsLivePlayScope
>

export type ClearFieldEffectsLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
  ClearFieldEffectsPayload,
  ClearFieldEffectsLivePlayScope
>

export type SetFieldEffectLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
  SetFieldEffectPayload,
  LivePlayMapScope
>

export type RemoveFieldEffectLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
  RemoveFieldEffectPayload,
  LivePlayMapScope
>

export type TickFieldEffectDurationsLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS,
  TickFieldEffectDurationsPayload,
  LivePlayMapScope
>

export type BuildTerrainVoxelLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
  BuildTerrainVoxelPayload,
  LivePlayMapScope
>

export type RemoveTerrainVoxelLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL,
  RemoveTerrainVoxelPayload,
  LivePlayMapScope
>

export type EditTerrainVoxelsLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS,
  EditTerrainVoxelsPayload,
  EditTerrainVoxelsLivePlayScope
>

export type UpdateAttackOfOpportunityLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
  AttackOfOpportunityStateUpdatePayload,
  LivePlayMapScope
>

export type UpdateStartTurnModalLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.UPDATE_START_TURN_MODAL,
  StartTurnModalStateUpdatePayload,
  LivePlayMapScope
>

export type LivePlayInitiativeCommand =
  | SetInitiativeLivePlayCommand
  | NextInitiativeLivePlayCommand
  | PreviousInitiativeLivePlayCommand

export type LivePlayMapEffectCommand =
  | PlaceHazardLivePlayCommand
  | RemoveHazardLivePlayCommand
  | ClearHazardsLivePlayCommand
  | EditHazardsLivePlayCommand
  | ClearFieldEffectsLivePlayCommand
  | SetFieldEffectLivePlayCommand
  | RemoveFieldEffectLivePlayCommand
  | TickFieldEffectDurationsLivePlayCommand

export type LivePlayTerrainCommand =
  | BuildTerrainVoxelLivePlayCommand
  | RemoveTerrainVoxelLivePlayCommand
  | EditTerrainVoxelsLivePlayCommand

export type LivePlaySheetCommand =
  | ModifyHpLivePlayCommand
  | ModifyCombatStagesLivePlayCommand
  | ModifyConditionsLivePlayCommand
  | GrantExperienceLivePlayCommand

export type LivePlayTableActionCommand =
  | UseManeuverLivePlayCommand
  | UseAbilityLivePlayCommand
  | UseOrderLivePlayCommand

export interface LivePlayPatch<
  TType extends string = LivePlayPatchType,
  TPayload = unknown,
  TScope extends LivePlayScope = LivePlayScope,
> {
  readonly schemaVersion: typeof LIVE_PLAY_COMMAND_SCHEMA_VERSION
  readonly type: TType
  readonly mapSlug: string
  readonly revision: number
  readonly scopes: readonly TScope[]
  readonly payload: TPayload
}

export interface TokenMovedPatchPayload {
  readonly placementId: string
  readonly position: GridAnchor
  readonly facing?: TokenFacingDirection
  readonly turned?: boolean
  readonly movementLogEntry?: Record<string, unknown>
}

export interface TokenTurnedPatchPayload {
  readonly placementId: string
  readonly facing?: TokenFacingDirection
  readonly turned?: boolean
}

export interface SheetHpModifiedPatchPayload {
  readonly placementId: string
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly previous: Record<string, unknown>
  readonly current: Record<string, unknown>
  readonly sheetRevision: number
}

export interface CombatStagesModifiedPatchPayload {
  readonly placementId: string
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly previous: Record<string, unknown>
  readonly current: Record<string, unknown>
  readonly sheetRevision: number
}

export interface ConditionsModifiedPatchPayload {
  readonly placementId: string
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly previous: readonly string[]
  readonly current: readonly string[]
  readonly sheetRevision: number
}

export interface ExperienceGrantedPatchPayload {
  readonly placementId: string
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly previous: Record<string, unknown>
  readonly current: Record<string, unknown>
  readonly amount: number
  readonly sheetRevision: number
}

export interface MoveUsedPatchPayload {
  readonly placementId: string
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly moveName: string
  readonly moveKey: string
  readonly frequency: string
  readonly frequencyKind: string
  readonly tracking: 'map' | 'sheet' | 'none'
  readonly previousUsage: Record<string, unknown>
  readonly usage: Record<string, unknown>
  readonly sheetRevision?: number
  readonly moveLogEntry?: Record<string, unknown>
}

export interface InitiativePatchEntryState {
  readonly tokenId: string
  readonly initiative: number | null
}

export interface InitiativePatchLaneState {
  readonly activeId: string | null
  readonly round: number
  readonly entries: readonly InitiativePatchEntryState[]
  readonly manualOrderIds?: readonly string[]
}

export interface InitiativeLifecycleEventSummary {
  readonly eventId: string
  readonly kind: EncounterEventKind
  readonly reasonCode: string
}

export interface InitiativeLifecycleEffectTransitionSummary {
  readonly eventId: string
  readonly effectId: string
  readonly kind: string
  readonly reasonCode: string
}

export interface InitiativeLifecycleSheetChangeRef {
  readonly kind: SheetKind
  readonly slug: string
  readonly expectedRevision: number
  readonly revision: number
  readonly placementIds: readonly string[]
  readonly changedFields: readonly ('hp' | 'combatStages' | 'conditions')[]
}

export interface InitiativeLifecyclePatchPayload {
  readonly events: readonly InitiativeLifecycleEventSummary[]
  readonly effectTransitions: readonly InitiativeLifecycleEffectTransitionSummary[]
  readonly operationIds: readonly string[]
  readonly previousEncounterState: EncounterState
  readonly currentEncounterState: EncounterState
  readonly previousTemporaryHitPoints: TabletopMap['temporaryHitPoints'] | null
  readonly currentTemporaryHitPoints: TabletopMap['temporaryHitPoints'] | null
  readonly sheetChanges: readonly InitiativeLifecycleSheetChangeRef[]
}

export interface InitiativeUpdatedPatchPayload {
  readonly command:
    | typeof LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE
    | typeof LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE
    | typeof LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE
  readonly previous: InitiativePatchLaneState
  readonly current: InitiativePatchLaneState
  readonly changedTokenIds: readonly string[]
  readonly logEntry?: Record<string, unknown>
  readonly lifecycle?: InitiativeLifecyclePatchPayload
}

export interface MapMetadataUpdatedPatchPayload {
  /** Command or legacy metadata action that produced the authoritative metadata document. */
  readonly command?: string
  readonly action?: string
  readonly previous: Record<string, unknown>
  readonly current: Record<string, unknown>
  readonly clearedAttackOfOpportunityPromptIds?: readonly string[]
  readonly expiredOrderEffectIds?: readonly string[]
  readonly progressedOrderEffectIds?: readonly string[]
}

export interface HazardCellUpdatedPatchPayload {
  readonly command:
    | typeof LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD
    | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD
  readonly cell: GridAnchor
  readonly previous: readonly MapHazardV2[]
  readonly current: readonly MapHazardV2[]
  readonly placed?: MapHazardV2
  readonly removed: readonly MapHazardV2[]
}

export interface HazardsClearedPatchPayload {
  readonly command: typeof LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS
  readonly mode: ClearHazardsPayload['mode']
  readonly kind?: MapHazardKind
  readonly cells?: readonly GridAnchor[]
  /** Authoritative hazard lane before the transaction. */
  readonly previous: readonly MapHazardV2[]
  /** Authoritative hazard lane after the transaction. */
  readonly current: readonly MapHazardV2[]
  readonly removed: readonly MapHazardV2[]
}

export interface HazardCellBatchChangePatchPayload {
  readonly cell: GridAnchor
  readonly previous: readonly MapHazardV2[]
  readonly current: readonly MapHazardV2[]
  readonly placed?: readonly MapHazardV2[]
  readonly removed?: readonly MapHazardV2[]
}

export interface HazardsEditedPatchPayload {
  readonly command: typeof LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS
  readonly changes: readonly HazardCellBatchChangePatchPayload[]
  /** Optional authoritative hazard lane before the transaction. */
  readonly previous?: readonly MapHazardV2[]
  /** Authoritative hazard lane after the transaction for fallback reconciliation. */
  readonly current: readonly MapHazardV2[]
}

export type HazardsUpdatedPatchPayload =
  | HazardCellUpdatedPatchPayload
  | HazardsClearedPatchPayload
  | HazardsEditedPatchPayload

export interface FieldEffectsUpdatedPatchPayload {
  readonly command:
    | typeof LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS
    | typeof LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT
    | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT
    | typeof LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS
  readonly previous: MapFieldEffects
  readonly current: MapFieldEffects
  readonly category?: FieldEffectRemoveCategory
  readonly kind?: FieldEffectKind
  readonly kinds?: readonly FieldEffectKind[]
  readonly tickAmount?: number
}

export interface TerrainVoxelUpdatedPatchPayload {
  readonly command:
    | typeof LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL
    | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL
  readonly cell: GridAnchor
  readonly previous: MapVoxelV2 | null
  readonly current: MapVoxelV2 | null
  readonly built?: MapVoxelV2
  readonly removed?: MapVoxelV2
  readonly rendererInvalidation?: readonly string[]
}

export interface TerrainVoxelBatchChangePatchPayload {
  readonly cell: GridAnchor
  readonly previous: MapVoxelV2 | null
  readonly current: MapVoxelV2 | null
  readonly built?: MapVoxelV2
  readonly removed?: MapVoxelV2
}

export interface TerrainVoxelsEditedPatchPayload {
  readonly command: typeof LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS
  readonly changes: readonly TerrainVoxelBatchChangePatchPayload[]
  /** Optional authoritative terrain lane before the transaction when a final-set patch is safer. */
  readonly previous?: readonly MapVoxelV2[]
  /** Optional authoritative terrain lane after the transaction when a final-set patch is safer. */
  readonly current?: readonly MapVoxelV2[]
  readonly rendererInvalidation?: readonly string[]
}

export type TerrainVoxelsUpdatedPatchPayload =
  | TerrainVoxelUpdatedPatchPayload
  | TerrainVoxelsEditedPatchPayload

export type MoveStatePatchPayload = LivePlayMoveStatePatchPayload

export interface TokenSpawnedPatchPayload {
  readonly command:
    | typeof LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN
    | typeof LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON
  readonly placementId: string
  readonly trainerId?: string
  readonly previous: null
  readonly current: SheetPlacement
}

export interface SceneUpdatedPatchPayload {
  readonly command: typeof LIVE_PLAY_COMMAND_TYPES.SET_SCENE
  readonly previous: MapSceneState | null
  readonly current: MapSceneState | null
}

export interface TokenDeletedPatchPayload {
  readonly command: typeof LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN | typeof LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL
  readonly placementId: string
  readonly previous: SheetPlacement
  readonly current: null
}

export type TokenMovedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION, TokenMovedPatchPayload, LivePlayTokenScope>
export type TokenTurnedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_FACING, TokenTurnedPatchPayload, LivePlayTokenScope>
export type SheetHpModifiedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_HP, SheetHpModifiedPatchPayload, LivePlayScope>
export type ConditionsModifiedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_CONDITIONS, ConditionsModifiedPatchPayload, LivePlayScope>
export type CombatStagesModifiedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_COMBAT_STAGES, CombatStagesModifiedPatchPayload, LivePlayScope>
export type ExperienceGrantedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_EXPERIENCE, ExperienceGrantedPatchPayload, LivePlayScope>
export type MoveUsedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE | typeof LIVE_PLAY_PATCH_TYPES.TOKEN_ACTION, MoveUsedPatchPayload, LivePlayScope>
export type InitiativeUpdatedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE, InitiativeUpdatedPatchPayload, LivePlayMapScope>
export type MapMetadataUpdatedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_METADATA, MapMetadataUpdatedPatchPayload, LivePlayMapScope>
export type HazardsUpdatedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS, HazardsUpdatedPatchPayload, LivePlayMapScope>
export type FieldEffectsUpdatedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS, FieldEffectsUpdatedPatchPayload, LivePlayMapScope>
export type TerrainVoxelsUpdatedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN, TerrainVoxelsUpdatedPatchPayload, LivePlayMapScope>
export type MoveStatePatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MOVE_STATE, MoveStatePatchPayload, LivePlayScope>
export type TokenSpawnedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS, TokenSpawnedPatchPayload, LivePlayTokenScope>
export type TokenDeletedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS, TokenDeletedPatchPayload, LivePlayTokenScope>
export type SceneUpdatedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_SCENE, SceneUpdatedPatchPayload, LivePlayMapScope>

export type KnownLivePlayPatch =
  | TokenMovedPatch
  | TokenTurnedPatch
  | SheetHpModifiedPatch
  | ConditionsModifiedPatch
  | CombatStagesModifiedPatch
  | ExperienceGrantedPatch
  | MoveUsedPatch
  | InitiativeUpdatedPatch
  | MapMetadataUpdatedPatch
  | HazardsUpdatedPatch
  | FieldEffectsUpdatedPatch
  | TerrainVoxelsUpdatedPatch
  | MoveStatePatch
  | TokenSpawnedPatch
  | TokenDeletedPatch
  | SceneUpdatedPatch

export const LIVE_PLAY_COMMAND_REJECTION_REASONS = [
  'invalid',
  'unauthorized',
  'not-found',
  'stale-revision',
  'conflict',
  'no-op',
  'persistence-failed',
  'abandoned',
] as const
export type LivePlayCommandRejectionReason = (typeof LIVE_PLAY_COMMAND_REJECTION_REASONS)[number]

export type LivePlayCommandResult =
  | LivePlayCommandAccepted
  | LivePlayCommandRejected
  | LivePlayCommandDuplicate

export interface LivePlayCommandAccepted {
  readonly ok: true
  readonly opId: string
  readonly mapSlug: string
  readonly previousRevision: number
  readonly revision: number
  readonly patches: LivePlayPatch[]
}

export interface LivePlayCommandRejected {
  readonly ok: false
  readonly opId: string
  readonly mapSlug: string
  readonly reason: LivePlayCommandRejectionReason
  readonly message: string
  readonly currentRevision?: number
  readonly currentState?: unknown
}

export interface LivePlayCommandDuplicate {
  readonly ok: true
  readonly duplicate: true
  readonly opId: string
  readonly original: LivePlayCommandAccepted | LivePlayCommandRejected
}

export interface ShopCheckoutResultLine {
  readonly entryId: string
  readonly itemName: string
  readonly section: ShopEntrySectionKey
  readonly quantity: number
  readonly unitPrice: number
  readonly lineTotal: number
  /** Remaining stock for finite entries, or null when the entry remains unlimited. */
  readonly stock: ShopStockValue
}

export interface ShopCheckoutChangedDocuments {
  readonly shop: ShopTableDocument
  readonly groupInventories?: readonly GroupInventoryDocument[]
  readonly trainerSheets?: readonly TrainerSheet[]
}

export interface ShopCheckoutCommandAccepted {
  readonly ok: true
  readonly opId: string
  readonly shopSlug: string
  readonly previousShopRevision: number
  readonly shopRevision: number
  readonly totalPrice: number
  readonly lines: readonly ShopCheckoutResultLine[]
  readonly documents: ShopCheckoutChangedDocuments
}

export interface ShopCheckoutCommandRejected {
  readonly ok: false
  readonly opId: string
  readonly reason: LivePlayCommandRejectionReason
  readonly message: string
  readonly shopSlug?: string
  readonly currentShopRevision?: number
  readonly currentState?: unknown
}

export interface ShopCheckoutCommandDuplicate {
  readonly ok: true
  readonly duplicate: true
  readonly opId: string
  readonly original: ShopCheckoutCommandAccepted | ShopCheckoutCommandRejected
}

export type ShopCheckoutCommandResult =
  | ShopCheckoutCommandAccepted
  | ShopCheckoutCommandRejected
  | ShopCheckoutCommandDuplicate

export interface CreateLivePlayAcceptedResultInput {
  readonly opId: string
  readonly mapSlug: string
  readonly previousRevision: number
  readonly revision: number
  readonly patches: readonly LivePlayPatch[]
}

export interface CreateLivePlayRejectedResultInput {
  readonly opId: string
  readonly mapSlug: string
  readonly reason: LivePlayCommandRejectionReason
  readonly message: string
  readonly currentRevision?: number
  readonly currentState?: unknown
}

export interface CreateLivePlayDuplicateResultInput<
  TOriginal extends LivePlayCommandAccepted | LivePlayCommandRejected =
    | LivePlayCommandAccepted
    | LivePlayCommandRejected,
> {
  readonly opId?: string
  readonly original: TOriginal
}

export const createLivePlayAcceptedResult = (
  input: CreateLivePlayAcceptedResultInput,
): LivePlayCommandAccepted => ({
  ok: true,
  opId: input.opId,
  mapSlug: input.mapSlug,
  previousRevision: input.previousRevision,
  revision: input.revision,
  patches: [...input.patches],
})

export const createLivePlayRejectedResult = (
  input: CreateLivePlayRejectedResultInput,
): LivePlayCommandRejected => ({
  ok: false,
  opId: input.opId,
  mapSlug: input.mapSlug,
  reason: input.reason,
  message: input.message,
  ...(input.currentRevision === undefined ? {} : { currentRevision: input.currentRevision }),
  ...(input.currentState === undefined ? {} : { currentState: input.currentState }),
})

export const createLivePlayDuplicateResult = <
  TOriginal extends LivePlayCommandAccepted | LivePlayCommandRejected,
>(
  input: CreateLivePlayDuplicateResultInput<TOriginal>,
): LivePlayCommandDuplicate & { readonly original: TOriginal } => ({
  ok: true,
  duplicate: true,
  opId: input.opId ?? input.original.opId,
  original: input.original,
})

const LIVE_PLAY_COMMAND_TYPE_SET = new Set<unknown>(LIVE_PLAY_COMMAND_TYPE_VALUES)
const LIVE_PLAY_MAP_COMMAND_TYPE_SET = new Set<unknown>(LIVE_PLAY_MAP_COMMAND_TYPE_VALUES)
const LIVE_PLAY_PATCH_TYPE_SET = new Set<unknown>(LIVE_PLAY_PATCH_TYPE_VALUES)
const LIVE_PLAY_MAP_SCOPE_LANE_SET = new Set<unknown>(LIVE_PLAY_MAP_SCOPE_LANES)
const LIVE_PLAY_TOKEN_SCOPE_FIELD_SET = new Set<unknown>(LIVE_PLAY_TOKEN_SCOPE_FIELDS)
const LIVE_PLAY_SHOP_SCOPE_FIELD_SET = new Set<unknown>(LIVE_PLAY_SHOP_SCOPE_FIELDS)
const LIVE_PLAY_GROUP_INVENTORY_SCOPE_FIELD_SET = new Set<unknown>(LIVE_PLAY_GROUP_INVENTORY_SCOPE_FIELDS)
const SHOP_CHECKOUT_TRAINER_SHEET_SCOPE_FIELD_SET = new Set<unknown>(SHOP_CHECKOUT_TRAINER_SHEET_SCOPE_FIELDS)
const LIVE_PLAY_COMMAND_REJECTION_REASON_SET = new Set<unknown>(LIVE_PLAY_COMMAND_REJECTION_REASONS)
const LIVE_PLAY_OP_ID_RANDOM_PART_UNSAFE_RE = /[^A-Za-z0-9_-]/g

export const isLivePlayCommandType = (value: unknown): value is LivePlayCommandType =>
  LIVE_PLAY_COMMAND_TYPE_SET.has(value)

export const isLivePlayMapCommandType = (value: unknown): value is LivePlayMapCommandType =>
  LIVE_PLAY_MAP_COMMAND_TYPE_SET.has(value)

export const isLivePlayPatchType = (value: unknown): value is LivePlayPatchType =>
  LIVE_PLAY_PATCH_TYPE_SET.has(value)

export const isLivePlayMapScopeLane = (value: unknown): value is LivePlayMapScopeLane =>
  LIVE_PLAY_MAP_SCOPE_LANE_SET.has(value)

export const isLivePlayTokenScopeField = (value: unknown): value is LivePlayTokenScopeField =>
  LIVE_PLAY_TOKEN_SCOPE_FIELD_SET.has(value)

export const isLivePlayShopScopeField = (value: unknown): value is LivePlayShopScopeField =>
  LIVE_PLAY_SHOP_SCOPE_FIELD_SET.has(value)

export const isLivePlayGroupInventoryScopeField = (
  value: unknown,
): value is LivePlayGroupInventoryScopeField => LIVE_PLAY_GROUP_INVENTORY_SCOPE_FIELD_SET.has(value)

export const isShopCheckoutTrainerSheetScopeField = (
  value: unknown,
): value is ShopCheckoutTrainerSheetScopeField => SHOP_CHECKOUT_TRAINER_SHEET_SCOPE_FIELD_SET.has(value)

export const isLivePlayCommandRejectionReason = (
  value: unknown,
): value is LivePlayCommandRejectionReason => LIVE_PLAY_COMMAND_REJECTION_REASON_SET.has(value)

export const isLivePlayOpId = (value: unknown): value is LivePlayOpId =>
  typeof value === 'string' && LIVE_PLAY_OP_ID_RE.test(value)

export const parseLivePlayOpId = (value: unknown, label = 'opId'): LivePlayOpId => {
  if (!isLivePlayOpId(value)) {
    throw new Error(`${label} must match ${LIVE_PLAY_OP_ID_PATTERN_DESCRIPTION}`)
  }
  return value
}

export type LivePlayRandomUuidProvider = () => string

const getDefaultRandomUuid = (): string => {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID is required to create live-play opId values')
  }

  return globalThis.crypto.randomUUID()
}

export const createLivePlayOpId = (
  randomUuid: LivePlayRandomUuidProvider = getDefaultRandomUuid,
): LivePlayOpId => {
  const randomPart = randomUuid().normalize('NFKC').replace(LIVE_PLAY_OP_ID_RANDOM_PART_UNSAFE_RE, '')
  return parseLivePlayOpId(`${LIVE_PLAY_OP_ID_PREFIX}${randomPart}`)
}

export const isLivePlayBaseRevision = (value: unknown): value is LivePlayBaseRevision =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export const parseLivePlayBaseRevision = (
  value: unknown,
  label = 'baseRevision',
): LivePlayBaseRevision => {
  if (!isLivePlayBaseRevision(value)) {
    throw new Error(`${label} must be a safe non-negative integer revision`)
  }
  return value
}

export const isLivePlayMapSlug = (value: unknown): value is LivePlayMapSlug => isSlug(value)

export const parseLivePlayMapSlug = (value: unknown, label = 'mapSlug'): LivePlayMapSlug => {
  if (!isLivePlayMapSlug(value)) {
    throw new Error(`${label} must match ${SLUG_PATTERN_DESCRIPTION}`)
  }
  return value
}

export const parseLivePlayCommandType = (
  value: unknown,
  label = 'type',
): LivePlayCommandType => {
  if (!isLivePlayCommandType(value)) {
    throw new Error(`${label} must be a supported live-play command type`)
  }
  return value
}

export const parseLivePlayMapCommandType = (
  value: unknown,
  label = 'type',
): LivePlayMapCommandType => {
  if (!isLivePlayMapCommandType(value)) {
    throw new Error(`${label} must be a supported map live-play command type`)
  }
  return value
}

export const LIVE_PLAY_COMMAND_REQUIRED_FIELDS = [
  'schemaVersion',
  'opId',
  'mapSlug',
  'baseRevision',
  'type',
  'scopes',
  'payload',
] as const
export type LivePlayCommandRequiredField = (typeof LIVE_PLAY_COMMAND_REQUIRED_FIELDS)[number]

export const SHOP_CHECKOUT_COMMAND_REQUIRED_FIELDS = [
  'schemaVersion',
  'opId',
  'type',
  'scopes',
  'payload',
] as const
export type ShopCheckoutCommandRequiredField = (typeof SHOP_CHECKOUT_COMMAND_REQUIRED_FIELDS)[number]

export const LIVE_PLAY_COMMAND_VALIDATION_CODES = [
  'not-object',
  'missing-field',
  'invalid-schema-version',
  'invalid-op-id',
  'invalid-map-slug',
  'invalid-base-revision',
  'unsupported-command-type',
  'invalid-scopes',
  'invalid-scope-kind',
  'invalid-map-scope',
  'invalid-token-scope',
  'invalid-sheet-scope',
  'invalid-shop-scope',
  'invalid-group-inventory-scope',
  'invalid-payload',
] as const
export type LivePlayCommandValidationCode = (typeof LIVE_PLAY_COMMAND_VALIDATION_CODES)[number]

export interface LivePlayCommandValidationIssue {
  readonly path: string
  readonly code: LivePlayCommandValidationCode
  readonly message: string
  readonly expected?: string
  readonly received?: string
}

export interface LivePlayCommandValidationSuccess<
  TCommand extends LivePlayCommandCoreEnvelope = LivePlayCommandEnvelope,
> {
  readonly valid: true
  readonly command: TCommand
  readonly issues: readonly []
}

export interface LivePlayCommandValidationFailure {
  readonly valid: false
  readonly issues: readonly LivePlayCommandValidationIssue[]
}

export type LivePlayCommandValidationResult<
  TCommand extends LivePlayCommandCoreEnvelope = LivePlayCommandEnvelope,
> = LivePlayCommandValidationSuccess<TCommand> | LivePlayCommandValidationFailure

type UnknownRecord = Record<string, unknown>
type MutableIssueList = LivePlayCommandValidationIssue[]

const EXPECTED_OBJECT = 'object'
const EXPECTED_NON_EMPTY_STRING = 'non-empty string'
const EXPECTED_GRID_COORDINATE = 'safe non-negative integer grid coordinate'
const EXPECTED_ROUND = 'safe integer >= 1'
const EXPECTED_INITIATIVE_VALUE = `${LIVE_PLAY_INITIATIVE_MIN_VALUE}..${LIVE_PLAY_INITIATIVE_MAX_VALUE} integer or null`
const EXPECTED_MANUAL_ORDER_IDS = 'array of unique non-empty token ID strings or null'
const MAP_SCOPE_CELL_FIELDS = ['x', 'y', 'z'] as const

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const isGridCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value)

const isInitiativeValue = (value: unknown): value is number | null =>
  value === null || (
    isSafeInteger(value)
    && value >= LIVE_PLAY_INITIATIVE_MIN_VALUE
    && value <= LIVE_PLAY_INITIATIVE_MAX_VALUE
  )

const describeReceived = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const addIssue = (
  issues: MutableIssueList,
  path: string,
  code: LivePlayCommandValidationCode,
  message: string,
  expected?: string,
  received?: unknown,
): void => {
  issues.push({
    path,
    code,
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(received === undefined ? {} : { received: describeReceived(received) }),
  })
}

const cloneSetInitiativePayload = (payload: SetInitiativePayload): SetInitiativePayload => ({
  ...(payload.tokenId === undefined ? {} : { tokenId: payload.tokenId }),
  ...(payload.initiative === undefined ? {} : { initiative: payload.initiative }),
  ...(payload.activeId === undefined ? {} : { activeId: payload.activeId }),
  ...(payload.round === undefined ? {} : { round: payload.round }),
  ...(payload.manualOrderIds === undefined
    ? {}
    : { manualOrderIds: payload.manualOrderIds === null ? null : [...payload.manualOrderIds] }),
})

const collectManualOrderIdsIssues = (
  value: unknown,
  path: string,
  commandLabel: string,
  issues: MutableIssueList,
): readonly string[] | null | undefined => {
  if (value === null) return null

  if (!Array.isArray(value)) {
    addIssue(
      issues,
      path,
      'invalid-payload',
      `${commandLabel} payload.manualOrderIds must be a non-empty array of unique token ID strings, or null to clear manual order.`,
      EXPECTED_MANUAL_ORDER_IDS,
      value,
    )
    return undefined
  }

  if (value.length === 0) {
    addIssue(
      issues,
      path,
      'invalid-payload',
      `${commandLabel} payload.manualOrderIds must not be empty. Use null to clear manual order.`,
      EXPECTED_MANUAL_ORDER_IDS,
      value,
    )
  }

  const ids: string[] = []
  const seenIds = new Set<string>()
  value.forEach((id, index) => {
    if (!isNonEmptyString(id)) {
      addIssue(
        issues,
        `${path}[${index}]`,
        'invalid-payload',
        `${commandLabel} payload.manualOrderIds[${index}] must be a non-empty token ID string.`,
        EXPECTED_NON_EMPTY_STRING,
        id,
      )
      return
    }

    if (seenIds.has(id)) {
      addIssue(
        issues,
        `${path}[${index}]`,
        'invalid-payload',
        `${commandLabel} payload.manualOrderIds must not contain duplicate token IDs.`,
        'unique token ID',
        id,
      )
      return
    }

    seenIds.add(id)
    ids.push(id)
  })

  return ids
}

const collectSetInitiativePayloadIssues = (
  payload: unknown,
  issues: MutableIssueList,
): SetInitiativePayload | undefined => {
  if (!isRecord(payload)) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'setInitiative payload must be an object.',
      EXPECTED_OBJECT,
      payload,
    )
    return undefined
  }

  const tokenId = payload.tokenId
  const initiative = payload.initiative
  const activeId = payload.activeId
  const round = payload.round
  const manualOrderIds = payload.manualOrderIds
  const setsInitiative = hasOwn(payload, 'initiative')
  const setsActive = hasOwn(payload, 'activeId')
  const setsRound = hasOwn(payload, 'round')
  const setsManualOrder = hasOwn(payload, 'manualOrderIds')

  if (!setsInitiative && !setsActive && !setsRound && !setsManualOrder) {
    addIssue(
      issues,
      'payload',
      'invalid-payload',
      'setInitiative payload must set at least one of initiative, activeId, round, or manualOrderIds.',
      'one or more initiative changes',
      payload,
    )
  }

  if (setsInitiative) {
    if (!isNonEmptyString(tokenId)) {
      addIssue(
        issues,
        'payload.tokenId',
        'invalid-payload',
        'setInitiative payload.tokenId must be a non-empty token ID string when initiative is provided.',
        EXPECTED_NON_EMPTY_STRING,
        tokenId,
      )
    }

    if (!isInitiativeValue(initiative)) {
      addIssue(
        issues,
        'payload.initiative',
        'invalid-payload',
        `setInitiative payload.initiative must be an integer from ${LIVE_PLAY_INITIATIVE_MIN_VALUE} to ${LIVE_PLAY_INITIATIVE_MAX_VALUE}, or null to clear it.`,
        EXPECTED_INITIATIVE_VALUE,
        initiative,
      )
    }
  } else if (hasOwn(payload, 'tokenId')) {
    addIssue(
      issues,
      'payload.tokenId',
      'invalid-payload',
      'setInitiative payload.tokenId is only valid when payload.initiative is provided.',
      'tokenId with initiative',
      tokenId,
    )
  }

  if (setsActive && activeId !== null && !isNonEmptyString(activeId)) {
    addIssue(
      issues,
      'payload.activeId',
      'invalid-payload',
      'setInitiative payload.activeId must be a non-empty token ID string or null.',
      'non-empty string or null',
      activeId,
    )
  }

  if (setsRound && !(isSafeInteger(round) && round >= 1)) {
    addIssue(
      issues,
      'payload.round',
      'invalid-payload',
      'setInitiative payload.round must be a safe integer greater than or equal to 1.',
      EXPECTED_ROUND,
      round,
    )
  }

  const validatedManualOrderIds = setsManualOrder
    ? collectManualOrderIdsIssues(manualOrderIds, 'payload.manualOrderIds', 'setInitiative', issues)
    : undefined

  if (issues.some((issue) => issue.path.startsWith('payload'))) return undefined

  return cloneSetInitiativePayload({
    ...(setsInitiative ? { tokenId: tokenId as string, initiative: initiative as number | null } : {}),
    ...(setsActive ? { activeId: activeId as string | null } : {}),
    ...(setsRound ? { round: round as number } : {}),
    ...(setsManualOrder ? { manualOrderIds: validatedManualOrderIds as readonly string[] | null } : {}),
  })
}

const validateRequiredFields = (
  record: UnknownRecord,
  issues: MutableIssueList,
  fields: readonly string[] = LIVE_PLAY_COMMAND_REQUIRED_FIELDS,
  envelopeDescription = 'live-play command envelopes',
): void => {
  for (const field of fields) {
    if (!hasOwn(record, field)) {
      addIssue(issues, field, 'missing-field', `${field} is required on ${envelopeDescription}.`)
    }
  }

  if (hasOwn(record, 'payload') && record.payload === undefined) {
    addIssue(issues, 'payload', 'invalid-payload', 'payload must be provided.', 'defined value')
  }
}

const validateMapScopeCell = (
  scope: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!hasOwn(scope, 'cell')) return

  if (scope.lane !== 'hazards' && scope.lane !== 'terrain') {
    addIssue(
      issues,
      `${path}.cell`,
      'invalid-map-scope',
      `${path}.cell is only supported for map hazards or terrain scopes.`,
      'hazards or terrain map scope cell',
      scope.cell,
    )
    return
  }

  if (!isRecord(scope.cell)) {
    addIssue(
      issues,
      `${path}.cell`,
      'invalid-map-scope',
      `${path}.cell must be a grid cell object when provided.`,
      EXPECTED_OBJECT,
      scope.cell,
    )
    return
  }

  for (const coordinate of MAP_SCOPE_CELL_FIELDS) {
    if (!isGridCoordinate(scope.cell[coordinate])) {
      addIssue(
        issues,
        `${path}.cell.${coordinate}`,
        'invalid-map-scope',
        `${path}.cell.${coordinate} must be a safe non-negative integer grid coordinate.`,
        EXPECTED_GRID_COORDINATE,
        scope.cell[coordinate],
      )
    }
  }

  for (const field of Object.keys(scope.cell)) {
    if (!(MAP_SCOPE_CELL_FIELDS as readonly string[]).includes(field)) {
      addIssue(
        issues,
        `${path}.cell.${field}`,
        'invalid-map-scope',
        `${path}.cell.${field} is not supported on live-play map ${scope.lane} cell scopes.`,
        MAP_SCOPE_CELL_FIELDS.join(' | '),
        scope.cell[field],
      )
    }
  }
}

const validateMapScope = (
  scope: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isLivePlayMapScopeLane(scope.lane)) {
    addIssue(
      issues,
      `${path}.lane`,
      'invalid-map-scope',
      `${path}.lane must be a known live-play map scope lane.`,
      LIVE_PLAY_MAP_SCOPE_LANES.join(' | '),
      scope.lane,
    )
  }

  validateMapScopeCell(scope, path, issues)
}

const validateTokenScope = (
  scope: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isNonEmptyString(scope.placementId)) {
    addIssue(
      issues,
      `${path}.placementId`,
      'invalid-token-scope',
      `${path}.placementId must be a non-empty string.`,
      EXPECTED_NON_EMPTY_STRING,
      scope.placementId,
    )
  }

  if (!isLivePlayTokenScopeField(scope.field)) {
    addIssue(
      issues,
      `${path}.field`,
      'invalid-token-scope',
      `${path}.field must be a known live-play token scope field.`,
      LIVE_PLAY_TOKEN_SCOPE_FIELDS.join(' | '),
      scope.field,
    )
  }
}

const validateSheetScope = (
  scope: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isSheetKind(scope.sheetKind)) {
    addIssue(
      issues,
      `${path}.sheetKind`,
      'invalid-sheet-scope',
      `${path}.sheetKind must be pokemon or trainer.`,
      'pokemon | trainer',
      scope.sheetKind,
    )
  }

  if (!isSlug(scope.sheetSlug)) {
    addIssue(
      issues,
      `${path}.sheetSlug`,
      'invalid-sheet-scope',
      `${path}.sheetSlug must match ${SLUG_PATTERN_DESCRIPTION}.`,
      SLUG_PATTERN_DESCRIPTION,
      scope.sheetSlug,
    )
  }

  if (!isNonEmptyString(scope.field)) {
    addIssue(
      issues,
      `${path}.field`,
      'invalid-sheet-scope',
      `${path}.field must be a non-empty string.`,
      EXPECTED_NON_EMPTY_STRING,
      scope.field,
    )
  }
}

const validateShopCheckoutShopScope = (
  scope: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isSlug(scope.shopSlug)) {
    addIssue(
      issues,
      `${path}.shopSlug`,
      'invalid-shop-scope',
      `${path}.shopSlug must match ${SLUG_PATTERN_DESCRIPTION}.`,
      SLUG_PATTERN_DESCRIPTION,
      scope.shopSlug,
    )
  }

  if (!isLivePlayShopScopeField(scope.field)) {
    addIssue(
      issues,
      `${path}.field`,
      'invalid-shop-scope',
      `${path}.field must be stock or purchase.`,
      LIVE_PLAY_SHOP_SCOPE_FIELDS.join(' | '),
      scope.field,
    )
  }
}

const validateShopCheckoutGroupInventoryScope = (
  scope: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isSlug(scope.slug)) {
    addIssue(
      issues,
      `${path}.slug`,
      'invalid-group-inventory-scope',
      `${path}.slug must match ${SLUG_PATTERN_DESCRIPTION}.`,
      SLUG_PATTERN_DESCRIPTION,
      scope.slug,
    )
  }

  if (!isLivePlayGroupInventoryScopeField(scope.field)) {
    addIssue(
      issues,
      `${path}.field`,
      'invalid-group-inventory-scope',
      `${path}.field must be money or inventory.`,
      LIVE_PLAY_GROUP_INVENTORY_SCOPE_FIELDS.join(' | '),
      scope.field,
    )
  }
}

const validateShopCheckoutTrainerSheetScope = (
  scope: UnknownRecord,
  path: string,
  issues: MutableIssueList,
): void => {
  if (scope.sheetKind !== 'trainer') {
    addIssue(
      issues,
      `${path}.sheetKind`,
      'invalid-sheet-scope',
      `${path}.sheetKind must be trainer for shop checkout trainer scopes.`,
      'trainer',
      scope.sheetKind,
    )
  }

  if (!isSlug(scope.sheetSlug)) {
    addIssue(
      issues,
      `${path}.sheetSlug`,
      'invalid-sheet-scope',
      `${path}.sheetSlug must match ${SLUG_PATTERN_DESCRIPTION}.`,
      SLUG_PATTERN_DESCRIPTION,
      scope.sheetSlug,
    )
  }

  if (!isShopCheckoutTrainerSheetScopeField(scope.field)) {
    addIssue(
      issues,
      `${path}.field`,
      'invalid-sheet-scope',
      `${path}.field must be money or inventory for shop checkout trainer scopes.`,
      SHOP_CHECKOUT_TRAINER_SHEET_SCOPE_FIELDS.join(' | '),
      scope.field,
    )
  }
}

const validateScope = (scope: unknown, path: string, issues: MutableIssueList): void => {
  if (!isRecord(scope)) {
    addIssue(issues, path, 'invalid-scopes', `${path} must be an object.`, EXPECTED_OBJECT, scope)
    return
  }

  if (scope.kind !== 'map' && scope.kind !== 'token' && scope.kind !== 'sheet') {
    addIssue(
      issues,
      `${path}.kind`,
      'invalid-scope-kind',
      `${path}.kind must be map, token, or sheet.`,
      'map | token | sheet',
      scope.kind,
    )
    return
  }

  if (scope.kind === 'map') {
    validateMapScope(scope, path, issues)
    return
  }

  if (scope.kind === 'token') {
    validateTokenScope(scope, path, issues)
    return
  }

  validateSheetScope(scope, path, issues)
}

const validateScopes = (scopes: unknown, issues: MutableIssueList): void => {
  if (!Array.isArray(scopes)) {
    addIssue(issues, 'scopes', 'invalid-scopes', 'scopes must be an array.', 'array', scopes)
    return
  }

  if (scopes.length === 0) {
    addIssue(
      issues,
      'scopes',
      'invalid-scopes',
      'scopes must contain at least one resource scope.',
      'non-empty array',
      scopes,
    )
    return
  }

  scopes.forEach((scope, index) => validateScope(scope, `scopes[${index}]`, issues))
}

const validateShopCheckoutScope = (
  scope: unknown,
  path: string,
  issues: MutableIssueList,
): void => {
  if (!isRecord(scope)) {
    addIssue(issues, path, 'invalid-scopes', `${path} must be an object.`, EXPECTED_OBJECT, scope)
    return
  }

  if (scope.kind === 'shop') {
    validateShopCheckoutShopScope(scope, path, issues)
    return
  }

  if (scope.kind === 'groupInventory') {
    validateShopCheckoutGroupInventoryScope(scope, path, issues)
    return
  }

  if (scope.kind === 'sheet') {
    validateShopCheckoutTrainerSheetScope(scope, path, issues)
    return
  }

  addIssue(
    issues,
    `${path}.kind`,
    'invalid-scope-kind',
    `${path}.kind must be shop, groupInventory, or trainer sheet.`,
    'shop | groupInventory | sheet',
    scope.kind,
  )
}

const validateShopCheckoutScopes = (scopes: unknown, issues: MutableIssueList): void => {
  if (!Array.isArray(scopes)) {
    addIssue(issues, 'scopes', 'invalid-scopes', 'scopes must be an array.', 'array', scopes)
    return
  }

  if (scopes.length === 0) {
    addIssue(
      issues,
      'scopes',
      'invalid-scopes',
      'scopes must contain at least one resource scope.',
      'non-empty array',
      scopes,
    )
    return
  }

  scopes.forEach((scope, index) => validateShopCheckoutScope(scope, `scopes[${index}]`, issues))
}

export const collectLivePlayCommandEnvelopeIssues = (
  value: unknown,
): readonly LivePlayCommandValidationIssue[] => {
  const issues: MutableIssueList = []

  if (!isRecord(value)) {
    addIssue(
      issues,
      '$',
      'not-object',
      'live-play command envelope must be an object.',
      EXPECTED_OBJECT,
      value,
    )
    return issues
  }

  validateRequiredFields(value, issues)

  if (hasOwn(value, 'schemaVersion') && value.schemaVersion !== LIVE_PLAY_COMMAND_SCHEMA_VERSION) {
    addIssue(
      issues,
      'schemaVersion',
      'invalid-schema-version',
      `schemaVersion must be ${LIVE_PLAY_COMMAND_SCHEMA_VERSION}.`,
      String(LIVE_PLAY_COMMAND_SCHEMA_VERSION),
      value.schemaVersion,
    )
  }

  if (hasOwn(value, 'opId') && !isLivePlayOpId(value.opId)) {
    addIssue(
      issues,
      'opId',
      'invalid-op-id',
      `opId must match ${LIVE_PLAY_OP_ID_PATTERN_DESCRIPTION}.`,
      LIVE_PLAY_OP_ID_PATTERN_DESCRIPTION,
      value.opId,
    )
  }

  if (hasOwn(value, 'mapSlug') && !isLivePlayMapSlug(value.mapSlug)) {
    addIssue(
      issues,
      'mapSlug',
      'invalid-map-slug',
      `mapSlug must match ${SLUG_PATTERN_DESCRIPTION}.`,
      SLUG_PATTERN_DESCRIPTION,
      value.mapSlug,
    )
  }

  if (hasOwn(value, 'baseRevision') && !isLivePlayBaseRevision(value.baseRevision)) {
    addIssue(
      issues,
      'baseRevision',
      'invalid-base-revision',
      'baseRevision must be a safe non-negative integer revision.',
      'safe non-negative integer revision',
      value.baseRevision,
    )
  }

  if (hasOwn(value, 'type') && !isLivePlayMapCommandType(value.type)) {
    addIssue(
      issues,
      'type',
      'unsupported-command-type',
      'type must be a supported map live-play command type.',
      LIVE_PLAY_MAP_COMMAND_TYPE_VALUES.join(' | '),
      value.type,
    )
  }

  if (hasOwn(value, 'scopes')) {
    validateScopes(value.scopes, issues)
  }

  if (value.type === LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE && hasOwn(value, 'payload') && value.payload !== undefined) {
    collectSetInitiativePayloadIssues(value.payload, issues)
  }

  return issues
}

export const collectShopCheckoutCommandEnvelopeIssues = (
  value: unknown,
): readonly LivePlayCommandValidationIssue[] => {
  const issues: MutableIssueList = []

  if (!isRecord(value)) {
    addIssue(
      issues,
      '$',
      'not-object',
      'shop checkout live-play command envelope must be an object.',
      EXPECTED_OBJECT,
      value,
    )
    return issues
  }

  validateRequiredFields(
    value,
    issues,
    SHOP_CHECKOUT_COMMAND_REQUIRED_FIELDS,
    'shop checkout live-play command envelopes',
  )

  if (hasOwn(value, 'schemaVersion') && value.schemaVersion !== LIVE_PLAY_COMMAND_SCHEMA_VERSION) {
    addIssue(
      issues,
      'schemaVersion',
      'invalid-schema-version',
      `schemaVersion must be ${LIVE_PLAY_COMMAND_SCHEMA_VERSION}.`,
      String(LIVE_PLAY_COMMAND_SCHEMA_VERSION),
      value.schemaVersion,
    )
  }

  if (hasOwn(value, 'opId') && !isLivePlayOpId(value.opId)) {
    addIssue(
      issues,
      'opId',
      'invalid-op-id',
      `opId must match ${LIVE_PLAY_OP_ID_PATTERN_DESCRIPTION}.`,
      LIVE_PLAY_OP_ID_PATTERN_DESCRIPTION,
      value.opId,
    )
  }

  if (hasOwn(value, 'type') && value.type !== LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT) {
    addIssue(
      issues,
      'type',
      'unsupported-command-type',
      'type must be shopCheckout for shop checkout live-play command envelopes.',
      LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
      value.type,
    )
  }

  if (hasOwn(value, 'scopes')) {
    validateShopCheckoutScopes(value.scopes, issues)
  }

  return issues
}

export const validateLivePlayCommandEnvelope = <
  TCommand extends LivePlayCommandEnvelope = LivePlayCommandEnvelope,
>(
  value: unknown,
): LivePlayCommandValidationResult<TCommand> => {
  const issues = collectLivePlayCommandEnvelopeIssues(value)
  if (issues.length > 0) {
    return { valid: false, issues }
  }

  return { valid: true, command: value as TCommand, issues: [] }
}

export const isValidLivePlayCommandEnvelope = (value: unknown): value is LivePlayCommandEnvelope =>
  collectLivePlayCommandEnvelopeIssues(value).length === 0

export const assertValidLivePlayCommandEnvelope = <
  TCommand extends LivePlayCommandEnvelope = LivePlayCommandEnvelope,
>(
  value: unknown,
  label = 'live-play command envelope',
): TCommand => {
  const result = validateLivePlayCommandEnvelope<TCommand>(value)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}

export const validateShopCheckoutCommandEnvelope = <
  TCommand extends ShopCheckoutLivePlayCommand = ShopCheckoutLivePlayCommand,
>(
  value: unknown,
): LivePlayCommandValidationResult<TCommand> => {
  const issues = collectShopCheckoutCommandEnvelopeIssues(value)
  if (issues.length > 0) {
    return { valid: false, issues }
  }

  return { valid: true, command: value as TCommand, issues: [] }
}

export const isValidShopCheckoutCommandEnvelope = (
  value: unknown,
): value is ShopCheckoutLivePlayCommand => collectShopCheckoutCommandEnvelopeIssues(value).length === 0

export const assertValidShopCheckoutCommandEnvelope = <
  TCommand extends ShopCheckoutLivePlayCommand = ShopCheckoutLivePlayCommand,
>(
  value: unknown,
  label = 'shop checkout live-play command envelope',
): TCommand => {
  const result = validateShopCheckoutCommandEnvelope<TCommand>(value)
  if (result.valid) return result.command

  const summary = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
  throw new Error(`${label} is invalid: ${summary}`)
}
