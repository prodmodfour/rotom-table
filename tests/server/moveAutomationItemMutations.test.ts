import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type {
  MoveItemGroupInventoryOwnerReference,
  MoveItemMapOwnerReference,
  MoveItemPokemonSheetOwnerReference,
  MoveItemReference,
  MoveItemTrainerSheetOwnerReference,
} from '#shared/moveAutomation/items'
import type { CharacterSheet } from '~/types/characterSheet'
import {
  GROUP_INVENTORY_SECTION_KEYS,
  type GroupInventory,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import type { TabletopMap } from '~/types/map'
import type { TrainerInventory, TrainerSheet } from '~/types/trainerSheet'
import {
  MoveGroupInventoryPlanError,
  moveGroupInventoryChangesForPersistence,
} from '~~/server/domain/moveAutomation/groupInventoryChanges'
import { MoveItemMutationError } from '~~/server/domain/moveAutomation/itemMutationTypes'
import { planMoveItemMutations } from '~~/server/domain/moveAutomation/planItemMutations'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const emptyInventory = (): GroupInventory => Object.fromEntries(
  GROUP_INVENTORY_SECTION_KEYS.map(section => [section, []]),
) as unknown as GroupInventory

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'item-arena',
  name: 'Item Arena',
  revision: 7,
  dimensions: { x: 8, y: 2, z: 8 },
  voxels: [],
  placements: [],
  lights: [],
  encounterState: createEmptyEncounterState(),
})

const pokemonSheet = (
  slug: string,
  revision: number,
  held?: string,
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Pikachu',
  level: 20,
  revision,
  ...(held ? { items: { held } } : {}),
})

const trainerSheet = (
  slug = 'ace',
  revision = 4,
  inventory: TrainerInventory = emptyInventory(),
): TrainerSheet => ({
  slug,
  name: slug,
  level: 20,
  revision,
  inventory,
})

const groupInventory = (
  inventory: GroupInventory = emptyInventory(),
  revision = 6,
): GroupInventoryDocument => ({
  slug: 'main',
  revision,
  updatedAt: 100,
  money: 0,
  inventory,
})

const pokemonOwner = (
  slug: string,
  revision: number,
): MoveItemPokemonSheetOwnerReference => ({
  kind: 'sheet',
  sheetKind: 'pokemon',
  slug,
  revision,
})

const trainerOwner = (
  slug: string,
  revision: number,
): MoveItemTrainerSheetOwnerReference => ({
  kind: 'sheet',
  sheetKind: 'trainer',
  slug,
  revision,
})

const groupOwner = (revision = 6): MoveItemGroupInventoryOwnerReference => ({
  kind: 'group-inventory',
  slug: 'main',
  revision,
})

const mapOwner = (revision = 7): MoveItemMapOwnerReference => ({
  kind: 'map',
  slug: 'item-arena',
  revision,
})

const heldReference = (
  slug: string,
  revision: number,
  canonicalItemId: string,
): MoveItemReference => ({
  schemaVersion: 1,
  kind: 'pokemon-held',
  itemId: 'held:1',
  canonicalItemId,
  owner: pokemonOwner(slug, revision),
  quantity: 1,
  stack: 'singleton',
  equip: 'pokemon-held',
})

const groupRowReference = (input: {
  readonly itemId: string
  readonly canonicalItemId: string
  readonly section: keyof GroupInventory
  readonly quantity: number
  readonly revision?: number
}): MoveItemReference => ({
  schemaVersion: 1,
  kind: 'group-inventory-row',
  itemId: input.itemId,
  canonicalItemId: input.canonicalItemId,
  owner: groupOwner(input.revision),
  section: input.section,
  quantity: input.quantity,
  stack: input.section === 'equipment' ? 'singleton' : 'stackable',
  equip: 'unequipped',
})

const groundReference = (input: {
  readonly itemId: string
  readonly canonicalItemId: string
  readonly quantity: number
}): MoveItemReference => ({
  schemaVersion: 1,
  kind: 'map-ground-item',
  itemId: input.itemId,
  canonicalItemId: input.canonicalItemId,
  owner: mapOwner(),
  quantity: input.quantity,
  stack: input.quantity === 1 ? 'singleton' : 'stackable',
  equip: 'unequipped',
})

