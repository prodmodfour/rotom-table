import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acquireStaticSpriteTexture,
  disposeSpriteSharedTextures,
  disposeSpriteTextureCaches,
  getContactShadowTexture,
  getSpriteHaloTexture,
  getTransparentSpriteTexture,
} from '~/utils/isometric/spriteTextures'

interface TextureLoadCall {
  url: string
  onLoad?: (texture: THREE.Texture) => void
  onError?: (error: unknown) => void
}

const stubCanvasDocument = () => {
  const gradient = { addColorStop: vi.fn() }
  const context = {
    createRadialGradient: vi.fn(() => gradient),
    fillRect: vi.fn(),
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D
  const createElement = vi.fn((tagName: string) => {
    if (tagName !== 'canvas') throw new Error(`Unexpected element: ${tagName}`)

    return {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement
  })

  vi.stubGlobal('document', { createElement })

  return { createElement }
}

const stubTextureLoader = () => {
  const calls: TextureLoadCall[] = []
  const load = vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation((
    url: string,
    onLoad?: (texture: THREE.Texture) => void,
    _onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ) => {
    calls.push({ url, onLoad, onError })
    return new THREE.Texture()
  })

  return { calls, load }
}

describe('isometric sprite texture cleanup', () => {
  afterEach(() => {
    disposeSpriteTextureCaches()
    disposeSpriteSharedTextures()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('disposes shared sprite helper textures and recreates them after route cleanup', () => {
    stubCanvasDocument()
    const contactShadow = getContactShadowTexture()
    const halo = getSpriteHaloTexture()
    const transparent = getTransparentSpriteTexture()
    const contactShadowDispose = vi.spyOn(contactShadow, 'dispose')
    const haloDispose = vi.spyOn(halo, 'dispose')
    const transparentDispose = vi.spyOn(transparent, 'dispose')

    disposeSpriteSharedTextures()

    expect(contactShadowDispose).toHaveBeenCalledOnce()
    expect(haloDispose).toHaveBeenCalledOnce()
    expect(transparentDispose).toHaveBeenCalledOnce()
    expect(getContactShadowTexture()).not.toBe(contactShadow)
    expect(getSpriteHaloTexture()).not.toBe(halo)
    expect(getTransparentSpriteTexture()).not.toBe(transparent)
  })

  it('disposes cloned sprite textures when a pending handle is released before load completion', async () => {
    const { calls } = stubTextureLoader()
    const handle = acquireStaticSpriteTexture('/sprites/pikachu.png')
    const baseTexture = new THREE.Texture()
    const clonedTexture = new THREE.Texture()
    const clone = vi.spyOn(baseTexture, 'clone').mockReturnValue(clonedTexture)
    const clonedDispose = vi.spyOn(clonedTexture, 'dispose')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/sprites/pikachu.png')

    handle.release()
    calls[0].onLoad?.(baseTexture)

    await expect(handle.promise).resolves.toBe(clonedTexture)
    expect(clone).toHaveBeenCalledOnce()
    expect(clonedDispose).toHaveBeenCalled()
  })

  it('disposes decoded base sprite textures from the cache and reloads them on demand', async () => {
    const { calls, load } = stubTextureLoader()
    const firstHandle = acquireStaticSpriteTexture('/sprites/eevee.png')
    const firstBaseTexture = new THREE.Texture()
    const firstCloneTexture = new THREE.Texture()
    const firstBaseDispose = vi.spyOn(firstBaseTexture, 'dispose')

    vi.spyOn(firstBaseTexture, 'clone').mockReturnValue(firstCloneTexture)
    calls[0].onLoad?.(firstBaseTexture)
    await expect(firstHandle.promise).resolves.toBe(firstCloneTexture)

    disposeSpriteTextureCaches()

    expect(firstBaseDispose).toHaveBeenCalledOnce()

    const secondHandle = acquireStaticSpriteTexture('/sprites/eevee.png')
    const secondBaseTexture = new THREE.Texture()
    const secondCloneTexture = new THREE.Texture()

    vi.spyOn(secondBaseTexture, 'clone').mockReturnValue(secondCloneTexture)
    calls[1].onLoad?.(secondBaseTexture)

    await expect(secondHandle.promise).resolves.toBe(secondCloneTexture)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
