import { computed, getCurrentScope, onMounted, onScopeDispose, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { AuthRole } from '#shared/auth'
import { groupInventoryChannel, isRealtimeEcho, sheetChannel, shopChannel, type RealtimeEvent } from '#shared/realtime'
import { type LivePlayRandomUuidProvider, type ShopCheckoutCommandResult, type ShopCheckoutOrigin } from '#shared/livePlayCommands'
import type { PlayerProfileId } from '#shared/playerProfiles'
import {
  parseShopCheckoutContinuationReceipt,
  parseShopPostCheckoutActionProjection,
  parseShopPostCheckoutActionRequest,
  type ShopCheckoutContinuationReceiptV1,
  type ShopPostCheckoutActionProjectionStatus,
  type ShopPostCheckoutActionProjectionV1,
} from '#shared/shopPostCheckout'
import { normalizeRevision } from '#shared/sessionRevisions'
import { useShopCheckoutCommands, type ShopCheckoutCommandDispatchResult, type ShopCheckoutCommandStatus } from '~/composables/shops/useShopCheckoutCommands'
import { subscribeChannel } from '~/composables/useRealtime'
import { useApiClient } from '~/composables/useApiClient'
import type { ApiClient } from '~/utils/apiClient'
import { GROUP_INVENTORY_MAIN_SLUG, type GroupInventoryDocument } from '~/types/groupInventory'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'
import type { TrainerSheet } from '~/types/trainerSheet'
import { GROUP_INVENTORY_API_PATHS, SHEET_API_PATHS, SHOP_API_PATHS } from '~/utils/apiRoutes'
import { getClientId } from '~/utils/clientId'
import { getErrorMessage } from '~/utils/errorMessages'
import { applyGroupInventoryRealtimeEvent, type GroupInventoryRealtimeApplicationResult } from '~/utils/groupInventoryRealtime'
import { type LivePlayCommandOutbox } from '~/utils/livePlayCommandOutbox'
import { deepCloneJson, stableJsonStringify } from '~/utils/serialization'
import { buildSheetListFetchOptions, sheetApiProfileContext } from '~/utils/sheetApiRequests'

interface ReadonlyValueRef<TValue> {
  readonly value: TValue
}

interface SheetListResponse {
  readonly trainerSheets?: readonly TrainerSheet[]
}

export type ShopfrontCheckoutDocumentsStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ShopfrontCheckoutParticipantKind = 'trainer' | 'groupInventory'
export type ShopfrontRealtimeChannelSubscriber = (
  channel: string,
  handler: (event: RealtimeEvent) => void,
) => () => void

export type TrainerSheetRealtimeApplicationResult =
  | { readonly status: 'ignored' }
  | { readonly status: 'ignored-echo' }
  | { readonly status: 'ignored-stale' }
  | { readonly status: 'unchanged'; readonly sheet: TrainerSheet }
  | { readonly status: 'adopted'; readonly sheet: TrainerSheet }
  | { readonly status: 'invalid'; readonly message: string }

export interface ShopfrontCartLine {
  readonly entry: ShopEntry
  readonly quantity: number
  readonly unitPrice: number
  readonly lineTotal: number
}

export interface ShopfrontCheckoutParticipantOption {
  readonly key: string
  readonly kind: ShopfrontCheckoutParticipantKind
  readonly slug: string
  readonly label: string
  readonly revision: number
  readonly money?: number
  readonly description?: string
  readonly playerProfileAccessible?: boolean
}

export interface UseShopfrontCheckoutOptions {
  readonly shop: Ref<ShopTableDocument | null | undefined>
  readonly authRole: ReadonlyValueRef<AuthRole | null | undefined>
  readonly isGm: ReadonlyValueRef<boolean>
  readonly isPlayer: ReadonlyValueRef<boolean>
  readonly selectedProfileId: ReadonlyValueRef<PlayerProfileId | null | undefined>
  readonly checkoutOrigin?: ReadonlyValueRef<ShopCheckoutOrigin | null | undefined>
  readonly apiClient?: Pick<ApiClient, 'getJson' | 'postJson'>
  readonly outbox?: LivePlayCommandOutbox
  readonly leaseOwner?: string
  readonly clientId?: () => string
  readonly randomUuid?: LivePlayRandomUuidProvider
  readonly subscribeRealtimeChannel?: ShopfrontRealtimeChannelSubscriber
  readonly realtimeEnabled?: boolean
  readonly autoLoadOnMounted?: boolean
}

export interface UseShopfrontCheckoutReturn {
  readonly cartQuantities: Ref<Record<string, number>>
  readonly cartLines: ComputedRef<readonly ShopfrontCartLine[]>
  readonly totalPrice: ComputedRef<number>
  readonly hasCartLines: ComputedRef<boolean>
  readonly paymentOptions: ComputedRef<readonly ShopfrontCheckoutParticipantOption[]>
  readonly deliveryOptions: ComputedRef<readonly ShopfrontCheckoutParticipantOption[]>
  readonly selectedPaymentOptionKey: Ref<string>
  readonly selectedDeliveryOptionKey: Ref<string>
  readonly selectedPaymentOption: ComputedRef<ShopfrontCheckoutParticipantOption | null>
  readonly selectedDeliveryOption: ComputedRef<ShopfrontCheckoutParticipantOption | null>
  readonly documentsStatus: Ref<ShopfrontCheckoutDocumentsStatus>
  readonly documentsErrorMessage: Ref<string | null>
  readonly checkoutStatus: ComputedRef<ShopCheckoutCommandStatus>
  readonly checkoutErrorMessage: ComputedRef<string | null>
  readonly checkoutUnavailableReason: ComputedRef<string | null>
  readonly stockChangeNotice: Ref<string | null>
  readonly postCheckoutReceipt: Ref<ShopCheckoutContinuationReceiptV1 | null>
  readonly postCheckoutActions: Ref<ShopPostCheckoutActionProjectionV1 | null>
  readonly postCheckoutActionsStatus: Ref<ShopPostCheckoutActionProjectionStatus>
  readonly postCheckoutActionsError: Ref<string | null>
  readonly canCheckout: ComputedRef<boolean>
  readonly isCheckoutBusy: ComputedRef<boolean>
  readonly pendingOutboxEntries: ReturnType<typeof useShopCheckoutCommands>['pendingOutboxEntries']
  readonly outboxStatus: ReturnType<typeof useShopCheckoutCommands>['outboxStatus']
  readonly outboxError: ReturnType<typeof useShopCheckoutCommands>['outboxError']
  readonly setCartQuantity: (entryId: string, quantity: unknown) => void
  readonly clearCart: () => void
  readonly selectPaymentOption: (optionKey: string) => void
  readonly selectDeliveryOption: (optionKey: string) => void
  readonly loadCheckoutDocuments: () => Promise<void>
  readonly submitCheckout: () => Promise<ShopCheckoutCommandDispatchResult>
  readonly retryOutboxEntry: ReturnType<typeof useShopCheckoutCommands>['retryOutboxEntry']
  readonly discardOutboxEntry: ReturnType<typeof useShopCheckoutCommands>['discardOutboxEntry']
  readonly clearCheckoutError: () => void
  readonly clearStockChangeNotice: () => void
  readonly loadPostCheckoutActions: () => Promise<void>
  readonly dismissPostCheckoutActions: () => void
  readonly handleGroupInventoryRealtimeEvent: (event: RealtimeEvent) => GroupInventoryRealtimeApplicationResult
  readonly handleTrainerSheetRealtimeEvent: (event: RealtimeEvent) => TrainerSheetRealtimeApplicationResult
  readonly handleShopCheckoutRealtimeEvent: (event: RealtimeEvent) => void
}

const MAX_SAFE_CART_QUANTITY = Number.MAX_SAFE_INTEGER
const OPTION_KEY_SEPARATOR = ':'

const isSafeNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
)

