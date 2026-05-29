import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { PokemonRenderObject, WorldSpriteState } from '~/utils/isometric/types'
import {
  disposePokemonRenderObject,
  updatePokemonRenderObjectFromSpawn,
} from '~/utils/isometric/tokenRenderer'
import { createTokenRenderGeometryCache } from '~/utils/isometric/tokenGeometryCache'

const spawnedPokemon = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  species: 'Trainer',
  slug: 'trainer',
  size: 'Trainer',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/trainer.png',
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

const makeRenderObject = (pokemon: SpawnedPokemon): PokemonRenderObject => {
  const spriteMaterial = new THREE.SpriteMaterial()
  const haloMaterial = new THREE.SpriteMaterial()
  const sprite = new THREE.Sprite(spriteMaterial)
  const halo = new THREE.Sprite(haloMaterial)
  const spriteState: WorldSpriteState = {
    sprite,
    material: spriteMaterial,
    halo,
    haloMaterial,
    haloColor: 0xff1f2d,
    texture: null,
    releaseTexture: null,
    assetKey: null,
    loadToken: 0,
    textureLoading: false,
    animationMeta: null,
    animationStartedAtMs: 0,
    currentFrame: -1,
    textureRepeat: new THREE.Vector2(1, 1),
    textureOffset: new THREE.Vector2(),
    mirroredX: false,
    onTextureLoadComplete: null,
    ghost: false,
    invalid: false,
  }

  sprite.scale.set(pokemon.width, pokemon.height, 1)
  halo.scale.set(pokemon.width * 1.25, pokemon.height * 1.15, 1)

  return {
    id: pokemon.id,
    sprite,
    spriteState,
    elevationBadge: new THREE.Object3D() as PokemonRenderObject['elevationBadge'],
    hpBar: new THREE.Object3D() as PokemonRenderObject['hpBar'],
    combatStageGlass: {
      mesh: new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()),
      texture: new THREE.Texture() as unknown as THREE.CanvasTexture,
      canvas: {} as HTMLCanvasElement,
      context: {} as CanvasRenderingContext2D,
      renderedKey: '',
      active: false,
    },
    volume: new THREE.Mesh(
      new THREE.BoxGeometry(pokemon.base, pokemon.clearance, pokemon.base),
      [new THREE.MeshBasicMaterial()],
    ) as PokemonRenderObject['volume'],
    edges: new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(pokemon.base, pokemon.clearance, pokemon.base))),
    proxy: new THREE.Mesh(
      new THREE.BoxGeometry(pokemon.base, pokemon.clearance, pokemon.base),
      new THREE.MeshBasicMaterial(),
    ),
    shadow: new THREE.Mesh(new THREE.CircleGeometry(0.5, 32), new THREE.MeshBasicMaterial()),
    currentCenter: new THREE.Vector3(),
    targetCenter: new THREE.Vector3(),
    width: pokemon.width,
    height: pokemon.height,
    base: pokemon.base,
    clearance: pokemon.clearance,
    elevation: pokemon.position.y,
    spriteUrl: pokemon.spriteUrl,
    backSpriteUrl: pokemon.backSpriteUrl,
    spriteAnimation: pokemon.spriteAnimation,
    backSpriteAnimation: pokemon.backSpriteAnimation,
    spriteCrop: pokemon.spriteCrop,
    facing: 'south-east',
    turned: false,
    displayName: pokemon.species,
    level: pokemon.level,
    currentHp: pokemon.currentHp,
    maxHp: pokemon.maxHp,
    combatStages: pokemon.combatStages,
    conditions: pokemon.conditions,
    tokenItems: pokemon.tokenItems,
    liftFactor: 0,
    liftTarget: 0,
  }
}

