import { describe, expect, it } from 'vitest'
import {
  parseAuthorizedGroupInventoryItemAction,
  parseDeclareGroupInventoryItemActionIntent,
  parseGroupInventoryItemActionProjection,
} from '#shared/itemAutomation/groupInventoryItemActions'

const actorId = `group-item-actor:v1:${'a'.repeat(32)}`
const offerId = `sheet-item-offer:v1:${'b'.repeat(32)}`
const sourceId = `inventory-source:v1:${'c'.repeat(32)}`
const offer = () => ({
  schemaVersion: 1,
  offerId,
  actor: { sheetKind: 'trainer', sheetSlug: 'ash', revision: 3, label: 'Ash', href: '/sheets/trainers/ash' },
  source: {
    sourceSelectionId: sourceId,
    containerKind: 'group', containerLabel: 'Group inventory', canonicalId: 'Potion', displayName: 'Potion',
    section: 'medicalKit', sectionLabel: 'Medical Kit', rowIndex: 0, rowLabel: 'Row 1', quantity: 2,
  },
  context: 'sheet', description: 'Restore HP.', timingLabel: 'Outside encounter', costs: [],
  acceptanceNotice: 'Consumes 1 when accepted.',
  availability: { enabled: true, unavailableReason: null },
  actions: [
    { kind: 'use', label: 'Use', enabled: true, unavailableReason: null, href: null },
    { kind: 'inspect', label: 'Inspect', enabled: true, unavailableReason: null, href: '/items/Potion' },
  ],
  targeting: {
    requirementId: 'target', minimum: 1, maximum: 1,
    options: [{
      targetId: 'sheet-target:v1:pokemon:pikachu', sheetKind: 'pokemon', sheetSlug: 'pikachu',
      label: 'Pikachu', kindLabel: 'Pokémon', summary: 'HP 7 / 30', description: 'Restore 20 HP.',
      href: '/sheets/pikachu', enabled: true, unavailableReason: null, previewFacts: [], choices: [],
    }],
  },
})
const projection = () => ({
  schemaVersion: 1,
  groupSlug: 'main', groupRevision: 4, generatedAt: 100,
  selectedActorSelectionId: actorId,
  actors: [{ actorSelectionId: actorId, label: 'Ash', revision: 3, selected: true }],
  offers: [offer()],
})

describe('group inventory item-action contracts', () => {
  it('strictly parses safe actor/source projections and exact declarations', () => {
    expect(parseGroupInventoryItemActionProjection(projection())).toEqual(projection())
    expect(parseDeclareGroupInventoryItemActionIntent({
      schemaVersion: 1, groupSlug: 'main', groupRevision: 4,
      actorSelectionId: actorId, offerId, action: 'use',
    })).toEqual({
      schemaVersion: 1, groupSlug: 'main', groupRevision: 4,
      actorSelectionId: actorId, offerId, action: 'use',
    })
    expect(() => parseGroupInventoryItemActionProjection({
      ...projection(), privateTrainerSlug: 'ash',
    })).toThrow('invalid shape')
    expect(() => parseGroupInventoryItemActionProjection({
      ...projection(), actors: [{ ...projection().actors[0], selected: false }],
    })).toThrow('selected actor is inconsistent')
    expect(() => parseDeclareGroupInventoryItemActionIntent({
      schemaVersion: 1, groupSlug: 'main', groupRevision: 4,
      actorSelectionId: 'ash', offerId, action: 'use',
    })).toThrow('opaque group item actor choice')
  })

  it('requires private commands to preserve exact shared source and revision authority', () => {
    const authorized = {
      schemaVersion: 1,
      groupSlug: 'main', groupRevision: 4, actorSelectionId: actorId,
      offer: {
        ...offer(),
        itemCommand: {
          schemaVersion: 1,
          operationId: 'template:item-operation', context: 'sheet', offerId,
          sourceInstanceId: 'item-instance:group:main:medicalKit:private-row', actorParticipantId: null,
          actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
          source: { kind: 'group', slug: 'main', section: 'medicalKit', rowId: 'private-row', expectedRevision: 4 },
          targetIds: [], choices: [],
          readSet: [
            { kind: 'campaign-clock', id: 'campaign', revision: 0 },
            { kind: 'group-inventory', id: 'main', revision: 4 },
            { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
            { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
          ],
        },
      },
    }
    expect(parseAuthorizedGroupInventoryItemAction(authorized)).toMatchObject({
      groupSlug: 'main', groupRevision: 4,
      offer: { itemCommand: { source: { kind: 'group', slug: 'main', expectedRevision: 4 } } },
    })
    expect(() => parseAuthorizedGroupInventoryItemAction({
      ...authorized,
      offer: { ...authorized.offer, itemCommand: {
        ...authorized.offer.itemCommand,
        source: { ...authorized.offer.itemCommand.source, expectedRevision: 5 },
      } },
    })).toThrow('must match the source read-set revision')
  })
})