const safeNonNegativeInteger = (value: unknown): number => (
  isSafeNonNegativeInteger(value) ? value : 0
)

const coerceQuantity = (value: unknown): number => {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN

  if (!Number.isFinite(numericValue) || numericValue <= 0) return 0
  return Math.min(Math.floor(numericValue), MAX_SAFE_CART_QUANTITY)
}

const optionKey = (kind: ShopfrontCheckoutParticipantKind, slug: string): string => (
  `${kind}${OPTION_KEY_SEPARATOR}${slug}`
)

const trainerName = (sheet: TrainerSheet): string => sheet.name?.trim() || sheet.slug

const compareTrainerSheets = (left: TrainerSheet, right: TrainerSheet): number => {
  const nameOrder = trainerName(left).localeCompare(trainerName(right))
  return nameOrder === 0 ? left.slug.localeCompare(right.slug) : nameOrder
}

const compareParticipantOptions = (
  left: ShopfrontCheckoutParticipantOption,
  right: ShopfrontCheckoutParticipantOption,
): number => {
  if (left.kind !== right.kind) return left.kind === 'trainer' ? -1 : 1
  const labelOrder = left.label.localeCompare(right.label)
  return labelOrder === 0 ? left.slug.localeCompare(right.slug) : labelOrder
}

const shopAllowsTrainer = (shop: ShopTableDocument | null | undefined): boolean => (
  shop?.allowedPaymentSources.includes('trainer') === true
  || shop?.allowedDeliveryTargets.includes('trainer') === true
)

const shopAllowsGroupInventory = (shop: ShopTableDocument | null | undefined): boolean => (
  shop?.allowedPaymentSources.includes('groupInventory') === true
  || shop?.allowedDeliveryTargets.includes('groupInventory') === true
)

