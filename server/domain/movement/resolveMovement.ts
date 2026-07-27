import { normalizeRevision } from '#shared/sessionRevisions'
import type { CharacterSheet } from '~/types/characterSheet'
import type {
  GridAnchor,
  GridDimensions,
  MapVoxelV2,
  SheetKind,
  SheetPlacement,
  TabletopMap,
} from '~/types/map'
import type {
  EffectiveMovementProfile,
  MovementCapabilityKey,
  MovementCapabilitySpeeds,
  MovementCapabilityTraits,
  ShiftMovementCapabilityKey,
} from '~/types/movement'
import type { MoveAutomationAreaDirection } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  footprintsOverlap,
  getClearanceValue,
  gridFootprintCells,
  gridFootprintTransition,
  isAnchorWithinBounds,
  type GridFootprint,
  type PositionedGridFootprint,
} from '~/utils/gridGeometry'
import {
  findMovementPathForPokemon,
  type MovementPathResult,
  type MovementPathStep,
} from '~/utils/mapMovementPathfinding'
import {
  buildMoveAutomationPassDirectionSteps,
  moveAutomationAreaDirectionVector,
} from '~/utils/moveAutomationDirections'
import {
  ptuGridDistanceBetweenFootprints,
  ptuGridVectorDistance,
} from '~/utils/ptuGridDistance'
import { conditionAdjustedMovementCapability } from '~/utils/sheetConditionEffects'
import {
  buildMapMovementTerrainIndex,
  movementTerrainForAnchor,
  type MapMovementTerrainIndex,
  type MovementAnchorTerrain,
  type MovementTerrainRequirement,
} from '~/utils/mapMovementTerrain'
import {
  movementCapabilityLabel,
  movementCapabilitySpeed,
  SHIFT_MOVEMENT_CAPABILITY_KEYS,
} from '~/utils/movementCapabilities'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import { withBattlefieldZoneMovementTerrain } from '../moveAutomation/battlefieldZoneMovementTerrain'
import { createMoveAutomationGravityResolver } from '../moveAutomation/gravity'
import { createMoveAutomationRemainingGlobalFieldResolver } from '../moveAutomation/remainingGlobalFields'
import { aa077AdjustedToken } from '../abilityAutomation/mechanics/aa077StaticIntegration'
import { aa085to100AdjustedToken } from '../abilityAutomation/mechanics/aa085to100StaticIntegration'
import { effectiveRuntimeAbilityIds } from '../abilityAutomation/effectiveRuntimeAbilities'
import { aa079MagnetPullConstraintViolation } from '../abilityAutomation/mechanics/aa079MovementIntegration'
import { aa082ParentalBondTetherViolation } from '../abilityAutomation/mechanics/aa082MovementIntegration'
import { aa085to100ShadowTagPathViolation } from '../abilityAutomation/mechanics/aa085to100MovementIntegration'

export const AUTHORITATIVE_MOVEMENT_MODES = ['shift', 'pass'] as const
export type AuthoritativeMovementMode = (typeof AUTHORITATIVE_MOVEMENT_MODES)[number]

export const AUTHORITATIVE_MOVEMENT_LIMITS = Object.freeze({
  identifierChars: 160,
  mapDimension: 200,
  footprintExtent: 32,
  footprintCells: 512,
  capabilitySpeed: 1_000,
  policyCost: 1_000,
})

export const AUTHORITATIVE_MOVEMENT_REASON_CODES = [
  'movement-legal',
  'movement-mode-unsupported',
  'movement-policy-invalid',
  'movement-map-invalid',
  'movement-placement-missing',
  'movement-placement-duplicate',
  'movement-placement-unresolved',
  'movement-footprint-invalid',
  'movement-semi-invulnerable-state',
  'movement-destination-invalid',
  'movement-same-position-disallowed',
  'movement-origin-out-of-bounds',
  'movement-origin-collision',
  'movement-origin-terrain-blocked',
  'movement-destination-out-of-bounds',
  'movement-destination-occupied',
  'movement-destination-terrain-blocked',
  'movement-destination-collision',
  'movement-capability-missing',
  'movement-route-blocked',
  'movement-cost-exceeds-limit',
  'movement-gravity-altitude-limit',
  'movement-magnet-pull-maximum-range',
  'movement-magnet-pull-minimum-range',
  'movement-parental-bond-maximum-range',
  'movement-shadow-tag-maximum-range',
] as const

export type AuthoritativeMovementReasonCode = (
  typeof AUTHORITATIVE_MOVEMENT_REASON_CODES
)[number]

export type AuthoritativeMovementFailureReasonCode = Exclude<
  AuthoritativeMovementReasonCode,
  'movement-legal'
>

/** Standard voluntary Shift movement, bounded by authoritative capabilities. */
export interface StandardAuthoritativeMovementPolicy {
  readonly kind: 'standard'
  /** A server-selected no-op query may be legal; ordinary movement defaults false. */
  readonly allowSamePosition?: boolean
  /** Optional server-owned cap such as remaining movement. Null uses capability limit only. */
  readonly maximumCost?: number | null
}

/**
 * Explicit live-play GM repositioning. It replaces only the capability-speed
 * ceiling; terrain capabilities, route geometry, occupancy, and bounds remain
 * authoritative and cannot be bypassed.
 */
export interface GmOverrideAuthoritativeMovementPolicy {
  readonly kind: 'gm-override'
}

export type AuthoritativeMovementPolicy =
  | StandardAuthoritativeMovementPolicy
  | GmOverrideAuthoritativeMovementPolicy

export interface ResolvedStandardAuthoritativeMovementPolicy {
  readonly kind: 'standard'
  readonly allowSamePosition: boolean
  readonly maximumCost: number | null
}

export interface ResolvedGmOverrideAuthoritativeMovementPolicy {
  readonly kind: 'gm-override'
  readonly allowSamePosition: false
  readonly maximumCost: number
}

/** A reviewed Pass path is straight, bounded, and may cross occupied anchors. */
export interface ResolvedPassAuthoritativeMovementPolicy {
  readonly kind: 'pass'
  readonly allowSamePosition: false
  readonly direction: MoveAutomationAreaDirection
  readonly maximumCost: number
}

export type ResolvedAuthoritativeMovementPolicy =
  | ResolvedStandardAuthoritativeMovementPolicy
  | ResolvedGmOverrideAuthoritativeMovementPolicy
  | ResolvedPassAuthoritativeMovementPolicy

export const STANDARD_AUTHORITATIVE_MOVEMENT_POLICY: ResolvedStandardAuthoritativeMovementPolicy = Object.freeze({
  kind: 'standard',
  allowSamePosition: false,
  maximumCost: null,
})

export const GM_OVERRIDE_AUTHORITATIVE_MOVEMENT_POLICY: ResolvedGmOverrideAuthoritativeMovementPolicy = Object.freeze({
  kind: 'gm-override',
  allowSamePosition: false,
  maximumCost: AUTHORITATIVE_MOVEMENT_LIMITS.policyCost,
})

export interface AuthoritativeMovementSheets {
  readonly pokemon: ReadonlyMap<string, CharacterSheet>
  readonly trainer: ReadonlyMap<string, TrainerSheet>
}

interface ResolveMovementInputBase {
  readonly map: TabletopMap
  readonly sheets: AuthoritativeMovementSheets
  /** Map-local placement identity. Geometry never comes from a client copy. */
  readonly placementId: string
}

export interface ResolveShiftMovementInput extends ResolveMovementInputBase {
  readonly mode: 'shift'
  /** Requested endpoint only. A path and cost are always server-derived. */
  readonly destination: GridAnchor
  readonly policy?: AuthoritativeMovementPolicy
  readonly direction?: never
  readonly maximumDistance?: never
}

export interface ResolvePassMovementInput extends ResolveMovementInputBase {
  readonly mode: 'pass'
  /** Server-selected direction from the reviewed Pass area declaration. */
  readonly direction: MoveAutomationAreaDirection
  /** Server-selected reviewed Pass distance; never supplied by move intent. */
  readonly maximumDistance: number
  readonly destination?: never
  readonly policy?: never
}

export type ResolveMovementInput = ResolveShiftMovementInput | ResolvePassMovementInput

export const AUTHORITATIVE_DISPLACEMENT_MOVEMENT_MODES = [
  'forced',
  'voluntary',
] as const

export const AUTHORITATIVE_DISPLACEMENT_DISTANCE_POLICIES = [
  'up-to-distance',
  'full-distance-required',
] as const

export const AUTHORITATIVE_DISPLACEMENT_SHORTENING_REASONS = [
  'none',
  'grid-distance-quantized',
  'map-bounds',
  'blocking-terrain',
  'height-change',
  'occupied-footprint',
  'mixed-collision',
  'movement-mode-unavailable',
] as const

export const AUTHORITATIVE_DISPLACEMENT_FAILURE_REASON_CODES = [
  'displacement-mode-unsupported',
  'displacement-policy-invalid',
  'displacement-vector-invalid',
  'displacement-distance-invalid',
  'displacement-map-invalid',
  'displacement-placement-missing',
  'displacement-placement-duplicate',
  'displacement-placement-unresolved',
  'displacement-footprint-invalid',
  'displacement-origin-out-of-bounds',
  'displacement-origin-collision',
  'displacement-full-distance-unavailable',
  'displacement-magnet-pull-maximum-range',
  'displacement-magnet-pull-minimum-range',
  'displacement-parental-bond-maximum-range',
  'displacement-shadow-tag-maximum-range',
] as const

export type AuthoritativeDisplacementMovementMode =
  (typeof AUTHORITATIVE_DISPLACEMENT_MOVEMENT_MODES)[number]
export type AuthoritativeDisplacementDistancePolicy =
  (typeof AUTHORITATIVE_DISPLACEMENT_DISTANCE_POLICIES)[number]
export type AuthoritativeDisplacementShorteningReason =
  (typeof AUTHORITATIVE_DISPLACEMENT_SHORTENING_REASONS)[number]
export type AuthoritativeDisplacementFailureReasonCode =
  (typeof AUTHORITATIVE_DISPLACEMENT_FAILURE_REASON_CODES)[number]

/** Server-only straight displacement input; no command parser accepts these mechanics. */
export interface ResolveAuthoritativeDisplacementInput extends ResolveMovementInputBase {
  readonly movementMode: AuthoritativeDisplacementMovementMode
  readonly vector: GridAnchor
  readonly requestedDistance: number
  readonly distancePolicy: AuthoritativeDisplacementDistancePolicy
}

export interface AuthoritativeDisplacementObstruction {
  readonly reason: Exclude<
    AuthoritativeDisplacementShorteningReason,
    'none' | 'grid-distance-quantized'
  >
  readonly at: GridAnchor
  readonly collision: AuthoritativeMovementCollision | null
  readonly terrainRequirements: readonly MovementTerrainRequirement[]
}

export interface AuthoritativeDisplacementPartial {
  readonly origin: GridAnchor
  readonly destination: GridAnchor
  readonly path: readonly GridAnchor[]
  readonly requestedDistance: number
  readonly resolvedDistance: number
  readonly shortened: boolean
  readonly shorteningReason: AuthoritativeDisplacementShorteningReason
  readonly obstruction: AuthoritativeDisplacementObstruction | null
}

