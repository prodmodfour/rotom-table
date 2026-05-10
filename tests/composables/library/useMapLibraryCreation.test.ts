import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useMapLibraryCreation } from '~/composables/library/useMapLibraryCreation'
import type { TabletopMap } from '~/types/map'

const makeMap = (slug = 'new-map', folder = ''): TabletopMap => ({
  schemaVersion: 2,
  slug,
  name: 'New map',
  folder,
  dimensions: { width: 10, height: 8 },
  voxels: [],
  placements: [],
})

describe('useMapLibraryCreation', () => {
  it('creates a map in the current folder, stores it, and navigates to the editor', async () => {
    const createdMap = makeMap('atrium', 'guild/hall')
    const createMap = vi.fn(async (folder: string) => {
      expect(folder).toBe('guild/hall')
      return { map: createdMap }
    })
    const onCreated = vi.fn()
    const navigateToMap = vi.fn()

    const creator = useMapLibraryCreation({
      canCreate: true,
      currentPath: ref('guild/hall'),
      createMap,
      onCreated,
      navigateToMap,
    })

    await expect(creator.createNewMap()).resolves.toBe(createdMap)

    expect(createMap).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith(createdMap)
    expect(navigateToMap).toHaveBeenCalledWith('atrium')
    expect(creator.creating.value).toBe(false)
    expect(creator.createError.value).toBeNull()
  })

  it('uses injected shared busy/error state so map and folder creation stay mutually exclusive', async () => {
    const creating = ref(true)
    const createError = ref('Previous failure')
    const createMap = vi.fn()

    const creator = useMapLibraryCreation({
      canCreate: true,
      currentPath: '',
      state: { creating, createError },
      createMap,
      navigateToMap: vi.fn(),
    })

    await expect(creator.createNewMap()).resolves.toBeNull()
    expect(createMap).not.toHaveBeenCalled()
    expect(creator.creating).toBe(creating)
    expect(creator.createError).toBe(createError)
    expect(createError.value).toBe('Previous failure')
  })

  it('does not create when creation is not allowed', async () => {
    const canCreate = ref(false)
    const createMap = vi.fn()
    const creator = useMapLibraryCreation({
      canCreate,
      currentPath: '',
      createMap,
      navigateToMap: vi.fn(),
    })

    await expect(creator.createNewMap()).resolves.toBeNull()
    expect(createMap).not.toHaveBeenCalled()
  })

  it('normalizes creation errors and clears busy state', async () => {
    const creator = useMapLibraryCreation({
      canCreate: true,
      currentPath: '',
      createMap: vi.fn(async () => {
        throw { data: { statusMessage: 'Cannot create map.' } }
      }),
      navigateToMap: vi.fn(),
    })

    await expect(creator.createNewMap()).resolves.toBeNull()

    expect(creator.creating.value).toBe(false)
    expect(creator.createError.value).toBe('Cannot create map.')
  })
})
