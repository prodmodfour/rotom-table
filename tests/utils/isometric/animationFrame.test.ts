import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { stepIsometricAnimationFrame } from '~/utils/isometric/animationFrame'
import type { PokemonRenderObject } from '~/utils/isometric/types'

describe('isometric animation frame', () => {
  it('steps scene animation, preview animation, and renderers in one place', () => {
    const camera = new THREE.OrthographicCamera()
    camera.position.set(5, 6, 5)
    const scene = new THREE.Scene()
    const renderObject = {
      currentCenter: new THREE.Vector3(0, 0, 0),
      targetCenter: new THREE.Vector3(10, 0, 0),
    } as PokemonRenderObject
    const renderObjects = [renderObject]
    const applyRenderObjectPosition = vi.fn()
    const controls = { target: new THREE.Vector3(0, 0, 0), update: vi.fn() }
    const fieldEffectRenderer = { update: vi.fn() }
    const tokenMovePreviewRenderer = { animate: vi.fn() }
    const renderer = { render: vi.fn() }
    const cssRenderer = { render: vi.fn() }
    const animateRenderObject = vi.fn()

    const result = stepIsometricAnimationFrame({
      clock: { getDelta: () => 0.2, elapsedTime: 12.5 },
      renderObjects,
      applyRenderObjectPosition,
      controls,
      fieldEffectRenderer,
      tokenMovePreviewRenderer,
      selectedPokemon: null,
      previewPositionY: 3,
      camera,
      renderer,
      cssRenderer,
      scene,
      facingDirection: new THREE.Vector2(1, 0),
      frameNowMs: 1234,
      animateRenderObject,
    })

    expect(result.delta).toBe(0.1)
    expect(result.damping).toBeGreaterThan(0)
    expect(result.damping).toBeLessThan(1)
    expect(renderObject.currentCenter.x).toBeGreaterThan(0)
    expect(renderObject.currentCenter.x).toBeLessThan(10)
    expect(applyRenderObjectPosition).toHaveBeenCalledWith(renderObject)
    expect(controls.update).toHaveBeenCalledOnce()
    expect(fieldEffectRenderer.update).toHaveBeenCalledWith(0.1, 12.5)
    expect(animateRenderObject).toHaveBeenCalledWith(
      renderObject,
      expect.objectContaining({ frameNowMs: 1234 }),
    )
    expect(tokenMovePreviewRenderer.animate).toHaveBeenCalledWith(
      expect.objectContaining({ positionY: 3, frameNowMs: 1234 }),
    )
    expect(renderer.render).toHaveBeenCalledWith(scene, camera)
    expect(cssRenderer.render).toHaveBeenCalledWith(scene, camera)
  })

  it('snaps render objects already at their target', () => {
    const center = new THREE.Vector3(1, 2, 3)
    const target = new THREE.Vector3(1.0000001, 2, 3)
    const renderObject = {
      currentCenter: center,
      targetCenter: target,
    } as PokemonRenderObject

    stepIsometricAnimationFrame({
      clock: { getDelta: () => 0.016, elapsedTime: 1 },
      renderObjects: [renderObject],
      applyRenderObjectPosition: vi.fn(),
      controls: { target: new THREE.Vector3(), update: vi.fn() },
      fieldEffectRenderer: { update: vi.fn() },
      tokenMovePreviewRenderer: { animate: vi.fn() },
      selectedPokemon: null,
      previewPositionY: null,
      camera: new THREE.OrthographicCamera(),
      renderer: { render: vi.fn() },
      cssRenderer: { render: vi.fn() },
      scene: new THREE.Scene(),
      facingDirection: new THREE.Vector2(1, 0),
      frameNowMs: 1,
      animateRenderObject: vi.fn(),
    })

    expect(renderObject.currentCenter.equals(target)).toBe(true)
  })
})
