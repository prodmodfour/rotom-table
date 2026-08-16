import { describe, expect, it } from 'vitest'
import {
  ITEM_OPERATION_SCHEMA_VERSION,
  ItemOperationValidationError,
  parseItemOperationPlan,
  parseItemOperationResult,
  parseItemPendingDecision,
  parseUseItemCommand,
  type ItemOperationPlanV1,
  type UseItemCommandV1,
} from '#shared/itemAutomation/operations'

const commandFixture = (): UseItemCommandV1 => ({
  schemaVersion: ITEM_OPERATION_SCHEMA_VERSION,
  operationId: 'op_item_fixture_0001',
  context: 'encounter',
  offerId: 'offer:item:fixture-potion-row',
  sourceInstanceId: 'item-instance:trainer:fixture-trainer:medicalKit:fixture-potion-row',
  actorParticipantId: 'fixture-trainer-placement',
  actorSheet: { kind: 'trainer', slug: 'fixture-trainer', expectedRevision: 3 },
  source: {
    kind: 'trainer',
    slug: 'fixture-trainer',
    section: 'medicalKit',
    rowId: 'fixture-potion-row',
    expectedRevision: 3,
  },
  targetIds: ['fixture-pokemon-placement'],
  choices: [{ choiceId: 'target', optionIds: ['fixture-pokemon-placement'] }],
  readSet: [
    { kind: 'map', id: 'fixture-map', revision: 7 },
    { kind: 'encounter', id: 'fixture-map', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'fixture-trainer', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'fixture-pokemon', revision: 5 },
  ],
})

const planFixture = (): ItemOperationPlanV1 => ({
  schemaVersion: ITEM_OPERATION_SCHEMA_VERSION,
  operationId: 'op_item_fixture_0001',
  canonicalItemId: 'Potion',
  canonicalDefinitionSha256: 'a'.repeat(64),
  readSet: [
    { kind: 'map', id: 'fixture-map', revision: 7 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'fixture-trainer', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'fixture-pokemon', revision: 5 },
  ],
  operations: [
    {
      operationId: 'inventory.consume',
      ordinal: 0,
      kind: 'inventory',
      aggregate: { kind: 'sheet', sheetKind: 'trainer', id: 'fixture-trainer', revision: 3 },
      subjectId: 'fixture-potion-row',
      payload: { action: 'consume', quantity: 1 },
      label: 'Consume one Potion',
    },
    {
      operationId: 'target.heal',
      ordinal: 1,
      kind: 'hp',
      aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'fixture-pokemon', revision: 5 },
      subjectId: 'fixture-pokemon',
      payload: { action: 'heal', amount: 20 },
      label: 'Restore 20 HP',
    },
  ],
  receiptFacts: [{ factId: 'potion-used', audience: 'public', label: 'Potion restored 20 HP.' }],
})

const expectCode = (
  callback: () => unknown,
  code: ItemOperationValidationError['code'],
): void => {
  expect(callback).toThrow(ItemOperationValidationError)
  try { callback() }
  catch (error) { expect((error as ItemOperationValidationError).code).toBe(code) }
}

