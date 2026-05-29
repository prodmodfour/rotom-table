import * as THREE from 'three'
import type { MoveAnimationEvent } from '~/types/moveAnimation'
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
  dispose(): void
}

const MOVE_VFX_GROUP_NAME = 'move-vfx-root'
const MOVE_VFX_INSTANCE_GROUP_PREFIX = 'move-vfx-instance'

interface MoveVfxLifecycleInstance {
  id: string
  event: MoveAnimationEvent
  group: THREE.Group
  disposed: boolean
  dispose(): void
}

const normalizeOptions = (
  sceneOrOptions: THREE.Scene | MoveVfxRendererOptions,
): MoveVfxRendererOptions => (
  sceneOrOptions instanceof THREE.Scene ? { scene: sceneOrOptions } : sceneOrOptions
)

/**
 * Creates the isolated Three.js owner for transient move animation VFX.
 *
 * This shell intentionally does not create primitive meshes yet. It creates
 * only per-event lifecycle groups under the dedicated root so future primitive
 * builders can attach their objects to owned containers and be driven from the
 * existing isometric render scheduler through `animate()` and
 * `needsAnimationFrame()` rather than creating an independent RAF loop.
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
  const activeInstances = new Map<string, MoveVfxLifecycleInstance>()
  const completedEventIds = new Set<string>()

  const applyVisibility = () => {
    group.visible = !disposed && lastVisible && activeInstances.size > 0
  }

  const createLifecycleInstance = (event: MoveAnimationEvent): MoveVfxLifecycleInstance => {
    const instanceGroup = new THREE.Group()
    instanceGroup.name = `${MOVE_VFX_INSTANCE_GROUP_PREFIX}:${event.id}`
    group.add(instanceGroup)

    const instance: MoveVfxLifecycleInstance = {
      id: event.id,
      event,
      group: instanceGroup,
      disposed: false,
      dispose() {
        if (instance.disposed) return

        instance.disposed = true
        disposeObject3D(instance.group)
      },
    }

    return instance
  }

  const disposeInstance = (id: string) => {
    const instance = activeInstances.get(id)
    if (!instance) return

    activeInstances.delete(id)
    instance.dispose()
  }

  const disposeAllInstances = () => {
    for (const id of [...activeInstances.keys()]) disposeInstance(id)
  }

  const completeInstance = (id: string) => {
    completedEventIds.add(id)
    disposeInstance(id)
  }

  const pruneCompletedInstances = (frameNowMs: number) => {
    for (const instance of [...activeInstances.values()]) {
      const progress = animationProgress(
        frameNowMs,
        instance.event.createdAtMs,
        instance.event.durationMs,
      )

      if (progress.complete) completeInstance(instance.id)
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
          activeInstances.set(event.id, createLifecycleInstance(event))
        }
      }

      applyVisibility()
    },

    animate(frameContext) {
      if (disposed) return

      lastVisible = frameContext.visible ?? lastVisible
      pruneCompletedInstances(frameContext.frameNowMs)
      applyVisibility()
    },

    needsAnimationFrame() {
      return !disposed && activeInstances.size > 0
    },

    activeCount() {
      return disposed ? 0 : activeInstances.size
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
