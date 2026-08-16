import { describe, expect, it } from 'vitest'
import { parseItemNonEncounterExecutionSnapshot } from '#shared/itemAutomation/nonEncounter'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { CharacterSheet, StatKey } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import {
  ITEM_EVOLUTION_CONFIRMATION_CHOICE_ID,
  ITEM_EVOLUTION_DESTINATION_CHOICE_ID,
  previewItemEvolution,
} from '../../server/domain/itemAutomation/evolution'
import { planDeterministicItemOperation } from '../../server/domain/itemAutomation/planner'
import { reduceItemOperationPlan } from '../../server/domain/itemAutomation/reducer'
import { assertItemRuntimePlanConformance } from '../../server/domain/itemAutomation/conformance'
import type { ItemOperationCompensationV1 } from '../../server/storage/itemOperationRepository'

const targetId = 'sheet-target:v1:pokemon:volt'
const sourceInstanceId = 'item-instance:trainer:ash:pokemonItems:thunder-row'
const statKeys: readonly StatKey[] = ['hp', 'atk', 'def', 'satk', 'sdef', 'spd']

const target = (): CharacterSheet => ({
  slug: 'volt', nickname: 'Volt', species: 'Pikachu', level: 25, revision: 2,
  gender: 'Male', nature: 'Hardy',
  stats: Object.fromEntries(statKeys.map(key => [key, { added: key === 'spd' ? 35 : 0 }])),
  abilities: [{ name: 'Static' }], movelist: [{ name: 'Quick Attack' }],
})
const actor = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3, currentTeam: ['volt'],
  inventory: { pokemonItems: [{ id: 'thunder-row', name: 'Thunder Stone', qty: 1 }] },
})

const build = () => {
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Thunder Stone')
  const pokemon = target()
  const trainer = actor()
  const preview = previewItemEvolution({
    definition, sheetKind: 'pokemon', sheet: pokemon,
    actorKind: 'trainer', sourceInstanceId,
  })
  const destination = preview.choices.find(choice => choice.choiceId === ITEM_EVOLUTION_DESTINATION_CHOICE_ID)!.options[0]!
  const command: UseItemCommandV1 = {
    schemaVersion: 1,
    operationId: 'sheet-item:v1:evolution00000000000000000000001',
    context: 'sheet', offerId: 'offer:evolution', sourceInstanceId,
    actorParticipantId: null,
    actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
    source: { kind: 'trainer', slug: 'ash', section: 'pokemonItems', rowId: 'thunder-row', expectedRevision: 3 },
    targetIds: [targetId],
    choices: [
      { choiceId: 'target', optionIds: [targetId] },
      { choiceId: ITEM_EVOLUTION_DESTINATION_CHOICE_ID, optionIds: [destination.optionId] },
      { choiceId: ITEM_EVOLUTION_CONFIRMATION_CHOICE_ID, optionIds: ['confirmed'] },
    ],
    readSet: [
      { kind: 'campaign-clock', id: 'campaign', revision: 5 },
      { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
      { kind: 'sheet', sheetKind: 'pokemon', id: 'volt', revision: 2 },
    ],
  }
  const nonEncounterContext = parseItemNonEncounterExecutionSnapshot({
    schemaVersion: 1, context: 'sheet',
    campaignTime: { clockRevision: 5, campaignMinute: 1_500 },
    actor: { sheetKind: 'trainer', sheetSlug: 'ash', sheetRevision: 3 },
    targetAuthorities: [{
      targetId, sheetKind: 'pokemon', sheetSlug: 'volt', sheetRevision: 2,
      ownerTrainerSlug: 'ash', authority: 'actor-roster',
    }],
    extendedAction: { mode: 'immediate', phase: 'completion', activityId: null, activityRevision: null, startedAtCampaignMinute: null },
    gmConfirmation: { required: false, status: 'not-required', evidenceId: null },
  })
  const plan = planDeterministicItemOperation({
    command, definition,
    source: {
      containerKind: 'trainer', containerSlug: 'ash', section: 'pokemonItems',
      rowId: 'thunder-row', instanceId: sourceInstanceId, canonicalItemId: 'Thunder Stone',
      displayLabel: 'Thunder Stone', quantity: 1, revision: 3,
      ownerSheet: { kind: 'trainer', slug: 'ash' },
    },
    targets: [{ participantId: targetId, sheetKind: 'pokemon', sheetSlug: 'volt', revision: 2, sheet: pokemon }],
    actorSheet: trainer,
    campaignMinute: 1_500,
    operationTimestamp: 50_000,
    nonEncounterContext,
  })
  return { definition, pokemon, trainer, command, plan }
}

const compensation = (
  trainer: TrainerSheet,
  pokemon: CharacterSheet,
): ItemOperationCompensationV1 => ({
  schemaVersion: 1,
  map: null,
  sheets: [
    { kind: 'trainer', slug: 'ash', beforeRevision: 3, afterRevision: 4, beforeSheet: trainer, afterSheet: trainer },
    { kind: 'pokemon', slug: 'volt', beforeRevision: 2, afterRevision: 3, beforeSheet: pokemon, afterSheet: pokemon },
  ],
  groupInventory: null,
})

describe('Evolutionary Item deterministic operation', () => {
  it('plans, conforms, consumes, and applies the species transition atomically', () => {
    const input = build()
    expect(input.plan.operations.map(row => [row.operationId, row.kind])).toEqual([
      ['inventory.consume', 'inventory'],
      [`target.${targetId}.evolution`, 'campaign-fact'],
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
      sheets: new Map([['trainer:ash', input.trainer], ['pokemon:volt', input.pokemon]]),
      groupInventory: null,
    })
    expect((reduced.sheets.get('trainer:ash') as TrainerSheet).inventory?.pokemonItems).toEqual([])
    expect(reduced.sheets.get('pokemon:volt')).toMatchObject({
      species: 'Raichu', itemEvolutionLocked: true,
      itemEvolutionAttention: { statAllocation: { status: 'open', required: 35 } },
    })
    expect(reduced.changedSheetKeys).toEqual(['pokemon:volt', 'trainer:ash'])
  })

  it('rejects payload drift before either mutation can commit', () => {
    const input = build()
    const drifted = structuredClone(input.plan)
    const evolution = drifted.operations.find(row => row.payload.action === 'evolve-pokemon')!
    evolution.payload.resultingSpecies = 'Pikachu'
    expect(() => assertItemRuntimePlanConformance({
      definition: input.definition,
      plan: drifted,
      compensation: compensation(input.trainer, input.pokemon),
      command: input.command,
    })).toThrow('invalid evolution payload')
    expect(() => reduceItemOperationPlan({
      plan: drifted,
      map: null,
      sheets: new Map([['trainer:ash', input.trainer], ['pokemon:volt', input.pokemon]]),
      groupInventory: null,
    })).toThrow('evolution mechanics drifted')
  })
})
