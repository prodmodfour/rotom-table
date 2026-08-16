import { describe, expect, it } from 'vitest'
import type { StoredItemOperationRecord } from '../../server/storage/itemOperationRepository'
import { projectItemOperationPresentations } from '../../server/domain/itemAutomation/presentation'
import { loadEncounterWorkspaceUseCase } from '../../server/useCases/loadEncounterWorkspace'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import type { UseItemCommandV1, ItemOperationPlanV1, ItemPendingDecisionV1 } from '#shared/itemAutomation/operations'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { CharacterSheet } from '~/types/characterSheet'
import type { PlayerProfile } from '#shared/playerProfiles'
import { emptyEncounterPresentationProjection } from '#shared/encounterPresentation'
import type { LiveTableSnapshot } from '#shared/liveTableSnapshot'

const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', revision: 3,
  inventory: { medicalKit: [{ id: 'potion-row', name: 'Potion', qty: 2 }] },
})
const pokemon = (): CharacterSheet => ({
  slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', revision: 2,
  stats: { hp: { added: 0 } }, combat: { currentHp: 1 },
})
const map = (revision = 4): TabletopMap => ({
  schemaVersion: 2, slug: 'arena', name: 'Arena', revision,
  dimensions: { x: 5, y: 3, z: 5 }, voxels: [], createdAt: 1, updatedAt: 10,
  placements: [
    { id: 'ash-placement', sheetKind: 'trainer', sheetSlug: 'ash', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu', sideId: 'heroes', position: { x: 2, y: 0, z: 1 } },
  ],
  encounterState: {
    sides: { heroes: { id: 'heroes', label: 'Heroes', color: '#4488cc', status: 'active' } },
    turnResources: {},
    history: { currentTurn: null, faintedPlacementIds: [] },
  } as TabletopMap['encounterState'],
})
const profile = (slug = 'ash'): PlayerProfile => ({
  schemaVersion: 1, id: `profile_${slug.padEnd(8, '0')}`, displayName: 'Player',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: slug }],
})
const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Potion')
const command = (): UseItemCommandV1 => ({
  schemaVersion: 1, operationId: 'op_item_projection_0001', context: 'encounter', offerId: 'offer:item:potion',
  sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row', actorParticipantId: 'ash-placement',
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 3 },
  targetIds: ['pikachu-placement'], choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
  readSet: [
    { kind: 'map', id: 'arena', revision: 4 }, { kind: 'encounter', id: 'arena', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
  ],
})
const plan = (): ItemOperationPlanV1 => ({
  schemaVersion: 1, operationId: command().operationId, canonicalItemId: 'Potion',
  canonicalDefinitionSha256: definition.definitionSha256, readSet: command().readSet,
  operations: [
    {
      operationId: 'inventory.consume', ordinal: 0, kind: 'inventory',
      aggregate: { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 }, subjectId: 'potion-row',
      payload: { action: 'consume', quantity: 1, sourceInstanceId: command().sourceInstanceId }, label: 'Consume one Potion',
    },
    {
      operationId: 'target.pikachu.heal', ordinal: 1, kind: 'hp',
      aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 }, subjectId: 'pikachu-placement',
      payload: {
        action: 'heal', calculationKind: 'fixed', currentHp: 1, fullFormulaMaximumHp: 27,
        effectiveMaximumHp: 27, injuries: 0, requestedHealing: 20, effectiveHealing: 20,
        overheal: 0, resultingHp: 21, roll: null,
        cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve',
      }, label: 'Potion: heal HP',
    },
    {
      operationId: 'encounter.spend-action', ordinal: 2, kind: 'resource',
      aggregate: { kind: 'encounter', id: 'arena', revision: 4 }, subjectId: 'ash-placement',
      payload: { action: 'spend', resourceId: 'standard', amount: 1 }, label: '1 Standard Action',
    },
  ],
  receiptFacts: [{ factId: 'item-used', audience: 'public', label: 'Potion was used.' }],
})
const pendingDecision = (): ItemPendingDecisionV1 => ({
  schemaVersion: 1, operationId: command().operationId,
  decisionId: 'item-decision:op_item_projection_0001', canonicalItemId: 'Potion',
  sourceInstanceId: command().sourceInstanceId,
  reservation: { reservationId: 'item-reservation:op_item_projection_0001', quantity: 1 },
  choices: [{
    choiceId: 'target', kind: 'participant', minimum: 1, maximum: 1,
    options: [{ optionId: 'pikachu-placement', label: 'Pikachu' }], privateTo: 'actor-owner',
  }],
})
const baseRecord = (): StoredItemOperationRecord => ({
  schemaVersion: 1, operationId: command().operationId, commandSha256: 'a'.repeat(64), command: command(),
  resumeCommandSha256: null, resumeCommand: null, status: 'pending', canonicalItemId: 'Potion',
  canonicalDefinitionSha256: definition.definitionSha256, plan: plan(), pendingDecision: pendingDecision(), result: null,
  correctionOfOperationId: null, recoveryCommandSha256: null, recoveryCommand: null,
  compensation: null, scopes: command().readSet, createdAt: 100, updatedAt: 100,
})
const acceptedRecord = (): StoredItemOperationRecord => ({
  ...baseRecord(), status: 'accepted', pendingDecision: null,
  result: {
    schemaVersion: 1, operationId: command().operationId, status: 'accepted', canonicalItemId: 'Potion',
    aggregateRefs: command().readSet.map(ref => ref.kind === 'map' || ref.kind === 'encounter'
      ? { ...ref, revision: 5 }
      : ref.kind === 'sheet' ? { ...ref, revision: ref.revision + 1 } : ref),
    receiptId: 'item-receipt:op_item_projection_0001', exactReplay: false,
  },
  updatedAt: 200,
})