const basePlanInput = () => ({
  map: mapFixture(),
  pokemonSheets: new Map<string, CharacterSheet>(),
  trainerSheets: new Map<string, TrainerSheet>(),
  groupInventories: new Map<string, GroupInventoryDocument>(),
  originOperationId: 'op_itemmutation01',
  plannedAt: 1_700_000_000_000,
})

const expectItemError = (
  action: () => unknown,
  code: MoveItemMutationError['code'],
): void => {
  try {
    action()
    expect.unreachable(`Expected item mutation error ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveItemMutationError)
    expect(error).toMatchObject({ code })
  }
}

describe('typed move item mutation plans', () => {
  it('plans transfer and equip mutations as one revision-checked write per shared resource', () => {
    const map = mapFixture()
    const pokemon = pokemonSheet('sparky', 3)
    const trainer = trainerSheet()
    const group = groupInventory({
      ...emptyInventory(),
      medicalKit: [{ id: 'group-potions', name: 'Potion', qty: 5 }],
      equipment: [
        { id: 'group-iron-ball', name: 'Iron Ball' },
        { id: 'group-bright-powder', name: 'Bright Powder' },
      ],
    })
    const originalGroup = structuredClone(group)

    const plan = planMoveItemMutations({
      map,
      pokemonSheets: new Map([[pokemon.slug, pokemon]]),
      trainerSheets: new Map([[trainer.slug, trainer]]),
      groupInventories: new Map([[group.slug, group]]),
      originOperationId: 'op_itemmutation01',
      plannedAt: 1_700_000_000_000,
      operations: [
        {
          id: 'item.transfer-potions',
          kind: 'transfer',
          reasonCode: 'item.transfer',
          source: groupRowReference({
            itemId: 'group-potions',
            canonicalItemId: 'potion',
            section: 'medicalKit',
            quantity: 5,
          }),
          destination: {
            kind: 'trainer-inventory-row',
            owner: trainerOwner('ace', 4),
            itemId: 'trainer-potions',
            section: 'medicalKit',
          },
          quantity: 2,
        },
        {
          id: 'item.equip-iron-ball',
          kind: 'equip',
          reasonCode: 'item.equip',
          source: groupRowReference({
            itemId: 'group-iron-ball',
            canonicalItemId: 'iron-ball',
            section: 'equipment',
            quantity: 1,
          }),
          destination: {
            kind: 'pokemon-held',
            owner: pokemonOwner('sparky', 3),
          },
          quantity: 1,
        },
        {
          id: 'item.equip-bright-powder',
          kind: 'equip',
          reasonCode: 'item.equip',
          source: groupRowReference({
            itemId: 'group-bright-powder',
            canonicalItemId: 'bright-powder',
            section: 'equipment',
            quantity: 1,
          }),
          destination: {
            kind: 'trainer-equipment-slot',
            owner: trainerOwner('ace', 4),
            slot: 'accessory',
          },
          quantity: 1,
        },
      ],
    })

    expect(group).toEqual(originalGroup)
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.nextMap)).toBe(true)
    expect(Object.isFrozen(plan.groupInventoryWrites[0]?.nextDocument)).toBe(true)
    expect(plan.groupInventoryWrites).toHaveLength(1)
    expect(plan.groupInventoryWrites[0]).toMatchObject({
      slug: 'main',
      expectedRevision: 6,
      revision: 7,
      nextDocument: {
        revision: 7,
        updatedAt: 1_700_000_000_000,
        inventory: {
          medicalKit: [{ id: 'group-potions', name: 'Potion', qty: 3 }],
          equipment: [],
        },
      },
    })
    expect(plan.sheetWrites).toHaveLength(2)
    expect(plan.sheetWrites.find(write => write.slug === 'ace')).toMatchObject({
      expectedRevision: 4,
      revision: 5,
      changedFields: ['inventory', 'equipmentSlots'],
      nextSheet: {
        inventory: {
          medicalKit: [{ id: 'trainer-potions', name: 'Potion', qty: 2 }],
        },
        equipmentSlots: { accessory: 'Bright Powder' },
      },
    })
    expect(plan.sheetWrites.find(write => write.slug === 'sparky')).toMatchObject({
      expectedRevision: 3,
      revision: 4,
      changedFields: ['items'],
      nextSheet: { items: { held: 'Iron Ball' } },
    })
    expect(plan.stateChanges.expectedRevisions).toEqual([
      { kind: 'external-resource', resourceKind: 'group-inventory', resourceId: 'main', expectedRevision: 6 },
      { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ace', expectedRevision: 4 },
      { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'sparky', expectedRevision: 3 },
    ])
    expect(moveGroupInventoryChangesForPersistence({
      plan: plan.stateChanges,
      reads: [{ slug: 'main', revision: 6 }],
    })).toEqual([
      expect.objectContaining({
        expectedRevision: 6,
        scope: {
          kind: 'external-resource',
          resourceKind: 'group-inventory',
          resourceId: 'main',
        },
        current: expect.objectContaining({ revision: 7 }),
      }),
    ])
    expect(() => moveGroupInventoryChangesForPersistence({
      plan: plan.stateChanges,
      reads: [{ slug: 'main', revision: 5 }],
    })).toThrowError(expect.objectContaining({
      name: 'MoveGroupInventoryPlanError',
    } satisfies Partial<MoveGroupInventoryPlanError>))
    expect(plan.operationResults[0]?.resourceScopes).toEqual([
      { kind: 'group-inventory', slug: 'main', expectedRevision: 6 },
      { kind: 'sheet', sheetKind: 'trainer', slug: 'ace', expectedRevision: 4 },
    ])
    expect(plan.operationResults.map(result => ({
      kind: result.kind,
      policy: result.quantityPolicy,
      effects: result.quantityEffects,
    }))).toEqual([
      {
        kind: 'transfer',
        policy: 'conserve',
        effects: [{ canonicalItemId: 'potion', delta: 0 }],
      },
      {
        kind: 'equip',
        policy: 'conserve',
        effects: [{ canonicalItemId: 'iron-ball', delta: 0 }],
      },
      {
        kind: 'equip',
        policy: 'conserve',
        effects: [{ canonicalItemId: 'bright-powder', delta: 0 }],
      },
    ])
  })

  it('plans unequip, direct held-item transfer, and occupied-item swaps without changing canonical quantity', () => {
    const map = mapFixture()
    const left = pokemonSheet('left-mon', 2, 'Leftovers')
    const right = pokemonSheet('right-mon', 5, 'Iron Ball')
    const receiver = pokemonSheet('receiver-mon', 6)
    const group = groupInventory()

    const unequip = planMoveItemMutations({
      ...basePlanInput(),
      map,
      pokemonSheets: new Map([[left.slug, left]]),
      groupInventories: new Map([[group.slug, group]]),
      operations: [{
        id: 'item.unequip-leftovers',
        kind: 'unequip',
        reasonCode: 'item.unequip',
        source: heldReference('left-mon', 2, 'leftovers'),
        destination: {
          kind: 'group-inventory-row',
          owner: groupOwner(),
          itemId: 'group-leftovers',
          section: 'equipment',
        },
        quantity: 1,
      }],
    })
    expect(unequip.sheetWrites[0]?.nextSheet).toMatchObject({ items: {} })
    expect(unequip.groupInventoryWrites[0]?.nextDocument.inventory.equipment).toEqual([
      { id: 'group-leftovers', name: 'Leftovers' },
    ])
    expect(unequip.operationResults[0]?.quantityEffects).toEqual([
      { canonicalItemId: 'leftovers', delta: 0 },
    ])

    const transfer = planMoveItemMutations({
      ...basePlanInput(),
      map,
      pokemonSheets: new Map([
        [left.slug, left],
        [receiver.slug, receiver],
      ]),
      operations: [{
        id: 'item.give-held',
        kind: 'transfer',
        reasonCode: 'item.transfer',
        source: heldReference('left-mon', 2, 'leftovers'),
        destination: {
          kind: 'pokemon-held',
          owner: pokemonOwner('receiver-mon', 6),
        },
        quantity: 1,
      }],
    })
    expect(transfer.sheetWrites.find(write => write.slug === 'left-mon')?.nextSheet)
      .toMatchObject({ items: {} })
    expect(transfer.sheetWrites.find(write => write.slug === 'receiver-mon')?.nextSheet)
      .toMatchObject({ items: { held: 'Leftovers' } })
    expect(transfer.operationResults[0]?.quantityEffects).toEqual([
      { canonicalItemId: 'leftovers', delta: 0 },
    ])

    const swap = planMoveItemMutations({
      ...basePlanInput(),
      map,
      pokemonSheets: new Map([
        [left.slug, left],
        [right.slug, right],
      ]),
      operations: [{
        id: 'item.swap-held',
        kind: 'swap',
        reasonCode: 'item.swap',
        left: heldReference('left-mon', 2, 'leftovers'),
        right: heldReference('right-mon', 5, 'iron-ball'),
      }],
    })
    expect(swap.sheetWrites.find(write => write.slug === 'left-mon')?.nextSheet)
      .toMatchObject({ items: { held: 'Iron Ball' } })
    expect(swap.sheetWrites.find(write => write.slug === 'right-mon')?.nextSheet)
      .toMatchObject({ items: { held: 'Leftovers' } })
    expect(swap.operationResults[0]).toMatchObject({
      quantityPolicy: 'conserve',
      quantityEffects: [
        { canonicalItemId: 'iron-ball', delta: 0 },
        { canonicalItemId: 'leftovers', delta: 0 },
      ],
    })
  })

  it('audits decrement, consume, destroy, and restore-consumed as the only explicit quantity deltas', () => {
    const group = groupInventory({
      ...emptyInventory(),
      medicalKit: [
        { id: 'group-potions', name: 'Potion', qty: 5 },
        { id: 'group-leftovers', name: 'Leftovers', qty: 2 },
      ],
      equipment: [{ id: 'group-iron-ball', name: 'Iron Ball' }],
    })
    const trainer = trainerSheet()
    const plan = planMoveItemMutations({
      ...basePlanInput(),
      trainerSheets: new Map([[trainer.slug, trainer]]),
      groupInventories: new Map([[group.slug, group]]),
      operations: [
        {
          id: 'item.decrement-potion',
          kind: 'decrement',
          reasonCode: 'item.decrement',
          source: groupRowReference({
            itemId: 'group-potions', canonicalItemId: 'potion', section: 'medicalKit', quantity: 5,
          }),
          quantity: 1,
        },
        {
          id: 'item.consume-leftovers',
          kind: 'consume',
          reasonCode: 'item.consume',
          source: groupRowReference({
            itemId: 'group-leftovers', canonicalItemId: 'leftovers', section: 'medicalKit', quantity: 2,
          }),
          quantity: 1,
          consumptionId: 'consumption.leftovers',
        },
        {
          id: 'item.destroy-iron-ball',
          kind: 'destroy',
          reasonCode: 'item.destroy',
          source: groupRowReference({
            itemId: 'group-iron-ball', canonicalItemId: 'iron-ball', section: 'equipment', quantity: 1,
          }),
          quantity: 1,
        },
        {
          id: 'item.restore-leftovers',
          kind: 'restore-consumed',
          reasonCode: 'item.restore-consumed',
          consumptionId: 'consumption.leftovers',
          destination: {
            kind: 'trainer-inventory-row',
            owner: trainerOwner('ace', 4),
            itemId: 'restored-leftovers',
            section: 'medicalKit',
          },
        },
      ],
    })

    expect(plan.operationResults.map(result => ({
      kind: result.kind,
      policy: result.quantityPolicy,
      effects: result.quantityEffects,
    }))).toEqual([
      { kind: 'decrement', policy: 'decrement', effects: [{ canonicalItemId: 'potion', delta: -1 }] },
      { kind: 'consume', policy: 'consume', effects: [{ canonicalItemId: 'leftovers', delta: -1 }] },
      { kind: 'destroy', policy: 'destroy', effects: [{ canonicalItemId: 'iron-ball', delta: -1 }] },
      { kind: 'restore-consumed', policy: 'restore-consumed', effects: [{ canonicalItemId: 'leftovers', delta: 1 }] },
    ])
    expect(plan.consumedItems).toEqual([{
      consumptionId: 'consumption.leftovers',
      sourceOperationId: 'item.consume-leftovers',
      source: groupRowReference({
        itemId: 'group-leftovers', canonicalItemId: 'leftovers', section: 'medicalKit', quantity: 2,
      }),
      canonicalItemId: 'leftovers',
      quantity: 1,
    }])
    expect(plan.availableConsumedItems).toEqual([])
    expect(plan.groupInventoryWrites).toHaveLength(1)
    expect(plan.groupInventoryWrites[0]?.nextDocument.inventory).toMatchObject({
      medicalKit: [
        { id: 'group-potions', name: 'Potion', qty: 4 },
        { id: 'group-leftovers', name: 'Leftovers', qty: 1 },
      ],
      equipment: [],
    })
    expect(plan.sheetWrites[0]?.nextSheet).toMatchObject({
      inventory: {
        medicalKit: [{ id: 'restored-leftovers', name: 'Leftovers', qty: 1 }],
      },
    })
  })

  it('adds and removes ground items through one bounded encounter-state write', () => {
    const map = mapFixture()
    map.encounterState = {
      ...createEmptyEncounterState(),
      groundItems: [{
        id: 'ground-iron-ball',
        canonicalItemId: 'iron-ball',
        canonicalItemName: 'Iron Ball',
        quantity: 2,
        position: { x: 2, y: 0, z: 2 },
        sourceResource: groupOwner(1),
        sourceOperationId: 'op_groundsource01',
        sideId: null,
        ownerPlacementId: null,
      }],
    }
    const pokemon = pokemonSheet('dropper', 3, 'Leftovers')
    const trainer = trainerSheet()
    const plan = planMoveItemMutations({
      ...basePlanInput(),
      map,
      pokemonSheets: new Map([[pokemon.slug, pokemon]]),
      trainerSheets: new Map([[trainer.slug, trainer]]),
      operations: [
        {
          id: 'item.drop-leftovers',
          kind: 'ground-item-add',
          reasonCode: 'item.drop',
          source: heldReference('dropper', 3, 'leftovers'),
          destination: {
            kind: 'map-ground-item',
            owner: mapOwner(),
            itemId: 'ground-leftovers',
            position: { x: 3, y: 0, z: 3 },
            sideId: null,
            ownerPlacementId: null,
          },
          quantity: 1,
        },
        {
          id: 'item.pick-up-iron-ball',
          kind: 'ground-item-remove',
          reasonCode: 'item.pick-up',
          source: groundReference({
            itemId: 'ground-iron-ball', canonicalItemId: 'iron-ball', quantity: 2,
          }),
          destination: {
            kind: 'trainer-inventory-row',
            owner: trainerOwner('ace', 4),
            itemId: 'trainer-iron-ball',
            section: 'pokemonItems',
          },
          quantity: 1,
        },
      ],
    })

    expect(plan.nextMap).toMatchObject({ revision: 8, updatedAt: 1_700_000_000_000 })
    expect(plan.nextMap.encounterState?.groundItems).toEqual([
      expect.objectContaining({ id: 'ground-iron-ball', quantity: 1 }),
      {
        id: 'ground-leftovers',
        canonicalItemId: 'leftovers',
        canonicalItemName: 'Leftovers',
        quantity: 1,
        position: { x: 3, y: 0, z: 3 },
        sourceResource: pokemonOwner('dropper', 3),
        sourceOperationId: 'op_itemmutation01',
        sideId: null,
        ownerPlacementId: null,
      },
    ])
    expect(plan.stateChanges.changes.filter(change => change.kind === 'encounter-state')).toHaveLength(1)
    expect(plan.stateChanges.expectedRevisions).toContainEqual({
      kind: 'map', mapSlug: 'item-arena', expectedRevision: 7,
    })
    expect(plan.operationResults.map(result => result.quantityEffects)).toEqual([
      [{ canonicalItemId: 'leftovers', delta: 0 }],
      [{ canonicalItemId: 'iron-ball', delta: 0 }],
    ])
    expect(plan.sheetWrites.find(write => write.slug === 'dropper')?.changedFields).toEqual(['items'])
    expect(plan.sheetWrites.find(write => write.slug === 'ace')?.nextSheet).toMatchObject({
      inventory: {
        pokemonItems: [{ id: 'trainer-iron-ball', name: 'Iron Ball', qty: 1 }],
      },
    })
  })

  it('allows exactly a second held item for an effective Delivery Bird owner', () => {
    const map = {
      ...mapFixture(),
      placements: [{
        id: 'delivery-bird', sheetKind: 'pokemon' as const, sheetSlug: 'delivery-bird',
        sideId: 'heroes', position: { x: 1, y: 0, z: 1 },
      }],
    }
    const pokemon: CharacterSheet = {
      ...pokemonSheet('delivery-bird', 3, 'Leftovers'),
      abilities: [{
        name: 'Delivery Bird',
        automation: {
          schemaVersion: 1, instanceId: 'base:delivery-bird', canonicalId: 'Delivery Bird',
          definitionVersion: null, selections: [],
        },
      }],
    }
    const group = groupInventory({
      ...emptyInventory(),
      equipment: [{ id: 'group-iron-ball', name: 'Iron Ball' }],
    })
    const operation = {
      id: 'item.delivery-bird.second', kind: 'equip' as const, reasonCode: 'item.equip',
      source: groupRowReference({
        itemId: 'group-iron-ball', canonicalItemId: 'iron-ball', section: 'equipment', quantity: 1,
      }),
      destination: { kind: 'pokemon-held' as const, owner: pokemonOwner('delivery-bird', 3) },
      quantity: 1 as const,
    }
    const planned = planMoveItemMutations({
      ...basePlanInput(), map,
      pokemonSheets: new Map([[pokemon.slug, pokemon]]),
      groupInventories: new Map([[group.slug, group]]),
      operations: [operation],
    })
    const withTwo = planned.sheetWrites.find(write => write.slug === pokemon.slug)?.nextSheet as CharacterSheet
    expect(withTwo.items?.held).toBe('Leftovers, Iron Ball')
    const chooseSecond = planMoveItemMutations({
      ...basePlanInput(), map: planned.nextMap,
      pokemonSheets: new Map([[withTwo.slug, withTwo]]),
      operations: [{
        id: 'item.delivery-bird.choose-second', kind: 'destroy', reasonCode: 'item.destroy',
        source: {
          schemaVersion: 1, kind: 'pokemon-held', itemId: 'held:2', canonicalItemId: 'iron-ball',
          owner: pokemonOwner(withTwo.slug, withTwo.revision ?? 4),
          quantity: 1, stack: 'singleton', equip: 'pokemon-held',
        },
        quantity: 1,
      }],
    })
    expect((chooseSecond.sheetWrites.find(write => write.slug === pokemon.slug)?.nextSheet as CharacterSheet)
      .items?.held).toBe('Leftovers')

    expectItemError(() => planMoveItemMutations({
      ...basePlanInput(), map,
      pokemonSheets: new Map([[pokemon.slug, { ...pokemon, abilities: [] }]]),
      groupInventories: new Map([[group.slug, group]]),
      operations: [operation],
    }), 'destination-occupied')
  })

  it('allows exactly a second held item for an effective Handyman owner', () => {
    const map = {
      ...mapFixture(),
      placements: [{
        id: 'handyman', sheetKind: 'pokemon' as const, sheetSlug: 'handyman',
        sideId: 'heroes', position: { x: 1, y: 0, z: 1 },
      }],
    }
    const pokemon: CharacterSheet = {
      ...pokemonSheet('handyman', 3, 'Leftovers'),
      abilities: [{
        name: 'Handyman',
        automation: {
          schemaVersion: 1, instanceId: 'base:handyman', canonicalId: 'Handyman',
          definitionVersion: null, selections: [],
        },
      }],
    }
    const group = groupInventory({
      ...emptyInventory(),
      equipment: [{ id: 'group-iron-ball', name: 'Iron Ball' }],
    })
    const operation = {
      id: 'item.handyman.second', kind: 'equip' as const, reasonCode: 'item.equip',
      source: groupRowReference({
        itemId: 'group-iron-ball', canonicalItemId: 'iron-ball', section: 'equipment', quantity: 1,
      }),
      destination: { kind: 'pokemon-held' as const, owner: pokemonOwner('handyman', 3) },
      quantity: 1 as const,
    }
    const planned = planMoveItemMutations({
      ...basePlanInput(), map,
      pokemonSheets: new Map([[pokemon.slug, pokemon]]),
      groupInventories: new Map([[group.slug, group]]),
      operations: [operation],
    })
    expect((planned.sheetWrites.find(write => write.slug === pokemon.slug)?.nextSheet as CharacterSheet)
      .items?.held).toBe('Leftovers, Iron Ball')

    expectItemError(() => planMoveItemMutations({
      ...basePlanInput(),
      map: { ...map, encounterState: { ...map.encounterState!, effects: [{
        ...creatureRuleOverlayEncounterEffectFixture({
          domain: 'ability', action: 'suppress', values: [],
          referencePlacementId: null, suppressionScope: 'all',
        }),
        id: 'effect.suppress-handyman',
        affected: { placementIds: ['handyman'], sideIds: [], cells: [] },
      }] } },
      pokemonSheets: new Map([[pokemon.slug, pokemon]]),
      groupInventories: new Map([[group.slug, group]]),
      operations: [operation],
    }), 'destination-occupied')
  })

  it('fails closed on stale identity, overdraw, occupied destinations, forged restore, and invalid ground cells', () => {
    const map = mapFixture()
    const pokemon = pokemonSheet('occupied', 3, 'Leftovers')
    const group = groupInventory({
      ...emptyInventory(),
      medicalKit: [{ id: 'group-potions', name: 'Potion', qty: 1 }],
      equipment: [{ id: 'group-iron-ball', name: 'Iron Ball' }],
    })
    const common = {
      ...basePlanInput(),
      map,
      pokemonSheets: new Map([[pokemon.slug, pokemon]]),
      groupInventories: new Map([[group.slug, group]]),
    }

    expectItemError(() => planMoveItemMutations({
      ...common,
      operations: [{
        id: 'item.stale',
        kind: 'decrement',
        reasonCode: 'item.decrement',
        source: groupRowReference({
          itemId: 'group-potions', canonicalItemId: 'potion', section: 'medicalKit', quantity: 1, revision: 5,
        }),
        quantity: 1,
      }],
    }), 'revision-conflict')

    expectItemError(() => planMoveItemMutations({
      ...common,
      operations: [{
        id: 'item.overdraw',
        kind: 'destroy',
        reasonCode: 'item.destroy',
        source: groupRowReference({
          itemId: 'group-potions', canonicalItemId: 'potion', section: 'medicalKit', quantity: 1,
        }),
        quantity: 2,
      }],
    }), 'insufficient-quantity')

    expectItemError(() => planMoveItemMutations({
      ...common,
      operations: [{
        id: 'item.occupied',
        kind: 'equip',
        reasonCode: 'item.equip',
        source: groupRowReference({
          itemId: 'group-iron-ball', canonicalItemId: 'iron-ball', section: 'equipment', quantity: 1,
        }),
        destination: { kind: 'pokemon-held', owner: pokemonOwner('occupied', 3) },
        quantity: 1,
      }],
    }), 'destination-occupied')

    expectItemError(() => planMoveItemMutations({
      ...common,
      operations: [{
        id: 'item.forged-restore',
        kind: 'restore-consumed',
        reasonCode: 'item.restore-consumed',
        consumptionId: 'consumption.unknown',
        destination: {
          kind: 'group-inventory-row',
          owner: groupOwner(),
          itemId: 'forged-row',
          section: 'medicalKit',
        },
      }],
    }), 'consumption-missing')

    expectItemError(() => planMoveItemMutations({
      ...common,
      operations: [{
        id: 'item.out-of-bounds',
        kind: 'ground-item-add',
        reasonCode: 'item.drop',
        source: groupRowReference({
          itemId: 'group-potions', canonicalItemId: 'potion', section: 'medicalKit', quantity: 1,
        }),
        destination: {
          kind: 'map-ground-item',
          owner: mapOwner(),
          itemId: 'ground-potion',
          position: { x: 8, y: 0, z: 0 },
          sideId: null,
          ownerPlacementId: null,
        },
        quantity: 1,
      }],
    }), 'map-position-invalid')
  })
})
