import { nextTick, ref, type Ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'
import { groupInventoryChannel, sheetChannel, type RealtimeEvent } from '#shared/realtime'
import { LIVE_PLAY_COMMAND_TYPES, type ShopCheckoutCommandResult } from '#shared/livePlayCommands'
import type { AuthRole } from '#shared/auth'
import type { PlayerProfileId } from '#shared/playerProfiles'
import { useShopfrontCheckout, type UseShopfrontCheckoutReturn } from '~/composables/shops/useShopfrontCheckout'
import { GROUP_INVENTORY_MAIN_SLUG, createDefaultGroupInventoryDocument, type GroupInventoryDocument } from '~/types/groupInventory'
import type { ShopEntry, ShopTableDocument } from '~/types/shop'
import type { TrainerSheet } from '~/types/trainerSheet'
import { GROUP_INVENTORY_API_PATHS, SHEET_API_PATHS, SHOP_API_PATHS } from '~/utils/apiRoutes'
import type { ApiClient } from '~/utils/apiClient'
import { createLivePlayCommandOutbox, type LivePlayCommandOutbox } from '~/utils/livePlayCommandOutbox'

type GetJson = (request: string, options?: unknown) => Promise<unknown>
type PostJson = (request: string, body: unknown) => Promise<unknown>
type GetJsonMock = ReturnType<typeof vi.fn<GetJson>>
type PostJsonMock = ReturnType<typeof vi.fn<PostJson>>

const profileId = 'profile_ash00000' as PlayerProfileId
const deferred = <TValue>() => {
  let resolve!: (value: TValue | PromiseLike<TValue>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<TValue>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

let outboxSequence = 0
let leaseOwnerSequence = 0

const createTestOutbox = (): LivePlayCommandOutbox => {
  outboxSequence += 1
  return createLivePlayCommandOutbox({
    databaseName: `use-shopfront-checkout-${outboxSequence}`,
    indexedDBFactory: new FakeIDBFactory() as unknown as IDBFactory,
  })
}

const makeEntry = (overrides: Partial<ShopEntry> = {}): ShopEntry => ({
  id: 'potion',
  itemName: 'Potion',
  section: 'medicalKit',
  price: 300,
  stock: 5,
  maxPerPurchase: 3,
  playerDescription: 'Restores HP.',
  ...overrides,
})

const makeShop = (overrides: Partial<ShopTableDocument> = {}): ShopTableDocument => ({
  slug: 'viridian-mart',
  revision: 4,
  updatedAt: 1_700_000_000_000,
  name: 'Viridian Mart',
  playerVisible: true,
  open: true,
  allowedPaymentSources: ['trainer'],
  allowedDeliveryTargets: ['trainer'],
  entries: [makeEntry()],
  ...overrides,
})

const trainerFixture = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 5,
  revision: 2,
  money: 1_200,
  inventory: {},
  playerProfileAccessible: true,
  ...overrides,
})

const groupInventoryFixture = (overrides: Partial<GroupInventoryDocument> = {}): GroupInventoryDocument => ({
  ...createDefaultGroupInventoryDocument({ now: 1_000 }),
  slug: GROUP_INVENTORY_MAIN_SLUG,
  revision: 7,
  updatedAt: 1_100,
  money: 2_500,
  ...overrides,
})

const groupInventoryRealtimeEvent = (
  document: GroupInventoryDocument,
  overrides: Partial<RealtimeEvent> = {},
): RealtimeEvent => ({
  channel: groupInventoryChannel(document.slug),
  type: 'updated',
  revision: document.revision,
  timestamp: 1_700_000_000_100,
  data: { slug: document.slug, document },
  ...overrides,
})

const trainerRealtimeEvent = (
  sheet: TrainerSheet,
  overrides: Partial<RealtimeEvent> = {},
): RealtimeEvent => ({
  channel: sheetChannel('trainer', sheet.slug),
  type: 'updated',
  timestamp: 1_700_000_000_100,
  data: { kind: 'trainer', slug: sheet.slug, sheet },
  ...overrides,
})

const commandRecord = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected command body')
  return body as Record<string, unknown>
}

const commandPayload = (body: unknown): Record<string, unknown> => {
  const payload = commandRecord(body).payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Expected command payload')
  return payload as Record<string, unknown>
}

