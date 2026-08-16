import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlayerProfile } from '#shared/playerProfiles'
import { createEmptySheetEquipmentState, parseSheetEquipmentStateForOwner } from '#shared/itemAutomation/equipment'
import {
  parseEquipmentOperationCommand,
  parseEquipmentOperationResult,
  type EquipmentOperationCommandV1,
} from '#shared/itemAutomation/equipmentOperations'
import { itemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import { executeEquipmentOperation, ExecuteEquipmentOperationUseCaseError } from '~~/server/useCases/executeEquipmentOperation'
import {
  equipmentDefinitionFor,
  equipmentDefinitionSha256,
} from '~~/server/domain/itemAutomation/equipmentDefinitionRegistry'
import { resolveEquipmentContributions } from '~~/server/domain/itemAutomation/equipmentContributions'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteEquipmentOperationRepository } from '~~/server/storage/equipmentOperationRepository'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createDefaultGroupInventoryDocument } from '~/types/groupInventory'
import type { TabletopMap } from '~/types/map'
import {
  applyItemFormChangeCandidate,
  resolveItemFormChangeCandidate,
} from '~~/server/domain/itemAutomation/formChanges'
import {
  createFormChangeMap,
  createFormChangePokemon,
  createFormChangeTrainer,
} from '../fixtures/itemFormChanges'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length) databases.pop()?.close()
})

const op = (digit: string): string => `equipment-operation:v1:${digit.repeat(32)}`
const sourceId = (slug: string, section: 'equipment' | 'pokemonItems', rowId: string): string => itemInventoryInstanceId({
  containerKind: 'trainer', containerSlug: slug, section, rowId,
})
const seedTrainer = (database: RotomDatabase, input: {
  revision?: number
  equipment?: Array<{ id: string; name: string; qty?: number }>
  pokemonItems?: Array<{ id: string; name: string; qty?: number }>
  currentTeam?: string[]
} = {}) => createSqliteSheetRepository<Record<string, unknown>>(database).saveSetupSheet('trainer', 'ash', {
  slug: 'ash', name: 'Ash', level: 10,
  revision: input.revision ?? 4,
  updatedAt: 100,
  currentTeam: input.currentTeam ?? ['pikachu'],
  inventory: { equipment: input.equipment ?? [], pokemonItems: input.pokemonItems ?? [] },
  equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'ash' }),
})
const seedPokemon = (database: RotomDatabase, revision = 2) => createSqliteSheetRepository<Record<string, unknown>>(database).saveSetupSheet('pokemon', 'pikachu', {
  slug: 'pikachu', nickname: 'Pika', species: 'Pikachu', level: 10,
  revision, updatedAt: 100,
  combat: { currentHp: 100, maxHp: 100, temporaryHp: 0, injuries: 0, conditions: [] },
  equipmentState: createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: 'pikachu' }),
})
const equipCommand = (input: {
  operationId?: string
  itemRowId?: string
  itemSection?: 'equipment' | 'pokemonItems'
  sheetRevision?: number
  equipmentRevision?: number
  ownerKind?: 'trainer' | 'pokemon'
  ownerSlug?: string
  ownerSheetRevision?: number
  slots?: readonly ('body' | 'held' | 'mainHand' | 'offHand')[]
  kind?: 'equip' | 'give'
  actorProfileId?: string | null
} = {}): EquipmentOperationCommandV1 => parseEquipmentOperationCommand({
  schemaVersion: 1,
  operationId: input.operationId ?? op('1'),
  commandKind: input.kind ?? 'equip',
  actorProfileId: input.actorProfileId ?? null,
  source: {
    kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash',
    section: input.itemSection ?? 'equipment', rowId: input.itemRowId ?? 'armor-row',
    sourceInstanceId: sourceId('ash', input.itemSection ?? 'equipment', input.itemRowId ?? 'armor-row'),
    expectedRevision: input.sheetRevision ?? 4,
  },
  destination: {
    kind: 'equipment', ownerKind: input.ownerKind ?? 'trainer', ownerSlug: input.ownerSlug ?? 'ash',
    slotIds: input.slots ?? ['body'],
    expectedSheetRevision: input.ownerSheetRevision ?? input.sheetRevision ?? 4,
    expectedEquipmentRevision: input.equipmentRevision ?? 0,
  },
  replacedInstanceId: null,
  swapReturnDestination: null,
  configuration: null,
})
const sheet = (database: RotomDatabase, kind: 'trainer' | 'pokemon', slug: string) =>
  createSqliteSheetRepository<Record<string, unknown>>(database).getByRef(kind, slug)!
const activityCommand = (input: {
  operationId: string
  commandKind: 'suppress' | 'deactivate' | 'break' | 'restore' | 'repair'
  sheetRevision: number
  equipmentRevision: number
  instanceRevision: number
  instanceId?: string
  reasonCode: string
  reasonSourceId?: string | null
  actorProfileId?: string | null
}): EquipmentOperationCommandV1 => parseEquipmentOperationCommand({
  schemaVersion: 1,
  operationId: input.operationId,
  commandKind: input.commandKind,
  actorProfileId: input.actorProfileId ?? null,
  source: {
    kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash',
    instanceId: input.instanceId ?? 'equipment-projection:v1:0',
    expectedSheetRevision: input.sheetRevision,
    expectedEquipmentRevision: input.equipmentRevision,
    expectedInstanceRevision: input.instanceRevision,
  },
  reason: { code: input.reasonCode, sourceId: input.reasonSourceId ?? null },
  guidance: { kind: 'guided-adjudication', note: 'Reviewed at the equipment lifecycle panel.' },
})
const durabilityCommand = (input: {
  operationId: string
  commandKind: 'damage' | 'restore-durability'
  amount: number
  sheetRevision: number
  equipmentRevision: number
  instanceRevision: number
  instanceId?: string
}): EquipmentOperationCommandV1 => parseEquipmentOperationCommand({
  schemaVersion: 1,
  operationId: input.operationId,
  commandKind: input.commandKind,
  actorProfileId: null,
  source: {
    kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash',
    instanceId: input.instanceId ?? 'equipment-projection:v1:0',
    expectedSheetRevision: input.sheetRevision,
    expectedEquipmentRevision: input.equipmentRevision,
    expectedInstanceRevision: input.instanceRevision,
  },
  amount: input.amount,
  guidance: { kind: 'guided-adjudication', note: 'Applied from reviewed item HP evidence.' },
})

