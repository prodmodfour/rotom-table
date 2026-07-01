import { ref, type Ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'
import { LIVE_PLAY_COMMAND_TYPES, type ShopCheckoutCommandAccepted, type ShopCheckoutCommandResult } from '#shared/livePlayCommands'
import { LIVE_PLAY_REALTIME_EVENT_TYPES, shopChannel, type RealtimeEvent } from '#shared/realtime'
import type { AuthRole } from '#shared/auth'
import { GROUP_INVENTORY_MAIN_SLUG, createDefaultGroupInventoryDocument, type GroupInventoryDocument } from '~/types/groupInventory'
import type { ShopTableDocument } from '~/types/shop'
import type { TrainerSheet } from '~/types/trainerSheet'
import { useShopCheckoutCommands, type ShopCheckoutCommandInput } from '~/composables/shops/useShopCheckoutCommands'
import { SHOP_API_PATHS } from '~/utils/apiRoutes'
import {
  createLivePlayCommandOutbox,
  type LivePlayCommandOutbox,
} from '~/utils/livePlayCommandOutbox'

type PostJson = (request: string, body: unknown) => Promise<unknown>
type PostJsonMock = ReturnType<typeof vi.fn<PostJson>>

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
    databaseName: `use-shop-checkout-commands-${outboxSequence}`,
    indexedDBFactory: new FakeIDBFactory() as unknown as IDBFactory,
  })
}

const shopFixture = (overrides: Partial<ShopTableDocument> = {}): ShopTableDocument => ({
  slug: 'general-store',
  revision: 0,
  updatedAt: 1_000,
  name: 'General Store',
  playerVisible: true,
  open: true,
  allowedPaymentSources: ['trainer', 'groupInventory'],
  allowedDeliveryTargets: ['trainer', 'groupInventory'],
  entries: [{
    id: 'shop-entry-potion',
    itemName: 'Potion',
    section: 'medicalKit',
    price: 200,
    stock: 3,
    maxPerPurchase: 2,
    playerDescription: 'Restores HP.',
  }],
  ...overrides,
})

const groupInventoryFixture = (overrides: Partial<GroupInventoryDocument> = {}): GroupInventoryDocument => ({
  ...createDefaultGroupInventoryDocument({ now: 1_000 }),
  slug: GROUP_INVENTORY_MAIN_SLUG,
  revision: 1,
  updatedAt: 1_100,
  money: 800,
  ...overrides,
})

const trainerFixture = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 5,
  revision: 1,
  money: 1_000,
  inventory: {},
  ...overrides,
})

const checkoutInput = (overrides: Partial<ShopCheckoutCommandInput> = {}): ShopCheckoutCommandInput => ({
  paymentSource: { kind: 'groupInventory', slug: GROUP_INVENTORY_MAIN_SLUG, revision: 1 },
  deliveryTarget: { kind: 'trainer', slug: 'ash', revision: 1 },
  lines: [{ entryId: 'shop-entry-potion', quantity: 1 }],
  opId: 'op_checkoutbase01',
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
    readonly groupInventory?: GroupInventoryDocument
    readonly trainer?: TrainerSheet
  } = {},
): ShopCheckoutCommandResult => {
  const command = commandRecord(body)
  const payload = commandPayload(body)
  const shop = documents.shop ?? shopFixture({
    revision: 1,
    updatedAt: 2_000,
    entries: [{
      ...shopFixture().entries[0]!,
      stock: 2,
    }],
  })
  const groupInventory = documents.groupInventory ?? groupInventoryFixture({ revision: 2, money: 600 })
  const trainer = documents.trainer ?? trainerFixture({ revision: 2, money: 1_000 })

  return {
    ok: true,
    opId: String(command.opId),
    shopSlug: String(payload.shopSlug),
    previousShopRevision: Number(payload.shopRevision),
    shopRevision: shop.revision,
    totalPrice: 200,
    lines: [{
      entryId: 'shop-entry-potion',
      itemName: 'Potion',
      section: 'medicalKit',
      quantity: 1,
      unitPrice: 200,
      lineTotal: 200,
      stock: 2,
    }],
    documents: {
      shop,
      groupInventories: [groupInventory],
      trainerSheets: [trainer],
    },
  }
}