describe('token renderer', () => {
  it('resizes live token render objects when spawned dimensions change', () => {
    const renderObject = makeRenderObject(spawnedPokemon())
    const resized = spawnedPokemon({ width: 0.85, height: 1.7, clearance: 2 })

    updatePokemonRenderObjectFromSpawn(renderObject, resized)

    expect(renderObject.width).toBe(0.85)
    expect(renderObject.height).toBe(1.7)
    expect(renderObject.clearance).toBe(2)
    expect(renderObject.sprite.scale.x).toBeCloseTo(0.85)
    expect(renderObject.sprite.scale.y).toBeCloseTo(1.7)
    expect(renderObject.spriteState.halo.scale.x).toBeCloseTo(0.85 * 1.25)
    expect(renderObject.spriteState.halo.scale.y).toBeCloseTo(1.7 * 1.15)
    expect(renderObject.volume.geometry.parameters.height).toBe(2)
    expect(renderObject.proxy.geometry.parameters.height).toBe(2)
    expect(renderObject.shadow.geometry.parameters.radius).toBeCloseTo(0.67)
  })

  it('reuses cached live token volume, edge, and proxy geometries by dimensions', () => {
    const cache = createTokenRenderGeometryCache()
    const first = makeRenderObject(spawnedPokemon({ id: 'first-token' }))
    const second = makeRenderObject(spawnedPokemon({ id: 'second-token' }))
    const firstResized = spawnedPokemon({
      id: 'first-token',
      base: 2,
      clearance: 3,
      width: 0.85,
      height: 2.25,
    })
    const secondResized = spawnedPokemon({
      id: 'second-token',
      base: 2,
      clearance: 3,
      width: 1.5,
      height: 2.25,
    })

    updatePokemonRenderObjectFromSpawn(first, firstResized, { geometryCache: cache })
    updatePokemonRenderObjectFromSpawn(second, secondResized, { geometryCache: cache })

    expect(first.volume.geometry).toBe(second.volume.geometry)
    expect(first.edges.geometry).toBe(second.edges.geometry)
    expect(first.proxy.geometry).toBe(second.proxy.geometry)
    expect(first.proxy.geometry).not.toBe(first.volume.geometry)
    expect(first.volume.geometry.parameters.width).toBe(2)
    expect(first.volume.geometry.parameters.height).toBe(3)
    expect(first.proxy.geometry.parameters.width).toBe(2)
    expect(first.proxy.geometry.parameters.height).toBe(3)
    expect(cache.snapshot()).toEqual({
      volumeBoxGeometryCount: 1,
      volumeEdgesGeometryCount: 1,
      proxyBoxGeometryCount: 1,
    })
  })

  it('keeps shared token geometries alive until every render object releases them', () => {
    const cache = createTokenRenderGeometryCache()
    const first = makeRenderObject(spawnedPokemon({ id: 'first-token' }))
    const second = makeRenderObject(spawnedPokemon({ id: 'second-token' }))
    const firstResized = spawnedPokemon({ id: 'first-token', base: 2, clearance: 3 })
    const secondResized = spawnedPokemon({ id: 'second-token', base: 2, clearance: 3 })

    updatePokemonRenderObjectFromSpawn(first, firstResized, { geometryCache: cache })
    updatePokemonRenderObjectFromSpawn(second, secondResized, { geometryCache: cache })

    const volumeDisposeSpy = vi.spyOn(first.volume.geometry, 'dispose')
    const edgesDisposeSpy = vi.spyOn(first.edges.geometry, 'dispose')
    const proxyDisposeSpy = vi.spyOn(first.proxy.geometry, 'dispose')

    disposePokemonRenderObject(first)

    expect(volumeDisposeSpy).not.toHaveBeenCalled()
    expect(edgesDisposeSpy).not.toHaveBeenCalled()
    expect(proxyDisposeSpy).not.toHaveBeenCalled()
    expect(cache.snapshot()).toEqual({
      volumeBoxGeometryCount: 1,
      volumeEdgesGeometryCount: 1,
      proxyBoxGeometryCount: 1,
    })

    disposePokemonRenderObject(second)

    expect(volumeDisposeSpy).toHaveBeenCalledTimes(1)
    expect(edgesDisposeSpy).toHaveBeenCalledTimes(1)
    expect(proxyDisposeSpy).toHaveBeenCalledTimes(1)
    expect(cache.snapshot()).toEqual({
      volumeBoxGeometryCount: 0,
      volumeEdgesGeometryCount: 0,
      proxyBoxGeometryCount: 0,
    })
  })

  it('releases cached geometry dimensions when tokens resize away from them', () => {
    const cache = createTokenRenderGeometryCache()
    const first = makeRenderObject(spawnedPokemon({ id: 'first-token' }))
    const second = makeRenderObject(spawnedPokemon({ id: 'second-token' }))

    updatePokemonRenderObjectFromSpawn(first, spawnedPokemon({ id: 'first-token', base: 2, clearance: 2 }), {
      geometryCache: cache,
    })
    updatePokemonRenderObjectFromSpawn(second, spawnedPokemon({ id: 'second-token', base: 2, clearance: 2 }), {
      geometryCache: cache,
    })

    const oldVolumeGeometry = first.volume.geometry
    const oldProxyGeometry = first.proxy.geometry
    const oldVolumeDisposeSpy = vi.spyOn(oldVolumeGeometry, 'dispose')
    const oldProxyDisposeSpy = vi.spyOn(oldProxyGeometry, 'dispose')

    updatePokemonRenderObjectFromSpawn(first, spawnedPokemon({ id: 'first-token', base: 3, clearance: 2 }), {
      geometryCache: cache,
    })

    expect(oldVolumeDisposeSpy).not.toHaveBeenCalled()
    expect(oldProxyDisposeSpy).not.toHaveBeenCalled()
    expect(second.volume.geometry).toBe(oldVolumeGeometry)
    expect(second.proxy.geometry).toBe(oldProxyGeometry)

    updatePokemonRenderObjectFromSpawn(second, spawnedPokemon({ id: 'second-token', base: 3, clearance: 2 }), {
      geometryCache: cache,
    })

    expect(oldVolumeDisposeSpy).toHaveBeenCalledTimes(1)
    expect(oldProxyDisposeSpy).toHaveBeenCalledTimes(1)
    expect(first.volume.geometry).toBe(second.volume.geometry)
    expect(first.proxy.geometry).toBe(second.proxy.geometry)
  })
})
