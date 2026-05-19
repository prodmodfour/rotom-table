import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { PokemonRenderObject, WorldSpriteState } from '~/utils/isometric/types'
import { updatePokemonRenderObjectFromSpawn } from '~/utils/isometric/tokenRenderer'

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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial())
  const halo = new THREE.Sprite(new THREE.SpriteMaterial())
  const spriteState = { sprite, halo } as WorldSpriteState

  sprite.scale.set(pokemon.width, pokemon.height, 1)
  halo.scale.set(pokemon.width * 1.25, pokemon.height * 1.15, 1)

  return {
    id: pokemon.id,
    sprite,
    spriteState,
    elevationBadge: {} as PokemonRenderObject['elevationBadge'],
    hpBar: {} as PokemonRenderObject['hpBar'],
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
})
