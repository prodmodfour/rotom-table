import { describe, expect, it } from 'vitest'
import { parseItemNonEncounterExecutionSnapshot } from '#shared/itemAutomation/nonEncounter'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { previewMachineMoveLearning } from '../../server/domain/itemAutomation/moveLearning'
import { planDeterministicItemOperation } from '../../server/domain/itemAutomation/planner'
import { reduceItemOperationPlan } from '../../server/domain/itemAutomation/reducer'
import { assertItemRuntimePlanConformance } from '../../server/domain/itemAutomation/conformance'
import type { ItemOperationCompensationV1 } from '../../server/storage/itemOperationRepository'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TrainerSheet } from '../../src/types/trainerSheet'

const targetId = 'sheet-target:v1:pokemon:spark'
const campaignMinute = 1_500

const target = (species = 'Pikachu'): CharacterSheet => ({
  slug: 'spark', species, nickname: 'Spark', level: 10, revision: 2,
  movelist: [{ name: species === 'Squirtle' ? 'Tackle' : 'Quick Attack' }],
  appliedMoves: [], tutorPoints: { spent: 0 },
})

const actor = (canonicalId: string): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3, currentTeam: ['spark'],
  inventory: { pokemonItems: [{ id: 'machine-row', name: canonicalId, qty: 2 }] },
})

const sourceId = 'item-instance:trainer:ash:pokemonItems:machine-row'

const planned = (
  canonicalId: string,
  species = 'Pikachu',
  startedAtCampaignMinute = campaignMinute,
) => {
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId)
  const trainer = actor(canonicalId)
  const pokemon = target(species)
  const preview = previewMachineMoveLearning({
    definition, sheetKind: 'pokemon', sheet: pokemon,
    actorKind: 'trainer', actorSheet: trainer,
    sourceInstanceId: sourceId, campaignMinute,
  })
  const replacement = preview.choices.find(choice => choice.choiceId === 'machine-replacement')!.options[0]!
  const command: UseItemCommandV1 = {
    schemaVersion: 1,
    operationId: `machine-settlement-${canonicalId.replace(/[^a-z0-9]/giu, '-').toLowerCase()}`,
    context: 'extended-action',
    offerId: `offer:${canonicalId}`,
    sourceInstanceId: sourceId,
    actorParticipantId: null,
    actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
    source: { kind: 'trainer', slug: 'ash', section: 'pokemonItems', rowId: 'machine-row', expectedRevision: 3 },
    targetIds: [targetId],
    choices: [
      { choiceId: 'target', optionIds: [targetId] },
      { choiceId: 'machine-replacement', optionIds: [replacement.optionId] },
      { choiceId: 'machine-confirmation', optionIds: ['confirmed'] },
    ],
    readSet: [
      { kind: 'campaign-clock', id: 'campaign-clock', revision: 5 },
      { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
      { kind: 'sheet', sheetKind: 'pokemon', id: 'spark', revision: 2 },
    ],
  }
  const nonEncounterContext = parseItemNonEncounterExecutionSnapshot({
    schemaVersion: 1,
    context: 'extended-action',
    campaignTime: { clockRevision: 5, campaignMinute },
    actor: { sheetKind: 'trainer', sheetSlug: 'ash', sheetRevision: 3 },
    targetAuthorities: [{
      targetId, sheetKind: 'pokemon', sheetSlug: 'spark', sheetRevision: 2,
      ownerTrainerSlug: 'ash', authority: 'actor-roster',
    }],
    extendedAction: {
      mode: 'extended', phase: 'completion',
      activityId: 'item-activity:v1:1234567890abcdef1234567890abcdef',
      activityRevision: 0,
      startedAtCampaignMinute,
    },
    gmConfirmation: { required: false, status: 'not-required', evidenceId: null },
  })
  const plan = planDeterministicItemOperation({
    command,
    definition,
    source: {
      containerKind: 'trainer', containerSlug: 'ash', section: 'pokemonItems',
      rowId: 'machine-row', instanceId: sourceId, canonicalItemId: canonicalId,
      displayLabel: canonicalId, quantity: 2, revision: 3,
      ownerSheet: { kind: 'trainer', slug: 'ash' },
    },
    targets: [{
      participantId: targetId, sheetKind: 'pokemon', sheetSlug: 'spark',
      revision: 2, sheet: pokemon,
    }],
    actorSheet: trainer,
    campaignMinute,
    operationTimestamp: 50_000,
    nonEncounterContext,
  })
  return { definition, trainer, pokemon, command, plan }
}

