import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PokemonRenderObject } from '~/utils/isometric/types'
import {
  createPresenceIntentOverlayRenderer,
  PRESENCE_INTENT_CELL_Y_OFFSET,
  type IsometricPresenceIntentOverlay,
} from '~/utils/isometric/presenceIntentRenderer'
import { installFakeDom } from './fakeDom'

const overlay = (overrides: Partial<IsometricPresenceIntentOverlay> = {}): IsometricPresenceIntentOverlay => ({
  id: 'intent-1',
  kind: 'targeting',
  label: 'Targeting',
  detail: '2 targets',
  participantLabel: 'Misty',
  participant: {
    role: 'player',
    profileDisplayName: 'Misty',
    clientIdSuffix: 'abcd1234',
    accent: 'cyan',
  },
  anchor: { kind: 'cell', cell: { x: 2, y: 1, z: 3 } },
  anchorKey: 'cell:2:1:3',
  stackIndex: 0,
  accentColor: '#22d3ee',
  lastSeenAt: 10_000,
  expiresAt: 25_000,
  ...overrides,
})

const renderObject = (overrides: Partial<PokemonRenderObject> = {}): PokemonRenderObject => ({
  id: 'token-pikachu',
  currentCenter: new THREE.Vector3(4.5, 1, 5.5),
  targetCenter: new THREE.Vector3(4.5, 1, 5.5),
  base: 1,
  height: 1.2,
  ...overrides,
}) as PokemonRenderObject

const visibleSprite = (scene: THREE.Scene) => (
  scene.children.find((child) => child.visible) as (THREE.Object3D & { element?: HTMLElement }) | undefined
)

const styleValue = (element: HTMLElement | undefined, property: string): string | undefined => (
  (element?.style as unknown as Record<string, string> | undefined)?.[property]
)

beforeEach(() => {
  installFakeDom()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('presence intent isometric renderer', () => {
  it('renders cell-anchored remote targeting intent as pointer-safe CSS3D', () => {
    const scene = new THREE.Scene()
    const renderer = createPresenceIntentOverlayRenderer(scene)
    const entry = overlay()

    expect(renderer.sync([entry], { renderObjects: new Map(), show: true })).toBe(true)
    expect(renderer.sync([entry], { renderObjects: new Map(), show: true })).toBe(false)

    const sprite = visibleSprite(scene)
    expect(sprite).toBeDefined()
    expect(sprite?.position.x).toBe(2.5)
    expect(sprite?.position.y).toBeCloseTo(1 + PRESENCE_INTENT_CELL_Y_OFFSET)
    expect(sprite?.position.z).toBe(3.5)
    expect(sprite?.element?.className).toBe('map-presence-intent-anchor is-targeting is-cell is-cyan')
    expect(sprite?.element?.style.pointerEvents).toBe('none')
    expect(sprite?.element?.style.zIndex).toBe('16')
    expect(sprite?.element?.title).toBe('Misty: Targeting · 2 targets at cell (2, 1, 3)')
    expect(sprite?.element?.querySelector('.map-presence-intent__participant')?.textContent).toBe('Misty')
    expect(sprite?.element?.querySelector('.map-presence-intent__label')?.textContent).toBe('Targeting')
    expect(sprite?.element?.querySelector('.map-presence-intent__detail')?.textContent).toBe('2 targets')
    expect(styleValue(sprite?.element, '--map-presence-intent-accent')).toBe('#22d3ee')
    expect(styleValue(sprite?.element, '--map-presence-intent-accent-rgb')).toBe('34, 211, 238')
    expect(sprite?.userData.pokemonId).toBeUndefined()
    expect(sprite?.userData.hazard).toBeUndefined()

    renderer.dispose()
  })

  it('anchors token intent to visible token render objects and softens under local interaction', () => {
    const scene = new THREE.Scene()
    const renderer = createPresenceIntentOverlayRenderer(scene)
    const entry = overlay({
      id: 'intent-token',
      kind: 'moving-token',
      label: 'Moving',
      detail: 'previewing a route',
      anchor: { kind: 'token', tokenId: 'token-pikachu' },
      anchorKey: 'token:token-pikachu',
      stackIndex: 1,
    })
    const objects = new Map<string, PokemonRenderObject>([['token-pikachu', renderObject()]])

    expect(renderer.sync([entry], { renderObjects: objects, show: true, softened: true })).toBe(true)

    const sprite = visibleSprite(scene)
    expect(sprite?.position.x).toBe(4.5)
    expect(sprite?.position.y).toBeCloseTo(1 + Math.max(1.2 * 0.92, 0.92) + 0.22)
    expect(sprite?.position.z).toBe(5.5)
    expect(sprite?.element?.className).toBe('map-presence-intent-anchor is-moving-token is-token is-cyan is-softened')
    expect(sprite?.element?.title).toBe('Misty: Moving · previewing a route at a visible token')

    renderer.dispose()
  })

  it('removes overlays when hidden or when a token anchor is unavailable', () => {
    const scene = new THREE.Scene()
    const renderer = createPresenceIntentOverlayRenderer(scene)
    const tokenOverlay = overlay({
      id: 'intent-token',
      anchor: { kind: 'token', tokenId: 'token-missing' },
      anchorKey: 'token:token-missing',
    })

    renderer.sync([overlay()], { renderObjects: new Map(), show: true })
    const sprite = visibleSprite(scene)
    const removeElement = vi.spyOn(sprite!.element!, 'remove')

    expect(renderer.sync([tokenOverlay], { renderObjects: new Map(), show: true })).toBe(true)
    expect(scene.children).toHaveLength(0)
    expect(removeElement).toHaveBeenCalledOnce()
    expect(renderer.sync([overlay()], { renderObjects: new Map(), show: false })).toBe(false)
  })
})
