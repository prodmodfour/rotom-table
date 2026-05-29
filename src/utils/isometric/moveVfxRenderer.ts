import * as THREE from 'three'
import { MOVE_VFX_KIND, type MoveAnimationEvent } from '~/types/moveAnimation'
import type { PokemonRenderObject } from '~/utils/isometric/types'
import { animationProgress } from './moveVfxTiming'
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

export interface MoveVfxRenderer {
  /** Dedicated root object for all transient move VFX render objects. */
  readonly group: THREE.Group
  sync(events: readonly MoveAnimationEvent[], context?: MoveVfxRendererSyncContext): void
  animate(frameContext: MoveVfxRendererFrameContext): void
  needsAnimationFrame(): boolean
  activeCount(): number
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

const createProjectileMoveVfxInstance: MoveVfxInstanceBuilder = createNoopMoveVfxInstance
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

  const applyVisibility = () => {
    group.visible = !disposed && lastVisible && activeInstances.size > 0
  }

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
      return !disposed && activeInstances.size > 0
    },

    activeCount() {
      return disposed ? 0 : activeInstances.size
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