const entryQuantityLimit = (entry: ShopEntry): number | null => {
  const limits: number[] = []
  if (entry.stock !== null) limits.push(safeNonNegativeInteger(entry.stock))
  if (entry.maxPerPurchase !== undefined && entry.maxPerPurchase > 0) {
    limits.push(safeNonNegativeInteger(entry.maxPerPurchase))
  }

  return limits.length === 0 ? null : Math.max(0, Math.min(...limits))
}

const sanitizeQuantityForEntry = (entry: ShopEntry, rawQuantity: unknown): number => {
  const quantity = coerceQuantity(rawQuantity)
  if (quantity <= 0) return 0
  const limit = entryQuantityLimit(entry)
  return limit === null ? quantity : Math.min(quantity, limit)
}

const lineTotal = (entry: ShopEntry, quantity: number): number => {
  const total = safeNonNegativeInteger(entry.price) * quantity
  return Number.isSafeInteger(total) ? total : MAX_SAFE_CART_QUANTITY
}

const totalCartPrice = (lines: readonly ShopfrontCartLine[]): number => lines.reduce((sum, line) => {
  const next = sum + line.lineTotal
  return Number.isSafeInteger(next) ? next : MAX_SAFE_CART_QUANTITY
}, 0)

const trainerOption = (sheet: TrainerSheet): ShopfrontCheckoutParticipantOption => ({
  key: optionKey('trainer', sheet.slug),
  kind: 'trainer',
  slug: sheet.slug,
  label: trainerName(sheet),
  revision: normalizeRevision(sheet.revision),
  money: safeNonNegativeInteger(sheet.money),
  description: `Trainer sheet · revision ${normalizeRevision(sheet.revision)}`,
  ...(sheet.playerProfileAccessible === true ? { playerProfileAccessible: true } : {}),
})

const groupInventoryOption = (document: GroupInventoryDocument): ShopfrontCheckoutParticipantOption => ({
  key: optionKey('groupInventory', document.slug),
  kind: 'groupInventory',
  slug: document.slug,
  label: document.slug === GROUP_INVENTORY_MAIN_SLUG ? 'Shared group inventory' : `Group inventory ${document.slug}`,
  revision: normalizeRevision(document.revision),
  money: safeNonNegativeInteger(document.money),
  description: `Group inventory · revision ${normalizeRevision(document.revision)}`,
})

const participantReference = (option: ShopfrontCheckoutParticipantOption) => ({
  kind: option.kind,
  slug: option.slug,
  revision: option.revision,
} as const)

const isAcceptedCheckoutResponse = (response: ShopCheckoutCommandResult | undefined): boolean => {
  if (!response?.ok) return false
  if ('duplicate' in response) return response.original.ok === true
  return true
}

const preserveTrainerAccessAnnotations = (next: TrainerSheet, previous: TrainerSheet | undefined): TrainerSheet => ({
  ...next,
  ...(previous?.playerProfileAccessible === true && next.playerProfileAccessible !== true
    ? { playerProfileAccessible: true }
    : {}),
  ...(previous?.sessionPlayerAccessible === true && next.sessionPlayerAccessible !== true
    ? { sessionPlayerAccessible: true }
    : {}),
})

interface TrainerSheetRealtimePayload {
  readonly kind?: unknown
  readonly slug?: unknown
  readonly sheet?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const safeRevision = (value: unknown): number | null => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
)

const normalizeIncomingTrainerSheet = (
  payload: TrainerSheetRealtimePayload | undefined,
): TrainerSheet | null => {
  if (payload?.kind !== 'trainer') return null
  if (typeof payload.slug !== 'string' || payload.slug.trim().length === 0) return null
  if (!isRecord(payload.sheet)) return null
  if (payload.sheet.slug !== payload.slug) return null
  if (safeRevision(payload.sheet.revision) === null) return null
  return deepCloneJson(payload.sheet as unknown as TrainerSheet)
}

const sameTrainerSheet = (left: TrainerSheet | undefined, right: TrainerSheet): boolean => (
  !!left && stableJsonStringify(left) === stableJsonStringify(right)
)

const cartQuantityCount = (quantities: Record<string, number>): number => (
  Object.values(quantities).filter((quantity) => quantity > 0).length
)

const entryStockChanged = (
  previousEntries: readonly ShopEntry[] | undefined,
  nextEntries: readonly ShopEntry[],
): boolean => {
  if (!previousEntries) return false
  const previousById = new Map(previousEntries.map((entry) => [entry.id, entry.stock] as const))
  return nextEntries.some((entry) => previousById.has(entry.id) && previousById.get(entry.id) !== entry.stock)
}

const adjustedCartNotice = (adjustedNames: readonly string[]): string => {
  if (adjustedNames.length === 0) return 'Shop stock changed. Review your cart before buying.'
  const uniqueNames = [...new Set(adjustedNames)]
  if (uniqueNames.length === 1) return `Shop stock changed; adjusted ${uniqueNames[0]} in your cart.`
  return `Shop stock changed; adjusted ${uniqueNames.length} cart items.`
}