const rejectedResponseForBody = (
  body: unknown,
  overrides: Partial<Extract<ShopCheckoutCommandResult, { ok: false }>> = {},
): ShopCheckoutCommandResult => {
  const command = commandRecord(body)
  const payload = commandPayload(body)
  return {
    ok: false,
    opId: String(command.opId),
    shopSlug: String(payload.shopSlug),
    reason: 'conflict',
    message: 'Shop checkout was rejected.',
    currentShopRevision: Number(payload.shopRevision),
    ...overrides,
  }
}

const terminalRealtimeEvent = (
  response: ShopCheckoutCommandResult,
  overrides: Partial<RealtimeEvent> = {},
): RealtimeEvent => {
  const accepted = response.ok === true && !('duplicate' in response)
  const shopSlug = accepted
    ? response.shopSlug
    : response.ok === false
      ? response.shopSlug ?? 'general-store'
      : response.original.ok
        ? response.original.shopSlug
        : response.original.shopSlug ?? 'general-store'
  return {
    channel: shopChannel(shopSlug),
    type: accepted ? LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED : LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_REJECTED,
    opId: response.opId,
    timestamp: 1_700_000_000_000,
    data: {
      commandType: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
      shopSlug,
      result: response,
    },
    ...(accepted ? { revision: (response as ShopCheckoutCommandAccepted).shopRevision, previousRevision: (response as ShopCheckoutCommandAccepted).previousShopRevision } : {}),
    ...overrides,
  }
}

const createHarness = (options: {
  readonly postJson?: PostJsonMock
  readonly shop?: Ref<ShopTableDocument | null>
  readonly authRole?: Ref<AuthRole | null>
  readonly outbox?: LivePlayCommandOutbox
  readonly onCheckoutRealtimeReconciliationRequired?: Parameters<typeof useShopCheckoutCommands>[0]['onCheckoutRealtimeReconciliationRequired']
} = {}) => {
  leaseOwnerSequence += 1
  const postJson = options.postJson ?? vi.fn<PostJson>()
  const shop = options.shop ?? ref<ShopTableDocument | null>(shopFixture())
  const adoptedGroupInventories = ref<GroupInventoryDocument[]>([])
  const adoptedTrainerSheets = ref<TrainerSheet[]>([])
  const actions = useShopCheckoutCommands({
    authRole: options.authRole ?? ref<AuthRole>('gm'),
    shop,
    apiClient: { postJson },
    outbox: options.outbox ?? createTestOutbox(),
    leaseOwner: `shop-checkout-test-${leaseOwnerSequence}`,
    clientId: () => 'client-shop-checkout-test',
    adoptShop: (nextShop) => {
      shop.value = nextShop
    },
    adoptGroupInventory: (document) => {
      adoptedGroupInventories.value = [
        ...adoptedGroupInventories.value.filter((existing) => existing.slug !== document.slug),
        document,
      ]
    },
    adoptTrainerSheet: (sheet) => {
      adoptedTrainerSheets.value = [
        ...adoptedTrainerSheets.value.filter((existing) => existing.slug !== sheet.slug),
        sheet,
      ]
    },
    ...(options.onCheckoutRealtimeReconciliationRequired === undefined
      ? {}
      : { onCheckoutRealtimeReconciliationRequired: options.onCheckoutRealtimeReconciliationRequired }),
  })
  return { actions, postJson, shop, adoptedGroupInventories, adoptedTrainerSheets }
}

