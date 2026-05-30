import * as THREE from 'three'
import {
  MOVE_VFX_KIND,
  type MoveAnimationEvent,
  type MoveArcAnimationEvent,
  type MoveBeamAnimationEvent,
  type MoveCritAnimationEvent,
  type MoveImpactRingAnimationEvent,
  type MoveMeleeLungeAnimationEvent,
  type MoveMissAnimationEvent,
  type MoveProjectileAnimationEvent,
  type MoveSelfPulseAnimationEvent,
  type MoveTargetFlashAnimationEvent,
} from '~/types/moveAnimation'
import { DEFAULT_MOVE_VFX_COLOR, MOVE_VFX_TONE, moveVfxColorForTone, type MoveVfxPaletteEntry } from '~/utils/moveAnimationPalette'
import type { PokemonRenderObject } from '~/utils/isometric/types'
import {
  MOVE_VFX_TOKEN_ANCHOR,
  moveVfxAreaCentroidAnchor,
  resolveMoveVfxAnchorPair,
  resolveMoveVfxTokenAnchor,
} from './moveVfxAnchors'
import { animationProgress, clamp01, easeInOutCubic, easeOutCubic, pulse01 } from './moveVfxTiming'
import { disposeObject3D } from './resourceDisposal'

export interface MoveVfxRendererSyncContext {
  /** Live token render objects used by later primitives to resolve event anchors. */
  renderObjects?: ReadonlyMap<string, PokemonRenderObject>
  /** Resolved VFX visibility. Later tickets will connect this to map layer state. */
  visible?: boolean
}

export interface MoveVfxRendererFrameContext {
  /** Scheduler-provided frame timestamp in milliseconds. */
  frameNowMs: number
  /** Scheduler-provided delta in seconds. */
  delta: number
  /** Optional Three.js clock elapsed time for primitives that need phase offsets. */
  elapsedTime?: number
  /** Active camera for billboarding or camera-facing primitives. */
  camera?: THREE.Camera
  /** Live token render objects used by later primitives to refresh anchors. */
  renderObjects?: ReadonlyMap<string, PokemonRenderObject>
  /** Resolved VFX visibility for the current frame. */
  visible?: boolean
}

export interface MoveVfxRendererOptions {
  scene: THREE.Scene
  group?: THREE.Group
}

export interface MoveVfxDebugSnapshot {
  /** Active lifecycle instances that can keep the scheduler alive. */
  activeCount: number
  /** Root child groups owned by active instances; useful for spotting cleanup drift. */
  instanceGroupCount: number
  /** Whether the renderer currently reports the move-vfx continuation source as needed. */
  needsAnimationFrame: boolean
  /** Current root-group visibility after layer and lifecycle rules are applied. */
  visible: boolean
  /** Last resolved layer-visibility input supplied by the grid. */
  layerVisible: boolean
  /** Whether the renderer has been disposed. */
  disposed: boolean
}

export interface MoveVfxRenderer {
  /** Dedicated root object for all transient move VFX render objects. */
  readonly group: THREE.Group
  sync(events: readonly MoveAnimationEvent[], context?: MoveVfxRendererSyncContext): void
  animate(frameContext: MoveVfxRendererFrameContext): void
  needsAnimationFrame(): boolean
  activeCount(): number
  /**
   * Cheap, allocation-on-demand developer snapshot for render metrics and dev
   * console inspection. Production frame paths should avoid calling this unless
   * explicit render-debug instrumentation is enabled.
   */
  debugSnapshot(): MoveVfxDebugSnapshot
  /**
   * Wall-clock hidden-tab expiry hook. Hidden tabs pause the scheduler, but
   * move VFX remain transient; expired instances are disposed before the first
   * resumed render so they do not jump to a final catch-up frame.
   */
  expireCompleted(nowMs: number): number
  dispose(): void
}

const MOVE_VFX_GROUP_NAME = 'move-vfx-root'
const MOVE_VFX_INSTANCE_GROUP_PREFIX = 'move-vfx-instance'
const MOVE_VFX_PROJECTILE_CORE_NAME = 'move-vfx-projectile-core'
const MOVE_VFX_PROJECTILE_GLOW_NAME = 'move-vfx-projectile-glow'
const MOVE_VFX_PROJECTILE_TRAIL_SEGMENT_PREFIX = 'move-vfx-projectile-trail'
const MOVE_VFX_PROJECTILE_RENDER_ORDER = 34
const MOVE_VFX_PROJECTILE_TRAIL_RENDER_ORDER = MOVE_VFX_PROJECTILE_RENDER_ORDER - 1
const MOVE_VFX_PROJECTILE_MIN_RADIUS = 0.12
const MOVE_VFX_PROJECTILE_DEFAULT_RADIUS = 0.16
const MOVE_VFX_PROJECTILE_MAX_RADIUS = 0.36
const MOVE_VFX_PROJECTILE_RADIUS_SCALE = 0.14
const MOVE_VFX_PROJECTILE_FADE_IN_PROGRESS = 0.12
const MOVE_VFX_PROJECTILE_FADE_OUT_START = 0.78
const MOVE_VFX_PROJECTILE_TRAIL_SEGMENT_COUNT = 4
const MOVE_VFX_PROJECTILE_TRAIL_PROGRESS_SPACING = 0.055
const MOVE_VFX_PROJECTILE_TRAIL_MAX_OPACITY = 0.28
const MOVE_VFX_PROJECTILE_TRAIL_NEAR_SCALE = 0.7
const MOVE_VFX_PROJECTILE_TRAIL_FAR_SCALE = 0.34
const MOVE_VFX_ARC_CORE_NAME = 'move-vfx-arc-core'
const MOVE_VFX_ARC_GLOW_NAME = 'move-vfx-arc-glow'
const MOVE_VFX_ARC_TRAIL_SEGMENT_PREFIX = 'move-vfx-arc-trail'
const MOVE_VFX_ARC_MIN_HEIGHT = 0.35
const MOVE_VFX_ARC_DEFAULT_HEIGHT = 0.8
const MOVE_VFX_ARC_DISTANCE_HEIGHT_RATIO = 0.28
const MOVE_VFX_ARC_MAX_HEIGHT = 2.4
const MOVE_VFX_BEAM_CORE_NAME = 'move-vfx-beam-core'
const MOVE_VFX_BEAM_GLOW_NAME = 'move-vfx-beam-glow'
const MOVE_VFX_BEAM_IMPACT_RING_NAME = 'move-vfx-beam-impact-ring'
const MOVE_VFX_BEAM_RENDER_ORDER = 35
const MOVE_VFX_BEAM_IMPACT_RENDER_ORDER = MOVE_VFX_BEAM_RENDER_ORDER + 1
const MOVE_VFX_BEAM_MIN_RADIUS = 0.045
const MOVE_VFX_BEAM_DEFAULT_RADIUS = 0.075
const MOVE_VFX_BEAM_MAX_RADIUS = 0.16
const MOVE_VFX_BEAM_RADIUS_PROJECTILE_SCALE = 0.42
const MOVE_VFX_BEAM_GLOW_RADIUS_MULTIPLIER = 2.65
const MOVE_VFX_BEAM_MIN_LENGTH = 0.05
const MOVE_VFX_BEAM_FADE_IN_PROGRESS = 0.14
const MOVE_VFX_BEAM_FADE_OUT_START = 0.64
const MOVE_VFX_BEAM_MAX_CORE_OPACITY = 0.86
const MOVE_VFX_BEAM_MAX_GLOW_OPACITY = 0.3
const MOVE_VFX_BEAM_IMPACT_BASE_RADIUS_MULTIPLIER = 4.2
const MOVE_VFX_BEAM_IMPACT_MIN_RADIUS = 0.28
const MOVE_VFX_BEAM_IMPACT_MAX_RADIUS = 0.72
const MOVE_VFX_BEAM_IMPACT_START_PROGRESS = 0.16
const MOVE_VFX_BEAM_IMPACT_MAX_OPACITY = 0.42
const MOVE_VFX_MELEE_LUNGE_GHOST_NAME = 'move-vfx-melee-lunge-ghost'
const MOVE_VFX_MELEE_LUNGE_STREAK_NAME = 'move-vfx-melee-lunge-streak'
const MOVE_VFX_MELEE_LUNGE_IMPACT_RING_NAME = 'move-vfx-melee-lunge-impact-ring'
const MOVE_VFX_MELEE_LUNGE_RENDER_ORDER = 36
const MOVE_VFX_MELEE_LUNGE_STREAK_RENDER_ORDER = MOVE_VFX_MELEE_LUNGE_RENDER_ORDER - 1
const MOVE_VFX_MELEE_LUNGE_IMPACT_RENDER_ORDER = MOVE_VFX_MELEE_LUNGE_RENDER_ORDER + 1
const MOVE_VFX_MELEE_LUNGE_MIN_TARGET_DISTANCE = 0.08
const MOVE_VFX_MELEE_LUNGE_MIN_DISTANCE = 0.18
const MOVE_VFX_MELEE_LUNGE_MAX_DISTANCE = 0.85
const MOVE_VFX_MELEE_LUNGE_DISTANCE_RATIO = 0.42
const MOVE_VFX_MELEE_LUNGE_MAX_DISTANCE_RATIO = 0.48
const MOVE_VFX_MELEE_LUNGE_FADE_IN_PROGRESS = 0.12
const MOVE_VFX_MELEE_LUNGE_FADE_OUT_START = 0.82
const MOVE_VFX_MELEE_LUNGE_STREAK_MIN_LENGTH = 0.035
const MOVE_VFX_MELEE_LUNGE_GHOST_MAX_OPACITY = 0.36
const MOVE_VFX_MELEE_LUNGE_STREAK_MAX_OPACITY = 0.28
const MOVE_VFX_MELEE_LUNGE_IMPACT_START_PROGRESS = 0.38
const MOVE_VFX_MELEE_LUNGE_IMPACT_DURATION_PROGRESS = 0.42
const MOVE_VFX_MELEE_LUNGE_IMPACT_MAX_OPACITY = 0.48
const MOVE_VFX_MELEE_LUNGE_GHOST_RADIUS_MULTIPLIER = 1.45
const MOVE_VFX_MELEE_LUNGE_GHOST_HEIGHT_MULTIPLIER = 1.9
const MOVE_VFX_MELEE_LUNGE_STREAK_RADIUS_MULTIPLIER = 0.45
const MOVE_VFX_MELEE_LUNGE_IMPACT_RADIUS_MULTIPLIER = 2.5
const MOVE_VFX_SELF_PULSE_BASE_RING_NAME = 'move-vfx-self-pulse-base-ring'
const MOVE_VFX_SELF_PULSE_RISING_RING_NAME = 'move-vfx-self-pulse-rising-ring'
const MOVE_VFX_SELF_PULSE_SHELL_NAME = 'move-vfx-self-pulse-shell'
const MOVE_VFX_SELF_PULSE_BASE_RING_RENDER_ORDER = 36
const MOVE_VFX_SELF_PULSE_RISING_RING_RENDER_ORDER = 37
const MOVE_VFX_SELF_PULSE_SHELL_RENDER_ORDER = 38
const MOVE_VFX_SELF_PULSE_MIN_RADIUS = 0.42
const MOVE_VFX_SELF_PULSE_DEFAULT_RADIUS = 0.72
const MOVE_VFX_SELF_PULSE_MAX_RADIUS = 1.65
const MOVE_VFX_SELF_PULSE_RADIUS_SCALE = 0.72
const MOVE_VFX_SELF_PULSE_MIN_SHELL_HEIGHT = 0.52
const MOVE_VFX_SELF_PULSE_DEFAULT_SHELL_HEIGHT = 0.9
const MOVE_VFX_SELF_PULSE_MAX_SHELL_HEIGHT = 2.6
const MOVE_VFX_SELF_PULSE_SHELL_HEIGHT_SCALE = 0.68
const MOVE_VFX_SELF_PULSE_RING_Y_OFFSET = 0.05
const MOVE_VFX_SELF_PULSE_RISING_RING_MIN_HEIGHT_RATIO = 0.16
const MOVE_VFX_SELF_PULSE_RISING_RING_MAX_HEIGHT_RATIO = 0.86
const MOVE_VFX_SELF_PULSE_FADE_IN_PROGRESS = 0.16
const MOVE_VFX_SELF_PULSE_FADE_OUT_START = 0.72
const MOVE_VFX_SELF_PULSE_BASE_RING_MAX_OPACITY = 0.44
const MOVE_VFX_SELF_PULSE_RISING_RING_MAX_OPACITY = 0.36
const MOVE_VFX_SELF_PULSE_SHELL_MAX_OPACITY = 0.2
const MOVE_VFX_SELF_PULSE_BASE_RING_START_SCALE = 0.62
const MOVE_VFX_SELF_PULSE_BASE_RING_END_SCALE = 1.38
const MOVE_VFX_SELF_PULSE_RISING_RING_START_SCALE = 0.5
const MOVE_VFX_SELF_PULSE_RISING_RING_END_SCALE = 1.16
const MOVE_VFX_TARGET_FLASH_SHELL_NAME = 'move-vfx-target-flash-shell'
const MOVE_VFX_TARGET_FLASH_RING_NAME = 'move-vfx-target-flash-ring'
const MOVE_VFX_TARGET_FLASH_SHELL_RENDER_ORDER = 38
const MOVE_VFX_TARGET_FLASH_RING_RENDER_ORDER = MOVE_VFX_TARGET_FLASH_SHELL_RENDER_ORDER - 1
const MOVE_VFX_TARGET_FLASH_MIN_RADIUS = 0.38
const MOVE_VFX_TARGET_FLASH_DEFAULT_RADIUS = 0.62
const MOVE_VFX_TARGET_FLASH_MAX_RADIUS = 1.45
const MOVE_VFX_TARGET_FLASH_RADIUS_SCALE = 0.62
const MOVE_VFX_TARGET_FLASH_MIN_HEIGHT = 0.48
const MOVE_VFX_TARGET_FLASH_DEFAULT_HEIGHT = 0.72
const MOVE_VFX_TARGET_FLASH_MAX_HEIGHT = 2.4
const MOVE_VFX_TARGET_FLASH_HEIGHT_SCALE = 0.52
const MOVE_VFX_TARGET_FLASH_RING_Y_OFFSET = 0.035
const MOVE_VFX_TARGET_FLASH_FADE_IN_PROGRESS = 0.14
const MOVE_VFX_TARGET_FLASH_FADE_OUT_START = 0.68
const MOVE_VFX_TARGET_FLASH_SHELL_MAX_OPACITY = 0.24
const MOVE_VFX_TARGET_FLASH_RING_MAX_OPACITY = 0.48
const MOVE_VFX_IMPACT_RING_NAME = 'move-vfx-impact-ring'
const MOVE_VFX_IMPACT_RING_RENDER_ORDER = 37
const MOVE_VFX_IMPACT_RING_MIN_RADIUS = 0.34
const MOVE_VFX_IMPACT_RING_DEFAULT_RADIUS = 0.62
const MOVE_VFX_IMPACT_RING_MAX_RADIUS = 1.35
const MOVE_VFX_IMPACT_RING_RADIUS_SCALE = 0.58
const MOVE_VFX_IMPACT_RING_Y_OFFSET = 0.045
const MOVE_VFX_IMPACT_RING_FADE_IN_PROGRESS = 0.16
const MOVE_VFX_IMPACT_RING_FADE_OUT_START = 0.42
const MOVE_VFX_IMPACT_RING_MAX_OPACITY = 0.58
const MOVE_VFX_IMPACT_RING_START_SCALE = 0.58
const MOVE_VFX_IMPACT_RING_END_SCALE = 1.58
const MOVE_VFX_MISS_PUFF_RING_NAME = 'move-vfx-miss-puff-ring'
const MOVE_VFX_MISS_PUFF_CLOUD_PREFIX = 'move-vfx-miss-puff-cloud'
const MOVE_VFX_MISS_PUFF_RING_RENDER_ORDER = 36
const MOVE_VFX_MISS_PUFF_CLOUD_RENDER_ORDER = 37
const MOVE_VFX_MISS_PUFF_MIN_RADIUS = 0.22
const MOVE_VFX_MISS_PUFF_DEFAULT_RADIUS = 0.34
const MOVE_VFX_MISS_PUFF_MAX_RADIUS = 0.74
const MOVE_VFX_MISS_PUFF_RADIUS_SCALE = 0.32
const MOVE_VFX_MISS_PUFF_MIN_OFFSET = 0.26
const MOVE_VFX_MISS_PUFF_MAX_OFFSET = 0.64
const MOVE_VFX_MISS_PUFF_OFFSET_RATIO = 0.9
const MOVE_VFX_MISS_PUFF_RING_Y_OFFSET = 0.055
const MOVE_VFX_MISS_PUFF_FADE_IN_PROGRESS = 0.12
const MOVE_VFX_MISS_PUFF_FADE_OUT_START = 0.3
const MOVE_VFX_MISS_PUFF_RING_MAX_OPACITY = 0.3
const MOVE_VFX_MISS_PUFF_CLOUD_MAX_OPACITY = 0.22
const MOVE_VFX_MISS_PUFF_RING_START_SCALE = 0.46
const MOVE_VFX_MISS_PUFF_RING_END_SCALE = 1.28
const MOVE_VFX_MISS_PUFF_CLOUD_LAYOUT = [
  { x: 0, y: 0.38, z: 0, scale: 0.44, opacity: 1 },
  { x: 0.34, y: 0.48, z: -0.18, scale: 0.32, opacity: 0.72 },
  { x: -0.28, y: 0.44, z: 0.26, scale: 0.28, opacity: 0.62 },
] as const
const MOVE_VFX_CRIT_BURST_INNER_RING_NAME = 'move-vfx-crit-burst-inner-ring'
const MOVE_VFX_CRIT_BURST_OUTER_RING_NAME = 'move-vfx-crit-burst-outer-ring'
const MOVE_VFX_CRIT_BURST_SPOKE_PREFIX = 'move-vfx-crit-burst-spoke'
const MOVE_VFX_CRIT_BURST_RING_RENDER_ORDER = 39
const MOVE_VFX_CRIT_BURST_SPOKE_RENDER_ORDER = 40
const MOVE_VFX_CRIT_BURST_SPOKE_COUNT = 8
const MOVE_VFX_CRIT_BURST_MIN_RADIUS = 0.42
const MOVE_VFX_CRIT_BURST_DEFAULT_RADIUS = 0.74
const MOVE_VFX_CRIT_BURST_MAX_RADIUS = 1.52
const MOVE_VFX_CRIT_BURST_RADIUS_SCALE = 0.68
const MOVE_VFX_CRIT_BURST_DEFAULT_CENTER_HEIGHT = 0.82
const MOVE_VFX_CRIT_BURST_MIN_CENTER_HEIGHT = 0.58
const MOVE_VFX_CRIT_BURST_MAX_CENTER_HEIGHT = 1.75
const MOVE_VFX_CRIT_BURST_CENTER_HEIGHT_SCALE = 0.52
const MOVE_VFX_CRIT_BURST_RING_Y_OFFSET = 0.075
const MOVE_VFX_CRIT_BURST_FADE_IN_PROGRESS = 0.1
const MOVE_VFX_CRIT_BURST_FADE_OUT_START = 0.46
const MOVE_VFX_CRIT_BURST_INNER_RING_MAX_OPACITY = 0.68
const MOVE_VFX_CRIT_BURST_OUTER_RING_MAX_OPACITY = 0.42
const MOVE_VFX_CRIT_BURST_SPOKE_MAX_OPACITY = 0.78
const MOVE_VFX_CRIT_BURST_INNER_RING_START_SCALE = 0.32
const MOVE_VFX_CRIT_BURST_INNER_RING_END_SCALE = 1.12
const MOVE_VFX_CRIT_BURST_OUTER_RING_START_SCALE = 0.48
const MOVE_VFX_CRIT_BURST_OUTER_RING_END_SCALE = 1.75
const MOVE_VFX_CRIT_BURST_SPOKE_START_LENGTH = 0.3
const MOVE_VFX_CRIT_BURST_SPOKE_END_LENGTH = 0.94
const MOVE_VFX_CRIT_BURST_SPOKE_THICKNESS_RATIO = 0.035
const MOVE_VFX_CRIT_BURST_SPOKE_MIN_THICKNESS = 0.018
const MOVE_VFX_CRIT_BURST_SPOKE_MAX_THICKNESS = 0.055
const MOVE_VFX_CRIT_BURST_SPOKE_TWIST_RADIANS = Math.PI / 14
const MOVE_VFX_WORLD_UP = new THREE.Vector3(0, 1, 0)
const MOVE_VFX_WORLD_FORWARD = new THREE.Vector3(0, 0, 1)