const acceptedResponseForBody = (
  body: unknown,
  documents: {
    readonly shop?: ShopTableDocument
    readonly trainer?: TrainerSheet
    readonly groupInventory?: GroupInventoryDocument
  } = {},
): ShopCheckoutCommandResult => {
  const command = commandRecord(body)
  const payload = commandPayload(body)
  const acceptedShop = documents.shop ?? makeShop({
    revision: 5,
    entries: [makeEntry({ stock: 4 })],
  })
  const acceptedTrainer = documents.trainer ?? trainerFixture({ revision: 3, money: 900 })

  return {
    ok: true,
    opId: String(command.opId),
    shopSlug: String(payload.shopSlug),
    previousShopRevision: Number(payload.shopRevision),
    shopRevision: acceptedShop.revision,
    totalPrice: 300,
    lines: [{
      entryId: 'potion',
      itemName: 'Potion',
      section: 'medicalKit',
      quantity: 1,
      unitPrice: 300,
      lineTotal: 300,
      stock: 4,
    }],
    documents: {
      shop: acceptedShop,
      ...(documents.groupInventory ? { groupInventories: [documents.groupInventory] } : {}),
      trainerSheets: [acceptedTrainer],
    },
  }
}

const createApiMocks = (options: {
  readonly trainerSheets?: readonly TrainerSheet[]
  readonly groupInventory?: GroupInventoryDocument
  readonly postJson?: PostJsonMock
} = {}): { readonly getJson: GetJsonMock; readonly postJson: PostJsonMock } => {
  const trainerSheets = options.trainerSheets ?? [trainerFixture()]
  const groupInventory = options.groupInventory ?? groupInventoryFixture()
  const getJson = vi.fn<GetJson>(async (request: string) => {
    if (request === SHEET_API_PATHS.list) return { trainerSheets }
    if (request === GROUP_INVENTORY_API_PATHS.load) return groupInventory
    throw new Error(`Unexpected GET ${request}`)
  })
  const postJson = options.postJson ?? vi.fn<PostJson>(async (_request, body) => acceptedResponseForBody(body))
  return { getJson, postJson }
}

const createHarness = (options: {
  readonly shop?: Ref<ShopTableDocument | null>
  readonly role?: Ref<AuthRole | null>
  readonly isGm?: Ref<boolean>
  readonly isPlayer?: Ref<boolean>
  readonly selectedProfileId?: Ref<PlayerProfileId | null>
  readonly trainerSheets?: readonly TrainerSheet[]
  readonly groupInventory?: GroupInventoryDocument
  readonly postJson?: PostJsonMock
  readonly subscribeRealtimeChannel?: (channel: string, handler: (event: RealtimeEvent) => void) => () => void
} = {}): {
  readonly shop: Ref<ShopTableDocument | null>
  readonly getJson: GetJsonMock
  readonly postJson: PostJsonMock
  readonly checkout: UseShopfrontCheckoutReturn
} => {
  leaseOwnerSequence += 1
  const shop = options.shop ?? ref<ShopTableDocument | null>(makeShop())
  const role = options.role ?? ref<AuthRole | null>('player')
  const isGm = options.isGm ?? ref(false)
  const isPlayer = options.isPlayer ?? ref(true)
  const selectedProfileId = options.selectedProfileId ?? ref<PlayerProfileId | null>(profileId)
  const { getJson, postJson } = createApiMocks(options)
  const checkout = useShopfrontCheckout({
    shop,
    authRole: role,
    isGm,
    isPlayer,
    selectedProfileId,
    apiClient: {
      getJson: getJson as unknown as ApiClient['getJson'],
      postJson: postJson as unknown as ApiClient['postJson'],
    },
    outbox: createTestOutbox(),
    leaseOwner: `shopfront-checkout-test-${leaseOwnerSequence}`,
    clientId: () => 'client-shopfront-checkout-test',
    randomUuid: () => `checkout-${leaseOwnerSequence}`,
    ...(options.subscribeRealtimeChannel === undefined ? {} : { subscribeRealtimeChannel: options.subscribeRealtimeChannel }),
    autoLoadOnMounted: false,
  })
  return { shop, getJson, postJson, checkout }
}

