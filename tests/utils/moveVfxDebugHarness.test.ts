import { describe, expect, it } from 'vitest'
import { MOVE_VFX_KIND } from '~/types/moveAnimation'
import {
  MOVE_VFX_DEBUG_ALL_PREVIEW_STAGGER_MS,
  MOVE_VFX_DEBUG_HARNESS_QUERY_KEY,
  MOVE_VFX_DEBUG_HARNESS_QUERY_VALUES,
  MOVE_VFX_DEBUG_PREVIEW_OPTIONS,
  createMoveVfxDebugPreviewEvents,
  hasMoveVfxDebugHarnessQueryFlag,
  isMoveVfxDebugHarnessEnabled,
} from '~/utils/moveVfxDebugHarness'

const debugTokens = [
  {
    id: 'user-token',
    species: 'Pikachu',
    position: { x: 1, y: 0, z: 1 },
    defenderTypes: ['Electric'],
  },
  {
    id: 'target-token',
    species: 'Bulbasaur',
    position: { x: 4, y: 0, z: 2 },
    defenderTypes: ['Grass'],
  },
]

describe('move VFX debug harness', () => {
  it('documents every supported primitive as a preview option', () => {
    expect(MOVE_VFX_DEBUG_PREVIEW_OPTIONS.map((option) => option.kind)).toEqual(Object.values(MOVE_VFX_KIND))
    expect(new Set(MOVE_VFX_DEBUG_PREVIEW_OPTIONS.map((option) => option.kind)).size)
      .toBe(MOVE_VFX_DEBUG_PREVIEW_OPTIONS.length)
  })

  it('detects the explicit debug query without enabling unrelated debug flags', () => {
    expect(MOVE_VFX_DEBUG_HARNESS_QUERY_KEY).toBe('debug')
    expect(MOVE_VFX_DEBUG_HARNESS_QUERY_VALUES).toContain('move-vfx')
    expect(hasMoveVfxDebugHarnessQueryFlag('?debug=move-vfx')).toBe(true)
    expect(hasMoveVfxDebugHarnessQueryFlag('/maps/demo?debug=render,move-vfx#scene')).toBe(true)
    expect(hasMoveVfxDebugHarnessQueryFlag(new URLSearchParams('debug[]=vfx'))).toBe(true)
    expect(hasMoveVfxDebugHarnessQueryFlag({ debug: ['render', 'move-vfx-harness'] })).toBe(true)
    expect(hasMoveVfxDebugHarnessQueryFlag('?debug=render')).toBe(false)
    expect(hasMoveVfxDebugHarnessQueryFlag('?other=move-vfx')).toBe(false)
  })

  it('keeps the visible harness dev-gated unless a caller explicitly opts into production', () => {
    expect(isMoveVfxDebugHarnessEnabled({ query: '?debug=move-vfx', isDev: true })).toBe(true)
    expect(isMoveVfxDebugHarnessEnabled({ query: '?debug=move-vfx', isDev: false })).toBe(false)
    expect(isMoveVfxDebugHarnessEnabled({ query: '?debug=move-vfx', isDev: false, allowProduction: true })).toBe(true)
    expect(isMoveVfxDebugHarnessEnabled({ query: '?debug=render', isDev: true })).toBe(false)
  })

  it('creates a staggered transient preview input for every primitive without runtime queue fields', () => {
    const events = createMoveVfxDebugPreviewEvents({
      kind: 'all',
      selectedId: 'user-token',
      tokens: debugTokens,
      dimensions: { x: 8, y: 2, z: 8 },
    })

    expect(events.map((event) => event.kind)).toEqual(MOVE_VFX_DEBUG_PREVIEW_OPTIONS.map((option) => option.kind))
    expect(events.map((event) => event.userId)).toEqual(events.map(() => 'user-token'))
    expect(events.map((event) => event.startOffsetMs ?? 0)).toEqual(
      events.map((_, index) => index * MOVE_VFX_DEBUG_ALL_PREVIEW_STAGGER_MS),
    )
    expect(events.every((event) => !('id' in event) && !('createdAtMs' in event))).toBe(true)

    expect(events.find((event) => event.kind === MOVE_VFX_KIND.projectile)).toMatchObject({
      kind: MOVE_VFX_KIND.projectile,
      targetId: 'target-token',
      targetCell: { x: 4, y: 0, z: 2 },
    })
    expect(events.find((event) => event.kind === MOVE_VFX_KIND.areaPulse)).toMatchObject({
      kind: MOVE_VFX_KIND.areaPulse,
      areaCells: expect.arrayContaining([{ x: 1, y: 0, z: 1 }]),
    })
    expect(events.find((event) => event.kind === MOVE_VFX_KIND.badge)).toMatchObject({
      kind: MOVE_VFX_KIND.badge,
      label: 'Debug',
    })
  })

  it('requires a selected token and falls back to a synthetic target cell when alone', () => {
    expect(createMoveVfxDebugPreviewEvents({
      kind: MOVE_VFX_KIND.projectile,
      selectedId: null,
      tokens: debugTokens,
      dimensions: { x: 8, y: 2, z: 8 },
    })).toEqual([])

    const [projectile] = createMoveVfxDebugPreviewEvents({
      kind: MOVE_VFX_KIND.projectile,
      selectedId: 'solo-token',
      tokens: [{
        id: 'solo-token',
        species: 'Eevee',
        position: { x: 0, y: 0, z: 0 },
        defenderTypes: ['Normal'],
      }],
      dimensions: { x: 3, y: 1, z: 3 },
    })

    expect(projectile).toMatchObject({
      kind: MOVE_VFX_KIND.projectile,
      userId: 'solo-token',
      originCell: { x: 0, y: 0, z: 0 },
      targetCell: { x: 2, y: 0, z: 0 },
    })
    expect(projectile).not.toHaveProperty('targetId')
  })
})
