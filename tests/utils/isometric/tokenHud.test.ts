import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import { updateElevationBadge } from '~/utils/isometric/tokenHud'

const makeBadge = () => {
  const position = new THREE.Vector3()
  const setPosition = vi.spyOn(position, 'set')
  let textContent = ''
  let textWrites = 0
  const element = {} as HTMLElement

  Object.defineProperty(element, 'textContent', {
    get: () => textContent,
    set: (next: string | null) => {
      textWrites += 1
      textContent = next ?? ''
    },
  })

  const badge = {
    element,
    position,
    userData: {},
    visible: false,
  } as unknown as CSS3DSprite

  return {
    badge,
    setPosition,
    textWrites: () => textWrites,
    textContent: () => textContent,
  }
}

describe('token HUD elevation badge rendering', () => {
  it('skips repeated badge writes when the hover-visible state is unchanged', () => {
    const { badge, setPosition, textWrites, textContent } = makeBadge()
    const center = new THREE.Vector3(1, 2, 3)

    updateElevationBadge({
      badge,
      center,
      base: 1,
      elevation: 3,
      groundLevelY: 1,
      camera: null,
      show: true,
    })

    expect(badge.visible).toBe(true)
    expect(setPosition).toHaveBeenCalledTimes(1)
    expect(textWrites()).toBe(1)
    expect(textContent()).toBe('+2 ↑')

    updateElevationBadge({
      badge,
      center,
      base: 1,
      elevation: 3,
      groundLevelY: 1,
      camera: null,
      show: true,
    })

    expect(badge.visible).toBe(true)
    expect(setPosition).toHaveBeenCalledTimes(1)
    expect(textWrites()).toBe(1)
  })

  it('refreshes the badge when output-relevant position or text changes', () => {
    const { badge, setPosition, textWrites, textContent } = makeBadge()
    const center = new THREE.Vector3(1, 2, 3)

    updateElevationBadge({
      badge,
      center,
      base: 1,
      elevation: 3,
      groundLevelY: 1,
      camera: null,
      show: true,
    })
    updateElevationBadge({
      badge,
      center: new THREE.Vector3(2, 2, 3),
      base: 1,
      elevation: 3,
      groundLevelY: 1,
      camera: null,
      show: true,
    })

    expect(setPosition).toHaveBeenCalledTimes(2)
    expect(textWrites()).toBe(1)

    updateElevationBadge({
      badge,
      center: new THREE.Vector3(2, 2, 3),
      base: 1,
      elevation: 4,
      groundLevelY: 1,
      camera: null,
      show: true,
    })

    expect(setPosition).toHaveBeenCalledTimes(3)
    expect(textWrites()).toBe(2)
    expect(textContent()).toBe('+3 ↑')
  })

  it('does not repeatedly hide an already hidden badge', () => {
    const { badge, setPosition, textWrites } = makeBadge()

    updateElevationBadge({
      badge,
      center: new THREE.Vector3(1, 2, 3),
      base: 1,
      elevation: 3,
      groundLevelY: 1,
      camera: null,
      show: false,
    })
    updateElevationBadge({
      badge,
      center: new THREE.Vector3(1, 2, 3),
      base: 1,
      elevation: 3,
      groundLevelY: 1,
      camera: null,
      show: false,
    })

    expect(badge.visible).toBe(false)
    expect(setPosition).not.toHaveBeenCalled()
    expect(textWrites()).toBe(0)
  })
})