const EMPTY_RENDER_OBJECTS = new Map<string, PokemonRenderObject>()

interface MoveVfxInstance {
  readonly id: string
  readonly group: THREE.Group
  readonly complete: boolean
  animate(context: MoveVfxRendererFrameContext): void
  dispose(): void
}

interface MoveVfxInstanceBuildContext {
  readonly event: MoveAnimationEvent
  readonly group: THREE.Group
  readonly syncContext: MoveVfxRendererSyncContext
}

type MoveVfxInstanceBuilder = (context: MoveVfxInstanceBuildContext) => MoveVfxInstance

const normalizeOptions = (
  sceneOrOptions: THREE.Scene | MoveVfxRendererOptions,
): MoveVfxRendererOptions => (
  sceneOrOptions instanceof THREE.Scene ? { scene: sceneOrOptions } : sceneOrOptions
)

const clampNumber = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const finitePositiveNumber = (value: number | undefined): number | null => (
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
)

const projectileRadiusForRenderObjects = (
  userRenderObject: PokemonRenderObject | undefined,
  targetRenderObject: PokemonRenderObject | undefined,
): number => {
  const dimensions = [
    userRenderObject?.base,
    userRenderObject?.width,
    userRenderObject?.height,
    userRenderObject?.clearance,
    targetRenderObject?.base,
    targetRenderObject?.width,
    targetRenderObject?.height,
    targetRenderObject?.clearance,
  ].map(finitePositiveNumber).filter((value): value is number => value !== null)

  if (!dimensions.length) return MOVE_VFX_PROJECTILE_DEFAULT_RADIUS

  const tokenScale = Math.max(...dimensions)
  return clampNumber(
    tokenScale * MOVE_VFX_PROJECTILE_RADIUS_SCALE,
    MOVE_VFX_PROJECTILE_MIN_RADIUS,
    MOVE_VFX_PROJECTILE_MAX_RADIUS,
  )
}

const createProjectileMaterial = (
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  color,
  transparent: true,
  opacity,
  depthTest: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
})

const createProjectileMesh = (
  name: string,
  material: THREE.MeshBasicMaterial,
  renderOrder = MOVE_VFX_PROJECTILE_RENDER_ORDER,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material)
  mesh.name = name
  mesh.renderOrder = renderOrder
  mesh.raycast = () => {}
  return mesh
}

const projectileTrailSegmentName = (
  index: number,
  prefix = MOVE_VFX_PROJECTILE_TRAIL_SEGMENT_PREFIX,
): string => `${prefix}-${index + 1}`

const createProjectileTrailSegments = (
  color: THREE.ColorRepresentation,
  prefix = MOVE_VFX_PROJECTILE_TRAIL_SEGMENT_PREFIX,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] => Array.from(
  { length: MOVE_VFX_PROJECTILE_TRAIL_SEGMENT_COUNT },
  (_, index) => createProjectileMesh(
    projectileTrailSegmentName(index, prefix),
    createProjectileMaterial(color, 0),
    MOVE_VFX_PROJECTILE_TRAIL_RENDER_ORDER,
  ),
)

const applyProjectileVisualState = (options: {
  group: THREE.Group
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  glow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  trailSegments: readonly THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[]
  start: THREE.Vector3
  end: THREE.Vector3
  radius: number
  progress: number
}) => {
  const progress = clamp01(options.progress)
  const travelProgress = easeInOutCubic(progress)
  const pulse = pulse01(progress)
  const fadeIn = Math.max(0.35, clamp01(progress / MOVE_VFX_PROJECTILE_FADE_IN_PROGRESS))
  const fadeOut = progress <= MOVE_VFX_PROJECTILE_FADE_OUT_START
    ? 1
    : clamp01((1 - progress) / (1 - MOVE_VFX_PROJECTILE_FADE_OUT_START))
  const opacityMultiplier = Math.min(fadeIn, fadeOut)

  options.group.position.lerpVectors(options.start, options.end, travelProgress)
  options.core.scale.setScalar(options.radius * (0.95 + (pulse * 0.16)))
  options.glow.scale.setScalar(options.radius * (1.85 + (pulse * 0.28)))
  options.core.material.opacity = 0.95 * opacityMultiplier
  options.glow.material.opacity = 0.32 * opacityMultiplier

  const trailScaleDivisor = Math.max(1, options.trailSegments.length - 1)
  options.trailSegments.forEach((segment, index) => {
    const rawTrailProgress = progress - ((index + 1) * MOVE_VFX_PROJECTILE_TRAIL_PROGRESS_SPACING)
    const visibleProgress = clamp01(rawTrailProgress / MOVE_VFX_PROJECTILE_TRAIL_PROGRESS_SPACING)
    const scaleT = index / trailScaleDivisor
    const scaleMultiplier = MOVE_VFX_PROJECTILE_TRAIL_NEAR_SCALE
      + ((MOVE_VFX_PROJECTILE_TRAIL_FAR_SCALE - MOVE_VFX_PROJECTILE_TRAIL_NEAR_SCALE) * scaleT)
    const distanceFade = 1 - (index / (options.trailSegments.length + 1))
    const opacity = MOVE_VFX_PROJECTILE_TRAIL_MAX_OPACITY * opacityMultiplier * visibleProgress * distanceFade

    segment.position
      .copy(options.start)
      .lerp(options.end, easeInOutCubic(clamp01(rawTrailProgress)))
      .sub(options.group.position)
    segment.scale.setScalar(options.radius * scaleMultiplier)
    segment.material.opacity = opacity
    segment.visible = opacity > 0.005
  })
}

