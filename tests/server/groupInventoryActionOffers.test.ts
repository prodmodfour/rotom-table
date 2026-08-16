import { describe, expect, it } from 'vitest'
import { projectGroupInventoryTransferActionAuthority } from '../../server/domain/itemAutomation/groupInventoryActionOffers'
import { createDefaultGroupInventoryDocument } from '~/types/groupInventory'
import type { TrainerSheet } from '~/types/trainerSheet'

const trainer = (slug: string, name: string, revision: number, inventory: TrainerSheet['inventory']): TrainerSheet => ({
  slug,
  name,
  level: 1,
  revision,
  updatedAt: 10,
  inventory,
} as TrainerSheet)

describe('group inventory unified transfer offers', () => {
  it('projects both directions with opaque identities, safe row labels, and exact current revisions', () => {
    const group = createDefaultGroupInventoryDocument({ slug: 'main', now: 10 })
    group.revision = 4
    group.inventory.medicalKit = [{ id: 'private-group-potion', name: 'Potion', qty: 3 }]
    const authority = projectGroupInventoryTransferActionAuthority({
      groupInventory: group,
      trainerSheets: [trainer('ash', 'Ash', 7, {
        medicalKit: [{ id: 'private-trainer-bandage', name: 'Bandages', qty: 2 }],
      })],
      canManageGroupStacks: true,
      generatedAt: 100,
    })

    const groupSource = authority.projection.offers.find(offer => offer.source.locationKind === 'group-inventory')!
    expect(groupSource).toMatchObject({
      action: 'transfer',
      source: {
        containerLabel: 'Group inventory',
        sectionLabel: 'Medical Kit',
        rowLabel: 'Row 1',
        itemLabel: 'Potion',
        availableQuantity: 3,
      },
      quantity: { mode: 'bounded', minimum: 1, maximum: 3 },
      enabled: true,
    })
    expect(groupSource.destination.options).toEqual([
      expect.objectContaining({ kind: 'trainer-inventory', label: 'Ash · Medical Kit', enabled: true }),
    ])
    expect(groupSource.revisionRequirements).toEqual([
      expect.objectContaining({ resourceKind: 'source-container', expectedRevision: 4 }),
    ])
    expect(groupSource.destination.options[0]?.revisionRequirements).toEqual([
      expect.objectContaining({ resourceKind: 'destination-container', expectedRevision: 7 }),
    ])

    const trainerSource = authority.projection.offers.find(offer => offer.source.locationKind === 'trainer-inventory')!
    expect(trainerSource).toMatchObject({
      source: {
        containerLabel: 'Ash inventory',
        sectionLabel: 'Medical Kit',
        rowLabel: 'Row 1',
        itemLabel: 'Bandages',
      },
      destination: {
        options: [expect.objectContaining({ kind: 'group-inventory', label: 'Group inventory · Medical Kit' })],
      },
    })
    expect(trainerSource.revisionRequirements[0]).toMatchObject({ expectedRevision: 7 })
    expect(trainerSource.destination.options[0]?.revisionRequirements[0]).toMatchObject({ expectedRevision: 4 })

    const wire = JSON.stringify(authority.projection)
    expect(wire).not.toMatch(/private-group-potion|private-trainer-bandage|trainerSlug|groupSlug|profileId|revisionSha|instanceId/u)
    expect(groupSource.offerId).toMatch(/^inventory-action-offer:v1:[a-f0-9]{32}$/u)
    expect(groupSource.source.sourceSelectionId).toMatch(/^inventory-source:v1:[a-f0-9]{32}$/u)
  })

  it('keeps group rows visible but unavailable when no controlled Trainer destination exists', () => {
    const group = createDefaultGroupInventoryDocument({ slug: 'main', now: 10 })
    group.inventory.equipment = [{ id: 'group-armor', name: 'Light Armor' }]
    const authority = projectGroupInventoryTransferActionAuthority({
      groupInventory: group,
      trainerSheets: [],
      canManageGroupStacks: true,
      generatedAt: 100,
    })
    expect(authority.projection.offers).toHaveLength(2)
    expect(authority.projection.offers.find(offer => offer.action === 'transfer')).toMatchObject({
      enabled: false,
      unavailableReason: { code: 'destination.unavailable' },
      source: { itemForm: 'whole-item', availableQuantity: 1 },
      destination: { options: [] },
    })
    expect(authority.projection.offers.find(offer => offer.action === 'discard')).toMatchObject({
      enabled: true,
      confirmation: { mode: 'explicit-choice' },
    })
  })

  it('fails closed rather than projecting rows without transferable quantity', () => {
    const group = createDefaultGroupInventoryDocument({ slug: 'main', now: 10 })
    group.inventory.medicalKit = [{ id: 'empty', name: 'Potion', qty: 0 }]
    const authority = projectGroupInventoryTransferActionAuthority({
      groupInventory: group,
      trainerSheets: [trainer('ash', 'Ash', 0, {})],
      canManageGroupStacks: true,
      generatedAt: 100,
    })
    expect(authority.projection.offers).toEqual([])
  })
})