const snapshot = (): LiveTableSnapshot => ({
  schemaVersion: 1,
  map: map(),
  mapRevision: 4,
  interactionMode: 'live-play',
  interactionModeUpdatedAt: 10,
  pokemonSheets: [pokemon()],
  trainerSheets: [trainer()],
  encounterPresentation: emptyEncounterPresentationProjection({ mapSlug: 'arena', mapRevision: 4, audience: 'actor-owner' }),
})

const project = (record: StoredItemOperationRecord, options: {
  audience: 'gm' | 'player-owner' | 'public' | 'diagnostic'
  role: 'gm' | 'player'
  playerProfile?: PlayerProfile | null
  revision?: number
}) => projectItemOperationPresentations({
  records: [record], audience: options.audience, role: options.role,
  playerProfile: options.playerProfile, map: map(options.revision ?? 4),
  pokemonSheets: [pokemon()], trainerSheets: [trainer()],
})

describe('item operation encounter projection', () => {
  it('projects exact pending choices only to the GM or current actor owner', () => {
    const gm = project(baseRecord(), { audience: 'gm', role: 'gm' })
    expect(gm.pending[0]).toMatchObject({
      projection: 'gm', source: { canonicalId: 'Potion', instanceId: command().sourceInstanceId },
      choices: [{ options: [{ optionId: 'pikachu-placement' }] }],
    })
    expect(gm.authorizedInteractionIds).toEqual([gm.pending[0]!.interactionId])
    expect(gm.pending[0]).toMatchObject({
      recoveryActions: [{ action: 'cancel', label: 'Abandon and release item', enabled: true }],
    })

    const owner = project(baseRecord(), { audience: 'player-owner', role: 'player', playerProfile: profile() })
    expect(owner.pending[0]).toMatchObject({
      projection: 'actor-owner', choices: [{ choiceId: 'target' }], recoveryActions: [],
    })
    expect(owner.authorizedInteractionIds).toEqual([owner.pending[0]!.interactionId])
  })

  it('projects a generic waiting state without item, row, actor, target, or choice data to public and unrelated players', () => {
    for (const value of [
      project(baseRecord(), { audience: 'public', role: 'gm' }),
      project(baseRecord(), { audience: 'player-owner', role: 'player', playerProfile: profile('misty') }),
    ]) {
      expect(value.pending[0]).toMatchObject({ projection: 'public', source: null, actor: null })
      expect(value.authorizedInteractionIds).toEqual([])
      const json = JSON.stringify(value.pending[0])
      expect(json).not.toContain('Potion')
      expect(json).not.toContain('potion-row')
      expect(json).not.toContain('pikachu-placement')
      expect(json).not.toContain('optionId')
    }
  })

  it('restores the private pending decision through the workspace after reconnect while public view stays generic', () => {
    const owner = loadEncounterWorkspaceUseCase({
      role: 'player', slug: 'arena', playerProfile: profile(),
    }, {
      loadSnapshot: () => snapshot(),
      loadEncounterDocument: () => null,
      findEncounterDocumentByMap: () => null,
      listItemOperations: () => [baseRecord()],
    })
    expect(owner.pending[0]).toMatchObject({
      projection: 'actor-owner', responseIdentity: {
        resolutionId: command().operationId,
        windowId: pendingDecision().decisionId,
      },
      choices: [{ options: [{ optionId: 'pikachu-placement' }] }],
    })

    const publicView = loadEncounterWorkspaceUseCase({ role: 'gm', slug: 'arena', audience: 'public' }, {
      loadSnapshot: () => snapshot(),
      loadEncounterDocument: () => null,
      findEncounterDocumentByMap: () => null,
      listItemOperations: () => [baseRecord()],
    })
    expect(publicView.offers).toEqual([])
    expect(publicView.pending[0]).toMatchObject({ projection: 'public', source: null, actor: null })
    expect(JSON.stringify(publicView.pending[0])).not.toContain('Potion')
    expect(JSON.stringify(publicView.pending[0])).not.toContain('pikachu-placement')
  })

  it('projects public accepted outcome history but never the private inventory row or consumption operation', () => {
    const value = project(acceptedRecord(), { audience: 'public', role: 'gm', revision: 5 })
    expect(value.accepted[0]).toMatchObject({
      source: { sourceKind: 'item', canonicalId: 'Potion', instanceId: null },
      actor: { participantId: 'ash-placement' },
      affectedParticipants: [{ participantId: 'pikachu-placement' }],
      headline: { label: 'Potion restored 20 HP' },
    })
    expect(value.accepted[0]?.changes.map(change => change.kind)).toEqual(['hp', 'resource'])
    expect(value.accepted[0]?.changes[0]).toMatchObject({
      operation: 'increase', delta: 20, label: '20 HP restored',
      before: { numberValue: 1, unit: 'HP' }, after: { numberValue: 21, unit: 'HP' },
    })
    const json = JSON.stringify(value.accepted[0])
    expect(json).not.toContain('potion-row')
    expect(json).not.toContain('sourceInstanceId')
    expect(json).not.toContain('inventory.consume')
  })

  it('projects a revival as exact public HP and consciousness facts', () => {
    const revive = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Revive')
    const record = acceptedRecord()
    record.canonicalItemId = 'Revive'
    record.canonicalDefinitionSha256 = revive.definitionSha256
    record.plan = {
      ...record.plan!, canonicalItemId: 'Revive', canonicalDefinitionSha256: revive.definitionSha256,
      operations: [
        record.plan!.operations[0]!,
        {
          operationId: 'target.pikachu.revive', ordinal: 1, kind: 'hp',
          aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
          subjectId: 'pikachu-placement',
          payload: {
            action: 'revive', calculationKind: 'fixed', currentHp: 0,
            fullFormulaMaximumHp: 27, effectiveMaximumHp: 27, injuries: 0,
            requestedHp: 20, resultingHp: 20, capReducedAmount: 0,
            cap: 'injury-adjusted-effective-maximum-hp', targetKind: 'pokemon',
            faintedState: 'require-and-clear',
          },
          label: 'Revive: revive',
        },
        { ...record.plan!.operations[2]!, ordinal: 2 },
      ],
    }
    const value = project(record, { audience: 'public', role: 'gm', revision: 5 })
    expect(value.accepted[0]).toMatchObject({
      source: { canonicalId: 'Revive', instanceId: null },
      headline: { label: 'Revive revived the target at 20 HP' },
    })
    expect(value.accepted[0]?.changes[0]).toMatchObject({
      kind: 'hp', operation: 'increase', participantId: 'pikachu-placement', delta: 20,
      before: { numberValue: 0, unit: 'HP' }, after: { numberValue: 20, unit: 'HP' },
      label: 'Revived at 20 HP',
    })
  })

  it('projects exact condition removals as canonical public accepted facts without private inventory evidence', () => {
    const antidote = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Antidote')
    const record = acceptedRecord()
    record.canonicalItemId = 'Antidote'
    record.canonicalDefinitionSha256 = antidote.definitionSha256
    record.plan = {
      ...record.plan!, canonicalItemId: 'Antidote', canonicalDefinitionSha256: antidote.definitionSha256,
      operations: [
        record.plan!.operations[0]!,
        {
          operationId: 'target.pikachu.conditions', ordinal: 1, kind: 'condition',
          aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
          subjectId: 'pikachu-placement',
          payload: {
            action: 'remove', mode: 'listed', selection: 'all-applicable',
            currentConditions: ['Badly Poisoned', 'Confused', 'Slowed'],
            removedConditionIds: ['Badly Poisoned'], removedEntries: ['Badly Poisoned'],
            resultingConditions: ['Confused', 'Slowed'],
          },
          label: 'Antidote: remove-conditions',
        },
        { ...record.plan!.operations[2]!, ordinal: 2 },
      ],
    }
    const value = project(record, { audience: 'public', role: 'gm', revision: 5 })
    expect(value.accepted[0]).toMatchObject({
      source: { canonicalId: 'Antidote', instanceId: null },
      headline: { label: 'Antidote cured Badly Poisoned' },
    })
    expect(value.accepted[0]?.changes[0]).toMatchObject({
      kind: 'condition', operation: 'remove', participantId: 'pikachu-placement',
      after: { textValue: 'Badly Poisoned' }, label: 'Badly Poisoned cured',
    })
    const json = JSON.stringify(value.accepted[0])
    expect(json).not.toContain('potion-row')
    expect(json).not.toContain('sourceInstanceId')
    expect(json).not.toContain('inventory.consume')
  })

  it('projects authoritative stage and temporary-effect before/after facts without inventory evidence', () => {
    const xAttack = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('X Attack')
    const stageRecord = acceptedRecord()
    stageRecord.canonicalItemId = xAttack.canonicalId
    stageRecord.canonicalDefinitionSha256 = xAttack.definitionSha256
    stageRecord.plan = {
      ...stageRecord.plan!, canonicalItemId: xAttack.canonicalId,
      canonicalDefinitionSha256: xAttack.definitionSha256,
      operations: [
        stageRecord.plan!.operations[0]!,
        {
          operationId: 'target.pikachu.stage', ordinal: 1, kind: 'stage',
          aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
          subjectId: 'pikachu-placement', payload: {
            action: 'modify', stat: 'atk', previous: 5, requestedDelta: 2,
            appliedDelta: 1, current: 6, minimum: -6, maximum: 6, capped: true,
          }, label: 'X Attack: modify-stage',
        },
        { ...stageRecord.plan!.operations[2]!, ordinal: 2 },
      ],
    }
    const stageProjection = project(stageRecord, { audience: 'public', role: 'gm', revision: 5 })
    expect(stageProjection.accepted[0]).toMatchObject({
      headline: { label: 'X Attack changed the target’s Combat Stage to 6' },
    })
    expect(stageProjection.accepted[0]?.changes).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'stage', operation: 'increase', before: expect.objectContaining({ numberValue: 5, unit: 'stage' }),
      after: expect.objectContaining({ numberValue: 6, unit: 'stage' }), delta: 1,
      label: 'Combat Stage 5 → 6 (+1; capped)',
    })]))

    const direHit = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Dire Hit')
    const effectRecord = acceptedRecord()
    effectRecord.canonicalItemId = direHit.canonicalId
    effectRecord.canonicalDefinitionSha256 = direHit.definitionSha256
    effectRecord.plan = {
      ...effectRecord.plan!, canonicalItemId: direHit.canonicalId,
      canonicalDefinitionSha256: direHit.definitionSha256,
      operations: [
        effectRecord.plan!.operations[0]!,
        {
          operationId: 'target.pikachu.dire-hit', ordinal: 1, kind: 'effect',
          aggregate: { kind: 'encounter', id: 'arena', revision: 4 },
          subjectId: 'pikachu-placement', payload: {
            action: 'apply-temporary-combat-effect', family: 'critical-range', amount: 2,
            duration: { kind: 'encounter', amount: null }, stackPolicy: 'replace',
            switchPolicy: 'expire', effect: {},
          }, label: 'Dire Hit: temporary-combat-effect',
        },
        { ...effectRecord.plan!.operations[2]!, ordinal: 2 },
      ],
    }
    const effectProjection = project(effectRecord, { audience: 'public', role: 'gm', revision: 5 })
    expect(effectProjection.accepted[0]).toMatchObject({
      headline: { label: 'Dire Hit applied critical range' },
    })
    expect(effectProjection.accepted[0]?.changes).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'effect', operation: 'add', after: expect.objectContaining({ textValue: 'critical range' }),
      label: 'Critical Hit Range +2 until encounter end',
    })]))
    const json = JSON.stringify(effectProjection.accepted[0])
    expect(json).not.toContain('potion-row')
    expect(json).not.toContain('inventory.consume')
  })

  it('projects Digestion Buff storage as an effect without leaking source inventory evidence', () => {
    const snack = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Leftovers')
    const record = acceptedRecord()
    record.canonicalItemId = snack.canonicalId
    record.canonicalDefinitionSha256 = snack.definitionSha256
    record.plan = {
      ...record.plan!, canonicalItemId: snack.canonicalId,
      canonicalDefinitionSha256: snack.definitionSha256,
      operations: [
        record.plan!.operations[0]!,
        {
          operationId: 'target.pikachu.digestion', ordinal: 1, kind: 'inventory',
          aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
          subjectId: 'pikachu-placement', payload: {
            action: 'store-digestion-buff', canonicalItemId: 'Leftovers', buffKind: 'turn-start-heal',
            amount: 1, denominator: 16, requiredPokemonType: null,
          }, label: 'Leftovers: store Digestion Buff',
        },
        { ...record.plan!.operations[2]!, ordinal: 2 },
      ],
    }
    const value = project(record, { audience: 'public', role: 'gm', revision: 5 })
    expect(value.accepted[0]).toMatchObject({
      headline: { label: 'Leftovers Digestion Buff stored' },
    })
    expect(value.accepted[0]?.changes).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'effect', operation: 'add', after: expect.objectContaining({ textValue: 'Digestion Buff' }),
      label: 'Digestion Buff stored (1/16 maximum HP at turn start until encounter end)',
    })]))
    expect(JSON.stringify(value.accepted[0])).not.toContain('potion-row')
    expect(JSON.stringify(value.accepted[0])).not.toContain('sourceInstanceId')
  })

  it('projects a role-safe correction receipt linked to the original accepted presentation', () => {
    const correctionCommand = {
      schemaVersion: 1 as const,
      operationId: command().operationId,
      action: 'correct' as const,
      correctionOperationId: 'op_item_correction_projection01',
      reason: 'The GM corrected the accepted target.',
    }
    const origin = acceptedRecord()
    const corrected: StoredItemOperationRecord = {
      ...origin,
      operationId: correctionCommand.correctionOperationId,
      command: { ...origin.command, operationId: correctionCommand.correctionOperationId },
      plan: { ...origin.plan!, operationId: correctionCommand.correctionOperationId, operations: [] },
      status: 'corrected',
      correctionOfOperationId: origin.operationId,
      recoveryCommandSha256: 'b'.repeat(64),
      recoveryCommand: correctionCommand,
      result: {
        ...origin.result!, operationId: correctionCommand.correctionOperationId,
        receiptId: 'item-correction-receipt:op_item_correction_projection01',
      },
    }
    const gm = project(corrected, { audience: 'gm', role: 'gm', revision: 5 })
    expect(gm.accepted[0]).toMatchObject({
      operationId: correctionCommand.correctionOperationId,
      headline: { label: 'Potion use corrected — inventory restored', tone: 'warning' },
      outcomes: [{ kind: 'corrected', label: 'Item use corrected; consumed inventory restored' }],
      changes: [],
      correction: {
        correctsPresentationId: expect.stringContaining(origin.operationId),
        reasonLabel: correctionCommand.reason,
      },
    })
    const publicValue = project(corrected, { audience: 'public', role: 'gm', revision: 5 })
    expect(JSON.stringify(publicValue.accepted[0])).not.toContain('potion-row')
    expect(JSON.stringify(publicValue.accepted[0])).not.toContain('sourceInstanceId')
  })

  it('fails historical detail closed when the bound definition is unavailable or drifted', () => {
    const source = acceptedRecord()
    const drifted: StoredItemOperationRecord = {
      ...source,
      canonicalDefinitionSha256: 'f'.repeat(64),
      plan: { ...source.plan!, canonicalDefinitionSha256: 'f'.repeat(64) },
    }
    const value = project(drifted, { audience: 'public', role: 'gm', revision: 5 })
    expect(value.accepted[0]).toMatchObject({
      source: { canonicalId: 'private-rule' }, actor: null, affectedParticipants: [],
      headline: { label: 'Encounter state changed.' },
    })
    expect(JSON.stringify(value.accepted[0])).not.toContain('Potion')
    expect(JSON.stringify(value.accepted[0])).not.toContain('pikachu-placement')
  })
})
