import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LivePlayPresenceParticipantSummary } from '#shared/livePlayPresence'
import {
  createPresencePingRenderer,
  PRESENCE_PING_Y_OFFSET,
  type IsometricPresencePing,
} from '~/utils/isometric/pingRenderer'
import { installFakeDom } from './fakeDom'

const creator = (overrides: Partial<LivePlayPresenceParticipantSummary> = {}): LivePlayPresenceParticipantSummary => ({
  role: 'player',
  profileDisplayName: 'Misty',
  clientIdSuffix: 'abcd1234',
  accent: 'cyan',
  ...overrides,
})

const ping = (overrides: Partial<IsometricPresencePing> = {}): IsometricPresencePing => ({
  id: 'ping-1',
  cell: { x: 2, y: 1, z: 3 },
  label: 'Look here',
  createdAt: 1_000,
  expiresAt: 5_000,
  creator: creator(),
  ...overrides,
})

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

describe('presence ping isometric renderer', () => {
  it('renders pings at their grid cell with safe CSS3D affordances', () => {
    const scene = new THREE.Scene()
    const renderer = createPresencePingRenderer(scene)
    const entry = ping()

    expect(renderer.sync([entry], { nowMs: 2_000 })).toBe(true)
    expect(renderer.sync([entry], { nowMs: 2_000 })).toBe(false)

    const sprite = visibleSprite(scene)
    expect(sprite).toBeDefined()
    expect(sprite?.position.x).toBe(2.5)
    expect(sprite?.position.y).toBeCloseTo(1 + PRESENCE_PING_Y_OFFSET)
    expect(sprite?.position.z).toBe(3.5)
    expect(sprite?.element?.className).toBe('map-presence-ping-anchor is-cyan')
    expect(sprite?.element?.style.pointerEvents).toBe('none')
    expect(sprite?.element?.style.zIndex).toBe('18')
    expect(sprite?.element?.title).toBe('Map ping by Misty (Player) at (2, 1, 3): Look here')
    expect(sprite?.element?.querySelector('.map-presence-ping__label')?.textContent).toBe('Look here')
    expect(styleValue(sprite?.element, '--map-presence-ping-accent')).toBe('#22d3ee')
    expect(styleValue(sprite?.element, '--map-presence-ping-duration')).toBe('4000ms')
    expect(styleValue(sprite?.element, '--map-presence-ping-delay')).toBe('-1000ms')

    renderer.dispose()
  })

  it('removes expired pings and disposes CSS elements', () => {
    const scene = new THREE.Scene()
    const renderer = createPresencePingRenderer(scene)

    renderer.sync([ping()], { nowMs: 2_000 })
    const sprite = visibleSprite(scene)
    const removeElement = vi.spyOn(sprite!.element!, 'remove')

    expect(renderer.sync([ping()], { nowMs: 5_001 })).toBe(true)

    expect(scene.children).toHaveLength(0)
    expect(removeElement).toHaveBeenCalledOnce()
    expect(renderer.sync([], { nowMs: 5_001 })).toBe(false)
  })

  it('keeps pings out of token and build pick targets', () => {
    const scene = new THREE.Scene()
    const renderer = createPresencePingRenderer(scene)

    renderer.sync([
      ping({
        id: 'ping-2',
        creator: creator({ role: 'gm', profileDisplayName: undefined, accent: 'amber' }),
      }),
    ], { nowMs: 1_250 })

    const sprite = visibleSprite(scene)
    expect(sprite?.element?.style.pointerEvents).toBe('none')
    expect(sprite?.userData.pokemonId).toBeUndefined()
    expect(sprite?.userData.hazard).toBeUndefined()

    const traversedUserData: unknown[] = []
    sprite?.traverse((child) => traversedUserData.push(child.userData))
    expect(traversedUserData).not.toContainEqual(expect.objectContaining({ pokemonId: expect.any(String) }))
    expect(traversedUserData).not.toContainEqual(expect.objectContaining({ hazard: expect.anything() }))

    renderer.dispose()
  })
})
