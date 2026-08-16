import { describe, expect, it } from 'vitest'
import {
  itemCommandFromAuthorizedSheetAction,
  parseAuthorizedSheetItemActionOffer,
  parseSheetItemActionProjection,
  parseSheetItemTargetId,
  sheetItemTargetId,
  SheetItemActionValidationError,
  type AuthorizedSheetItemActionOffer,
} from '#shared/itemAutomation/sheetActions'

const targetId = sheetItemTargetId('pokemon', 'pikachu')
const offer = (): AuthorizedSheetItemActionOffer => ({
  schemaVersion: 1,
  offerId: 'offer:sheet-item:potion',
  actor: {
    sheetKind: 'trainer', sheetSlug: 'ash', revision: 3, label: 'Ash', href: '/sheets/trainers/ash',
  },
  source: {
    sourceSelectionId: `inventory-source:v1:${'1'.repeat(32)}`,
    containerKind: 'trainer', containerLabel: 'Trainer inventory',
    canonicalId: 'Potion', displayName: 'Potion', section: 'medicalKit', sectionLabel: 'Medical Kit',
    rowIndex: 0, rowLabel: 'Row 1', quantity: 2,
  },
  context: 'sheet',
  description: 'Restores HP.',
  timingLabel: 'Outside encounter',
  costs: ['Consume 1 Potion'],
  acceptanceNotice: 'Consumes 1 when accepted.',
  availability: { enabled: true, unavailableReason: null },
  actions: [
    { kind: 'use', label: 'Use', enabled: true, unavailableReason: null, href: null },
    { kind: 'inspect', label: 'Inspect', enabled: true, unavailableReason: null, href: '/items/Potion' },
  ],
  targeting: {
    requirementId: 'target', minimum: 1, maximum: 1,
    options: [{
      targetId, sheetKind: 'pokemon', sheetSlug: 'pikachu', label: 'Pikachu', kindLabel: 'Pokémon',
      summary: 'HP 7 / 35', description: 'Restores 20 HP', href: '/sheets/pikachu',
      enabled: true, unavailableReason: null,
      previewFacts: [
        { label: 'HP after use', value: '7 → 27 HP', tone: 'positive' },
        { label: 'Restores', value: '+20 HP', tone: 'positive' },
      ],
      choices: [],
    }],
  },
  itemCommand: {
    schemaVersion: 1, operationId: 'template:item-operation', context: 'sheet',
    offerId: 'offer:sheet-item:potion',
    sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row', actorParticipantId: null,
    actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
    source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 3 },
    targetIds: [], choices: [],
    readSet: [
      { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
      { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    ],
  },
})

describe('sheet item action projection contract', () => {
  it('strictly parses owner-safe actions, target previews, and private declaration authority', () => {
    const parsed = parseAuthorizedSheetItemActionOffer(offer())
    expect(parsed.source).toMatchObject({ displayName: 'Potion', rowIndex: 0, quantity: 2 })
    expect(parsed.targeting?.options[0]).toMatchObject({
      targetId, enabled: true,
      previewFacts: [{ label: 'HP after use', value: '7 → 27 HP', tone: 'positive' }, expect.anything()],
    })
    expect(parsed.itemCommand.readSet).toHaveLength(2)
    expect(Object.isFrozen(parsed)).toBe(true)

    const { itemCommand: _privateCommand, ...publicOffer } = offer()
    expect(parseSheetItemActionProjection({
      schemaVersion: 1, trainerSlug: 'ash', trainerRevision: 3, generatedAt: 100,
      offers: [publicOffer],
    }).offers).toHaveLength(1)
  })

  it('binds only a projected legal target while retaining source and complete read authority', () => {
    const command = itemCommandFromAuthorizedSheetAction({
      offer: offer(), operationId: 'sheet-item:v1:11111111111111111111111111111111', targetIds: [targetId],
    })
    expect(command).toMatchObject({
      context: 'sheet', actorParticipantId: null, targetIds: [targetId],
      choices: [{ choiceId: 'target', optionIds: [targetId] }],
      source: { rowId: 'potion-row', expectedRevision: 3 },
    })
    expect(command.readSet).toEqual(offer().itemCommand.readSet)
    expect(command).not.toHaveProperty('canonicalItemId')
  })

  it('strictly binds target-specific permanent choices into the private command', () => {
    const base = offer()
    const optionId = 'move-choice:v1:11111111111111111111111111111111'
    const permanent: AuthorizedSheetItemActionOffer = {
      ...base,
      source: { ...base.source, canonicalId: 'PP Up', displayName: 'PP Up' },
      targeting: {
        ...base.targeting!,
        options: [{
          ...base.targeting!.options[0]!,
          choices: [{
            choiceId: 'permanent-move', label: 'Choose a move', presentation: 'radio',
            minimum: 1, maximum: 1,
            options: [{
              optionId, label: 'Spark', description: 'EOT → At-Will',
              previewFacts: [{ label: 'Spark', value: 'EOT → At-Will', tone: 'positive' }],
            }],
          }],
        }],
      },
    }
    const parsed = parseAuthorizedSheetItemActionOffer(permanent)
    expect(parsed.targeting?.options[0]?.choices[0]).toMatchObject({
      choiceId: 'permanent-move', presentation: 'radio', minimum: 1, maximum: 1,
    })
    const command = itemCommandFromAuthorizedSheetAction({
      offer: parsed,
      operationId: 'sheet-item:v1:33333333333333333333333333333333',
      targetIds: [targetId],
      choices: [{ choiceId: 'permanent-move', optionIds: [optionId] }],
    })
    expect(command.choices).toEqual([
      { choiceId: 'target', optionIds: [targetId] },
      { choiceId: 'permanent-move', optionIds: [optionId] },
    ])
    expect(() => itemCommandFromAuthorizedSheetAction({
      offer: parsed,
      operationId: 'sheet-item:v1:44444444444444444444444444444444',
      targetIds: [targetId],
      choices: [],
    })).toThrow('incomplete or unavailable')
    expect(() => itemCommandFromAuthorizedSheetAction({
      offer: parsed,
      operationId: 'sheet-item:v1:55555555555555555555555555555555',
      targetIds: [targetId],
      choices: [{ choiceId: 'permanent-move', optionIds: ['manufactured'] }],
    })).toThrow('incomplete or unavailable')
  })

  it('rejects manufactured targets, malformed availability pairs, payload drift, and invalid target identities', () => {
    expect(() => itemCommandFromAuthorizedSheetAction({
      offer: offer(), operationId: 'sheet-item:v1:22222222222222222222222222222222',
      targetIds: [sheetItemTargetId('pokemon', 'eevee')],
    })).toThrow('target is unavailable')

    expect(() => parseAuthorizedSheetItemActionOffer({
      ...offer(), availability: { enabled: true, unavailableReason: { code: 'stale', label: 'Stale.' } },
    })).toThrow('pair enabled state')
    expect(() => parseAuthorizedSheetItemActionOffer({ ...offer(), rawRowId: 'private' }))
      .toThrow('invalid shape')
    expect(() => parseAuthorizedSheetItemActionOffer({
      ...offer(), source: { ...offer().source, rowLabel: 'Row 9' },
    })).toThrow('rowLabel does not match its presentation row')
    expect(() => parseAuthorizedSheetItemActionOffer({
      ...offer(), source: { ...offer().source, sourceSelectionId: 'potion-row' },
    })).toThrow('must be an opaque inventory source identity')
    const { itemCommand: _private, ...publicOffer } = offer()
    expect(() => parseSheetItemActionProjection({
      schemaVersion: 1, trainerSlug: 'ash', trainerRevision: 3, generatedAt: 100,
      offers: [publicOffer, { ...publicOffer, offerId: 'offer:other' }],
    })).toThrow('source selection IDs must be unique')
    expect(parseSheetItemTargetId(targetId)).toEqual({ kind: 'pokemon', slug: 'pikachu' })
    expect(parseSheetItemTargetId('sheet-target:v1:pokemon:../private')).toBeNull()
    expect(() => sheetItemTargetId('pokemon', '../private')).toThrow(SheetItemActionValidationError)
  })
})
