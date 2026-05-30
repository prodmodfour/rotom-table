import * as THREE from 'three'
import { MOVE_VFX_KIND, type MoveAnimationEvent, type MoveProjectileAnimationEvent } from '~/types/moveAnimation'
import { DEFAULT_MOVE_VFX_COLOR, type MoveVfxPaletteEntry } from '~/utils/moveAnimationPalette'
import type { PokemonRenderObject } from '~/utils/isometric/types'
import { MOVE_VFX_TOKEN_ANCHOR, resolveMoveVfxAnchorPair } from './moveVfxAnchors'
import { animationProgress, clamp01, easeInOutCubic, pulse01 } from './moveVfxTiming'
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

const projectileTrailSegmentName = (index: number): string => `${MOVE_VFX_PROJECTILE_TRAIL_SEGMENT_PREFIX}-${index + 1}`

const createProjectileTrailSegments = (
  color: THREE.ColorRepresentation,
): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] => Array.from(
  { length: MOVE_VFX_PROJECTILE_TRAIL_SEGMENT_COUNT },
  (_, index) => createProjectileMesh(
    projectileTrailSegmentName(index),
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

const firstProjectileTargetId = (event: MoveProjectileAnimationEvent): string | undefined => (
  event.targetId ?? event.targetIds?.[0]
)

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

const createBeamMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createArcMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createMeleeLungeMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createSelfPulseMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createTargetFlashMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createAreaPulseMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createLineSweepMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createConeSweepMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createDashMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createMissMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
const createCritMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
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