const horizontalDistanceBetween = (start: THREE.Vector3, end: THREE.Vector3): number => Math.hypot(
  end.x - start.x,
  end.z - start.z,
)

const arcHeightForDistance = (distance: number, requestedHeight?: number): number => {
  const requested = finitePositiveNumber(requestedHeight)
  if (requested !== null) {
    return clampNumber(requested, MOVE_VFX_ARC_MIN_HEIGHT, MOVE_VFX_ARC_MAX_HEIGHT)
  }

  const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0
  return clampNumber(
    Math.max(MOVE_VFX_ARC_DEFAULT_HEIGHT, safeDistance * MOVE_VFX_ARC_DISTANCE_HEIGHT_RATIO),
    MOVE_VFX_ARC_MIN_HEIGHT,
    MOVE_VFX_ARC_MAX_HEIGHT,
  )
}

const arcVerticalOffset = (travelProgress: number, arcHeight: number): number => (
  Math.sin(clamp01(travelProgress) * Math.PI) * arcHeight
)

const applyArcProjectileVisualState = (options: {
  group: THREE.Group
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  glow: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  trailSegments: readonly THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[]
  start: THREE.Vector3
  end: THREE.Vector3
  radius: number
  arcHeight: number
  progress: number
}) => {
  const progress = clamp01(options.progress)
  const travelProgress = easeInOutCubic(progress)
  const pulse = pulse01(progress)
  const fadeIn = Math.max(0.35, clamp01(progress / MOVE_VFX_PROJECTILE_FADE_IN_PROGRESS))
  const fadeOut = progress <= MOVE_VFX_PROJECTILE_FADE_OUT_START
    ? 1
    : clamp01((1 - progress) / (1 - MOVE_VFX_PROJECTILE_FADE_OUT_START))
  const opacityMultiplier = Math.min(fadeIn, fadeOut)

  options.group.position.lerpVectors(options.start, options.end, travelProgress)
  options.group.position.y += arcVerticalOffset(travelProgress, options.arcHeight)
  options.core.scale.setScalar(options.radius * (0.95 + (pulse * 0.16)))
  options.glow.scale.setScalar(options.radius * (1.85 + (pulse * 0.28)))
  options.core.material.opacity = 0.95 * opacityMultiplier
  options.glow.material.opacity = 0.32 * opacityMultiplier

  const trailScaleDivisor = Math.max(1, options.trailSegments.length - 1)
  options.trailSegments.forEach((segment, index) => {
    const rawTrailProgress = progress - ((index + 1) * MOVE_VFX_PROJECTILE_TRAIL_PROGRESS_SPACING)
    const visibleProgress = clamp01(rawTrailProgress / MOVE_VFX_PROJECTILE_TRAIL_PROGRESS_SPACING)
    const scaleT = index / trailScaleDivisor
    const scaleMultiplier = MOVE_VFX_PROJECTILE_TRAIL_NEAR_SCALE
      + ((MOVE_VFX_PROJECTILE_TRAIL_FAR_SCALE - MOVE_VFX_PROJECTILE_TRAIL_NEAR_SCALE) * scaleT)
    const distanceFade = 1 - (index / (options.trailSegments.length + 1))
    const opacity = MOVE_VFX_PROJECTILE_TRAIL_MAX_OPACITY * opacityMultiplier * visibleProgress * distanceFade
    const segmentTravelProgress = easeInOutCubic(clamp01(rawTrailProgress))

    segment.position
      .copy(options.start)
      .lerp(options.end, segmentTravelProgress)
    segment.position.y += arcVerticalOffset(segmentTravelProgress, options.arcHeight)
    segment.position.sub(options.group.position)
    segment.scale.setScalar(options.radius * scaleMultiplier)
    segment.material.opacity = opacity
    segment.visible = opacity > 0.005
  })
}

const firstProjectileTargetId = (event: MoveProjectileAnimationEvent): string | undefined => (
  event.targetId ?? event.targetIds?.[0]
)

const firstArcTargetId = (event: MoveArcAnimationEvent): string | undefined => (
  event.targetId ?? event.targetIds?.[0]
)

const firstBeamTargetId = (event: MoveBeamAnimationEvent): string | undefined => (
  event.targetId ?? event.targetIds?.[0]
)

const firstMeleeLungeTargetId = (event: MoveMeleeLungeAnimationEvent): string | undefined => (
  event.targetId ?? event.targetIds?.[0]
)

const firstTargetFlashTargetId = (event: MoveTargetFlashAnimationEvent): string | undefined => (
  event.targetId ?? event.targetIds?.[0]
)

const firstImpactRingTargetId = (event: MoveImpactRingAnimationEvent): string | undefined => (
  event.targetId ?? event.targetIds?.[0]
)

const firstMissTargetId = (event: MoveMissAnimationEvent): string | undefined => (
  event.targetId ?? event.targetIds?.[0]
)

const firstCritTargetId = (event: MoveCritAnimationEvent): string | undefined => (
  event.targetId ?? event.targetIds?.[0]
)

const beamRadiusForRenderObjects = (
  userRenderObject: PokemonRenderObject | undefined,
  targetRenderObject: PokemonRenderObject | undefined,
): number => clampNumber(
  projectileRadiusForRenderObjects(userRenderObject, targetRenderObject) * MOVE_VFX_BEAM_RADIUS_PROJECTILE_SCALE,
  MOVE_VFX_BEAM_MIN_RADIUS,
  MOVE_VFX_BEAM_MAX_RADIUS,
)

const createBeamMaterial = (
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  color,
  transparent: true,
  opacity,
  depthTest: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  toneMapped: false,
})

const createBeamCylinderMesh = (
  name: string,
  material: THREE.MeshBasicMaterial,
): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 16, 1, false), material)
  mesh.name = name
  mesh.renderOrder = MOVE_VFX_BEAM_RENDER_ORDER
  mesh.raycast = () => {}
  return mesh
}

const createImpactRingMaterial = (
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  color,
  transparent: true,
  opacity,
  depthTest: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  toneMapped: false,
})

const createImpactRingMesh = (
  name: string,
  material: THREE.MeshBasicMaterial,
  renderOrder = MOVE_VFX_IMPACT_RING_RENDER_ORDER,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 40), material)
  mesh.name = name
  mesh.renderOrder = renderOrder
  mesh.rotation.x = -Math.PI / 2
  mesh.visible = false
  mesh.raycast = () => {}
  return mesh
}

const createBeamImpactRingMesh = (
  material: THREE.MeshBasicMaterial,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => createImpactRingMesh(
  MOVE_VFX_BEAM_IMPACT_RING_NAME,
  material,
  MOVE_VFX_BEAM_IMPACT_RENDER_ORDER,
)

const resolveBeamAnchorPair = (
  event: MoveBeamAnimationEvent,
  renderObjects: ReadonlyMap<string, PokemonRenderObject>,
): { start: THREE.Vector3, end: THREE.Vector3 } | null => {
  const targetId = firstBeamTargetId(event)
  const start = resolveMoveVfxTokenAnchor({
    renderObjects,
    tokenId: event.userId,
    anchor: MOVE_VFX_TOKEN_ANCHOR.chest,
    fallbackCell: event.originCell,
  })
  let end = resolveMoveVfxTokenAnchor({
    renderObjects,
    tokenId: targetId,
    anchor: MOVE_VFX_TOKEN_ANCHOR.chest,
    fallbackCell: event.targetCell,
  })

  if (!end) {
    end = moveVfxAreaCentroidAnchor(event.areaCells, event.areaOrigin ?? event.targetCell)
  }

  return start && end ? { start, end } : null
}

const createBeamTransform = (start: THREE.Vector3, end: THREE.Vector3) => {
  const direction = new THREE.Vector3().subVectors(end, start)
  const length = direction.length()
  if (length < MOVE_VFX_BEAM_MIN_LENGTH) return null

  return {
    midpoint: new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5),
    quaternion: new THREE.Quaternion().setFromUnitVectors(MOVE_VFX_WORLD_UP, direction.clone().normalize()),
    length,
  }
}

const beamOpacityMultiplier = (progress: number): number => {
  const fadeIn = clamp01(progress / MOVE_VFX_BEAM_FADE_IN_PROGRESS)
  const fadeOut = progress <= MOVE_VFX_BEAM_FADE_OUT_START
    ? 1
    : clamp01((1 - progress) / (1 - MOVE_VFX_BEAM_FADE_OUT_START))
  return Math.min(fadeIn, fadeOut)
}

const applyBeamVisualState = (options: {
  group: THREE.Group
  core: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
  glow: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
  impactRing?: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  midpoint: THREE.Vector3
  quaternion: THREE.Quaternion
  length: number
  radius: number
  impactRadius: number
  progress: number
}) => {
  const progress = clamp01(options.progress)
  const opacityMultiplier = beamOpacityMultiplier(progress)
  const pulse = pulse01(progress)
  const thicknessPulse = 0.82 + (pulse * 0.34)
  const coreRadius = options.radius * thicknessPulse
  const glowRadius = options.radius * MOVE_VFX_BEAM_GLOW_RADIUS_MULTIPLIER * (0.9 + (pulse * 0.24))

  options.group.position.copy(options.midpoint)
  options.group.quaternion.copy(options.quaternion)
  options.core.scale.set(coreRadius, options.length, coreRadius)
  options.glow.scale.set(glowRadius, options.length, glowRadius)
  options.core.material.opacity = MOVE_VFX_BEAM_MAX_CORE_OPACITY * opacityMultiplier
  options.glow.material.opacity = MOVE_VFX_BEAM_MAX_GLOW_OPACITY * opacityMultiplier

  if (options.impactRing) {
    const impactProgress = easeOutCubic(clamp01(
      (progress - MOVE_VFX_BEAM_IMPACT_START_PROGRESS) / (1 - MOVE_VFX_BEAM_IMPACT_START_PROGRESS),
    ))
    const impactOpacity = MOVE_VFX_BEAM_IMPACT_MAX_OPACITY * opacityMultiplier * (1 - impactProgress)
    options.impactRing.position.set(0, options.length / 2, 0)
    options.impactRing.scale.setScalar(options.impactRadius * (0.65 + (impactProgress * 1.25)))
    options.impactRing.material.opacity = impactOpacity
    options.impactRing.visible = impactOpacity > 0.005
  }
}

const meleeLungeRadiusForRenderObjects = (
  userRenderObject: PokemonRenderObject | undefined,
  targetRenderObject: PokemonRenderObject | undefined,
): {
  ghostRadius: number
  ghostHeight: number
  streakRadius: number
  impactRadius: number
} => {
  const baseRadius = projectileRadiusForRenderObjects(userRenderObject, targetRenderObject)

  return {
    ghostRadius: clampNumber(baseRadius * MOVE_VFX_MELEE_LUNGE_GHOST_RADIUS_MULTIPLIER, 0.18, 0.56),
    ghostHeight: clampNumber(baseRadius * MOVE_VFX_MELEE_LUNGE_GHOST_HEIGHT_MULTIPLIER, 0.24, 0.78),
    streakRadius: clampNumber(baseRadius * MOVE_VFX_MELEE_LUNGE_STREAK_RADIUS_MULTIPLIER, 0.05, 0.18),
    impactRadius: clampNumber(baseRadius * MOVE_VFX_MELEE_LUNGE_IMPACT_RADIUS_MULTIPLIER, 0.32, 0.86),
  }
}

const createMeleeLungeMaterial = (
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  color,
  transparent: true,
  opacity,
  depthTest: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  toneMapped: false,
})

const createMeleeLungeGhostMesh = (
  material: THREE.MeshBasicMaterial,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 8), material)
  mesh.name = MOVE_VFX_MELEE_LUNGE_GHOST_NAME
  mesh.renderOrder = MOVE_VFX_MELEE_LUNGE_RENDER_ORDER
  mesh.raycast = () => {}
  return mesh
}

