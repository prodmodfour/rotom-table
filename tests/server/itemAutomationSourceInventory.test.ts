import { describe, expect, it } from 'vitest'
import {
  ItemSourceInventoryError,
  consumeAuthoritativeItemSourceRow,
  resolveAuthoritativeItemSourceInventory,
} from '../../server/domain/itemAutomation/sourceInventory'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'

const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3,
  inventory: { medicalKit: [{ id: 'potion-row', name: 'Potion', qty: 2 }] },
})
const profile = (): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_12345678',
  displayName: 'Player',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
})
const source = {
  kind: 'trainer' as const,
  slug: 'ash',
  section: 'medicalKit' as const,
  rowId: 'potion-row',
  expectedRevision: 3,
}

describe('authoritative item source inventory', () => {
  it('derives canonical identity from one server-owned stable row while retaining its display label', () => {
    const result = resolveAuthoritativeItemSourceInventory({
      role: 'player', playerProfile: profile(), source,
      sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
      trainerSheet: trainer(), requiredQuantity: 1,
    })
    expect(result.instance).toMatchObject({
      canonicalItemId: 'Potion', displayLabel: 'Potion', quantity: 2, revision: 3,
    })
    expect(result.definition.spec.registeredHandlerId).toBe('item.native.v1')
  })

  it('fails closed for stale, moved, duplicate, unknown, or unauthorized rows', () => {
    const stale = trainer()
    stale.revision = 4
    expect(() => resolveAuthoritativeItemSourceInventory({
      role: 'gm', source, sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row', trainerSheet: stale,
    })).toThrow(ItemSourceInventoryError)

    const moved = trainer()
    moved.inventory!.medicalKit![0]!.id = 'moved-row'
    expect(() => resolveAuthoritativeItemSourceInventory({
      role: 'gm', source, sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row', trainerSheet: moved,
    })).toThrow('moved or no longer exists')

    const duplicate = trainer()
    duplicate.inventory!.medicalKit!.push({ id: 'potion-row', name: 'Potion', qty: 1 })
    expect(() => resolveAuthoritativeItemSourceInventory({
      role: 'gm', source, sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row', trainerSheet: duplicate,
    })).toThrow('duplicated')

    const unknown = trainer()
    unknown.inventory!.medicalKit![0]!.name = 'Potion-ish'
    expect(() => resolveAuthoritativeItemSourceInventory({
      role: 'gm', source, sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row', trainerSheet: unknown,
    })).toThrow('no reviewed executable item definition')

    expect(() => resolveAuthoritativeItemSourceInventory({
      role: 'player', playerProfile: null, source,
      sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row', trainerSheet: trainer(),
    })).toThrow('does not control')
  })

  it('subtracts durable reservations from available source quantity', () => {
    expect(() => resolveAuthoritativeItemSourceInventory({
      role: 'gm', source,
      sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
      trainerSheet: trainer(), requiredQuantity: 2, reservedQuantity: 1,
    })).toThrow('unreserved quantity')
    expect(resolveAuthoritativeItemSourceInventory({
      role: 'gm', source,
      sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
      trainerSheet: trainer(), requiredQuantity: 1, reservedQuantity: 1,
    }).instance.quantity).toBe(2)
  })

  it('consumes exactly one stack unit without mutating the source snapshot', () => {
    const before = trainer()
    const result = consumeAuthoritativeItemSourceRow({ source, quantity: 1, trainerSheet: before })
    expect(result.trainerSheet?.inventory?.medicalKit).toEqual([{ id: 'potion-row', name: 'Potion', qty: 1 }])
    expect(before.inventory?.medicalKit).toEqual([{ id: 'potion-row', name: 'Potion', qty: 2 }])
  })

  it('treats serialized rows in quantity sections as one whole stateful item', () => {
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Potion')
    const serialized = trainer()
    serialized.inventory!.medicalKit = [{
      id: 'potion-row', name: 'Potion', qty: 99,
      serializedEquipment: {
        schemaVersion: 1,
        instanceId: `equipped-item:v1:${'a'.repeat(32)}`,
        revision: 2,
        canonicalItemId: 'Potion',
        canonicalRecordSha256: definition.spec.evidence.canonicalRecordSha256,
        equipmentDefinitionSha256: null,
        configuration: null,
        state: { charges: 1 },
      },
    }]
    const resolved = resolveAuthoritativeItemSourceInventory({
      role: 'gm', source,
      sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
      trainerSheet: serialized,
    })
    expect(resolved.instance.quantity).toBe(1)
    expect(() => resolveAuthoritativeItemSourceInventory({
      role: 'gm', source, requiredQuantity: 2,
      sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
      trainerSheet: serialized,
    })).toThrow('unreserved quantity')
    expect(consumeAuthoritativeItemSourceRow({ source, quantity: 1, trainerSheet: serialized })
      .trainerSheet?.inventory?.medicalKit).toEqual([])
    expect(serialized.inventory?.medicalKit).toHaveLength(1)

    const stale = structuredClone(serialized)
    stale.inventory!.medicalKit![0]!.serializedEquipment = {
      ...stale.inventory!.medicalKit![0]!.serializedEquipment!,
      canonicalRecordSha256: 'b'.repeat(64),
    }
    expect(() => resolveAuthoritativeItemSourceInventory({
      role: 'gm', source,
      sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
      trainerSheet: stale,
    })).toThrow('no reviewed executable item definition')
  })

  it('denies direct player use from group inventory until delegation exists', () => {
    const group: GroupInventoryDocument = {
      schemaVersion: 1, slug: 'main', revision: 1, updatedAt: 1,
      inventory: {
        keyItems: [], pokemonItems: [], medicalKit: [{ id: 'row', name: 'Potion', qty: 1 }],
        pokeBalls: [], foodStuff: [], equipment: [],
      },
    }
    expect(() => resolveAuthoritativeItemSourceInventory({
      role: 'player', playerProfile: profile(),
      source: { kind: 'group', slug: 'main', section: 'medicalKit', rowId: 'row', expectedRevision: 1 },
      sourceInstanceId: 'item-instance:group:main:medicalKit:row',
      groupInventory: group,
    })).toThrow('explicit delegated-use policy')
  })
})
