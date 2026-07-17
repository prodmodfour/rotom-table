import { describe, expect, it, vi } from 'vitest'
import {
  AUTHORITATIVE_MOVE_ITEM_RESOURCE_LIMITS,
  AuthoritativeMoveItemResourceError,
  createAuthoritativeMoveItemResourceQueries,
  parseAuthoritativeMoveItemResourceRequirements,
  resolveAuthoritativeMoveItemResources,
} from '~~/server/domain/moveAutomation/itemResources'
import { loadMoveItemResources } from '~~/server/useCases/loadMoveItemResources'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const placement = (
  id: string,
  sheetKind: SheetPlacement['sheetKind'],
  sheetSlug: string,
): SheetPlacement => ({
  id,
  sheetKind,
  sheetSlug,
  position: { x: 0, y: 0, z: 0 },
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'item-arena',
  name: 'Item Arena',
  revision: 7,
  dimensions: { x: 8, y: 2, z: 8 },
  voxels: [],
  placements: [
    placement('actor', 'trainer', 'ace'),
    placement('target', 'pokemon', 'target-mon'),
    placement('bystander', 'pokemon', 'private-bystander'),
  ],
  lights: [],
  encounterState: {
    ...createEmptyEncounterState(),
    groundItems: [{
      id: 'ground-iron-ball',
      canonicalItemId: 'iron-ball',
      canonicalItemName: 'Iron Ball',
      quantity: 2,
      position: { x: 1, y: 0, z: 1 },
      sourceResource: {
        kind: 'group-inventory',
        slug: 'main',
        revision: 2,
      },
      sourceOperationId: 'op_itemsource1',
      sideId: null,
      ownerPlacementId: null,
    }],
  },
})

const trainerSheet = (): TrainerSheet => ({
  slug: 'ace',
  name: 'Ace',
  level: 20,
  revision: 4,
  movelist: [{ name: 'Knock Off' }],
  equipmentSlots: {
    accessory: 'Bright Powder',
    mainHand: 'Unknown Homebrew Blade',
  },
  inventory: {
    medicalKit: [
      { name: 'Potion', qty: 3 },
      { name: 'Unknown Homebrew Tonic', qty: 9 },
      { name: 'Leftovers', qty: 0 },
    ],
    equipment: [{ name: 'Iron Ball' }],
  },
})

const pokemonSheet = (
  slug: string,
  held: string,
  revision: number,
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Pikachu',
  level: 20,
  revision,
  items: { held },
})

const groupInventory = (): GroupInventoryDocument => ({
  slug: 'main',
  revision: 6,
  updatedAt: 100,
  money: 0,
  inventory: {
    keyItems: [],
    pokemonItems: [],
    medicalKit: [
      { id: 'group-potion', name: 'Potion', qty: 5 },
      { id: 'group-empty', name: 'Leftovers', qty: 0 },
    ],
    pokeBalls: [],
    foodStuff: [],
    equipment: [],
  },
})

const requirements = () => ([
  { id: 'test.actor-equipped', source: { kind: 'actor-equipped' } },
  { id: 'test.target-equipped', source: { kind: 'selected-target-equipped' } },
  {
    id: 'test.actor-bag',
    source: {
      kind: 'actor-trainer-inventory',
      sections: ['medicalKit', 'equipment'],
    },
  },
  {
    id: 'test.shared-bag',
    source: {
      kind: 'group-inventory',
      slug: 'main',
      sections: ['medicalKit'],
    },
  },
  { id: 'test.ground', source: { kind: 'map-ground-items' } },
] as const)

