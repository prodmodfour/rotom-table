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
    const fieldEffectRenderer = { update: vi.fn(), needsAnimationFrame: vi.fn(() => true) }
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
    expect(fieldEffectRenderer.needsAnimationFrame).toHaveBeenCalledOnce()
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
    expect(result.cssRendered).toBe(true)
  })

  it('advances active move VFX with scheduler frame context before render without dirtying CSS3D', () => {
    const camera = new THREE.OrthographicCamera()
    camera.position.set(5, 6, 5)
    const scene = new THREE.Scene()
    const renderObject = {
      currentCenter: new THREE.Vector3(1, 0, 1),
      targetCenter: new THREE.Vector3(1, 0, 1),
    } as PokemonRenderObject
    const renderObjects = new Map([['token-a', renderObject]])
    const moveVfxRenderer = {
      needsAnimationFrame: vi.fn(() => true),
      animate: vi.fn(),
    }
    const renderer = { render: vi.fn() }
    const cssRenderer = { render: vi.fn() }
    const css3DRenderDirtyTracker = {
      markDirty: vi.fn(),
      consumeDirty: vi.fn(() => false),
    }

    const result = stepIsometricAnimationFrame({
      clock: { getDelta: () => 0.016, elapsedTime: 2.5 },
      renderObjects: renderObjects.values(),
      applyRenderObjectPosition: vi.fn(() => false),
      controls: { target: new THREE.Vector3(), update: vi.fn(() => false) },
      fieldEffectRenderer: { update: vi.fn(), needsAnimationFrame: vi.fn(() => false) },
      tokenMovePreviewRenderer: { animate: vi.fn() },
      moveVfxRenderer,
      moveVfxRenderObjects: renderObjects,
      moveVfxVisible: false,
      moveVfxReducedMotion: true,
      selectedPokemon: null,
      previewPositionY: null,
      camera,
      renderer,
      cssRenderer,
      scene,
      facingDirection: new THREE.Vector2(1, 0),
      frameNowMs: 2500,
      animateRenderObject: vi.fn(),
      css3DRenderDirtyTracker,
    })

    expect(moveVfxRenderer.needsAnimationFrame).toHaveBeenCalledOnce()
    expect(moveVfxRenderer.animate).toHaveBeenCalledWith({
      frameNowMs: 2500,
      delta: 0.016,
      elapsedTime: 2.5,
      camera,
      renderObjects,
      visible: false,
      reducedMotion: true,
    })
    expect(moveVfxRenderer.animate.mock.invocationCallOrder[0]).toBeLessThan(
      renderer.render.mock.invocationCallOrder[0],
    )
    expect(css3DRenderDirtyTracker.markDirty).not.toHaveBeenCalled()
    expect(cssRenderer.render).not.toHaveBeenCalled()
    expect(result.cssRendered).toBe(false)
  })

  it('marks CSS3D dirty only when active move VFX reports CSS badge output', () => {
    const camera = new THREE.OrthographicCamera()
    const scene = new THREE.Scene()
    const moveVfxRenderer = {
      needsAnimationFrame: vi.fn(() => true),
      needsCss3DFrame: vi.fn(() => true),
      animate: vi.fn(),
    }
    const renderer = { render: vi.fn() }
    const cssRenderer = { render: vi.fn() }
    let dirty = false
    const css3DRenderDirtyTracker = {
      markDirty: vi.fn((reason?: string) => {
        if (reason === 'manual') dirty = true
      }),
      consumeDirty: vi.fn(() => dirty),
    }

    const result = stepIsometricAnimationFrame({
      clock: { getDelta: () => 0.016, elapsedTime: 1 },
      renderObjects: [],
      applyRenderObjectPosition: vi.fn(),
      controls: { target: new THREE.Vector3(), update: vi.fn() },
      fieldEffectRenderer: { update: vi.fn(), needsAnimationFrame: vi.fn(() => false) },
      tokenMovePreviewRenderer: { animate: vi.fn() },
      moveVfxRenderer,
      selectedPokemon: null,
      previewPositionY: null,
      camera,
      renderer,
      cssRenderer,
      scene,
      facingDirection: new THREE.Vector2(1, 0),
      frameNowMs: 1,
      animateRenderObject: vi.fn(),
      css3DRenderDirtyTracker,
    })

    expect(moveVfxRenderer.animate).toHaveBeenCalledOnce()
    expect(moveVfxRenderer.needsCss3DFrame).toHaveBeenCalledOnce()
    expect(css3DRenderDirtyTracker.markDirty).toHaveBeenCalledWith('manual')
    expect(renderer.render).toHaveBeenCalledWith(scene, camera)
    expect(cssRenderer.render).toHaveBeenCalledWith(scene, camera)
    expect(result.cssRendered).toBe(true)
  })

  it('skips idle move VFX animation work while still rendering the scheduled frame', () => {
    const camera = new THREE.OrthographicCamera()
    const scene = new THREE.Scene()
    const moveVfxRenderer = {
      needsAnimationFrame: vi.fn(() => false),
      animate: vi.fn(),
    }
    const renderer = { render: vi.fn() }

    stepIsometricAnimationFrame({
      clock: { getDelta: () => 0.016, elapsedTime: 1 },
      renderObjects: [],
      applyRenderObjectPosition: vi.fn(),
      controls: { target: new THREE.Vector3(), update: vi.fn() },
      fieldEffectRenderer: { update: vi.fn(), needsAnimationFrame: vi.fn(() => false) },
      tokenMovePreviewRenderer: { animate: vi.fn() },
      moveVfxRenderer,
      selectedPokemon: null,
      previewPositionY: null,
      camera,
      renderer,
      cssRenderer: { render: vi.fn() },
      scene,
      facingDirection: new THREE.Vector2(1, 0),
      frameNowMs: 1,
      animateRenderObject: vi.fn(),
    })

    expect(moveVfxRenderer.needsAnimationFrame).toHaveBeenCalledOnce()
    expect(moveVfxRenderer.animate).not.toHaveBeenCalled()
    expect(renderer.render).toHaveBeenCalledWith(scene, camera)
  })

  it('animates render objects when passed a one-shot map iterator', () => {
    const camera = new THREE.OrthographicCamera()
    camera.position.set(5, 6, 5)
    const scene = new THREE.Scene()
    const renderObject = {
      currentCenter: new THREE.Vector3(0, 0, 0),
      targetCenter: new THREE.Vector3(1, 0, 0),
    } as PokemonRenderObject
    const renderObjects = new Map([['token-a', renderObject]])
    const animateRenderObject = vi.fn()

    stepIsometricAnimationFrame({
      clock: { getDelta: () => 0.016, elapsedTime: 1 },
      renderObjects: renderObjects.values(),
      applyRenderObjectPosition: vi.fn(),
      controls: { target: new THREE.Vector3(), update: vi.fn() },
      fieldEffectRenderer: { update: vi.fn() },
      tokenMovePreviewRenderer: { animate: vi.fn() },
      selectedPokemon: null,
      previewPositionY: null,
      camera,
      renderer: { render: vi.fn() },
      cssRenderer: { render: vi.fn() },
      scene,
      facingDirection: new THREE.Vector2(1, 0),
      frameNowMs: 1,
      animateRenderObject,
    })

    expect(animateRenderObject).toHaveBeenCalledWith(renderObject, expect.objectContaining({ frameNowMs: 1 }))
  })

  it('skips field-effect update work when no animated effects are active', () => {
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera()
    const fieldEffectRenderer = { update: vi.fn(), needsAnimationFrame: vi.fn(() => false) }
    const renderer = { render: vi.fn() }
    const cssRenderer = { render: vi.fn() }

    stepIsometricAnimationFrame({
      clock: { getDelta: () => 0.016, elapsedTime: 1 },
      renderObjects: [],
      applyRenderObjectPosition: vi.fn(),
      controls: { target: new THREE.Vector3(), update: vi.fn() },
      fieldEffectRenderer,
      tokenMovePreviewRenderer: { animate: vi.fn() },
      selectedPokemon: null,
      previewPositionY: null,
      camera,
      renderer,
      cssRenderer,
      scene,
      facingDirection: new THREE.Vector2(1, 0),
      frameNowMs: 1,
      animateRenderObject: vi.fn(),
    })

    expect(fieldEffectRenderer.needsAnimationFrame).toHaveBeenCalledOnce()
    expect(fieldEffectRenderer.update).not.toHaveBeenCalled()
    expect(renderer.render).toHaveBeenCalledWith(scene, camera)
  })

  it('skips CSS3D renderer work when the dirty tracker has no CSS-visible changes', () => {
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera()
    const renderer = { render: vi.fn() }
    const cssRenderer = { render: vi.fn() }
    const css3DRenderDirtyTracker = { consumeDirty: vi.fn(() => false) }

    const result = stepIsometricAnimationFrame({
      clock: { getDelta: () => 0.016, elapsedTime: 1 },
      renderObjects: [],
      applyRenderObjectPosition: vi.fn(),
      controls: { target: new THREE.Vector3(), update: vi.fn() },
      fieldEffectRenderer: { update: vi.fn() },
      tokenMovePreviewRenderer: { animate: vi.fn() },
      selectedPokemon: null,
      previewPositionY: null,
      camera,
      renderer,
      cssRenderer,
      scene,
      facingDirection: new THREE.Vector2(1, 0),
      frameNowMs: 1,
      animateRenderObject: vi.fn(),
      css3DRenderDirtyTracker,
    })

    expect(renderer.render).toHaveBeenCalledWith(scene, camera)
    expect(css3DRenderDirtyTracker.consumeDirty).toHaveBeenCalledOnce()
    expect(cssRenderer.render).not.toHaveBeenCalled()
    expect(result.cssRendered).toBe(false)
  })

  it('renders CSS3D when the dirty tracker reports CSS-visible changes', () => {
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera()
    const renderer = { render: vi.fn() }
    const cssRenderer = { render: vi.fn() }
    const css3DRenderDirtyTracker = { consumeDirty: vi.fn(() => true) }

    const result = stepIsometricAnimationFrame({
      clock: { getDelta: () => 0.016, elapsedTime: 1 },
      renderObjects: [],
      applyRenderObjectPosition: vi.fn(),
      controls: { target: new THREE.Vector3(), update: vi.fn() },
      fieldEffectRenderer: { update: vi.fn() },
      tokenMovePreviewRenderer: { animate: vi.fn() },
      selectedPokemon: null,
      previewPositionY: null,
      camera,
      renderer,
      cssRenderer,
      scene,
      facingDirection: new THREE.Vector2(1, 0),
      frameNowMs: 1,
      animateRenderObject: vi.fn(),
      css3DRenderDirtyTracker,
    })

    expect(renderer.render).toHaveBeenCalledWith(scene, camera)
    expect(cssRenderer.render).toHaveBeenCalledWith(scene, camera)
    expect(result.cssRendered).toBe(true)
  })

  it('marks CSS3D dirty for same-frame OrbitControls damping changes', () => {
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera()
    const renderer = { render: vi.fn() }
    const cssRenderer = { render: vi.fn() }
    let dirty = false
    const css3DRenderDirtyTracker = {
      markDirty: vi.fn(() => {
        dirty = true
      }),
      consumeDirty: vi.fn(() => dirty),
    }

    const result = stepIsometricAnimationFrame({
      clock: { getDelta: () => 0.016, elapsedTime: 1 },
      renderObjects: [],
      applyRenderObjectPosition: vi.fn(),
      controls: { target: new THREE.Vector3(), update: vi.fn(() => true) },
      fieldEffectRenderer: { update: vi.fn() },
      tokenMovePreviewRenderer: { animate: vi.fn() },
      selectedPokemon: null,
      previewPositionY: null,
      camera,
      renderer,
      cssRenderer,
      scene,
      facingDirection: new THREE.Vector2(1, 0),
      frameNowMs: 1,
      animateRenderObject: vi.fn(),
      css3DRenderDirtyTracker,
    })

    expect(css3DRenderDirtyTracker.markDirty).toHaveBeenCalledWith('camera')
    expect(cssRenderer.render).toHaveBeenCalledWith(scene, camera)
    expect(result.cssRendered).toBe(true)
  })

  it('marks CSS3D dirty when token HUD position updates change CSS-visible state', () => {
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera()
    const renderer = { render: vi.fn() }
    const cssRenderer = { render: vi.fn() }
    const renderObject = {
      currentCenter: new THREE.Vector3(1, 2, 3),
      targetCenter: new THREE.Vector3(1, 2, 3),
    } as PokemonRenderObject
    let dirty = false
    const css3DRenderDirtyTracker = {
      markDirty: vi.fn((reason?: string) => {
        if (reason === 'token-style') dirty = true
      }),
      consumeDirty: vi.fn(() => dirty),
    }

    const result = stepIsometricAnimationFrame({
      clock: { getDelta: () => 0.016, elapsedTime: 1 },
      renderObjects: [renderObject],
      applyRenderObjectPosition: vi.fn(() => true),
      controls: { target: new THREE.Vector3(), update: vi.fn() },
      fieldEffectRenderer: { update: vi.fn() },
      tokenMovePreviewRenderer: { animate: vi.fn() },
      selectedPokemon: null,
      previewPositionY: null,
      camera,
      renderer,
      cssRenderer,
      scene,
      facingDirection: new THREE.Vector2(1, 0),
      frameNowMs: 1,
      animateRenderObject: vi.fn(),
      css3DRenderDirtyTracker,
    })

    expect(css3DRenderDirtyTracker.markDirty).toHaveBeenCalledWith('token-style')
    expect(cssRenderer.render).toHaveBeenCalledWith(scene, camera)
    expect(result.cssRendered).toBe(true)
  })

  it('marks CSS3D dirty when before-render UI overlays change', () => {
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera()
    const renderer = { render: vi.fn() }
    const cssRenderer = { render: vi.fn() }
    let dirty = false
    const css3DRenderDirtyTracker = {
      markDirty: vi.fn((reason?: string) => {
        if (reason === 'targeting') dirty = true
      }),
      consumeDirty: vi.fn(() => dirty),
    }

    const result = stepIsometricAnimationFrame({
      clock: { getDelta: () => 0.016, elapsedTime: 1 },
      renderObjects: [],
      applyRenderObjectPosition: vi.fn(),
      controls: { target: new THREE.Vector3(), update: vi.fn() },
      fieldEffectRenderer: { update: vi.fn() },
      tokenMovePreviewRenderer: { animate: vi.fn() },
      selectedPokemon: null,
      previewPositionY: null,
      camera,
      renderer,
      cssRenderer,
      scene,
      facingDirection: new THREE.Vector2(1, 0),
      frameNowMs: 1,
      animateRenderObject: vi.fn(),
      beforeRender: vi.fn(() => true),
      css3DRenderDirtyTracker,
    })

    expect(css3DRenderDirtyTracker.markDirty).toHaveBeenCalledWith('targeting')
    expect(cssRenderer.render).toHaveBeenCalledWith(scene, camera)
    expect(result.cssRendered).toBe(true)
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