const createMeleeLungeStreakMesh = (
  material: THREE.MeshBasicMaterial,
): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12, 1, false), material)
  mesh.name = MOVE_VFX_MELEE_LUNGE_STREAK_NAME
  mesh.renderOrder = MOVE_VFX_MELEE_LUNGE_STREAK_RENDER_ORDER
  mesh.visible = false
  mesh.raycast = () => {}
  return mesh
}

const createMeleeLungeImpactRingMesh = (
  material: THREE.MeshBasicMaterial,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => createImpactRingMesh(
  MOVE_VFX_MELEE_LUNGE_IMPACT_RING_NAME,
  material,
  MOVE_VFX_MELEE_LUNGE_IMPACT_RENDER_ORDER,
)

const meleeLungeOpacityMultiplier = (progress: number): number => {
  const fadeIn = clamp01(progress / MOVE_VFX_MELEE_LUNGE_FADE_IN_PROGRESS)
  const fadeOut = progress <= MOVE_VFX_MELEE_LUNGE_FADE_OUT_START
    ? 1
    : clamp01((1 - progress) / (1 - MOVE_VFX_MELEE_LUNGE_FADE_OUT_START))

  return Math.min(fadeIn, fadeOut)
}

const resolveMeleeLungeAnchors = (
  event: MoveMeleeLungeAnimationEvent,
  renderObjects: ReadonlyMap<string, PokemonRenderObject>,
): {
  start: THREE.Vector3
  impact: THREE.Vector3
  direction: THREE.Vector3
  directionQuaternion: THREE.Quaternion
  lungeDistance: number
} | null => {
  const targetId = firstMeleeLungeTargetId(event)
  const anchors = resolveMoveVfxAnchorPair({
    renderObjects,
    userId: event.userId,
    targetId,
    originCell: event.originCell,
    targetCell: event.targetCell,
    userAnchor: MOVE_VFX_TOKEN_ANCHOR.chest,
    targetAnchor: MOVE_VFX_TOKEN_ANCHOR.chest,
  })

  if (!anchors) return null

  const horizontalDirection = new THREE.Vector3(
    anchors.end.x - anchors.start.x,
    0,
    anchors.end.z - anchors.start.z,
  )
  const targetDistance = horizontalDirection.length()
  if (targetDistance < MOVE_VFX_MELEE_LUNGE_MIN_TARGET_DISTANCE) return null

  const direction = horizontalDirection.multiplyScalar(1 / targetDistance)
  const lungeDistance = Math.min(
    clampNumber(
      targetDistance * MOVE_VFX_MELEE_LUNGE_DISTANCE_RATIO,
      MOVE_VFX_MELEE_LUNGE_MIN_DISTANCE,
      MOVE_VFX_MELEE_LUNGE_MAX_DISTANCE,
    ),
    targetDistance * MOVE_VFX_MELEE_LUNGE_MAX_DISTANCE_RATIO,
  )
  const impact = resolveMoveVfxTokenAnchor({
    renderObjects,
    tokenId: targetId,
    anchor: MOVE_VFX_TOKEN_ANCHOR.foot,
    fallbackCell: event.targetCell,
  }) ?? anchors.end

  return {
    start: anchors.start.clone(),
    impact: impact.clone(),
    direction: direction.clone(),
    directionQuaternion: new THREE.Quaternion().setFromUnitVectors(MOVE_VFX_WORLD_FORWARD, direction),
    lungeDistance,
  }
}

const applyMeleeLungeVisualState = (options: {
  ghost: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  streak: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
  impactRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  start: THREE.Vector3
  impact: THREE.Vector3
  direction: THREE.Vector3
  directionQuaternion: THREE.Quaternion
  lungeDistance: number
  ghostRadius: number
  ghostHeight: number
  streakRadius: number
  impactRadius: number
  progress: number
}) => {
  const progress = clamp01(options.progress)
  const opacityMultiplier = meleeLungeOpacityMultiplier(progress)
  const lungeProgress = Math.sin(progress * Math.PI)
  const pulse = pulse01(progress)
  const travelDistance = options.lungeDistance * lungeProgress

  options.ghost.position.copy(options.start).addScaledVector(options.direction, travelDistance)
  options.ghost.quaternion.copy(options.directionQuaternion)
  options.ghost.scale.set(
    options.ghostRadius * (1 + (pulse * 0.1)),
    options.ghostHeight * (0.9 + (lungeProgress * 0.16)),
    options.ghostRadius * (0.72 + (lungeProgress * 0.35)),
  )
  options.ghost.material.opacity = MOVE_VFX_MELEE_LUNGE_GHOST_MAX_OPACITY
    * opacityMultiplier
    * (0.32 + (lungeProgress * 0.68))
  options.ghost.visible = options.ghost.material.opacity > 0.005

  if (travelDistance > MOVE_VFX_MELEE_LUNGE_STREAK_MIN_LENGTH) {
    options.streak.position.copy(options.start).addScaledVector(options.direction, travelDistance * 0.5)
    options.streak.quaternion.copy(options.directionQuaternion)
    options.streak.scale.set(options.streakRadius, travelDistance, options.streakRadius)
    options.streak.material.opacity = MOVE_VFX_MELEE_LUNGE_STREAK_MAX_OPACITY * opacityMultiplier * lungeProgress
    options.streak.visible = options.streak.material.opacity > 0.005
  } else {
    options.streak.material.opacity = 0
    options.streak.visible = false
  }

  const rawImpactProgress = clamp01(
    (progress - MOVE_VFX_MELEE_LUNGE_IMPACT_START_PROGRESS)
    / MOVE_VFX_MELEE_LUNGE_IMPACT_DURATION_PROGRESS,
  )
  const impactProgress = easeOutCubic(rawImpactProgress)
  const impactFadeIn = clamp01(rawImpactProgress / 0.18)
  const impactOpacity = MOVE_VFX_MELEE_LUNGE_IMPACT_MAX_OPACITY
    * impactFadeIn
    * (1 - rawImpactProgress)

  options.impactRing.position.copy(options.impact)
  options.impactRing.scale.setScalar(options.impactRadius * (0.58 + (impactProgress * 0.88)))
  options.impactRing.material.opacity = impactOpacity
  options.impactRing.visible = impactOpacity > 0.005
}

const selfPulsePaletteForEvent = (event: MoveSelfPulseAnimationEvent): MoveVfxPaletteEntry => (
  event.tone == null
    ? event.palette ?? DEFAULT_MOVE_VFX_COLOR
    : moveVfxColorForTone(event.tone)
)

const selfPulseDimensionsForRenderObject = (
  renderObject: PokemonRenderObject | undefined,
): { radius: number, shellHeight: number } => {
  const footprint = Math.max(
    finitePositiveNumber(renderObject?.base) ?? 0,
    finitePositiveNumber(renderObject?.width) ?? 0,
  )
  const bodyHeight = Math.max(
    finitePositiveNumber(renderObject?.height) ?? 0,
    finitePositiveNumber(renderObject?.clearance) ?? 0,
  )

  return {
    radius: footprint > 0
      ? clampNumber(
        footprint * MOVE_VFX_SELF_PULSE_RADIUS_SCALE,
        MOVE_VFX_SELF_PULSE_MIN_RADIUS,
        MOVE_VFX_SELF_PULSE_MAX_RADIUS,
      )
      : MOVE_VFX_SELF_PULSE_DEFAULT_RADIUS,
    shellHeight: bodyHeight > 0
      ? clampNumber(
        bodyHeight * MOVE_VFX_SELF_PULSE_SHELL_HEIGHT_SCALE,
        MOVE_VFX_SELF_PULSE_MIN_SHELL_HEIGHT,
        MOVE_VFX_SELF_PULSE_MAX_SHELL_HEIGHT,
      )
      : MOVE_VFX_SELF_PULSE_DEFAULT_SHELL_HEIGHT,
  }
}

const resolveSelfPulseAnchor = (
  event: MoveSelfPulseAnimationEvent,
  renderObjects: ReadonlyMap<string, PokemonRenderObject>,
): { foot: THREE.Vector3, radius: number, shellHeight: number } | null => {
  const userRenderObject = renderObjects.get(event.userId)
  const foot = resolveMoveVfxTokenAnchor({
    renderObjects,
    tokenId: event.userId,
    anchor: MOVE_VFX_TOKEN_ANCHOR.foot,
    fallbackCell: event.originCell,
  })

  return foot
    ? { foot: foot.clone(), ...selfPulseDimensionsForRenderObject(userRenderObject) }
    : null
}

const createSelfPulseMaterial = (
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  color,
  transparent: true,
  opacity,
  depthTest: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  toneMapped: false,
})

const createSelfPulseRingMesh = (
  name: string,
  material: THREE.MeshBasicMaterial,
  renderOrder: number,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 48), material)
  mesh.name = name
  mesh.renderOrder = renderOrder
  mesh.rotation.x = -Math.PI / 2
  mesh.raycast = () => {}
  return mesh
}

const createSelfPulseShellMesh = (
  material: THREE.MeshBasicMaterial,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10), material)
  mesh.name = MOVE_VFX_SELF_PULSE_SHELL_NAME
  mesh.renderOrder = MOVE_VFX_SELF_PULSE_SHELL_RENDER_ORDER
  mesh.raycast = () => {}
  return mesh
}

const selfPulseOpacityMultiplier = (progress: number): number => {
  const fadeIn = Math.max(0.28, clamp01(progress / MOVE_VFX_SELF_PULSE_FADE_IN_PROGRESS))
  const fadeOut = progress <= MOVE_VFX_SELF_PULSE_FADE_OUT_START
    ? 1
    : clamp01((1 - progress) / (1 - MOVE_VFX_SELF_PULSE_FADE_OUT_START))

  return Math.min(fadeIn, fadeOut)
}

const applySelfPulseVisualState = (options: {
  group: THREE.Group
  baseRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  risingRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  shell: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  foot: THREE.Vector3
  radius: number
  shellHeight: number
  progress: number
}) => {
  const progress = clamp01(options.progress)
  const expansion = easeOutCubic(progress)
  const risingProgress = easeInOutCubic(progress)
  const pulse = pulse01(progress)
  const opacityMultiplier = selfPulseOpacityMultiplier(progress)
  const baseOpacity = MOVE_VFX_SELF_PULSE_BASE_RING_MAX_OPACITY
    * opacityMultiplier
    * Math.max(0, 1 - (progress * 0.46))
  const risingOpacity = MOVE_VFX_SELF_PULSE_RISING_RING_MAX_OPACITY
    * opacityMultiplier
    * Math.max(0, 1 - (progress * 0.74))
  const shellOpacity = MOVE_VFX_SELF_PULSE_SHELL_MAX_OPACITY
    * opacityMultiplier
    * (0.64 + (pulse * 0.36))
    * Math.max(0, 1 - (progress * 0.24))
  const risingHeight = options.shellHeight * (
    MOVE_VFX_SELF_PULSE_RISING_RING_MIN_HEIGHT_RATIO
    + ((MOVE_VFX_SELF_PULSE_RISING_RING_MAX_HEIGHT_RATIO - MOVE_VFX_SELF_PULSE_RISING_RING_MIN_HEIGHT_RATIO) * risingProgress)
  )

  options.group.position.copy(options.foot)

  options.baseRing.position.set(0, MOVE_VFX_SELF_PULSE_RING_Y_OFFSET, 0)
  options.baseRing.scale.setScalar(options.radius * (
    MOVE_VFX_SELF_PULSE_BASE_RING_START_SCALE
    + ((MOVE_VFX_SELF_PULSE_BASE_RING_END_SCALE - MOVE_VFX_SELF_PULSE_BASE_RING_START_SCALE) * expansion)
  ))
  options.baseRing.material.opacity = baseOpacity
  options.baseRing.visible = baseOpacity > 0.005

  options.risingRing.position.set(0, MOVE_VFX_SELF_PULSE_RING_Y_OFFSET + risingHeight, 0)
  options.risingRing.scale.setScalar(options.radius * (
    MOVE_VFX_SELF_PULSE_RISING_RING_START_SCALE
    + ((MOVE_VFX_SELF_PULSE_RISING_RING_END_SCALE - MOVE_VFX_SELF_PULSE_RISING_RING_START_SCALE) * expansion)
  ))
  options.risingRing.material.opacity = risingOpacity
  options.risingRing.visible = risingOpacity > 0.005

  options.shell.position.set(0, options.shellHeight / 2, 0)
  options.shell.scale.set(
    options.radius * (0.86 + (pulse * 0.16)),
    options.shellHeight * (0.92 + (pulse * 0.12)),
    options.radius * (0.86 + (pulse * 0.16)),
  )
  options.shell.material.opacity = shellOpacity
  options.shell.visible = shellOpacity > 0.005
}

