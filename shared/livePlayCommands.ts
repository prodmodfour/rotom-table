import { isSlug, SLUG_PATTERN_DESCRIPTION } from './paths'
import { isSheetKind, type SheetKind } from './sheets'
import type {
  GridAnchor,
  MapFieldEffects,
  MapHazardKind,
  MapHazardV2,
  MapRoomKind,
  MapTerrainKind,
  MapVoxelV2,
  MapWeatherKind,
  SheetPlacement,
} from '~/types/map'
import type { TokenFacingDirection } from '~/types/tokenFacing'

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
  USE_MOVE: 'useMove',
  USE_MANEUVER: 'useManeuver',
  USE_ABILITY: 'useAbility',
  USE_ORDER: 'useOrder',
  SET_INITIATIVE: 'setInitiative',
  NEXT_INITIATIVE: 'nextInitiative',
  PREVIOUS_INITIATIVE: 'previousInitiative',
  PLACE_HAZARD: 'placeHazard',
  REMOVE_HAZARD: 'removeHazard',
  SET_FIELD_EFFECT: 'setFieldEffect',
  REMOVE_FIELD_EFFECT: 'removeFieldEffect',
  TICK_FIELD_EFFECT_DURATIONS: 'tickFieldEffectDurations',
  BUILD_TERRAIN_VOXEL: 'buildTerrainVoxel',
  REMOVE_TERRAIN_VOXEL: 'removeTerrainVoxel',
  SPAWN_TOKEN: 'spawnToken',
  DELETE_TOKEN: 'deleteToken',
} as const

export type LivePlayCommandType = (typeof LIVE_PLAY_COMMAND_TYPES)[keyof typeof LIVE_PLAY_COMMAND_TYPES]

export const LIVE_PLAY_COMMAND_TYPE_VALUES = [
  LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
  LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
  LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES,
  LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
  LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
  LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
  LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
  LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
  LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
  LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
  LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
  LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
  LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
  LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
  LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
  LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS,
  LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
  LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL,
  LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
  LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
] as const satisfies readonly LivePlayCommandType[]

export const LIVE_PLAY_PATCH_TYPES = {
  TOKEN_POSITION: 'token.position',
  TOKEN_FACING: 'token.facing',
  TOKEN_HP: 'token.hp',
  TOKEN_CONDITIONS: 'token.conditions',
  TOKEN_COMBAT_STAGES: 'token.combatStages',
  TOKEN_MOVE_USAGE: 'token.moveUsage',
  TOKEN_ACTION: 'token.action',
  MAP_INITIATIVE: 'map.initiative',
  MAP_HAZARDS: 'map.hazards',
  MAP_FIELD_EFFECTS: 'map.fieldEffects',
  MAP_TERRAIN: 'map.terrain',
  MAP_PLACEMENTS: 'map.placements',
  MAP_METADATA: 'map.metadata',
  SHEET_FIELD: 'sheet.field',
  RECONCILIATION_REQUIRED: 'reconciliation.required',
} as const

export type LivePlayPatchType = (typeof LIVE_PLAY_PATCH_TYPES)[keyof typeof LIVE_PLAY_PATCH_TYPES]

export const LIVE_PLAY_PATCH_TYPE_VALUES = [
  LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
  LIVE_PLAY_PATCH_TYPES.TOKEN_FACING,
  LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
  LIVE_PLAY_PATCH_TYPES.TOKEN_CONDITIONS,
  LIVE_PLAY_PATCH_TYPES.TOKEN_COMBAT_STAGES,
  LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE,
  LIVE_PLAY_PATCH_TYPES.TOKEN_ACTION,
  LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE,
  LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS,
  LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS,
  LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN,
  LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS,
  LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
  LIVE_PLAY_PATCH_TYPES.SHEET_FIELD,
  LIVE_PLAY_PATCH_TYPES.RECONCILIATION_REQUIRED,
] as const satisfies readonly LivePlayPatchType[]

export const LIVE_PLAY_MAP_SCOPE_LANES = [
  'initiative',
  'hazards',
  'fieldEffects',
  'terrain',
  'placements',
  'metadata',
] as const
export type LivePlayMapScopeLane = (typeof LIVE_PLAY_MAP_SCOPE_LANES)[number]

