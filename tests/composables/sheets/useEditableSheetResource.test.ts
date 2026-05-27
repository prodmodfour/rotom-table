import { computed } from 'vue'
import { describe, expect, it } from 'vitest'
import { useEditableSheetResource } from '~/composables/sheets/useEditableSheetResource'

interface TestSheet {
  slug: string
  player?: boolean
  sessionPlayerAccessible?: boolean
  playerProfileAccessible?: boolean
  nested?: { value: number }
  prepared?: boolean
}

describe('useEditableSheetResource', () => {
  it('creates an editable normalized clone for accessible sheets', () => {
    const baseSheet: TestSheet = { slug: 'sheet-a', nested: { value: 1 } }
    const resource = useEditableSheetResource<TestSheet>({
      baseSheet,
      kind: 'pokemon',
      isPlayer: computed(() => false),
      normalize: (sheet) => ({ ...sheet, nested: { value: (sheet.nested?.value ?? 0) + 1 } }),
      prepareInitial: (sheet) => { sheet.prepared = true },
    })

    expect(resource.sheet.value).toEqual({ slug: 'sheet-a', nested: { value: 2 }, prepared: true })
    expect(resource.sheet.value).not.toBe(baseSheet)
    expect(resource.sheet.value?.nested).not.toBe(baseSheet.nested)
    expect(resource.editorCapabilities.value).toMatchObject({
      accessMode: 'gm',
      canEditSheet: true,
      canManagePlayerAccess: true,
    })
    expect(resource.saveStatus.value).toBe('idle')
    expect(resource.saveError.value).toBeNull()
  })

  it('withholds non-player sheets from player sessions', () => {
    const resource = useEditableSheetResource<TestSheet>({
      baseSheet: { slug: 'gm-only', player: false },
      kind: 'trainer',
      isPlayer: computed(() => true),
      normalize: (sheet) => sheet,
    })

    expect(resource.editor).toBeNull()
    expect(resource.sheet.value).toBeNull()
    expect(resource.editorCapabilities.value).toMatchObject({
      accessMode: 'none',
      canEditSheet: false,
      canManagePlayerAccess: false,
    })
    expect(resource.saveStatus.value).toBe('idle')
  })

  it('allows player-accessible sheets for player sessions', () => {
    const resource = useEditableSheetResource<TestSheet>({
      baseSheet: { slug: 'player-sheet', player: true },
      kind: 'trainer',
      isPlayer: computed(() => true),
      normalize: (sheet) => sheet,
    })

    expect(resource.sheet.value?.slug).toBe('player-sheet')
    expect(resource.editorCapabilities.value).toMatchObject({
      accessMode: 'player-accessible',
      canEditSheet: true,
      canManagePlayerAccess: false,
    })
  })

  it('allows profile-linked sheets marked by the sheet load API for player sessions', () => {
    const resource = useEditableSheetResource<TestSheet>({
      baseSheet: { slug: 'linked-sheet', playerProfileAccessible: true } as TestSheet,
      kind: 'pokemon',
      isPlayer: computed(() => true),
      normalize: (sheet) => sheet,
    })

    expect(resource.sheet.value?.slug).toBe('linked-sheet')
    expect(resource.editorCapabilities.value).toMatchObject({
      accessMode: 'profile-linked',
      canEditSheet: true,
      canManagePlayerAccess: false,
    })
  })
})