type TargetFlashResolvedTone = 'hit'
  | typeof MOVE_VFX_TONE.healing
  | typeof MOVE_VFX_TONE.status
  | typeof MOVE_VFX_TONE.buff
  | typeof MOVE_VFX_TONE.debuff
  | typeof MOVE_VFX_TONE.neutral

const normalizeTargetFlashTone = (tone: unknown): TargetFlashResolvedTone => {
  const normalized = typeof tone === 'string' ? tone.trim().toLowerCase() : ''

  switch (normalized) {
    case 'hit':
    case 'damage':
    case 'damaging':
      return 'hit'
    case 'heal':
    case 'healing':
      return MOVE_VFX_TONE.healing
    case 'buff':
      return MOVE_VFX_TONE.buff
    case 'debuff':
      return MOVE_VFX_TONE.debuff
    case 'status':
      return MOVE_VFX_TONE.status
    case 'neutral':
      return MOVE_VFX_TONE.neutral
    default:
      return MOVE_VFX_TONE.neutral
  }
}

const targetFlashPaletteForEvent = (event: MoveTargetFlashAnimationEvent): MoveVfxPaletteEntry => {
  if (event.tone == null) return event.palette ?? DEFAULT_MOVE_VFX_COLOR

  const tone = normalizeTargetFlashTone(event.tone)
  return tone === 'hit'
    ? event.palette ?? DEFAULT_MOVE_VFX_COLOR
    : moveVfxColorForTone(tone)
}

const targetFlashDimensionsForRenderObject = (
  renderObject: PokemonRenderObject | undefined,
): { radius: number, shellHeight: number } => {
  const footprint = Math.max(
    finitePositiveNumber(renderObject?.base) ?? 0,
    finitePositiveNumber(renderObject?.width) ?? 0,
  )
  const bodyHeight = Math.max(
    finitePositiveNumber(renderObject?.height) ?? 0,
    finitePositiveNumber(renderObject?.clearance) ?? 0,
  )

  return {
    radius: footprint > 0
      ? clampNumber(
        footprint * MOVE_VFX_TARGET_FLASH_RADIUS_SCALE,
        MOVE_VFX_TARGET_FLASH_MIN_RADIUS,
        MOVE_VFX_TARGET_FLASH_MAX_RADIUS,
      )
      : MOVE_VFX_TARGET_FLASH_DEFAULT_RADIUS,
    shellHeight: bodyHeight > 0
      ? clampNumber(
        bodyHeight * MOVE_VFX_TARGET_FLASH_HEIGHT_SCALE,
        MOVE_VFX_TARGET_FLASH_MIN_HEIGHT,
        MOVE_VFX_TARGET_FLASH_MAX_HEIGHT,
      )
      : MOVE_VFX_TARGET_FLASH_DEFAULT_HEIGHT,
  }
}

const resolveTargetFlashAnchors = (
  event: MoveTargetFlashAnimationEvent,
  renderObjects: ReadonlyMap<string, PokemonRenderObject>,
): { foot: THREE.Vector3, shellCenter: THREE.Vector3, radius: number, shellHeight: number } | null => {
  const targetId = firstTargetFlashTargetId(event)
  const targetRenderObject = targetId ? renderObjects.get(targetId) : undefined
  const dimensions = targetFlashDimensionsForRenderObject(targetRenderObject)
  const foot = resolveMoveVfxTokenAnchor({
    renderObjects,
    tokenId: targetId,
    anchor: MOVE_VFX_TOKEN_ANCHOR.foot,
    fallbackCell: event.targetCell,
  })

  if (!foot) return null

  const tokenCenter = targetRenderObject
    ? resolveMoveVfxTokenAnchor({
      renderObjects,
      tokenId: targetId,
      anchor: MOVE_VFX_TOKEN_ANCHOR.center,
    })
    : null
  const shellCenter = tokenCenter ?? foot.clone().add(new THREE.Vector3(0, dimensions.shellHeight, 0))

  return {
    foot: foot.clone(),
    shellCenter: shellCenter.clone(),
    ...dimensions,
  }
}

const createTargetFlashMaterial = (
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  color,
  transparent: true,
  opacity,
  depthTest: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  toneMapped: false,
})

const createTargetFlashShellMesh = (
  material: THREE.MeshBasicMaterial,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10), material)
  mesh.name = MOVE_VFX_TARGET_FLASH_SHELL_NAME
  mesh.renderOrder = MOVE_VFX_TARGET_FLASH_SHELL_RENDER_ORDER
  mesh.raycast = () => {}
  return mesh
}

const createTargetFlashRingMesh = (
  material: THREE.MeshBasicMaterial,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 40), material)
  mesh.name = MOVE_VFX_TARGET_FLASH_RING_NAME
  mesh.renderOrder = MOVE_VFX_TARGET_FLASH_RING_RENDER_ORDER
  mesh.rotation.x = -Math.PI / 2
  mesh.raycast = () => {}
  return mesh
}

const targetFlashOpacityMultiplier = (progress: number): number => {
  const fadeIn = Math.max(0.32, clamp01(progress / MOVE_VFX_TARGET_FLASH_FADE_IN_PROGRESS))
  const fadeOut = progress <= MOVE_VFX_TARGET_FLASH_FADE_OUT_START
    ? 1
    : clamp01((1 - progress) / (1 - MOVE_VFX_TARGET_FLASH_FADE_OUT_START))

  return Math.min(fadeIn, fadeOut)
}

const applyTargetFlashVisualState = (options: {
  group: THREE.Group
  shell: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  foot: THREE.Vector3
  shellCenter: THREE.Vector3
  radius: number
  shellHeight: number
  progress: number
}) => {
  const progress = clamp01(options.progress)
  const expansion = easeOutCubic(progress)
  const pulse = pulse01(progress)
  const opacityMultiplier = targetFlashOpacityMultiplier(progress)
  const shellRadiusScale = options.radius * (0.86 + (expansion * 0.28) + (pulse * 0.12))
  const shellOpacity = MOVE_VFX_TARGET_FLASH_SHELL_MAX_OPACITY
    * opacityMultiplier
    * (0.65 + (pulse * 0.35))
  const ringOpacity = MOVE_VFX_TARGET_FLASH_RING_MAX_OPACITY
    * opacityMultiplier
    * Math.max(0, 1 - (progress * 0.45))

  options.group.position.copy(options.foot)
  options.shell.position.copy(options.shellCenter).sub(options.foot)
  options.shell.scale.set(
    shellRadiusScale,
    options.shellHeight * (0.92 + (pulse * 0.1)),
    shellRadiusScale,
  )
  options.shell.material.opacity = shellOpacity
  options.shell.visible = shellOpacity > 0.005

  options.ring.position.set(0, MOVE_VFX_TARGET_FLASH_RING_Y_OFFSET, 0)
  options.ring.scale.setScalar(options.radius * (0.72 + (expansion * 0.68)))
  options.ring.material.opacity = ringOpacity
  options.ring.visible = ringOpacity > 0.005
}

const impactRingPaletteForEvent = (event: MoveImpactRingAnimationEvent): MoveVfxPaletteEntry => {
  if (event.tone == null) return event.palette ?? DEFAULT_MOVE_VFX_COLOR

  const normalizedTone = typeof event.tone === 'string' ? event.tone.trim().toLowerCase() : ''
  if (normalizedTone === 'hit' || normalizedTone === 'damage' || normalizedTone === 'damaging') {
    return event.palette ?? DEFAULT_MOVE_VFX_COLOR
  }

  return moveVfxColorForTone(event.tone)
}

const impactRingRadiusForRenderObject = (
  renderObject: PokemonRenderObject | undefined,
): number => {
  const footprint = Math.max(
    finitePositiveNumber(renderObject?.base) ?? 0,
    finitePositiveNumber(renderObject?.width) ?? 0,
  )

  return footprint > 0
    ? clampNumber(
      footprint * MOVE_VFX_IMPACT_RING_RADIUS_SCALE,
      MOVE_VFX_IMPACT_RING_MIN_RADIUS,
      MOVE_VFX_IMPACT_RING_MAX_RADIUS,
    )
    : MOVE_VFX_IMPACT_RING_DEFAULT_RADIUS
}

const resolveImpactRingAnchor = (
  event: MoveImpactRingAnimationEvent,
  renderObjects: ReadonlyMap<string, PokemonRenderObject>,
): { foot: THREE.Vector3, radius: number } | null => {
  const targetId = firstImpactRingTargetId(event)
  const targetRenderObject = targetId ? renderObjects.get(targetId) : undefined
  const foot = resolveMoveVfxTokenAnchor({
    renderObjects,
    tokenId: targetId,
    anchor: MOVE_VFX_TOKEN_ANCHOR.foot,
    fallbackCell: event.targetCell,
  })

  return foot
    ? { foot: foot.clone(), radius: impactRingRadiusForRenderObject(targetRenderObject) }
    : null
}

const impactRingOpacityMultiplier = (progress: number): number => {
  const fadeIn = clamp01(progress / MOVE_VFX_IMPACT_RING_FADE_IN_PROGRESS)
  const fadeOut = progress <= MOVE_VFX_IMPACT_RING_FADE_OUT_START
    ? 1
    : clamp01((1 - progress) / (1 - MOVE_VFX_IMPACT_RING_FADE_OUT_START))

  return Math.min(fadeIn, fadeOut)
}

const applyImpactRingVisualState = (options: {
  group: THREE.Group
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  foot: THREE.Vector3
  radius: number
  progress: number
}) => {
  const progress = clamp01(options.progress)
  const expansion = easeOutCubic(progress)
  const opacity = MOVE_VFX_IMPACT_RING_MAX_OPACITY
    * impactRingOpacityMultiplier(progress)
    * Math.max(0, 1 - (progress * 0.72))

  options.group.position.copy(options.foot)
  options.ring.position.set(0, MOVE_VFX_IMPACT_RING_Y_OFFSET, 0)
  options.ring.scale.setScalar(options.radius * (
    MOVE_VFX_IMPACT_RING_START_SCALE
    + ((MOVE_VFX_IMPACT_RING_END_SCALE - MOVE_VFX_IMPACT_RING_START_SCALE) * expansion)
  ))
  options.ring.material.opacity = opacity
  options.ring.visible = opacity > 0.005
}

const missPuffRadiusForRenderObject = (
  renderObject: PokemonRenderObject | undefined,
): number => {
  const footprint = Math.max(
    finitePositiveNumber(renderObject?.base) ?? 0,
    finitePositiveNumber(renderObject?.width) ?? 0,
  )

  return footprint > 0
    ? clampNumber(
      footprint * MOVE_VFX_MISS_PUFF_RADIUS_SCALE,
      MOVE_VFX_MISS_PUFF_MIN_RADIUS,
      MOVE_VFX_MISS_PUFF_MAX_RADIUS,
    )
    : MOVE_VFX_MISS_PUFF_DEFAULT_RADIUS
}

const missPuffOffsetForRadius = (radius: number): number => clampNumber(
  radius * MOVE_VFX_MISS_PUFF_OFFSET_RATIO,
  MOVE_VFX_MISS_PUFF_MIN_OFFSET,
  MOVE_VFX_MISS_PUFF_MAX_OFFSET,
)

const resolveMissPuffAnchor = (
  event: MoveMissAnimationEvent,
  renderObjects: ReadonlyMap<string, PokemonRenderObject>,
): { foot: THREE.Vector3, radius: number } | null => {
  const targetId = firstMissTargetId(event)
  const targetRenderObject = targetId ? renderObjects.get(targetId) : undefined
  const targetFoot = resolveMoveVfxTokenAnchor({
    renderObjects,
    tokenId: targetId,
    anchor: MOVE_VFX_TOKEN_ANCHOR.foot,
    fallbackCell: event.targetCell,
  })

  if (!targetFoot) return null

  const userFoot = resolveMoveVfxTokenAnchor({
    renderObjects,
    tokenId: event.userId,
    anchor: MOVE_VFX_TOKEN_ANCHOR.foot,
  })
  const direction = userFoot
    ? new THREE.Vector3(targetFoot.x - userFoot.x, 0, targetFoot.z - userFoot.z)
    : MOVE_VFX_WORLD_FORWARD.clone()

  if (direction.lengthSq() < 0.0001) direction.copy(MOVE_VFX_WORLD_FORWARD)
  else direction.normalize()

  const radius = missPuffRadiusForRenderObject(targetRenderObject)
  const foot = targetFoot.clone().addScaledVector(direction, missPuffOffsetForRadius(radius))

  return { foot, radius }
}

const createMissPuffMaterial = (
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  color,
  transparent: true,
  opacity,
  depthTest: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  toneMapped: false,
})