describe('authoritative move item resources', () => {
  it('normalizes only reviewed actor/target/group/map candidates and records every owner revision', () => {
    const map = mapFixture()
    const trainer = trainerSheet()
    const target = pokemonSheet('target-mon', 'Leftovers', 3)
    const bystander = pokemonSheet('private-bystander', 'Bright Powder', 9)
    const resources = resolveAuthoritativeMoveItemResources({
      map,
      actorPlacementId: 'actor',
      selectedTargetPlacementIds: ['target'],
      pokemonSheets: new Map([
        [target.slug, target],
        [bystander.slug, bystander],
      ]),
      trainerSheets: new Map([[trainer.slug, trainer]]),
      groupInventories: new Map([['main', groupInventory()]]),
      requirements: requirements(),
    })

    expect(resources.sheetReads).toEqual([
      { kind: 'trainer', slug: 'ace', revision: 4 },
      { kind: 'pokemon', slug: 'target-mon', revision: 3 },
    ])
    expect(resources.groupInventoryReads).toEqual([{ slug: 'main', revision: 6 }])
    expect(resources.candidates.map(candidate => ({
      requirementId: candidate.requirementId,
      kind: candidate.reference.kind,
      itemId: candidate.reference.itemId,
      canonicalItemId: candidate.reference.canonicalItemId,
      quantity: candidate.reference.quantity,
    }))).toEqual([
      {
        requirementId: 'test.actor-equipped',
        kind: 'trainer-equipment-slot',
        itemId: 'slot:accessory:1',
        canonicalItemId: 'bright-powder',
        quantity: 1,
      },
      {
        requirementId: 'test.target-equipped',
        kind: 'pokemon-held',
        itemId: 'held:1',
        canonicalItemId: 'leftovers',
        quantity: 1,
      },
      {
        requirementId: 'test.actor-bag',
        kind: 'trainer-inventory-row',
        itemId: 'trainer-row:medicalKit:1',
        canonicalItemId: 'potion',
        quantity: 3,
      },
      {
        requirementId: 'test.actor-bag',
        kind: 'trainer-inventory-row',
        itemId: 'trainer-row:equipment:1',
        canonicalItemId: 'iron-ball',
        quantity: 1,
      },
      {
        requirementId: 'test.shared-bag',
        kind: 'group-inventory-row',
        itemId: 'group-potion',
        canonicalItemId: 'potion',
        quantity: 5,
      },
      {
        requirementId: 'test.ground',
        kind: 'map-ground-item',
        itemId: 'ground-iron-ball',
        canonicalItemId: 'iron-ball',
        quantity: 2,
      },
    ])
    expect(JSON.stringify(resources)).not.toContain('private-bystander')
    expect(JSON.stringify(resources)).not.toContain('Unknown Homebrew')
    expect(Object.isFrozen(resources)).toBe(true)
    expect(Object.isFrozen(resources.candidates)).toBe(true)

    const queries = createAuthoritativeMoveItemResourceQueries(resources)
    expect(queries.all()).toHaveLength(6)
    expect(queries.forRequirement('test.target-equipped')).toHaveLength(1)
    expect(queries.forRequirement('unknown')).toEqual([])
    expect(Object.isFrozen(queries.all())).toBe(true)
  })

  it('exposes only strict private consumed-item evidence by stable identity', () => {
    const map = mapFixture()
    const trainer = trainerSheet()
    const target = pokemonSheet('target-mon', 'Leftovers', 3)
    const sourceResources = resolveAuthoritativeMoveItemResources({
      map,
      actorPlacementId: 'actor',
      selectedTargetPlacementIds: ['target'],
      pokemonSheets: new Map([[target.slug, target]]),
      trainerSheets: new Map([[trainer.slug, trainer]]),
      groupInventories: new Map(),
      requirements: [{ id: 'test.target-equipped', source: { kind: 'selected-target-equipped' } }],
    })
    const consumedItem = {
      consumptionId: 'consumption.leftovers',
      sourceOperationId: 'item.consume-leftovers',
      source: sourceResources.candidates[0]!.reference,
      canonicalItemId: 'leftovers',
      quantity: 1,
    }
    const resources = resolveAuthoritativeMoveItemResources({
      map,
      actorPlacementId: 'actor',
      selectedTargetPlacementIds: [],
      pokemonSheets: new Map([[target.slug, target]]),
      trainerSheets: new Map([[trainer.slug, trainer]]),
      groupInventories: new Map(),
      consumedItems: [consumedItem],
      requirements: [],
    })
    const queries = createAuthoritativeMoveItemResourceQueries(resources)

    expect(queries.consumedById('consumption.leftovers')).toEqual(consumedItem)
    expect(queries.consumedById('consumption.unknown')).toBeNull()
    expect(Object.isFrozen(resources.consumedItems)).toBe(true)
    expect(Object.isFrozen(resources.consumedItems[0])).toBe(true)

    expect(() => resolveAuthoritativeMoveItemResources({
      map,
      actorPlacementId: 'actor',
      selectedTargetPlacementIds: [],
      pokemonSheets: new Map([[target.slug, target]]),
      trainerSheets: new Map([[trainer.slug, trainer]]),
      groupInventories: new Map(),
      consumedItems: [consumedItem, consumedItem],
      requirements: [],
    })).toThrowError(expect.objectContaining({
      name: AuthoritativeMoveItemResourceError.name,
      code: 'duplicate-consumed-item',
    }))

    for (const invalidRecord of [
      { ...consumedItem, canonicalItemId: 'iron-ball' },
      { ...consumedItem, consumptionId: 'Client supplied identity' },
    ]) {
      expect(() => resolveAuthoritativeMoveItemResources({
        map,
        actorPlacementId: 'actor',
        selectedTargetPlacementIds: [],
        pokemonSheets: new Map([[target.slug, target]]),
        trainerSheets: new Map([[trainer.slug, trainer]]),
        groupInventories: new Map(),
        consumedItems: [invalidRecord],
        requirements: [],
      })).toThrowError(expect.objectContaining({
        name: AuthoritativeMoveItemResourceError.name,
        code: 'invalid-consumed-item',
      }))
    }
  })

  it('fails closed on ambiguous stored row identities while retaining the owner read', () => {
    const map = mapFixture()
    const trainer = trainerSheet()
    trainer.inventory = {
      medicalKit: [
        { id: 'duplicate-row', name: 'Potion', qty: 1 },
        { id: 'duplicate-row', name: 'Leftovers', qty: 1 },
      ] as Array<{ id: string; name: string; qty: number }>,
    }
    const resources = resolveAuthoritativeMoveItemResources({
      map,
      actorPlacementId: 'actor',
      selectedTargetPlacementIds: [],
      pokemonSheets: new Map(),
      trainerSheets: new Map([[trainer.slug, trainer]]),
      groupInventories: new Map(),
      requirements: [{
        id: 'test.actor-bag',
        source: { kind: 'actor-trainer-inventory', sections: ['medicalKit'] },
      }],
    })

    expect(resources.candidates).toEqual([])
    expect(resources.sheetReads).toEqual([
      { kind: 'trainer', slug: 'ace', revision: 4 },
    ])
  })

  it('loads only group inventory slugs explicitly required by server metadata', () => {
    const map = mapFixture()
    const trainer = trainerSheet()
    const get = vi.fn((slug: string) => slug === 'main'
      ? {
          slug,
          revision: 6,
          updatedAt: 100,
          document: groupInventory(),
        }
      : null)
    const resources = loadMoveItemResources({
      map,
      intent: {
        schemaVersion: 1,
        placementId: 'actor',
        moveName: 'Knock Off',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      pokemonSheets: new Map([
        ['target-mon', pokemonSheet('target-mon', 'Leftovers', 3)],
        ['private-bystander', pokemonSheet('private-bystander', 'Bright Powder', 9)],
      ]),
      trainerSheets: new Map([[trainer.slug, trainer]]),
      groupInventoryRepository: { get },
    })

    expect(get).not.toHaveBeenCalled()
    expect(resources.requirements).toEqual([{
      id: 'knock-off.target-equipped',
      source: { kind: 'selected-target-equipped' },
    }])
    expect(resources.candidates.map(candidate => candidate.reference.canonicalItemId))
      .toEqual(['leftovers'])

    const withGroup = loadMoveItemResources({
      map,
      intent: {
        schemaVersion: 1,
        placementId: 'actor',
        moveName: 'Knock Off',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      pokemonSheets: new Map([
        ['target-mon', pokemonSheet('target-mon', 'Leftovers', 3)],
        ['private-bystander', pokemonSheet('private-bystander', 'Bright Powder', 9)],
      ]),
      trainerSheets: new Map([[trainer.slug, trainer]]),
      groupInventoryRepository: { get },
      requirementProvider: () => [{
        id: 'test.shared-bag',
        source: { kind: 'group-inventory', slug: 'main', sections: ['medicalKit'] },
      }],
    })
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('main')
    expect(withGroup.groupInventoryReads).toEqual([{ slug: 'main', revision: 6 }])
  })

  it('strictly rejects broad, duplicate, and oversized requirement declarations', () => {
    expect(() => parseAuthoritativeMoveItemResourceRequirements([{
      id: 'bad.private-sheet',
      source: { kind: 'sheet', slug: 'unrelated-private-sheet' },
    }])).toThrowError(expect.objectContaining({
      name: 'AuthoritativeMoveItemResourceError',
      code: 'invalid-requirement',
    } satisfies Partial<AuthoritativeMoveItemResourceError>))

    expect(() => parseAuthoritativeMoveItemResourceRequirements([
      { id: 'duplicate', source: { kind: 'actor-equipped' } },
      { id: 'duplicate', source: { kind: 'map-ground-items' } },
    ])).toThrowError(expect.objectContaining({ code: 'duplicate-requirement' }))

    expect(() => parseAuthoritativeMoveItemResourceRequirements(
      Array.from(
        { length: AUTHORITATIVE_MOVE_ITEM_RESOURCE_LIMITS.requirements + 1 },
        (_value, index) => ({
          id: `too-many.${index}`,
          source: { kind: 'actor-equipped' },
        }),
      ),
    )).toThrowError(expect.objectContaining({ code: 'limit-exceeded' }))
  })
})
