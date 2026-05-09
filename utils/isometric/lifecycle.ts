import { disposeBlockTextureCache } from '~/utils/isometric/blockTextures'
import { disposeHazardTextureCache } from '~/utils/isometric/hazardRenderer'
import {
  disposeSpriteSharedTextures,
  disposeSpriteTextureCaches,
} from '~/utils/isometric/spriteTextures'

export interface IsometricRendererDomHandlers {
  pointerdown: (event: PointerEvent) => void
  pointermove: (event: PointerEvent) => void
  pointerup: (event: PointerEvent) => void
  pointerleave: (event: PointerEvent) => void
  contextmenu: (event: MouseEvent) => void
  wheel: (event: WheelEvent) => void
}

export type CleanupFn = () => void

export const bindIsometricRendererDomEvents = (
  element: HTMLElement,
  handlers: IsometricRendererDomHandlers,
): CleanupFn => {
  element.addEventListener('pointerdown', handlers.pointerdown)
  element.addEventListener('pointermove', handlers.pointermove)
  element.addEventListener('pointerup', handlers.pointerup)
  element.addEventListener('pointerleave', handlers.pointerleave)
  element.addEventListener('contextmenu', handlers.contextmenu)
  element.addEventListener('wheel', handlers.wheel, { passive: false })

  return () => {
    element.removeEventListener('pointerdown', handlers.pointerdown)
    element.removeEventListener('pointermove', handlers.pointermove)
    element.removeEventListener('pointerup', handlers.pointerup)
    element.removeEventListener('pointerleave', handlers.pointerleave)
    element.removeEventListener('contextmenu', handlers.contextmenu)
    element.removeEventListener('wheel', handlers.wheel)
  }
}

export const observeIsometricResize = (
  element: Element,
  onResize: ResizeObserverCallback,
): CleanupFn => {
  const observer = new ResizeObserver(onResize)
  observer.observe(element)
  return () => observer.disconnect()
}

export const disposeIsometricSharedCaches = () => {
  disposeHazardTextureCache()
  disposeBlockTextureCache()
  disposeSpriteSharedTextures()
}

export const disposeIsometricSpriteTextureCaches = () => {
  disposeSpriteTextureCaches()
}

export interface DisposableResourceLike {
  dispose(): void
}

export interface CssRendererResourceLike {
  domElement: {
    remove(): void
  }
}

export interface IsometricRendererResourceDisposalOptions<TRenderObject> {
  clearPreviewVisuals: CleanupFn
  tokenMovePreviewRenderer: DisposableResourceLike
  disposeBuildGhost: CleanupFn
  disposeHazardGhost: CleanupFn
  hazardRenderer: DisposableResourceLike
  fieldEffectRenderer: DisposableResourceLike
  voxelRenderer: DisposableResourceLike
  renderObjects: Map<string, TRenderObject>
  disposeRenderObject: (renderObject: TRenderObject) => void
  gridRenderer: DisposableResourceLike
  controls?: DisposableResourceLike | null
  renderer?: DisposableResourceLike | null
  cssRenderer?: CssRendererResourceLike | null
}

export const disposeIsometricRendererResources = <TRenderObject>({
  clearPreviewVisuals,
  tokenMovePreviewRenderer,
  disposeBuildGhost,
  disposeHazardGhost,
  hazardRenderer,
  fieldEffectRenderer,
  voxelRenderer,
  renderObjects,
  disposeRenderObject,
  gridRenderer,
  controls,
  renderer,
  cssRenderer,
}: IsometricRendererResourceDisposalOptions<TRenderObject>) => {
  clearPreviewVisuals()
  tokenMovePreviewRenderer.dispose()
  disposeBuildGhost()
  disposeHazardGhost()
  hazardRenderer.dispose()
  fieldEffectRenderer.dispose()
  voxelRenderer.dispose()
  disposeIsometricSharedCaches()

  for (const renderObject of renderObjects.values()) {
    disposeRenderObject(renderObject)
  }

  renderObjects.clear()
  disposeIsometricSpriteTextureCaches()
  gridRenderer.dispose()
  controls?.dispose()
  renderer?.dispose()
  cssRenderer?.domElement.remove()
}
