import * as THREE from 'three'
import type { MoveAnimationEvent } from '~/types/moveAnimation'
import type { PokemonRenderObject } from '~/utils/isometric/types'
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

const normalizeOptions = (
  sceneOrOptions: THREE.Scene | MoveVfxRendererOptions,
): MoveVfxRendererOptions => (
  sceneOrOptions instanceof THREE.Scene ? { scene: sceneOrOptions } : sceneOrOptions
)

/**
 * Creates the isolated Three.js owner for transient move animation VFX.
 *
 * This shell intentionally does not create primitive meshes yet. Future tickets
 * will add per-event instances inside the dedicated group and drive them from
 * the existing isometric render scheduler through `animate()` and
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
  let syncedEventCount = 0

  const applyVisibility = (visible = true) => {
    group.visible = !disposed && visible && syncedEventCount > 0
  }

  return {
    group,

    sync(events, context = {}) {
      if (disposed) return

      syncedEventCount = events.length
      applyVisibility(context.visible ?? true)
    },

    animate(_frameContext) {
      // Primitive instances are intentionally deferred to later VFX tickets.
    },

    needsAnimationFrame() {
      // The shell owns no animated instances yet, so it never keeps the scheduler alive.
      return false
    },

    activeCount() {
      return disposed ? 0 : syncedEventCount
    },

    dispose() {
      if (disposed) return

      disposed = true
      syncedEventCount = 0
      disposeObject3D(group)
    },
  }
}
