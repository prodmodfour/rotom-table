import { describe, expect, it } from 'vitest'
import equipmentContract from '~~/data/complete-play-loop/equipment-contract.v1.json'
import {
  EQUIPMENT_STATE_SCHEMA_VERSION,
  EquipmentStateValidationError,
  POKEMON_EQUIPMENT_SLOT_IDS,
  TRAINER_EQUIPMENT_SLOT_IDS,
  createEmptySheetEquipmentState,
  parseSerializedEquipmentInventoryState,
  parseSheetEquipmentState,
  serializedEquipmentInventoryStateFromInstance,
  parseSheetEquipmentStateForOwner,
  projectSheetEquipmentStateForPlayer,
} from '#shared/itemAutomation/equipment'

const INSTANCE_ID = `equipped-item:v1:${'1'.repeat(32)}`
const SOURCE_INSTANCE_ID = 'item-instance:trainer:ash:equipment:light-armor-row'

const validTrainerState = () => ({
  schemaVersion: 1,
  revision: 2,
  owner: { kind: 'trainer', slug: 'ash' },
  slots: TRAINER_EQUIPMENT_SLOT_IDS.map(slotId => ({
    slotId,
    instanceId: slotId === 'mainHand' || slotId === 'offHand' ? INSTANCE_ID : null,
  })),
  instances: [{
    instanceId: INSTANCE_ID,
    revision: 0,
    canonicalItemId: 'Light Armor',
    canonicalRecordSha256: 'a'.repeat(64),
    equipmentDefinitionSha256: 'b'.repeat(64),
    source: {
      kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment',
      rowId: 'light-armor-row', sourceInstanceId: SOURCE_INSTANCE_ID, sourceRevision: 7, quantity: 1,
    },
    configuration: {
      schemaVersion: 1,
      configurationId: 'light-armor.fit',
      definitionSha256: 'c'.repeat(64),
      values: { fittedFor: 'trainer', guarded: true },
    },
    serializedState: { charges: 3 },
    activity: { status: 'active', reasons: [] },
    equippedByOperationId: 'equipment-operation:v1:fixture',
    equippedAt: 1_000,
  }],
  unresolved: [],
})

const expectCode = (callback: () => unknown, code: EquipmentStateValidationError['code']) => {
  expect(callback).toThrow(EquipmentStateValidationError)
  try { callback() }
  catch (error) { expect((error as EquipmentStateValidationError).code).toBe(code) }
}

