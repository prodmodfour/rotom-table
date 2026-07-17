import { describe, expect, it } from 'vitest'
import {
  MAP_GROUND_ITEM_LIMITS,
  MapGroundItemValidationError,
  parseMapGroundItem,
  parseMapGroundItems,
} from '#shared/moveAutomation/groundItems'

const groundItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'ground-item-iron-ball-1',
  canonicalItemId: 'iron-ball',
  canonicalItemName: 'Iron Ball',
  quantity: 2,
  position: { x: 3, y: 1, z: 4 },
  sourceResource: {
    kind: 'sheet',
    sheetKind: 'pokemon',
    slug: 'partner-pikachu',
    revision: 7,
  },
  sourceOperationId: 'op_drop_item_0001',
  sideId: 'heroes',
  ownerPlacementId: 'token-pikachu',
  ...overrides,
})

const expectGroundItemError = (
  run: () => unknown,
  code: MapGroundItemValidationError['code'],
  path?: string,
): void => {
  try {
    run()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MapGroundItemValidationError)
    expect(error).toMatchObject({ code, ...(path ? { path } : {}) })
  }
}

describe('map-ground item state', () => {
  it('strictly parses durable item identity, position, provenance, and optional hints', () => {
    const source = groundItem()
    const parsed = parseMapGroundItem(source)

    expect(parsed).toEqual(source)
    expect(structuredClone(parsed)).toEqual(parsed)
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed)
    expect(parsed).not.toBe(source)
    expect(parsed.position).not.toBe(source.position)
    expect(parsed.sourceResource).not.toBe(source.sourceResource)

    ;(source.position as { x: number }).x = 99
    ;(source.sourceResource as { revision: number }).revision = 99
    expect(parsed.position).toEqual({ x: 3, y: 1, z: 4 })
    expect(parsed.sourceResource.revision).toBe(7)

    expect(parseMapGroundItem(groundItem({ sideId: null, ownerPlacementId: null })))
      .toMatchObject({ sideId: null, ownerPlacementId: null })
  })

  it('accepts every authoritative source resource family without treating hints as owners', () => {
    const sources = [
      { kind: 'sheet', sheetKind: 'trainer', slug: 'ace-trainer', revision: 2 },
      { kind: 'group-inventory', slug: 'main', revision: 3 },
      { kind: 'map', slug: 'route-one', revision: 4 },
    ]

    expect(sources.map(sourceResource => parseMapGroundItem(groundItem({
      sourceResource,
      sideId: null,
      ownerPlacementId: null,
    })).sourceResource)).toEqual(sources)
  })

  it('rejects unknown payload, display-name-only identity, malformed positions, and invalid provenance', () => {
    expectGroundItemError(
      () => parseMapGroundItem({ ...groundItem(), script: 'apply item' }),
      'invalid-ground-item',
      'mapGroundItem',
    )

    const missingCanonicalId = groundItem() as Record<string, unknown>
    delete missingCanonicalId.canonicalItemId
    expectGroundItemError(
      () => parseMapGroundItem(missingCanonicalId),
      'invalid-ground-item',
      'mapGroundItem',
    )

    expectGroundItemError(
      () => parseMapGroundItem(groundItem({ id: 'Iron Ball' })),
      'invalid-ground-item',
      'mapGroundItem.id',
    )
    expectGroundItemError(
      () => parseMapGroundItem(groundItem({ canonicalItemId: 'Iron Ball' })),
      'invalid-ground-item',
      'mapGroundItem.canonicalItemId',
    )
    expectGroundItemError(
      () => parseMapGroundItem(groundItem({ canonicalItemName: ' Iron Ball ' })),
      'invalid-ground-item',
      'mapGroundItem.canonicalItemName',
    )
    expectGroundItemError(
      () => parseMapGroundItem(groundItem({ position: { x: 1.5, y: 0, z: 1 } })),
      'invalid-ground-item',
      'mapGroundItem.position.x',
    )
    expectGroundItemError(
      () => parseMapGroundItem(groundItem({ sourceOperationId: 'client-operation' })),
      'invalid-ground-item',
      'mapGroundItem.sourceOperationId',
    )
    expectGroundItemError(
      () => parseMapGroundItem(groundItem({
        sourceResource: { kind: 'sheet', sheetKind: 'pokemon', slug: '../private', revision: 1 },
      })),
      'invalid-ground-item',
      'mapGroundItem.sourceResource.slug',
    )
  })

  it('bounds quantity, strings, per-record payload, list count, and stable identities', () => {
    expectGroundItemError(
      () => parseMapGroundItem(groundItem({ quantity: 0 })),
      'limit-exceeded',
      'mapGroundItem.quantity',
    )
    expectGroundItemError(
      () => parseMapGroundItem(groundItem({
        canonicalItemName: 'x'.repeat(MAP_GROUND_ITEM_LIMITS.canonicalNameChars + 1),
      })),
      'invalid-ground-item',
      'mapGroundItem.canonicalItemName',
    )
    expectGroundItemError(
      () => parseMapGroundItem(groundItem({
        ownerPlacementId: 'x'.repeat(MAP_GROUND_ITEM_LIMITS.ownerPlacementIdChars + 1),
      })),
      'invalid-ground-item',
      'mapGroundItem.ownerPlacementId',
    )
    expectGroundItemError(
      () => parseMapGroundItems([groundItem(), groundItem()]),
      'duplicate-ground-item',
      'mapGroundItems[1].id',
    )

    const oversized = Array.from(
      { length: MAP_GROUND_ITEM_LIMITS.count + 1 },
      (_, index) => groundItem({ id: `ground-item-${index}` }),
    )
    expectGroundItemError(
      () => parseMapGroundItems(oversized),
      'limit-exceeded',
      'mapGroundItems',
    )
  })

  it('preserves deterministic input order while returning detached records', () => {
    const source = [
      groundItem({ id: 'ground-item-z', position: { x: 2, y: 0, z: 1 } }),
      groundItem({ id: 'ground-item-a', position: { x: 1, y: 0, z: 1 } }),
    ]
    const parsed = parseMapGroundItems(source)

    expect(parsed.map(item => item.id)).toEqual(['ground-item-z', 'ground-item-a'])
    expect(parsed).not.toBe(source)
    expect(parsed[0]).not.toBe(source[0])
  })
})
