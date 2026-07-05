import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { LayerVisibility } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { PokemonRenderObject, WorldSpriteState } from '~/utils/isometric/types'
import {
  disposePokemonRenderObject,
  paintPokemonRenderObjectStyle,
  setPokemonRenderObjectLayerVisibility,
  updatePokemonRenderObjectFromSpawn,
} from '~/utils/isometric/tokenRenderer'
import { createTokenRenderGeometryCache } from '~/utils/isometric/tokenGeometryCache'
import {
  accentVolumeFacePalette,
  resolveVolumeAccentColor,
  TERRAIN_PALETTE,
} from '~/utils/isometric/materials'

const visibleLayers = (overrides: Partial<LayerVisibility> = {}): LayerVisibility => ({
  terrain: true,
  shadows: true,
  tokens: true,
  grid: true,
  hazards: true,
  fieldEffects: true,
  ...overrides,
})

type TokenHudSprite = PokemonRenderObject['elevationBadge'] | PokemonRenderObject['hpBar']

const cssSpriteStub = <T extends TokenHudSprite>(): T => Object.assign(
  new THREE.Object3D(),
  { element: { style: { display: '' } } },
) as T

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
    elevationBadge: cssSpriteStub<PokemonRenderObject['elevationBadge']>(),
    hpBar: cssSpriteStub<PokemonRenderObject['hpBar']>(),
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
      Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial()),
    ) as PokemonRenderObject['volume'],
    edges: new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(pokemon.base, pokemon.clearance, pokemon.base)),
      new THREE.LineBasicMaterial(),
    ),
    cageVisible: false,
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
    accentColor: pokemon.accentColor,
    liftFactor: 0,
    liftTarget: 0,
  }
}

const volumeMaterialColorHexes = (renderObject: PokemonRenderObject): number[] =>
  renderObject.volume.material.map((material) => material.color.getHex())

const volumePaletteColorHexes = (palette: ReturnType<typeof accentVolumeFacePalette>): number[] => [
  palette.shadow,
  palette.shadow,
  palette.top,
  palette.bottom,
  palette.side,
  palette.side,
]

type PaintPokemonRenderObjectStyleOptions = NonNullable<Parameters<typeof paintPokemonRenderObjectStyle>[2]>