export const LIVE_PLAY_TOKEN_SCOPE_FIELDS = [
  'position',
  'facing',
  'hp',
  'conditions',
  'combatStages',
  'moveUsage',
  'action',
  'spawn',
  'delete',
] as const
export type LivePlayTokenScopeField = (typeof LIVE_PLAY_TOKEN_SCOPE_FIELDS)[number]

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

export type LivePlayScope = LivePlayMapScope | LivePlayTokenScope | LivePlaySheetScope

export interface LivePlayCommandEnvelope<
  TType extends string = LivePlayCommandType,
  TPayload = unknown,
  TScope extends LivePlayScope = LivePlayScope,
> {
  readonly schemaVersion: typeof LIVE_PLAY_COMMAND_SCHEMA_VERSION
  readonly opId: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly type: TType
  readonly scopes: readonly TScope[]
  readonly payload: TPayload
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

export interface ModifyHpPayload {
  readonly placementId: string
  readonly currentHp: number
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
}

export type AdvanceInitiativePayload = Record<string, never>

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

export type UseMoveLivePlayCommand = LivePlayCommandEnvelope<
  typeof LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
  UseMovePayload,
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

export type LivePlayInitiativeCommand =
  | SetInitiativeLivePlayCommand
  | NextInitiativeLivePlayCommand
  | PreviousInitiativeLivePlayCommand

export type LivePlayMapEffectCommand =
  | PlaceHazardLivePlayCommand
  | RemoveHazardLivePlayCommand
  | SetFieldEffectLivePlayCommand
  | RemoveFieldEffectLivePlayCommand
  | TickFieldEffectDurationsLivePlayCommand

export type LivePlayTerrainCommand =
  | BuildTerrainVoxelLivePlayCommand
  | RemoveTerrainVoxelLivePlayCommand

export type LivePlaySheetCommand =
  | ModifyHpLivePlayCommand
  | ModifyCombatStagesLivePlayCommand
  | ModifyConditionsLivePlayCommand

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
}

export interface HazardsUpdatedPatchPayload {
  readonly command:
    | typeof LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD
    | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD
  readonly cell: GridAnchor
  readonly previous: readonly MapHazardV2[]
  readonly current: readonly MapHazardV2[]
  readonly placed?: MapHazardV2
  readonly removed: readonly MapHazardV2[]
}

export interface FieldEffectsUpdatedPatchPayload {
  readonly command:
    | typeof LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT
    | typeof LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT
    | typeof LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS
  readonly previous: MapFieldEffects
  readonly current: MapFieldEffects
  readonly category?: FieldEffectRemoveCategory
  readonly kind?: FieldEffectKind
  readonly tickAmount?: number
}

