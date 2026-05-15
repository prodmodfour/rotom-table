import type * as THREE from 'three'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { PokemonRenderObject } from '~/utils/isometric/types'
import { getIsometricSpriteLighting } from '~/utils/isometric/spriteLighting'
import { animatePokemonRenderObject } from '~/utils/isometric/tokenRenderer'
import { nowMs } from '~/utils/isometric/worldSprites'

export interface IsometricAnimationFrameResult {
  delta: number
  damping: number
  frameNowMs: number
  spriteBrightness: number
  haloAlpha: number
}

export interface IsometricAnimationFrameOptions {
  clock: Pick<THREE.Clock, 'getDelta' | 'elapsedTime'>
  renderObjects: Iterable<PokemonRenderObject>
  applyRenderObjectPosition: (renderObject: PokemonRenderObject) => void
  controls: { target: THREE.Vector3; update: () => void }
  fieldEffectRenderer: { update: (delta: number, elapsedTime: number) => void }
  tokenMovePreviewRenderer: {
    animate: (options: {
      pokemon: SpawnedPokemon | null
      positionY: number | null
      camera: THREE.Camera
      facingDirection: THREE.Vector2
      frameNowMs: number
      spriteBrightness: number
      haloAlpha: number
    }) => void
  }
  selectedPokemon: SpawnedPokemon | null
  previewPositionY: number | null
  camera: THREE.Camera
  renderer: { render: (scene: THREE.Scene, camera: THREE.Camera) => void }
  cssRenderer: { render: (scene: THREE.Scene, camera: THREE.Camera) => void }
  scene: THREE.Scene
  facingDirection: THREE.Vector2
  frameNowMs?: number
  animateRenderObject?: typeof animatePokemonRenderObject
  beforeRender?: () => void
}

export const stepIsometricAnimationFrame = (
  options: IsometricAnimationFrameOptions,
): IsometricAnimationFrameResult => {
  const delta = Math.min(options.clock.getDelta(), 0.1)
  const damping = 1 - Math.exp(-delta * 12)
  const renderObjects = Array.from(options.renderObjects)

  for (const renderObject of renderObjects) {
    if (renderObject.currentCenter.distanceToSquared(renderObject.targetCenter) < 0.000001) {
      renderObject.currentCenter.copy(renderObject.targetCenter)
    } else {
      renderObject.currentCenter.lerp(renderObject.targetCenter, damping)
    }

    options.applyRenderObjectPosition(renderObject)
  }

  options.controls.update()
  options.fieldEffectRenderer.update(delta, options.clock.elapsedTime)

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
      facingDirection: options.facingDirection,
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
    facingDirection: options.facingDirection,
    frameNowMs,
    spriteBrightness,
    haloAlpha,
  })

  options.beforeRender?.()

  options.renderer.render(options.scene, options.camera)
  options.cssRenderer.render(options.scene, options.camera)

  return {
    delta,
    damping,
    frameNowMs,
    spriteBrightness,
    haloAlpha,
  }
}