const createMissPuffRingMesh = (
  material: THREE.MeshBasicMaterial,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 32), material)
  mesh.name = MOVE_VFX_MISS_PUFF_RING_NAME
  mesh.renderOrder = MOVE_VFX_MISS_PUFF_RING_RENDER_ORDER
  mesh.rotation.x = -Math.PI / 2
  mesh.visible = false
  mesh.raycast = () => {}
  return mesh
}

const createMissPuffCloudMesh = (
  index: number,
  material: THREE.MeshBasicMaterial,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), material)
  mesh.name = `${MOVE_VFX_MISS_PUFF_CLOUD_PREFIX}-${index + 1}`
  mesh.renderOrder = MOVE_VFX_MISS_PUFF_CLOUD_RENDER_ORDER
  mesh.visible = false
  mesh.raycast = () => {}
  return mesh
}

const missPuffOpacityMultiplier = (progress: number): number => {
  const fadeIn = clamp01(progress / MOVE_VFX_MISS_PUFF_FADE_IN_PROGRESS)
  const fadeOut = progress <= MOVE_VFX_MISS_PUFF_FADE_OUT_START
    ? 1
    : clamp01((1 - progress) / (1 - MOVE_VFX_MISS_PUFF_FADE_OUT_START))

  return Math.min(fadeIn, fadeOut)
}

const applyMissPuffVisualState = (options: {
  group: THREE.Group
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  clouds: readonly THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[]
  foot: THREE.Vector3
  radius: number
  progress: number
}) => {
  const progress = clamp01(options.progress)
  const expansion = easeOutCubic(progress)
  const opacityMultiplier = missPuffOpacityMultiplier(progress)
  const ringOpacity = MOVE_VFX_MISS_PUFF_RING_MAX_OPACITY
    * opacityMultiplier
    * Math.max(0, 1 - (progress * 0.58))

  options.group.position.copy(options.foot)
  options.ring.position.set(0, MOVE_VFX_MISS_PUFF_RING_Y_OFFSET, 0)
  options.ring.scale.setScalar(options.radius * (
    MOVE_VFX_MISS_PUFF_RING_START_SCALE
    + ((MOVE_VFX_MISS_PUFF_RING_END_SCALE - MOVE_VFX_MISS_PUFF_RING_START_SCALE) * expansion)
  ))
  options.ring.material.opacity = ringOpacity
  options.ring.visible = ringOpacity > 0.005

  options.clouds.forEach((cloud, index) => {
    const layout = MOVE_VFX_MISS_PUFF_CLOUD_LAYOUT[index] ?? MOVE_VFX_MISS_PUFF_CLOUD_LAYOUT[0]
    const drift = 0.72 + (expansion * 0.38)
    const cloudOpacity = MOVE_VFX_MISS_PUFF_CLOUD_MAX_OPACITY
      * opacityMultiplier
      * layout.opacity
      * Math.max(0, 1 - (progress * 0.72))

    cloud.position.set(
      layout.x * options.radius * drift,
      (layout.y + (expansion * 0.18)) * options.radius,
      layout.z * options.radius * drift,
    )
    cloud.scale.setScalar(options.radius * layout.scale * (0.78 + (expansion * 0.5)))
    cloud.material.opacity = cloudOpacity
    cloud.visible = cloudOpacity > 0.005
  })
}

const critBurstRadiusForRenderObject = (
  renderObject: PokemonRenderObject | undefined,
): number => {
  const footprint = Math.max(
    finitePositiveNumber(renderObject?.base) ?? 0,
    finitePositiveNumber(renderObject?.width) ?? 0,
  )

  return footprint > 0
    ? clampNumber(
      footprint * MOVE_VFX_CRIT_BURST_RADIUS_SCALE,
      MOVE_VFX_CRIT_BURST_MIN_RADIUS,
      MOVE_VFX_CRIT_BURST_MAX_RADIUS,
    )
    : MOVE_VFX_CRIT_BURST_DEFAULT_RADIUS
}

const critBurstCenterHeightForRenderObject = (
  renderObject: PokemonRenderObject | undefined,
): number => {
  const bodyHeight = Math.max(
    finitePositiveNumber(renderObject?.height) ?? 0,
    finitePositiveNumber(renderObject?.clearance) ?? 0,
  )

  return bodyHeight > 0
    ? clampNumber(
      bodyHeight * MOVE_VFX_CRIT_BURST_CENTER_HEIGHT_SCALE,
      MOVE_VFX_CRIT_BURST_MIN_CENTER_HEIGHT,
      MOVE_VFX_CRIT_BURST_MAX_CENTER_HEIGHT,
    )
    : MOVE_VFX_CRIT_BURST_DEFAULT_CENTER_HEIGHT
}

const resolveCritBurstAnchor = (
  event: MoveCritAnimationEvent,
  renderObjects: ReadonlyMap<string, PokemonRenderObject>,
): { foot: THREE.Vector3, centerOffset: THREE.Vector3, radius: number } | null => {
  const targetId = firstCritTargetId(event)
  const targetRenderObject = targetId ? renderObjects.get(targetId) : undefined
  const foot = resolveMoveVfxTokenAnchor({
    renderObjects,
    tokenId: targetId,
    anchor: MOVE_VFX_TOKEN_ANCHOR.foot,
    fallbackCell: event.targetCell,
  })

  if (!foot) return null

  const center = targetRenderObject
    ? resolveMoveVfxTokenAnchor({
      renderObjects,
      tokenId: targetId,
      anchor: MOVE_VFX_TOKEN_ANCHOR.center,
    })
    : null
  const centerOffset = (center ?? foot.clone().add(new THREE.Vector3(
    0,
    critBurstCenterHeightForRenderObject(targetRenderObject),
    0,
  ))).sub(foot)

  return {
    foot: foot.clone(),
    centerOffset,
    radius: critBurstRadiusForRenderObject(targetRenderObject),
  }
}

const createCritBurstMaterial = (
  color: THREE.ColorRepresentation,
  opacity: number,
): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({
  color,
  transparent: true,
  opacity,
  depthTest: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  toneMapped: false,
})

const createCritBurstRingMesh = (
  name: string,
  material: THREE.MeshBasicMaterial,
): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> => {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(0.72, 1, 48), material)
  mesh.name = name
  mesh.renderOrder = MOVE_VFX_CRIT_BURST_RING_RENDER_ORDER
  mesh.rotation.x = -Math.PI / 2
  mesh.visible = false
  mesh.raycast = () => {}
  return mesh
}

const createCritBurstSpokeMesh = (
  index: number,
  material: THREE.MeshBasicMaterial,
): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, false), material)
  mesh.name = `${MOVE_VFX_CRIT_BURST_SPOKE_PREFIX}-${index + 1}`
  mesh.renderOrder = MOVE_VFX_CRIT_BURST_SPOKE_RENDER_ORDER
  mesh.visible = false
  mesh.raycast = () => {}
  return mesh
}

const createCritBurstSpokeMeshes = (
  basePalette: MoveVfxPaletteEntry,
  critPalette: MoveVfxPaletteEntry,
): THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[] => Array.from(
  { length: MOVE_VFX_CRIT_BURST_SPOKE_COUNT },
  (_, index) => createCritBurstSpokeMesh(
    index,
    createCritBurstMaterial(index % 2 === 0 ? basePalette.accent : critPalette.primary, 0),
  ),
)

const critBurstOpacityMultiplier = (progress: number): number => {
  const fadeIn = clamp01(progress / MOVE_VFX_CRIT_BURST_FADE_IN_PROGRESS)
  const fadeOut = progress <= MOVE_VFX_CRIT_BURST_FADE_OUT_START
    ? 1
    : clamp01((1 - progress) / (1 - MOVE_VFX_CRIT_BURST_FADE_OUT_START))

  return Math.min(fadeIn, fadeOut)
}

const applyCritBurstVisualState = (options: {
  group: THREE.Group
  innerRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  outerRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  spokes: readonly THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[]
  foot: THREE.Vector3
  centerOffset: THREE.Vector3
  radius: number
  progress: number
}) => {
  const progress = clamp01(options.progress)
  const expansion = easeOutCubic(progress)
  const opacityMultiplier = critBurstOpacityMultiplier(progress)
  const innerOpacity = MOVE_VFX_CRIT_BURST_INNER_RING_MAX_OPACITY
    * opacityMultiplier
    * Math.max(0, 1 - (progress * 0.62))
  const outerOpacity = MOVE_VFX_CRIT_BURST_OUTER_RING_MAX_OPACITY
    * opacityMultiplier
    * Math.max(0, 1 - (progress * 0.78))

  options.group.position.copy(options.foot)
  options.innerRing.position.set(0, MOVE_VFX_CRIT_BURST_RING_Y_OFFSET, 0)
  options.innerRing.scale.setScalar(options.radius * (
    MOVE_VFX_CRIT_BURST_INNER_RING_START_SCALE
    + ((MOVE_VFX_CRIT_BURST_INNER_RING_END_SCALE - MOVE_VFX_CRIT_BURST_INNER_RING_START_SCALE) * expansion)
  ))
  options.innerRing.material.opacity = innerOpacity
  options.innerRing.visible = innerOpacity > 0.005

  options.outerRing.position.set(0, MOVE_VFX_CRIT_BURST_RING_Y_OFFSET * 1.35, 0)
  options.outerRing.scale.setScalar(options.radius * (
    MOVE_VFX_CRIT_BURST_OUTER_RING_START_SCALE
    + ((MOVE_VFX_CRIT_BURST_OUTER_RING_END_SCALE - MOVE_VFX_CRIT_BURST_OUTER_RING_START_SCALE) * expansion)
  ))
  options.outerRing.material.opacity = outerOpacity
  options.outerRing.visible = outerOpacity > 0.005

  const spokeProgress = easeOutCubic(clamp01((progress - 0.04) / 0.72))
  const spokeLength = options.radius * (
    MOVE_VFX_CRIT_BURST_SPOKE_START_LENGTH
    + ((MOVE_VFX_CRIT_BURST_SPOKE_END_LENGTH - MOVE_VFX_CRIT_BURST_SPOKE_START_LENGTH) * spokeProgress)
  )
  const spokeThickness = clampNumber(
    options.radius * MOVE_VFX_CRIT_BURST_SPOKE_THICKNESS_RATIO * (1 - (progress * 0.28)),
    MOVE_VFX_CRIT_BURST_SPOKE_MIN_THICKNESS,
    MOVE_VFX_CRIT_BURST_SPOKE_MAX_THICKNESS,
  )
  const spokeOpacity = MOVE_VFX_CRIT_BURST_SPOKE_MAX_OPACITY
    * opacityMultiplier
    * Math.max(0, 1 - (progress * 0.68))
  const direction = new THREE.Vector3()

  options.spokes.forEach((spoke, index) => {
    const angle = ((index / options.spokes.length) * Math.PI * 2)
      + (progress * MOVE_VFX_CRIT_BURST_SPOKE_TWIST_RADIANS)
    direction.set(Math.cos(angle), 0, Math.sin(angle))

    spoke.position.copy(options.centerOffset).addScaledVector(direction, spokeLength * 0.5)
    spoke.quaternion.setFromUnitVectors(MOVE_VFX_WORLD_UP, direction)
    spoke.scale.set(spokeThickness, spokeLength, spokeThickness)
    spoke.material.opacity = spokeOpacity * (index % 2 === 0 ? 1 : 0.82)
    spoke.visible = spoke.material.opacity > 0.005
  })
}

/**
 * Safe placeholder for effect kinds whose visible primitive has not landed yet.
 *
 * It owns the per-effect group, advances completion from scheduler frame time,
 * and creates no meshes or timers. Later primitive tickets can replace any
 * individual per-kind builder below without changing the renderer sync/animate
 * contract or the lifecycle cleanup path.
 */
const createNoopMoveVfxInstance: MoveVfxInstanceBuilder = ({ event, group }) => {
  let disposed = false
  let complete = false

  const instance: MoveVfxInstance = {
    id: event.id,
    group,
    get complete() {
      return complete || disposed
    },
    animate(frameContext) {
      if (disposed || complete) return

      complete = animationProgress(
        frameContext.frameNowMs,
        event.createdAtMs,
        event.durationMs,
      ).complete
    },
    dispose() {
      if (disposed) return

      disposed = true
      disposeObject3D(group)
    },
  }

  return instance
}

