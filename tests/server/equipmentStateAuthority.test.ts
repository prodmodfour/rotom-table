import { afterEach, describe, expect, it } from 'vitest'
import { createEmptySheetEquipmentState, parseSheetEquipmentState } from '#shared/itemAutomation/equipment'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { redactSheetRecordForPlayer } from '~~/server/utils/sheetPrivacy'
import {
  equipmentDefinitionFor,
  equipmentDefinitionSha256,
} from '~~/server/domain/itemAutomation/equipmentDefinitionRegistry'
import { normalizeAuthoritativeSheetDocumentUpdate } from '~~/server/realtime/sheetDocumentRealtime'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  return database
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
})

describe('equipment state storage authority', () => {
  it.each([
    { kind: 'trainer' as const, slug: 'ash' },
    { kind: 'pokemon' as const, slug: 'pikachu' },
  ])('preserves server-owned $kind equipment state across setup-sheet saves', ({ kind, slug }) => {
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(open())
    const authoritative = createEmptySheetEquipmentState({ ownerKind: kind, ownerSlug: slug, revision: 3 })
    sheets.saveSetupSheet(kind, slug, {
      slug,
      revision: 0,
      updatedAt: 100,
      nickname: kind === 'pokemon' ? 'Pika' : 'Ash',
      ...(kind === 'trainer'
        ? { equipmentSlots: { accessory: 'Quick Claw' } }
        : { items: { held: 'Quick Claw', digestionFood: 'Leftovers' } }),
      equipmentState: authoritative,
    })
    const current = sheets.getByRef(kind, slug)!

    const forged = createEmptySheetEquipmentState({ ownerKind: kind, ownerSlug: slug, revision: 99 })
    const replaced = sheets.replaceSetupSheet({
      kind,
      slug,
      expectedRevision: current.revision,
      sheet: {
        ...current.sheet,
        nickname: 'Edited name',
        equipmentState: forged,
        ...(kind === 'trainer'
          ? { equipmentSlots: { body: 'Forged Armor' } }
          : { items: { held: 'Forged Item', digestionFood: 'Honey' } }),
      },
      now: 200,
    })

    expect(replaced?.changed).toBe(true)
    expect(replaced?.sheet.sheet.nickname).toBe('Edited name')
    expect(replaced?.sheet.sheet.equipmentState).toEqual(authoritative)
    expect(replaced?.sheet.sheet.equipmentState).not.toEqual(forged)
    if (kind === 'trainer') expect(replaced?.sheet.sheet.equipmentSlots).toEqual({ accessory: 'Quick Claw' })
    else expect(replaced?.sheet.sheet.items).toEqual({ held: 'Quick Claw', digestionFood: 'Honey' })

    const afterForgedSave = sheets.getByRef(kind, slug)!
    const removed = { ...afterForgedSave.sheet }
    delete removed.equipmentState
    if (kind === 'trainer') delete removed.equipmentSlots
    else delete removed.items
    const second = sheets.replaceSetupSheet({
      kind,
      slug,
      expectedRevision: afterForgedSave.revision,
      sheet: { ...removed, nickname: 'Edited again' },
      now: 300,
    })
    expect(second?.sheet.sheet.equipmentState).toEqual(authoritative)
    if (kind === 'trainer') expect(second?.sheet.sheet.equipmentSlots).toEqual({ accessory: 'Quick Claw' })
    else expect(second?.sheet.sheet.items).toEqual({ held: 'Quick Claw' })
  })

  it('preserves server-owned serialized whole-item state across setup autosave and strips it from player projections', () => {
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(open())
    const serializedEquipment = {
      schemaVersion: 1,
      instanceId: `equipped-item:v1:${'8'.repeat(32)}`,
      revision: 4,
      canonicalItemId: 'Focus',
      canonicalRecordSha256: 'a'.repeat(64),
      equipmentDefinitionSha256: 'b'.repeat(64),
      configuration: {
        schemaVersion: 1, configurationId: 'equipment.focus.v1',
        definitionSha256: 'c'.repeat(64), values: { statId: 'atk' },
      },
      activity: {
        status: 'suppressed' as const,
        reasons: [{ code: 'equipment.suppression.guided', sourceId: 'private-lifecycle-source' }],
      },
      state: { charges: 2 },
    }
    sheets.saveSetupSheet('trainer', 'ash', {
      slug: 'ash', name: 'Ash', level: 10, revision: 1, updatedAt: 100,
      inventory: { equipment: [{ id: 'focus-row', name: 'Focus', serializedEquipment }] },
      equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'ash' }),
    })
    const current = sheets.getByRef('trainer', 'ash')!
    const result = sheets.replaceSetupSheet({
      kind: 'trainer', slug: 'ash', expectedRevision: current.revision, now: 200,
      sheet: {
        ...current.sheet,
        inventory: { equipment: [
          { id: 'forged-row', name: 'Focus', serializedEquipment: { ...serializedEquipment, revision: 99 } },
        ] },
      },
    })!
    expect((result.sheet.sheet.inventory as any).equipment).toEqual([
      { id: 'forged-row', name: 'Focus' },
      { id: 'focus-row', name: 'Focus', serializedEquipment },
    ])
    const projected = redactSheetRecordForPlayer('trainer', result.sheet.sheet)
    expect((projected.inventory as any).equipment).toEqual([
      { id: 'forged-row', name: 'Focus' },
      { id: 'focus-row', name: 'Focus', qty: 1 },
    ])
    expect(JSON.stringify(projected)).not.toContain('equipment.focus.v1')
    expect(JSON.stringify(projected)).not.toContain('charges')
    expect(JSON.stringify(projected)).not.toContain('private-lifecycle-source')
  })

  it('projects player-safe equipment state and contribution facts without private provenance', () => {
    const quickClaw = equipmentDefinitionFor('Quick Claw')!
    const state = parseSheetEquipmentState({
      schemaVersion: 1, revision: 4, owner: { kind: 'pokemon', slug: 'pikachu' },
      slots: [{ slotId: 'held', instanceId: `equipped-item:v1:${'3'.repeat(32)}` }],
      instances: [{
        instanceId: `equipped-item:v1:${'3'.repeat(32)}`, revision: 1,
        canonicalItemId: 'Quick Claw', canonicalRecordSha256: quickClaw.canonicalRecordSha256,
        equipmentDefinitionSha256: equipmentDefinitionSha256('Quick Claw'),
        source: {
          kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'pokemonItems',
          rowId: 'private-row', sourceInstanceId: 'item-instance:trainer:ash:pokemonItems:private-row',
          sourceRevision: 9, quantity: 1,
        },
        configuration: null, activity: { status: 'active', reasons: [] },
        equippedByOperationId: 'equipment-operation:v1:private', equippedAt: 500,
      }],
      unresolved: [],
    })
    const projected = redactSheetRecordForPlayer('pokemon', {
      slug: 'pikachu', species: 'Pikachu', nickname: 'Pika', level: 10,
      equipmentState: state,
      equipmentProjection: { forged: true },
      items: { held: 'Quick Claw', digestionFood: 'Leftovers' },
    })
    expect(projected).not.toHaveProperty('equipmentState')
    expect(projected.items).toEqual({ digestionFood: 'Leftovers' })
    expect(projected.equipmentProjection).toMatchObject({
      revision: 4,
      owner: { kind: 'pokemon', slug: 'pikachu' },
      instances: [{ canonicalItemId: 'Quick Claw', activity: { status: 'active' } }],
    })
    expect(JSON.stringify(projected)).not.toContain(`equipped-item:v1:${'3'.repeat(32)}`)
    expect(JSON.stringify(projected)).not.toContain('private-row')
    expect(JSON.stringify(projected)).not.toContain('sourceRevision')
    expect(JSON.stringify(projected)).not.toContain('equipment-operation')
    expect(projected.equipmentContributionProjection).toMatchObject({
      owner: { kind: 'pokemon', slug: 'pikachu' },
      values: [{
        metricId: 'initiative:all', label: 'Initiative',
        sources: [{ sourceLabel: 'Quick Claw', value: 10, applied: 10 }],
      }],
    })
    expect(JSON.stringify(projected.equipmentContributionProjection)).not.toContain('canonicalRecordSha256')

    const realtime = normalizeAuthoritativeSheetDocumentUpdate({
      kind: 'pokemon', slug: 'pikachu',
      sheet: {
        slug: 'pikachu', species: 'Pikachu', nickname: 'Pika', level: 10,
        revision: 7, updatedAt: 700, equipmentState: state,
        equipmentContributionProjection: {
          schemaVersion: 1,
          owner: { kind: 'pokemon', slug: 'pikachu' },
          equipmentRevision: 4,
          inactiveSourceCount: 0,
          values: [{
            metricId: 'stat-after-stages:spd', metric: 'stat-after-stages', targetId: 'spd',
            label: 'Speed', base: 9, sources: [], final: 999, conflict: false, unavailableReason: null,
          }],
        },
      },
    })
    expect(realtime.sheet.equipmentContributionProjection).toMatchObject({
      owner: { kind: 'pokemon', slug: 'pikachu' },
      equipmentRevision: 4,
      values: [{ metricId: 'initiative:all', final: 19 }],
    })
    expect(realtime.canonicalSheet).not.toContain('forged')

    const trainerProjected = redactSheetRecordForPlayer('trainer', {
      slug: 'ash',
      equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: 'ash' }),
      equipmentSlots: { accessory: 'Quick Claw' },
    })
    expect(trainerProjected).not.toHaveProperty('equipmentSlots')

    const malformed = redactSheetRecordForPlayer('pokemon', {
      slug: 'pikachu', equipmentState: { malformed: true }, equipmentProjection: { forged: true },
    })
    expect(malformed).not.toHaveProperty('equipmentState')
    expect(malformed).not.toHaveProperty('equipmentProjection')
  })

  it('rejects client-style creation while permitting a revision-checked server operation writer', () => {
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(open())
    sheets.saveSetupSheet('pokemon', 'pikachu', {
      slug: 'pikachu', revision: 0, updatedAt: 100, nickname: 'Pika',
    })
    const current = sheets.getByRef('pokemon', 'pikachu')!
    const injected = createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: 'pikachu', revision: 8 })
    const clientResult = sheets.replaceSetupSheet({
      kind: 'pokemon', slug: 'pikachu', expectedRevision: current.revision,
      sheet: {
        ...current.sheet,
        nickname: 'Client edit',
        equipmentState: injected,
        equipmentProjection: { forged: true },
      },
      now: 200,
    })!
    expect(clientResult.sheet.sheet).not.toHaveProperty('equipmentState')
    expect(clientResult.sheet.sheet).not.toHaveProperty('equipmentProjection')

    const serverState = createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: 'pikachu', revision: 1 })
    expect(sheets.applyLivePlayUpdate({
      kind: 'pokemon', slug: 'pikachu', expectedRevision: clientResult.sheet.revision,
      nextSheet: { ...clientResult.sheet.sheet, equipmentState: serverState, updatedAt: 300 },
      sourceOperationId: 'equipment-operation:v1:fixture',
    })).toBe('applied')
    expect(sheets.getByRef('pokemon', 'pikachu')?.sheet.equipmentState).toEqual(serverState)
  })
})