export interface AuthoritativeDisplacementSuccess extends AuthoritativeDisplacementPartial {
  readonly ok: true
  readonly reasonCode: 'displacement-legal'
  readonly placementId: string
  readonly movementMode: AuthoritativeDisplacementMovementMode
  readonly distancePolicy: AuthoritativeDisplacementDistancePolicy
  readonly triggeringSteps: readonly AuthoritativeMovementTriggeringStep[]
  readonly consultedPlacementIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMovementSheetRead[]
}

export interface AuthoritativeDisplacementFailure {
  readonly ok: false
  readonly reasonCode: AuthoritativeDisplacementFailureReasonCode
  readonly message: string
  readonly placementId: string
  readonly movementMode: string
  readonly distancePolicy: string
  readonly partial: AuthoritativeDisplacementPartial | null
  readonly consultedPlacementIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMovementSheetRead[]
}

export type AuthoritativeDisplacementResult =
  | AuthoritativeDisplacementSuccess
  | AuthoritativeDisplacementFailure

export const AUTHORITATIVE_RELOCATION_MODES = ['teleport', 'swap'] as const
export type AuthoritativeRelocationMode = (typeof AUTHORITATIVE_RELOCATION_MODES)[number]

/** Server-only endpoint relocation. Route cells and movement speeds are intentionally irrelevant. */
export interface ResolveAuthoritativeRelocationInput extends ResolveMovementInputBase {
  readonly mode: AuthoritativeRelocationMode
  readonly destination: GridAnchor
  /** A swap counterpart may occupy this endpoint until the atomic commit. */
  readonly ignoredPlacementIds?: readonly string[]
}

export interface AuthoritativeRelocationSuccess {
  readonly ok: true
  readonly reasonCode: 'relocation-legal'
  readonly placementId: string
  readonly mode: AuthoritativeRelocationMode
  readonly origin: GridAnchor
  readonly destination: GridAnchor
  readonly distance: number
  readonly path: readonly GridAnchor[]
  readonly triggeringSteps: readonly AuthoritativeMovementTriggeringStep[]
  readonly consultedPlacementIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMovementSheetRead[]
}

export interface AuthoritativeRelocationFailure {
  readonly ok: false
  readonly reasonCode:
    | 'relocation-mode-unsupported'
    | 'relocation-destination-invalid'
    | 'relocation-map-invalid'
    | 'relocation-placement-missing'
    | 'relocation-placement-duplicate'
    | 'relocation-placement-unresolved'
    | 'relocation-footprint-invalid'
    | 'relocation-origin-out-of-bounds'
    | 'relocation-origin-collision'
    | 'relocation-destination-out-of-bounds'
    | 'relocation-destination-occupied'
    | 'relocation-shadow-tag-maximum-range'
  readonly message: string
  readonly placementId: string
  readonly mode: string
  readonly origin: GridAnchor | null
  readonly destination: GridAnchor | null
  readonly collision: AuthoritativeMovementCollision | null
  readonly consultedPlacementIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMovementSheetRead[]
}

export type AuthoritativeRelocationResult =
  | AuthoritativeRelocationSuccess
  | AuthoritativeRelocationFailure

export interface AuthoritativeMovementSheetRead {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
}

export interface AuthoritativeMovementFootprint {
  readonly base: number
  readonly clearance: number
}

export interface AuthoritativeMovementCapability {
  readonly key: MovementCapabilityKey
  readonly label: string
  readonly speed: number
}

export interface AuthoritativeMovementCapabilities {
  readonly available: readonly AuthoritativeMovementCapability[]
  readonly used: readonly AuthoritativeMovementCapability[]
}

export interface AuthoritativeMovementTerrain {
  readonly requirements: readonly MovementTerrainRequirement[]
  readonly slow: boolean
  readonly air: boolean
  readonly airHeight: number
  readonly hoverable: boolean
}

export type AuthoritativeMovementCollisionKind =
  | 'bounds'
  | 'placement'
  | 'terrain'
  | 'mixed'
  | 'route'

export interface AuthoritativeMovementCollision {
  readonly kind: AuthoritativeMovementCollisionKind
  readonly at: GridAnchor | null
  /** Deterministic authoritative map order. */
  readonly placementIds: readonly string[]
  /** Deterministic footprint-cell order. */
  readonly voxelCells: readonly GridAnchor[]
}

export interface AuthoritativeMovementOccupancy {
  readonly originCells: readonly GridAnchor[]
  readonly destinationCells: readonly GridAnchor[]
  /** Every other footprint checked for path and endpoint collision. */
  readonly checkedPlacementIds: readonly string[]
}

/**
 * One immutable path transition consumed by movement lifecycle planning for
 * ordered adjacency/leave/enter/final-destination facts. The oracle itself
 * remains event- and repository-free.
 */
export interface AuthoritativeMovementTriggeringStep {
  readonly index: number
  readonly from: GridAnchor
  readonly to: GridAnchor
  readonly cost: number
  readonly cumulativeCost: number
  readonly diagonal: boolean
  readonly slowCostApplied: boolean
  readonly capabilities: readonly AuthoritativeMovementCapability[]
  readonly terrain: AuthoritativeMovementTerrain
  /** Other placements whose footprint was adjacent at `from` but not at `to`. */
  readonly leftAdjacentPlacementIds: readonly string[]
  readonly leftCells: readonly GridAnchor[]
  readonly enteredCells: readonly GridAnchor[]
  readonly finalDestination: boolean
}

export interface AuthoritativeMovementSuccess {
  readonly ok: true
  readonly reasonCode: 'movement-legal'
  readonly placementId: string
  readonly mode: AuthoritativeMovementMode
  readonly policy: ResolvedAuthoritativeMovementPolicy
  readonly origin: GridAnchor
  readonly destination: GridAnchor
  readonly path: readonly GridAnchor[]
  readonly cost: number
  readonly capabilityLimit: number
  readonly effectiveLimit: number
  readonly capabilities: AuthoritativeMovementCapabilities
  readonly movementProfile: EffectiveMovementProfile
  readonly footprint: AuthoritativeMovementFootprint
  readonly occupancy: AuthoritativeMovementOccupancy
  readonly collision: null
  readonly triggeringSteps: readonly AuthoritativeMovementTriggeringStep[]
  readonly consultedPlacementIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMovementSheetRead[]
}

export interface AuthoritativeMovementFailure {
  readonly ok: false
  readonly reasonCode: AuthoritativeMovementFailureReasonCode
  readonly message: string
  readonly placementId: string
  /** Retains an unsupported runtime value for diagnostics without accepting it. */
  readonly mode: string
  readonly policy: ResolvedAuthoritativeMovementPolicy | null
  readonly origin: GridAnchor | null
  readonly destination: GridAnchor | null
  readonly path: readonly GridAnchor[] | null
  readonly cost: number | null
  readonly capabilityLimit: number | null
  readonly effectiveLimit: number | null
  readonly capabilities: AuthoritativeMovementCapabilities
  readonly movementProfile: EffectiveMovementProfile | null
  readonly footprint: AuthoritativeMovementFootprint | null
  readonly occupancy: AuthoritativeMovementOccupancy | null
  readonly collision: AuthoritativeMovementCollision | null
  readonly triggeringSteps: readonly []
  readonly consultedPlacementIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMovementSheetRead[]
}

export type AuthoritativeMovementResult =
  | AuthoritativeMovementSuccess
  | AuthoritativeMovementFailure

interface MovementPlacementSnapshot extends PositionedGridFootprint {
  readonly id: string
  readonly sheetKind: SheetKind
  readonly sheetSlug: string
  readonly sideId: string | null
  readonly typeIds: readonly string[]
  readonly speciesId: string
  readonly currentHp: number
  readonly effectiveAbilityIds: readonly string[]
  readonly movementCapabilities: MovementCapabilitySpeeds
  readonly movementTraits: MovementCapabilityTraits
  readonly movementProfile: EffectiveMovementProfile
}

interface MovementSnapshotSuccess {
  readonly ok: true
  readonly placements: readonly MovementPlacementSnapshot[]
  readonly mover: MovementPlacementSnapshot
  readonly sheetReads: readonly AuthoritativeMovementSheetRead[]
}

interface MovementSnapshotFailure {
  readonly ok: false
  readonly reasonCode:
    | 'movement-placement-missing'
    | 'movement-placement-duplicate'
    | 'movement-placement-unresolved'
    | 'movement-footprint-invalid'
    | 'movement-map-invalid'
  readonly message: string
  readonly consultedPlacementIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMovementSheetRead[]
}

type MovementSnapshotResult = MovementSnapshotSuccess | MovementSnapshotFailure

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const cloneAnchor = (anchor: GridAnchor): GridAnchor => ({
  x: anchor.x,
  y: anchor.y,
  z: anchor.z,
})

const cloneAnchors = (anchors: readonly GridAnchor[]): GridAnchor[] => anchors.map(cloneAnchor)

const validIdentifier = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= AUTHORITATIVE_MOVEMENT_LIMITS.identifierChars
  && value.trim() === value
)

const validCoordinate = (value: unknown): value is number => Number.isSafeInteger(value)

const validAnchor = (value: unknown): value is GridAnchor => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return validCoordinate(record.x) && validCoordinate(record.y) && validCoordinate(record.z)
}

const validDimensions = (dimensions: GridDimensions): boolean => (
  Number.isSafeInteger(dimensions.x)
  && dimensions.x >= 1
  && dimensions.x <= AUTHORITATIVE_MOVEMENT_LIMITS.mapDimension
  && Number.isSafeInteger(dimensions.y)
  && dimensions.y >= 1
  && dimensions.y <= AUTHORITATIVE_MOVEMENT_LIMITS.mapDimension
  && Number.isSafeInteger(dimensions.z)
  && dimensions.z >= 1
  && dimensions.z <= AUTHORITATIVE_MOVEMENT_LIMITS.mapDimension
)

const sameAnchor = (left: GridAnchor, right: GridAnchor): boolean => (
  left.x === right.x && left.y === right.y && left.z === right.z
)

const emptyCapabilities = (): AuthoritativeMovementCapabilities => ({
  available: [],
  used: [],
})

const failure = (input: {
  readonly reasonCode: AuthoritativeMovementFailureReasonCode
  readonly message: string
  readonly placementId: string
  readonly mode: string
  readonly policy?: ResolvedAuthoritativeMovementPolicy | null
  readonly origin?: GridAnchor | null
  readonly destination?: GridAnchor | null
  readonly path?: readonly GridAnchor[] | null
  readonly cost?: number | null
  readonly capabilityLimit?: number | null
  readonly effectiveLimit?: number | null
  readonly capabilities?: AuthoritativeMovementCapabilities
  readonly movementProfile?: EffectiveMovementProfile | null
  readonly footprint?: AuthoritativeMovementFootprint | null
  readonly occupancy?: AuthoritativeMovementOccupancy | null
  readonly collision?: AuthoritativeMovementCollision | null
  readonly consultedPlacementIds?: readonly string[]
  readonly sheetReads?: readonly AuthoritativeMovementSheetRead[]
}): AuthoritativeMovementFailure => deepFreeze({
  ok: false,
  reasonCode: input.reasonCode,
  message: input.message,
  placementId: input.placementId,
  mode: input.mode,
  policy: input.policy ?? null,
  origin: input.origin ? cloneAnchor(input.origin) : null,
  destination: input.destination ? cloneAnchor(input.destination) : null,
  path: input.path ? cloneAnchors(input.path) : null,
  cost: input.cost ?? null,
  capabilityLimit: input.capabilityLimit ?? null,
  effectiveLimit: input.effectiveLimit ?? null,
  capabilities: input.capabilities ?? emptyCapabilities(),
  movementProfile: input.movementProfile ?? null,
  footprint: input.footprint ?? null,
  occupancy: input.occupancy ?? null,
  collision: input.collision ?? null,
  triggeringSteps: [],
  consultedPlacementIds: [...(input.consultedPlacementIds ?? [])],
  sheetReads: (input.sheetReads ?? []).map(read => ({ ...read })),
})

