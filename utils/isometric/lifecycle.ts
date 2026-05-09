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