describe('equipment operation contracts', () => {
  it('strictly parses command shapes and accepted result revisions', () => {
    const command = equipCommand()
    expect(Object.isFrozen(command)).toBe(true)
    expect(() => parseEquipmentOperationCommand({ ...command, unexpected: true })).toThrow('invalid shape')
    expect(() => parseEquipmentOperationCommand({ ...command, commandKind: 'give' })).toThrow('give must target a Pokémon')
    expect(parseEquipmentOperationResult({
      schemaVersion: 1, operationId: command.operationId, commandKind: 'equip', status: 'accepted', exactReplay: false,
      canonicalItemId: 'Light Armor', equippedInstanceId: `equipped-item:v1:${'a'.repeat(32)}`,
      displacedCanonicalItemId: null,
      resources: [{ kind: 'sheet', sheetKind: 'trainer', slug: 'ash', beforeRevision: 4, afterRevision: 5 }],
    })).toMatchObject({ status: 'accepted', exactReplay: false })
  })

  it('equips one whole item atomically in one owning Trainer revision and exact-replays silently', () => {
    const database = open()
    seedTrainer(database, { equipment: [{ id: 'armor-row', name: 'Light Armor', qty: 12 }] })
    const publish = vi.fn()
    const command = equipCommand()
    const first = executeEquipmentOperation({ role: 'gm', command }, {
      database, now: () => 500, publishPersistedRealtimeEvent: publish,
    })
    expect(first.result).toMatchObject({
      status: 'accepted', exactReplay: false, canonicalItemId: 'Light Armor',
      resources: [{ kind: 'sheet', sheetKind: 'trainer', slug: 'ash', beforeRevision: 4, afterRevision: 5 }],
    })
    const stored = sheet(database, 'trainer', 'ash')
    expect(stored.revision).toBe(5)
    expect((stored.sheet.inventory as any).equipment).toEqual([])
    const state = parseSheetEquipmentStateForOwner(stored.sheet.equipmentState, { kind: 'trainer', slug: 'ash' })
    expect(state).toMatchObject({
      revision: 1,
      slots: expect.arrayContaining([{ slotId: 'body', instanceId: first.result.equippedInstanceId }]),
      instances: [{
        canonicalItemId: 'Light Armor', revision: 0, activity: { status: 'active', reasons: [] },
        source: { rowId: 'armor-row', sourceRevision: 4, quantity: 1 },
      }],
    })
    expect(createSqliteEquipmentOperationRepository({ database }).get(command.operationId)).not.toBeNull()
    expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 20 }).events).toHaveLength(2)

    const replay = executeEquipmentOperation({ role: 'gm', command }, {
      database, now: () => 999, publishPersistedRealtimeEvent: publish,
    })
    expect(replay.result.exactReplay).toBe(true)
    expect(sheet(database, 'trainer', 'ash').revision).toBe(5)
    expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 20 }).events).toHaveLength(2)
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('refuses to move a whole item reserved by a pending item decision', () => {
    const database = open()
    seedTrainer(database, { equipment: [{ id: 'armor-row', name: 'Light Armor' }] })
    const command = equipCommand({ operationId: op('9') })

    expect(() => executeEquipmentOperation({ role: 'gm', command }, {
      database,
      itemOperationRepository: { database, reservedQuantity: () => 1 },
      now: () => 500,
    })).toThrow('does not have an unreserved whole item available')
    expect(sheet(database, 'trainer', 'ash').revision).toBe(4)
    expect((sheet(database, 'trainer', 'ash').sheet.inventory as any).equipment)
      .toEqual([{ id: 'armor-row', name: 'Light Armor' }])
  })

  it.each([
    ['Flame Orb', 'Burned'],
    ['Toxic Orb', 'Poisoned'],
  ] as const)('commits %s equip-triggered persistent condition in the same sheet CAS', (item, condition) => {
    const database = open()
    seedTrainer(database, { pokemonItems: [{ id: 'orb-row', name: item, qty: 1 }] })
    seedPokemon(database)
    const command = equipCommand({
      operationId: item === 'Flame Orb' ? op('c') : op('d'),
      itemRowId: 'orb-row', itemSection: 'pokemonItems', sheetRevision: 4,
      ownerKind: 'pokemon', ownerSlug: 'pikachu', ownerSheetRevision: 2,
      slots: ['held'], kind: 'give',
    })
    const accepted = executeEquipmentOperation({ role: 'gm', command }, { database, now: () => 510 })
    expect(accepted.result.status).toBe('accepted')
    expect(((sheet(database, 'pokemon', 'pikachu').sheet.combat as any).conditions)).toContain(condition)
    const replay = executeEquipmentOperation({ role: 'gm', command }, { database, now: () => 999 })
    expect(replay.result.exactReplay).toBe(true)
    expect(((sheet(database, 'pokemon', 'pikachu').sheet.combat as any).conditions)
      .filter((entry: string) => entry === condition)).toHaveLength(1)
  })

  it('preserves stable serialized identity, revision, and bounded item state across equip and return', () => {
    const database = open()
    const definition = equipmentDefinitionFor('Light Armor')!
    const instanceId = `equipped-item:v1:${'7'.repeat(32)}`
    seedTrainer(database, { equipment: [{
      id: 'serialized-armor', name: 'Light Armor', qty: 99,
      serializedEquipment: {
        schemaVersion: 1,
        instanceId,
        revision: 7,
        canonicalItemId: 'Light Armor',
        canonicalRecordSha256: definition.canonicalRecordSha256,
        equipmentDefinitionSha256: equipmentDefinitionSha256('Light Armor'),
        configuration: null,
        state: { durability: { current: 42, maximum: 50 } },
      },
    }] as any })
    const equipped = executeEquipmentOperation({ role: 'gm', command: equipCommand({ itemRowId: 'serialized-armor' }) }, {
      database, now: () => 525,
    })
    expect(equipped.result.equippedInstanceId).toBe(instanceId)
    expect(parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    }).instances[0]).toMatchObject({
      instanceId,
      revision: 8,
      serializedState: { durability: { current: 42, maximum: 50 } },
    })
    executeEquipmentOperation({ role: 'gm', command: parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: op('7'), commandKind: 'unequip', actorProfileId: null,
      source: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash', instanceId,
        expectedSheetRevision: 5, expectedEquipmentRevision: 1, expectedInstanceRevision: 8,
      },
      destination: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment', expectedRevision: 5,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    }) }, { database, now: () => 526 })
    expect((sheet(database, 'trainer', 'ash').sheet.inventory as any).equipment[0].serializedEquipment).toMatchObject({
      instanceId,
      revision: 9,
      state: { durability: { current: 42, maximum: 50 } },
    })
  })

  it('durably suppresses and restores exact sources across unequip and re-equip custody', () => {
    const database = open()
    seedTrainer(database, { equipment: [{ id: 'armor-row', name: 'Light Armor' }] })
    const equipped = executeEquipmentOperation({ role: 'gm', command: equipCommand() }, { database, now: () => 530 })
    const reason = { code: 'equipment.suppression.narrative', sourceId: 'adjudication:test' }
    const suppress = activityCommand({
      operationId: op('2'), commandKind: 'suppress', sheetRevision: 5,
      equipmentRevision: 1, instanceRevision: 0,
      reasonCode: reason.code, reasonSourceId: reason.sourceId,
    })
    const suppressed = executeEquipmentOperation({ role: 'gm', command: suppress }, { database, now: () => 531 })
    expect(suppressed.result).toMatchObject({ commandKind: 'suppress', exactReplay: false })
    const suppressedState = parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    })
    expect(suppressedState.instances[0]).toMatchObject({
      revision: 1,
      activity: { status: 'suppressed', reasons: [reason] },
    })
    expect(resolveEquipmentContributions({
      equipmentState: suppressedState,
      owner: { kind: 'trainer', slug: 'ash', speciesId: null, transformed: false },
    })).toMatchObject({ active: [], inactive: [expect.objectContaining({ canonicalItemId: 'Light Armor' })] })
    expect(executeEquipmentOperation({ role: 'gm', command: suppress }, { database, now: () => 999 })
      .result.exactReplay).toBe(true)

    const profile = {
      schemaVersion: 1, id: 'profile_lifecycle', displayName: 'Ash',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
    } as PlayerProfile
    const playerCommand = activityCommand({
      operationId: op('3'), commandKind: 'restore', sheetRevision: 6,
      equipmentRevision: 2, instanceRevision: 1,
      reasonCode: reason.code, reasonSourceId: reason.sourceId, actorProfileId: profile.id,
    })
    expect(() => executeEquipmentOperation({ role: 'player', playerProfile: profile, command: playerCommand }, { database }))
      .toThrow('Only the GM can adjudicate equipment suppression')

    const unequip = parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: op('4'), commandKind: 'unequip', actorProfileId: null,
      source: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash', instanceId: equipped.result.equippedInstanceId,
        expectedSheetRevision: 6, expectedEquipmentRevision: 2, expectedInstanceRevision: 1,
      },
      destination: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment', expectedRevision: 6,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    })
    executeEquipmentOperation({ role: 'gm', command: unequip }, { database, now: () => 532 })
    const returned = (sheet(database, 'trainer', 'ash').sheet.inventory as any).equipment[0]
    expect(returned.serializedEquipment).toMatchObject({
      instanceId: equipped.result.equippedInstanceId,
      revision: 2,
      activity: { status: 'suppressed', reasons: [reason] },
    })

    executeEquipmentOperation({ role: 'gm', command: parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: op('5'), commandKind: 'equip', actorProfileId: null,
      source: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment', rowId: returned.id,
        sourceInstanceId: sourceId('ash', 'equipment', returned.id), expectedRevision: 7,
      },
      destination: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash', slotIds: ['body'],
        expectedSheetRevision: 7, expectedEquipmentRevision: 3,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    }) }, { database, now: () => 533 })
    expect(parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    }).instances[0]).toMatchObject({
      instanceId: equipped.result.equippedInstanceId,
      revision: 3,
      activity: { status: 'suppressed', reasons: [reason] },
    })

    executeEquipmentOperation({ role: 'gm', command: activityCommand({
      operationId: op('6'), commandKind: 'restore', sheetRevision: 8,
      equipmentRevision: 4, instanceRevision: 3,
      reasonCode: reason.code, reasonSourceId: reason.sourceId,
    }) }, { database, now: () => 534 })
    const restoredState = parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    })
    expect(restoredState.instances[0]).toMatchObject({ revision: 4, activity: { status: 'active', reasons: [] } })
    expect(resolveEquipmentContributions({
      equipmentState: restoredState,
      owner: { kind: 'trainer', slug: 'ash', speciesId: null, transformed: false },
    }).active.some(source => source.canonicalItemId === 'Light Armor')).toBe(true)
  })

  it('preserves concurrent lifecycle sources and restores them one exact reason at a time', () => {
    const database = open()
    seedTrainer(database, { equipment: [{ id: 'armor-row', name: 'Light Armor' }] })
    executeEquipmentOperation({ role: 'gm', command: equipCommand() }, { database, now: () => 535 })
    executeEquipmentOperation({ role: 'gm', command: activityCommand({
      operationId: op('2'), commandKind: 'suppress', sheetRevision: 5,
      equipmentRevision: 1, instanceRevision: 0,
      reasonCode: 'equipment.suppression.guided', reasonSourceId: 'source:suppression',
    }) }, { database, now: () => 536 })
    executeEquipmentOperation({ role: 'gm', command: activityCommand({
      operationId: op('3'), commandKind: 'break', sheetRevision: 6,
      equipmentRevision: 2, instanceRevision: 1,
      reasonCode: 'equipment.breakage.narrative', reasonSourceId: 'source:breakage',
    }) }, { database, now: () => 537 })
    let state = parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    })
    expect(state.instances[0]?.activity).toMatchObject({
      status: 'broken',
      reasons: expect.arrayContaining([
        { code: 'equipment.suppression.guided', sourceId: 'source:suppression' },
        { code: 'equipment.breakage.narrative', sourceId: 'source:breakage' },
      ]),
    })

    executeEquipmentOperation({ role: 'gm', command: activityCommand({
      operationId: op('4'), commandKind: 'repair', sheetRevision: 7,
      equipmentRevision: 3, instanceRevision: 2,
      reasonCode: 'equipment.breakage.narrative', reasonSourceId: 'source:breakage',
    }) }, { database, now: () => 538 })
    state = parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    })
    expect(state.instances[0]?.activity).toEqual({
      status: 'suppressed',
      reasons: [{ code: 'equipment.suppression.guided', sourceId: 'source:suppression' }],
    })
    executeEquipmentOperation({ role: 'gm', command: activityCommand({
      operationId: op('5'), commandKind: 'restore', sheetRevision: 8,
      equipmentRevision: 4, instanceRevision: 3,
      reasonCode: 'equipment.suppression.guided', reasonSourceId: 'source:suppression',
    }) }, { database, now: () => 539 })
    state = parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    })
    expect(state.instances[0]?.activity).toEqual({ status: 'active', reasons: [] })
  })

  it('initializes reviewed durability, breaks exactly at zero, repairs numerically, and fails closed otherwise', () => {
    const database = open()
    seedTrainer(database, { equipment: [{ id: 'net-row', name: 'Hand Net' }] })
    const base = equipCommand({ itemRowId: 'net-row', slots: ['mainHand', 'offHand'] })
    const equipped = executeEquipmentOperation({ role: 'gm', command: parseEquipmentOperationCommand({
      ...base,
      operationId: op('a'),
      configuration: {
        schemaVersion: 1,
        configurationId: 'equipment.hand-net.v1',
        values: { durabilityMaximum: 50 },
      },
    }) }, { database, now: () => 540 })
    let instance = parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    }).instances[0]!
    expect(instance).toMatchObject({
      activity: { status: 'active', reasons: [] },
      serializedState: { equipmentDurability: { schemaVersion: 1, current: 50, maximum: 50 } },
    })

    executeEquipmentOperation({ role: 'gm', command: durabilityCommand({
      operationId: op('b'), commandKind: 'damage', amount: 49,
      sheetRevision: 5, equipmentRevision: 1, instanceRevision: 0,
    }) }, { database, now: () => 541 })
    instance = parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    }).instances[0]!
    expect(instance).toMatchObject({
      revision: 1, activity: { status: 'active', reasons: [] },
      serializedState: { equipmentDurability: { current: 1, maximum: 50 } },
    })

    const breakCommand = durabilityCommand({
      operationId: op('c'), commandKind: 'damage', amount: 1,
      sheetRevision: 6, equipmentRevision: 2, instanceRevision: 1,
    })
    executeEquipmentOperation({ role: 'gm', command: breakCommand }, { database, now: () => 542 })
    instance = parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    }).instances[0]!
    expect(instance).toMatchObject({
      revision: 2,
      activity: {
        status: 'broken',
        reasons: [{ code: 'equipment.breakage.durability', sourceId: equipped.result.equippedInstanceId }],
      },
      serializedState: { equipmentDurability: { current: 0, maximum: 50 } },
    })
    expect(executeEquipmentOperation({ role: 'gm', command: breakCommand }, { database, now: () => 999 })
      .result.exactReplay).toBe(true)

    executeEquipmentOperation({ role: 'gm', command: durabilityCommand({
      operationId: op('d'), commandKind: 'restore-durability', amount: 10,
      sheetRevision: 7, equipmentRevision: 3, instanceRevision: 2,
    }) }, { database, now: () => 543 })
    instance = parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    }).instances[0]!
    expect(instance).toMatchObject({
      revision: 3, activity: { status: 'active', reasons: [] },
      serializedState: { equipmentDurability: { current: 10, maximum: 50 } },
    })

    const unsupported = open()
    seedTrainer(unsupported, { equipment: [{ id: 'armor-row', name: 'Light Armor' }] })
    executeEquipmentOperation({ role: 'gm', command: equipCommand() }, { database: unsupported, now: () => 550 })
    expect(() => executeEquipmentOperation({ role: 'gm', command: durabilityCommand({
      operationId: op('e'), commandKind: 'damage', amount: 1,
      sheetRevision: 5, equipmentRevision: 1, instanceRevision: 0,
    }) }, { database: unsupported, now: () => 551 })).toThrow('no reviewed durability state')
    expect(sheet(unsupported, 'trainer', 'ash').revision).toBe(5)
    expect(createSqliteEquipmentOperationRepository({ database: unsupported }).get(op('e'))).toBeNull()
  })

  it('rejects an unsafe serialized revision increment without moving custody', () => {
    const database = open()
    const definition = equipmentDefinitionFor('Light Armor')!
    const serializedEquipment = {
      schemaVersion: 1 as const,
      instanceId: `equipped-item:v1:${'8'.repeat(32)}`,
      revision: Number.MAX_SAFE_INTEGER,
      canonicalItemId: 'Light Armor',
      canonicalRecordSha256: definition.canonicalRecordSha256,
      equipmentDefinitionSha256: equipmentDefinitionSha256('Light Armor'),
      configuration: null,
      activity: { status: 'active' as const, reasons: [] },
      state: { durability: 1 },
    }
    seedTrainer(database, { equipment: [{
      id: 'serialized-armor', name: 'Light Armor', serializedEquipment,
    }] as any })
    expect(() => executeEquipmentOperation({
      role: 'gm', command: equipCommand({ itemRowId: 'serialized-armor' }),
    }, { database, now: () => 527 })).toThrow('cannot advance within the safe integer range')
    expect((sheet(database, 'trainer', 'ash').sheet.inventory as any).equipment).toEqual([
      { id: 'serialized-armor', name: 'Light Armor', serializedEquipment },
    ])
  })

  it('binds a required configuration to its current reviewed definition and rejects invalid values atomically', () => {
    const database = open()
    seedTrainer(database, { equipment: [{ id: 'focus-row', name: 'Focus' }] })
    const valid = equipCommand({ itemRowId: 'focus-row', slots: ['mainHand'] })
    const configured = parseEquipmentOperationCommand({
      ...valid,
      operationId: op('b'),
      configuration: {
        schemaVersion: 1,
        configurationId: 'equipment.focus.v1',
        values: { statId: 'atk' },
      },
    })
    executeEquipmentOperation({ role: 'gm', command: configured }, { database, now: () => 550 })
    const state = parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    })
    expect(state.instances[0]?.configuration).toMatchObject({
      schemaVersion: 1,
      configurationId: 'equipment.focus.v1',
      definitionSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      values: { statId: 'atk' },
    })
    const stableInstanceId = state.instances[0]!.instanceId
    executeEquipmentOperation({ role: 'gm', command: parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: op('0'), commandKind: 'unequip', actorProfileId: null,
      source: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash', instanceId: stableInstanceId,
        expectedSheetRevision: 5, expectedEquipmentRevision: 1, expectedInstanceRevision: 0,
      },
      destination: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment', expectedRevision: 5,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    }) }, { database, now: () => 551 })
    const returned = (sheet(database, 'trainer', 'ash').sheet.inventory as any).equipment[0]
    expect(returned.serializedEquipment).toMatchObject({
      instanceId: stableInstanceId,
      revision: 1,
      configuration: { configurationId: 'equipment.focus.v1', values: { statId: 'atk' } },
    })
    const reEquipped = executeEquipmentOperation({ role: 'gm', command: parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: op('f'), commandKind: 'equip', actorProfileId: null,
      source: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment', rowId: returned.id,
        sourceInstanceId: sourceId('ash', 'equipment', returned.id), expectedRevision: 6,
      },
      destination: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash', slotIds: ['mainHand'],
        expectedSheetRevision: 6, expectedEquipmentRevision: 2,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    }) }, { database, now: () => 552 })
    expect(reEquipped.result.equippedInstanceId).toBe(stableInstanceId)
    expect(parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    }).instances[0]).toMatchObject({
      instanceId: stableInstanceId,
      revision: 2,
      configuration: { configurationId: 'equipment.focus.v1', values: { statId: 'atk' } },
    })

    const otherDatabase = open()
    seedTrainer(otherDatabase, { equipment: [{ id: 'focus-row', name: 'Focus' }] })
    const invalid = parseEquipmentOperationCommand({
      ...valid,
      operationId: op('c'),
      configuration: {
        schemaVersion: 1,
        configurationId: 'equipment.focus.v1',
        values: { statId: 'not-a-stat' },
      },
    })
    expect(() => executeEquipmentOperation({ role: 'gm', command: invalid }, { database: otherDatabase, now: () => 551 }))
      .toThrow('configuration is not valid')
    expect((sheet(otherDatabase, 'trainer', 'ash').sheet.inventory as any).equipment).toEqual([
      { id: 'focus-row', name: 'Focus' },
    ])
    expect(createSqliteEquipmentOperationRepository({ database: otherDatabase }).get(invalid.operationId)).toBeNull()
  })

  it('locks the exact Ring and Stone backing an active Mega Evolution until its Scene ends', () => {
    const database = open()
    const map = createFormChangeMap()
    const pokemon = createFormChangePokemon()
    const trainer = createFormChangeTrainer()
    const candidate = resolveItemFormChangeCandidate({
      map,
      actorPlacementId: 'mega-trainer-token',
      targetPlacementId: 'mega-charizard-token',
      sheets: {
        pokemon: new Map([[pokemon.slug, pokemon]]),
        trainer: new Map([[trainer.slug, trainer]]),
      },
    })
    const activeMap = applyItemFormChangeCandidate({
      map, candidate, operationId: 'operation-active-mega', acceptedAt: 5_200,
    })
    const maps = createSqliteMapRepository<TabletopMap>(database)
    maps.save({ slug: map.slug, document: activeMap, revision: 7, updatedAt: 5_200 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({
      kind: 'trainer', slug: trainer.slug, document: trainer as unknown as Record<string, unknown>,
      revision: 3, updatedAt: 5_100,
    })
    sheets.save({
      kind: 'pokemon', slug: pokemon.slug, document: pokemon as unknown as Record<string, unknown>,
      revision: 4, updatedAt: 5_100,
    })
    const ringCommand = parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: op('8'), commandKind: 'unequip', actorProfileId: null,
      source: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: trainer.slug,
        instanceId: candidate.ringSource.instanceId,
        expectedSheetRevision: 3, expectedEquipmentRevision: 0, expectedInstanceRevision: 0,
      },
      destination: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: trainer.slug,
        section: 'equipment', expectedRevision: 3,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    })
    const stoneCommand = parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: op('9'), commandKind: 'take', actorProfileId: null,
      source: {
        kind: 'equipment', ownerKind: 'pokemon', ownerSlug: pokemon.slug,
        instanceId: candidate.stoneSource!.instanceId,
        expectedSheetRevision: 4, expectedEquipmentRevision: 0, expectedInstanceRevision: 0,
      },
      destination: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: trainer.slug,
        section: 'pokemonItems', expectedRevision: 3,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    })
    expect(() => executeEquipmentOperation({ role: 'gm', command: ringCommand }, { database, now: () => 5_300 }))
      .toThrow(/backing an active Mega Evolution/i)
    expect(() => executeEquipmentOperation({ role: 'gm', command: stoneCommand }, { database, now: () => 5_300 }))
      .toThrow(/backing an active Mega Evolution/i)
    expect(sheet(database, 'trainer', trainer.slug).revision).toBe(3)
    expect(sheet(database, 'pokemon', pokemon.slug).revision).toBe(4)

    const deltaMap: TabletopMap = {
      ...activeMap,
      revision: 8,
      encounterState: {
        ...activeMap.encounterState!,
        itemFormChanges: { schemaVersion: 1, entries: [] },
      },
      metadata: {
        ...(activeMap.metadata ?? {}),
        capabilityMegaEvolutionUses: [{
          trainerSlug: trainer.slug,
          actorPlacementId: 'mega-charizard-token',
          sceneStartedAt: activeMap.activeScene!.startedAt,
          sourceOperationId: 'operation-delta-mega',
          ringInstanceId: candidate.ringSource.instanceId,
          ringInstanceRevision: 0,
        }],
      },
    }
    expect(maps.applyLivePlayUpdate({ slug: map.slug, expectedRevision: 7, nextMap: deltaMap })).toBe('applied')
    expect(() => executeEquipmentOperation({ role: 'gm', command: ringCommand }, { database, now: () => 5_350 }))
      .toThrow(/backing an active Mega Evolution/i)

    const endedMap: TabletopMap = { ...deltaMap, revision: 9 }
    delete endedMap.activeScene
    expect(maps.applyLivePlayUpdate({ slug: map.slug, expectedRevision: 8, nextMap: endedMap })).toBe('applied')
    expect(executeEquipmentOperation({ role: 'gm', command: ringCommand }, { database, now: () => 5_400 }).result)
      .toMatchObject({ status: 'accepted', canonicalItemId: 'Mega Ring' })
  })

  it('unequips to the exact available source row identity without loss or duplication', () => {
    const database = open()
    seedTrainer(database, { equipment: [{ id: 'armor-row', name: 'Light Armor' }] })
    const equipped = executeEquipmentOperation({ role: 'gm', command: equipCommand() }, { database, now: () => 500 })
    const command = parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: op('2'), commandKind: 'unequip', actorProfileId: null,
      source: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash', instanceId: 'equipment-projection:v1:0',
        expectedSheetRevision: 5, expectedEquipmentRevision: 1, expectedInstanceRevision: 0,
      },
      destination: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment', expectedRevision: 5,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    })
    const result = executeEquipmentOperation({ role: 'gm', command }, { database, now: () => 600 })
    expect(result.result).toMatchObject({ commandKind: 'unequip', equippedInstanceId: null, canonicalItemId: 'Light Armor' })
    const stored = sheet(database, 'trainer', 'ash')
    expect(stored.revision).toBe(6)
    expect((stored.sheet.inventory as any).equipment).toEqual([
      expect.objectContaining({
        id: 'armor-row', name: 'Light Armor',
        serializedEquipment: expect.objectContaining({
          instanceId: equipped.result.equippedInstanceId,
          revision: 1,
          canonicalItemId: 'Light Armor',
          state: {},
        }),
      }),
    ])
    expect(parseSheetEquipmentStateForOwner(stored.sheet.equipmentState, { kind: 'trainer', slug: 'ash' })).toMatchObject({
      revision: 2, instances: [], slots: expect.arrayContaining([{ slotId: 'body', instanceId: null }]),
    })
  })

  it('moves one whole item from GM-controlled group inventory into Trainer equipment atomically', () => {
    const database = open()
    seedTrainer(database)
    const groups = createSqliteGroupInventoryRepository(database)
    const base = createDefaultGroupInventoryDocument({ slug: 'main', now: 100 })
    groups.save({
      slug: 'main', revision: 2, updatedAt: 100,
      document: {
        ...base, revision: 2, updatedAt: 100,
        inventory: { ...base.inventory, equipment: [{ id: 'group-armor', name: 'Light Armor' }] },
      },
    })
    const command = parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: op('d'), commandKind: 'equip', actorProfileId: null,
      source: {
        kind: 'inventory', containerKind: 'group', containerSlug: 'main', section: 'equipment', rowId: 'group-armor',
        sourceInstanceId: itemInventoryInstanceId({
          containerKind: 'group', containerSlug: 'main', section: 'equipment', rowId: 'group-armor',
        }),
        expectedRevision: 2,
      },
      destination: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash', slotIds: ['body'],
        expectedSheetRevision: 4, expectedEquipmentRevision: 0,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    })
    const profile = {
      schemaVersion: 1,
      id: 'profile_groupdeny',
      displayName: 'Ash',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
    } as PlayerProfile
    const playerCommand = parseEquipmentOperationCommand({ ...command, operationId: op('e'), actorProfileId: profile.id })
    expect(() => executeEquipmentOperation({ role: 'player', playerProfile: profile, command: playerCommand }, { database }))
      .toThrow('Players cannot move equipment into or out of shared group inventory.')
    expect(groups.get('main')?.document.inventory.equipment).toHaveLength(1)

    const accepted = executeEquipmentOperation({ role: 'gm', command }, { database, now: () => 650 })
    expect(accepted.result.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'group-inventory', slug: 'main', beforeRevision: 2, afterRevision: 3 }),
      expect.objectContaining({ kind: 'sheet', sheetKind: 'trainer', slug: 'ash', beforeRevision: 4, afterRevision: 5 }),
    ]))
    expect(groups.get('main')?.document.inventory.equipment).toEqual([])
    expect(parseSheetEquipmentStateForOwner(sheet(database, 'trainer', 'ash').sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    }).instances[0]?.source).toMatchObject({ containerKind: 'group', containerSlug: 'main', rowId: 'group-armor' })
  })

  it('gives and takes a held item across controlled Trainer and Pokémon documents atomically', () => {
    const database = open()
    seedTrainer(database, { pokemonItems: [{ id: 'claw-row', name: 'Quick Claw', qty: 2 }] })
    seedPokemon(database)
    const give = equipCommand({
      operationId: op('3'), kind: 'give', itemRowId: 'claw-row', itemSection: 'pokemonItems',
      ownerKind: 'pokemon', ownerSlug: 'pikachu', ownerSheetRevision: 2, slots: ['held'],
    })
    const given = executeEquipmentOperation({ role: 'gm', command: give }, { database, now: () => 700 })
    expect(given.result.resources).toHaveLength(2)
    expect((sheet(database, 'trainer', 'ash').sheet.inventory as any).pokemonItems).toEqual([
      { id: 'claw-row', name: 'Quick Claw', qty: 1 },
    ])
    const pokemonAfterGive = sheet(database, 'pokemon', 'pikachu')
    expect(parseSheetEquipmentStateForOwner(pokemonAfterGive.sheet.equipmentState, { kind: 'pokemon', slug: 'pikachu' })).toMatchObject({
      revision: 1, instances: [{ canonicalItemId: 'Quick Claw', activity: { status: 'active' } }],
    })

    const take = parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: op('4'), commandKind: 'take', actorProfileId: null,
      source: {
        kind: 'equipment', ownerKind: 'pokemon', ownerSlug: 'pikachu', instanceId: given.result.equippedInstanceId,
        expectedSheetRevision: 3, expectedEquipmentRevision: 1, expectedInstanceRevision: 0,
      },
      destination: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'pokemonItems', expectedRevision: 5,
      },
      replacedInstanceId: null, swapReturnDestination: null, configuration: null,
    })
    const taken = executeEquipmentOperation({ role: 'gm', command: take }, { database, now: () => 800 })
    expect(taken.result.commandKind).toBe('take')
    expect((sheet(database, 'trainer', 'ash').sheet.inventory as any).pokemonItems).toEqual([
      { id: 'claw-row', name: 'Quick Claw', qty: 1 },
      expect.objectContaining({
        id: expect.stringMatching(/^equipment-return-v1-/), name: 'Quick Claw',
        serializedEquipment: expect.objectContaining({
          instanceId: given.result.equippedInstanceId,
          revision: 1,
          canonicalItemId: 'Quick Claw',
        }),
      }),
    ])
    expect(parseSheetEquipmentStateForOwner(sheet(database, 'pokemon', 'pikachu').sheet.equipmentState, {
      kind: 'pokemon', slug: 'pikachu',
    }).instances).toEqual([])
  })

  it('swaps old and incoming whole items in one revision without a dual-active intermediate state', () => {
    const database = open()
    seedTrainer(database, { equipment: [
      { id: 'armor-row', name: 'Light Armor' },
      { id: 'heavy-row', name: 'Heavy Armor' },
    ] })
    const equipped = executeEquipmentOperation({ role: 'gm', command: equipCommand() }, { database, now: () => 500 })
    const command = parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: op('5'), commandKind: 'swap', actorProfileId: null,
      source: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment', rowId: 'heavy-row',
        sourceInstanceId: sourceId('ash', 'equipment', 'heavy-row'), expectedRevision: 5,
      },
      destination: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash', slotIds: ['body'],
        expectedSheetRevision: 5, expectedEquipmentRevision: 1,
      },
      replacedInstanceId: equipped.result.equippedInstanceId,
      swapReturnDestination: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment', expectedRevision: 5,
      },
      configuration: null,
    })
    const swapped = executeEquipmentOperation({ role: 'gm', command }, { database, now: () => 600 })
    expect(swapped.result).toMatchObject({
      commandKind: 'swap', canonicalItemId: 'Heavy Armor', displacedCanonicalItemId: 'Light Armor',
      resources: [{ beforeRevision: 5, afterRevision: 6 }],
    })
    const stored = sheet(database, 'trainer', 'ash')
    expect((stored.sheet.inventory as any).equipment).toEqual([
      expect.objectContaining({
        id: 'armor-row', name: 'Light Armor',
        serializedEquipment: expect.objectContaining({
          instanceId: equipped.result.equippedInstanceId,
          revision: 1,
          canonicalItemId: 'Light Armor',
        }),
      }),
    ])
    const state = parseSheetEquipmentStateForOwner(stored.sheet.equipmentState, { kind: 'trainer', slug: 'ash' })
    expect(state.instances).toHaveLength(1)
    expect(state.instances[0]?.canonicalItemId).toBe('Heavy Armor')
    expect(state.slots.find(slot => slot.slotId === 'body')?.instanceId).toBe(swapped.result.equippedInstanceId)
  })

  it('rejects a swap unless the displaced whole item occupies a requested destination slot', () => {
    const database = open()
    seedTrainer(database, { equipment: [
      { id: 'armor-row', name: 'Light Armor' },
      { id: 'claw-row', name: 'Quick Claw' },
    ] })
    const equipped = executeEquipmentOperation({ role: 'gm', command: equipCommand() }, { database, now: () => 500 })
    const invalidSwap = parseEquipmentOperationCommand({
      schemaVersion: 1, operationId: op('a'), commandKind: 'swap', actorProfileId: null,
      source: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment', rowId: 'claw-row',
        sourceInstanceId: sourceId('ash', 'equipment', 'claw-row'), expectedRevision: 5,
      },
      destination: {
        kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash', slotIds: ['accessory'],
        expectedSheetRevision: 5, expectedEquipmentRevision: 1,
      },
      replacedInstanceId: equipped.result.equippedInstanceId,
      swapReturnDestination: {
        kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment', expectedRevision: 5,
      },
      configuration: null,
    })
    expect(() => executeEquipmentOperation({ role: 'gm', command: invalidSwap }, { database, now: () => 600 }))
      .toThrow('does not occupy a requested destination slot')
    const stored = sheet(database, 'trainer', 'ash')
    expect(stored.revision).toBe(5)
    expect((stored.sheet.inventory as any).equipment).toEqual([{ id: 'claw-row', name: 'Quick Claw' }])
    expect(parseSheetEquipmentStateForOwner(stored.sheet.equipmentState, { kind: 'trainer', slug: 'ash' })
      .instances[0]?.instanceId).toBe(equipped.result.equippedInstanceId)
  })

  it('fails before inventory movement for incompatibility, stale revisions, and operation-ID drift', () => {
    const database = open()
    seedTrainer(database, { equipment: [{ id: 'bat-row', name: 'Baseball Bat' }, { id: 'armor-row', name: 'Light Armor' }] })
    const incompatible = equipCommand({ itemRowId: 'bat-row', slots: ['mainHand'] })
    expect(() => executeEquipmentOperation({ role: 'gm', command: incompatible }, { database, now: () => 500 }))
      .toThrow('This item cannot occupy Main Hand.')
    expect((sheet(database, 'trainer', 'ash').sheet.inventory as any).equipment).toHaveLength(2)
    expect(createSqliteEquipmentOperationRepository({ database }).get(incompatible.operationId)).toBeNull()

    const accepted = equipCommand({ operationId: op('6') })
    executeEquipmentOperation({ role: 'gm', command: accepted }, { database, now: () => 600 })
    expect(() => executeEquipmentOperation({ role: 'gm', command: { ...accepted, configuration: {
      schemaVersion: 1, configurationId: 'equipment.focus.v1', values: { statId: 'atk' },
    } } }, { database, now: () => 700 })).toThrow('reused for a different command')
    const stale = equipCommand({ operationId: op('7'), itemRowId: 'bat-row', sheetRevision: 4, slots: ['mainHand', 'offHand'] })
    expect(() => executeEquipmentOperation({ role: 'gm', command: stale }, { database })).toThrow('changed. Refresh')
  })

  it('rolls back every resource, operation row, and realtime event if a later resource write fails', () => {
    const database = open()
    seedTrainer(database, { pokemonItems: [{ id: 'claw-row', name: 'Quick Claw', qty: 1 }] })
    seedPokemon(database)
    const base = createSqliteSheetRepository<Record<string, unknown>>(database)
    let writes = 0
    const sheetRepository = {
      database,
      getByRef: base.getByRef,
      list: base.list,
      applyLivePlayUpdate: (input: Parameters<typeof base.applyLivePlayUpdate>[0]) => {
        writes += 1
        const result = base.applyLivePlayUpdate(input)
        if (writes === 2) throw new Error('interrupt after second sheet write')
        return result
      },
    }
    const command = equipCommand({
      operationId: op('9'), kind: 'give', itemRowId: 'claw-row', itemSection: 'pokemonItems',
      ownerKind: 'pokemon', ownerSlug: 'pikachu', ownerSheetRevision: 2, slots: ['held'],
    })
    expect(() => executeEquipmentOperation({ role: 'gm', command }, { database, sheetRepository }))
      .toThrow('interrupt after second sheet write')
    expect(sheet(database, 'trainer', 'ash').revision).toBe(4)
    expect(sheet(database, 'pokemon', 'pikachu').revision).toBe(2)
    expect((sheet(database, 'trainer', 'ash').sheet.inventory as any).pokemonItems).toEqual([
      { id: 'claw-row', name: 'Quick Claw', qty: 1 },
    ])
    expect(createSqliteEquipmentOperationRepository({ database }).get(command.operationId)).toBeNull()
    expect(createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 20 }).events).toEqual([])
  })

  it('enforces current player control across both source and destination sheets', () => {
    const database = open()
    seedTrainer(database, { pokemonItems: [{ id: 'claw-row', name: 'Quick Claw', qty: 1 }] })
    seedPokemon(database)
    const profile = {
      schemaVersion: 1,
      id: 'profile_abcdefgh',
      displayName: 'Ash',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
    } as PlayerProfile
    const command = equipCommand({
      operationId: op('8'), kind: 'give', itemRowId: 'claw-row', itemSection: 'pokemonItems',
      ownerKind: 'pokemon', ownerSlug: 'pikachu', ownerSheetRevision: 2, slots: ['held'],
      actorProfileId: profile.id,
    })
    expect(executeEquipmentOperation({ role: 'player', playerProfile: profile, command }, { database }).result.status).toBe('accepted')

    const wrongProfile = { ...profile, id: 'profile_ijklmnop' } as PlayerProfile
    expect(() => executeEquipmentOperation({ role: 'player', playerProfile: wrongProfile, command }, { database }))
      .toThrow(ExecuteEquipmentOperationUseCaseError)
  })
})