describe('useShopfrontCheckout', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('lets a player buy into a linked trainer inventory with trainer money', async () => {
    const { shop, postJson, checkout } = createHarness()

    await checkout.loadCheckoutDocuments()
    checkout.setCartQuantity('potion', 1)

    expect(checkout.paymentOptions.value).toEqual([expect.objectContaining({ kind: 'trainer', slug: 'ash' })])
    expect(checkout.deliveryOptions.value).toEqual([expect.objectContaining({ kind: 'trainer', slug: 'ash' })])
    expect(checkout.canCheckout.value).toBe(true)

    const result = await checkout.submitCheckout()

    expect(result).toMatchObject({ dispatched: true })
    expect(postJson).toHaveBeenCalledTimes(1)
    expect(postJson).toHaveBeenCalledWith(SHOP_API_PATHS.checkout, expect.objectContaining({
      opId: expect.stringMatching(/^op_/),
      type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
      clientId: 'client-shopfront-checkout-test',
      profileId,
      payload: expect.objectContaining({
        shopSlug: 'viridian-mart',
        shopRevision: 4,
        paymentSource: { kind: 'trainer', slug: 'ash', revision: 2 },
        deliveryTarget: { kind: 'trainer', slug: 'ash', revision: 2 },
        lines: [{ entryId: 'potion', quantity: 1 }],
      }),
    }))
    expect(checkout.checkoutStatus.value).toBe('accepted')
    expect(checkout.checkoutErrorMessage.value).toBeNull()
    expect(shop.value?.revision).toBe(5)
    expect(shop.value?.entries[0]?.stock).toBe(4)
    expect(checkout.cartLines.value).toEqual([])
  })

  it('lets a GM buy with any trainer sheet exposed by trainer-enabled shop config', async () => {
    const { postJson, checkout } = createHarness({
      role: ref<AuthRole | null>('gm'),
      isGm: ref(true),
      isPlayer: ref(false),
      selectedProfileId: ref<PlayerProfileId | null>(null),
      trainerSheets: [
        trainerFixture({ slug: 'ash', name: 'Ash', playerProfileAccessible: false }),
        trainerFixture({ slug: 'gary', name: 'Gary', playerProfileAccessible: false }),
      ],
    })

    await checkout.loadCheckoutDocuments()

    expect(checkout.paymentOptions.value.map((option) => option.slug)).toEqual(['ash', 'gary'])
    expect(checkout.deliveryOptions.value.map((option) => option.slug)).toEqual(['ash', 'gary'])

    checkout.setCartQuantity('potion', 1)
    checkout.selectPaymentOption('trainer:gary')
    checkout.selectDeliveryOption('trainer:gary')

    await expect(checkout.submitCheckout()).resolves.toMatchObject({ dispatched: true })
    expect(postJson).toHaveBeenCalledWith(SHOP_API_PATHS.checkout, expect.objectContaining({
      payload: expect.objectContaining({
        paymentSource: { kind: 'trainer', slug: 'gary', revision: 2 },
        deliveryTarget: { kind: 'trainer', slug: 'gary', revision: 2 },
      }),
    }))
  })

  it('filters player trainer options to profile-linked sheets and rejects forced unlinked trainer selection', async () => {
    const { postJson, checkout } = createHarness({
      trainerSheets: [
        trainerFixture({ slug: 'ash', name: 'Ash', playerProfileAccessible: true }),
        trainerFixture({ slug: 'gary', name: 'Gary', playerProfileAccessible: false }),
      ],
    })

    await checkout.loadCheckoutDocuments()

    expect(checkout.paymentOptions.value.map((option) => option.slug)).toEqual(['ash'])
    expect(checkout.deliveryOptions.value.map((option) => option.slug)).toEqual(['ash'])

    checkout.setCartQuantity('potion', 1)
    checkout.selectPaymentOption('trainer:gary')
    const result = await checkout.submitCheckout()

    expect(result).toEqual({ dispatched: false, message: 'Choose an eligible payment source.' })
    expect(checkout.checkoutStatus.value).toBe('error')
    expect(checkout.checkoutErrorMessage.value).toBe('Choose an eligible payment source.')
    expect(postJson).not.toHaveBeenCalled()
  })

  it('shows group payment and delivery options only when the shop allows group inventory', async () => {
    const { getJson, checkout } = createHarness({
      shop: ref(makeShop({
        allowedPaymentSources: ['trainer'],
        allowedDeliveryTargets: ['trainer'],
      })),
    })

    await checkout.loadCheckoutDocuments()

    expect(checkout.paymentOptions.value.some((option) => option.kind === 'groupInventory')).toBe(false)
    expect(checkout.deliveryOptions.value.some((option) => option.kind === 'groupInventory')).toBe(false)
    expect(getJson).not.toHaveBeenCalledWith(GROUP_INVENTORY_API_PATHS.load, expect.anything())

    const groupEnabledShop = ref(makeShop({
      allowedPaymentSources: ['trainer', 'groupInventory'],
      allowedDeliveryTargets: ['trainer', 'groupInventory'],
    }))
    const groupHarness = createHarness({ shop: groupEnabledShop })

    await groupHarness.checkout.loadCheckoutDocuments()

    expect(groupHarness.checkout.paymentOptions.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG }),
    ]))
    expect(groupHarness.checkout.deliveryOptions.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG }),
    ]))
  })

  it('subscribes to loaded group and trainer realtime channels and adopts newer group inventory updates', async () => {
    const subscriptions = new Map<string, (event: RealtimeEvent) => void>()
    const subscribeRealtimeChannel = vi.fn((channel: string, handler: (event: RealtimeEvent) => void) => {
      subscriptions.set(channel, handler)
      return () => subscriptions.delete(channel)
    })
    const { checkout } = createHarness({
      shop: ref(makeShop({
        allowedPaymentSources: ['trainer', 'groupInventory'],
        allowedDeliveryTargets: ['trainer', 'groupInventory'],
      })),
      subscribeRealtimeChannel,
    })

    await checkout.loadCheckoutDocuments()

    expect(subscriptions.has(groupInventoryChannel(GROUP_INVENTORY_MAIN_SLUG))).toBe(true)
    expect(subscriptions.has(sheetChannel('trainer', 'ash'))).toBe(true)
    expect(checkout.paymentOptions.value.find((option) => option.kind === 'groupInventory')?.money).toBe(2_500)

    subscriptions.get(groupInventoryChannel(GROUP_INVENTORY_MAIN_SLUG))!(groupInventoryRealtimeEvent(
      groupInventoryFixture({ revision: 6, money: 9_999 }),
    ))
    expect(checkout.paymentOptions.value.find((option) => option.kind === 'groupInventory')?.money).toBe(2_500)

    subscriptions.get(groupInventoryChannel(GROUP_INVENTORY_MAIN_SLUG))!(groupInventoryRealtimeEvent(
      groupInventoryFixture({ revision: 8, money: 1_750 }),
      { clientId: 'other-client' },
    ))
    expect(checkout.paymentOptions.value.find((option) => option.kind === 'groupInventory')?.money).toBe(1_750)
  })

  it('adopts newer trainer sheet realtime updates for loaded checkout participants and ignores stale or echo events', async () => {
    const { checkout } = createHarness()

    await checkout.loadCheckoutDocuments()

    expect(checkout.paymentOptions.value.find((option) => option.slug === 'ash')?.money).toBe(1_200)

    expect(checkout.handleTrainerSheetRealtimeEvent(trainerRealtimeEvent(
      trainerFixture({ slug: 'ash', revision: 1, money: 9_999 }),
    ))).toEqual({ status: 'ignored-stale' })
    expect(checkout.paymentOptions.value.find((option) => option.slug === 'ash')?.money).toBe(1_200)

    expect(checkout.handleTrainerSheetRealtimeEvent(trainerRealtimeEvent(
      trainerFixture({ slug: 'ash', revision: 3, money: 850 }),
      { clientId: 'other-client' },
    ))).toMatchObject({ status: 'adopted' })
    expect(checkout.paymentOptions.value.find((option) => option.slug === 'ash')?.money).toBe(850)

    expect(checkout.handleTrainerSheetRealtimeEvent(trainerRealtimeEvent(
      trainerFixture({ slug: 'ash', revision: 4, money: 700 }),
      { clientId: 'client-shopfront-checkout-test' },
    ))).toEqual({ status: 'ignored-echo' })
    expect(checkout.paymentOptions.value.find((option) => option.slug === 'ash')?.money).toBe(850)
  })

  it('clamps cart quantities and shows a non-blocking notice when realtime shop stock drops', async () => {
    const shop = ref<ShopTableDocument | null>(makeShop({ entries: [makeEntry({ stock: 5 })] }))
    const { checkout } = createHarness({ shop })

    checkout.setCartQuantity('potion', 3)
    expect(checkout.cartQuantities.value.potion).toBe(3)

    shop.value = makeShop({ revision: 5, entries: [makeEntry({ stock: 2 })] })
    await nextTick()

    expect(checkout.cartQuantities.value.potion).toBe(2)
    expect(checkout.cartLines.value[0]?.quantity).toBe(2)
    expect(checkout.stockChangeNotice.value).toBe('Shop stock changed; adjusted Potion in your cart.')

    checkout.clearStockChangeNotice()
    expect(checkout.stockChangeNotice.value).toBeNull()
  })

  it('keeps double-clicked checkout submissions to one active command while the first send is in flight', async () => {
    const responseDeferred = deferred<ShopCheckoutCommandResult>()
    const postStarted = deferred<unknown>()
    const postJson = vi.fn<PostJson>(async (_request, body) => {
      postStarted.resolve(body)
      return responseDeferred.promise
    })
    const { checkout } = createHarness({ postJson })

    await checkout.loadCheckoutDocuments()
    checkout.setCartQuantity('potion', 1)

    const first = checkout.submitCheckout()
    const body = await postStarted.promise
    const second = await checkout.submitCheckout()

    expect(second).toEqual({ dispatched: false, message: 'A shop checkout command is already in flight.' })
    expect(postJson).toHaveBeenCalledTimes(1)

    responseDeferred.resolve(acceptedResponseForBody(body))
    await expect(first).resolves.toMatchObject({ dispatched: true })
  })
})
