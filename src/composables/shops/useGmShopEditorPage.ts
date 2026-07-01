import { computed, getCurrentScope, onMounted, onScopeDispose, ref, watch, type Ref } from 'vue'
import { normalizeRevision } from '#shared/sessionRevisions'
import { shopChannel } from '#shared/realtime'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'
import type {
  DeleteShopResponse,
  LoadShopResponse,
  SaveShopResponse,
} from '~/composables/shops/shopLibraryApi'
import { subscribeChannel, type RealtimeEvent } from '~/composables/useRealtime'
import type { ApiClient } from '~/utils/apiClient'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import { deepCloneJson, stableJsonStringify } from '~/utils/serialization'
import { applyShopRealtimeEvent } from '~/utils/shopRealtime'
import { useApiClient } from '~/composables/useApiClient'

export type GmShopEditorLoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'
export type GmShopEditorSaveStatus = 'idle' | 'saving' | 'saved' | 'conflict' | 'error'
export type GmShopEditorDeleteStatus = 'idle' | 'deleting' | 'deleted' | 'error'

export type GmShopEditorRealtimeChannelSubscriber = (
  channel: string,
  handler: (event: RealtimeEvent) => void,
) => () => void

export interface UseGmShopEditorPageDependencies {
  readonly isGm: Readonly<Ref<boolean>>
  readonly slug: Readonly<Ref<string | null | undefined>>
  readonly apiClient?: Pick<ApiClient, 'getJson' | 'postJson'>
  readonly clientId?: string
  readonly subscribeRealtimeChannel?: GmShopEditorRealtimeChannelSubscriber
  readonly realtimeEnabled?: boolean
  readonly autoLoadOnMounted?: boolean
}

export interface UseGmShopEditorPageReturn {
  readonly draft: Ref<ShopTableDocument | null>
  readonly deletedShop: Ref<ShopTableDocument | null>
  readonly loadStatus: Ref<GmShopEditorLoadStatus>
  readonly loadErrorMessage: Ref<string | null>
  readonly saveStatus: Ref<GmShopEditorSaveStatus>
  readonly saveErrorMessage: Ref<string | null>
  readonly deleteStatus: Ref<GmShopEditorDeleteStatus>
  readonly deleteErrorMessage: Ref<string | null>
  readonly isDirty: Readonly<Ref<boolean>>
  readonly canSave: Readonly<Ref<boolean>>
  readonly canDelete: Readonly<Ref<boolean>>
  readonly adoptAuthoritativeShop: (shop: ShopTableDocument | null | undefined) => void
  readonly setEntries: (entries: readonly ShopEntry[]) => void
  readonly loadShop: () => Promise<ShopTableDocument | null>
  readonly saveShop: () => Promise<ShopTableDocument | null>
  readonly deleteShop: () => Promise<ShopTableDocument | null>
  readonly handleRealtimeShopEvent: (event: RealtimeEvent) => void
}

const cloneShop = (shop: ShopTableDocument): ShopTableDocument => deepCloneJson(shop)
const cloneEntries = (entries: readonly ShopEntry[]): ShopEntry[] => deepCloneJson(entries) as ShopEntry[]

const shopJson = (shop: ShopTableDocument | null): string => (
  shop ? stableJsonStringify(shop) : 'null'
)

