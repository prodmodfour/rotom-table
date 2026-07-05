import * as THREE from 'three'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  applyAnimationFrame,
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

type SpriteShaderTestDouble = {
  vertexShader: string
  fragmentShader: string
  uniforms: Record<string, { value: unknown }>
}

const makeSpriteShader = (): SpriteShaderTestDouble => ({
  vertexShader: THREE.ShaderLib.sprite.vertexShader,
  fragmentShader: THREE.ShaderLib.sprite.fragmentShader,
  uniforms: {},
})

const compileSpriteShader = (state: ReturnType<typeof buildWorldSprite>): SpriteShaderTestDouble => {
  const shader = makeSpriteShader()
  state.material.onBeforeCompile(shader as never, null as never)
  return shader
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

  it('keeps the lighting ramp sprite-local when a cropped static texture resolves', async () => {
    const state = buildWorldSprite(spawnedPokemon({
      spriteCrop: {
        canvasWidth: 128,
        canvasHeight: 64,
        left: 16,
        top: 8,
        width: 32,
        height: 24,
      },
    }))
    const texture = new THREE.Texture()
    texture.repeat.set(0.25, 0.375)
    texture.offset.set(0.125, 0.5)

    spriteTextureMock.staticLoads[0].resolve(texture)
    await flushTextureLoad()

    expect(state.texture).toBe(texture)
    expect(state.textureRepeat.x).toBeCloseTo(0.25)
    expect(state.textureRepeat.y).toBeCloseTo(0.375)
    expect(state.textureOffset.x).toBeCloseTo(0.125)
    expect(state.textureOffset.y).toBeCloseTo(0.5)

    const shader = compileSpriteShader(state)
    expect(shader.vertexShader).toContain('vWorldSpriteIsoUv = uv;')
    expect(shader.fragmentShader).toContain('worldSpriteIsoLightingMultiplier(vWorldSpriteIsoUv)')
    expect(shader.fragmentShader).toContain('worldSpriteIsoLightingUv')
    expect(shader.uniforms.worldSpriteIsoMirrorX.value).toBe(0)
  })

  it('keeps the lighting material active while animated frames update the texture window', async () => {
    const state = buildWorldSprite(spawnedPokemon({
      spriteUrl: '/trainer-animated.png',
      spriteAnimation: {
        url: '/trainer-animated.png',
        frameWidth: 16,
        frameHeight: 16,
        frames: 4,
        columns: 2,
        rows: 2,
        durationsMs: [100, 100, 100, 100],
        totalDurationMs: 400,
      },
    }))
    const texture = new THREE.Texture()

    expect(spriteTextureMock.animatedLoads.map((load) => load.url)).toEqual(['/trainer-animated.png'])

    spriteTextureMock.animatedLoads[0].resolve(texture)
    await flushTextureLoad()

    state.animationStartedAtMs = 0
    state.currentFrame = -1
    applyAnimationFrame(state, 150)

    expect(state.texture).toBe(texture)
    expect(state.currentFrame).toBe(1)
    expect(state.textureRepeat.x).toBeCloseTo(0.5)
    expect(state.textureRepeat.y).toBeCloseTo(0.5)
    expect(state.textureOffset.x).toBeCloseTo(0.5)
    expect(state.textureOffset.y).toBeCloseTo(0.5)
    expect(texture.repeat.x).toBeCloseTo(0.5)
    expect(texture.repeat.y).toBeCloseTo(0.5)
    expect(texture.offset.x).toBeCloseTo(0.5)
    expect(texture.offset.y).toBeCloseTo(0.5)
    expect(compileSpriteShader(state).fragmentShader).toContain('worldSpriteIsoLightingMultiplier')
  })

  it('updates the lighting mirror uniform when side-facing sprites are mirrored', () => {
    const state = buildWorldSprite(spawnedPokemon())
    const texture = new THREE.Texture()
    const camera = new THREE.PerspectiveCamera()
    const shader = compileSpriteShader(state)

    state.texture = texture
    state.textureRepeat.set(0.25, 0.5)
    state.textureOffset.set(0.5, 0.25)

    expect(shader.uniforms.worldSpriteIsoMirrorX.value).toBe(0)

    camera.position.set(0, 0, 10)
    updateSpriteFacing(state, {
      camera,
      center: new THREE.Vector3(0, 0, 0),
      facingDirection: { x: 1, y: 0 },
      frontSpriteUrl: '/trainer-front.png',
    })

    expect(state.mirroredX).toBe(true)
    expect(shader.uniforms.worldSpriteIsoMirrorX.value).toBe(1)
    expect(texture.repeat.x).toBeCloseTo(-0.25)
    expect(texture.offset.x).toBeCloseTo(0.75)

    camera.position.set(10, 0, 0)
    updateSpriteFacing(state, {
      camera,
      center: new THREE.Vector3(0, 0, 0),
      facingDirection: { x: 1, y: 0 },
      frontSpriteUrl: '/trainer-front.png',
    })

    expect(state.mirroredX).toBe(false)
    expect(shader.uniforms.worldSpriteIsoMirrorX.value).toBe(0)
    expect(texture.repeat.x).toBeCloseTo(0.25)
    expect(texture.offset.x).toBeCloseTo(0.5)
  })

  it('keeps lighting on the same material while front and back sprite assets swap', () => {
    const state = buildWorldSprite(spawnedPokemon({ backSpriteUrl: '/trainer-back.png' }))
    const material = state.material
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(-10, 0, 0)

    updateSpriteFacing(state, {
      camera,
      center: new THREE.Vector3(0, 0, 0),
      facingDirection: { x: 1, y: 0 },
      frontSpriteUrl: '/trainer-front.png',
      backSpriteUrl: '/trainer-back.png',
    })

    expect(state.material).toBe(material)
    expect(state.material.customProgramCacheKey()).toBe(WORLD_SPRITE_ISO_LIGHTING_SHADER_CACHE_KEY)
    expect(spriteTextureMock.staticLoads.map((load) => load.url)).toEqual([
      '/trainer-front.png',
      '/trainer-back.png',
    ])
    expect(compileSpriteShader(state).fragmentShader).toContain('worldSpriteIsoLightingMultiplier')
  })

  it('accounts for legacy turned facing when choosing the visible sprite asset', () => {
    const state = buildWorldSprite(spawnedPokemon({ backSpriteUrl: '/trainer-back.png' }))
    const camera = new THREE.PerspectiveCamera()
    camera.position.set(10, 0, 0)

    updateSpriteFacing(state, {
      camera,
      center: new THREE.Vector3(0, 0, 0),
      facingDirection: { x: 1, y: 0 },
      frontSpriteUrl: '/trainer-front.png',
      backSpriteUrl: '/trainer-back.png',
      turned: true,
    })

    expect(spriteTextureMock.staticLoads.map((load) => load.url)).toEqual([
      '/trainer-front.png',
      '/trainer-back.png',
    ])
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
