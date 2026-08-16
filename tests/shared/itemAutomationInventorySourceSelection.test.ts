import { describe, expect, it } from 'vitest'
import { projectSheetItemInventorySources } from '#shared/itemAutomation/inventorySourceSelection'
import type { SheetItemActionOfferV1, SheetItemActionProjectionV1 } from '#shared/itemAutomation/sheetActions'

const sourceId = (character: string): string => `inventory-source:v1:${character.repeat(32)}`

const baseOffer = (): SheetItemActionOfferV1 => ({
  schemaVersion: 1,
  offerId: 'sheet-item-offer:first',
  actor: { sheetKind: 'trainer', sheetSlug: 'mira', revision: 7, label: 'Mira', href: '/sheets/trainers/mira' },
  source: {
    sourceSelectionId: sourceId('1'), containerKind: 'trainer', containerLabel: 'Trainer inventory',
    canonicalId: 'Super Potion', displayName: 'Super Potion', section: 'medicalKit', sectionLabel: 'Medical Kit',
    rowIndex: 0, rowLabel: 'Row 1', quantity: 2,
  },
  context: 'sheet', description: 'Current reviewed action.', timingLabel: 'Outside encounter',
  costs: ['Consume 1 Super Potion'], acceptanceNotice: 'Consumes 1 when accepted.',
  availability: { enabled: true, unavailableReason: null },
  actions: [
    { kind: 'use', label: 'Use', enabled: true, unavailableReason: null, href: null },
    { kind: 'inspect', label: 'Inspect', enabled: true, unavailableReason: null, href: '/items/Super%20Potion' },
  ],
  targeting: null,
})
const projectionWith = (offers: readonly SheetItemActionOfferV1[]): SheetItemActionProjectionV1 => ({
  schemaVersion: 1, trainerSlug: 'mira', trainerRevision: 7, generatedAt: 100, offers,
})

describe('inventory source selection projection', () => {
  it('groups only exact current eligible copies and exposes safe row provenance', () => {
    const first = baseOffer()
    const second: SheetItemActionOfferV1 = {
      ...first,
      offerId: 'sheet-item-offer:second',
      source: {
        ...first.source,
        sourceSelectionId: sourceId('2'),
        rowIndex: 3,
        rowLabel: 'Row 4',
        quantity: 1,
      },
    }
    const unsupported: SheetItemActionOfferV1 = {
      ...first,
      offerId: 'sheet-item-offer:other-item',
      source: { ...first.source, sourceSelectionId: sourceId('3'), canonicalId: 'Potion', displayName: 'Potion' },
    }
    const unavailable: SheetItemActionOfferV1 = {
      ...second,
      offerId: 'sheet-item-offer:unavailable',
      source: { ...second.source, sourceSelectionId: sourceId('4'), rowIndex: 4, rowLabel: 'Row 5' },
      availability: { enabled: false, unavailableReason: { code: 'source.reserved', label: 'This row is reserved.' } },
      actions: second.actions.map(action => action.kind === 'use'
        ? { ...action, enabled: false, unavailableReason: { code: 'source.reserved', label: 'This row is reserved.' } }
        : action),
    }
    const result = projectSheetItemInventorySources(
      projectionWith([first, second, unsupported, unavailable]),
      first,
    )
    expect(result).toEqual({
      schemaVersion: 1,
      canonicalItemId: 'Super Potion',
      totalQuantity: 3,
      options: [
        {
          schemaVersion: 1,
          sourceSelectionId: sourceId('1'), offerId: 'sheet-item-offer:first',
          containerKind: 'trainer', containerLabel: 'Trainer inventory', section: 'medicalKit', sectionLabel: 'Medical Kit',
          rowIndex: 0, rowLabel: 'Row 1', itemLabel: 'Super Potion', quantity: 2, selected: true,
        },
        expect.objectContaining({
          sourceSelectionId: sourceId('2'), rowIndex: 3, rowLabel: 'Row 4', quantity: 1, selected: false,
        }),
      ],
    })
    expect(JSON.stringify(result)).not.toMatch(/row-id|sourceInstanceId|profileId|operationId|sha256|private/u)
    expect(Object.isFrozen(result)).toBe(true)
  })

  it('fails closed for stale selection, unsupported identity, or unavailable selected source', () => {
    const first = baseOffer()
    expect(projectSheetItemInventorySources(projectionWith([]), first)).toBeNull()
    expect(projectSheetItemInventorySources(projectionWith([{ ...first, source: { ...first.source, canonicalId: null } }]), {
      ...first, source: { ...first.source, canonicalId: null },
    })).toBeNull()
    const disabled = {
      ...first,
      availability: { enabled: false, unavailableReason: { code: 'source.reserved', label: 'Reserved.' } },
    } as SheetItemActionOfferV1
    expect(projectSheetItemInventorySources(projectionWith([disabled]), disabled)).toBeNull()
  })
})
