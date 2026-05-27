import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CSS3DSprite } from 'three/examples/jsm/renderers/CSS3DRenderer.js'
import type { SpawnedPokemon } from '~/types/pokemon'
import { buildHpBar, updateElevationBadge, updateHpBar } from '~/utils/isometric/tokenHud'
import { installFakeDom } from './fakeDom'

const spawnedPokemon = (overrides: Partial<SpawnedPokemon> = {}): SpawnedPokemon => ({
  species: 'Bulbasaur',
  slug: 'bulbasaur',
  size: 'Small',
  width: 1,
  height: 1,
  base: 1,
  clearance: 1,
  spriteUrl: '/bulbasaur.png',
  entityKind: 'pokemon',
  id: 'token-1',
  position: { x: 0, y: 0, z: 0 },
  sheetKind: 'pokemon',
  sheetSlug: 'bulbasaur',
  level: 5,
  currentHp: 12,
  maxHp: 20,
  fullMaxHp: 20,
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

const updateTokenHpBar = (
  bar: CSS3DSprite,
  overrides: Partial<Parameters<typeof updateHpBar>[0]> = {},
): boolean => updateHpBar({
  bar,
  center: new THREE.Vector3(1, 2, 3),
  spriteHeight: 1.2,
  displayName: 'Bulbasaur',
  level: 5,
  currentHp: 12,
  maxHp: 20,
  fullMaxHp: 20,
  injuries: 0,
  conditions: [],
  tokenItems: [],
  activeTurn: false,
  ...overrides,
})

beforeEach(() => {
  installFakeDom()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('token HUD elevation badge rendering', () => {
  it('skips repeated badge writes when the hover-visible state is unchanged', () => {
    const { badge, setPosition, textWrites, textContent } = makeBadge()
    const center = new THREE.Vector3(1, 2, 3)

    expect(updateElevationBadge({
      badge,
      center,
      base: 1,
      elevation: 3,
      groundLevelY: 1,
      camera: null,
      show: true,
    })).toBe(true)

    expect(badge.visible).toBe(true)
    expect(setPosition).toHaveBeenCalledTimes(1)
    expect(textWrites()).toBe(1)
    expect(textContent()).toBe('+2 ↑')

    expect(updateElevationBadge({
      badge,
      center,
      base: 1,
      elevation: 3,
      groundLevelY: 1,
      camera: null,
      show: true,
    })).toBe(false)

    expect(badge.visible).toBe(true)
    expect(setPosition).toHaveBeenCalledTimes(1)
    expect(textWrites()).toBe(1)
  })

  it('refreshes the badge when output-relevant position or text changes', () => {
    const { badge, setPosition, textWrites, textContent } = makeBadge()
    const center = new THREE.Vector3(1, 2, 3)

    expect(updateElevationBadge({
      badge,
      center,
      base: 1,
      elevation: 3,
      groundLevelY: 1,
      camera: null,
      show: true,
    })).toBe(true)
    expect(updateElevationBadge({
      badge,
      center: new THREE.Vector3(2, 2, 3),
      base: 1,
      elevation: 3,
      groundLevelY: 1,
      camera: null,
      show: true,
    })).toBe(true)

    expect(setPosition).toHaveBeenCalledTimes(2)
    expect(textWrites()).toBe(1)

    expect(updateElevationBadge({
      badge,
      center: new THREE.Vector3(2, 2, 3),
      base: 1,
      elevation: 4,
      groundLevelY: 1,
      camera: null,
      show: true,
    })).toBe(true)

    expect(setPosition).toHaveBeenCalledTimes(3)
    expect(textWrites()).toBe(2)
    expect(textContent()).toBe('+3 ↑')
  })

  it('does not repeatedly hide an already hidden badge', () => {
    const { badge, setPosition, textWrites } = makeBadge()

    expect(updateElevationBadge({
      badge,
      center: new THREE.Vector3(1, 2, 3),
      base: 1,
      elevation: 3,
      groundLevelY: 1,
      camera: null,
      show: false,
    })).toBe(false)
    expect(updateElevationBadge({
      badge,
      center: new THREE.Vector3(1, 2, 3),
      base: 1,
      elevation: 3,
      groundLevelY: 1,
      camera: null,
      show: false,
    })).toBe(false)

    expect(badge.visible).toBe(false)
    expect(setPosition).not.toHaveBeenCalled()
    expect(textWrites()).toBe(0)
  })
})

describe('token HUD HP bar rendering', () => {
  it('reports CSS-visible HP bar changes while skipping repeated identical state', () => {
    const bar = buildHpBar(spawnedPokemon())

    expect(updateTokenHpBar(bar)).toBe(true)
    expect(bar.visible).toBe(true)
    expect(bar.element.querySelector<HTMLElement>('.hp-bar__fill')?.style.width).toBe('60%')

    expect(updateTokenHpBar(bar)).toBe(false)

    expect(updateTokenHpBar(bar, { currentHp: 6 })).toBe(true)
    expect(bar.element.querySelector<HTMLElement>('.hp-bar__fill')?.style.width).toBe('30%')

    expect(updateTokenHpBar(bar, { currentHp: 6 })).toBe(false)
  })

  it('re-anchors an unchanged HP bar so selection lift cannot accumulate', () => {
    const bar = buildHpBar(spawnedPokemon())

    expect(updateTokenHpBar(bar)).toBe(true)
    const anchor = bar.position.clone()

    bar.position.y += 0.08

    expect(updateTokenHpBar(bar)).toBe(false)
    expect(bar.position.toArray()).toEqual(anchor.toArray())
  })

  it('reports HP bar position, label, conditions, active-turn, and visibility changes', () => {
    const bar = buildHpBar(spawnedPokemon())

    expect(updateTokenHpBar(bar)).toBe(true)
    expect(updateTokenHpBar(bar, { center: new THREE.Vector3(2, 2, 3) })).toBe(true)
    expect(updateTokenHpBar(bar, { center: new THREE.Vector3(2, 2, 3) })).toBe(false)

    expect(updateTokenHpBar(bar, { displayName: 'Ivysaur', level: 6 })).toBe(true)
    expect(bar.element.textContent).toContain('Ivysaur')
    expect(bar.element.textContent).toContain('6')

    expect(updateTokenHpBar(bar, { conditions: ['Burned'], activeTurn: true })).toBe(true)
    expect(bar.element.querySelector<HTMLElement>('.token-status__condition-strip')?.hidden).toBe(false)
    expect(bar.element.classList.contains('is-active-turn')).toBe(true)

    expect(updateTokenHpBar(bar, { show: false })).toBe(true)
    expect(bar.visible).toBe(false)
    expect(updateTokenHpBar(bar, { show: false })).toBe(false)
  })
})