describe('token renderer', () => {
  it('keeps sprites, shadows, and picking proxies visible while the cage is hidden', () => {
    const renderObject = makeRenderObject(spawnedPokemon())
    renderObject.cageVisible = false

    setPokemonRenderObjectLayerVisibility(renderObject, visibleLayers())

    expect(renderObject.sprite.visible).toBe(true)
    expect(renderObject.spriteState.halo.visible).toBe(true)
    expect(renderObject.proxy.visible).toBe(true)
    expect(renderObject.shadow.visible).toBe(true)
    expect(renderObject.volume.visible).toBe(false)
    expect(renderObject.edges.visible).toBe(false)
  })

  it('hides the token stack when token layer visibility is disabled', () => {
    const renderObject = makeRenderObject(spawnedPokemon())
    renderObject.cageVisible = true

    setPokemonRenderObjectLayerVisibility(renderObject, visibleLayers({ tokens: false }))

    expect(renderObject.sprite.visible).toBe(false)
    expect(renderObject.spriteState.halo.visible).toBe(false)
    expect(renderObject.proxy.visible).toBe(false)
    expect(renderObject.shadow.visible).toBe(false)
    expect(renderObject.volume.visible).toBe(false)
    expect(renderObject.edges.visible).toBe(false)
  })

  it('hides idle cages while preserving the visible sprite stack and picking proxy', () => {
    const renderObject = makeRenderObject(spawnedPokemon())

    paintPokemonRenderObjectStyle(renderObject, false)
    setPokemonRenderObjectLayerVisibility(renderObject, visibleLayers())

    expect(renderObject.cageVisible).toBe(false)
    expect(renderObject.volume.visible).toBe(false)
    expect(renderObject.edges.visible).toBe(false)
    expect(renderObject.sprite.visible).toBe(true)
    expect(renderObject.spriteState.halo.visible).toBe(true)
    expect(renderObject.shadow.visible).toBe(true)
    expect(renderObject.proxy.visible).toBe(true)
  })

  it.each([
    { label: 'hovered', selected: false, options: { hovered: true } },
    { label: 'selected', selected: true, options: {} },
    { label: 'pending', selected: false, options: { pending: true } },
    { label: 'corrected', selected: false, options: { corrected: true } },
  ] satisfies Array<{
    label: string
    selected: boolean
    options: PaintPokemonRenderObjectStyleOptions
  }>)('shows tactical cages for $label tokens', ({ selected, options }) => {
    const renderObject = makeRenderObject(spawnedPokemon())

    paintPokemonRenderObjectStyle(renderObject, selected, options)
    setPokemonRenderObjectLayerVisibility(renderObject, visibleLayers())

    expect(renderObject.cageVisible).toBe(true)
    expect(renderObject.volume.visible).toBe(true)
    expect(renderObject.edges.visible).toBe(true)
  })

  it('highlights hovered token cages with their app accent color', () => {
    const pokemon = spawnedPokemon({ accentColor: '#2e77d0' })
    const renderObject = makeRenderObject(pokemon)

    paintPokemonRenderObjectStyle(renderObject, false, { hovered: true })

    expect(volumeMaterialColorHexes(renderObject)).toEqual(
      volumePaletteColorHexes(accentVolumeFacePalette('#2e77d0')),
    )
    for (const material of renderObject.volume.material) {
      expect(material.opacity).toBeCloseTo(0.34)
    }
    const edgeMaterial = renderObject.edges.material as THREE.LineBasicMaterial
    expect(edgeMaterial.color.getHex()).toBe(resolveVolumeAccentColor('#2e77d0'))
    expect(edgeMaterial.opacity).toBeCloseTo(0.9)
    expect(edgeMaterial.transparent).toBe(true)
    expect(renderObject.cageVisible).toBe(true)
    expect(renderObject.liftTarget).toBe(0)
  })

  it('keeps selected hover cages in their app accent color without clearing selection lift', () => {
    const pokemon = spawnedPokemon({ accentColor: '#7c3aed' })
    const renderObject = makeRenderObject(pokemon)

    paintPokemonRenderObjectStyle(renderObject, true, { hovered: true })

    const edgeMaterial = renderObject.edges.material as THREE.LineBasicMaterial
    expect(edgeMaterial.color.getHex()).toBe(resolveVolumeAccentColor('#7c3aed'))
    expect(edgeMaterial.opacity).toBe(1)
    expect(edgeMaterial.transparent).toBe(false)
    expect(renderObject.liftTarget).toBe(1)
  })

  it('paints remote presence attention as a lower-priority token cage accent', () => {
    const renderObject = makeRenderObject(spawnedPokemon())

    paintPokemonRenderObjectStyle(renderObject, false, {
      remoteAttention: {
        selectedCount: 1,
        hoveredCount: 0,
        totalCount: 2,
        primaryColor: '#a78bfa',
      },
    })

    expect(volumeMaterialColorHexes(renderObject)).toEqual(
      volumePaletteColorHexes(accentVolumeFacePalette('#a78bfa')),
    )
    for (const material of renderObject.volume.material) {
      expect(material.opacity).toBeCloseTo(0.325)
    }
    const edgeMaterial = renderObject.edges.material as THREE.LineBasicMaterial
    expect(edgeMaterial.color.getHex()).toBe(resolveVolumeAccentColor('#a78bfa'))
    expect(edgeMaterial.opacity).toBeCloseTo(0.785)
    expect(renderObject.cageVisible).toBe(true)
    expect(renderObject.liftTarget).toBe(0)
  })

  it('keeps local selected, pending, and correction styling above remote presence attention', () => {
    const selectedRenderObject = makeRenderObject(spawnedPokemon())
    const pendingRenderObject = makeRenderObject(spawnedPokemon({ accentColor: '#f97316' }))
    const correctedRenderObject = makeRenderObject(spawnedPokemon())
    const remoteAttention = {
      selectedCount: 1,
      hoveredCount: 0,
      totalCount: 1,
      primaryColor: '#22d3ee',
    }

    paintPokemonRenderObjectStyle(selectedRenderObject, true, { remoteAttention })
    paintPokemonRenderObjectStyle(pendingRenderObject, false, { pending: true, remoteAttention })
    paintPokemonRenderObjectStyle(correctedRenderObject, false, { corrected: true, remoteAttention })

    expect(volumeMaterialColorHexes(selectedRenderObject)).toEqual(
      volumePaletteColorHexes(TERRAIN_PALETTE.selected),
    )
    expect((selectedRenderObject.edges.material as THREE.LineBasicMaterial).color.getHex()).toBe(0xf7f7f2)
    expect(selectedRenderObject.liftTarget).toBe(1)
    expect(volumeMaterialColorHexes(pendingRenderObject)).toEqual(
      volumePaletteColorHexes(accentVolumeFacePalette('#f97316')),
    )
    expect((pendingRenderObject.edges.material as THREE.LineBasicMaterial).color.getHex()).toBe(
      resolveVolumeAccentColor('#f97316'),
    )
    expect(volumeMaterialColorHexes(correctedRenderObject)).toEqual(
      volumePaletteColorHexes(TERRAIN_PALETTE.unreachable),
    )
    expect((correctedRenderObject.edges.material as THREE.LineBasicMaterial).color.getHex()).toBe(0xff4a55)
  })

  it('removes remote presence affordances when remote attention clears', () => {
    const renderObject = makeRenderObject(spawnedPokemon())

    paintPokemonRenderObjectStyle(renderObject, false, {
      remoteAttention: {
        selectedCount: 0,
        hoveredCount: 1,
        totalCount: 1,
        primaryColor: '#22d3ee',
      },
    })
    paintPokemonRenderObjectStyle(renderObject, false)

    expect(volumeMaterialColorHexes(renderObject)).toEqual(
      volumePaletteColorHexes(TERRAIN_PALETTE.idle),
    )
    const edgeMaterial = renderObject.edges.material as THREE.LineBasicMaterial
    expect(edgeMaterial.color.getHex()).toBe(0xaeb5bd)
    expect(edgeMaterial.opacity).toBeCloseTo(0.35)
    expect(renderObject.cageVisible).toBe(false)
  })

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
