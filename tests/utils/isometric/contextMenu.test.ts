import { describe, expect, it } from 'vitest'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  createTokenContextMenuState,
  getTokenContextMenuButtonCount,
  getTokenContextMenuCapabilities,
  getTokenContextMenuPosition,
} from '~/utils/isometric/contextMenu'

const pokemon = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  id: 'token-1',
  species: 'Pikachu',
  slug: 'pikachu',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/pikachu.png',
  entityKind: 'pokemon',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
  position: { x: 0, y: 0, z: 0 },
  level: 1,
  currentHp: 10,
  maxHp: 10,
  atk: 1,
  satk: 1,
  def: 1,
  sdef: 1,
  defenderTypes: ['Electric'],
  combatStages: {},
  conditions: [],
  tokenItems: [],
  ...overrides,
} as SpawnedPokemon)

describe('isometric token context menu helpers', () => {
  it('derives token action capabilities from spawned token metadata', () => {
    expect(getTokenContextMenuCapabilities(pokemon({ backSpriteUrl: '/back.png' }))).toEqual({
      canTurn: true,
      canViewPokedex: true,
      canUseOrders: false,
      canThrowPokeball: false,
    })
    expect(getTokenContextMenuCapabilities(pokemon({
      entityKind: 'trainer',
      sheetKind: 'trainer',
      backSpriteUrl: '/back.png',
    }))).toEqual({
      canTurn: false,
      canViewPokedex: false,
      canUseOrders: true,
      canThrowPokeball: true,
    })
  })

  it('counts optional buttons and clamps menu position inside viewport bounds', () => {
    expect(getTokenContextMenuButtonCount({
      canTurn: true,
      canViewPokedex: true,
      canUseOrders: false,
      canThrowPokeball: false,
      canDeleteTokens: true,
    })).toBe(11)
    expect(getTokenContextMenuButtonCount({
      canTurn: false,
      canViewPokedex: false,
      canUseOrders: true,
      canThrowPokeball: true,
      canSendOut: true,
    })).toBe(11)

    expect(getTokenContextMenuPosition({
      clientX: 999,
      clientY: 999,
      bounds: { left: 100, top: 50, width: 500, height: 500 } as DOMRect,
      canTurn: true,
      canViewPokedex: true,
      canUseOrders: false,
      canThrowPokeball: false,
      canDeleteTokens: true,
    })).toEqual({ x: 358, y: 62 })
  })

  it('creates the state shape consumed by the Vue context menu', () => {
    expect(createTokenContextMenuState({
      pokemon: pokemon({ backSpriteUrl: '/back.png' }),
      clientX: 120,
      clientY: 75,
      bounds: { left: 100, top: 50, width: 500, height: 500 } as DOMRect,
      canDeleteTokens: false,
    })).toEqual({
      id: 'token-1',
      canTurn: true,
      canViewPokedex: true,
      canUseOrders: false,
      canThrowPokeball: false,
      x: 120,
      y: 75,
    })
  })
})
