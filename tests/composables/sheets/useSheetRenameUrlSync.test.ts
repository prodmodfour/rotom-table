import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useSheetRenameUrlSync } from '~/composables/sheets/useSheetRenameUrlSync'

describe('useSheetRenameUrlSync', () => {
  it('replaces the browser URL when a sheet is renamed without repeating the same slug', async () => {
    const renamedTo = ref<string | null>(null)
    const replaced: string[] = []

    const { currentUrlSlug } = useSheetRenameUrlSync({
      kind: 'pokemon',
      initialSlug: 'old-name',
      renamedTo,
      replaceUrl: (path) => replaced.push(path),
    })

    renamedTo.value = 'new-name'
    await nextTick()

    expect(replaced).toEqual(['/sheets/new-name'])
    expect(currentUrlSlug.value).toBe('new-name')

    renamedTo.value = 'new-name'
    await nextTick()

    expect(replaced).toEqual(['/sheets/new-name'])
  })

  it('uses the trainer route prefix for trainer sheets', async () => {
    const renamedTo = ref<string | null>(null)
    const replaced: string[] = []

    useSheetRenameUrlSync({
      kind: 'trainer',
      initialSlug: 'old-trainer',
      renamedTo,
      replaceUrl: (path) => replaced.push(path),
    })

    renamedTo.value = 'new-trainer'
    await nextTick()

    expect(replaced).toEqual(['/sheets/trainers/new-trainer'])
  })
})
