import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import migrationEvidence from '~~/data/complete-play-loop/equipment-migration.v1.json'
import { parseSheetEquipmentStateForOwner } from '#shared/itemAutomation/equipment'
import { equipmentDefinitionSha256 } from '~~/server/domain/itemAutomation/equipmentDefinitionRegistry'
import { migrateLegacyEquipmentDocuments } from '~~/server/domain/itemAutomation/equipmentMigration'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'

const databases: RotomDatabase[] = []
const tempRoots: string[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  return database
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true })
})

describe('legacy equipment document migration', () => {
  it('binds deterministic migration policy to the exact app-owned canonical catalog', () => {
    const catalogSha256 = createHash('sha256').update(readFileSync('data/reference/items.json')).digest('hex')
    const equipmentContractSha256 = createHash('sha256')
      .update(readFileSync('data/complete-play-loop/equipment-contract.v1.json'))
      .digest('hex')
    expect(migrationEvidence).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-042',
      canonicalItemCatalogSha256: catalogSha256,
      equipmentContractSha256,
      runtime: {
        implementation: 'server/domain/itemAutomation/equipmentMigration.ts',
        sqliteSchemaVersionUnchanged: 32,
        idempotencyMarker: 'valid owner-bound equipmentState schemaVersion 1',
      },
      conversion: {
        legacyValuesCopiedIntoExplicitRecoveryEvidence: true,
        legacyEffectiveFieldsAfterMigration: expect.stringContaining('clear equipmentSlots values and items.held'),
        initialActivity: {
          status: 'inactive',
          reasonCode: 'equipment.definition-pending',
          equipmentDefinitionSha256: null,
        },
      },
      unresolved: { mechanicallyEffective: false },
      failurePolicy: { partialMigration: false },
      normalization: { descriptiveFieldActivation: false },
    })
  })

  it('runs automatically when an existing campaign database is reopened', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-equipment-migration-'))
    tempRoots.push(root)
    const path = join(root, 'campaign.sqlite')
    const initial = openRotomDatabase({ path, enableWal: false })
    createSqliteSheetRepository<Record<string, unknown>>(initial).saveSetupSheet('pokemon', 'pikachu', {
      slug: 'pikachu', nickname: 'Pika', revision: 2, updatedAt: 50, items: { held: 'Quick Claw' },
    })
    initial.close()

    const reopened = openRotomDatabase({ path, enableWal: false })
    databases.push(reopened)
    const migrated = createSqliteSheetRepository<Record<string, unknown>>(reopened).getByRef('pokemon', 'pikachu')!
    expect(migrated).toMatchObject({
      revision: 3,
      updatedAt: 51,
      sheet: {
        items: {},
        equipmentState: {
          owner: { kind: 'pokemon', slug: 'pikachu' },
          instances: [],
          unresolved: [{
            slotId: 'held', legacyDisplayName: 'Quick Claw', reason: 'missing-source',
          }],
        },
      },
    })
  })

  it('moves one exact whole Trainer source into reviewed compatible state and is idempotent', () => {
    const database = open()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('trainer', 'ash', {
      slug: 'ash', name: 'Ash', revision: 4, updatedAt: 100,
      equipmentSlots: { body: 'Light Armor' },
      inventory: {
        equipment: [
          { name: 'Light Armor', qty: 12, description: 'Legacy whole-row gear' },
          { id: 'spare-rope', name: 'Rope', qty: 1 },
        ],
      },
    })

    const report = migrateLegacyEquipmentDocuments(database.connection)
    expect(report).toMatchObject({
      sheetsExamined: 1,
      sheetsInitialized: 1,
      effectiveInstancesMigrated: 1,
      unresolvedEntriesCreated: 0,
      inventoryRowsGivenStableIdentity: 1,
      legacyValuesRetired: 1,
      sourceItemsMoved: 1,
      changedSheets: [{ kind: 'trainer', slug: 'ash' }],
      changedGroupInventories: [],
    })
    const migrated = sheets.getByRef('trainer', 'ash')!
    expect(migrated).toMatchObject({ revision: 5, updatedAt: 101 })
    expect(migrated.sheet.equipmentSlots).toEqual({})
    expect(migrated.sheet.inventory).toMatchObject({
      equipment: [{ id: 'spare-rope', name: 'Rope' }],
    })
    const state = parseSheetEquipmentStateForOwner(migrated.sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    })
    expect(state).toMatchObject({
      schemaVersion: 1,
      revision: 0,
      owner: { kind: 'trainer', slug: 'ash' },
      slots: expect.arrayContaining([{ slotId: 'body', instanceId: expect.stringMatching(/^equipped-item:v1:/) }]),
      instances: [{
        revision: 0,
        canonicalItemId: 'Light Armor',
        equipmentDefinitionSha256: equipmentDefinitionSha256('Light Armor'),
        source: {
          kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment',
          rowId: expect.stringMatching(/^equipment-source-v1-/),
          sourceInstanceId: expect.stringMatching(/^item-instance:trainer:ash:equipment:/),
          sourceRevision: 4, quantity: 1,
        },
        configuration: null,
        activity: { status: 'active', reasons: [] },
        equippedByOperationId: expect.stringMatching(/^equipment-migration:v1:/),
        equippedAt: 100,
      }],
      unresolved: [],
    })
    expect(state.instances[0]?.canonicalRecordSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(state.slots.find(slot => slot.slotId === 'mainHand')?.instanceId).toBeNull()

    expect(migrateLegacyEquipmentDocuments(database.connection)).toMatchObject({
      sheetsInitialized: 0,
      effectiveInstancesMigrated: 0,
      unresolvedEntriesCreated: 0,
      inventoryRowsGivenStableIdentity: 0,
      legacyValuesRetired: 0,
      sourceItemsMoved: 0,
      changedSheets: [],
      changedGroupInventories: [],
    })
    expect(sheets.getByRef('trainer', 'ash')).toEqual(migrated)
  })

  it('binds a linked Pokémon held item to the exact Trainer stack and decrements one', () => {
    const database = open()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('trainer', 'ash', {
      slug: 'ash', name: 'Ash', revision: 2, updatedAt: 200,
      currentTeam: ['pikachu'], boxedPokemon: [],
      inventory: { pokemonItems: [{ id: 'quick-claw-stack', name: 'Quick Claw', qty: 2 }] },
    })
    sheets.saveSetupSheet('pokemon', 'pikachu', {
      slug: 'pikachu', nickname: 'Pika', species: 'Pikachu', level: 10,
      revision: 5, updatedAt: 250, items: { held: 'Quick Claw' },
    })

    const report = migrateLegacyEquipmentDocuments(database.connection)
    expect(report).toMatchObject({
      sheetsInitialized: 2,
      effectiveInstancesMigrated: 1,
      unresolvedEntriesCreated: 0,
      sourceItemsMoved: 1,
    })
    expect(sheets.getByRef('trainer', 'ash')).toMatchObject({
      revision: 3,
      sheet: {
        inventory: { pokemonItems: [{ id: 'quick-claw-stack', name: 'Quick Claw', qty: 1 }] },
        equipmentState: { owner: { kind: 'trainer', slug: 'ash' }, instances: [] },
      },
    })
    const pokemon = sheets.getByRef('pokemon', 'pikachu')!
    const state = parseSheetEquipmentStateForOwner(pokemon.sheet.equipmentState, {
      kind: 'pokemon', slug: 'pikachu',
    })
    expect(state).toMatchObject({
      owner: { kind: 'pokemon', slug: 'pikachu' },
      slots: [
        { slotId: 'held', instanceId: state.instances[0]?.instanceId },
        { slotId: 'held-secondary', instanceId: null },
      ],
      instances: [{
        canonicalItemId: 'Quick Claw',
        source: {
          containerKind: 'trainer', containerSlug: 'ash', section: 'pokemonItems',
          rowId: 'quick-claw-stack', sourceRevision: 2, quantity: 1,
        },
      }],
    })
    expect(pokemon.sheet.items).toEqual({})
  })

  it('uses an exact group source only when no linked Trainer source exists', () => {
    const database = open()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const groups = createSqliteGroupInventoryRepository(database)
    groups.save({
      slug: 'main', revision: 7, updatedAt: 300,
      document: {
        slug: 'main', revision: 7, updatedAt: 300, money: 0,
        inventory: { pokemonItems: [{ id: 'group-quick-claw', name: 'Quick Claw', qty: 1 }] },
      },
    })
    sheets.saveSetupSheet('pokemon', 'pikachu', {
      slug: 'pikachu', nickname: 'Pika', revision: 1, updatedAt: 320,
      items: { held: 'Quick Claw' },
    })

    const report = migrateLegacyEquipmentDocuments(database.connection)
    expect(report).toMatchObject({
      effectiveInstancesMigrated: 1,
      sourceItemsMoved: 1,
      changedGroupInventories: ['main'],
    })
    expect(groups.get('main')).toMatchObject({
      revision: 8,
      document: { revision: 8, inventory: { pokemonItems: [] } },
    })
    expect(sheets.getByRef('pokemon', 'pikachu')?.sheet.equipmentState).toMatchObject({
      instances: [{ source: { containerKind: 'group', containerSlug: 'main', sourceRevision: 7 } }],
    })
  })

  it('preserves unknown, missing, ambiguous, and duplicate legacy choices as inert GM issues', () => {
    const database = open()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('trainer', 'misty', {
      slug: 'misty', name: 'Misty', revision: 3, updatedAt: 400,
      equipmentSlots: {
        mainHand: 'Quick Claw', offHand: 'Quick Claw', head: 'Homebrew Crown',
        feet: 'Luck Incense', accessory: 'Bright Powder',
      },
      inventory: {
        equipment: [
          { id: 'claw-one', name: 'Quick Claw' },
          { id: 'claw-two', name: 'Quick Claw' },
          { id: 'incense-one', name: 'Luck Incense' },
          { id: 'incense-two', name: 'Luck Incense' },
        ],
      },
    })
    sheets.saveSetupSheet('pokemon', 'staryu', {
      slug: 'staryu', nickname: 'Staryu', revision: 1, updatedAt: 420,
      items: { held: 'Leftovers' },
    })

    const report = migrateLegacyEquipmentDocuments(database.connection)
    expect(report).toMatchObject({
      effectiveInstancesMigrated: 0,
      unresolvedEntriesCreated: 6,
      sourceItemsMoved: 0,
    })
    const trainer = sheets.getByRef('trainer', 'misty')!
    const trainerState = parseSheetEquipmentStateForOwner(trainer.sheet.equipmentState, {
      kind: 'trainer', slug: 'misty',
    })
    expect(trainerState.instances).toEqual([])
    expect(trainerState.slots.every(slot => slot.instanceId === null)).toBe(true)
    expect(trainerState.unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ slotId: 'mainHand', legacyDisplayName: 'Quick Claw', reason: 'invalid-assignment' }),
      expect.objectContaining({ slotId: 'offHand', legacyDisplayName: 'Quick Claw', reason: 'invalid-assignment' }),
      expect.objectContaining({
        slotId: 'head', legacyDisplayName: 'Homebrew Crown', reason: 'unknown-item',
        candidateCanonicalItemIds: [], candidateSourceInstanceIds: [],
      }),
      expect.objectContaining({
        slotId: 'feet', legacyDisplayName: 'Luck Incense', reason: 'ambiguous-source',
        candidateCanonicalItemIds: ['Luck Incense'],
        candidateSourceInstanceIds: [
          'item-instance:trainer:misty:equipment:incense-one',
          'item-instance:trainer:misty:equipment:incense-two',
        ],
      }),
      expect.objectContaining({
        slotId: 'accessory', legacyDisplayName: 'Bright Powder', reason: 'missing-source',
        candidateCanonicalItemIds: ['Bright Powder'], candidateSourceInstanceIds: [],
      }),
    ]))
    expect((trainer.sheet.inventory as any).equipment).toHaveLength(4)
    expect(parseSheetEquipmentStateForOwner(
      sheets.getByRef('pokemon', 'staryu')?.sheet.equipmentState,
      { kind: 'pokemon', slug: 'staryu' },
    ).unresolved).toEqual([
      expect.objectContaining({
        slotId: 'held', legacyDisplayName: 'Leftovers', reason: 'missing-source',
        candidateCanonicalItemIds: ['Leftovers'], candidateSourceInstanceIds: [],
      }),
    ])
  })

  it('preserves unrepresented legacy values beside pre-existing empty authority as inert issues', () => {
    const database = open()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('trainer', 'ash', {
      slug: 'ash', name: 'Ash', revision: 4, updatedAt: 480,
      equipmentState: {
        schemaVersion: 1, revision: 0, owner: { kind: 'trainer', slug: 'ash' },
        slots: [
          { slotId: 'mainHand', instanceId: null }, { slotId: 'offHand', instanceId: null },
          { slotId: 'head', instanceId: null }, { slotId: 'body', instanceId: null },
          { slotId: 'feet', instanceId: null }, { slotId: 'accessory', instanceId: null },
        ],
        instances: [], unresolved: [],
      },
      equipmentSlots: { accessory: 'Quick Claw' },
      inventory: { equipment: [{ id: 'quick-claw-row', name: 'Quick Claw' }] },
    })

    expect(migrateLegacyEquipmentDocuments(database.connection)).toMatchObject({
      sheetsInitialized: 0,
      effectiveInstancesMigrated: 0,
      unresolvedEntriesCreated: 1,
      legacyValuesRetired: 1,
      sourceItemsMoved: 0,
    })
    const migrated = sheets.getByRef('trainer', 'ash')!
    expect(migrated.sheet.equipmentSlots).toEqual({})
    expect((migrated.sheet.inventory as any).equipment).toEqual([{ id: 'quick-claw-row', name: 'Quick Claw' }])
    expect(parseSheetEquipmentStateForOwner(migrated.sheet.equipmentState, {
      kind: 'trainer', slug: 'ash',
    })).toMatchObject({
      revision: 1,
      instances: [],
      unresolved: [{
        slotId: 'accessory', legacyDisplayName: 'Quick Claw', reason: 'invalid-assignment',
        candidateCanonicalItemIds: ['Quick Claw'], candidateSourceInstanceIds: [],
      }],
    })
  })

  it('rolls back every document when pre-existing explicit authority is malformed or owner-misbound', () => {
    const database = open()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('trainer', 'ash', {
      slug: 'ash', name: 'Ash', revision: 1, updatedAt: 500,
      equipmentSlots: { body: 'Light Armor' }, inventory: { equipment: [{ id: 'armor', name: 'Light Armor' }] },
    })
    sheets.saveSetupSheet('pokemon', 'pikachu', {
      slug: 'pikachu', nickname: 'Pika', revision: 2, updatedAt: 510,
      equipmentState: { schemaVersion: 1, owner: { kind: 'pokemon', slug: 'wrong-owner' } },
    })
    const trainerBefore = sheets.getByRef('trainer', 'ash')
    const pokemonBefore = sheets.getByRef('pokemon', 'pikachu')

    expect(() => migrateLegacyEquipmentDocuments(database.connection)).toThrow(/equipmentState/)
    expect(sheets.getByRef('trainer', 'ash')).toEqual(trainerBefore)
    expect(sheets.getByRef('pokemon', 'pikachu')).toEqual(pokemonBefore)
  })
})