const enforceMagnetPullMovementConstraints = (input: {
  readonly map: TabletopMap
  readonly result: AuthoritativeMovementResult
  readonly mover: MovementPlacementSnapshot
  readonly placements: readonly MovementPlacementSnapshot[]
}): AuthoritativeMovementResult => {
  if (!input.result.ok || input.result.policy.kind === 'gm-override') return input.result
  const violation = aa079MagnetPullConstraintViolation({
    map: input.map,
    placementId: input.mover.id,
    origin: input.result.origin,
    path: input.result.path,
    footprints: input.placements,
  })
  const parentalBondViolation = aa082ParentalBondTetherViolation({
    placementId: input.mover.id,
    origin: input.result.origin,
    path: input.result.path,
    footprints: input.placements,
  })
  const shadowTagViolation = aa085to100ShadowTagPathViolation({
    map: input.map,
    placementId: input.mover.id,
    path: input.result.path,
  })
  if (!violation && !parentalBondViolation && !shadowTagViolation) return input.result
  return failure({
    reasonCode: shadowTagViolation
      ? 'movement-shadow-tag-maximum-range'
      : parentalBondViolation
        ? 'movement-parental-bond-maximum-range'
        : `movement-magnet-pull-${violation!}-range`,
    message: shadowTagViolation
      ? 'Shadow Tag prevents movement more than 5 metres from the pinned shadow.'
      : parentalBondViolation
        ? 'Parental Bond prevents the Baby from willingly moving farther than 10 metres from its mother.'
      : violation === 'maximum'
        ? 'Magnet Pull prevents this voluntary path from moving farther than 6 metres from its source.'
        : 'Magnet Pull prevents this voluntary path from moving closer than 3 metres to its source.',
    placementId: input.result.placementId,
    mode: input.result.mode,
    policy: input.result.policy,
    origin: input.result.origin,
    destination: input.result.destination,
    path: input.result.path,
    cost: input.result.cost,
    capabilityLimit: input.result.capabilityLimit,
    effectiveLimit: input.result.effectiveLimit,
    capabilities: input.result.capabilities,
    movementProfile: input.result.movementProfile,
    footprint: input.result.footprint,
    occupancy: input.result.occupancy,
    collision: input.result.collision,
    consultedPlacementIds: input.result.consultedPlacementIds,
    sheetReads: input.result.sheetReads,
  })
}

const resolvedPolicy = (
  policy: AuthoritativeMovementPolicy | undefined,
): ResolvedStandardAuthoritativeMovementPolicy | ResolvedGmOverrideAuthoritativeMovementPolicy | null => {
  if (policy === undefined) return { ...STANDARD_AUTHORITATIVE_MOVEMENT_POLICY }
  if (typeof policy !== 'object' || policy === null) return null
  if (policy.kind === 'gm-override') return { ...GM_OVERRIDE_AUTHORITATIVE_MOVEMENT_POLICY }
  if (
    policy.kind !== 'standard'
    || (policy.allowSamePosition !== undefined && typeof policy.allowSamePosition !== 'boolean')
    || (
      policy.maximumCost !== undefined
      && policy.maximumCost !== null
      && (
        !Number.isSafeInteger(policy.maximumCost)
        || policy.maximumCost < 0
        || policy.maximumCost > AUTHORITATIVE_MOVEMENT_LIMITS.policyCost
      )
    )
  ) {
    return null
  }

  return {
    kind: 'standard',
    allowSamePosition: policy.allowSamePosition ?? false,
    maximumCost: policy.maximumCost ?? null,
  }
}

const resolvedPassPolicy = (
  input: ResolveMovementInput,
): ResolvedPassAuthoritativeMovementPolicy | null => {
  const raw = input as Partial<ResolvePassMovementInput>
  const direction = raw.direction
  const maximumDistance = raw.maximumDistance
  if (
    typeof direction !== 'string'
    || moveAutomationAreaDirectionVector(direction as MoveAutomationAreaDirection) === null
    || typeof maximumDistance !== 'number'
    || !Number.isSafeInteger(maximumDistance)
    || maximumDistance <= 0
    || maximumDistance > AUTHORITATIVE_MOVEMENT_LIMITS.policyCost
  ) {
    return null
  }
  return {
    kind: 'pass',
    allowSamePosition: false,
    direction: direction as MoveAutomationAreaDirection,
    maximumCost: maximumDistance,
  }
}

const validVoxel = (voxel: MapVoxelV2, dimensions: GridDimensions): boolean => (
  validCoordinate(voxel.x)
  && validCoordinate(voxel.y)
  && validCoordinate(voxel.z)
  && voxel.x >= 0
  && voxel.x < dimensions.x
  && voxel.y >= 0
  && voxel.y < dimensions.y
  && voxel.z >= 0
  && voxel.z < dimensions.z
  && typeof voxel.materialId === 'string'
  && voxel.materialId.trim().length > 0
  && (voxel.blocksMovement === undefined || typeof voxel.blocksMovement === 'boolean')
  && (voxel.tags === undefined || (
    Array.isArray(voxel.tags)
    && voxel.tags.every(tag => typeof tag === 'string')
  ))
)

const validateMapGeometry = (map: TabletopMap): string | null => {
  if (!validDimensions(map.dimensions)) {
    return `Movement map dimensions must be safe integers from 1 to ${AUTHORITATIVE_MOVEMENT_LIMITS.mapDimension}.`
  }
  const groundLevelY = map.groundLevelY ?? 0
  if (!Number.isSafeInteger(groundLevelY) || groundLevelY < 0 || groundLevelY >= map.dimensions.y) {
    return 'Movement map groundLevelY must be a safe in-bounds integer.'
  }
  if (!Array.isArray(map.voxels) || !Array.isArray(map.placements)) {
    return 'Movement map voxels and placements must be arrays.'
  }

  const voxelKeys = new Set<string>()
  for (const voxel of map.voxels) {
    if (!validVoxel(voxel, map.dimensions)) {
      return 'Movement map contains malformed or out-of-bounds voxel geometry.'
    }
    const key = `${voxel.x},${voxel.y},${voxel.z}`
    if (voxelKeys.has(key)) return `Movement map contains duplicate voxel ${key}.`
    voxelKeys.add(key)
  }

  return null
}

const sheetForPlacement = (
  placement: SheetPlacement,
  sheets: AuthoritativeMovementSheets,
): CharacterSheet | TrainerSheet | null => (
  placement.sheetKind === 'pokemon'
    ? sheets.pokemon.get(placement.sheetSlug) ?? null
    : sheets.trainer.get(placement.sheetSlug) ?? null
)

const validMovementCapabilities = (capabilities: MovementCapabilitySpeeds): boolean => (
  Object.entries(capabilities).every(([key, speed]) => (
    (SHIFT_MOVEMENT_CAPABILITY_KEYS as readonly string[]).includes(key)
    || key === 'teleporter'
  ) && (
    speed === undefined
    || (
      Number.isSafeInteger(speed)
      && speed >= 0
      && speed <= AUTHORITATIVE_MOVEMENT_LIMITS.capabilitySpeed
    )
  ))
)

const validFootprint = (footprint: GridFootprint): boolean => {
  const clearance = getClearanceValue(footprint)
  return Number.isSafeInteger(footprint.base)
    && footprint.base >= 1
    && footprint.base <= AUTHORITATIVE_MOVEMENT_LIMITS.footprintExtent
    && Number.isSafeInteger(clearance)
    && clearance >= 1
    && clearance <= AUTHORITATIVE_MOVEMENT_LIMITS.footprintExtent
    && footprint.base * footprint.base * clearance <= AUTHORITATIVE_MOVEMENT_LIMITS.footprintCells
}

