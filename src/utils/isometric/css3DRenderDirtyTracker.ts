import {
  ISOMETRIC_CSS3D_RENDER_INVALIDATION_REASONS,
  renderInvalidationLayersIncludeCss3D,
  type IsometricRenderDirtyLayer,
  type RenderInvalidationReason,
} from './renderInvalidation'
import {
  ISOMETRIC_ANIMATION_CONTINUATION_SOURCE,
  type IsometricAnimationContinuation,
  type IsometricAnimationContinuationSource,
} from './renderLoop'

export const CSS3D_RENDER_DIRTY_INVALIDATION_REASONS = ISOMETRIC_CSS3D_RENDER_INVALIDATION_REASONS

export type Css3DRenderDirtyInvalidationReason = typeof CSS3D_RENDER_DIRTY_INVALIDATION_REASONS[number]

export const CSS3D_RENDER_DIRTY_ANIMATION_SOURCES = [
  ISOMETRIC_ANIMATION_CONTINUATION_SOURCE.tokenMotion,
] as const satisfies readonly IsometricAnimationContinuationSource[]

export type Css3DRenderDirtyAnimationSource = typeof CSS3D_RENDER_DIRTY_ANIMATION_SOURCES[number]

export type Css3DRenderDirtyReason = Css3DRenderDirtyInvalidationReason | Css3DRenderDirtyAnimationSource

export interface Css3DRenderDirtySnapshot {
  dirty: boolean
  reasons: Css3DRenderDirtyReason[]
}

export interface Css3DRenderDirtyTracker {
  markDirty(reason?: Css3DRenderDirtyReason): Css3DRenderDirtySnapshot
  markDirtyForRenderReasons(reasons: Iterable<RenderInvalidationReason>): Css3DRenderDirtySnapshot
  markDirtyForRenderLayers(
    layers: Iterable<IsometricRenderDirtyLayer>,
    reasons?: Iterable<RenderInvalidationReason>,
  ): Css3DRenderDirtySnapshot
  markDirtyForAnimationContinuation(continuation: Pick<IsometricAnimationContinuation, 'sources'>): Css3DRenderDirtySnapshot
  consumeDirty(): boolean
  reset(options?: { dirty?: boolean; reasons?: Iterable<Css3DRenderDirtyReason> }): Css3DRenderDirtySnapshot
  snapshot(): Css3DRenderDirtySnapshot
}

const CSS3D_RENDER_DIRTY_INVALIDATION_REASON_SET = new Set<RenderInvalidationReason>(
  CSS3D_RENDER_DIRTY_INVALIDATION_REASONS,
)

const CSS3D_RENDER_DIRTY_ANIMATION_SOURCE_SET = new Set<IsometricAnimationContinuationSource>(
  CSS3D_RENDER_DIRTY_ANIMATION_SOURCES,
)

export const isCss3DRenderDirtyInvalidationReason = (
  reason: RenderInvalidationReason,
): reason is Css3DRenderDirtyInvalidationReason => CSS3D_RENDER_DIRTY_INVALIDATION_REASON_SET.has(reason)

export const isCss3DRenderDirtyAnimationSource = (
  source: IsometricAnimationContinuationSource,
): source is Css3DRenderDirtyAnimationSource => CSS3D_RENDER_DIRTY_ANIMATION_SOURCE_SET.has(source)

const copySnapshot = (
  dirty: boolean,
  reasons: Css3DRenderDirtyReason[],
): Css3DRenderDirtySnapshot => ({
  dirty,
  reasons: [...reasons],
})

const appendUniqueReason = (
  reasons: Css3DRenderDirtyReason[],
  reason: Css3DRenderDirtyReason,
) => {
  if (!reasons.includes(reason)) reasons.push(reason)
}

export const createCss3DRenderDirtyTracker = (options: {
  dirty?: boolean
  reasons?: Iterable<Css3DRenderDirtyReason>
} = {}): Css3DRenderDirtyTracker => {
  let dirty = options.dirty ?? true
  let dirtyReasons = Array.from(options.reasons ?? (dirty ? ['initial' as const] : []))

  const snapshot = () => copySnapshot(dirty, dirtyReasons)

  const markDirty = (reason: Css3DRenderDirtyReason = 'manual'): Css3DRenderDirtySnapshot => {
    dirty = true
    appendUniqueReason(dirtyReasons, reason)
    return snapshot()
  }

  const markDirtyForRenderReasons = (
    reasons: Iterable<RenderInvalidationReason>,
  ): Css3DRenderDirtySnapshot => {
    for (const reason of reasons) {
      if (isCss3DRenderDirtyInvalidationReason(reason)) markDirty(reason)
    }

    return snapshot()
  }

  const markDirtyForRenderLayers = (
    layers: Iterable<IsometricRenderDirtyLayer>,
    reasons: Iterable<RenderInvalidationReason> = [],
  ): Css3DRenderDirtySnapshot => {
    if (!renderInvalidationLayersIncludeCss3D(layers)) {
      return snapshot()
    }

    let markedReason = false
    for (const reason of reasons) {
      if (!isCss3DRenderDirtyInvalidationReason(reason)) continue

      markDirty(reason)
      markedReason = true
    }

    if (!markedReason) markDirty('manual')

    return snapshot()
  }

  const markDirtyForAnimationContinuation = (
    continuation: Pick<IsometricAnimationContinuation, 'sources'>,
  ): Css3DRenderDirtySnapshot => {
    for (const source of continuation.sources) {
      if (isCss3DRenderDirtyAnimationSource(source)) markDirty(source)
    }

    return snapshot()
  }

  const consumeDirty = (): boolean => {
    const wasDirty = dirty
    dirty = false
    dirtyReasons = []
    return wasDirty
  }

  const reset = (resetOptions: {
    dirty?: boolean
    reasons?: Iterable<Css3DRenderDirtyReason>
  } = {}): Css3DRenderDirtySnapshot => {
    dirty = resetOptions.dirty ?? false
    dirtyReasons = Array.from(resetOptions.reasons ?? [])
    if (dirty && dirtyReasons.length === 0) dirtyReasons = ['manual']
    return snapshot()
  }

  return {
    markDirty,
    markDirtyForRenderReasons,
    markDirtyForRenderLayers,
    markDirtyForAnimationContinuation,
    consumeDirty,
    reset,
    snapshot,
  }
}
