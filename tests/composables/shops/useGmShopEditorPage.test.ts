import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useGmShopEditorPage } from '~/composables/shops/useGmShopEditorPage'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'
import type { ApiClient } from '~/utils/apiClient'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'

const makeEntry = (overrides: Partial<ShopEntry> = {}): ShopEntry => ({
  id: 'row-1',
  itemName: 'Potion',
  section: 'medicalKit',
  price: 200,
  stock: null,
  ...overrides,
})

const makeShop = (overrides: Partial<ShopTableDocument> = {}): ShopTableDocument => ({
  slug: 'bazaar',
  revision: 2,
  updatedAt: 1_700_000_000_000,
  name: 'Bazaar',
  description: 'Reliable supplies.',
  playerVisible: false,
  open: false,
  allowedPaymentSources: ['trainer'],
  allowedDeliveryTargets: ['trainer'],
  entries: [makeEntry()],
  gmNotes: 'Private stock note.',
  ...overrides,
})

const makeApiClient = ({
  loadedShop = makeShop(),
  savedShop = makeShop({ revision: 3, updatedAt: 1_700_000_000_500 }),
  deletedShop = loadedShop,
  loadError,
  saveError,
  deleteError,
}: {
  loadedShop?: ShopTableDocument
  savedShop?: ShopTableDocument
  deletedShop?: ShopTableDocument
  loadError?: unknown
  saveError?: unknown
  deleteError?: unknown
} = {}): Pick<ApiClient, 'getJson' | 'postJson'> & {
  getJson: ReturnType<typeof vi.fn>
  postJson: ReturnType<typeof vi.fn>
} => {
  const getJson = vi.fn(async (request: string, options?: { params?: Record<string, unknown> }) => {
    expect(request).toBe(SHOP_API_PATHS.load)
    expect(options?.params).toEqual({ slug: 'bazaar' })
    if (loadError !== undefined) throw loadError
    return {
      shop: loadedShop,
      revision: loadedShop.revision,
      updatedAt: loadedShop.updatedAt,
    }
  })

  const postJson = vi.fn(async (request: string) => {
    if (request === SHOP_API_PATHS.save) {
      if (saveError !== undefined) throw saveError
      return { ok: true, changed: true, shop: savedShop }
    }

    if (request === SHOP_API_PATHS.deleteShop) {
      if (deleteError !== undefined) throw deleteError
      return { ok: true, shop: deletedShop }
    }

    throw new Error(`Unexpected shop editor route ${request}`)
  })

  return {
    getJson: getJson as unknown as ApiClient['getJson'] & ReturnType<typeof vi.fn>,
    postJson: postJson as unknown as ApiClient['postJson'] & ReturnType<typeof vi.fn>,
  }
}