describe('useShopCheckoutCommands', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('sends checkout through the durable outbox and adopts authoritative shop, group, and trainer updates only after acceptance', async () => {
    const responseDeferred = deferred<ShopCheckoutCommandResult>()
    const postStarted = deferred<unknown>()
    const postJson = vi.fn<PostJson>(async (_request, body) => {
      postStarted.resolve(body)
      return responseDeferred.promise
    })
    const { actions, shop, adoptedGroupInventories, adoptedTrainerSheets } = createHarness({ postJson })
    const initialShop = shop.value

    const checkoutPromise = actions.checkout(checkoutInput({ opId: 'op_success0001' }))
    const body = await postStarted.promise

    expect(postJson).toHaveBeenCalledTimes(1)
    expect(postJson).toHaveBeenCalledWith(SHOP_API_PATHS.checkout, expect.objectContaining({
      opId: 'op_success0001',
      type: LIVE_PLAY_COMMAND_TYPES.SHOP_CHECKOUT,
      clientId: 'client-shop-checkout-test',
    }))
    expect(shop.value).toEqual(initialShop)
    expect(adoptedGroupInventories.value).toEqual([])
    expect(adoptedTrainerSheets.value).toEqual([])

    responseDeferred.resolve(acceptedResponseForBody(body))
    const result = await checkoutPromise

    expect(result).toMatchObject({ dispatched: true, opId: 'op_success0001' })
    expect(actions.status.value).toBe('accepted')
    expect(actions.lastError.value).toBeNull()
    expect(shop.value?.revision).toBe(1)
    expect(shop.value?.entries[0]?.stock).toBe(2)
    expect(adoptedGroupInventories.value).toEqual([expect.objectContaining({ slug: GROUP_INVENTORY_MAIN_SLUG, revision: 2, money: 600 })])
    expect(adoptedTrainerSheets.value).toEqual([expect.objectContaining({ slug: 'ash', revision: 2 })])
    expect(actions.pendingOutboxEntries.value).toEqual([])
  })

  it('recovers an accepted checkout when realtime arrives before the HTTP response', async () => {
    const responseDeferred = deferred<ShopCheckoutCommandResult>()
    const postStarted = deferred<unknown>()
    const postJson = vi.fn<PostJson>(async (_request, body) => {
      postStarted.resolve(body)
      return responseDeferred.promise
    })
    const outbox = createTestOutbox()
    const { actions, shop, adoptedGroupInventories, adoptedTrainerSheets } = createHarness({ postJson, outbox })

    const checkoutPromise = actions.checkout(checkoutInput({ opId: 'op_realtime001' }))
    const body = await postStarted.promise
    const realtimeResponse = acceptedResponseForBody(body)

    await expect(actions.acknowledgeTerminalRealtimeEvent(terminalRealtimeEvent(realtimeResponse)))
      .resolves.toMatchObject({ status: 'acknowledged', opId: 'op_realtime001' })

    expect(actions.status.value).toBe('accepted')
    expect(shop.value?.revision).toBe(1)
    expect(shop.value?.entries[0]?.stock).toBe(2)
    expect(adoptedGroupInventories.value).toEqual([expect.objectContaining({ revision: 2, money: 600 })])
    expect(adoptedTrainerSheets.value).toEqual([expect.objectContaining({ slug: 'ash', revision: 2 })])
    await expect(outbox.get('op_realtime001')).resolves.toBeNull()
    expect(actions.pendingOutboxEntries.value).toEqual([])

    responseDeferred.resolve(acceptedResponseForBody(body, {
      shop: shopFixture({ revision: 99, entries: [{ ...shopFixture().entries[0]!, stock: 0 }] }),
    }))
    await expect(checkoutPromise).resolves.toMatchObject({
      dispatched: true,
      opId: 'op_realtime001',
      recoveredByRealtime: true,
    })
    expect(shop.value?.revision).toBe(1)
    expect(postJson).toHaveBeenCalledTimes(1)
  })

  it('acknowledges realtime rejected checkout results and removes the outbox entry', async () => {
    const responseDeferred = deferred<ShopCheckoutCommandResult>()
    const postStarted = deferred<unknown>()
    const postJson = vi.fn<PostJson>(async (_request, body) => {
      postStarted.resolve(body)
      return responseDeferred.promise
    })
    const outbox = createTestOutbox()
    const { actions, shop, adoptedGroupInventories, adoptedTrainerSheets } = createHarness({ postJson, outbox })
    const initialShop = shop.value

    const checkoutPromise = actions.checkout(checkoutInput({ opId: 'op_rtrejected1' }))
    const body = await postStarted.promise
    const realtimeResponse = rejectedResponseForBody(body, { reason: 'stale-revision', message: 'Refresh the shop first.' })

    await expect(actions.acknowledgeTerminalRealtimeEvent(terminalRealtimeEvent(realtimeResponse)))
      .resolves.toMatchObject({ status: 'acknowledged', opId: 'op_rtrejected1', message: 'Refresh the shop first.' })

    expect(actions.status.value).toBe('stale')
    expect(actions.lastError.value).toBe('Refresh the shop first.')
    expect(shop.value).toEqual(initialShop)
    expect(adoptedGroupInventories.value).toEqual([])
    expect(adoptedTrainerSheets.value).toEqual([])
    await expect(outbox.get('op_rtrejected1')).resolves.toBeNull()

    responseDeferred.resolve(realtimeResponse)
    await expect(checkoutPromise).resolves.toMatchObject({
      dispatched: false,
      opId: 'op_rtrejected1',
      recoveredByRealtime: true,
      response: expect.objectContaining({ ok: false, reason: 'stale-revision' }),
    })
  })

  it('requests realtime reconciliation instead of applying an accepted result over stale local shop state', async () => {
    const responseDeferred = deferred<ShopCheckoutCommandResult>()
    const postStarted = deferred<unknown>()
    const postJson = vi.fn<PostJson>(async (_request, body) => {
      postStarted.resolve(body)
      return responseDeferred.promise
    })
    const shop = ref<ShopTableDocument | null>(shopFixture({ revision: 0 }))
    const reconcile = vi.fn(async () => undefined)
    const { actions } = createHarness({ postJson, shop, onCheckoutRealtimeReconciliationRequired: reconcile })

    const checkoutPromise = actions.checkout(checkoutInput({ opId: 'op_rtstale001' }))
    const body = await postStarted.promise
    shop.value = shopFixture({ revision: 7, entries: [{ ...shopFixture().entries[0]!, stock: 1 }] })
    const realtimeResponse = acceptedResponseForBody(body, {
      shop: shopFixture({ revision: 1, entries: [{ ...shopFixture().entries[0]!, stock: 2 }] }),
    })

    await expect(actions.acknowledgeTerminalRealtimeEvent(terminalRealtimeEvent(realtimeResponse)))
      .resolves.toMatchObject({ status: 'acknowledged', opId: 'op_rtstale001', message: expect.stringContaining('Reloading authoritative checkout state') })

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({
      response: expect.objectContaining({ opId: 'op_rtstale001' }),
      message: expect.stringContaining('local shop state is revision 7'),
    }))
    expect(shop.value?.revision).toBe(7)
    expect(shop.value?.entries[0]?.stock).toBe(1)

    responseDeferred.resolve(realtimeResponse)
    await expect(checkoutPromise).resolves.toMatchObject({ recoveredByRealtime: true })
    expect(shop.value?.revision).toBe(7)
  })

  it('removes terminal rejected checkout commands from the outbox without adopting documents', async () => {
    let capturedBody: unknown
    const postJson = vi.fn<PostJson>(async (_request, body) => {
      capturedBody = body
      return rejectedResponseForBody(body, { reason: 'conflict', message: 'Not enough money.' })
    })
    const { actions, shop, adoptedGroupInventories, adoptedTrainerSheets } = createHarness({ postJson })
    const initialShop = shop.value

    const result = await actions.checkout(checkoutInput({ opId: 'op_rejected001' }))

    expect(capturedBody).toBeTruthy()
    expect(result).toMatchObject({
      dispatched: false,
      opId: 'op_rejected001',
      message: 'Not enough money.',
      response: expect.objectContaining({ ok: false, reason: 'conflict' }),
    })
    expect(actions.status.value).toBe('rejected')
    expect(actions.lastError.value).toBe('Not enough money.')
    expect(shop.value).toEqual(initialShop)
    expect(adoptedGroupInventories.value).toEqual([])
    expect(adoptedTrainerSheets.value).toEqual([])
    expect(actions.pendingOutboxEntries.value).toEqual([])
  })

  it('surfaces stale checkout rejections distinctly without mutating local state', async () => {
    const postJson = vi.fn<PostJson>(async (_request, body) => (
      rejectedResponseForBody(body, {
        reason: 'stale-revision',
        message: 'Shop general-store is at revision 4; refresh before checking out.',
        currentShopRevision: 4,
      })
    ))
    const { actions, shop } = createHarness({ postJson })
    const initialShop = shop.value

    const result = await actions.checkout(checkoutInput({ opId: 'op_stale00001' }))

    expect(result.dispatched).toBe(false)
    expect(result.response).toMatchObject({ ok: false, reason: 'stale-revision', currentShopRevision: 4 })
    expect(actions.status.value).toBe('stale')
    expect(actions.lastError.value).toContain('revision 4')
    expect(shop.value).toEqual(initialShop)
    expect(actions.pendingOutboxEntries.value).toEqual([])
  })

  it('guards against duplicate clicks while a checkout command is in flight', async () => {
    const responseDeferred = deferred<ShopCheckoutCommandResult>()
    const postStarted = deferred<unknown>()
    const postJson = vi.fn<PostJson>(async (_request, body) => {
      postStarted.resolve(body)
      return responseDeferred.promise
    })
    const { actions } = createHarness({ postJson })

    const first = actions.checkout(checkoutInput({ opId: 'op_double0001' }))
    const second = await actions.checkout(checkoutInput({ opId: 'op_double0002' }))

    expect(second).toEqual({ dispatched: false, message: 'A shop checkout command is already in flight.' })

    const firstBody = await postStarted.promise
    expect(postJson).toHaveBeenCalledTimes(1)
    responseDeferred.resolve(acceptedResponseForBody(firstBody))
    await expect(first).resolves.toMatchObject({ dispatched: true, opId: 'op_double0001' })
  })

  it('marks uncertain HTTP outcomes for safe durable retry without optimistic mutation', async () => {
    const postJson = vi.fn<PostJson>(async () => {
      throw new Error('network down')
    })
    const shop = ref<ShopTableDocument | null>(shopFixture())
    const outbox = createTestOutbox()
    const { actions } = createHarness({ postJson, shop, outbox })
    const initialShop = shop.value

    const result = await actions.checkout(checkoutInput({ opId: 'op_uncertain01' }))

    expect(result).toMatchObject({ dispatched: false, opId: 'op_uncertain01', uncertain: true })
    expect(result.message).toContain('unknown')
    expect(actions.status.value).toBe('uncertain')
    expect(actions.lastError.value).toContain('network down')
    expect(shop.value).toEqual(initialShop)
    await expect(outbox.get('op_uncertain01')).resolves.toMatchObject({ state: 'uncertain', opId: 'op_uncertain01' })
    expect(actions.pendingOutboxEntries.value).toHaveLength(1)
  })

  it('retries an uncertain checkout with the same operation ID and acknowledges the terminal response', async () => {
    const postJson = vi.fn<PostJson>()
    postJson.mockRejectedValueOnce(new Error('socket closed'))
    postJson.mockImplementationOnce(async (_request, body) => acceptedResponseForBody(body, {
      shop: shopFixture({ revision: 2, entries: [{ ...shopFixture().entries[0]!, stock: 1 }] }),
      groupInventory: groupInventoryFixture({ revision: 3, money: 400 }),
      trainer: trainerFixture({ revision: 3 }),
    }))
    const outbox = createTestOutbox()
    const { actions, shop, adoptedGroupInventories, adoptedTrainerSheets } = createHarness({ postJson, outbox })

    const uncertain = await actions.checkout(checkoutInput({ opId: 'op_retry00001' }))
    expect(uncertain.uncertain).toBe(true)
    expect(actions.pendingOutboxEntries.value).toHaveLength(1)

    const retry = await actions.retryOutboxEntry('op_retry00001')

    expect(retry).toMatchObject({ dispatched: true, opId: 'op_retry00001' })
    expect(postJson).toHaveBeenCalledTimes(2)
    expect(actions.status.value).toBe('accepted')
    expect(actions.outboxStatus.value).toBe('idle')
    expect(shop.value?.revision).toBe(2)
    expect(shop.value?.entries[0]?.stock).toBe(1)
    expect(adoptedGroupInventories.value).toEqual([expect.objectContaining({ revision: 3, money: 400 })])
    expect(adoptedTrainerSheets.value).toEqual([expect.objectContaining({ slug: 'ash', revision: 3 })])
    await expect(outbox.get('op_retry00001')).resolves.toBeNull()
    expect(actions.pendingOutboxEntries.value).toEqual([])
  })
})
