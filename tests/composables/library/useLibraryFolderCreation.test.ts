import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useLibraryFolderCreation } from '~/composables/library/useLibraryFolderCreation'

describe('useLibraryFolderCreation', () => {
  it('allocates the next folder name in the current folder', () => {
    const currentPath = ref('team')
    const folderPaths = ref(new Set(['team/new_folder', 'team/new_folder_1']))
    const creator = useLibraryFolderCreation({
      canCreate: true,
      currentPath,
      folderPaths,
      createFolder: vi.fn(),
    })

    expect(creator.nextFolderName()).toBe('new_folder_2')

    currentPath.value = ''
    expect(creator.nextFolderName()).toBe('new_folder')
  })

  it('creates a folder through injected persistence and records local success', async () => {
    const folders = ref(new Set(['team/new_folder']))
    const createFolder = vi.fn(async (folderPath: string) => {
      expect(folderPath).toBe('team/new_folder_1')
    })
    const onCreated = vi.fn((folderPath: string) => folders.value.add(folderPath))
    const creator = useLibraryFolderCreation({
      canCreate: true,
      currentPath: ref('team'),
      folderPaths: computed(() => folders.value),
      createFolder,
      onCreated,
    })

    await expect(creator.createNewFolder()).resolves.toBe('team/new_folder_1')

    expect(createFolder).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith('team/new_folder_1')
    expect(folders.value.has('team/new_folder_1')).toBe(true)
    expect(creator.creating.value).toBe(false)
    expect(creator.createError.value).toBeNull()
  })

  it('does not create when blocked or already busy', async () => {
    const canCreate = ref(false)
    const createFolder = vi.fn()
    const creator = useLibraryFolderCreation({
      canCreate,
      currentPath: '',
      folderPaths: new Set(),
      createFolder,
    })

    await expect(creator.createNewFolder()).resolves.toBeNull()
    expect(createFolder).not.toHaveBeenCalled()

    canCreate.value = true
    creator.creating.value = true
    await expect(creator.createNewFolder()).resolves.toBeNull()
    expect(createFolder).not.toHaveBeenCalled()
  })

  it('normalizes persistence errors and leaves local state unchanged', async () => {
    const onCreated = vi.fn()
    const creator = useLibraryFolderCreation({
      canCreate: true,
      currentPath: '',
      folderPaths: new Set(),
      createFolder: vi.fn(async () => {
        throw { data: { statusMessage: 'Folder already exists.' } }
      }),
      onCreated,
    })

    await expect(creator.createNewFolder()).resolves.toBeNull()

    expect(creator.creating.value).toBe(false)
    expect(creator.createError.value).toBe('Folder already exists.')
    expect(onCreated).not.toHaveBeenCalled()
  })
})