const buildMovementSnapshots = (
  map: TabletopMap,
  sheets: AuthoritativeMovementSheets,
  placementId: string,
): MovementSnapshotResult => {
  const sheetLookup: SheetLookup = {
    pokemon: new Map(sheets.pokemon),
    trainer: new Map(sheets.trainer),
  }
  const placements: MovementPlacementSnapshot[] = []
  const placementIds = new Set<string>()
  const readByKey = new Map<string, AuthoritativeMovementSheetRead>()
  const consultedPlacementIds: string[] = []

  for (const placement of map.placements) {
    if (!validIdentifier(placement.id) || !validIdentifier(placement.sheetSlug) || !validAnchor(placement.position)) {
      return {
        ok: false,
        reasonCode: 'movement-map-invalid',
        message: 'Movement map contains malformed placement identity or position geometry.',
        consultedPlacementIds,
        sheetReads: [...readByKey.values()],
      }
    }
    if (placement.sheetKind !== 'pokemon' && placement.sheetKind !== 'trainer') {
      return {
        ok: false,
        reasonCode: 'movement-map-invalid',
        message: `Movement placement ${placement.id} has an unsupported sheet kind.`,
        consultedPlacementIds,
        sheetReads: [...readByKey.values()],
      }
    }
    if (placementIds.has(placement.id)) {
      return {
        ok: false,
        reasonCode: 'movement-placement-duplicate',
        message: `Movement placement ${placement.id} occurs more than once on the authoritative map.`,
        consultedPlacementIds,
        sheetReads: [...readByKey.values()],
      }
    }
    placementIds.add(placement.id)
    consultedPlacementIds.push(placement.id)

    const sheet = sheetForPlacement(placement, sheets)
    if (!sheet) {
      return {
        ok: false,
        reasonCode: 'movement-placement-unresolved',
        message: `Movement placement ${placement.id} cannot resolve sheet ${placement.sheetKind}/${placement.sheetSlug}.`,
        consultedPlacementIds,
        sheetReads: [...readByKey.values()],
      }
    }
    const readKey = `${placement.sheetKind}:${placement.sheetSlug}`
    if (!readByKey.has(readKey)) {
      readByKey.set(readKey, {
        kind: placement.sheetKind,
        slug: placement.sheetSlug,
        revision: normalizeRevision(sheet.revision),
      })
    }

    let token: ReturnType<typeof placementToSpawned>
    const effectiveAbilityIds = effectiveRuntimeAbilityIds({ map, placement, sheet })
    try {
      const nativeToken = placementToSpawned(
        placement,
        sheetLookup,
        map,
        { skipAa077NativeProjection: true },
      )
      const aa077Token = nativeToken ? aa077AdjustedToken({
        token: nativeToken,
        effectiveAbilityIds,
      }) : null
      token = aa077Token ? aa085to100AdjustedToken({
        token: aa077Token,
        sheet: placement.sheetKind === 'pokemon' ? sheet as CharacterSheet : null,
        effectiveAbilityIds,
        contextMap: map,
      }) : null
    } catch {
      token = null
    }
    if (!token) {
      return {
        ok: false,
        reasonCode: 'movement-placement-unresolved',
        message: `Movement placement ${placement.id} cannot resolve authoritative catalog and sheet geometry.`,
        consultedPlacementIds,
        sheetReads: [...readByKey.values()],
      }
    }
    if (
      !validFootprint(token)
      || !validMovementCapabilities(token.movementCapabilities ?? {})
      || !token.movementTraits
      || !token.movementProfile
    ) {
      return {
        ok: false,
        reasonCode: 'movement-footprint-invalid',
        message: `Movement placement ${placement.id} has invalid footprint or capability geometry.`,
        consultedPlacementIds,
        sheetReads: [...readByKey.values()],
      }
    }

    placements.push({
      id: placement.id,
      sheetKind: placement.sheetKind,
      sheetSlug: placement.sheetSlug,
      sideId: placement.sideId ?? null,
      typeIds: [...new Set(token.defenderTypes.map(type => type.trim().toLowerCase()).filter(Boolean))],
      speciesId: token.species.trim().toLowerCase(),
      currentHp: token.currentHp,
      effectiveAbilityIds,
      position: cloneAnchor(placement.position),
      base: token.base,
      clearance: getClearanceValue(token),
      movementCapabilities: { ...(token.movementCapabilities ?? {}) },
      movementTraits: {
        phasing: token.movementTraits.phasing,
        jump: { ...token.movementTraits.jump },
      },
      movementProfile: token.movementProfile,
    })
  }

  const arenaTrapMarks = (map.encounterState?.abilityOwnedState?.entries ?? []).filter(entry => (
    entry.canonicalId === 'Arena Trap'
    && entry.payload.kind === 'mark'
    && entry.payload.markId === 'aa061.arena-trap.active'
  ))
  for (const [index, target] of placements.entries()) {
    const trapped = arenaTrapMarks.some((mark) => {
      const source = placements.find(candidate => candidate.id === mark.ownerPlacementId)
      if (!source || !source.sideId || !target.sideId || source.sideId === target.sideId
        || ptuGridDistanceBetweenFootprints(source, target) > 5) return false
      return !target.typeIds.includes('flying')
        && (target.movementCapabilities.levitate ?? 0) < 4
        && (target.movementCapabilities.sky ?? 0) < 4
        && (target.movementCapabilities.burrow ?? 0) < 4
    })
    if (!trapped) continue
    const movementCapabilities = Object.fromEntries(Object.entries(target.movementCapabilities).map(([key, value]) => [
      key,
      conditionAdjustedMovementCapability(key, value, ['Slowed']),
    ])) as MovementCapabilitySpeeds
    placements[index] = {
      ...target,
      movementCapabilities,
      movementProfile: { ...target.movementProfile, speeds: movementCapabilities },
    }
  }

  const movers = placements.filter(placement => placement.id === placementId)
  if (movers.length === 0) {
    return {
      ok: false,
      reasonCode: 'movement-placement-missing',
      message: `Movement placement ${placementId} is not present on the authoritative map.`,
      consultedPlacementIds,
      sheetReads: [...readByKey.values()],
    }
  }
  if (movers.length !== 1) {
    return {
      ok: false,
      reasonCode: 'movement-placement-duplicate',
      message: `Movement placement ${placementId} is not unique on the authoritative map.`,
      consultedPlacementIds,
      sheetReads: [...readByKey.values()],
    }
  }

  return {
    ok: true,
    placements,
    mover: movers[0]!,
    sheetReads: [...readByKey.values()],
  }
}

const capabilityList = (
  capabilities: MovementCapabilitySpeeds,
  keys: readonly MovementCapabilityKey[] = SHIFT_MOVEMENT_CAPABILITY_KEYS,
): AuthoritativeMovementCapability[] => keys.flatMap((key) => {
  const speed = movementCapabilitySpeed(capabilities, key)
  return speed === undefined ? [] : [{
    key,
    label: movementCapabilityLabel(key),
    speed,
  }]
})

const resolvedCapabilities = (
  mover: MovementPlacementSnapshot,
  usedKeys: readonly MovementCapabilityKey[],
): AuthoritativeMovementCapabilities => ({
  available: capabilityList(mover.movementCapabilities),
  used: capabilityList(mover.movementCapabilities, usedKeys),
})

const terrainSnapshot = (terrain: MovementAnchorTerrain): AuthoritativeMovementTerrain => ({
  requirements: [...terrain.requirements],
  slow: terrain.slow,
  air: terrain.air,
  airHeight: terrain.airHeight,
  hoverable: terrain.hoverable,
})

type MovementGravityResolver = ReturnType<typeof createMoveAutomationGravityResolver>

const gravityResolverForMap = (map: TabletopMap): MovementGravityResolver => (
  createMoveAutomationGravityResolver({
    placements: map.placements,
    globalFields: createMoveAutomationRemainingGlobalFieldResolver(map),
  })
)

const projectGravityMovementSnapshots = (
  snapshots: MovementSnapshotSuccess,
  gravity: MovementGravityResolver,
): MovementSnapshotSuccess => {
  const projectedMover: MovementPlacementSnapshot = {
    ...snapshots.mover,
    movementProfile: gravity.projectMovementProfile({
      placementId: snapshots.mover.id,
      profile: snapshots.mover.movementProfile,
    }),
  }
  return {
    ...snapshots,
    mover: projectedMover,
    placements: snapshots.placements.map(placement => (
      placement.id === projectedMover.id ? projectedMover : placement
    )),
  }
}

const gravityMovementForPath = (input: {
  readonly gravity: MovementGravityResolver
  readonly placementId: string
  readonly capabilityKeys: readonly MovementCapabilityKey[]
  readonly steps: readonly MovementPathStep[]
}) => input.gravity.movement({
  placementId: input.placementId,
  capabilityKeys: input.capabilityKeys,
  destinationAirHeight: input.steps.at(-1)?.terrain.airHeight ?? 0,
})

const collidingPlacementIds = (
  anchor: GridAnchor,
  mover: MovementPlacementSnapshot,
  placements: readonly MovementPlacementSnapshot[],
): string[] => placements.flatMap((placement) => {
  if (placement.id === mover.id) return []
  return footprintsOverlap(
    anchor,
    mover.base,
    getClearanceValue(mover),
    placement.position,
    placement.base,
    getClearanceValue(placement),
  ) ? [placement.id] : []
})

const blockingVoxelCells = (
  anchor: GridAnchor,
  footprint: GridFootprint,
  terrainIndex: MapMovementTerrainIndex,
  groundLevelY: number,
): GridAnchor[] => gridFootprintCells(anchor, footprint).filter((cell) => (
  terrainIndex.voxelAt(cell.x, cell.y, cell.z) !== null
  && movementTerrainForAnchor({
    anchor: cell,
    footprint: { base: 1, clearance: 1 },
    terrain: terrainIndex,
    groundLevelY,
  }).blocked
))

const collisionAt = (
  anchor: GridAnchor,
  mover: MovementPlacementSnapshot,
  placements: readonly MovementPlacementSnapshot[],
  terrainIndex: MapMovementTerrainIndex,
  groundLevelY: number,
): AuthoritativeMovementCollision | null => {
  const placementIds = collidingPlacementIds(anchor, mover, placements)
  const voxelCells = blockingVoxelCells(anchor, mover, terrainIndex, groundLevelY)
  if (placementIds.length === 0 && voxelCells.length === 0) return null
  return {
    kind: placementIds.length > 0 && voxelCells.length > 0
      ? 'mixed'
      : placementIds.length > 0 ? 'placement' : 'terrain',
    at: cloneAnchor(anchor),
    placementIds,
    voxelCells: cloneAnchors(voxelCells),
  }
}

const boundsCollision = (anchor: GridAnchor): AuthoritativeMovementCollision => ({
  kind: 'bounds',
  at: cloneAnchor(anchor),
  placementIds: [],
  voxelCells: [],
})

const routeCollision = (): AuthoritativeMovementCollision => ({
  kind: 'route',
  at: null,
  placementIds: [],
  voxelCells: [],
})

const occupancyFor = (
  mover: MovementPlacementSnapshot,
  destination: GridAnchor,
  placements: readonly MovementPlacementSnapshot[],
): AuthoritativeMovementOccupancy => ({
  originCells: gridFootprintCells(mover.position, mover),
  destinationCells: gridFootprintCells(destination, mover),
  checkedPlacementIds: placements
    .filter(placement => placement.id !== mover.id)
    .map(placement => placement.id),
})

const effectiveLimit = (
  capabilityLimit: number,
  policy: ResolvedAuthoritativeMovementPolicy,
): number => {
  if (policy.kind === 'gm-override') return policy.maximumCost
  if (policy.kind === 'pass') return Math.min(capabilityLimit, policy.maximumCost)
  return policy.maximumCost === null
    ? capabilityLimit
    : Math.min(capabilityLimit, policy.maximumCost)
}

const footprintsAdjacentAt = (
  mover: MovementPlacementSnapshot,
  anchor: GridAnchor,
  other: MovementPlacementSnapshot,
): boolean => ptuGridDistanceBetweenFootprints(
  { ...mover, position: anchor },
  other,
) === 1

const leftAdjacentPlacementIds = (
  step: Pick<MovementPathStep, 'from' | 'to'>,
  mover: MovementPlacementSnapshot,
  placements: readonly MovementPlacementSnapshot[],
): readonly string[] => placements.flatMap(placement => (
  placement.id !== mover.id
  && footprintsAdjacentAt(mover, step.from, placement)
  && !footprintsAdjacentAt(mover, step.to, placement)
    ? [placement.id]
    : []
))

const triggeringStep = (
  step: MovementPathStep,
  mover: MovementPlacementSnapshot,
  placements: readonly MovementPlacementSnapshot[],
  finalStepIndex: number,
): AuthoritativeMovementTriggeringStep => {
  const transition = gridFootprintTransition(step.from, step.to, mover)
  return {
    index: step.index,
    from: cloneAnchor(step.from),
    to: cloneAnchor(step.to),
    cost: step.cost,
    cumulativeCost: step.cumulativeCost,
    diagonal: step.diagonal,
    slowCostApplied: step.slow,
    capabilities: capabilityList(mover.movementCapabilities, step.capabilityKeys),
    terrain: terrainSnapshot(step.terrain),
    leftAdjacentPlacementIds: [...leftAdjacentPlacementIds(step, mover, placements)],
    leftCells: cloneAnchors(transition.leftCells),
    enteredCells: cloneAnchors(transition.enteredCells),
    finalDestination: step.index === finalStepIndex,
  }
}

const pathFailureReason = (
  result: MovementPathResult,
): Extract<AuthoritativeMovementFailureReasonCode,
  'movement-capability-missing' | 'movement-route-blocked' | 'movement-cost-exceeds-limit'> => {
  if (result.reason === 'missing-capability') return 'movement-capability-missing'
  if (result.reason === 'too-far') return 'movement-cost-exceeds-limit'
  return 'movement-route-blocked'
}

