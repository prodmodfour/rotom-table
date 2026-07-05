import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  buildWorldSprite,
  disposeWorldSprite,
  updateSpriteFacing,
} from '~/utils/isometric/worldSprites'
import { WORLD_SPRITE_ISO_LIGHTING_SHADER_CACHE_KEY } from '~/utils/isometric/worldSpriteIsoLighting'

const spriteTextureMock = vi.hoisted(() => {
  interface MockTextureLoad {
    url: string
    resolve: (texture: unknown) => void
    reject: (error: unknown) => void
    release: ReturnType<typeof vi.fn>
  }

  const staticLoads: MockTextureLoad[] = []
  const animatedLoads: MockTextureLoad[] = []

  const createHandle = (loads: MockTextureLoad[], url: string) => {
    let resolve!: (texture: unknown) => void
    let reject!: (error: unknown) => void
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    const release = vi.fn()
    loads.push({ url, resolve, reject, release })
    return { promise, release }
  }

  return {
    staticLoads,
    animatedLoads,
    acquireStaticSpriteTexture: vi.fn((url: string) => createHandle(staticLoads, url)),
    acquireAnimatedSpriteTexture: vi.fn((url: string) => createHandle(animatedLoads, url)),
  }
})

vi.mock('~/utils/isometric/spriteTextures', () => ({
  acquireStaticSpriteTexture: spriteTextureMock.acquireStaticSpriteTexture,
  acquireAnimatedSpriteTexture: spriteTextureMock.acquireAnimatedSpriteTexture,
  getContactShadowTexture: () => null,
  getSpriteHaloTexture: () => null,
  getTransparentSpriteTexture: () => null,
}))

const spawnedPokemon = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  species: 'Trainer',
  slug: 'trainer',
  size: 'Trainer',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/trainer-front.png',
  entityKind: 'trainer',
  id: 'trainer-token',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'trainer',
  sheetSlug: 'trainer',
  level: 1,
  currentHp: 10,
  maxHp: 10,
  atk: 1,
  satk: 1,
  def: 1,
  sdef: 1,
  defenderTypes: [],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  conditions: [],
  tokenItems: [],
  ...overrides,
})

const flushTextureLoad = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('world sprite material lighting', () => {
  beforeEach(() => {
    spriteTextureMock.staticLoads.length = 0
    spriteTextureMock.animatedLoads.length = 0
    spriteTextureMock.acquireStaticSpriteTexture.mockClear()
    spriteTextureMock.acquireAnimatedSpriteTexture.mockClear()
  })

  it('installs persistent isometric lighting only on normal sprite materials', () => {
    const normalState = buildWorldSprite(spawnedPokemon())
    const ghostState = buildWorldSprite(spawnedPokemon(), { ghost: true })
    const normalShader = {
      vertexShader: THREE.ShaderLib.sprite.vertexShader,
      fragmentShader: THREE.ShaderLib.sprite.fragmentShader,
      uniforms: {},
    }
    const ghostShader = {
      vertexShader: THREE.ShaderLib.sprite.vertexShader,
      fragmentShader: THREE.ShaderLib.sprite.fragmentShader,
      uniforms: {},
    }

    normalState.material.onBeforeCompile(normalShader as never, null as never)
    ghostState.material.onBeforeCompile(ghostShader as never, null as never)

    expect(normalState.material.customProgramCacheKey()).toBe(WORLD_SPRITE_ISO_LIGHTING_SHADER_CACHE_KEY)
    expect(normalShader.fragmentShader).toContain('worldSpriteIsoLightingMultiplier')
    expect(normalShader.fragmentShader).toContain('diffuseColor.rgb *= worldSpriteIsoLightingMultiplier')
    expect(ghostShader.fragmentShader).not.toContain('worldSpriteIsoLightingMultiplier')
  })
})

describe('world sprite texture loading', () => {
  beforeEach(() => {
    spriteTextureMock.staticLoads.length = 0
    spriteTextureMock.animatedLoads.length = 0
    spriteTextureMock.acquireStaticSpriteTexture.mockClear()
    spriteTextureMock.acquireAnimatedSpriteTexture.mockClear()
  })

  it('notifies after the current static sprite texture resolves', async () => {
    const onTextureLoadComplete = vi.fn()
    const state = buildWorldSprite(spawnedPokemon(), { onTextureLoadComplete })
    const texture = new THREE.Texture()

    expect(state.textureLoading).toBe(true)
    expect(spriteTextureMock.staticLoads).toHaveLength(1)

    spriteTextureMock.staticLoads[0].resolve(texture)
    await flushTextureLoad()

    expect(state.textureLoading).toBe(false)
    expect(state.texture).toBe(texture)
    expect(state.material.map).toBe(texture)
    expect(onTextureLoadComplete).toHaveBeenCalledTimes(1)
  })

  it('does not notify when an obsolete sprite texture load resolves', async () => {
    const onTextureLoadComplete = vi.fn()
    const state = buildWorldSprite(spawnedPokemon(), { onTextureLoadComplete })
    const frontTexture = new THREE.Texture()
    const backTexture = new THREE.Texture()
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(-10, 0, 0)

    updateSpriteFacing(state, {
      camera,
      center: new THREE.Vector3(0, 0, 0),
      facingDirection: { x: 1, y: 0 },
      frontSpriteUrl: '/trainer-front.png',
      backSpriteUrl: '/trainer-back.png',
    })

    expect(spriteTextureMock.staticLoads.map((load) => load.url)).toEqual([
      '/trainer-front.png',
      '/trainer-back.png',
    ])

    spriteTextureMock.staticLoads[0].resolve(frontTexture)
    await flushTextureLoad()

    expect(onTextureLoadComplete).not.toHaveBeenCalled()
    expect(spriteTextureMock.staticLoads[0].release).toHaveBeenCalledTimes(1)
    expect(state.textureLoading).toBe(true)
    expect(state.texture).toBeNull()

    spriteTextureMock.staticLoads[1].resolve(backTexture)
    await flushTextureLoad()

    expect(state.textureLoading).toBe(false)
    expect(state.texture).toBe(backTexture)
    expect(state.material.map).toBe(backTexture)
    expect(onTextureLoadComplete).toHaveBeenCalledTimes(1)
  })

  it('notifies when the current sprite texture load fails so render scheduling can settle', async () => {
    const onTextureLoadComplete = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const state = buildWorldSprite(spawnedPokemon(), { onTextureLoadComplete })

    spriteTextureMock.staticLoads[0].reject(new Error('decode failed'))
    await flushTextureLoad()

    expect(state.textureLoading).toBe(false)
    expect(state.assetKey).toBeNull()
    expect(onTextureLoadComplete).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      'Failed to load sprite texture',
      '/trainer-front.png',
      expect.any(Error),
    )

    warn.mockRestore()
  })

  it('clears pending texture notifications when a world sprite is disposed', async () => {
    const onTextureLoadComplete = vi.fn()
    const state = buildWorldSprite(spawnedPokemon(), { onTextureLoadComplete })

    disposeWorldSprite(state)
    spriteTextureMock.staticLoads[0].resolve(new THREE.Texture())
    await flushTextureLoad()

    expect(onTextureLoadComplete).not.toHaveBeenCalled()
    expect(spriteTextureMock.staticLoads[0].release).toHaveBeenCalledTimes(1)
  })
})