describe('explicit equipment and held-item document contract', () => {
  it('creates complete frozen empty documents for Trainer and Pokémon owners', () => {
    const trainer = createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'ash' })
    expect(trainer).toEqual({
      schemaVersion: EQUIPMENT_STATE_SCHEMA_VERSION,
      revision: 0,
      owner: { kind: 'trainer', slug: 'ash' },
      slots: TRAINER_EQUIPMENT_SLOT_IDS.map(slotId => ({ slotId, instanceId: null })),
      instances: [], unresolved: [],
    })
    const pokemon = createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: 'pikachu', revision: 3 })
    expect(pokemon.slots).toEqual(POKEMON_EQUIPMENT_SLOT_IDS.map(slotId => ({ slotId, instanceId: null })))
    expect(pokemon).toMatchObject({ revision: 3, owner: { kind: 'pokemon', slug: 'pikachu' } })
    expect(Object.isFrozen(trainer)).toBe(true)
    expect(Object.isFrozen(trainer.slots)).toBe(true)
  })

  it('parses one whole canonical source-provenanced item occupying multiple slots', () => {
    const input = validTrainerState()
    const parsed = parseSheetEquipmentState(input)
    expect(parsed).toEqual(input)
    expect(parsed).not.toBe(input)
    expect(parsed.instances[0]).toMatchObject({
      canonicalItemId: 'Light Armor', revision: 0,
      source: {
        sourceInstanceId: SOURCE_INSTANCE_ID,
        sourceRevision: 7,
        quantity: 1,
      },
      activity: { status: 'active', reasons: [] },
      configuration: {
        configurationId: 'light-armor.fit',
        values: { fittedFor: 'trainer', guarded: true },
      },
    })
    expect(parsed.slots.filter(slot => slot.instanceId === INSTANCE_ID).map(slot => slot.slotId))
      .toEqual(['mainHand', 'offHand'])
    expect(parsed.instances[0]?.serializedState).toEqual({ charges: 3 })
    expect(Object.isFrozen(parsed.instances[0]?.configuration?.values)).toBe(true)
    expect(parseSheetEquipmentStateForOwner(input, { kind: 'trainer', slug: 'ash' })).toEqual(parsed)
    expectCode(
      () => parseSheetEquipmentStateForOwner(input, { kind: 'trainer', slug: 'misty' }),
      'identity-conflict',
    )
  })

  it('round-trips bounded serialized whole-item state between equipment and inventory', () => {
    const instance = parseSheetEquipmentState(validTrainerState()).instances[0]!
    const inventoryState = serializedEquipmentInventoryStateFromInstance(instance, 4)
    expect(inventoryState).toMatchObject({
      schemaVersion: 1,
      instanceId: INSTANCE_ID,
      revision: 4,
      canonicalItemId: 'Light Armor',
      configuration: { configurationId: 'light-armor.fit' },
      state: { charges: 3 },
    })
    expect(parseSerializedEquipmentInventoryState(inventoryState)).toEqual(inventoryState)
    expect(() => parseSerializedEquipmentInventoryState({ ...inventoryState, state: [] })).toThrow('must be a plain object')
    expect(() => parseSerializedEquipmentInventoryState({ ...inventoryState, instanceId: 'row' })).toThrow('whole-item identity')
  })

  it('projects safe effective state without inventory provenance or private command evidence', () => {
    const projection = projectSheetEquipmentStateForPlayer(validTrainerState())
    expect(projection).toEqual({
      schemaVersion: 1,
      revision: 2,
      owner: { kind: 'trainer', slug: 'ash' },
      slots: TRAINER_EQUIPMENT_SLOT_IDS.map(slotId => ({
        slotId,
        instanceId: slotId === 'mainHand' || slotId === 'offHand'
          ? 'equipment-projection:v1:0'
          : null,
      })),
      instances: [{
        instanceId: 'equipment-projection:v1:0',
        revision: 0,
        canonicalItemId: 'Light Armor',
        activity: { status: 'active', reasonCodes: [] },
        configurationId: 'light-armor.fit',
      }],
      unresolvedCount: 0,
    })
    expect(JSON.stringify(projection)).not.toContain(INSTANCE_ID)
    expect(JSON.stringify(projection)).not.toContain('light-armor-row')
    expect(JSON.stringify(projection)).not.toContain('sourceRevision')
    expect(JSON.stringify(projection)).not.toContain('equippedByOperationId')
    expect(JSON.stringify(projection)).not.toContain('fittedFor')
    expect(Object.isFrozen(projection.instances[0]?.activity.reasonCodes)).toBe(true)
  })

  it('projects safe lifecycle status while omitting reason sources and serialized durability', () => {
    const input = validTrainerState()
    input.instances[0]!.serializedState = {
      equipmentDurability: { schemaVersion: 1, current: 0, maximum: 50 },
    }
    input.instances[0]!.activity = {
      status: 'broken',
      reasons: [{ code: 'equipment.breakage.durability', sourceId: INSTANCE_ID }],
    }
    const projection = projectSheetEquipmentStateForPlayer(input)
    expect(projection.instances[0]?.activity).toEqual({
      status: 'broken', reasonCodes: ['equipment.breakage.durability'],
    })
    const serialized = JSON.stringify(projection)
    expect(serialized).not.toContain(INSTANCE_ID)
    expect(serialized).not.toContain('equipmentDurability')
    expect(serialized).not.toContain('maximum')
    expect(serialized).not.toContain('current')
  })

  it('keeps unresolved legacy descriptions separate and mechanically inert', () => {
    const issueId = `equipment-issue:v1:${'2'.repeat(32)}`
    const parsed = parseSheetEquipmentState({
      schemaVersion: 1, revision: 0, owner: { kind: 'pokemon', slug: 'pikachu' },
      slots: [{ slotId: 'held', instanceId: null }],
      instances: [],
      unresolved: [{
        issueId, slotId: 'held', legacyDisplayName: 'Quick Claw', reason: 'missing-source',
        candidateCanonicalItemIds: ['Quick Claw'],
        candidateSourceInstanceIds: ['item-instance:trainer:ash:pokemonItems:quick-claw-row'],
      }],
    })
    expect(parsed.instances).toEqual([])
    expect(parsed.slots).toEqual(POKEMON_EQUIPMENT_SLOT_IDS.map(slotId => ({ slotId, instanceId: null })))
    expect(parsed.unresolved[0]).toMatchObject({ issueId, legacyDisplayName: 'Quick Claw' })
    expect(parsed).not.toHaveProperty('held')
    expect(parsed).not.toHaveProperty('equipmentSlots')
  })

  it('rejects slot, instance, owner, source, activity, hash, and payload drift', () => {
    const missingSlot = validTrainerState()
    missingSlot.slots.pop()
    expectCode(() => parseSheetEquipmentState(missingSlot), 'invalid-document')

    const ownerMismatch = validTrainerState()
    ownerMismatch.owner.kind = 'pokemon'
    expectCode(() => parseSheetEquipmentState(ownerMismatch), 'invalid-document')

    const missingInstance = validTrainerState()
    missingInstance.instances = []
    expectCode(() => parseSheetEquipmentState(missingInstance), 'identity-conflict')

    const orphan = validTrainerState()
    orphan.slots = orphan.slots.map(slot => ({ ...slot, instanceId: null }))
    expectCode(() => parseSheetEquipmentState(orphan), 'identity-conflict')

    const sourceDrift = validTrainerState()
    sourceDrift.instances[0]!.source.rowId = 'another-row'
    expectCode(() => parseSheetEquipmentState(sourceDrift), 'identity-conflict')

    const quantityDrift = validTrainerState()
    quantityDrift.instances[0]!.source.quantity = 2
    expectCode(() => parseSheetEquipmentState(quantityDrift), 'invalid-document')

    const contradictoryActivity = validTrainerState()
    contradictoryActivity.instances[0]!.activity = {
      status: 'active', reasons: [{ code: 'effect.suppressed', sourceId: 'effect:one' }],
    }
    expectCode(() => parseSheetEquipmentState(contradictoryActivity), 'invalid-document')

    const invalidHash = validTrainerState()
    invalidHash.instances[0]!.canonicalRecordSha256 = 'not-a-hash'
    expectCode(() => parseSheetEquipmentState(invalidHash), 'invalid-document')

    const activeWithoutDefinition = validTrainerState()
    activeWithoutDefinition.instances[0]!.equipmentDefinitionSha256 = null as never
    expectCode(() => parseSheetEquipmentState(activeWithoutDefinition), 'invalid-document')

    const pendingWithoutReason = validTrainerState()
    pendingWithoutReason.instances[0]!.equipmentDefinitionSha256 = null as never
    pendingWithoutReason.instances[0]!.activity = { status: 'inactive', reasons: [{ code: 'other', sourceId: null }] }
    expectCode(() => parseSheetEquipmentState(pendingWithoutReason), 'invalid-document')

    expectCode(() => parseSheetEquipmentState({ ...validTrainerState(), legacyHeldItem: 'Quick Claw' }), 'invalid-document')
    const notJson = validTrainerState()
    notJson.instances[0]!.configuration!.values = { invalid: undefined } as never
    expectCode(() => parseSheetEquipmentState(notJson), 'not-json')
  })

  it('keeps the app-owned versioned evidence in exact parity with the runtime contract', () => {
    expect(equipmentContract).toMatchObject({
      schemaVersion: EQUIPMENT_STATE_SCHEMA_VERSION,
      ticket: 'P8-041',
      runtimeContract: 'shared/itemAutomation/equipment.ts',
      embeddedField: 'equipmentState',
      playerProjectionField: 'equipmentProjection',
      authority: {
        storage: 'owning sheet document_json',
        compareAndSwapRevision: 'sheets.revision',
        semanticRevision: 'equipmentState.revision',
        clientWholeSheetMechanicsWriter: false,
      },
      owners: {
        trainer: { slots: [...TRAINER_EQUIPMENT_SLOT_IDS], legacyDescriptiveField: 'equipmentSlots' },
        pokemon: { slots: [...POKEMON_EQUIPMENT_SLOT_IDS], legacyDescriptiveField: 'items.held' },
      },
      slotAuthority: {
        orphanInstanceAllowed: false,
        missingInstanceReferenceAllowed: false,
        ownerSlotMismatchAllowed: false,
      },
      legacyResolution: { effectiveContribution: false, silentNameBasedActivation: false },
      playerProjection: {
        stored: false,
        malformedAuthorityPolicy: 'omit-projection-fail-closed',
        omits: expect.arrayContaining(['source row identity', 'configuration values', 'operation identity and timestamp']),
      },
    })
    expect(equipmentContract.invariants).toEqual(expect.arrayContaining([
      expect.stringContaining('never effective equipment authority'),
      expect.stringContaining('source-provenanced'),
    ]))
  })
})
