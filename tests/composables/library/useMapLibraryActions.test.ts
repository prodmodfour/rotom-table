import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  useMapLibraryActions,
  type MapLibraryContextTarget,
} from '~/composables/library/useMapLibraryActions'
import type { MapSummary } from '~/types/map'

const makeMapSummary = (overrides: Partial<MapSummary> = {}): MapSummary => ({
  slug: 'airship-atrium',
  name: 'Airship Atrium',
  folder: 'party/sub',
  dimensions: { x: 12, y: 3, z: 10 },
  placementCount: 3,
  playerVisible: true,
  schemaVersion: 2,
  updatedAt: 123,
  ...overrides,
})

const makeHarness = () => {
  const airship = makeMapSummary()
  const archiveMap = makeMapSummary({
    slug: 'old-ruins',
    name: 'Old Ruins',
    folder: 'archive',
    placementCount: 0,
  })
  const currentPath = ref('party/sub')
  const allFolders = ref(new Set(['party', 'party/sub', 'archive', 'npcs']))
  const maps = new Map<string, MapSummary>([
    [airship.slug, airship],
    [archiveMap.slug, archiveMap],
  ])
  const extraFolders = new Set(['party/sub/empty', 'npcs/archive'])
  const goToFolder = vi.fn()
  const refresh = vi.fn(async () => undefined)
  const moveMap = vi.fn(async () => undefined)
  const moveFolder = vi.fn(async () => undefined)
  const renameMap = vi.fn(async ({ slug, name }: { slug: string; name: string }) => ({
    slug: name === 'Airship Prime' ? 'airship-prime' : slug,
    name,
  }))
  const deleteMap = vi.fn(async () => undefined)
  const deleteFolder = vi.fn(async () => undefined)

  const actions = useMapLibraryActions({
    currentPath,
    allFolders,
    maps,
    extraFolders,
    goToFolder,
    refresh,
    formatFolderLabel: (path) => `Folder: ${path}`,
    moveMap,
    moveFolder,
    renameMap,
    deleteMap,
    deleteFolder,
  })

  return {
    actions,
    airship,
    archiveMap,
    currentPath,
    allFolders,
    maps,
    extraFolders,
    goToFolder,
    refresh,
    moveMap,
    moveFolder,
    renameMap,
    deleteMap,
    deleteFolder,
  }
}

describe('useMapLibraryActions', () => {
  it('validates and persists drag/drop moves through injected handlers', async () => {
    const harness = makeHarness()

    expect(harness.actions.canDropPayloadOn({
      type: 'map',
      slug: 'airship-atrium',
      from: 'party/sub',
    }, 'party/sub')).toBe(false)
    expect(harness.actions.canDropPayloadOn({ type: 'folder', path: 'party' }, 'party/sub')).toBe(false)
    expect(harness.actions.canDropPayloadOn({ type: 'folder', path: 'party' }, 'archive')).toBe(true)

    await harness.actions.movePayload({
      type: 'map',
      slug: 'airship-atrium',
      from: 'party/sub',
    }, 'archive')
    expect(harness.moveMap).toHaveBeenCalledWith({ slug: 'airship-atrium', folder: 'archive' })
    expect(harness.maps.get('airship-atrium')?.folder).toBe('archive')

    harness.maps.set('airship-atrium', { ...harness.airship })
    await harness.actions.movePayload({ type: 'folder', path: 'party' }, 'archive')
    expect(harness.moveFolder).toHaveBeenCalledWith({ from: 'party', to: 'archive/party' })
    expect(harness.maps.get('airship-atrium')?.folder).toBe('archive/party/sub')
    expect([...harness.extraFolders].sort()).toEqual(['archive/party/sub/empty', 'npcs/archive'])
  })

  it('builds context labels, rename defaults, and formatted move destinations', () => {
    const harness = makeHarness()
    const mapTarget: MapLibraryContextTarget = { type: 'map', item: harness.airship }
    const folderTarget: MapLibraryContextTarget = {
      type: 'folder',
      tile: { path: 'party/sub', label: 'Sub', count: 1 },
    }

    expect(harness.actions.targetLabel(mapTarget)).toBe('Airship Atrium')
    expect(harness.actions.targetLabel(folderTarget)).toBe('Sub')
    expect(harness.actions.renameInputForTarget(folderTarget)).toBe('sub')
    expect(harness.actions.moveDestinationsForTarget(mapTarget)).toEqual([
      { value: '', label: 'Home (root)' },
      { value: 'archive', label: 'Folder: archive' },
      { value: 'npcs', label: 'Folder: npcs' },
      { value: 'party', label: 'Folder: party' },
    ])
  })

  it('renames maps and folders while following the current folder when needed', async () => {
    const harness = makeHarness()

    await harness.actions.renameTarget({ type: 'map', item: harness.airship }, 'Airship Prime')
    expect(harness.renameMap).toHaveBeenCalledWith({ slug: 'airship-atrium', name: 'Airship Prime' })
    expect(harness.maps.has('airship-atrium')).toBe(false)
    expect(harness.maps.get('airship-prime')?.name).toBe('Airship Prime')

    await harness.actions.renameTarget({
      type: 'folder',
      tile: { path: 'party', label: 'Party', count: 1 },
    }, 'crew')
    expect(harness.moveFolder).toHaveBeenCalledWith({ from: 'party', to: 'crew' })
    expect(harness.refresh).toHaveBeenCalled()
    expect(harness.goToFolder).toHaveBeenCalledWith('crew/sub')
  })

  it('deletes maps and folder subtrees through local optimistic state', async () => {
    const harness = makeHarness()

    await harness.actions.deleteTarget({ type: 'map', item: harness.archiveMap })
    expect(harness.deleteMap).toHaveBeenCalledWith({ slug: 'old-ruins' })
    expect(harness.maps.has('old-ruins')).toBe(false)

    await harness.actions.deleteTarget({
      type: 'folder',
      tile: { path: 'party', label: 'Party', count: 1 },
    })
    expect(harness.deleteFolder).toHaveBeenCalledWith({ folder: 'party' })
    expect(harness.maps.has('airship-atrium')).toBe(false)
    expect([...harness.extraFolders]).toEqual(['npcs/archive'])
    expect(harness.goToFolder).toHaveBeenCalledWith('')
  })
})
