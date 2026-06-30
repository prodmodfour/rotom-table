import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGroupInventoryEditor } from '~/composables/useGroupInventoryEditor'
import { configureApiClientForTests, resetApiClientForTests } from '~/composables/useApiClient'
import { GROUP_INVENTORY_API_PATHS } from '~/utils/apiRoutes'
import { createDefaultGroupInventoryDocument, type GroupInventoryDocument } from '~/types/groupInventory'
import type { ApiClient } from '~/utils/apiClient'

const groupInventoryFixture = (overrides: Partial<GroupInventoryDocument> = {}): GroupInventoryDocument => {
  const document = createDefaultGroupInventoryDocument({ now: 1_700_000_000_000 })
  return {
    ...document,
    revision: 3,
    updatedAt: 1_700_000_000_000,
    money: 100,
    inventory: {
      ...document.inventory,
      pokemonItems: [
        { id: 'potion-row', name: 'Potion', qty: 2, cost: '$200', description: 'Heals 20 Hit Points' },
      ],
    },
    ...overrides,
  }
}

const createMockApiClient = (postJson: ReturnType<typeof vi.fn>): ApiClient => ({
  getJson: vi.fn() as ApiClient['getJson'],
  postJson: postJson as ApiClient['postJson'],
})

describe('useGroupInventoryEditor', () => {
  beforeEach(() => {
    resetApiClientForTests()
  })

  afterEach(() => {
    resetApiClientForTests()
  })

  it('saves dirty GM edits with the current expected revision and adopts the authoritative response', async () => {
    const source = ref<GroupInventoryDocument | null>(groupInventoryFixture())
    const canEdit = ref(true)
    const authoritative = groupInventoryFixture({ revision: 4, updatedAt: 1_700_000_000_500, money: 150 })
    const postJson = vi.fn(async () => ({ ok: true, changed: true, document: authoritative }))
    configureApiClientForTests(createMockApiClient(postJson))

    const editor = useGroupInventoryEditor(source, { canEdit })
    editor.document.value!.money = 150

    await editor.save()

    expect(postJson).toHaveBeenCalledWith(GROUP_INVENTORY_API_PATHS.save, {
      slug: 'main',
      expectedRevision: 3,
      document: expect.objectContaining({
        slug: 'main',
        revision: 3,
        money: 150,
      }),
    })
    expect(editor.document.value).toEqual(authoritative)
    expect(editor.saveStatus.value).toBe('saved')
    expect(editor.saveError.value).toBeNull()
    expect(editor.isDirty.value).toBe(false)
  })

  it('keeps local edits on stale conflicts and replaces them only after the caller reloads authoritative data', async () => {
    const source = ref<GroupInventoryDocument | null>(groupInventoryFixture())
    const canEdit = ref(true)
    const conflict = Object.assign(new Error('Group inventory main has changed; reload before saving.'), {
      statusCode: 409,
    })
    const postJson = vi.fn(async () => {
      throw conflict
    })
    configureApiClientForTests(createMockApiClient(postJson))

    const editor = useGroupInventoryEditor(source, { canEdit })
    editor.document.value!.money = 999

    await editor.save()

    expect(editor.saveStatus.value).toBe('conflict')
    expect(editor.saveError.value).toContain('reload before saving')
    expect(editor.document.value?.money).toBe(999)
    expect(editor.document.value?.revision).toBe(3)
    expect(editor.isDirty.value).toBe(true)

    const reloaded = groupInventoryFixture({ revision: 5, updatedAt: 1_700_000_001_000, money: 400 })
    source.value = reloaded
    await nextTick()

    expect(editor.document.value).toEqual(reloaded)
    expect(editor.saveStatus.value).toBe('idle')
    expect(editor.saveError.value).toBeNull()
    expect(editor.isDirty.value).toBe(false)
  })

  it('does not post saves when the current actor cannot edit group inventory', async () => {
    const source = ref<GroupInventoryDocument | null>(groupInventoryFixture())
    const canEdit = ref(false)
    const postJson = vi.fn()
    configureApiClientForTests(createMockApiClient(postJson))

    const editor = useGroupInventoryEditor(source, { canEdit })
    editor.document.value!.money = 500

    await editor.save()

    expect(postJson).not.toHaveBeenCalled()
    expect(editor.saveStatus.value).toBe('error')
    expect(editor.saveError.value).toBe('Only GMs can save the shared inventory.')
  })
})
