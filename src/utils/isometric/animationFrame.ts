import type * as THREE from 'three'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { PokemonRenderObject } from '~/utils/isometric/types'
import type { MoveVfxRendererFrameContext } from '~/utils/isometric/moveVfxRenderer'
import { getIsometricSpriteLighting } from '~/utils/isometric/spriteLighting'
import { tokenCenterLerpNeedsAnimation } from '~/utils/isometric/tokenRenderState'
import { animatePokemonRenderObject } from '~/utils/isometric/tokenRenderer'
import { nowMs } from '~/utils/isometric/worldSprites'

export interface IsometricAnimationFrameResult {
  delta: number
  damping: number
  frameNowMs: number
  spriteBrightness: number
  haloAlpha: number
  cssRendered: boolean
}

export interface IsometricCss3DRenderDirtyTrackerLike {
  markDirty?: (reason?: 'camera' | 'targeting' | 'token-style') => void
  consumeDirty: () => boolean
}

export interface IsometricMoveVfxAnimationFrameRenderer {
  animate: (frameContext: MoveVfxRendererFrameContext) => void
  needsAnimationFrame?: () => boolean
}

export interface IsometricAnimationFrameOptions {
  clock: Pick<THREE.Clock, 'getDelta' | 'elapsedTime'>
  renderObjects: Iterable<PokemonRenderObject>
  applyRenderObjectPosition: (renderObject: PokemonRenderObject) => boolean | void
  controls: { target: THREE.Vector3; update: () => boolean | void }
  fieldEffectRenderer: {
    update: (delta: number, elapsedTime: number) => void
    needsAnimationFrame?: () => boolean
  }
  tokenMovePreviewRenderer: {
    animate: (options: {
      pokemon: SpawnedPokemon | null
      positionY: number | null
      camera: THREE.Camera
      frameNowMs: number
      spriteBrightness: number
      haloAlpha: number
    }) => void
  }
  moveVfxRenderer?: IsometricMoveVfxAnimationFrameRenderer | null
  moveVfxRenderObjects?: ReadonlyMap<string, PokemonRenderObject>
  moveVfxVisible?: boolean
  selectedPokemon: SpawnedPokemon | null
  previewPositionY: number | null
  camera: THREE.Camera
  renderer: { render: (scene: THREE.Scene, camera: THREE.Camera) => void }
  cssRenderer: { render: (scene: THREE.Scene, camera: THREE.Camera) => void }
  scene: THREE.Scene
  facingDirection: THREE.Vector2
  frameNowMs?: number
  animateRenderObject?: typeof animatePokemonRenderObject
  beforeRender?: () => boolean | void
  css3DRenderDirtyTracker?: IsometricCss3DRenderDirtyTrackerLike
}

export const stepIsometricAnimationFrame = (
  options: IsometricAnimationFrameOptions,
): IsometricAnimationFrameResult => {
  const delta = Math.min(options.clock.getDelta(), 0.1)
  const damping = 1 - Math.exp(-delta * 12)
  const renderObjects = Array.from(options.renderObjects)

  for (const renderObject of renderObjects) {
    if (tokenCenterLerpNeedsAnimation(renderObject)) {
      renderObject.currentCenter.lerp(renderObject.targetCenter, damping)
    } else {
      renderObject.currentCenter.copy(renderObject.targetCenter)
    }

    if (options.applyRenderObjectPosition(renderObject) === true) {
      options.css3DRenderDirtyTracker?.markDirty?.('token-style')
    }
  }

  const controlsChanged = options.controls.update() === true
  if (controlsChanged) options.css3DRenderDirtyTracker?.markDirty?.('camera')

  if (options.fieldEffectRenderer.needsAnimationFrame?.() ?? true) {
    options.fieldEffectRenderer.update(delta, options.clock.elapsedTime)
  }

  const { spriteBrightness, haloAlpha } = getIsometricSpriteLighting({
    cameraPosition: options.camera.position,
    target: options.controls.target,
    facingDirection: options.facingDirection,
  })
  const frameNowMs = options.frameNowMs ?? nowMs()
  const animateRenderObject = options.animateRenderObject ?? animatePokemonRenderObject

  for (const renderObject of renderObjects) {
    animateRenderObject(renderObject, {
      camera: options.camera,
      damping,
      frameNowMs,
      spriteBrightness,
      haloAlpha,
    })
  }

  options.tokenMovePreviewRenderer.animate({
    pokemon: options.selectedPokemon,
    positionY: options.previewPositionY,
    camera: options.camera,
    frameNowMs,
    spriteBrightness,
    haloAlpha,
  })

  if (options.moveVfxRenderer && (options.moveVfxRenderer.needsAnimationFrame?.() ?? true)) {
    options.moveVfxRenderer.animate({
      frameNowMs,
      delta,
      elapsedTime: options.clock.elapsedTime,
      camera: options.camera,
      renderObjects: options.moveVfxRenderObjects,
      visible: options.moveVfxVisible,
    })
  }

  if (options.beforeRender?.() === true) {
    options.css3DRenderDirtyTracker?.markDirty?.('targeting')
  }

  const cssRendered = options.css3DRenderDirtyTracker?.consumeDirty() ?? true

  options.renderer.render(options.scene, options.camera)
  if (cssRendered) options.cssRenderer.render(options.scene, options.camera)

  return {
    delta,
    damping,
    frameNowMs,
    spriteBrightness,
    haloAlpha,
    cssRendered,
  }
}