describe('useGmShopEditorPage', () => {
  it('loads and saves dirty GM edits with the expected revision, then adopts the authoritative shop', async () => {
    const initialShop = makeShop({ revision: 7 })
    const authoritativeShop = makeShop({
      revision: 8,
      updatedAt: 1_700_000_000_800,
      name: 'Saved Bazaar',
      open: true,
      allowedPaymentSources: ['trainer', 'groupInventory'],
      entries: [makeEntry({ id: 'row-2', itemName: 'Super Potion', price: 700, stock: 4 })],
    })
    const apiClient = makeApiClient({ loadedShop: initialShop, savedShop: authoritativeShop })
    const editor = useGmShopEditorPage({
      isGm: ref(true),
      slug: ref('bazaar'),
      apiClient,
      clientId: 'client-a',
      autoLoadOnMounted: false,
    })

    await expect(editor.loadShop()).resolves.toEqual(initialShop)
    editor.draft.value!.name = 'Edited Bazaar'
    editor.draft.value!.open = true
    editor.draft.value!.allowedPaymentSources = ['trainer', 'groupInventory']
    editor.setEntries([makeEntry({ id: 'row-2', itemName: 'Super Potion', price: 700, stock: 4 })])

    await expect(editor.saveShop()).resolves.toEqual(authoritativeShop)

    expect(apiClient.postJson).toHaveBeenCalledWith(SHOP_API_PATHS.save, {
      slug: 'bazaar',
      expectedRevision: 7,
      document: expect.objectContaining({
        slug: 'bazaar',
        revision: 7,
        name: 'Edited Bazaar',
        open: true,
        allowedPaymentSources: ['trainer', 'groupInventory'],
        entries: [expect.objectContaining({ id: 'row-2', itemName: 'Super Potion', price: 700, stock: 4 })],
      }),
      clientId: 'client-a',
    })
    expect(editor.draft.value).toEqual(authoritativeShop)
    expect(editor.saveStatus.value).toBe('saved')
    expect(editor.saveErrorMessage.value).toBeNull()
    expect(editor.isDirty.value).toBe(false)
  })

  it('keeps local edits on stale save conflicts so a reload can resolve the conflict', async () => {
    const conflict = Object.assign(
      new Error('Shop bazaar has changed (current revision is 3); reload before saving.'),
      { statusCode: 409 },
    )
    const apiClient = makeApiClient({ saveError: conflict })
    const editor = useGmShopEditorPage({
      isGm: ref(true),
      slug: ref('bazaar'),
      apiClient,
      clientId: 'client-a',
      autoLoadOnMounted: false,
    })

    editor.adoptAuthoritativeShop(makeShop({ revision: 2, gmNotes: 'Original note.' }))
    editor.draft.value!.gmNotes = 'Unsaved conflict note.'

    await expect(editor.saveShop()).resolves.toBeNull()

    expect(editor.saveStatus.value).toBe('conflict')
    expect(editor.saveErrorMessage.value).toContain('reload before saving')
    expect(editor.draft.value?.revision).toBe(2)
    expect(editor.draft.value?.gmNotes).toBe('Unsaved conflict note.')
    expect(editor.isDirty.value).toBe(true)
  })

  it('deletes the loaded shop through the delete route and clears the editor draft', async () => {
    const initialShop = makeShop({ revision: 5 })
    const apiClient = makeApiClient({ deletedShop: initialShop })
    const editor = useGmShopEditorPage({
      isGm: ref(true),
      slug: ref('bazaar'),
      apiClient,
      clientId: 'client-a',
      autoLoadOnMounted: false,
    })

    editor.adoptAuthoritativeShop(initialShop)

    await expect(editor.deleteShop()).resolves.toEqual(initialShop)

    expect(apiClient.postJson).toHaveBeenCalledWith(SHOP_API_PATHS.deleteShop, {
      slug: 'bazaar',
      expectedRevision: 5,
      clientId: 'client-a',
    })
    expect(editor.deletedShop.value).toEqual(initialShop)
    expect(editor.draft.value).toBeNull()
    expect(editor.deleteStatus.value).toBe('deleted')
    expect(editor.deleteErrorMessage.value).toBeNull()
  })

  it('keeps the loaded shop available when delete fails', async () => {
    const initialShop = makeShop({ revision: 6 })
    const apiClient = makeApiClient({ deleteError: { data: { statusMessage: 'Cannot delete this shop.' } } })
    const editor = useGmShopEditorPage({
      isGm: ref(true),
      slug: ref('bazaar'),
      apiClient,
      clientId: 'client-a',
      autoLoadOnMounted: false,
    })

    editor.adoptAuthoritativeShop(initialShop)

    await expect(editor.deleteShop()).resolves.toBeNull()

    expect(editor.deleteStatus.value).toBe('error')
    expect(editor.deleteErrorMessage.value).toBe('Cannot delete this shop.')
    expect(editor.draft.value).toEqual(initialShop)
    expect(editor.deletedShop.value).toBeNull()
  })

  it('does not load or mutate shop documents for non-GM actors', async () => {
    const apiClient = makeApiClient()
    const editor = useGmShopEditorPage({
      isGm: ref(false),
      slug: ref('bazaar'),
      apiClient,
      clientId: 'client-a',
      autoLoadOnMounted: false,
    })

    await expect(editor.loadShop()).resolves.toBeNull()
    await expect(editor.saveShop()).resolves.toBeNull()
    await expect(editor.deleteShop()).resolves.toBeNull()

    expect(apiClient.getJson).not.toHaveBeenCalled()
    expect(apiClient.postJson).not.toHaveBeenCalled()
    expect(editor.loadStatus.value).toBe('forbidden')
    expect(editor.loadErrorMessage.value).toBe('Only GM users can edit shop tables.')
  })
})