export interface TerrainVoxelsUpdatedPatchPayload {
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

export interface TokenSpawnedPatchPayload {
  readonly command: typeof LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN
  readonly placementId: string
  readonly previous: null
  readonly current: SheetPlacement
}

export interface TokenDeletedPatchPayload {
  readonly command: typeof LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN
  readonly placementId: string
  readonly previous: SheetPlacement
  readonly current: null
}

export type TokenMovedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION, TokenMovedPatchPayload, LivePlayTokenScope>
export type TokenTurnedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_FACING, TokenTurnedPatchPayload, LivePlayTokenScope>
export type SheetHpModifiedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_HP, SheetHpModifiedPatchPayload, LivePlayScope>
export type ConditionsModifiedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_CONDITIONS, ConditionsModifiedPatchPayload, LivePlayScope>
export type CombatStagesModifiedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_COMBAT_STAGES, CombatStagesModifiedPatchPayload, LivePlayScope>
export type MoveUsedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE | typeof LIVE_PLAY_PATCH_TYPES.TOKEN_ACTION, MoveUsedPatchPayload, LivePlayScope>
export type InitiativeUpdatedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE, InitiativeUpdatedPatchPayload, LivePlayMapScope>
export type HazardsUpdatedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS, HazardsUpdatedPatchPayload, LivePlayMapScope>
export type FieldEffectsUpdatedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS, FieldEffectsUpdatedPatchPayload, LivePlayMapScope>
export type TerrainVoxelsUpdatedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN, TerrainVoxelsUpdatedPatchPayload, LivePlayMapScope>
export type TokenSpawnedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS, TokenSpawnedPatchPayload, LivePlayTokenScope>
export type TokenDeletedPatch = LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS, TokenDeletedPatchPayload, LivePlayTokenScope>

export type KnownLivePlayPatch =
  | TokenMovedPatch
  | TokenTurnedPatch
  | SheetHpModifiedPatch
  | ConditionsModifiedPatch
  | CombatStagesModifiedPatch
  | MoveUsedPatch
  | InitiativeUpdatedPatch
  | HazardsUpdatedPatch
  | FieldEffectsUpdatedPatch
  | TerrainVoxelsUpdatedPatch
  | TokenSpawnedPatch
  | TokenDeletedPatch

export const LIVE_PLAY_COMMAND_REJECTION_REASONS = [
  'invalid',
  'unauthorized',
  'not-found',
  'stale-revision',
  'conflict',
  'no-op',
  'persistence-failed',
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
const LIVE_PLAY_PATCH_TYPE_SET = new Set<unknown>(LIVE_PLAY_PATCH_TYPE_VALUES)
const LIVE_PLAY_MAP_SCOPE_LANE_SET = new Set<unknown>(LIVE_PLAY_MAP_SCOPE_LANES)
const LIVE_PLAY_TOKEN_SCOPE_FIELD_SET = new Set<unknown>(LIVE_PLAY_TOKEN_SCOPE_FIELDS)
const LIVE_PLAY_COMMAND_REJECTION_REASON_SET = new Set<unknown>(LIVE_PLAY_COMMAND_REJECTION_REASONS)
const LIVE_PLAY_OP_ID_RANDOM_PART_UNSAFE_RE = /[^A-Za-z0-9_-]/g

export const isLivePlayCommandType = (value: unknown): value is LivePlayCommandType =>
  LIVE_PLAY_COMMAND_TYPE_SET.has(value)

export const isLivePlayPatchType = (value: unknown): value is LivePlayPatchType =>
  LIVE_PLAY_PATCH_TYPE_SET.has(value)

export const isLivePlayMapScopeLane = (value: unknown): value is LivePlayMapScopeLane =>
  LIVE_PLAY_MAP_SCOPE_LANE_SET.has(value)

export const isLivePlayTokenScopeField = (value: unknown): value is LivePlayTokenScopeField =>
  LIVE_PLAY_TOKEN_SCOPE_FIELD_SET.has(value)

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
  TCommand extends LivePlayCommandEnvelope = LivePlayCommandEnvelope,
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
  TCommand extends LivePlayCommandEnvelope = LivePlayCommandEnvelope,
> = LivePlayCommandValidationSuccess<TCommand> | LivePlayCommandValidationFailure

type UnknownRecord = Record<string, unknown>
type MutableIssueList = LivePlayCommandValidationIssue[]

const EXPECTED_OBJECT = 'object'
const EXPECTED_NON_EMPTY_STRING = 'non-empty string'

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

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

const validateRequiredFields = (record: UnknownRecord, issues: MutableIssueList): void => {
  for (const field of LIVE_PLAY_COMMAND_REQUIRED_FIELDS) {
    if (!hasOwn(record, field)) {
      addIssue(issues, field, 'missing-field', `${field} is required on live-play command envelopes.`)
    }
  }

  if (hasOwn(record, 'payload') && record.payload === undefined) {
    addIssue(issues, 'payload', 'invalid-payload', 'payload must be provided.', 'defined value')
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

  if (hasOwn(value, 'type') && !isLivePlayCommandType(value.type)) {
    addIssue(
      issues,
      'type',
      'unsupported-command-type',
      'type must be a supported live-play command type.',
      LIVE_PLAY_COMMAND_TYPE_VALUES.join(' | '),
      value.type,
    )
  }

  if (hasOwn(value, 'scopes')) {
    validateScopes(value.scopes, issues)
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