const pathFailureMessage = (
  reasonCode: ReturnType<typeof pathFailureReason>,
  result: MovementPathResult,
): string => {
  if (reasonCode === 'movement-capability-missing') {
    return 'The authoritative sheet has no Movement Capability that can traverse the required terrain.'
  }
  if (reasonCode === 'movement-cost-exceeds-limit') {
    return `The server-derived movement cost ${result.distance} exceeds the capability limit ${result.movementLimit ?? 0}.`
  }
  return 'No collision-free authoritative route reaches the requested destination.'
}

interface ResolvePreparedPassMovementInput {
  readonly map: TabletopMap
  readonly gravity: MovementGravityResolver
  readonly placementId: string
  readonly policy: ResolvedPassAuthoritativeMovementPolicy
  readonly mover: MovementPlacementSnapshot
  readonly placements: readonly MovementPlacementSnapshot[]
  readonly origin: GridAnchor
  readonly footprint: AuthoritativeMovementFootprint
  readonly terrainIndex: MapMovementTerrainIndex
  readonly groundLevelY: number
  readonly consultedPlacementIds: readonly string[]
  readonly sheetReads: readonly AuthoritativeMovementSheetRead[]
}

interface PassMovementFailureEvidence {
  readonly reasonCode: AuthoritativeMovementFailureReasonCode
  readonly message: string
  readonly destination: GridAnchor
  readonly path: readonly GridAnchor[] | null
  readonly cost: number | null
  readonly capabilityLimit: number | null
  readonly effectiveLimit: number | null
  readonly capabilities: AuthoritativeMovementCapabilities
  readonly occupancy: AuthoritativeMovementOccupancy
  readonly collision: AuthoritativeMovementCollision | null
}

/** Resolve a straight reviewed Pass path while allowing occupied intermediate anchors. */
const resolvePreparedPassMovement = (
  input: ResolvePreparedPassMovementInput,
): AuthoritativeMovementResult => {
  const direction = moveAutomationAreaDirectionVector(input.policy.direction)
  if (!direction) {
    return failure({
      reasonCode: 'movement-policy-invalid',
      message: 'The authoritative Pass direction is invalid.',
      placementId: input.placementId,
      mode: 'pass',
      policy: input.policy,
      origin: input.origin,
      footprint: input.footprint,
      capabilities: resolvedCapabilities(input.mover, []),
      consultedPlacementIds: input.consultedPlacementIds,
      sheetReads: input.sheetReads,
    })
  }

  const candidates = buildMoveAutomationPassDirectionSteps({
    origin: input.origin,
    direction: input.policy.direction,
    maximumDistance: input.policy.maximumCost,
  })
  let failureEvidence: PassMovementFailureEvidence | null = null

  for (const candidate of [...candidates].reverse()) {
    const occupancy = occupancyFor(input.mover, candidate.position, input.placements)
    if (!isAnchorWithinBounds(candidate.position, input.mover, input.map.dimensions)) {
      failureEvidence = {
        reasonCode: 'movement-destination-out-of-bounds',
        message: 'The reviewed Pass direction cannot contain the authoritative footprint within map bounds.',
        destination: candidate.position,
        path: null,
        cost: candidate.distance,
        capabilityLimit: null,
        effectiveLimit: input.policy.maximumCost,
        capabilities: resolvedCapabilities(input.mover, []),
        occupancy,
        collision: boundsCollision(candidate.position),
      }
      continue
    }

    const endpointCollision = collisionAt(
      candidate.position,
      input.mover,
      input.placements,
      input.terrainIndex,
      input.groundLevelY,
    )
    if (endpointCollision) {
      const reasonCode = endpointCollision.kind === 'placement'
        ? 'movement-destination-occupied'
        : endpointCollision.kind === 'terrain'
          ? 'movement-destination-terrain-blocked'
          : 'movement-destination-collision'
      failureEvidence = {
        reasonCode,
        message: endpointCollision.kind === 'placement'
          ? 'The reviewed Pass endpoint is occupied; Pass must end in an empty footprint.'
          : 'The reviewed Pass endpoint intersects authoritative Blocking Terrain.',
        destination: candidate.position,
        path: null,
        cost: candidate.distance,
        capabilityLimit: null,
        effectiveLimit: input.policy.maximumCost,
        capabilities: resolvedCapabilities(input.mover, []),
        occupancy,
        collision: endpointCollision,
      }
      continue
    }

    const pathResult = findMovementPathForPokemon({
      pokemon: input.mover,
      start: input.origin,
      goal: candidate.position,
      // Pass treats crossed combatants as traversable; endpoint occupancy was
      // checked above against the complete authoritative placement snapshot.
      pokemons: [],
      dimensions: input.map.dimensions,
      terrainIndex: input.terrainIndex,
      groundLevelY: input.groundLevelY,
      allowedDirections: [direction],
    })
    const capabilities = resolvedCapabilities(input.mover, pathResult.capabilityKeys)
    const capabilityLimit = pathResult.movementLimit
    const resolvedEffectiveLimit = capabilityLimit === null
      ? null
      : effectiveLimit(capabilityLimit, input.policy)

    if (!pathResult.legal || capabilityLimit === null || !pathResult.path) {
      const reasonCode = pathFailureReason(pathResult)
      failureEvidence = {
        reasonCode,
        message: pathFailureMessage(reasonCode, pathResult),
        destination: candidate.position,
        path: pathResult.path,
        cost: pathResult.distance,
        capabilityLimit,
        effectiveLimit: resolvedEffectiveLimit,
        capabilities,
        occupancy,
        collision: reasonCode === 'movement-route-blocked' ? routeCollision() : null,
      }
      continue
    }

    const gravityMovement = gravityMovementForPath({
      gravity: input.gravity,
      placementId: input.placementId,
      capabilityKeys: pathResult.capabilityKeys,
      steps: pathResult.steps,
    })
    if (!gravityMovement.allowed) {
      failureEvidence = {
        reasonCode: 'movement-gravity-altitude-limit',
        message: `Gravity prevents Sky or Levitate movement from ending above ${gravityMovement.maximumAerialEndAltitude ?? 1} metre.`,
        destination: candidate.position,
        path: pathResult.path,
        cost: pathResult.distance,
        capabilityLimit,
        effectiveLimit: resolvedEffectiveLimit,
        capabilities,
        occupancy,
        collision: null,
      }
      continue
    }

    if (resolvedEffectiveLimit === null || pathResult.distance > resolvedEffectiveLimit) {
      failureEvidence = {
        reasonCode: 'movement-cost-exceeds-limit',
        message: `The server-derived Pass cost ${pathResult.distance} exceeds its effective limit ${resolvedEffectiveLimit ?? 0}.`,
        destination: candidate.position,
        path: pathResult.path,
        cost: pathResult.distance,
        capabilityLimit,
        effectiveLimit: resolvedEffectiveLimit,
        capabilities,
        occupancy,
        collision: null,
      }
      continue
    }

    const triggeringSteps = pathResult.steps.map(step => (
      triggeringStep(step, input.mover, input.placements, pathResult.steps.length)
    ))
    return deepFreeze({
      ok: true,
      reasonCode: 'movement-legal',
      placementId: input.placementId,
      mode: 'pass',
      policy: { ...input.policy },
      origin: cloneAnchor(input.origin),
      destination: cloneAnchor(candidate.position),
      path: cloneAnchors(pathResult.path),
      cost: pathResult.distance,
      capabilityLimit,
      effectiveLimit: resolvedEffectiveLimit,
      capabilities,
      movementProfile: input.mover.movementProfile,
      footprint: { ...input.footprint },
      occupancy,
      collision: null,
      triggeringSteps,
      consultedPlacementIds: [...input.consultedPlacementIds],
      sheetReads: input.sheetReads.map(read => ({ ...read })),
    })
  }

  return failure({
    reasonCode: failureEvidence?.reasonCode ?? 'movement-route-blocked',
    message: failureEvidence?.message
      ?? 'No legal empty endpoint is available along the reviewed Pass direction.',
    placementId: input.placementId,
    mode: 'pass',
    policy: input.policy,
    origin: input.origin,
    destination: failureEvidence?.destination ?? null,
    path: failureEvidence?.path ?? null,
    cost: failureEvidence?.cost ?? null,
    capabilityLimit: failureEvidence?.capabilityLimit ?? null,
    effectiveLimit: failureEvidence?.effectiveLimit ?? input.policy.maximumCost,
    capabilities: failureEvidence?.capabilities ?? resolvedCapabilities(input.mover, []),
    footprint: input.footprint,
    occupancy: failureEvidence?.occupancy ?? null,
    collision: failureEvidence?.collision ?? routeCollision(),
    consultedPlacementIds: input.consultedPlacementIds,
    sheetReads: input.sheetReads,
  })
}

/**
 * Resolve movement from authoritative map and sheet state only.
 *
 * The input intentionally has no path, cost, capability, occupancy, or trigger
 * fields. Browser path previews are hints for presentation and never mechanics.
 */
