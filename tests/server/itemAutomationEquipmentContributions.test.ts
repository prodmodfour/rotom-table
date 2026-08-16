import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createEmptySheetEquipmentState,
  parseSheetEquipmentStateForOwner,
  type EquipmentActivityV1,
  type EquipmentOwnerKind,
  type EquipmentSlotId,
} from '#shared/itemAutomation/equipment'
import { itemInventoryInstanceId } from '#shared/itemAutomation/inventory'
import {
  equipmentConfigurationDefinitionSha256,
  equipmentDefinitionFor,
  equipmentDefinitionSha256,
} from '~~/server/domain/itemAutomation/equipmentDefinitionRegistry'
import {
  equipmentContributionDocument,
  equipmentContributionDefinitions,
} from '~~/server/domain/itemAutomation/equipmentContributionRegistry'
import {
  resolveEquipmentContributions,
  resolveEquipmentMetric,
} from '~~/server/domain/itemAutomation/equipmentContributions'
import { projectEquipmentContributionsForSheet } from '~~/server/domain/itemAutomation/equipmentContributionProjection'
import type { TrainerSheet } from '~/types/trainerSheet'

const digest = (value: string, length: number): string => createHash('sha256').update(value).digest('hex').slice(0, length)

const state = (input: {
  ownerKind?: EquipmentOwnerKind
  ownerSlug?: string
  items: readonly {
    canonicalItemId: string
    slotId: EquipmentSlotId
    configuration?: { configurationId: string; values: Record<string, unknown> }
    activity?: EquipmentActivityV1
    stale?: boolean
  }[]
}) => {
  const ownerKind = input.ownerKind ?? 'trainer'
  const ownerSlug = input.ownerSlug ?? 'ash'
  const base = createEmptySheetEquipmentState({ ownerKind, ownerSlug })
  const instances = input.items.map((item, index) => {
    const definition = equipmentDefinitionFor(item.canonicalItemId)!
    const seed = `${ownerKind}:${ownerSlug}:${index}:${item.canonicalItemId}`
    const rowId = `row-${index}`
    const instanceId = `equipped-item:v1:${digest(seed, 32)}`
    return {
      instanceId,
      revision: 1,
      canonicalItemId: item.canonicalItemId,
      canonicalRecordSha256: item.stale ? 'f'.repeat(64) : definition.canonicalRecordSha256,
      equipmentDefinitionSha256: equipmentDefinitionSha256(item.canonicalItemId),
      source: {
        kind: 'inventory' as const,
        containerKind: 'trainer' as const,
        containerSlug: 'ash',
        section: 'equipment' as const,
        rowId,
        sourceInstanceId: itemInventoryInstanceId({
          containerKind: 'trainer', containerSlug: 'ash', section: 'equipment', rowId,
        }),
        sourceRevision: 1,
        quantity: 1 as const,
      },
      configuration: item.configuration ? {
        schemaVersion: 1 as const,
        configurationId: item.configuration.configurationId,
        definitionSha256: equipmentConfigurationDefinitionSha256(item.canonicalItemId)!,
        values: item.configuration.values,
      } : null,
      serializedState: {},
      activity: item.activity ?? { status: 'active' as const, reasons: [] },
      equippedByOperationId: `equipment-operation:v1:${digest(`operation:${seed}`, 32)}`,
      equippedAt: 1,
    }
  })
  return parseSheetEquipmentStateForOwner({
    ...base,
    revision: 2,
    slots: base.slots.map(slot => ({
      ...slot,
      instanceId: instances.find((_instance, index) => input.items[index]!.slotId === slot.slotId)?.instanceId ?? null,
    })),
    instances,
  }, { kind: ownerKind, slug: ownerSlug })
}

const owner = (kind: EquipmentOwnerKind = 'trainer', slug = 'ash') => ({
  kind, slug, speciesId: kind === 'pokemon' ? 'Pikachu' : null, transformed: false,
})