export const useShopfrontCheckout = (
  options: UseShopfrontCheckoutOptions,
): UseShopfrontCheckoutReturn => {
  const apiClient = options.apiClient ?? useApiClient()
  const clientId = options.clientId ?? getClientId
  const cartQuantities = ref<Record<string, number>>({})
  const trainerSheets = ref<TrainerSheet[]>([])
  const groupInventoryDocument = ref<GroupInventoryDocument | null>(null)
  const documentsStatus = ref<ShopfrontCheckoutDocumentsStatus>('idle')
  const documentsErrorMessage = ref<string | null>(null)
  const selectedPaymentOptionKey = ref('')
  const selectedDeliveryOptionKey = ref('')
  const localCheckoutError = ref<string | null>(null)
  const stockChangeNotice = ref<string | null>(null)
  const postCheckoutReceipt = ref<ShopCheckoutContinuationReceiptV1 | null>(null)
  const postCheckoutActions = ref<ShopPostCheckoutActionProjectionV1 | null>(null)
  const postCheckoutActionsStatus = ref<ShopPostCheckoutActionProjectionStatus>('idle')
  const postCheckoutActionsError = ref<string | null>(null)
  let postCheckoutContext: { readonly shopSlug: string, readonly operationId: string } | null = null
  let postCheckoutLoadGeneration = 0
  let unsubscribeGroupInventoryRealtime: (() => void) | null = null
  let subscribedGroupInventorySlug: string | null = null
  let unsubscribeShopCheckoutRealtime: (() => void) | null = null
  let subscribedShopCheckoutSlug: string | null = null
  const trainerRealtimeUnsubscribers = new Map<string, () => void>()

  const clearCart = (): void => {
    cartQuantities.value = {}
    stockChangeNotice.value = null
  }

  const dismissPostCheckoutActions = (): void => {
    postCheckoutLoadGeneration += 1
    postCheckoutReceipt.value = null
    postCheckoutActions.value = null
    postCheckoutActionsStatus.value = 'idle'
    postCheckoutActionsError.value = null
    postCheckoutContext = null
  }

  const loadPostCheckoutActions = async (): Promise<void> => {
    const receipt = postCheckoutReceipt.value
    const context = postCheckoutContext
    if (!receipt || !context) return
    const loadGeneration = ++postCheckoutLoadGeneration
    postCheckoutActionsStatus.value = 'loading'
    postCheckoutActionsError.value = null
    try {
      const request = parseShopPostCheckoutActionRequest({
        schemaVersion: 1,
        shopSlug: context.shopSlug,
        checkoutOperationId: context.operationId,
        continuationIds: receipt.continuations.map(row => row.continuationId),
      })
      const projection = parseShopPostCheckoutActionProjection(await apiClient.postJson<unknown>(
        SHOP_API_PATHS.postCheckoutActions,
        {
          request,
          ...(options.selectedProfileId.value ? { profileId: options.selectedProfileId.value } : {}),
        },
      ))
      const expectedIds = receipt.continuations.map(row => row.continuationId)
      if (projection.items.length !== expectedIds.length
        || projection.items.some(item => !expectedIds.includes(item.continuationId))) {
        throw new Error('Post-checkout actions do not match the exact accepted delivery receipt.')
      }
      if (loadGeneration !== postCheckoutLoadGeneration) return
      postCheckoutActions.value = projection
      postCheckoutActionsStatus.value = 'ready'
    }
    catch (error) {
      if (loadGeneration !== postCheckoutLoadGeneration) return
      postCheckoutActions.value = null
      postCheckoutActionsStatus.value = 'error'
      postCheckoutActionsError.value = getErrorMessage(error, {
        fallback: 'Exact post-checkout action options could not be loaded.',
      })
    }
  }

  const upsertTrainerSheet = (sheet: TrainerSheet): void => {
    const previous = trainerSheets.value.find((candidate) => candidate.slug === sheet.slug)
    const next = preserveTrainerAccessAnnotations(sheet, previous)
    const replaced = trainerSheets.value.some((candidate) => candidate.slug === next.slug)
    trainerSheets.value = (
      replaced
        ? trainerSheets.value.map((candidate) => (candidate.slug === next.slug ? next : candidate))
        : [...trainerSheets.value, next]
    ).sort(compareTrainerSheets)
  }

  const checkoutCommands = useShopCheckoutCommands({
    authRole: options.authRole,
    playerProfileId: options.selectedProfileId,
    shop: options.shop,
    apiClient,
    ...(options.outbox === undefined ? {} : { outbox: options.outbox }),
    ...(options.leaseOwner === undefined ? {} : { leaseOwner: options.leaseOwner }),
    clientId,
    adoptShop: (nextShop) => {
      options.shop.value = nextShop
    },
    adoptGroupInventory: (document) => {
      groupInventoryDocument.value = document
    },
    adoptTrainerSheet: upsertTrainerSheet,
    onCheckoutAccepted: (response) => {
      clearCart()
      if (!response.postCheckout) {
        dismissPostCheckoutActions()
        return
      }
      postCheckoutReceipt.value = parseShopCheckoutContinuationReceipt(response.postCheckout)
      postCheckoutContext = { shopSlug: response.shopSlug, operationId: response.opId }
      void loadPostCheckoutActions()
    },
  })

  const handleGroupInventoryRealtimeEvent = (event: RealtimeEvent): GroupInventoryRealtimeApplicationResult => {
    const currentDocument = groupInventoryDocument.value
    if (!currentDocument) return { status: 'ignored' }

    const result = applyGroupInventoryRealtimeEvent(event, {
      currentDocument,
      clientId: clientId(),
      expectedSlug: currentDocument.slug,
    })
    if (result.status === 'adopted') groupInventoryDocument.value = result.document
    return result
  }

  const handleTrainerSheetRealtimeEvent = (event: RealtimeEvent): TrainerSheetRealtimeApplicationResult => {
    if (event.type !== 'updated' && event.type !== 'created') return { status: 'ignored' }
    if (isRealtimeEcho(event, clientId())) return { status: 'ignored-echo' }

    const sheet = normalizeIncomingTrainerSheet(event.data as TrainerSheetRealtimePayload | undefined)
    if (!sheet) return { status: 'invalid', message: 'Trainer sheet realtime update did not include a complete trainer sheet.' }
    if (event.channel !== sheetChannel('trainer', sheet.slug)) return { status: 'ignored' }

    const previous = trainerSheets.value.find((candidate) => candidate.slug === sheet.slug)
    if (!previous) return { status: 'ignored' }

    const eventRevision = safeRevision(event.revision)
    const incomingRevision = safeRevision(sheet.revision)
    if (eventRevision !== null && eventRevision !== incomingRevision) {
      return { status: 'invalid', message: 'Trainer sheet realtime event revision did not match its document.' }
    }

    const currentRevision = safeRevision(previous.revision)
    if (currentRevision !== null && incomingRevision !== null && incomingRevision < currentRevision) {
      return { status: 'ignored-stale' }
    }

    const nextSheet = preserveTrainerAccessAnnotations(sheet, previous)
    if (sameTrainerSheet(previous, nextSheet)) return { status: 'unchanged', sheet: nextSheet }
    upsertTrainerSheet(nextSheet)
    return { status: 'adopted', sheet: nextSheet }
  }

  const handleShopCheckoutRealtimeEvent = (event: RealtimeEvent): void => {
    void checkoutCommands.acknowledgeTerminalRealtimeEvent(event)
  }

  const realtimeSubscriber = (): ShopfrontRealtimeChannelSubscriber | null => {
    if (options.realtimeEnabled === false) return null
    if (options.subscribeRealtimeChannel) return options.subscribeRealtimeChannel
    if (typeof window === 'undefined') return null
    return subscribeChannel
  }

  const syncGroupInventoryRealtimeSubscription = (): void => {
    const slug = groupInventoryDocument.value?.slug ?? null
    const subscriber = realtimeSubscriber()
    if (!slug || !subscriber) {
      unsubscribeGroupInventoryRealtime?.()
      unsubscribeGroupInventoryRealtime = null
      subscribedGroupInventorySlug = null
      return
    }

    if (subscribedGroupInventorySlug === slug) return
    unsubscribeGroupInventoryRealtime?.()
    subscribedGroupInventorySlug = slug
    unsubscribeGroupInventoryRealtime = subscriber(groupInventoryChannel(slug), handleGroupInventoryRealtimeEvent)
  }

  const syncTrainerSheetRealtimeSubscriptions = (): void => {
    const subscriber = realtimeSubscriber()
    const slugs = new Set(trainerSheets.value.map((sheet) => sheet.slug).filter((slug) => slug.trim().length > 0))

    for (const [slug, unsubscribe] of [...trainerRealtimeUnsubscribers.entries()]) {
      if (subscriber && slugs.has(slug)) continue
      unsubscribe()
      trainerRealtimeUnsubscribers.delete(slug)
    }

    if (!subscriber) return

    for (const slug of slugs) {
      if (trainerRealtimeUnsubscribers.has(slug)) continue
      trainerRealtimeUnsubscribers.set(slug, subscriber(sheetChannel('trainer', slug), handleTrainerSheetRealtimeEvent))
    }
  }

  const syncShopCheckoutRealtimeSubscription = (): void => {
    const slug = options.shop.value?.slug ?? null
    const subscriber = realtimeSubscriber()
    if (!slug || !subscriber) {
      unsubscribeShopCheckoutRealtime?.()
      unsubscribeShopCheckoutRealtime = null
      subscribedShopCheckoutSlug = null
      return
    }

    if (subscribedShopCheckoutSlug === slug) return
    unsubscribeShopCheckoutRealtime?.()
    subscribedShopCheckoutSlug = slug
    unsubscribeShopCheckoutRealtime = subscriber(shopChannel(slug), handleShopCheckoutRealtimeEvent)
  }

  const syncRealtimeSubscriptions = (): void => {
    syncShopCheckoutRealtimeSubscription()
    syncGroupInventoryRealtimeSubscription()
    syncTrainerSheetRealtimeSubscriptions()
  }

  const unsubscribeRealtime = (): void => {
    unsubscribeShopCheckoutRealtime?.()
    unsubscribeShopCheckoutRealtime = null
    subscribedShopCheckoutSlug = null
    unsubscribeGroupInventoryRealtime?.()
    unsubscribeGroupInventoryRealtime = null
    subscribedGroupInventorySlug = null
    for (const unsubscribe of trainerRealtimeUnsubscribers.values()) unsubscribe()
    trainerRealtimeUnsubscribers.clear()
  }

  const shopEntryById = computed(() => new Map(
    (options.shop.value?.entries ?? []).map((entry) => [entry.id, entry] as const),
  ))

  const cartLines = computed<readonly ShopfrontCartLine[]>(() => Object.entries(cartQuantities.value)
    .map(([entryId, quantity]) => {
      const entry = shopEntryById.value.get(entryId)
      if (!entry || quantity <= 0) return null
      return {
        entry,
        quantity,
        unitPrice: safeNonNegativeInteger(entry.price),
        lineTotal: lineTotal(entry, quantity),
      }
    })
    .filter((line): line is ShopfrontCartLine => line !== null))

  const totalPrice = computed(() => totalCartPrice(cartLines.value))
  const hasCartLines = computed(() => cartLines.value.length > 0)

  const eligibleTrainerSheets = computed(() => {
    if (options.isGm.value) return [...trainerSheets.value].sort(compareTrainerSheets)
    if (!options.isPlayer.value) return []
    return trainerSheets.value
      .filter((sheet) => sheet.playerProfileAccessible === true)
      .sort(compareTrainerSheets)
  })

  const baseParticipantOptions = computed<readonly ShopfrontCheckoutParticipantOption[]>(() => {
    const baseOptions = eligibleTrainerSheets.value.map(trainerOption)
    if (groupInventoryDocument.value) baseOptions.push(groupInventoryOption(groupInventoryDocument.value))
    return baseOptions.sort(compareParticipantOptions)
  })

  const paymentOptions = computed<readonly ShopfrontCheckoutParticipantOption[]>(() => {
    const shop = options.shop.value
    if (!shop) return []
    return baseParticipantOptions.value.filter((option) => shop.allowedPaymentSources.includes(option.kind))
  })

  const deliveryOptions = computed<readonly ShopfrontCheckoutParticipantOption[]>(() => {
    const shop = options.shop.value
    if (!shop) return []
    return baseParticipantOptions.value.filter((option) => shop.allowedDeliveryTargets.includes(option.kind))
  })

  const selectedPaymentOption = computed(() => (
    paymentOptions.value.find((option) => option.key === selectedPaymentOptionKey.value) ?? null
  ))
  const selectedDeliveryOption = computed(() => (
    deliveryOptions.value.find((option) => option.key === selectedDeliveryOptionKey.value) ?? null
  ))

  const checkoutStatus = computed<ShopCheckoutCommandStatus>(() => (
    localCheckoutError.value ? 'error' : checkoutCommands.status.value
  ))
  const checkoutErrorMessage = computed(() => localCheckoutError.value ?? checkoutCommands.lastError.value)
  const isCheckoutBusy = computed(() => checkoutCommands.status.value === 'sending')

  const checkoutUnavailableReason = computed<string | null>(() => {
    const shop = options.shop.value
    if (!shop) return 'Load a shop before checking out.'
    if (checkoutCommands.status.value === 'sending') return 'A shop checkout command is already in flight.'
    if (!options.isGm.value && !options.isPlayer.value) return 'Log in as a GM or player before checking out.'
    if (options.isPlayer.value && !options.selectedProfileId.value) {
      return 'Choose a player profile before checking out from shops.'
    }
    if (!hasCartLines.value) return 'Add at least one item quantity to your cart.'
    if (paymentOptions.value.length === 0) return 'No eligible payment source is available for this shop.'
    if (deliveryOptions.value.length === 0) return 'No eligible delivery target is available for this shop.'
    if (!selectedPaymentOption.value) return 'Choose an eligible payment source.'
    if (!selectedDeliveryOption.value) return 'Choose an eligible delivery target.'
    return null
  })

  const canCheckout = computed(() => checkoutUnavailableReason.value === null)

  const selectFirstValidOption = (selected: Ref<string>, availableOptions: readonly ShopfrontCheckoutParticipantOption[]): void => {
    if (availableOptions.some((option) => option.key === selected.value)) return
    selected.value = availableOptions[0]?.key ?? ''
  }

  const syncSelectedOptions = (): void => {
    selectFirstValidOption(selectedPaymentOptionKey, paymentOptions.value)
    selectFirstValidOption(selectedDeliveryOptionKey, deliveryOptions.value)
  }

  const setCartQuantity = (entryId: string, quantity: unknown): void => {
    const entry = shopEntryById.value.get(entryId)
    if (!entry) return

    const normalizedQuantity = sanitizeQuantityForEntry(entry, quantity)
    const next = { ...cartQuantities.value }
    if (normalizedQuantity > 0) next[entryId] = normalizedQuantity
    else delete next[entryId]
    cartQuantities.value = next
    if (cartQuantityCount(next) === 0) stockChangeNotice.value = null
    if (localCheckoutError.value) localCheckoutError.value = null
  }

  const selectPaymentOption = (optionKeyInput: string): void => {
    selectedPaymentOptionKey.value = optionKeyInput
    if (localCheckoutError.value) localCheckoutError.value = null
  }

  const selectDeliveryOption = (optionKeyInput: string): void => {
    selectedDeliveryOptionKey.value = optionKeyInput
    if (localCheckoutError.value) localCheckoutError.value = null
  }

  const loadTrainerSheets = async (shop: ShopTableDocument): Promise<void> => {
    if (!shopAllowsTrainer(shop)) {
      trainerSheets.value = []
      return
    }

    if (!options.isGm.value && !(options.isPlayer.value && options.selectedProfileId.value)) {
      trainerSheets.value = []
      return
    }

    const response = await apiClient.getJson<SheetListResponse>(
      SHEET_API_PATHS.list,
      buildSheetListFetchOptions(sheetApiProfileContext(options.isPlayer.value, options.selectedProfileId.value)),
    )
    trainerSheets.value = [...(response.trainerSheets ?? [])].sort(compareTrainerSheets)
  }

  const loadGroupInventory = async (shop: ShopTableDocument): Promise<void> => {
    if (!shopAllowsGroupInventory(shop) || (!options.isGm.value && !options.isPlayer.value)) {
      groupInventoryDocument.value = null
      return
    }

    groupInventoryDocument.value = await apiClient.getJson<GroupInventoryDocument>(GROUP_INVENTORY_API_PATHS.load, {
      params: { slug: GROUP_INVENTORY_MAIN_SLUG },
    })
  }

  const refreshPendingOutboxEntries = async (): Promise<void> => {
    if (options.authRole.value === 'player' && !options.selectedProfileId.value) return
    if (options.authRole.value !== 'gm' && options.authRole.value !== 'player') return
    try {
      await checkoutCommands.refreshPendingOutboxEntries()
    } catch {
      // The checkout command composable records the outbox error for the UI.
    }
  }

  const loadCheckoutDocuments = async (): Promise<void> => {
    const shop = options.shop.value
    if (!shop) {
      trainerSheets.value = []
      groupInventoryDocument.value = null
      documentsStatus.value = 'idle'
      documentsErrorMessage.value = null
      syncSelectedOptions()
      syncRealtimeSubscriptions()
      return
    }

    documentsStatus.value = 'loading'
    documentsErrorMessage.value = null
    const errors: string[] = []

    try {
      await loadTrainerSheets(shop)
    } catch (error) {
      trainerSheets.value = []
      errors.push(`Trainer sheets could not be loaded: ${getErrorMessage(error, { fallback: 'Unknown error' })}`)
    }

    try {
      await loadGroupInventory(shop)
    } catch (error) {
      groupInventoryDocument.value = null
      errors.push(`Group inventory could not be loaded: ${getErrorMessage(error, { fallback: 'Unknown error' })}`)
    }

    syncSelectedOptions()
    syncRealtimeSubscriptions()
    await refreshPendingOutboxEntries()

    documentsStatus.value = errors.length === 0 ? 'ready' : 'error'
    documentsErrorMessage.value = errors.length === 0 ? null : errors.join(' ')
  }

  watch(
    () => checkoutCommands.status.value,
    (nextStatus, previousStatus) => {
      if (nextStatus === 'accepted' && previousStatus === 'sending') void loadCheckoutDocuments()
    },
  )

  const setValidationFailure = (message: string): ShopCheckoutCommandDispatchResult => {
    localCheckoutError.value = message
    return { dispatched: false, message }
  }

  const submitCheckout = async (): Promise<ShopCheckoutCommandDispatchResult> => {
    const unavailableReason = checkoutUnavailableReason.value
    if (unavailableReason) return setValidationFailure(unavailableReason)

    const paymentOption = selectedPaymentOption.value
    if (!paymentOption) return setValidationFailure('Choose an eligible payment source.')
    const deliveryOption = selectedDeliveryOption.value
    if (!deliveryOption) return setValidationFailure('Choose an eligible delivery target.')

    localCheckoutError.value = null
    dismissPostCheckoutActions()
    const result = await checkoutCommands.checkout({
      paymentSource: participantReference(paymentOption),
      deliveryTarget: participantReference(deliveryOption),
      lines: cartLines.value.map((line) => ({ entryId: line.entry.id, quantity: line.quantity })),
      ...(options.checkoutOrigin?.value ? { origin: options.checkoutOrigin.value } : {}),
      ...(options.randomUuid === undefined ? {} : { randomUuid: options.randomUuid }),
    })

    if (isAcceptedCheckoutResponse(result.response)) clearCart()
    return result
  }

  const clearCheckoutError = (): void => {
    localCheckoutError.value = null
    checkoutCommands.clearError()
  }

  const clearStockChangeNotice = (): void => {
    stockChangeNotice.value = null
  }

  watch([paymentOptions, deliveryOptions], syncSelectedOptions, { immediate: true })
  watch(() => options.shop.value?.slug ?? null, syncShopCheckoutRealtimeSubscription)
  watch(() => options.selectedProfileId.value ?? null, () => {
    if (postCheckoutContext) void loadPostCheckoutActions()
  })
  watch(() => groupInventoryDocument.value?.slug ?? null, syncGroupInventoryRealtimeSubscription)
  watch(
    () => trainerSheets.value.map((sheet) => sheet.slug).sort().join('\u0000'),
    syncTrainerSheetRealtimeSubscriptions,
  )

  watch(
    () => options.shop.value?.entries ?? [],
    (nextEntries, previousEntries) => {
      const hadCart = cartQuantityCount(cartQuantities.value) > 0
      const adjustedNames: string[] = []
      const next: Record<string, number> = {}
      for (const [entryId, quantity] of Object.entries(cartQuantities.value)) {
        const entry = shopEntryById.value.get(entryId)
        if (!entry) continue
        const normalizedQuantity = sanitizeQuantityForEntry(entry, quantity)
        if (normalizedQuantity > 0) next[entryId] = normalizedQuantity
        if (normalizedQuantity < quantity) adjustedNames.push(entry.itemName.trim() || entry.id)
      }
      cartQuantities.value = next

      if (cartQuantityCount(next) === 0) {
        stockChangeNotice.value = null
        return
      }
      if (hadCart && (adjustedNames.length > 0 || entryStockChanged(previousEntries, nextEntries))) {
        stockChangeNotice.value = adjustedCartNotice(adjustedNames)
      }
    },
  )

  const checkoutDocumentLoadSignature = computed(() => {
    const shop = options.shop.value
    return JSON.stringify({
      slug: shop?.slug ?? null,
      payment: shop?.allowedPaymentSources ?? [],
      delivery: shop?.allowedDeliveryTargets ?? [],
      role: options.authRole.value ?? null,
      profileId: options.selectedProfileId.value ?? null,
    })
  })

  if (options.autoLoadOnMounted !== false) {
    onMounted(() => {
      void loadCheckoutDocuments()
    })

    watch(checkoutDocumentLoadSignature, () => {
      if (typeof window === 'undefined') return
      void loadCheckoutDocuments()
    })
  }

  if (getCurrentScope()) {
    onScopeDispose(unsubscribeRealtime)
  }

  return {
    cartQuantities,
    cartLines,
    totalPrice,
    hasCartLines,
    paymentOptions,
    deliveryOptions,
    selectedPaymentOptionKey,
    selectedDeliveryOptionKey,
    selectedPaymentOption,
    selectedDeliveryOption,
    documentsStatus,
    documentsErrorMessage,
    checkoutStatus,
    checkoutErrorMessage,
    checkoutUnavailableReason,
    stockChangeNotice,
    postCheckoutReceipt,
    postCheckoutActions,
    postCheckoutActionsStatus,
    postCheckoutActionsError,
    canCheckout,
    isCheckoutBusy,
    pendingOutboxEntries: checkoutCommands.pendingOutboxEntries,
    outboxStatus: checkoutCommands.outboxStatus,
    outboxError: checkoutCommands.outboxError,
    setCartQuantity,
    clearCart,
    selectPaymentOption,
    selectDeliveryOption,
    loadCheckoutDocuments,
    submitCheckout,
    retryOutboxEntry: checkoutCommands.retryOutboxEntry,
    discardOutboxEntry: checkoutCommands.discardOutboxEntry,
    clearCheckoutError,
    clearStockChangeNotice,
    loadPostCheckoutActions,
    dismissPostCheckoutActions,
    handleGroupInventoryRealtimeEvent,
    handleTrainerSheetRealtimeEvent,
    handleShopCheckoutRealtimeEvent,
  }
}