export const resolveMovement = (input: ResolveMovementInput): AuthoritativeMovementResult => {
  const rawMode = (input as { readonly mode?: unknown }).mode
  const mode = typeof rawMode === 'string' ? rawMode : String(rawMode)
  const placementId = typeof input.placementId === 'string' ? input.placementId : String(input.placementId)
  const rawDestination = (input as { readonly destination?: unknown }).destination
  const destination = validAnchor(rawDestination) ? cloneAnchor(rawDestination) : null

  if (rawMode !== 'shift' && rawMode !== 'pass') {
    return failure({
      reasonCode: 'movement-mode-unsupported',
      message: `Movement mode ${mode} is not supported by the authoritative oracle.`,
      placementId,
      mode,
      destination,
    })
  }

  const policy = rawMode === 'pass'
    ? resolvedPassPolicy(input)
    : resolvedPolicy((input as ResolveShiftMovementInput).policy)
  if (!policy) {
    return failure({
      reasonCode: 'movement-policy-invalid',
      message: rawMode === 'pass'
        ? 'The authoritative Pass direction or maximum distance is malformed or exceeds its bounded cost.'
        : 'The authoritative movement policy is malformed or exceeds its bounded cost.',
      placementId,
      mode,
      destination,
    })
  }

  if (!validIdentifier(placementId)) {
    return failure({
      reasonCode: 'movement-placement-missing',
      message: 'Movement placement identity must be a bounded non-empty string.',
      placementId,
      mode,
      policy,
      destination,
    })
  }

  if (policy.kind !== 'pass' && !destination) {
    return failure({
      reasonCode: 'movement-destination-invalid',
      message: 'Movement destination must contain safe integer x, y, and z coordinates.',
      placementId,
      mode,
      policy,
    })
  }

  const invalidMap = validateMapGeometry(input.map)
  if (invalidMap) {
    return failure({
      reasonCode: 'movement-map-invalid',
      message: invalidMap,
      placementId,
      mode,
      policy,
      destination,
    })
  }

  const snapshotResult = buildMovementSnapshots(input.map, input.sheets, placementId)
  if (!snapshotResult.ok) {
    return failure({
      reasonCode: snapshotResult.reasonCode,
      message: snapshotResult.message,
      placementId,
      mode,
      policy,
      destination,
      consultedPlacementIds: snapshotResult.consultedPlacementIds,
      sheetReads: snapshotResult.sheetReads,
    })
  }

  const gravity = gravityResolverForMap(input.map)
  const snapshots = projectGravityMovementSnapshots(snapshotResult, gravity)
  const { mover, placements, sheetReads } = snapshots
  const origin = cloneAnchor(mover.position)
  const footprint: AuthoritativeMovementFootprint = {
    base: mover.base,
    clearance: getClearanceValue(mover),
  }
  const requestedOccupancy = destination ? occupancyFor(mover, destination, placements) : null
  const consultedPlacementIds = placements.map(placement => placement.id)
  const capabilities = resolvedCapabilities(mover, [])
  if (mover.movementProfile.state.semiInvulnerable !== 'none') {
    return failure({
      reasonCode: 'movement-semi-invulnerable-state',
      message: `Placement ${placementId} cannot use ordinary movement while ${mover.movementProfile.state.semiInvulnerable}.`,
      placementId,
      mode,
      policy,
      origin,
      destination,
      footprint,
      occupancy: requestedOccupancy,
      capabilities,
      movementProfile: mover.movementProfile,
      consultedPlacementIds,
      sheetReads,
    })
  }
  const terrainIndex = withBattlefieldZoneMovementTerrain({
    map: input.map,
    terrain: buildMapMovementTerrainIndex(input.map.voxels),
    subject: {
      placementId: mover.id,
      sideId: mover.sideId,
      grounding: mover.movementProfile.state.grounding,
      typeIds: mover.typeIds,
    },
  })
  const groundLevelY = input.map.groundLevelY ?? 0

  if (!isAnchorWithinBounds(origin, mover, input.map.dimensions)) {
    return failure({
      reasonCode: 'movement-origin-out-of-bounds',
      message: 'The authoritative movement origin footprint is outside map bounds.',
      placementId,
      mode,
      policy,
      origin,
      destination,
      footprint,
      occupancy: requestedOccupancy,
      capabilities,
      collision: boundsCollision(origin),
      consultedPlacementIds,
      sheetReads,
    })
  }

  const originCollision = collisionAt(origin, mover, placements, terrainIndex, groundLevelY)
  if (originCollision) {
    const terrainOnly = originCollision.kind === 'terrain'
    return failure({
      reasonCode: terrainOnly ? 'movement-origin-terrain-blocked' : 'movement-origin-collision',
      message: terrainOnly
        ? 'The authoritative movement origin intersects Blocking Terrain.'
        : 'The authoritative movement origin intersects another placement or mixed collision.',
      placementId,
      mode,
      policy,
      origin,
      destination,
      footprint,
      occupancy: requestedOccupancy,
      capabilities,
      collision: originCollision,
      consultedPlacementIds,
      sheetReads,
    })
  }

  if (policy.kind === 'pass') {
    const result = resolvePreparedPassMovement({
      map: input.map,
      gravity,
      placementId,
      policy,
      mover,
      placements,
      origin,
      footprint,
      terrainIndex,
      groundLevelY,
      consultedPlacementIds,
      sheetReads,
    })
    return enforceMagnetPullMovementConstraints({ map: input.map, result, mover, placements })
  }

  // The mode-specific validation above already rejected this case. Keep the
  // guard local so all ordinary Shift code below remains exhaustively typed.
  if (!destination) {
    return failure({
      reasonCode: 'movement-destination-invalid',
      message: 'Movement destination must contain safe integer x, y, and z coordinates.',
      placementId,
      mode,
      policy,
      origin,
      footprint,
      capabilities,
      consultedPlacementIds,
      sheetReads,
    })
  }

  const occupancy = occupancyFor(mover, destination, placements)

  if (sameAnchor(origin, destination) && !policy.allowSamePosition) {
    return failure({
      reasonCode: 'movement-same-position-disallowed',
      message: 'The requested destination is already the authoritative origin.',
      placementId,
      mode,
      policy,
      origin,
      destination,
      footprint,
      occupancy,
      capabilities,
      consultedPlacementIds,
      sheetReads,
    })
  }

  if (!isAnchorWithinBounds(destination, mover, input.map.dimensions)) {
    return failure({
      reasonCode: 'movement-destination-out-of-bounds',
      message: 'The requested destination cannot contain the authoritative footprint within map bounds.',
      placementId,
      mode,
      policy,
      origin,
      destination,
      footprint,
      occupancy,
      capabilities,
      collision: boundsCollision(destination),
      consultedPlacementIds,
      sheetReads,
    })
  }

  const destinationCollision = collisionAt(destination, mover, placements, terrainIndex, groundLevelY)
  if (destinationCollision) {
    const reasonCode = destinationCollision.kind === 'placement'
      ? 'movement-destination-occupied'
      : destinationCollision.kind === 'terrain'
        ? 'movement-destination-terrain-blocked'
        : 'movement-destination-collision'
    return failure({
      reasonCode,
      message: destinationCollision.kind === 'placement'
        ? 'The requested destination footprint is occupied by another authoritative placement.'
        : destinationCollision.kind === 'terrain'
          ? 'The requested destination footprint intersects Blocking Terrain.'
          : 'The requested destination footprint has mixed placement and terrain collisions.',
      placementId,
      mode,
      policy,
      origin,
      destination,
      footprint,
      occupancy,
      capabilities,
      collision: destinationCollision,
      consultedPlacementIds,
      sheetReads,
    })
  }

  const sourcePlacement = input.map.placements.find(placement => placement.id === placementId)
  const sourceSheet = sourcePlacement
    ? sourcePlacement.sheetKind === 'pokemon'
      ? input.sheets.pokemon.get(sourcePlacement.sheetSlug)
      : input.sheets.trainer.get(sourcePlacement.sheetSlug)
    : null
  const cardinalOnly = policy.kind === 'standard' && sourcePlacement && sourceSheet
    ? effectiveRuntimeAbilityIds({
        map: input.map,
        placement: sourcePlacement,
        sheet: sourceSheet,
      }).includes('Line Charge')
    : false
  const pathResult = findMovementPathForPokemon({
    pokemon: mover,
    start: origin,
    goal: destination,
    pokemons: placements,
    dimensions: input.map.dimensions,
    exceptId: mover.id,
    terrainIndex,
    groundLevelY,
    ...(cardinalOnly ? {
      allowedDirections: [
        { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
      ],
    } : {}),
    ...(policy.kind === 'gm-override' ? { costLimit: policy.maximumCost } : {}),
  })
  const pathCapabilities = resolvedCapabilities(mover, pathResult.capabilityKeys)
  const capabilityLimit = pathResult.movementLimit
  const resolvedEffectiveLimit = capabilityLimit === null
    ? null
    : effectiveLimit(capabilityLimit, policy)

  if (!pathResult.legal) {
    const reasonCode = pathFailureReason(pathResult)
    return failure({
      reasonCode,
      message: pathFailureMessage(reasonCode, pathResult),
      placementId,
      mode,
      policy,
      origin,
      destination,
      path: pathResult.path,
      cost: pathResult.distance,
      capabilityLimit,
      effectiveLimit: resolvedEffectiveLimit,
      footprint,
      occupancy,
      capabilities: pathCapabilities,
      collision: reasonCode === 'movement-route-blocked' ? routeCollision() : null,
      consultedPlacementIds,
      sheetReads,
    })
  }

  if (resolvedEffectiveLimit === null || pathResult.distance > resolvedEffectiveLimit) {
    return failure({
      reasonCode: 'movement-cost-exceeds-limit',
      message: `The server-derived movement cost ${pathResult.distance} exceeds the effective limit ${resolvedEffectiveLimit ?? 0}.`,
      placementId,
      mode,
      policy,
      origin,
      destination,
      path: pathResult.path,
      cost: pathResult.distance,
      capabilityLimit,
      effectiveLimit: resolvedEffectiveLimit,
      footprint,
      occupancy,
      capabilities: pathCapabilities,
      consultedPlacementIds,
      sheetReads,
    })
  }

  const path = pathResult.path
  if (!path || capabilityLimit === null) {
    return failure({
      reasonCode: 'movement-route-blocked',
      message: 'The movement pathfinder returned no authoritative path for a legal result.',
      placementId,
      mode,
      policy,
      origin,
      destination,
      cost: pathResult.distance,
      footprint,
      occupancy,
      capabilities: pathCapabilities,
      collision: routeCollision(),
      consultedPlacementIds,
      sheetReads,
    })
  }

  const gravityMovement = gravityMovementForPath({
    gravity,
    placementId,
    capabilityKeys: pathResult.capabilityKeys,
    steps: pathResult.steps,
  })
  if (!gravityMovement.allowed) {
    return failure({
      reasonCode: 'movement-gravity-altitude-limit',
      message: `Gravity prevents Sky or Levitate movement from ending above ${gravityMovement.maximumAerialEndAltitude ?? 1} metre.`,
      placementId,
      mode,
      policy,
      origin,
      destination,
      path,
      cost: pathResult.distance,
      capabilityLimit,
      effectiveLimit: resolvedEffectiveLimit,
      footprint,
      occupancy,
      capabilities: pathCapabilities,
      consultedPlacementIds,
      sheetReads,
    })
  }

  const triggeringSteps = pathResult.steps.map(step => (
    triggeringStep(step, mover, placements, pathResult.steps.length)
  ))

  const result: AuthoritativeMovementSuccess = deepFreeze({
    ok: true,
    reasonCode: 'movement-legal',
    placementId,
    mode: 'shift',
    policy,
    origin,
    destination,
    path: cloneAnchors(path),
    cost: pathResult.distance,
    capabilityLimit,
    effectiveLimit: resolvedEffectiveLimit,
    capabilities: pathCapabilities,
    movementProfile: mover.movementProfile,
    footprint,
    occupancy,
    collision: null,
    triggeringSteps,
    consultedPlacementIds,
    sheetReads: sheetReads.map(read => ({ ...read })),
  })
  return enforceMagnetPullMovementConstraints({ map: input.map, result, mover, placements })
}

const DISPLACEMENT_MOVEMENT_MODE_SET = new Set<string>(
  AUTHORITATIVE_DISPLACEMENT_MOVEMENT_MODES,
)
const DISPLACEMENT_DISTANCE_POLICY_SET = new Set<string>(
  AUTHORITATIVE_DISPLACEMENT_DISTANCE_POLICIES,
)

const cloneDisplacementObstruction = (
  obstruction: AuthoritativeDisplacementObstruction | null,
): AuthoritativeDisplacementObstruction | null => obstruction === null ? null : ({
  reason: obstruction.reason,
  at: cloneAnchor(obstruction.at),
  collision: obstruction.collision === null ? null : {
    kind: obstruction.collision.kind,
    at: obstruction.collision.at === null ? null : cloneAnchor(obstruction.collision.at),
    placementIds: [...obstruction.collision.placementIds],
    voxelCells: cloneAnchors(obstruction.collision.voxelCells),
  },
  terrainRequirements: [...obstruction.terrainRequirements],
})

const cloneDisplacementPartial = (
  partial: AuthoritativeDisplacementPartial,
): AuthoritativeDisplacementPartial => ({
  origin: cloneAnchor(partial.origin),
  destination: cloneAnchor(partial.destination),
  path: cloneAnchors(partial.path),
  requestedDistance: partial.requestedDistance,
  resolvedDistance: partial.resolvedDistance,
  shortened: partial.shortened,
  shorteningReason: partial.shorteningReason,
  obstruction: cloneDisplacementObstruction(partial.obstruction),
})

const displacementFailure = (input: {
  readonly reasonCode: AuthoritativeDisplacementFailureReasonCode
  readonly message: string
  readonly placementId: string
  readonly movementMode: string
  readonly distancePolicy: string
  readonly partial?: AuthoritativeDisplacementPartial | null
  readonly consultedPlacementIds?: readonly string[]
  readonly sheetReads?: readonly AuthoritativeMovementSheetRead[]
}): AuthoritativeDisplacementFailure => deepFreeze({
  ok: false,
  reasonCode: input.reasonCode,
  message: input.message,
  placementId: input.placementId,
  movementMode: input.movementMode,
  distancePolicy: input.distancePolicy,
  partial: input.partial ? cloneDisplacementPartial(input.partial) : null,
  consultedPlacementIds: [...(input.consultedPlacementIds ?? [])],
  sheetReads: (input.sheetReads ?? []).map(read => ({ ...read })),
})

const displacementSnapshotFailureCode = (
  reasonCode: MovementSnapshotFailure['reasonCode'],
): AuthoritativeDisplacementFailureReasonCode => {
  if (reasonCode === 'movement-placement-missing') return 'displacement-placement-missing'
  if (reasonCode === 'movement-placement-duplicate') return 'displacement-placement-duplicate'
  if (reasonCode === 'movement-placement-unresolved') return 'displacement-placement-unresolved'
  if (reasonCode === 'movement-footprint-invalid') return 'displacement-footprint-invalid'
  return 'displacement-map-invalid'
}

const validDisplacementVector = (value: unknown): value is GridAnchor => (
  validAnchor(value)
  && value.x >= -1
  && value.x <= 1
  && value.y >= -1
  && value.y <= 1
  && value.z >= -1
  && value.z <= 1
  && (value.x !== 0 || value.y !== 0 || value.z !== 0)
)

interface AuthoritativeDisplacementCandidate {
  readonly anchor: GridAnchor
  readonly distance: number
}

const authoritativeDisplacementCandidates = (input: {
  readonly origin: GridAnchor
  readonly vector: GridAnchor
  readonly requestedDistance: number
}): readonly AuthoritativeDisplacementCandidate[] => {
  const candidates: AuthoritativeDisplacementCandidate[] = []
  for (let step = 1; step <= AUTHORITATIVE_MOVEMENT_LIMITS.policyCost; step += 1) {
    const distance = ptuGridVectorDistance({
      x: input.vector.x * step,
      y: input.vector.y * step,
      z: input.vector.z * step,
    })
    if (distance > input.requestedDistance) break
    candidates.push({
      anchor: {
        x: input.origin.x + input.vector.x * step,
        y: input.origin.y + input.vector.y * step,
        z: input.origin.z + input.vector.z * step,
      },
      distance,
    })
  }
  return candidates
}

const displacementTerrain = (input: {
  readonly anchor: GridAnchor
  readonly mover: MovementPlacementSnapshot
  readonly terrainIndex: MapMovementTerrainIndex
  readonly groundLevelY: number
}): MovementAnchorTerrain => movementTerrainForAnchor({
  anchor: input.anchor,
  footprint: input.mover,
  terrain: input.terrainIndex,
  groundLevelY: input.groundLevelY,
})

const unavailableDisplacementModeReason = (input: {
  readonly from: GridAnchor
  readonly to: GridAnchor
  readonly mover: MovementPlacementSnapshot
  readonly terrainIndex: MapMovementTerrainIndex
  readonly groundLevelY: number
}): Extract<
  AuthoritativeDisplacementShorteningReason,
  'height-change' | 'movement-mode-unavailable'
> => {
  const fromTerrain = displacementTerrain({
    anchor: input.from,
    mover: input.mover,
    terrainIndex: input.terrainIndex,
    groundLevelY: input.groundLevelY,
  })
  const toTerrain = displacementTerrain({
    anchor: input.to,
    mover: input.mover,
    terrainIndex: input.terrainIndex,
    groundLevelY: input.groundLevelY,
  })
  return input.from.y !== input.to.y
    || (!fromTerrain.air && toTerrain.requirements.includes('aerial'))
    ? 'height-change'
    : 'movement-mode-unavailable'
}

const displacementObstruction = (input: {
  readonly reason: AuthoritativeDisplacementObstruction['reason']
  readonly at: GridAnchor
  readonly collision?: AuthoritativeMovementCollision | null
  readonly terrainRequirements?: readonly MovementTerrainRequirement[]
}): AuthoritativeDisplacementObstruction => ({
  reason: input.reason,
  at: cloneAnchor(input.at),
  collision: input.collision ?? null,
  terrainRequirements: [...(input.terrainRequirements ?? [])],
})

/**
 * Validate one server-derived straight push, pull, or shift ray.
 *
 * Speed ceilings do not reduce a reviewed move's displacement distance, but
 * every step still needs a legal authoritative traversal mode. The first
 * bounds, footprint, voxel, height, or mode obstruction either truncates an
 * up-to operation or rejects a full-distance operation.
 */
export const resolveAuthoritativeDisplacement = (
  input: ResolveAuthoritativeDisplacementInput,
): AuthoritativeDisplacementResult => {
  const raw = input as ResolveAuthoritativeDisplacementInput & Record<string, unknown>
  const placementId = typeof raw.placementId === 'string'
    ? raw.placementId
    : String(raw.placementId)
  const movementMode = typeof raw.movementMode === 'string'
    ? raw.movementMode
    : String(raw.movementMode)
  const distancePolicy = typeof raw.distancePolicy === 'string'
    ? raw.distancePolicy
    : String(raw.distancePolicy)

  if (!DISPLACEMENT_MOVEMENT_MODE_SET.has(movementMode)) {
    return displacementFailure({
      reasonCode: 'displacement-mode-unsupported',
      message: `Displacement mode ${movementMode} is not supported.`,
      placementId,
      movementMode,
      distancePolicy,
    })
  }
  if (!DISPLACEMENT_DISTANCE_POLICY_SET.has(distancePolicy)) {
    return displacementFailure({
      reasonCode: 'displacement-policy-invalid',
      message: `Displacement distance policy ${distancePolicy} is not supported.`,
      placementId,
      movementMode,
      distancePolicy,
    })
  }
  if (!validIdentifier(placementId)) {
    return displacementFailure({
      reasonCode: 'displacement-placement-missing',
      message: 'Displacement placement identity must be a bounded non-empty string.',
      placementId,
      movementMode,
      distancePolicy,
    })
  }
  if (!validDisplacementVector(raw.vector)) {
    return displacementFailure({
      reasonCode: 'displacement-vector-invalid',
      message: 'Displacement vector must be a non-zero unit grid vector.',
      placementId,
      movementMode,
      distancePolicy,
    })
  }
  if (
    !Number.isSafeInteger(raw.requestedDistance)
    || raw.requestedDistance < 0
    || raw.requestedDistance > AUTHORITATIVE_MOVEMENT_LIMITS.policyCost
  ) {
    return displacementFailure({
      reasonCode: 'displacement-distance-invalid',
      message: `Displacement distance must be a safe integer from 0 through ${AUTHORITATIVE_MOVEMENT_LIMITS.policyCost}.`,
      placementId,
      movementMode,
      distancePolicy,
    })
  }

  const invalidMap = validateMapGeometry(input.map)
  if (invalidMap) {
    return displacementFailure({
      reasonCode: 'displacement-map-invalid',
      message: invalidMap,
      placementId,
      movementMode,
      distancePolicy,
    })
  }
  const snapshotResult = buildMovementSnapshots(input.map, input.sheets, placementId)
  if (!snapshotResult.ok) {
    return displacementFailure({
      reasonCode: displacementSnapshotFailureCode(snapshotResult.reasonCode),
      message: snapshotResult.message,
      placementId,
      movementMode,
      distancePolicy,
      consultedPlacementIds: snapshotResult.consultedPlacementIds,
      sheetReads: snapshotResult.sheetReads,
    })
  }

  // Forced displacement is not a use of Sky/Levitate, but Gravity's grounding
  // projection still controls zone eligibility along the authoritative path.
  const snapshots = projectGravityMovementSnapshots(
    snapshotResult,
    gravityResolverForMap(input.map),
  )
  const { mover, placements, sheetReads } = snapshots
  const origin = cloneAnchor(mover.position)
  const consultedPlacementIds = placements.map(placement => placement.id)
  const terrainIndex = withBattlefieldZoneMovementTerrain({
    map: input.map,
    terrain: buildMapMovementTerrainIndex(input.map.voxels),
    subject: {
      placementId: mover.id,
      sideId: mover.sideId,
      grounding: mover.movementProfile.state.grounding,
      typeIds: mover.typeIds,
    },
  })
  const groundLevelY = input.map.groundLevelY ?? 0
  if (!isAnchorWithinBounds(origin, mover, input.map.dimensions)) {
    return displacementFailure({
      reasonCode: 'displacement-origin-out-of-bounds',
      message: 'The authoritative displacement origin footprint is outside map bounds.',
      placementId,
      movementMode,
      distancePolicy,
      consultedPlacementIds,
      sheetReads,
    })
  }
  const originCollision = collisionAt(
    origin,
    mover,
    placements,
    terrainIndex,
    groundLevelY,
  )
  if (originCollision) {
    return displacementFailure({
      reasonCode: 'displacement-origin-collision',
      message: 'The authoritative displacement origin intersects a placement or Blocking Terrain.',
      placementId,
      movementMode,
      distancePolicy,
      consultedPlacementIds,
      sheetReads,
    })
  }

  const requestedDistance = raw.requestedDistance
  const candidates = authoritativeDisplacementCandidates({
    origin,
    vector: raw.vector,
    requestedDistance,
  })
  const path: GridAnchor[] = [origin]
  const pathSteps: MovementPathStep[] = []
  let resolvedDistance = 0
  let obstruction: AuthoritativeDisplacementObstruction | null = null

  for (const candidate of candidates) {
    if (!isAnchorWithinBounds(candidate.anchor, mover, input.map.dimensions)) {
      obstruction = displacementObstruction({
        reason: 'map-bounds',
        at: candidate.anchor,
        collision: boundsCollision(candidate.anchor),
      })
      break
    }

    const collision = collisionAt(
      candidate.anchor,
      mover,
      placements,
      terrainIndex,
      groundLevelY,
    )
    if (collision) {
      obstruction = displacementObstruction({
        reason: collision.kind === 'placement'
          ? 'occupied-footprint'
          : collision.kind === 'terrain'
            ? 'blocking-terrain'
            : 'mixed-collision',
        at: candidate.anchor,
        collision,
      })
      break
    }

    const previous = path.at(-1)!
    const step = findMovementPathForPokemon({
      pokemon: mover,
      start: previous,
      goal: candidate.anchor,
      pokemons: placements,
      dimensions: input.map.dimensions,
      exceptId: mover.id,
      terrainIndex,
      groundLevelY,
      costLimit: AUTHORITATIVE_MOVEMENT_LIMITS.policyCost,
      allowedDirections: [raw.vector],
    })
    if (
      !step.legal
      || step.path?.length !== 2
      || !sameAnchor(step.path[0]!, previous)
      || !sameAnchor(step.path[1]!, candidate.anchor)
    ) {
      const reason = unavailableDisplacementModeReason({
        from: previous,
        to: candidate.anchor,
        mover,
        terrainIndex,
        groundLevelY,
      })
      obstruction = displacementObstruction({
        reason,
        at: candidate.anchor,
        terrainRequirements: displacementTerrain({
          anchor: candidate.anchor,
          mover,
          terrainIndex,
          groundLevelY,
        }).requirements,
      })
      break
    }

    const resolvedStep = step.steps[0]
    if (!resolvedStep) {
      obstruction = displacementObstruction({
        reason: 'movement-mode-unavailable',
        at: candidate.anchor,
      })
      break
    }
    pathSteps.push({
      ...resolvedStep,
      index: pathSteps.length + 1,
      cost: candidate.distance - resolvedDistance,
      cumulativeCost: candidate.distance,
    })
    path.push(cloneAnchor(candidate.anchor))
    resolvedDistance = candidate.distance
  }

  const shortened = resolvedDistance < requestedDistance
  const shorteningReason: AuthoritativeDisplacementShorteningReason = !shortened
    ? 'none'
    : obstruction?.reason ?? 'grid-distance-quantized'
  const partial: AuthoritativeDisplacementPartial = {
    origin,
    destination: cloneAnchor(path.at(-1) ?? origin),
    path,
    requestedDistance,
    resolvedDistance,
    shortened,
    shorteningReason,
    obstruction,
  }

  if (shortened && distancePolicy === 'full-distance-required') {
    return displacementFailure({
      reasonCode: 'displacement-full-distance-unavailable',
      message: `Full displacement distance ${requestedDistance} is unavailable (${shorteningReason}).`,
      placementId,
      movementMode,
      distancePolicy,
      partial,
      consultedPlacementIds,
      sheetReads,
    })
  }

  if (aa085to100ShadowTagPathViolation({
    map: input.map,
    placementId: mover.id,
    path,
  })) return displacementFailure({
    reasonCode: 'displacement-shadow-tag-maximum-range',
    message: 'Shadow Tag prevents displacement more than 5 metres from the pinned shadow.',
    placementId,
    movementMode,
    distancePolicy,
    partial,
    consultedPlacementIds,
    sheetReads,
  })

  if (movementMode === 'voluntary') {
    const violation = aa079MagnetPullConstraintViolation({
      map: input.map,
      placementId: mover.id,
      origin,
      path,
      footprints: placements,
    })
    if (violation) return displacementFailure({
      reasonCode: `displacement-magnet-pull-${violation}-range`,
      message: violation === 'maximum'
        ? 'Magnet Pull prevents this voluntary displacement from moving farther than 6 metres from its source.'
        : 'Magnet Pull prevents this voluntary displacement from moving closer than 3 metres to its source.',
      placementId,
      movementMode,
      distancePolicy,
      partial,
      consultedPlacementIds,
      sheetReads,
    })
    if (aa082ParentalBondTetherViolation({
      placementId: mover.id,
      origin,
      path,
      footprints: placements,
    })) return displacementFailure({
      reasonCode: 'displacement-parental-bond-maximum-range',
      message: 'Parental Bond prevents the Baby from willingly moving farther than 10 metres from its mother.',
      placementId,
      movementMode,
      distancePolicy,
      partial,
      consultedPlacementIds,
      sheetReads,
    })
  }
  const triggeringSteps = pathSteps.map(step => (
    triggeringStep(step, mover, placements, pathSteps.length)
  ))
  return deepFreeze({
    ok: true,
    reasonCode: 'displacement-legal',
    placementId,
    movementMode: movementMode as AuthoritativeDisplacementMovementMode,
    distancePolicy: distancePolicy as AuthoritativeDisplacementDistancePolicy,
    ...cloneDisplacementPartial(partial),
    triggeringSteps,
    consultedPlacementIds: [...consultedPlacementIds],
    sheetReads: sheetReads.map(read => ({ ...read })),
  })
}

const relocationSnapshotFailureCode = (
  reasonCode: MovementSnapshotFailure['reasonCode'],
): AuthoritativeRelocationFailure['reasonCode'] => {
  if (reasonCode === 'movement-placement-missing') return 'relocation-placement-missing'
  if (reasonCode === 'movement-placement-duplicate') return 'relocation-placement-duplicate'
  if (reasonCode === 'movement-placement-unresolved') return 'relocation-placement-unresolved'
  if (reasonCode === 'movement-footprint-invalid') return 'relocation-footprint-invalid'
  return 'relocation-map-invalid'
}

const relocationFailure = (input: {
  readonly reasonCode: AuthoritativeRelocationFailure['reasonCode']
  readonly message: string
  readonly placementId: string
  readonly mode: string
  readonly origin?: GridAnchor | null
  readonly destination?: GridAnchor | null
  readonly collision?: AuthoritativeMovementCollision | null
  readonly consultedPlacementIds?: readonly string[]
  readonly sheetReads?: readonly AuthoritativeMovementSheetRead[]
}): AuthoritativeRelocationFailure => deepFreeze({
  ok: false,
  reasonCode: input.reasonCode,
  message: input.message,
  placementId: input.placementId,
  mode: input.mode,
  origin: input.origin ? cloneAnchor(input.origin) : null,
  destination: input.destination ? cloneAnchor(input.destination) : null,
  collision: input.collision ?? null,
  consultedPlacementIds: [...(input.consultedPlacementIds ?? [])],
  sheetReads: (input.sheetReads ?? []).map(read => ({ ...read })),
})

/**
 * Resolve one instantaneous teleport or one side of an atomic swap. The same
 * authoritative footprint, map bounds, placement occupancy, terrain voxels,
 * gravity projection, and sheet read set used by ordinary movement are reused,
 * while route traversal and speed are deliberately not consulted.
 */
export const resolveAuthoritativeRelocation = (
  input: ResolveAuthoritativeRelocationInput,
): AuthoritativeRelocationResult => {
  const raw = input as ResolveAuthoritativeRelocationInput & Record<string, unknown>
  const placementId = typeof raw.placementId === 'string' ? raw.placementId : String(raw.placementId)
  const mode = typeof raw.mode === 'string' ? raw.mode : String(raw.mode)
  if (mode !== 'teleport' && mode !== 'swap') {
    return relocationFailure({
      reasonCode: 'relocation-mode-unsupported', message: `Relocation mode ${mode} is unsupported.`,
      placementId, mode,
    })
  }
  if (!validAnchor(raw.destination)) {
    return relocationFailure({
      reasonCode: 'relocation-destination-invalid', message: 'Relocation destination must be a bounded safe-integer anchor.',
      placementId, mode,
    })
  }
  const invalidMap = validateMapGeometry(input.map)
  if (invalidMap) {
    return relocationFailure({ reasonCode: 'relocation-map-invalid', message: invalidMap, placementId, mode })
  }
  const snapshotsResult = buildMovementSnapshots(input.map, input.sheets, placementId)
  if (!snapshotsResult.ok) {
    return relocationFailure({
      reasonCode: relocationSnapshotFailureCode(snapshotsResult.reasonCode),
      message: snapshotsResult.message, placementId, mode,
      consultedPlacementIds: snapshotsResult.consultedPlacementIds,
      sheetReads: snapshotsResult.sheetReads,
    })
  }
  const snapshots = projectGravityMovementSnapshots(
    snapshotsResult,
    gravityResolverForMap(input.map),
  )
  const { mover, sheetReads } = snapshots
  const origin = cloneAnchor(mover.position)
  const destination = cloneAnchor(raw.destination)
  const consultedPlacementIds = snapshots.placements.map(placement => placement.id)
  const ignored = new Set(input.ignoredPlacementIds ?? [])
  if (ignored.has(placementId) || [...ignored].some(id => !consultedPlacementIds.includes(id))) {
    return relocationFailure({
      reasonCode: 'relocation-destination-invalid',
      message: 'Relocation ignored-placement identities must name other authoritative placements.',
      placementId, mode, origin, destination, consultedPlacementIds, sheetReads,
    })
  }
  const terrainIndex = withBattlefieldZoneMovementTerrain({
    map: input.map,
    terrain: buildMapMovementTerrainIndex(input.map.voxels),
    subject: {
      placementId: mover.id, sideId: mover.sideId,
      grounding: mover.movementProfile.state.grounding, typeIds: mover.typeIds,
    },
  })
  const groundLevelY = input.map.groundLevelY ?? 0
  if (!isAnchorWithinBounds(origin, mover, input.map.dimensions)) {
    return relocationFailure({
      reasonCode: 'relocation-origin-out-of-bounds', message: 'Relocation origin is outside map bounds.',
      placementId, mode, origin, destination, consultedPlacementIds, sheetReads,
    })
  }
  const originCollision = collisionAt(origin, mover, snapshots.placements, terrainIndex, groundLevelY)
  if (originCollision) {
    return relocationFailure({
      reasonCode: 'relocation-origin-collision', message: 'Relocation origin intersects authoritative occupancy.',
      placementId, mode, origin, destination, collision: originCollision, consultedPlacementIds, sheetReads,
    })
  }
  if (!isAnchorWithinBounds(destination, mover, input.map.dimensions)) {
    return relocationFailure({
      reasonCode: 'relocation-destination-out-of-bounds', message: 'Relocation destination is outside map bounds.',
      placementId, mode, origin, destination, collision: boundsCollision(destination), consultedPlacementIds, sheetReads,
    })
  }
  if (aa085to100ShadowTagPathViolation({
    map: input.map,
    placementId: mover.id,
    path: [destination],
  })) {
    return relocationFailure({
      reasonCode: 'relocation-shadow-tag-maximum-range',
      message: 'Shadow Tag prevents relocation more than 5 metres from the pinned shadow.',
      placementId, mode, origin, destination, consultedPlacementIds, sheetReads,
    })
  }
  const collision = collisionAt(
    destination,
    mover,
    snapshots.placements.filter(placement => !ignored.has(placement.id)),
    terrainIndex,
    groundLevelY,
  )
  if (collision) {
    return relocationFailure({
      reasonCode: 'relocation-destination-occupied', message: 'Relocation destination intersects authoritative occupancy.',
      placementId, mode, origin, destination, collision, consultedPlacementIds, sheetReads,
    })
  }
  const distance = ptuGridDistanceBetweenFootprints(mover, { ...mover, position: destination })
  const same = sameAnchor(origin, destination)
  const terrain = displacementTerrain({ anchor: destination, mover, terrainIndex, groundLevelY })
  const step: MovementPathStep | null = same ? null : {
    index: 1, from: origin, to: destination, cost: distance, cumulativeCost: distance,
    diagonal: origin.x !== destination.x && origin.z !== destination.z,
    slow: false, capabilityKeys: [], terrain,
  }
  return deepFreeze({
    ok: true,
    reasonCode: 'relocation-legal',
    placementId,
    mode: mode as AuthoritativeRelocationMode,
    origin,
    destination,
    distance,
    path: same ? [origin] : [origin, destination],
    triggeringSteps: step ? [triggeringStep(step, mover, snapshots.placements, 1)] : [],
    consultedPlacementIds: [...consultedPlacementIds],
    sheetReads: sheetReads.map(read => ({ ...read })),
  })
}

/** Explicit name for callers that want the authority boundary visible. */
export const resolveAuthoritativeMovement = resolveMovement
