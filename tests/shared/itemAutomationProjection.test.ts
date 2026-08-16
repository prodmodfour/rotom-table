import { describe, expect, it } from 'vitest'
import {
  itemCommandFromAuthorizedOffer,
  ItemActionProjectionError,
  parseAuthorizedItemActionOffer,
  type AuthorizedItemActionOffer,
} from '#shared/itemAutomation/projection'

const offer = (): AuthorizedItemActionOffer => ({
  schemaVersion: 1,
  offerId: 'offer:item:potion', mapSlug: 'arena', mapRevision: 4,
  actor: { participantId: 'ash-placement', displayName: 'Ash', portraitUrl: null, sideId: null, sideLabel: null, sideAccent: null, sheetKind: 'trainer', statusLabels: [] },
  source: { sourceKind: 'item', canonicalId: 'Potion', instanceId: 'item-instance:trainer:ash:medicalKit:potion-row', displayName: 'Potion', referenceHref: '/items/potion' },
  roles: ['activated-action'], group: 'inventory', groupOrder: 45, offerOrder: 0,
  timing: { kind: 'standard', label: 'Standard Action', triggerLabel: null, priority: null },
  costs: [{ kind: 'standard-action', resourceId: 'standard', amount: 1, label: '1 Standard Action' }],
  targeting: [{ requirementId: 'target', kind: 'participant', minSelections: 1, maxSelections: 1, rangeLabel: null, relationshipLabel: null, requiresLineOfSight: false, requiresSpatialInput: false }],
  usage: { frequencyLabel: null, remaining: 2, maximum: 2, cooldownLabel: null, resetLabel: null },
  availability: { status: 'available', reasons: [] },
  presentation: { label: 'Use Potion', description: 'Heal.', iconKey: 'source.item', tone: 'positive' },
  intent: { actionId: 'item.use:item-instance:trainer:ash:medicalKit:potion-row', input: 'choices' },
  itemCommand: {
    schemaVersion: 1, operationId: 'template:item-operation', context: 'encounter', offerId: 'offer:item:potion',
    sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row', actorParticipantId: 'ash-placement',
    actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
    source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 3 },
    targetIds: [], choices: [], readSet: [
      { kind: 'map', id: 'arena', revision: 4 }, { kind: 'encounter', id: 'arena', revision: 4 },
      { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    ],
  },
})

describe('authorized item offer command binding', () => {
  it('strictly parses a declaration-only private template and rejects authority drift', () => {
    const parsed = parseAuthorizedItemActionOffer(offer())
    expect(parsed.itemCommand?.source.rowId).toBe('potion-row')
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(() => parseAuthorizedItemActionOffer({ ...offer(), itemCommand: undefined }))
      .toThrow('must include exactly one private command authority')
    expect(() => parseAuthorizedItemActionOffer({
      ...offer(), source: { ...offer().source, sourceKind: 'move' },
    })).toThrow('non-item declaration')
  })

  it('retains server source/read authority and binds only operation and opaque choices', () => {
    const command = itemCommandFromAuthorizedOffer({
      offer: offer(), operationId: 'op_item_client_0001',
      choices: [
        { choiceId: 'target', optionIds: ['pikachu-placement'] },
        { choiceId: 'condition:cure', optionIds: ['Burned'] },
      ],
    })
    expect(command).toMatchObject({
      operationId: 'op_item_client_0001', source: { rowId: 'potion-row', expectedRevision: 3 },
      targetIds: ['pikachu-placement'],
    })
    expect(command).not.toHaveProperty('canonicalItemId')
  })

  it('rejects missing or mismatched private templates', () => {
    const missing = { ...offer(), itemCommand: undefined }
    expect(() => itemCommandFromAuthorizedOffer({ offer: missing, operationId: 'op_item_client_0001', choices: [] }))
      .toThrow(ItemActionProjectionError)
    const mismatch = offer()
    mismatch.itemCommand = { ...mismatch.itemCommand!, offerId: 'offer:other' }
    expect(() => itemCommandFromAuthorizedOffer({ offer: mismatch, operationId: 'op_item_client_0001', choices: [] }))
      .toThrow('does not match')
  })
})