const numericErrorField = (source: unknown, field: string): number | null => {
  if (!source || typeof source !== 'object') return null
  const value = (source as Record<string, unknown>)[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const errorStatusCode = (error: unknown): number | null => {
  for (const field of ['statusCode', 'status'] as const) {
    const statusCode = numericErrorField(error, field)
    if (statusCode !== null) return statusCode
  }

  const response = error && typeof error === 'object'
    ? (error as Record<string, unknown>).response
    : null
  return numericErrorField(response, 'status')
}

const isConflictError = (error: unknown): boolean => {
  const message = getErrorMessage(error).toLowerCase()
  return errorStatusCode(error) === 409
    || message.includes('reload before saving')
    || message.includes('has changed')
}

const emptySlug = (value: unknown): boolean => String(value ?? '').trim().length === 0

export const useGmShopEditorPage = (
  dependencies: UseGmShopEditorPageDependencies,
): UseGmShopEditorPageReturn => {
  const apiClient = dependencies.apiClient ?? useApiClient()
  const clientId = dependencies.clientId ?? getClientId()
  const draft = ref<ShopTableDocument | null>(null)
  const deletedShop = ref<ShopTableDocument | null>(null)
  const loadStatus = ref<GmShopEditorLoadStatus>(dependencies.isGm.value ? 'loading' : 'forbidden')
  const loadErrorMessage = ref<string | null>(null)
  const saveStatus = ref<GmShopEditorSaveStatus>('idle')
  const saveErrorMessage = ref<string | null>(null)
  const deleteStatus = ref<GmShopEditorDeleteStatus>('idle')
  const deleteErrorMessage = ref<string | null>(null)
  const lastAuthoritativeJson = ref(shopJson(null))
  let unsubscribeRealtime: (() => void) | null = null
  let subscribedRealtimeSlug: string | null = null

  const requestedSlug = computed(() => String(dependencies.slug.value ?? '').trim())
  const isDirty = computed(() => shopJson(draft.value) !== lastAuthoritativeJson.value)
  const isSaving = computed(() => saveStatus.value === 'saving')
  const isDeleting = computed(() => deleteStatus.value === 'deleting')
  const canSave = computed(() => (
    dependencies.isGm.value
    && draft.value !== null
    && isDirty.value
    && !isSaving.value
    && !isDeleting.value
  ))
  const canDelete = computed(() => (
    dependencies.isGm.value
    && draft.value !== null
    && !isSaving.value
    && !isDeleting.value
  ))

  const adoptAuthoritativeShop = (shop: ShopTableDocument | null | undefined): void => {
    draft.value = shop ? cloneShop(shop) : null
    lastAuthoritativeJson.value = shopJson(draft.value)
    saveStatus.value = 'idle'
    saveErrorMessage.value = null
    deleteStatus.value = 'idle'
    deleteErrorMessage.value = null
    deletedShop.value = null
  }

  const resetForForbiddenActor = (): void => {
    adoptAuthoritativeShop(null)
    loadStatus.value = 'forbidden'
    loadErrorMessage.value = 'Only GM users can edit shop tables.'
  }

  const loadShop = async (): Promise<ShopTableDocument | null> => {
    if (!dependencies.isGm.value) {
      resetForForbiddenActor()
      return null
    }

    if (emptySlug(requestedSlug.value)) {
      adoptAuthoritativeShop(null)
      loadStatus.value = 'error'
      loadErrorMessage.value = 'No shop slug was provided.'
      return null
    }

    loadStatus.value = 'loading'
    loadErrorMessage.value = null

    try {
      const response = await apiClient.getJson<LoadShopResponse>(SHOP_API_PATHS.load, {
        params: { slug: requestedSlug.value },
      })
      adoptAuthoritativeShop(response.shop)
      loadStatus.value = 'ready'
      return draft.value
    } catch (error: unknown) {
      adoptAuthoritativeShop(null)
      loadStatus.value = 'error'
      loadErrorMessage.value = getErrorMessage(error, { fallback: 'The shop table could not be loaded.' })
      return null
    }
  }

  const setEntries = (entries: readonly ShopEntry[]): void => {
    if (!draft.value) return
    draft.value = {
      ...draft.value,
      entries: cloneEntries(entries),
    }
  }

  const handleRealtimeShopEvent = (event: RealtimeEvent): void => {
    const result = applyShopRealtimeEvent(event, {
      currentDocument: draft.value,
      clientId,
      expectedSlug: requestedSlug.value,
    })

    if (result.status === 'adopted' || result.status === 'unchanged') {
      if (isDirty.value) {
        saveStatus.value = 'conflict'
        saveErrorMessage.value = 'This shop changed in another client. Reload latest shop before saving again.'
        return
      }
      adoptAuthoritativeShop(result.document)
      loadStatus.value = 'ready'
      loadErrorMessage.value = null
      return
    }

    if (result.status === 'deleted') {
      if (isDirty.value) {
        saveStatus.value = 'conflict'
        saveErrorMessage.value = 'This shop was deleted in another client. Return to the shop library or reload before editing.'
        return
      }
      deletedShop.value = draft.value ? cloneShop(draft.value) : null
      draft.value = null
      lastAuthoritativeJson.value = shopJson(null)
      loadStatus.value = 'error'
      loadErrorMessage.value = 'This shop table was deleted.'
    }
  }

  const realtimeSubscriber = (): GmShopEditorRealtimeChannelSubscriber | null => {
    if (dependencies.realtimeEnabled === false) return null
    if (dependencies.subscribeRealtimeChannel) return dependencies.subscribeRealtimeChannel
    if (typeof window === 'undefined') return null
    return subscribeChannel
  }

  const subscribeToRealtimeSlug = (): void => {
    const slug = requestedSlug.value
    const subscriber = realtimeSubscriber()
    if (!slug || !dependencies.isGm.value || !subscriber) {
      unsubscribeRealtime?.()
      unsubscribeRealtime = null
      subscribedRealtimeSlug = null
      return
    }

    if (subscribedRealtimeSlug === slug) return
    unsubscribeRealtime?.()
    subscribedRealtimeSlug = slug
    unsubscribeRealtime = subscriber(shopChannel(slug), handleRealtimeShopEvent)
  }

  const saveShop = async (): Promise<ShopTableDocument | null> => {
    if (!dependencies.isGm.value) {
      saveStatus.value = 'error'
      saveErrorMessage.value = 'Only GM users can save shop tables.'
      return null
    }

    const currentShop = draft.value
    if (!currentShop) {
      saveStatus.value = 'error'
      saveErrorMessage.value = 'No shop table is loaded.'
      return null
    }

    if (!isDirty.value) {
      saveStatus.value = 'saved'
      saveErrorMessage.value = null
      return currentShop
    }

    saveStatus.value = 'saving'
    saveErrorMessage.value = null

    try {
      const response = await apiClient.postJson<SaveShopResponse>(SHOP_API_PATHS.save, {
        slug: currentShop.slug,
        expectedRevision: normalizeRevision(currentShop.revision),
        document: cloneShop(currentShop),
        clientId,
      })
      adoptAuthoritativeShop(response.shop)
      saveStatus.value = 'saved'
      return draft.value
    } catch (error: unknown) {
      saveStatus.value = isConflictError(error) ? 'conflict' : 'error'
      saveErrorMessage.value = getErrorMessage(error, { fallback: 'The shop table could not be saved.' })
      return null
    }
  }

  const deleteShop = async (): Promise<ShopTableDocument | null> => {
    if (!dependencies.isGm.value) {
      deleteStatus.value = 'error'
      deleteErrorMessage.value = 'Only GM users can delete shop tables.'
      return null
    }

    const currentShop = draft.value
    if (!currentShop) {
      deleteStatus.value = 'error'
      deleteErrorMessage.value = 'No shop table is loaded.'
      return null
    }

    deleteStatus.value = 'deleting'
    deleteErrorMessage.value = null

    try {
      const response = await apiClient.postJson<DeleteShopResponse>(SHOP_API_PATHS.deleteShop, {
        slug: currentShop.slug,
        expectedRevision: normalizeRevision(currentShop.revision),
        clientId,
      })
      deletedShop.value = cloneShop(response.shop)
      draft.value = null
      lastAuthoritativeJson.value = shopJson(null)
      saveStatus.value = 'idle'
      saveErrorMessage.value = null
      deleteStatus.value = 'deleted'
      return deletedShop.value
    } catch (error: unknown) {
      deleteStatus.value = 'error'
      deleteErrorMessage.value = getErrorMessage(error, { fallback: 'The shop table could not be deleted.' })
      return null
    }
  }

  if (dependencies.autoLoadOnMounted !== false) {
    onMounted(() => {
      void loadShop()
    })

    watch(requestedSlug, (nextSlug, previousSlug) => {
      if (nextSlug !== previousSlug) void loadShop()
    })
  }

  subscribeToRealtimeSlug()
  watch([requestedSlug, dependencies.isGm], subscribeToRealtimeSlug)

  if (getCurrentScope()) {
    onScopeDispose(() => {
      unsubscribeRealtime?.()
      unsubscribeRealtime = null
      subscribedRealtimeSlug = null
    })
  }

  return {
    draft,
    deletedShop,
    loadStatus,
    loadErrorMessage,
    saveStatus,
    saveErrorMessage,
    deleteStatus,
    deleteErrorMessage,
    isDirty,
    canSave,
    canDelete,
    adoptAuthoritativeShop,
    setEntries,
    loadShop,
    saveShop,
    deleteShop,
    handleRealtimeShopEvent,
  }
}