describe('reviewed equipment-derived contributions', () => {
  it('classifies the complete equipment catalog without runtime prose interpretation', () => {
    const document = equipmentContributionDocument()
    expect(document).toMatchObject({
      schemaVersion: 1,
      ticket: 'P8-046',
      definitionCount: 108,
      contributingItemCount: 63,
      classificationPolicy: {
        status: 'reviewed',
        runtimeProseParsing: false,
        unknownOrStalePolicy: 'fail-closed-no-contribution',
        inactiveOrSuppressedPolicy: 'no-contribution',
        deferredMechanicsRemainInert: true,
      },
    })
    expect(equipmentContributionDefinitions()).toHaveLength(108)
    expect(new Set(equipmentContributionDefinitions().map(row => row.canonicalItemId)).size).toBe(108)
  })

  it('projects exact additive sources and skill caps with base/source/final evidence', () => {
    const equipmentState = state({ items: [
      { canonicalItemId: 'Light Armor', slotId: 'body' },
      { canonicalItemId: 'Running Shoes', slotId: 'feet' },
    ] })
    const contributions = resolveEquipmentContributions({ equipmentState, owner: owner() })
    expect(contributions.active.map(row => [row.contributionId, row.targetIds, row.value, row.cap])).toEqual([
      ['equipment.light-armor.damage-reduction', ['all'], 5, null],
      ['equipment.running-shoes.athletics', ['athletics'], 2, 3],
      ['equipment.running-shoes.overland', ['overland'], 1, null],
    ])
    expect(resolveEquipmentMetric({
      contributions: contributions.active, metric: 'damage-reduction', targetId: 'all', base: 0,
    })).toMatchObject({ base: 0, final: 5, conflict: false })
    const athletics = resolveEquipmentMetric({
      contributions: contributions.active, metric: 'skill-check-modifier', targetId: 'athletics', base: 1,
    })
    expect(athletics).toMatchObject({ base: 1, final: 3, conflict: false })
    expect(athletics.contributions[0]).toMatchObject({
      canonicalItemId: 'Running Shoes', value: 2, cap: 3, before: 1, applied: 2, after: 3,
    })
    expect(resolveEquipmentMetric({
      contributions: contributions.active, metric: 'skill-check-modifier', targetId: 'athletics', base: 5,
    })).toMatchObject({ base: 5, final: 5, conflict: false })
    expect(resolveEquipmentMetric({
      contributions: contributions.active, metric: 'capability-value', targetId: 'overland', base: 5,
    }).final).toBe(6)
  })

  it('resolves hash-bound configured stat targets without exposing raw configuration objects', () => {
    const equipmentState = state({ items: [{
      canonicalItemId: 'Focus', slotId: 'accessory',
      configuration: { configurationId: 'equipment.focus.v1', values: { statId: 'atk' } },
    }] })
    const result = resolveEquipmentContributions({ equipmentState, owner: owner() })
    expect(result.active).toEqual([
      expect.objectContaining({
        contributionId: 'equipment.focus.stat', canonicalItemId: 'Focus',
        metric: 'stat-after-stages', targetIds: ['atk'], value: 5,
      }),
    ])
    expect(resolveEquipmentMetric({
      contributions: result.active, metric: 'stat-after-stages', targetId: 'atk', base: 12,
    }).final).toBe(17)
    expect(resolveEquipmentMetric({
      contributions: result.active, metric: 'stat-after-stages', targetId: 'def', base: 12,
    }).final).toBe(12)
  })

  it('evaluates typed move and environment facts while keeping unmet contributions inert', () => {
    const plate = state({ ownerKind: 'pokemon', ownerSlug: 'pika', items: [{
      canonicalItemId: 'Type Plate', slotId: 'held',
      configuration: { configurationId: 'equipment.type-plate.v1', values: { typeId: 'Fire' } },
    }] })
    const fire = resolveEquipmentContributions({
      equipmentState: plate,
      owner: { kind: 'pokemon', slug: 'pika', speciesId: 'Pikachu', transformed: false },
      facts: { moveType: 'Fire' },
    })
    expect(fire.active.map(row => row.metric)).toEqual(['direct-damage', 'damage-reduction'])
    const water = resolveEquipmentContributions({
      equipmentState: plate,
      owner: { kind: 'pokemon', slug: 'pika', speciesId: 'Pikachu', transformed: false },
      facts: { moveType: 'Water' },
    })
    expect(water.active).toEqual([])
    expect(water.inactive.every(row => row.reasonCode === 'equipment-contribution.predicate-not-met')).toBe(true)

    const powder = state({ ownerKind: 'pokemon', ownerSlug: 'ditto', items: [{
      canonicalItemId: 'Metal Powder', slotId: 'held',
    }] })
    expect(resolveEquipmentContributions({
      equipmentState: powder,
      owner: { kind: 'pokemon', slug: 'ditto', speciesId: 'Ditto', transformed: false },
    }).active.map(row => row.targetIds[0])).toEqual(['def', 'sdef'])
    expect(resolveEquipmentContributions({
      equipmentState: powder,
      owner: { kind: 'pokemon', slug: 'ditto', speciesId: 'Ditto', transformed: true },
    }).active).toEqual([])

    const boots = state({ items: [{ canonicalItemId: 'Snow Boots', slotId: 'feet' }] })
    expect(resolveEquipmentContributions({ equipmentState: boots, owner: owner() }).active).toEqual([])
    expect(resolveEquipmentContributions({
      equipmentState: boots,
      owner: owner(),
      facts: { environmentIds: new Set(['ice-or-deep-snow']) },
    }).active[0]).toMatchObject({ metric: 'capability-value', targetIds: ['overland'], value: -1 })
  })

  it('projects safe base/source/cap/final inspector values from authoritative sheet state', () => {
    const equipmentState = state({ items: [
      { canonicalItemId: 'Light Armor', slotId: 'body' },
      { canonicalItemId: 'Running Shoes', slotId: 'feet' },
    ] })
    const sheet: TrainerSheet = {
      slug: 'ash', name: 'Ash', level: 10,
      stats: { spd: { base: 5 } },
      skills: { athletics: { modifier: 1 } },
      capabilities: { overland: 5 },
      equipmentState,
    }
    const projection = projectEquipmentContributionsForSheet({ kind: 'trainer', slug: 'ash', sheet })
    expect(projection).toMatchObject({
      schemaVersion: 1,
      owner: { kind: 'trainer', slug: 'ash' },
      equipmentRevision: 2,
      inactiveSourceCount: 0,
    })
    expect(projection?.values.find(row => row.metricId === 'damage-reduction:all')).toMatchObject({
      label: 'Damage reduction', base: 0, final: 5,
      sources: [{ sourceLabel: 'Light Armor', value: 5, applied: 5, cap: null }],
    })
    expect(projection?.values.find(row => row.metricId === 'capability-value:overland')).toMatchObject({
      label: 'Overland', base: 5, final: 6,
      sources: [{ sourceLabel: 'Running Shoes', value: 1, applied: 1 }],
    })
    expect(projection?.values.find(row => row.metricId === 'skill-check-modifier:athletics')).toMatchObject({
      label: 'Athletics modifier', base: 1, final: 3,
      sources: [{ sourceLabel: 'Running Shoes', value: 2, applied: 2, cap: 3 }],
    })
    expect(JSON.stringify(projection)).not.toContain('canonicalRecordSha256')
    expect(JSON.stringify(projection)).not.toContain('sourceInstanceId')

    const helmetState = state({ items: [{ canonicalItemId: 'Helmet', slotId: 'head' }] })
    const helmetProjection = projectEquipmentContributionsForSheet({
      kind: 'trainer', slug: 'ash',
      sheet: { slug: 'ash', name: 'Ash', level: 10, equipmentState: helmetState },
    })
    expect(helmetProjection?.values[0]).toMatchObject({
      label: 'Damage reduction · Critical-hit damage',
      sources: [{ sourceLabel: 'Helmet', conditionLabels: ['Critical-hit damage'] }],
    })

    const incompatibleState = state({ ownerKind: 'pokemon', ownerSlug: 'eevee', items: [{
      canonicalItemId: 'Rare Leek', slotId: 'held',
    }] })
    const incompatibleProjection = projectEquipmentContributionsForSheet({
      kind: 'pokemon', slug: 'eevee',
      sheet: { slug: 'eevee', nickname: 'Eevee', species: 'Eevee', level: 10, equipmentState: incompatibleState },
    })
    expect(incompatibleProjection).toMatchObject({ values: [], inactiveSourceCount: 1 })
  })

  it('fails closed for inactive, suppressed, stale, and conflicting sources', () => {
    const inactiveState = state({ items: [{
      canonicalItemId: 'Light Armor', slotId: 'body',
      activity: { status: 'suppressed', reasons: [{ code: 'test.suppressed', sourceId: null }] },
    }] })
    expect(resolveEquipmentContributions({ equipmentState: inactiveState, owner: owner() })).toMatchObject({
      active: [], inactive: [expect.objectContaining({ reasonCode: 'equipment-contribution.inactive' })],
    })

    const staleState = state({ items: [{ canonicalItemId: 'Light Armor', slotId: 'body', stale: true }] })
    expect(resolveEquipmentContributions({ equipmentState: staleState, owner: owner() })).toMatchObject({
      active: [], inactive: [expect.objectContaining({ reasonCode: 'equipment-contribution.definition-stale' })],
    })

    const suppressedState = state({ items: [{ canonicalItemId: 'Light Armor', slotId: 'body' }] })
    expect(resolveEquipmentContributions({
      equipmentState: suppressedState, owner: owner(), isSuppressed: () => true,
    })).toMatchObject({
      active: [], inactive: [expect.objectContaining({ reasonCode: 'equipment-contribution.suppressed' })],
    })

    const conflictState = state({ items: [
      { canonicalItemId: 'Heavy Armor', slotId: 'body' },
      {
        canonicalItemId: 'Stat Boosters', slotId: 'accessory',
        configuration: { configurationId: 'equipment.stat-boosters.v1', values: { statId: 'spd' } },
      },
    ] })
    const conflictContributions = resolveEquipmentContributions({ equipmentState: conflictState, owner: owner() })
    expect(resolveEquipmentMetric({
      contributions: conflictContributions.active,
      metric: 'combat-stage-default', targetId: 'spd', base: 0,
    })).toMatchObject({
      final: 0,
      conflict: true,
      contributions: [
        expect.objectContaining({ canonicalItemId: 'Heavy Armor', operation: 'set', value: -1, applied: 0 }),
        expect.objectContaining({ canonicalItemId: 'Stat Boosters', operation: 'set', value: 1, applied: 0 }),
      ],
    })
  })
})
