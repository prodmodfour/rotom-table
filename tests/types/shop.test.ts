import { describe, expect, it } from 'vitest'
import {
  SHOP_DEFAULT_DELIVERY_TARGETS,
  SHOP_DEFAULT_NAME,
  SHOP_DEFAULT_PAYMENT_SOURCES,
  SHOP_DEFAULT_SLUG,
  SHOP_MAX_SAFE_INTEGER,
  SHOP_PURCHASE_LOG_LIMIT,
  SHOP_TABLE_ROW_ID_PREFIX,
  appendShopPurchaseAuditEntry,
  normalizeShopTableDocument,
} from '~/types/shop'

describe('shop document normalization', () => {
  it('normalizes empty input into a closed, hidden trainer-only shop document', () => {
    const document = normalizeShopTableDocument(undefined, { now: 1234 })

    expect(document).toEqual({
      slug: SHOP_DEFAULT_SLUG,
      revision: 0,
      updatedAt: 1234,
      name: SHOP_DEFAULT_NAME,
      playerVisible: false,
      open: false,
      allowedPaymentSources: [...SHOP_DEFAULT_PAYMENT_SOURCES],
      allowedDeliveryTargets: [...SHOP_DEFAULT_DELIVERY_TARGETS],
      entries: [],
    })
  })

  it('normalizes partial legacy input while trimming text and inventory sections', () => {
    const document = normalizeShopTableDocument(
      {
        slug: 'viridian-mart',
        revision: 7,
        updatedAt: 999,
        name: '  Viridian Mart  ',
        folder: '  Kanto / Route 2  ',
        description: '  Essentials for early routes.  ',
        playerVisible: 'true',
        open: 1,
        allowedPaymentSources: ['groupInventory', 'trainer', 'unknown-source', 'trainer'],
        allowedDeliveryTargets: 'groupInventory',
        gmNotes: '  Restock after each gym badge.  ',
        entries: [
          {
            id: ' potion-row ',
            itemName: '  Potion  ',
            section: 'Medical Kit',
            price: '300.75',
            stock: '10.9',
            maxPerPurchase: '3.2',
            playerDescription: '  Heals 20 HP.  ',
            gmNotes: '  Discounted for locals.  ',
            tags: [' healing ', '', 'consumable', 'healing'],
            clientOnlyExpanded: true,
          },
          {
            name: '  Mystery Box  ',
            section: 'not-a-real-section',
            price: 'not a number',
            stock: 'unlimited',
            description: '  Contents unknown.  ',
          },
          '  Escape Rope  ',
        ],
      },
      {
        generateRowId: ({ index }) => `generated-${index}`,
      },
    )

    expect(document).toEqual({
      slug: 'viridian-mart',
      revision: 7,
      updatedAt: 999,
      name: 'Viridian Mart',
      folder: 'Kanto / Route 2',
      description: 'Essentials for early routes.',
      playerVisible: true,
      open: true,
      allowedPaymentSources: ['groupInventory', 'trainer'],
      allowedDeliveryTargets: ['groupInventory'],
      gmNotes: 'Restock after each gym badge.',
      entries: [
        {
          id: 'potion-row',
          itemName: 'Potion',
          section: 'medicalKit',
          price: 300,
          stock: 10,
          maxPerPurchase: 3,
          playerDescription: 'Heals 20 HP.',
          gmNotes: 'Discounted for locals.',
          tags: ['healing', 'consumable'],
        },
        {
          id: 'generated-1',
          itemName: 'Mystery Box',
          section: 'keyItems',
          price: 0,
          stock: null,
          playerDescription: 'Contents unknown.',
        },
        {
          id: 'generated-2',
          itemName: 'Escape Rope',
          section: 'keyItems',
          price: 0,
          stock: null,
        },
      ],
    })
  })

  it('coerces invalid prices to safe non-negative integers', () => {
    const document = normalizeShopTableDocument({
      entries: [
        { itemName: 'Negative', price: -5 },
        { itemName: 'Decimal', price: '12.9' },
        { itemName: 'Huge', price: Number.MAX_SAFE_INTEGER + 1000 },
        { itemName: 'NaN', price: Number.NaN },
      ],
    })

    expect(document.entries.map((entry) => entry.price)).toEqual([
      0,
      12,
      SHOP_MAX_SAFE_INTEGER,
      0,
    ])
  })

  it('coerces finite stock to safe non-negative integers', () => {
    const document = normalizeShopTableDocument({
      entries: [
        { itemName: 'Negative Stock', stock: -3 },
        { itemName: 'Decimal Stock', stock: '4.9' },
        { itemName: 'Huge Stock', stock: Number.MAX_SAFE_INTEGER + 1000 },
      ],
    })

    expect(document.entries.map((entry) => entry.stock)).toEqual([
      0,
      4,
      SHOP_MAX_SAFE_INTEGER,
    ])
  })

  it('preserves null and empty stock values as unlimited stock', () => {
    const document = normalizeShopTableDocument({
      entries: [
        { itemName: 'Explicit Unlimited', stock: null },
        { itemName: 'Missing Stock' },
        { itemName: 'Blank Stock', stock: '   ' },
      ],
    })

    expect(document.entries.map((entry) => entry.stock)).toEqual([null, null, null])
  })

  it('allocates unique stable row IDs when rows are missing IDs or contain duplicates', () => {
    const document = normalizeShopTableDocument(
      {
        entries: [
          { id: 'existing-row', itemName: 'Town Map' },
          { id: 'existing-row', itemName: 'Duplicate Town Map' },
          { itemName: 'Lift Key' },
        ],
      },
      {
        generateRowId: ({ index }) => `generated-${index}`,
      },
    )

    expect(document.entries.map((entry) => entry.id)).toEqual([
      'existing-row',
      'generated-1',
      'generated-2',
    ])

    const renormalized = normalizeShopTableDocument(document, {
      generateRowId: () => 'should-not-be-used',
    })

    expect(renormalized.entries.map((entry) => entry.id)).toEqual([
      'existing-row',
      'generated-1',
      'generated-2',
    ])
  })

  it('normalizes and bounds recent purchase audit logs', () => {
    const rawPurchaseLog = Array.from({ length: SHOP_PURCHASE_LOG_LIMIT + 2 }, (_, index) => ({
      opId: `  op_checkout_${index}  `,
      purchasedAt: String(1_700_000_000_000 + index),
      actor: {
        role: index % 2 === 0 ? 'player' : 'gm',
        profileId: '  profile_ash00000  ',
        profileName: '  Ash  ',
      },
      paymentSource: { kind: 'trainer', slug: '  ash  ' },
      deliveryTarget: { kind: 'groupInventory', slug: '  main  ' },
      totalPrice: '400.9',
      lines: [
        {
          entryId: '  potion-row  ',
          itemName: '  Potion  ',
          section: 'Medical Kit',
          quantity: '2.9',
          unitPrice: '200.5',
        },
        { entryId: '', itemName: 'Invalid', quantity: 1, unitPrice: 1 },
      ],
    }))

    const document = normalizeShopTableDocument({ purchaseLog: rawPurchaseLog })

    expect(document.purchaseLog).toHaveLength(SHOP_PURCHASE_LOG_LIMIT)
    expect(document.purchaseLog?.[0]).toEqual({
      opId: 'op_checkout_0',
      purchasedAt: 1_700_000_000_000,
      actor: {
        role: 'player',
        profileId: 'profile_ash00000',
        profileName: 'Ash',
      },
      paymentSource: { kind: 'trainer', slug: 'ash' },
      deliveryTarget: { kind: 'groupInventory', slug: 'main' },
      lines: [
        {
          entryId: 'potion-row',
          itemName: 'Potion',
          section: 'medicalKit',
          quantity: 2,
          unitPrice: 200,
          lineTotal: 400,
        },
      ],
      total: 400,
    })
  })

  it('prepends purchase audit entries while keeping the log bounded', () => {
    const existingLog = Array.from({ length: SHOP_PURCHASE_LOG_LIMIT }, (_, index) => ({
      opId: `op_existing_${index}`,
      purchasedAt: 1_700_000_000_000 + index,
      actor: { role: 'gm' as const },
      paymentSource: { kind: 'trainer' as const, slug: 'ash' },
      deliveryTarget: { kind: 'trainer' as const, slug: 'ash' },
      lines: [{ entryId: 'potion-row', itemName: 'Potion', section: 'medicalKit' as const, quantity: 1, unitPrice: 200, lineTotal: 200 }],
      total: 200,
    }))
    const shop = normalizeShopTableDocument({ purchaseLog: existingLog })
    const updated = appendShopPurchaseAuditEntry(shop, {
      opId: 'op_newest',
      purchasedAt: 1_800_000_000_000,
      actor: { role: 'player', profileId: 'profile_ash00000', profileName: 'Ash' },
      paymentSource: { kind: 'trainer', slug: 'ash' },
      deliveryTarget: { kind: 'trainer', slug: 'ash' },
      lines: [{ entryId: 'antidote-row', itemName: 'Antidote', section: 'medicalKit', quantity: 1, unitPrice: 150, lineTotal: 150 }],
      total: 150,
    })

    expect(updated.purchaseLog).toHaveLength(SHOP_PURCHASE_LOG_LIMIT)
    expect(updated.purchaseLog?.[0]?.opId).toBe('op_newest')
    expect(updated.purchaseLog?.at(-1)?.opId).toBe(`op_existing_${SHOP_PURCHASE_LOG_LIMIT - 2}`)
  })

  it('defaults invalid or absent payment and delivery source lists to trainer-only', () => {
    const defaulted = normalizeShopTableDocument({
      allowedPaymentSources: ['unknown-source'],
      allowedDeliveryTargets: [],
    })
    const absent = normalizeShopTableDocument({})
    const fallbackIds = normalizeShopTableDocument({
      entries: [
        { itemName: 'No generated collision' },
        { itemName: 'Another generated row' },
      ],
    })

    expect(defaulted.allowedPaymentSources).toEqual(['trainer'])
    expect(defaulted.allowedDeliveryTargets).toEqual(['trainer'])
    expect(absent.allowedPaymentSources).toEqual(['trainer'])
    expect(absent.allowedDeliveryTargets).toEqual(['trainer'])
    expect(fallbackIds.entries.map((entry) => entry.id)).toEqual([
      `${SHOP_TABLE_ROW_ID_PREFIX}-1`,
      `${SHOP_TABLE_ROW_ID_PREFIX}-2`,
    ])
  })
})