const compensation = (
  beforeTrainer: TrainerSheet,
  beforePokemon: CharacterSheet,
): ItemOperationCompensationV1 => ({
  schemaVersion: 1,
  map: null,
  sheets: [
    { kind: 'trainer', slug: 'ash', beforeRevision: 3, afterRevision: 4, beforeSheet: beforeTrainer, afterSheet: beforeTrainer },
    { kind: 'pokemon', slug: 'spark', beforeRevision: 2, afterRevision: 3, beforeSheet: beforePokemon, afterSheet: beforePokemon },
  ],
  groupInventory: null,
})

describe('machine Move-learning deterministic operation', () => {
  it('plans, conforms, and atomically reduces TM consumption plus the target mutation', () => {
    const input = planned('TM 24 - Thunderbolt')
    expect(input.plan.operations.map(row => [row.operationId, row.kind])).toEqual([
      ['inventory.consume', 'inventory'],
      [`target.${targetId}.machine-learning`, 'campaign-fact'],
    ])
    expect(() => assertItemRuntimePlanConformance({
      definition: input.definition,
      plan: input.plan,
      compensation: compensation(input.trainer, input.pokemon),
      command: input.command,
    })).not.toThrow()

    const reduced = reduceItemOperationPlan({
      plan: input.plan,
      map: null,
      sheets: new Map([['trainer:ash', input.trainer], ['pokemon:spark', input.pokemon]]),
      groupInventory: null,
    })
    expect((reduced.sheets.get('trainer:ash') as TrainerSheet).inventory?.pokemonItems).toEqual([
      { id: 'machine-row', name: 'TM 24 - Thunderbolt', qty: 1 },
    ])
    expect((reduced.sheets.get('pokemon:spark') as CharacterSheet).movelist?.map(row => row.name))
      .toEqual(['Quick Attack', 'Thunderbolt'])
    expect(reduced.changedSheetKeys).toEqual(['pokemon:spark', 'trainer:ash'])
  })

  it('plans no HM consumption and commits one actor-private campaign-day receipt', () => {
    const input = planned('HM A3 - Surf', 'Squirtle')
    expect(input.plan.operations.map(row => [row.operationId, row.kind])).toEqual([
      [`target.${targetId}.machine-learning`, 'campaign-fact'],
      ['actor.machine-daily-use', 'campaign-fact'],
    ])
    expect(() => assertItemRuntimePlanConformance({
      definition: input.definition,
      plan: input.plan,
      compensation: compensation(input.trainer, input.pokemon),
      command: input.command,
    })).not.toThrow()

    const reduced = reduceItemOperationPlan({
      plan: input.plan,
      map: null,
      sheets: new Map([['trainer:ash', input.trainer], ['pokemon:spark', input.pokemon]]),
      groupInventory: null,
    })
    const resultingTrainer = reduced.sheets.get('trainer:ash') as TrainerSheet
    expect(resultingTrainer.inventory?.pokemonItems).toEqual(input.trainer.inventory?.pokemonItems)
    expect(resultingTrainer.serverPrivate?.itemMachineUsage?.latestUses).toEqual([
      expect.objectContaining({ sourceInstanceId: sourceId, campaignDayIndex: 1 }),
    ])
    expect((reduced.sheets.get('pokemon:spark') as CharacterSheet).movelist?.map(row => row.name))
      .toEqual(['Tackle', 'Surf'])
  })

  it('rejects any payload drift before applying state', () => {
    const input = planned('TM 24 - Thunderbolt')
    const drifted = structuredClone(input.plan)
    const targetOperation = drifted.operations.find(row => row.payload.action === 'learn-machine-move')!
    ;(targetOperation.payload.application as Record<string, unknown>).moveId = 'Thunder'
    expect(() => assertItemRuntimePlanConformance({
      definition: input.definition,
      plan: drifted,
      compensation: compensation(input.trainer, input.pokemon),
      command: input.command,
    })).toThrow('invalid machine Move-learning payload')
    expect(() => reduceItemOperationPlan({
      plan: drifted,
      map: null,
      sheets: new Map([['trainer:ash', input.trainer], ['pokemon:spark', input.pokemon]]),
      groupInventory: null,
    })).toThrow()
  })
})
