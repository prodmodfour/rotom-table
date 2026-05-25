import { describe, expect, it } from 'vitest'
import type { SpawnedPokemon } from '~/types/pokemon'
import {
  anyTokenRenderStateNeedsAnimation,
  nextSelectionLiftFactor,
  pokemonPickDimensions,
  pokemonRenderSpawnState,
  selectionLiftTarget,
  TOKEN_CENTER_LERP_SNAP_DISTANCE_SQUARED,
  TOKEN_SELECTION_LIFT_SNAP_EPSILON,
  tokenCenterLerpNeedsAnimation,
  tokenRenderStateNeedsAnimation,
  tokenSelectionLiftNeedsAnimation,
  tokenSelectionLiftStyle,
} from '~/utils/isometric/tokenRenderState'

const spawnedPokemon = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  species: 'Pikachu',
  slug: 'pikachu',
  size: 'Small',
  width: 1,
  height: 1.2,
  base: 2,
  clearance: 1.5,
  spriteUrl: '/sprites/pikachu.png',
  backSpriteUrl: '/sprites/pikachu-back.png',
  entityKind: 'pokemon',
  id: 'token-pikachu',
  position: { x: 3, y: 4, z: 5 },
  facing: 'north-west',
  turned: true,
  sheetKind: 'pokemon',
  sheetSlug: 'sparky',
  level: 17,
  currentHp: 21,
  maxHp: 39,
  fullMaxHp: 44,
  injuries: 1,
  atk: 12,
  satk: 10,
  def: 8,
  sdef: 9,
  defenderTypes: ['Electric'],
  combatStages: { atk: 8, def: -9, satk: 1, sdef: 0, spd: 2, acc: -1 },
  conditions: ['burn', 'Poisoned', 'bogus-condition', 'BRN'],
  tokenItems: ['Light Ball'],
  ...overrides,
})

describe('token render state helpers', () => {
  it('builds normalized render metadata from a spawned token', () => {
    const state = pokemonRenderSpawnState(spawnedPokemon())

    expect(state.center).toEqual({ x: 4, y: 4, z: 6 })
    expect(state.elevation).toBe(4)
    expect(state.facing).toBe('north-west')
    expect(state.turned).toBe(true)
    expect(state.displayName).toBe('Pikachu')
    expect(state.maxHp).toBe(39)
    expect(state.fullMaxHp).toBe(44)
    expect(state.injuries).toBe(1)
    expect(state.combatStages).toMatchObject({ atk: 6, def: -6, satk: 1, spd: 2, acc: -1 })
    expect(state.conditions).toEqual(['Burned', 'Poisoned'])
    expect(state.tokenItems).toEqual(['Light Ball'])
  })

  it('copies token item arrays instead of sharing mutable metadata', () => {
    const pokemon = spawnedPokemon({ tokenItems: ['Potion'] })
    const state = pokemonRenderSpawnState(pokemon)

    pokemon.tokenItems.push('Berry')

    expect(state.tokenItems).toEqual(['Potion'])
  })

  it('derives picking proxy dimensions from token footprint and sprite bounds', () => {
    expect(pokemonPickDimensions(spawnedPokemon())).toEqual({ width: 2, height: 1.5 })
    expect(pokemonPickDimensions(spawnedPokemon({ base: 0.5, width: 3, clearance: 0.25, height: 4 }))).toEqual({
      width: 3,
      height: 4,
    })
  })

  it('derives selection lift targets and damped lift factors', () => {
    expect(selectionLiftTarget(false)).toBe(0)
    expect(selectionLiftTarget(true)).toBe(1)
    expect(nextSelectionLiftFactor(0, 1, 0.25)).toBeCloseTo(0.25)
    expect(nextSelectionLiftFactor(1 - TOKEN_SELECTION_LIFT_SNAP_EPSILON / 2, 1, 0.25)).toBe(1)
  })

  it('detects token center lerp while the token has not snapped to its target', () => {
    expect(tokenCenterLerpNeedsAnimation({
      currentCenter: { x: 0, y: 0, z: 0 },
      targetCenter: { x: Math.sqrt(TOKEN_CENTER_LERP_SNAP_DISTANCE_SQUARED), y: 0, z: 0 },
    })).toBe(true)
    expect(tokenCenterLerpNeedsAnimation({
      currentCenter: { x: 1, y: 2, z: 3 },
      targetCenter: { x: 1, y: 2, z: 3 },
    })).toBe(false)
  })

  it('detects selection lift while the eased factor is still settling', () => {
    expect(tokenSelectionLiftNeedsAnimation({
      liftFactor: 0,
      liftTarget: 1,
    })).toBe(true)
    expect(tokenSelectionLiftNeedsAnimation({
      liftFactor: 1 - TOKEN_SELECTION_LIFT_SNAP_EPSILON / 2,
      liftTarget: 1,
    })).toBe(false)
  })

  it('detects active token render animation across center lerp and lift state', () => {
    const settled = {
      currentCenter: { x: 0, y: 0, z: 0 },
      targetCenter: { x: 0, y: 0, z: 0 },
      liftFactor: 0,
      liftTarget: 0,
    }
    const moving = {
      ...settled,
      targetCenter: { x: 2, y: 0, z: 0 },
    }
    const lifting = {
      ...settled,
      liftTarget: 1,
    }

    expect(tokenRenderStateNeedsAnimation(settled)).toBe(false)
    expect(tokenRenderStateNeedsAnimation(moving)).toBe(true)
    expect(tokenRenderStateNeedsAnimation(lifting)).toBe(true)
    expect(anyTokenRenderStateNeedsAnimation([settled])).toBe(false)
    expect(anyTokenRenderStateNeedsAnimation([settled, moving])).toBe(true)
  })

  it('derives sprite lift and shadow style from the lift factor', () => {
    expect(tokenSelectionLiftStyle(0)).toEqual({
      spriteLift: 0,
      shadowScaleX: 1.15,
      shadowScaleY: 1,
      shadowOpacity: 1,
    })

    expect(tokenSelectionLiftStyle(1)).toEqual({
      spriteLift: 0.08,
      shadowScaleX: 1.4949999999999999,
      shadowScaleY: 1.3,
      shadowOpacity: 0.55,
    })
  })
})
