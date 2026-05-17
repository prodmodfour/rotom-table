import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  canPlayerViewMap,
  useMapAccess,
  useMapGmModeGuard,
} from '~/composables/map-editor/useMapAccess'
import type { TabletopMap } from '~/types/map'

const makeMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'test-map',
  name: 'Test Map',
  dimensions: { x: 10, y: 4, z: 10 },
  voxels: [],
  hazards: [],
  placements: [],
  playerVisible: true,
  ...overrides,
})

describe('canPlayerViewMap', () => {
  it('allows guests/GMs and only allows players to view visible maps', () => {
    expect(canPlayerViewMap(null, true)).toBe(true)
    expect(canPlayerViewMap(makeMap({ playerVisible: false }), false)).toBe(true)
    expect(canPlayerViewMap(makeMap({ playerVisible: true }), true)).toBe(true)
    expect(canPlayerViewMap(makeMap({ playerVisible: false }), true)).toBe(false)
    expect(canPlayerViewMap(makeMap({ playerVisible: undefined }), true)).toBe(false)
  })
})

describe('useMapAccess', () => {
  it('derives map editing capabilities from the GM role', async () => {
    const map = ref<TabletopMap | null>(makeMap())
    const isGm = ref(true)
    const isPlayer = ref(false)

    const access = useMapAccess({ map, isGm, isPlayer })

    expect(access.canEditMap.value).toBe(true)
    expect(access.canManageInitiative.value).toBe(true)
    expect(access.canSpawnTokens.value).toBe(true)
    expect(access.canViewMap.value).toBe(true)

    isGm.value = false
    await nextTick()

    expect(access.canEditMap.value).toBe(false)
    expect(access.canManageInitiative.value).toBe(false)
    expect(access.canSpawnTokens.value).toBe(false)
  })

  it('redirects players when a hidden map is loaded', async () => {
    const map = ref<TabletopMap | null>(null)
    const isGm = ref(false)
    const isPlayer = ref(true)
    const redirectHiddenPlayerMap = vi.fn()

    const access = useMapAccess({ map, isGm, isPlayer, redirectHiddenPlayerMap })
    expect(redirectHiddenPlayerMap).not.toHaveBeenCalled()

    map.value = makeMap({ slug: 'hidden-map', playerVisible: false })
    await nextTick()

    expect(access.canViewMap.value).toBe(false)
    expect(redirectHiddenPlayerMap).toHaveBeenCalledTimes(1)
  })

  it('keeps the historical hidden-map redirect triggers to slug/player changes', async () => {
    const map = ref<TabletopMap | null>(makeMap({ playerVisible: true }))
    const isGm = ref(false)
    const isPlayer = ref(true)
    const redirectHiddenPlayerMap = vi.fn()

    useMapAccess({ map, isGm, isPlayer, redirectHiddenPlayerMap })
    expect(redirectHiddenPlayerMap).not.toHaveBeenCalled()

    map.value!.playerVisible = false
    await nextTick()
    expect(redirectHiddenPlayerMap).not.toHaveBeenCalled()

    map.value = makeMap({ slug: 'another-hidden-map', playerVisible: false })
    await nextTick()
    expect(redirectHiddenPlayerMap).toHaveBeenCalledTimes(1)
  })
})

describe('useMapGmModeGuard', () => {
  it('turns off GM-only UI state and clears uncontrolled token selection when GM access is lost', async () => {
    const isGm = ref(true)
    const buildMode = ref(true)
    const hazardMode = ref(true)
    const adminPanelOpen = ref(true)
    const selectedId = ref<string | null>('enemy-token')
    const clearSelection = vi.fn(() => { selectedId.value = null })

    useMapGmModeGuard({
      isGm,
      buildMode,
      hazardMode,
      adminPanelOpen,
      selectedId,
      canControlPlacement: () => false,
      clearSelection,
    })

    isGm.value = false
    await nextTick()

    expect(buildMode.value).toBe(false)
    expect(hazardMode.value).toBe(false)
    expect(adminPanelOpen.value).toBe(false)
    expect(clearSelection).toHaveBeenCalledTimes(1)
  })

  it('preserves selected tokens that remain controllable after GM access is lost', async () => {
    const isGm = ref(true)
    const buildMode = ref(false)
    const hazardMode = ref(false)
    const adminPanelOpen = ref(false)
    const selectedId = ref<string | null>('player-token')
    const clearSelection = vi.fn()

    useMapGmModeGuard({
      isGm,
      buildMode,
      hazardMode,
      adminPanelOpen,
      selectedId,
      canControlPlacement: (id) => id === 'player-token',
      clearSelection,
    })

    isGm.value = false
    await nextTick()

    expect(selectedId.value).toBe('player-token')
    expect(clearSelection).not.toHaveBeenCalled()
  })
})
