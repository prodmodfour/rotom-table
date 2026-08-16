import { describe, expect, it } from 'vitest'
import { MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH } from '#shared/realtimeEventLog'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  createDefaultGroupInventoryDocument,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import {
  groupInventoryAffectedSheetRealtimeDedupeKey,
  groupInventoryAffectedSheetUpdatedRealtimeAppendInputs,
  groupInventoryUpdatedRealtimeAppendInputs,
  groupInventoryUpdatedRealtimeDedupeKey,
} from '~~/server/realtime/groupInventoryRealtime'
import { redactRealtimeEventForPrincipal } from '~~/server/realtime/realtimeEventRedaction'

const groupInventory = (overrides: Partial<GroupInventoryDocument> = {}): GroupInventoryDocument => ({
  ...createDefaultGroupInventoryDocument({ now: 100 }),
  revision: 2,
  updatedAt: 200,
  money: 500,
  ...overrides,
})

describe('group inventory realtime helpers', () => {
  it('creates an authoritative group inventory update event with shared inventory access', () => {
    const document = groupInventory()
    const inputs = groupInventoryUpdatedRealtimeAppendInputs(document, 'client-1', 'save')

    expect(inputs).toEqual([{
      event: {
        channel: 'group-inventory:main',
        type: 'updated',
        revision: 2,
        clientId: 'client-1',
        data: {
          slug: GROUP_INVENTORY_MAIN_SLUG,
          document,
        },
      },
      access: { kind: 'group-inventory-access', groupSlug: GROUP_INVENTORY_MAIN_SLUG },
      dedupeKey: 'group-inventory:save:main:2:specific',
    }])
    expect((inputs[0]?.event.data as { document: unknown }).document).not.toBe(document)

    expect(groupInventoryUpdatedRealtimeAppendInputs(
      document,
      'move-client',
      'resolve-move',
    )[0]).toMatchObject({
      access: { kind: 'group-inventory-access', groupSlug: GROUP_INVENTORY_MAIN_SLUG },
      dedupeKey: 'group-inventory:resolve-move:main:2:specific',
    })
  })

  it('redacts private serialized whole-item evidence from player delivery', () => {
    const serializedEquipment = {
      schemaVersion: 1 as const,
      instanceId: `equipped-item:v1:${'a'.repeat(32)}`,
      revision: 3,
      canonicalItemId: 'Focus',
      canonicalRecordSha256: 'b'.repeat(64),
      equipmentDefinitionSha256: 'c'.repeat(64),
      configuration: {
        schemaVersion: 1 as const,
        configurationId: 'equipment.focus.v1',
        definitionSha256: 'c'.repeat(64),
        values: { statId: 'atk' },
      },
      state: { charge: 2 },
    }
    const document = groupInventory({
      inventory: {
        ...createDefaultGroupInventoryDocument({ now: 100 }).inventory,
        equipment: [{ id: 'focus-row', name: 'Focus', serializedEquipment }],
      },
    })
    const event = groupInventoryUpdatedRealtimeAppendInputs(document)[0]!.event
    const playerEvent = redactRealtimeEventForPrincipal(event, { role: 'player' }) as {
      data: { document: GroupInventoryDocument }
    }
    expect(playerEvent.data.document.inventory.equipment).toEqual([
      { id: 'focus-row', name: 'Focus', qty: 1 },
    ])
    expect(JSON.stringify(playerEvent)).not.toContain('equipped-item:v1')
    expect(redactRealtimeEventForPrincipal(event, { role: 'gm' })).toEqual(event)
  })

  it('creates affected trainer sheet update events for transfer convergence', () => {
    const trainerSheet = { slug: 'misty', revision: 4, updatedAt: 400, inventory: { pokemonItems: [] } }
    const inputs = groupInventoryAffectedSheetUpdatedRealtimeAppendInputs({
      update: { kind: 'trainer', slug: 'misty', sheet: trainerSheet },
      clientId: 'client-1',
      operation: 'transfer-to-trainer',
    })

    expect(inputs).toEqual([
      {
        event: {
          channel: 'sheet:trainer:misty',
          type: 'updated',
          clientId: 'client-1',
          data: { kind: 'trainer', slug: 'misty', sheet: trainerSheet },
        },
        access: { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'misty' },
        dedupeKey: 'group-inventory-sheet:transfer-to-trainer:trainer:misty:4:specific',
      },
      {
        event: {
          channel: 'sheets',
          type: 'updated',
          clientId: 'client-1',
          data: { kind: 'trainer', slug: 'misty', sheet: trainerSheet },
        },
        access: { kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'misty' },
        dedupeKey: 'group-inventory-sheet:transfer-to-trainer:trainer:misty:4:global',
      },
    ])
    expect((inputs[0]?.event.data as { sheet: unknown }).sheet).not.toBe(trainerSheet)
  })

  it('validates authoritative documents and keeps long dedupe keys bounded', () => {
    expect(() => groupInventoryUpdatedRealtimeAppendInputs(groupInventory({ slug: 'Bad Slug' as string })))
      .toThrow(/slug/)
    expect(() => groupInventoryUpdatedRealtimeAppendInputs(groupInventory({ revision: -1 })))
      .toThrow(/revision/)
    expect(() => groupInventoryAffectedSheetUpdatedRealtimeAppendInputs({
      update: { kind: 'trainer', slug: 'misty', sheet: { slug: 'misty', revision: Number.NaN, updatedAt: 1 } },
      operation: 'transfer-to-group',
    })).toThrow(/revision/)

    const longSlug = 'a'.repeat(400)
    expect(groupInventoryUpdatedRealtimeDedupeKey({
      operation: 'transfer-to-group',
      groupSlug: longSlug,
      revision: 1,
      destination: 'specific',
    }).length).toBeLessThanOrEqual(MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH)
    expect(groupInventoryAffectedSheetRealtimeDedupeKey({
      operation: 'transfer-to-trainer',
      kind: 'trainer',
      slug: longSlug,
      revision: 1,
      destination: 'global',
    }).length).toBeLessThanOrEqual(MAX_REALTIME_EVENT_DEDUPE_KEY_LENGTH)
  })
})