const createProjectileMoveVfxInstance: MoveVfxInstanceBuilder = (context) => {
  const event = context.event as MoveProjectileAnimationEvent
  const renderObjects = context.syncContext.renderObjects ?? EMPTY_RENDER_OBJECTS
  const targetId = firstProjectileTargetId(event)
  const anchors = resolveMoveVfxAnchorPair({
    renderObjects,
    userId: event.userId,
    targetId,
    originCell: event.originCell,
    targetCell: event.targetCell,
    userAnchor: MOVE_VFX_TOKEN_ANCHOR.chest,
    targetAnchor: MOVE_VFX_TOKEN_ANCHOR.chest,
  })

  if (!anchors) return createNoopMoveVfxInstance(context)

  let disposed = false
  let complete = false
  const palette: MoveVfxPaletteEntry = event.palette ?? DEFAULT_MOVE_VFX_COLOR
  const radius = projectileRadiusForRenderObjects(
    renderObjects.get(event.userId),
    targetId ? renderObjects.get(targetId) : undefined,
  )

  // Projectile endpoints are locked at creation time. This keeps the visual
  // stable if the target token is moved by another renderer update while the
  // transient projectile is already in flight.
  const start = anchors.start.clone()
  const end = anchors.end.clone()
  const glow = createProjectileMesh(
    MOVE_VFX_PROJECTILE_GLOW_NAME,
    createProjectileMaterial(palette.primary, 0.32),
  )
  const core = createProjectileMesh(
    MOVE_VFX_PROJECTILE_CORE_NAME,
    createProjectileMaterial(palette.accent, 0.95),
  )
  const trailSegments = createProjectileTrailSegments(palette.glow)

  context.group.add(...trailSegments, glow, core)
  applyProjectileVisualState({
    group: context.group,
    core,
    glow,
    trailSegments,
    start,
    end,
    radius,
    progress: 0,
  })

  return {
    id: event.id,
    group: context.group,
    get complete() {
      return complete || disposed
    },
    animate(frameContext) {
      if (disposed || complete) return

      const progress = animationProgress(
        frameContext.frameNowMs,
        event.createdAtMs,
        event.durationMs,
      )
      if (progress.complete) {
        complete = true
        return
      }

      applyProjectileVisualState({
        group: context.group,
        core,
        glow,
        trailSegments,
        start,
        end,
        radius,
        progress: progress.progress,
      })
    },
    dispose() {
      if (disposed) return

      disposed = true
      disposeObject3D(context.group)
    },
  }
}

const createBeamMoveVfxInstance: MoveVfxInstanceBuilder = (context) => {
  const event = context.event as MoveBeamAnimationEvent
  const renderObjects = context.syncContext.renderObjects ?? EMPTY_RENDER_OBJECTS
  const targetId = firstBeamTargetId(event)
  const anchors = resolveBeamAnchorPair(event, renderObjects)
  if (!anchors) return createNoopMoveVfxInstance(context)

  const transform = createBeamTransform(anchors.start, anchors.end)
  if (!transform) return createNoopMoveVfxInstance(context)

  let disposed = false
  let complete = false
  const palette: MoveVfxPaletteEntry = event.palette ?? DEFAULT_MOVE_VFX_COLOR
  const radius = beamRadiusForRenderObjects(
    renderObjects.get(event.userId),
    targetId ? renderObjects.get(targetId) : undefined,
  ) || MOVE_VFX_BEAM_DEFAULT_RADIUS
  const impactRadius = clampNumber(
    radius * MOVE_VFX_BEAM_IMPACT_BASE_RADIUS_MULTIPLIER,
    MOVE_VFX_BEAM_IMPACT_MIN_RADIUS,
    MOVE_VFX_BEAM_IMPACT_MAX_RADIUS,
  )

  // Beam endpoints are locked at creation for the same reason projectiles are:
  // the transient visual should not bend or stretch if token placement changes
  // while the scheduler is animating the existing effect instance.
  const midpoint = transform.midpoint.clone()
  const quaternion = transform.quaternion.clone()
  const core = createBeamCylinderMesh(
    MOVE_VFX_BEAM_CORE_NAME,
    createBeamMaterial(palette.accent, MOVE_VFX_BEAM_MAX_CORE_OPACITY),
  )
  const glow = createBeamCylinderMesh(
    MOVE_VFX_BEAM_GLOW_NAME,
    createBeamMaterial(palette.primary, MOVE_VFX_BEAM_MAX_GLOW_OPACITY),
  )
  const impactRing = event.impact
    ? createBeamImpactRingMesh(createImpactRingMaterial(palette.accent, 0))
    : undefined

  context.group.add(glow, core)
  if (impactRing) context.group.add(impactRing)

  applyBeamVisualState({
    group: context.group,
    core,
    glow,
    impactRing,
    midpoint,
    quaternion,
    length: transform.length,
    radius,
    impactRadius,
    progress: 0,
  })

  return {
    id: event.id,
    group: context.group,
    get complete() {
      return complete || disposed
    },
    animate(frameContext) {
      if (disposed || complete) return

      const progress = animationProgress(
        frameContext.frameNowMs,
        event.createdAtMs,
        event.durationMs,
      )
      if (progress.complete) {
        complete = true
        return
      }

      applyBeamVisualState({
        group: context.group,
        core,
        glow,
        impactRing,
        midpoint,
        quaternion,
        length: transform.length,
        radius,
        impactRadius,
        progress: progress.progress,
      })
    },
    dispose() {
      if (disposed) return

      disposed = true
      disposeObject3D(context.group)
    },
  }
}

const createArcMoveVfxInstance: MoveVfxInstanceBuilder = (context) => {
  const event = context.event as MoveArcAnimationEvent
  const renderObjects = context.syncContext.renderObjects ?? EMPTY_RENDER_OBJECTS
  const targetId = firstArcTargetId(event)
  const anchors = resolveMoveVfxAnchorPair({
    renderObjects,
    userId: event.userId,
    targetId,
    originCell: event.originCell,
    targetCell: event.targetCell,
    userAnchor: MOVE_VFX_TOKEN_ANCHOR.chest,
    targetAnchor: MOVE_VFX_TOKEN_ANCHOR.chest,
  })

  if (!anchors) return createNoopMoveVfxInstance(context)

  let disposed = false
  let complete = false
  const palette: MoveVfxPaletteEntry = event.palette ?? DEFAULT_MOVE_VFX_COLOR
  const radius = projectileRadiusForRenderObjects(
    renderObjects.get(event.userId),
    targetId ? renderObjects.get(targetId) : undefined,
  )

  // Arc/lob endpoints are locked like regular projectiles, while the vertical
  // offset is deterministic and bounded so long-range throws do not leave the
  // tactical map's readable scale.
  const start = anchors.start.clone()
  const end = anchors.end.clone()
  const arcHeight = arcHeightForDistance(horizontalDistanceBetween(start, end), event.arcHeight)
  const glow = createProjectileMesh(
    MOVE_VFX_ARC_GLOW_NAME,
    createProjectileMaterial(palette.primary, 0.32),
  )
  const core = createProjectileMesh(
    MOVE_VFX_ARC_CORE_NAME,
    createProjectileMaterial(palette.accent, 0.95),
  )
  const trailSegments = createProjectileTrailSegments(palette.glow, MOVE_VFX_ARC_TRAIL_SEGMENT_PREFIX)

  context.group.add(...trailSegments, glow, core)
  applyArcProjectileVisualState({
    group: context.group,
    core,
    glow,
    trailSegments,
    start,
    end,
    radius,
    arcHeight,
    progress: 0,
  })

  return {
    id: event.id,
    group: context.group,
    get complete() {
      return complete || disposed
    },
    animate(frameContext) {
      if (disposed || complete) return

      const progress = animationProgress(
        frameContext.frameNowMs,
        event.createdAtMs,
        event.durationMs,
      )
      if (progress.complete) {
        complete = true
        return
      }

      applyArcProjectileVisualState({
        group: context.group,
        core,
        glow,
        trailSegments,
        start,
        end,
        radius,
        arcHeight,
        progress: progress.progress,
      })
    },
    dispose() {
      if (disposed) return

      disposed = true
      disposeObject3D(context.group)
    },
  }
}

const createMeleeLungeMoveVfxInstance: MoveVfxInstanceBuilder = (context) => {
  const event = context.event as MoveMeleeLungeAnimationEvent
  const renderObjects = context.syncContext.renderObjects ?? EMPTY_RENDER_OBJECTS
  const targetId = firstMeleeLungeTargetId(event)
  const anchors = resolveMeleeLungeAnchors(event, renderObjects)

  if (!anchors) return createNoopMoveVfxInstance(context)

  let disposed = false
  let complete = false
  const palette: MoveVfxPaletteEntry = event.palette ?? DEFAULT_MOVE_VFX_COLOR
  const userRenderObject = renderObjects.get(event.userId)
  const targetRenderObject = targetId ? renderObjects.get(targetId) : undefined
  const scales = meleeLungeRadiusForRenderObjects(userRenderObject, targetRenderObject)
  const ghost = createMeleeLungeGhostMesh(createMeleeLungeMaterial(palette.primary, 0))
  const streak = createMeleeLungeStreakMesh(createMeleeLungeMaterial(palette.glow, 0))
  const impactRing = createMeleeLungeImpactRingMesh(createImpactRingMaterial(palette.accent, 0))

  // Melee lunges are deliberately VFX-owned overlay geometry. They never offset
  // the token render object or saved placement; the translucent ghost moves out
  // and back while the actual token remains controlled by the normal map state.
  context.group.add(streak, ghost, impactRing)
  applyMeleeLungeVisualState({
    ghost,
    streak,
    impactRing,
    ...anchors,
    ...scales,
    progress: 0,
  })

  return {
    id: event.id,
    group: context.group,
    get complete() {
      return complete || disposed
    },
    animate(frameContext) {
      if (disposed || complete) return

      const progress = animationProgress(
        frameContext.frameNowMs,
        event.createdAtMs,
        event.durationMs,
      )
      if (progress.complete) {
        complete = true
        return
      }

      applyMeleeLungeVisualState({
        ghost,
        streak,
        impactRing,
        ...anchors,
        ...scales,
        progress: progress.progress,
      })
    },
    dispose() {
      if (disposed) return

      disposed = true
      disposeObject3D(context.group)
    },
  }
}

const createSelfPulseMoveVfxInstance: MoveVfxInstanceBuilder = (context) => {
  const event = context.event as MoveSelfPulseAnimationEvent
  const renderObjects = context.syncContext.renderObjects ?? EMPTY_RENDER_OBJECTS
  const anchor = resolveSelfPulseAnchor(event, renderObjects)

  if (!anchor) return createNoopMoveVfxInstance(context)

  let disposed = false
  let complete = false
  const palette = selfPulsePaletteForEvent(event)
  const baseRing = createSelfPulseRingMesh(
    MOVE_VFX_SELF_PULSE_BASE_RING_NAME,
    createSelfPulseMaterial(palette.accent, 0),
    MOVE_VFX_SELF_PULSE_BASE_RING_RENDER_ORDER,
  )
  const risingRing = createSelfPulseRingMesh(
    MOVE_VFX_SELF_PULSE_RISING_RING_NAME,
    createSelfPulseMaterial(palette.glow, 0),
    MOVE_VFX_SELF_PULSE_RISING_RING_RENDER_ORDER,
  )
  const shell = createSelfPulseShellMesh(createSelfPulseMaterial(palette.primary, 0))

  // Self aura pulses are entirely VFX-owned overlay geometry. They lock the
  // user/cell anchor at creation, scale from the token footprint and body
  // clearance, and never alter token selection, hover, sprite, or placement
  // state while the scheduler advances the aura.
  context.group.add(baseRing, risingRing, shell)
  applySelfPulseVisualState({
    group: context.group,
    baseRing,
    risingRing,
    shell,
    ...anchor,
    progress: 0,
  })

  return {
    id: event.id,
    group: context.group,
    get complete() {
      return complete || disposed
    },
    animate(frameContext) {
      if (disposed || complete) return

      const progress = animationProgress(
        frameContext.frameNowMs,
        event.createdAtMs,
        event.durationMs,
      )
      if (progress.complete) {
        complete = true
        return
      }

      applySelfPulseVisualState({
        group: context.group,
        baseRing,
        risingRing,
        shell,
        ...anchor,
        progress: progress.progress,
      })
    },
    dispose() {
      if (disposed) return

      disposed = true
      disposeObject3D(context.group)
    },
  }
}