describe('item operation contracts', () => {
  it('strictly parses, detaches, and freezes authoritative command input without client canonical identity', () => {
    const input = commandFixture()
    const parsed = parseUseItemCommand(input)
    expect(parsed).toEqual(input)
    expect(parsed).not.toBe(input)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.readSet)).toBe(true)
    expect(parsed).not.toHaveProperty('canonicalItemId')
  })

  it('accepts only an opaque Trainer encounter Wonder Launcher delivery binding', () => {
    const value = {
      ...commandFixture(),
      delivery: {
        kind: 'wonder-launcher' as const,
        equipmentBindingId: `equipment-delivery:v1:${'a'.repeat(32)}`,
      },
    }
    expect(parseUseItemCommand(value).delivery).toEqual(value.delivery)
    expect(JSON.stringify(parseUseItemCommand(value))).not.toContain('equipped-item:v1:')
    expectCode(() => parseUseItemCommand({
      ...value,
      delivery: { ...value.delivery, equipmentBindingId: `equipped-item:v1:${'a'.repeat(32)}` },
    }), 'invalid-command')
    expectCode(() => parseUseItemCommand({ ...value, context: 'sheet', actorParticipantId: null }), 'invalid-command')
    expectCode(() => parseUseItemCommand({
      ...value,
      actorSheet: { kind: 'pokemon', slug: 'fixture-pokemon', expectedRevision: 5 },
    }), 'invalid-command')
  })

  it.each(['sheet', 'campaign', 'workshop', 'extended-action'] as const)(
    'accepts the shared %s command context without encounter placement authority',
    (context) => {
      const value = structuredClone(commandFixture())
      value.context = context
      value.actorParticipantId = null
      value.targetIds = ['sheet-target:v1:pokemon:fixture-pokemon']
      value.choices = [{
        choiceId: 'target', optionIds: ['sheet-target:v1:pokemon:fixture-pokemon'],
      }]
      value.readSet = [
        { kind: 'campaign-clock', id: 'campaign', revision: 2 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'fixture-trainer', revision: 3 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'fixture-pokemon', revision: 5 },
      ]
      expect(parseUseItemCommand(value).context).toBe(context)
    },
  )

  it('requires source and actor revisions in a complete, internally consistent read set', () => {
    const missing = structuredClone(commandFixture()) as unknown as Record<string, unknown>
    missing.readSet = [{ kind: 'map', id: 'fixture-map', revision: 7 }]
    expectCode(() => parseUseItemCommand(missing), 'incomplete-read-set')

    const stale = structuredClone(commandFixture())
    stale.source.expectedRevision = 2
    expectCode(() => parseUseItemCommand(stale), 'invalid-command')
  })

  it('rejects duplicate choices, unknown fields, non-JSON data, and encounter commands without an actor', () => {
    const duplicate = structuredClone(commandFixture())
    duplicate.choices = [duplicate.choices[0]!, duplicate.choices[0]!]
    expectCode(() => parseUseItemCommand(duplicate), 'duplicate-id')

    const unknown = structuredClone(commandFixture()) as unknown as Record<string, unknown>
    unknown.canonicalItemId = 'Potion'
    expectCode(() => parseUseItemCommand(unknown), 'invalid-command')

    const notJson = structuredClone(commandFixture()) as unknown as Record<string, unknown>
    notJson.targetIds = [undefined]
    expectCode(() => parseUseItemCommand(notJson), 'not-json')

    const inconsistentSource = structuredClone(commandFixture())
    inconsistentSource.sourceInstanceId = 'item-instance:trainer:fixture-trainer:medicalKit:another-row'
    expectCode(() => parseUseItemCommand(inconsistentSource), 'invalid-command')

    const noActor = structuredClone(commandFixture())
    noActor.actorParticipantId = null
    expectCode(() => parseUseItemCommand(noActor), 'invalid-command')
  })

  it('strictly parses and freezes terminal and pending operation results', () => {
    const accepted = parseItemOperationResult({
      schemaVersion: 1,
      operationId: 'op_item_fixture_0001',
      status: 'accepted',
      canonicalItemId: 'Potion',
      aggregateRefs: commandFixture().readSet,
      receiptId: 'item-receipt:v1:fixture',
      exactReplay: false,
    })
    expect(accepted.status).toBe('accepted')
    expect(Object.isFrozen(accepted)).toBe(true)
    expect(Object.isFrozen(accepted.status === 'accepted' ? accepted.aggregateRefs : [])).toBe(true)
    expect(parseItemOperationResult({
      schemaVersion: 1, operationId: 'op_item_fixture_0001', status: 'rejected', canonicalItemId: null,
      reasonId: 'target.invalid', message: 'Target is invalid.', exactReplay: true,
    }).status).toBe('rejected')
    expect(parseItemOperationResult({
      schemaVersion: 1, operationId: 'op_item_fixture_0001', status: 'pending', canonicalItemId: 'Potion',
      decisionId: 'item-decision:fixture', reservationId: null, exactReplay: false,
    }).status).toBe('pending')
    expectCode(() => parseItemOperationResult({ ...accepted, rawRowId: 'private' }), 'invalid-result')
  })

  it('strictly parses bounded pending decisions with reservation and opaque options', () => {
    const parsed = parseItemPendingDecision({
      schemaVersion: 1,
      operationId: 'op_item_fixture_0001',
      decisionId: 'item-decision:fixture',
      canonicalItemId: 'Potion',
      sourceInstanceId: commandFixture().sourceInstanceId,
      reservation: { reservationId: 'item-reservation:fixture', quantity: 1 },
      choices: [{
        choiceId: 'target', kind: 'participant', minimum: 1, maximum: 1,
        options: [{ optionId: 'fixture-pokemon-placement', label: 'Fixture Pokémon' }],
        privateTo: 'actor-owner',
      }],
    })
    expect(parsed.reservation?.quantity).toBe(1)
    expect(Object.isFrozen(parsed.choices[0]?.options)).toBe(true)
    expectCode(() => parseItemPendingDecision({ ...parsed, unknown: true }), 'invalid-command')
  })

  it('preserves strict non-encounter campaign, ownership, activity, and confirmation plan evidence', () => {
    const input: ItemOperationPlanV1 = {
      ...planFixture(),
      readSet: [
        { kind: 'campaign-clock', id: 'campaign', revision: 7 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'fixture-trainer', revision: 3 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'fixture-pokemon', revision: 5 },
      ],
      operations: [],
      nonEncounterContext: {
        schemaVersion: 1,
        context: 'extended-action',
        campaignTime: { clockRevision: 7, campaignMinute: 4_321 },
        actor: { sheetKind: 'trainer', sheetSlug: 'fixture-trainer', sheetRevision: 3 },
        targetAuthorities: [{
          targetId: 'sheet-target:v1:pokemon:fixture-pokemon',
          sheetKind: 'pokemon', sheetSlug: 'fixture-pokemon', sheetRevision: 5,
          ownerTrainerSlug: 'fixture-trainer', authority: 'actor-roster',
        }],
        extendedAction: {
          mode: 'extended', phase: 'completion', activityId: 'item-activity:v1:fixture',
          activityRevision: 1, startedAtCampaignMinute: 4_300,
        },
        gmConfirmation: {
          required: true, status: 'confirmed', evidenceId: 'item-gm-confirmation:fixture',
        },
      },
    }
    const parsed = parseItemOperationPlan(input)
    expect(parsed.nonEncounterContext).toEqual(input.nonEncounterContext)
    expect(Object.isFrozen(parsed.nonEncounterContext?.targetAuthorities)).toBe(true)
    expectCode(() => parseItemOperationPlan({
      ...input,
      nonEncounterContext: {
        ...input.nonEncounterContext!,
        gmConfirmation: { required: true, status: 'confirmed', evidenceId: null },
      },
    }), 'invalid-plan')
  })

  it('parses a deterministic ordered plan and rejects writes outside the read set', () => {
    const input = planFixture()
    const parsed = parseItemOperationPlan(input)
    expect(parsed).toEqual(input)
    expect(Object.isFrozen(parsed.operations[0]?.payload)).toBe(true)

    const outside = structuredClone(input)
    outside.operations[1]!.aggregate = { kind: 'sheet', sheetKind: 'pokemon', id: 'other-pokemon', revision: 0 }
    expectCode(() => parseItemOperationPlan(outside), 'incomplete-read-set')

    const unordered = structuredClone(input)
    unordered.operations[1]!.ordinal = 2
    expectCode(() => parseItemOperationPlan(unordered), 'invalid-plan')
  })
})