const createTargetFlashMoveVfxInstance: MoveVfxInstanceBuilder = (context) => {
  const event = context.event as MoveTargetFlashAnimationEvent
  const renderObjects = context.syncContext.renderObjects ?? EMPTY_RENDER_OBJECTS
  const anchors = resolveTargetFlashAnchors(event, renderObjects)

  if (!anchors) return createNoopMoveVfxInstance(context)

  let disposed = false
  let complete = false
  const palette = targetFlashPaletteForEvent(event)
  const ring = createTargetFlashRingMesh(createTargetFlashMaterial(palette.accent, 0))
  const shell = createTargetFlashShellMesh(createTargetFlashMaterial(palette.primary, 0))

  // Target flashes lock their token/cell anchors at creation time so the brief
  // readability pulse stays attached to the resolution moment rather than
  // stretching if normal token movement updates before the effect completes.
  context.group.add(ring, shell)
  applyTargetFlashVisualState({
    group: context.group,
    ring,
    shell,
    ...anchors,
    progress: 0,
  })

  return {
    id: event.id,
    group: context.group,
    get complete() {
      return complete || disposed
    },
    animate(frameContext) {
      if (disposed || complete) return

      const progress = animationProgress(
        frameContext.frameNowMs,
        event.createdAtMs,
        event.durationMs,
      )
      if (progress.complete) {
        complete = true
        return
      }

      applyTargetFlashVisualState({
        group: context.group,
        ring,
        shell,
        ...anchors,
        progress: progress.progress,
      })
    },
    dispose() {
      if (disposed) return

      disposed = true
      disposeObject3D(context.group)
    },
  }
}

const createImpactRingMoveVfxInstance: MoveVfxInstanceBuilder = (context) => {
  const event = context.event as MoveImpactRingAnimationEvent
  const renderObjects = context.syncContext.renderObjects ?? EMPTY_RENDER_OBJECTS
  const anchor = resolveImpactRingAnchor(event, renderObjects)

  if (!anchor) return createNoopMoveVfxInstance(context)

  let disposed = false
  let complete = false
  const palette = impactRingPaletteForEvent(event)
  const ring = createImpactRingMesh(
    MOVE_VFX_IMPACT_RING_NAME,
    createImpactRingMaterial(palette.accent, 0),
  )

  // Impact rings are ground-plane VFX owned by the event instance. They lock the
  // target foot/cell anchor at creation so the hit read stays tied to the
  // resolution moment without mutating token placement or terrain state.
  context.group.add(ring)
  applyImpactRingVisualState({
    group: context.group,
    ring,
    ...anchor,
    progress: 0,
  })

  return {
    id: event.id,
    group: context.group,
    get complete() {
      return complete || disposed
    },
    animate(frameContext) {
      if (disposed || complete) return

      const progress = animationProgress(
        frameContext.frameNowMs,
        event.createdAtMs,
        event.durationMs,
      )
      if (progress.complete) {
        complete = true
        return
      }

      applyImpactRingVisualState({
        group: context.group,
        ring,
        ...anchor,
        progress: progress.progress,
      })
    },
    dispose() {
      if (disposed) return

      disposed = true
      disposeObject3D(context.group)
    },
  }
}

const createAreaPulseMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createLineSweepMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createConeSweepMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createDashMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance

const createMissMoveVfxInstance: MoveVfxInstanceBuilder = (context) => {
  const event = context.event as MoveMissAnimationEvent
  const renderObjects = context.syncContext.renderObjects ?? EMPTY_RENDER_OBJECTS
  const anchor = resolveMissPuffAnchor(event, renderObjects)

  if (!anchor) return createNoopMoveVfxInstance(context)

  let disposed = false
  let complete = false
  const palette = moveVfxColorForTone(MOVE_VFX_TONE.miss)
  const ring = createMissPuffRingMesh(createMissPuffMaterial(palette.accent, 0))
  const clouds = MOVE_VFX_MISS_PUFF_CLOUD_LAYOUT.map((_, index) => createMissPuffCloudMesh(
    index,
    createMissPuffMaterial(index === 0 ? palette.primary : palette.glow, 0),
  ))

  // Miss puffs intentionally ignore type-coloured event palettes. They lock a
  // point just past the target/cell anchor and use understated neutral miss
  // styling so misses do not read as damaging hit impacts.
  context.group.add(ring, ...clouds)
  applyMissPuffVisualState({
    group: context.group,
    ring,
    clouds,
    ...anchor,
    progress: 0,
  })

  return {
    id: event.id,
    group: context.group,
    get complete() {
      return complete || disposed
    },
    animate(frameContext) {
      if (disposed || complete) return

      const progress = animationProgress(
        frameContext.frameNowMs,
        event.createdAtMs,
        event.durationMs,
      )
      if (progress.complete) {
        complete = true
        return
      }

      applyMissPuffVisualState({
        group: context.group,
        ring,
        clouds,
        ...anchor,
        progress: progress.progress,
      })
    },
    dispose() {
      if (disposed) return

      disposed = true
      disposeObject3D(context.group)
    },
  }
}

const createCritMoveVfxInstance: MoveVfxInstanceBuilder = (context) => {
  const event = context.event as MoveCritAnimationEvent
  const renderObjects = context.syncContext.renderObjects ?? EMPTY_RENDER_OBJECTS
  const anchor = resolveCritBurstAnchor(event, renderObjects)

  if (!anchor) return createNoopMoveVfxInstance(context)

  let disposed = false
  let complete = false
  const critPalette = moveVfxColorForTone(MOVE_VFX_TONE.crit)
  const basePalette = event.palette ?? critPalette
  const baseIsCritPalette = basePalette.key === MOVE_VFX_TONE.crit
  const innerRing = createCritBurstRingMesh(
    MOVE_VFX_CRIT_BURST_INNER_RING_NAME,
    createCritBurstMaterial(critPalette.accent, 0),
  )
  const outerRing = createCritBurstRingMesh(
    MOVE_VFX_CRIT_BURST_OUTER_RING_NAME,
    createCritBurstMaterial(baseIsCritPalette ? critPalette.glow : basePalette.primary, 0),
  )
  const spokes = createCritBurstSpokeMeshes(basePalette, critPalette)

  // Crit bursts are brief event-owned accents layered on top of the normal hit
  // read. They lock the target/cell anchor at creation time, combine the move
  // event palette with the semantic crit palette when available, and never
  // decide whether a hit was actually critical.
  context.group.add(outerRing, innerRing, ...spokes)
  applyCritBurstVisualState({
    group: context.group,
    innerRing,
    outerRing,
    spokes,
    ...anchor,
    progress: 0,
  })

  return {
    id: event.id,
    group: context.group,
    get complete() {
      return complete || disposed
    },
    animate(frameContext) {
      if (disposed || complete) return

      const progress = animationProgress(
        frameContext.frameNowMs,
        event.createdAtMs,
        event.durationMs,
      )
      if (progress.complete) {
        complete = true
        return
      }

      applyCritBurstVisualState({
        group: context.group,
        innerRing,
        outerRing,
        spokes,
        ...anchor,
        progress: progress.progress,
      })
    },
    dispose() {
      if (disposed) return

      disposed = true
      disposeObject3D(context.group)
    },
  }
}
const createStatusMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createHealingMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createBuffDebuffMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance

const selectMoveVfxInstanceBuilder = (kind: string): MoveVfxInstanceBuilder => {
  switch (kind) {
    case MOVE_VFX_KIND.projectile:
      return createProjectileMoveVfxInstance
    case MOVE_VFX_KIND.beam:
      return createBeamMoveVfxInstance
    case MOVE_VFX_KIND.arc:
      return createArcMoveVfxInstance
    case MOVE_VFX_KIND.meleeLunge:
      return createMeleeLungeMoveVfxInstance
    case MOVE_VFX_KIND.selfPulse:
      return createSelfPulseMoveVfxInstance
    case MOVE_VFX_KIND.targetFlash:
      return createTargetFlashMoveVfxInstance
    case MOVE_VFX_KIND.impactRing:
      return createImpactRingMoveVfxInstance
    case MOVE_VFX_KIND.areaPulse:
      return createAreaPulseMoveVfxInstance
    case MOVE_VFX_KIND.lineSweep:
      return createLineSweepMoveVfxInstance
    case MOVE_VFX_KIND.coneSweep:
      return createConeSweepMoveVfxInstance
    case MOVE_VFX_KIND.dash:
      return createDashMoveVfxInstance
    case MOVE_VFX_KIND.miss:
      return createMissMoveVfxInstance
    case MOVE_VFX_KIND.crit:
      return createCritMoveVfxInstance
    case MOVE_VFX_KIND.status:
      return createStatusMoveVfxInstance
    case MOVE_VFX_KIND.healing:
      return createHealingMoveVfxInstance
    case MOVE_VFX_KIND.buffDebuff:
      return createBuffDebuffMoveVfxInstance
    default:
      return createNoopMoveVfxInstance
  }
}

/**
 * Creates the isolated Three.js owner for transient move animation VFX.
 *
 * Visible primitives are intentionally still placeholders in VFX-021. The
 * renderer now owns the per-effect instance seam: sync creates one pluggable
 * instance per active event id, animate delegates frame advancement to those
 * instances, and disposal remains centralized through the existing resource
 * cleanup helper. This keeps future projectile, beam, flash, and pulse math out
 * of the top-level renderer loop and avoids any independent RAF/timer source.
 */
export const createMoveVfxRenderer = (
  sceneOrOptions: THREE.Scene | MoveVfxRendererOptions,
): MoveVfxRenderer => {
  const options = normalizeOptions(sceneOrOptions)
  const group = options.group ?? new THREE.Group()
  group.name = group.name || MOVE_VFX_GROUP_NAME
  group.visible = false

  if (group.parent !== options.scene) {
    group.parent?.remove(group)
    options.scene.add(group)
  }

  let disposed = false
  let lastVisible = true
  const activeInstances = new Map<string, MoveVfxInstance>()
  const activeEvents = new Map<string, MoveAnimationEvent>()
  const completedEventIds = new Set<string>()

  const hasActiveInstances = () => !disposed && activeInstances.size > 0

  const applyVisibility = () => {
    group.visible = hasActiveInstances() && lastVisible
  }

  const createDebugSnapshot = (): MoveVfxDebugSnapshot => ({
    activeCount: disposed ? 0 : activeInstances.size,
    instanceGroupCount: group.children.length,
    needsAnimationFrame: hasActiveInstances(),
    visible: group.visible,
    layerVisible: !disposed && lastVisible,
    disposed,
  })

  const createInstance = (
    event: MoveAnimationEvent,
    syncContext: MoveVfxRendererSyncContext,
  ): MoveVfxInstance => {
    const instanceGroup = new THREE.Group()
    instanceGroup.name = `${MOVE_VFX_INSTANCE_GROUP_PREFIX}:${event.id}`
    group.add(instanceGroup)

    return selectMoveVfxInstanceBuilder(event.kind)({
      event,
      group: instanceGroup,
      syncContext,
    })
  }

  const disposeInstance = (id: string) => {
    const instance = activeInstances.get(id)
    if (!instance) return

    activeInstances.delete(id)
    activeEvents.delete(id)
    instance.dispose()
  }

  const disposeAllInstances = () => {
    for (const id of [...activeInstances.keys()]) disposeInstance(id)
  }

  const completeInstance = (id: string) => {
    completedEventIds.add(id)
    disposeInstance(id)
  }

  const animateInstances = (frameContext: MoveVfxRendererFrameContext) => {
    for (const instance of [...activeInstances.values()]) {
      instance.animate(frameContext)

      if (instance.complete) completeInstance(instance.id)
    }
  }

  return {
    group,

    sync(events, context = {}) {
      if (disposed) return

      lastVisible = context.visible ?? true

      const incomingIds = new Set(events.map((event) => event.id))
      for (const id of [...activeInstances.keys()]) {
        if (!incomingIds.has(id)) disposeInstance(id)
      }
      for (const id of [...completedEventIds]) {
        if (!incomingIds.has(id)) completedEventIds.delete(id)
      }

      for (const event of events) {
        if (!activeInstances.has(event.id) && !completedEventIds.has(event.id)) {
          activeEvents.set(event.id, event)
          activeInstances.set(event.id, createInstance(event, context))
        }
      }

      applyVisibility()
    },

    animate(frameContext) {
      if (disposed) return

      lastVisible = frameContext.visible ?? lastVisible
      animateInstances(frameContext)
      applyVisibility()
    },

    needsAnimationFrame() {
      return hasActiveInstances()
    },

    activeCount() {
      return disposed ? 0 : activeInstances.size
    },

    debugSnapshot() {
      return createDebugSnapshot()
    },

    expireCompleted(nowMs) {
      if (disposed) return 0

      let expiredCount = 0
      for (const [id, event] of [...activeEvents.entries()]) {
        if (!animationProgress(nowMs, event.createdAtMs, event.durationMs).complete) continue

        completeInstance(id)
        expiredCount += 1
      }

      if (expiredCount > 0) applyVisibility()
      return expiredCount
    },

    dispose() {
      if (disposed) return

      disposed = true
      group.visible = false
      completedEventIds.clear()
      disposeAllInstances()
      disposeObject3D(group)
    },
  }
}
