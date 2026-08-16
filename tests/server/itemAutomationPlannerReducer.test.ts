import { describe, expect, it } from 'vitest'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { planDeterministicItemOperation } from '../../server/domain/itemAutomation/planner'
import { reduceItemOperationPlan } from '../../server/domain/itemAutomation/reducer'
import type { ItemRuntimeDefinition } from '#shared/itemAutomation/spec'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { CharacterSheet } from '~/types/characterSheet'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { TabletopMap } from '~/types/map'
import { applyCombatStagesToSheet } from '~/utils/sheetMutations'
import {
  ITEM_DIRE_HIT_CAPABILITY_ID,
  ITEM_GUARD_SPEC_CAPABILITY_ID,
} from '../../server/domain/itemAutomation/combatEffects'
import {
  resolveAuthoritativeDigestionBuffStorage,
  storeAuthoritativeDigestionBuff,
} from '../../server/domain/itemAutomation/digestionBuffs'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'
import { assertItemRuntimePlanConformance } from '../../server/domain/itemAutomation/conformance'
import type { ItemOperationCompensationV1 } from '../../server/storage/itemOperationRepository'
import { parseItemNonEncounterExecutionSnapshot } from '#shared/itemAutomation/nonEncounter'

const trainer = (): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3,
  inventory: { medicalKit: [{ id: 'potion-row', name: 'Potion', qty: 2 }] },
})
const pokemon = (): CharacterSheet => ({
  slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', level: 5, revision: 2,
  stats: { hp: { added: 0 } }, combat: { currentHp: 1 },
})
const map = (): TabletopMap => ({
  schemaVersion: 2, slug: 'arena', name: 'Arena', revision: 4,
  dimensions: { x: 5, y: 3, z: 5 }, voxels: [], createdAt: 1, updatedAt: 10,
  placements: [
    { id: 'ash-placement', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 1, y: 0, z: 1 } },
    { id: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 2, y: 0, z: 1 } },
  ],
  encounterState: {
    ...createEmptyEncounterState(),
    turnResources: { 'ash-placement': createEncounterTurnResourceLedger({ placementId: 'ash-placement', round: 1 }) },
  },
  initiative: { activeId: 'ash-placement', round: 1 },
})
const command = (): UseItemCommandV1 => ({
  schemaVersion: 1,
  operationId: 'op_item_plan_reduce_0001',
  context: 'encounter',
  offerId: 'offer:item:potion',
  sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
  actorParticipantId: 'ash-placement',
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 3 },
  targetIds: ['pikachu-placement'],
  choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
  readSet: [
    { kind: 'map', id: 'arena', revision: 4 },
    { kind: 'encounter', id: 'arena', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
  ],
})

const FIRST_AID_TARGET_ID = 'sheet-target:v1:pokemon:pikachu'
const firstAidCompletionContext = (operationId: string, campaignMinute = 100) => (
  parseItemNonEncounterExecutionSnapshot({
    schemaVersion: 1,
    context: 'campaign',
    campaignTime: { clockRevision: 7, campaignMinute },
    actor: { sheetKind: 'trainer', sheetSlug: 'ash', sheetRevision: 3 },
    targetAuthorities: [{
      targetId: FIRST_AID_TARGET_ID,
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      sheetRevision: 2,
      ownerTrainerSlug: 'ash',
      authority: 'actor-roster',
    }],
    extendedAction: {
      mode: 'extended', phase: 'completion',
      activityId: `item-activity:${operationId}`, activityRevision: 1,
      startedAtCampaignMinute: campaignMinute,
    },
    gmConfirmation: { required: false, status: 'not-required', evidenceId: null },
  })
)

const planned = (overrides: {
  readonly command?: UseItemCommandV1
  readonly actorSheet?: TrainerSheet
} = {}) => planDeterministicItemOperation({
  command: overrides.command ?? command(),
  definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Potion'),
  source: {
    containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'potion-row',
    instanceId: 'item-instance:trainer:ash:medicalKit:potion-row', canonicalItemId: 'Potion',
    displayLabel: 'Potion', quantity: 2, revision: 3, ownerSheet: { kind: 'trainer', slug: 'ash' },
  },
  targets: [{ participantId: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu', revision: 2, sheet: pokemon() }],
  actorSheet: overrides.actorSheet ?? trainer(),
})

describe('deterministic item planner and reducer', () => {
  it('orders exact consumption, target effect, and action spending before any persistence', () => {
    const plan = planned()
    expect(plan.operations.map(operation => [operation.ordinal, operation.operationId, operation.kind])).toEqual([
      [0, 'inventory.consume', 'inventory'],
      [1, 'target.pikachu-placement.primary', 'hp'],
      [2, 'target.pikachu-placement.restorative-forfeit', 'resource'],
      [3, 'encounter.spend-action', 'resource'],
    ])
    expect(plan.canonicalDefinitionSha256).toBe(ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Potion').definitionSha256)
  })

  it('purely reduces inventory, HP, and the Standard Action ledger together', () => {
    const sourceTrainer = trainer()
    const targetPokemon = pokemon()
    const sourceMap = map()
    const reduced = reduceItemOperationPlan({
      plan: planned(),
      map: sourceMap,
      sheets: new Map([['trainer:ash', sourceTrainer], ['pokemon:pikachu', targetPokemon]]),
      groupInventory: null,
    })
    expect((reduced.sheets.get('trainer:ash') as TrainerSheet).inventory?.medicalKit).toEqual([
      { id: 'potion-row', name: 'Potion', qty: 1 },
    ])
    expect((reduced.sheets.get('pokemon:pikachu') as CharacterSheet).combat?.currentHp).toBe(21)
    expect(reduced.map?.encounterState?.turnResources['ash-placement']?.actions.standard.spent).toBe(1)
    expect(reduced.map?.encounterState?.turnResources['pikachu-placement']?.oncePerTurnFlags).toEqual([
      expect.objectContaining({ id: 'item.restorative.target-next-turn-forfeit' }),
    ])
    expect(sourceTrainer.inventory?.medicalKit?.[0]?.qty).toBe(2)
    expect(targetPokemon.combat?.currentHp).toBe(1)
    expect(sourceMap.encounterState?.turnResources['ash-placement']?.actions.standard.spent).toBe(0)
    expect(planned().operations[1]?.payload).toMatchObject({
      calculationKind: 'fixed', requestedHealing: 20, effectiveHealing: 20,
      overheal: 0, resultingHp: 21, cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve',
    })
  })

  it('applies reviewed restorative action consequences and the Medic Training exception', () => {
    const medic = trainer()
    medic.edges = [{ name: 'Medic Training' }]
    const medicPlan = planned({ actorSheet: medic })
    expect(medicPlan.operations.some(operation => operation.operationId.endsWith('restorative-forfeit'))).toBe(false)
    expect(medicPlan.operations.find(operation => operation.operationId === 'encounter.spend-action')?.payload)
      .toMatchObject({ action: 'spend', resourceId: 'standard', amount: 1 })

    const selfCommand = structuredClone(command())
    selfCommand.targetIds = ['ash-placement']
    selfCommand.choices = [{ choiceId: 'target', optionIds: ['ash-placement'] }]
    selfCommand.readSet = selfCommand.readSet.filter(ref => ref.kind !== 'sheet' || ref.id !== 'pikachu')
    const selfPlan = planDeterministicItemOperation({
      command: selfCommand,
      definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Potion'),
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'potion-row',
        instanceId: 'item-instance:trainer:ash:medicalKit:potion-row', canonicalItemId: 'Potion',
        displayLabel: 'Potion', quantity: 2, revision: 3, ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{ participantId: 'ash-placement', sheetKind: 'trainer', sheetSlug: 'ash', revision: 3, sheet: trainer() }],
      actorSheet: trainer(),
    })
    expect(selfPlan.operations.some(operation => operation.operationId.endsWith('restorative-forfeit'))).toBe(false)
    expect(selfPlan.operations.find(operation => operation.operationId === 'encounter.spend-action')?.payload)
      .toMatchObject({ action: 'spend', resourceId: 'full', amount: 1 })
  })

  it('caps injured healing exactly and preserves Fainted as separate state', () => {
    const injured = pokemon()
    injured.combat = { currentHp: 20, injuries: 2, conditions: ['Fainted'] }
    const injuryPlan = structuredClone(planned())
    const targetHp = injuryPlan.operations.find(operation => operation.kind === 'hp')!
    const fullMaximum = 27
    const effectiveMaximum = 21
    targetHp.payload = {
      action: 'heal', calculationKind: 'fixed', currentHp: 20,
      fullFormulaMaximumHp: fullMaximum, effectiveMaximumHp: effectiveMaximum, injuries: 2,
      requestedHealing: 100, effectiveHealing: 1, overheal: 99, resultingHp: 21, roll: null,
      cap: 'injury-adjusted-effective-maximum-hp', faintedState: 'preserve',
    }
    const reduced = reduceItemOperationPlan({
      plan: injuryPlan, map: map(),
      sheets: new Map([['trainer:ash', trainer()], ['pokemon:pikachu', injured]]), groupInventory: null,
    })
    const result = reduced.sheets.get('pokemon:pikachu') as CharacterSheet
    expect(result.combat?.currentHp).toBe(21)
    expect(result.combat?.conditions).toContain('Fainted')
  })

  it('plans and reduces a reusable First Aid Kit skill check, cure, and Extended-Rest AP drain atomically', () => {
    const medic = trainer()
    medic.inventory = { medicalKit: [{ id: 'first-aid-row', name: 'First Aid Kit', qty: 1 }] }
    medic.skillBackground = { adept: 'medicineEd' }
    medic.skills = { medicineEd: { modifier: 2 } }
    const target = pokemon()
    target.combat = { currentHp: 1, conditions: ['Burned', 'Badly Poisoned', 'Confused'] }
    const firstAidCommand: UseItemCommandV1 = {
      ...command(),
      operationId: 'op_item_first_aid_0001',
      context: 'campaign',
      offerId: 'offer:item:first-aid',
      sourceInstanceId: 'item-instance:trainer:ash:medicalKit:first-aid-row',
      actorParticipantId: null,
      source: {
        kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'first-aid-row', expectedRevision: 3,
      },
      targetIds: [FIRST_AID_TARGET_ID],
      choices: [{ choiceId: 'target', optionIds: [FIRST_AID_TARGET_ID] }],
      readSet: [
        { kind: 'campaign-clock', id: 'campaign', revision: 7 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
      ],
    }
    const draws = [4, 5, 6, 2]
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('First Aid Kit')
    const firstAidPlan = planDeterministicItemOperation({
      command: firstAidCommand,
      definition,
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'first-aid-row',
        instanceId: firstAidCommand.sourceInstanceId, canonicalItemId: 'First Aid Kit',
        displayLabel: 'First Aid Kit', quantity: 1, revision: 3, ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{
        participantId: FIRST_AID_TARGET_ID, sheetKind: 'pokemon', sheetSlug: 'pikachu', revision: 2, sheet: target,
      }],
      actorSheet: medic,
      campaignMinute: 100,
      nonEncounterContext: firstAidCompletionContext(firstAidCommand.operationId),
      operationTimestamp: 1_700_000_000_000,
      rollHealingDie: sides => {
        expect(sides).toBe(6)
        return draws.shift()!
      },
    })
    expect(draws).toEqual([])
    expect(firstAidPlan.operations.map(operation => [operation.operationId, operation.kind])).toEqual([
      ['actor.ap-drain.1', 'resource'],
      [`target.${FIRST_AID_TARGET_ID}.medicine-check`, 'hp'],
      [`target.${FIRST_AID_TARGET_ID}.conditions`, 'condition'],
    ])
    expect(firstAidPlan.operations.find(operation => operation.kind === 'resource')?.payload).toMatchObject({
      action: 'drain-ap', amount: 1, availableBefore: 7, availableAfter: 6,
      canonicalItemId: 'First Aid Kit', createdAt: 1_700_000_000_000, round: null,
    })
    expect(firstAidPlan.operations.find(operation => operation.kind === 'hp')?.payload).toMatchObject({
      calculationKind: 'skill-check', requestedHealing: 19, effectiveHealing: 19, resultingHp: 20,
      roll: {
        expression: '4d6+2', rolls: [4, 5, 6, 2], modifier: 2, total: 19,
        skillId: 'medicineEd', rankValue: 4, dieSides: 6,
        actorSheetKind: 'trainer', actorSheetSlug: 'ash', actorSheetRevision: 3,
      },
    })
    expect(firstAidPlan.operations.find(operation => operation.kind === 'condition')?.payload).toEqual({
      action: 'remove', mode: 'listed', selection: 'all-applicable',
      currentConditions: ['Burned', 'Badly Poisoned', 'Confused'],
      removedConditionIds: ['Burned', 'Badly Poisoned'],
      removedEntries: ['Burned', 'Badly Poisoned'], resultingConditions: ['Confused'],
    })
    expect(firstAidPlan.operations.some(operation => operation.kind === 'inventory')).toBe(false)

    const reduced = reduceItemOperationPlan({
      plan: firstAidPlan,
      map: null,
      sheets: new Map([['trainer:ash', medic], ['pokemon:pikachu', target]]),
      groupInventory: null,
    })
    const reducedMedic = reduced.sheets.get('trainer:ash') as TrainerSheet
    const reducedTarget = reduced.sheets.get('pokemon:pikachu') as CharacterSheet
    expect(reducedMedic.inventory?.medicalKit).toEqual([{ id: 'first-aid-row', name: 'First Aid Kit', qty: 1 }])
    expect(reducedMedic.featureApState?.drains).toEqual([
      expect.objectContaining({
        sourceInstanceId: firstAidCommand.sourceInstanceId,
        canonicalId: 'First Aid Kit', amount: 1, recovery: 'extended-rest',
      }),
    ])
    expect(reducedTarget.combat).toMatchObject({ currentHp: 20, conditions: ['Confused'] })

    const compensation: ItemOperationCompensationV1 = {
      schemaVersion: 1,
      map: null,
      sheets: [
        { kind: 'trainer', slug: 'ash', beforeRevision: 3, afterRevision: 4, beforeSheet: {}, afterSheet: {} },
        { kind: 'pokemon', slug: 'pikachu', beforeRevision: 2, afterRevision: 3, beforeSheet: {}, afterSheet: {} },
      ],
      groupInventory: null,
    }
    expect(() => assertItemRuntimePlanConformance({ definition, plan: firstAidPlan, compensation })).not.toThrow()

    const forged = structuredClone(firstAidPlan)
    const forgedRoll = forged.operations.find(operation => operation.kind === 'hp')!.payload.roll as Record<string, unknown>
    forgedRoll.rankValue = 3
    expect(() => reduceItemOperationPlan({
      plan: forged, map: null,
      sheets: new Map([['trainer:ash', medic], ['pokemon:pikachu', target]]), groupInventory: null,
    })).toThrow('does not match the authoritative Trainer skill')
    expect(() => assertItemRuntimePlanConformance({ definition, plan: forged, compensation }))
      .toThrow('invalid item skill-check evidence')
  })

  it('rejects a First Aid Kit AP deficit before rolling or changing reusable inventory', () => {
    const medic = trainer()
    medic.inventory = { medicalKit: [{ id: 'first-aid-row', name: 'First Aid Kit', qty: 1 }] }
    medic.ap = { max: 1 }
    medic.featureApState = {
      schemaVersion: 1, max: 1, spent: 0, bindings: [], temporary: [],
      drains: [{
        drainId: 'existing-drain', sourceInstanceId: 'feature:existing', canonicalId: 'Existing',
        amount: 1, recovery: 'extended-rest', createdAt: 1,
      }],
    }
    const firstAidCommand: UseItemCommandV1 = {
      ...command(), context: 'campaign', actorParticipantId: null,
      sourceInstanceId: 'item-instance:trainer:ash:medicalKit:first-aid-row',
      source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'first-aid-row', expectedRevision: 3 },
      targetIds: [FIRST_AID_TARGET_ID],
      choices: [{ choiceId: 'target', optionIds: [FIRST_AID_TARGET_ID] }],
      readSet: [
        { kind: 'campaign-clock', id: 'campaign', revision: 7 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
      ],
    }
    let rolls = 0
    expect(() => planDeterministicItemOperation({
      command: firstAidCommand,
      definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('First Aid Kit'),
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'first-aid-row',
        instanceId: firstAidCommand.sourceInstanceId, canonicalItemId: 'First Aid Kit',
        displayLabel: 'First Aid Kit', quantity: 1, revision: 3, ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{ participantId: FIRST_AID_TARGET_ID, sheetKind: 'pokemon', sheetSlug: 'pikachu', revision: 2, sheet: pokemon() }],
      actorSheet: medic,
      campaignMinute: 100,
      nonEncounterContext: firstAidCompletionContext(firstAidCommand.operationId),
      operationTimestamp: 10,
      rollHealingDie: () => { rolls += 1; return 6 },
    })).toThrow('requires 1 available AP')
    expect(rolls).toBe(0)
    expect(medic.inventory?.medicalKit).toHaveLength(1)
  })

  it('plans and reduces reviewed condition removal with exact before/removed/after evidence', () => {
    const antidoteTrainer = trainer()
    antidoteTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: 'Antidote', qty: 2 }] }
    const poisoned = pokemon()
    poisoned.combat = { currentHp: 20, conditions: ['Badly Poisoned', 'Confused', 'Slowed'] }
    const antidotePlan = planDeterministicItemOperation({
      command: command(),
      definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Antidote'),
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'potion-row',
        instanceId: 'item-instance:trainer:ash:medicalKit:potion-row', canonicalItemId: 'Antidote',
        displayLabel: 'Antidote', quantity: 2, revision: 3, ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{ participantId: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu', revision: 2, sheet: poisoned }],
      actorSheet: antidoteTrainer,
    })
    expect(antidotePlan.operations.find(operation => operation.kind === 'condition')?.payload).toEqual({
      action: 'remove', mode: 'listed', selection: 'all-applicable',
      currentConditions: ['Badly Poisoned', 'Confused', 'Slowed'],
      removedConditionIds: ['Badly Poisoned'], removedEntries: ['Badly Poisoned'],
      resultingConditions: ['Confused', 'Slowed'],
    })
    expect(antidotePlan.receiptFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Badly Poisoned cured.' }),
    ]))
    const reduced = reduceItemOperationPlan({
      plan: antidotePlan, map: map(),
      sheets: new Map([['trainer:ash', antidoteTrainer], ['pokemon:pikachu', poisoned]]),
      groupInventory: null,
    })
    expect((reduced.sheets.get('pokemon:pikachu') as CharacterSheet).combat?.conditions).toEqual(['Confused', 'Slowed'])
  })

  it('plans and reduces capped X-Item stages with immutable before/delta/after evidence', () => {
    const xTrainer = trainer()
    xTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: 'X Attack', qty: 2 }] }
    const staged = applyCombatStagesToSheet('pokemon', pokemon(), {
      atk: 5, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0,
    }) as CharacterSheet
    const xPlan = planDeterministicItemOperation({
      command: command(),
      definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('X Attack'),
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'potion-row',
        instanceId: 'item-instance:trainer:ash:medicalKit:potion-row', canonicalItemId: 'X Attack',
        displayLabel: 'X Attack', quantity: 2, revision: 3, ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{ participantId: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu', revision: 2, sheet: staged }],
      actorSheet: xTrainer,
      map: map(),
    })
    expect(xPlan.operations.find(operation => operation.kind === 'stage')?.payload).toEqual({
      action: 'modify', stat: 'atk', previous: 5, requestedDelta: 2,
      appliedDelta: 1, current: 6, minimum: -6, maximum: 6, capped: true,
    })
    expect(xPlan.receiptFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Attack +5 → +6 (+1 stage; capped)' }),
    ]))
    expect(xPlan.operations.find(operation => operation.operationId === 'encounter.spend-action')?.payload)
      .toEqual({ action: 'spend', resourceId: 'standard', amount: 1 })
    const reduced = reduceItemOperationPlan({
      plan: xPlan, map: map(),
      sheets: new Map([['trainer:ash', xTrainer], ['pokemon:pikachu', staged]]), groupInventory: null,
    })
    expect((reduced.sheets.get('pokemon:pikachu') as CharacterSheet).stats?.atk?.stage).toBe(6)
    const forged = structuredClone(xPlan)
    const stage = forged.operations.find(operation => operation.kind === 'stage')!
    stage.payload.current = 5
    expect(() => reduceItemOperationPlan({
      plan: forged, map: map(),
      sheets: new Map([['trainer:ash', xTrainer], ['pokemon:pikachu', staged]]), groupInventory: null,
    })).toThrow('stage resolution does not match authoritative target state')
  })

  it('atomically consumes a Snack and stores its reviewed Digestion Buff without restorative timing debt', () => {
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { foodStuff: [{ id: 'snack-row', name: 'Candy Bar', qty: 2 }] }
    const snackCommand = structuredClone(command())
    snackCommand.sourceInstanceId = 'item-instance:trainer:ash:foodStuff:snack-row'
    snackCommand.source = { kind: 'trainer', slug: 'ash', section: 'foodStuff', rowId: 'snack-row', expectedRevision: 3 }
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Candy Bar')
    const plan = planDeterministicItemOperation({
      command: snackCommand,
      definition,
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'foodStuff', rowId: 'snack-row',
        instanceId: snackCommand.sourceInstanceId, canonicalItemId: 'Candy Bar',
        displayLabel: 'Candy Bar', quantity: 2, revision: 3, ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{
        participantId: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu',
        revision: 2, sheet: pokemon(),
      }],
      actorSheet: sourceTrainer,
      map: map(),
    })
    expect(plan.operations.map(operation => [operation.operationId, operation.kind])).toEqual([
      ['inventory.consume', 'inventory'],
      ['target.pikachu-placement.primary', 'inventory'],
      ['encounter.spend-action', 'resource'],
    ])
    expect(plan.receiptFacts.map(fact => fact.label)).toEqual(expect.arrayContaining([
      'Stores a Digestion Buff that restores 5 HP when traded.',
    ]))
    const reduced = reduceItemOperationPlan({
      plan,
      map: map(),
      sheets: new Map([['trainer:ash', sourceTrainer], ['pokemon:pikachu', pokemon()]]),
      groupInventory: null,
    })
    expect((reduced.sheets.get('trainer:ash') as TrainerSheet).inventory?.foodStuff).toEqual([
      { id: 'snack-row', name: 'Candy Bar', qty: 1 },
    ])
    expect((reduced.sheets.get('pokemon:pikachu') as CharacterSheet).items?.digestionFood).toBe('Candy Bar')
    expect(reduced.map?.encounterState?.turnResources['pikachu-placement']?.oncePerTurnFlags ?? []).toEqual([])
  })

  it('rejects an occupied Digestion Buff slot without mutating source or target snapshots', () => {
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { foodStuff: [{ id: 'snack-row', name: 'Leftovers', qty: 1 }] }
    const target = pokemon()
    target.items = { digestionFood: 'Candy Bar' }
    const snackCommand = structuredClone(command())
    snackCommand.sourceInstanceId = 'item-instance:trainer:ash:foodStuff:snack-row'
    snackCommand.source = { kind: 'trainer', slug: 'ash', section: 'foodStuff', rowId: 'snack-row', expectedRevision: 3 }
    const plan = planDeterministicItemOperation({
      command: snackCommand,
      definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Leftovers'),
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'foodStuff', rowId: 'snack-row',
        instanceId: snackCommand.sourceInstanceId, canonicalItemId: 'Leftovers',
        displayLabel: 'Leftovers', quantity: 1, revision: 3, ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{ participantId: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu', revision: 2, sheet: target }],
      actorSheet: sourceTrainer,
      map: map(),
    })
    expect(() => reduceItemOperationPlan({
      plan, map: map(),
      sheets: new Map([['trainer:ash', sourceTrainer], ['pokemon:pikachu', target]]),
      groupInventory: null,
    })).toThrow('Digestion Buff storage reached its authoritative capacity 1.')
    expect(sourceTrainer.inventory?.foodStuff?.[0]?.qty).toBe(1)
    expect(target.items?.digestionFood).toBe('Candy Bar')
  })

  it('uses effective Gluttony for three slots and falls back to one while suppression is active', () => {
    const target = pokemon()
    target.abilities = [{
      name: 'Gluttony', automation: {
        schemaVersion: 1, instanceId: 'base:gluttony', canonicalId: 'Gluttony',
        definitionVersion: null, selections: [],
      },
    }]
    target.items = { digestionFoods: ['Candy Bar', 'Honey'] }
    const activeMap = map()
    const placement = activeMap.placements.find(candidate => candidate.id === 'pikachu-placement')!
    expect(resolveAuthoritativeDigestionBuffStorage({
      kind: 'pokemon', sheet: target, placement, map: activeMap,
    })).toMatchObject({ names: ['Candy Bar', 'Honey'], capacity: 3, hasEffectiveGluttony: true })
    const stored = storeAuthoritativeDigestionBuff({
      kind: 'pokemon', sheet: target, placement, map: activeMap,
      definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Leftovers'),
    }) as CharacterSheet
    expect(stored.items?.digestionFoods).toEqual(['Candy Bar', 'Honey', 'Leftovers'])

    const suppression = creatureRuleOverlayEncounterEffectFixture({
      domain: 'ability', action: 'suppress', values: [], referencePlacementId: null,
      suppressionScope: 'all',
    })
    activeMap.encounterState = {
      ...activeMap.encounterState!,
      effects: [{
        ...suppression,
        affected: { placementIds: [placement.id], sideIds: [], cells: [] },
        payload: { ...suppression.payload, suppressionScope: 'all' },
      }],
    }
    expect(() => resolveAuthoritativeDigestionBuffStorage({
      kind: 'pokemon', sheet: target, placement, map: activeMap,
    })).toThrow('Digestion Buff storage exceeds its authoritative capacity 1.')
  })

  it.each([
    ['Dire Hit', ITEM_DIRE_HIT_CAPABILITY_ID, 'replace', 'encounter', null],
    ['Guard Spec', ITEM_GUARD_SPEC_CAPABILITY_ID, 'refresh', 'turns', 5],
  ] as const)('durably applies and reapplies %s through typed encounter effects', (canonicalId, capabilityId, stackPolicy, durationKind, remaining) => {
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: canonicalId, qty: 3 }] }
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId)
    const firstPlan = planDeterministicItemOperation({
      command: command(), definition,
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'potion-row',
        instanceId: 'item-instance:trainer:ash:medicalKit:potion-row', canonicalItemId: canonicalId,
        displayLabel: canonicalId, quantity: 3, revision: 3, ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{ participantId: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu', revision: 2, sheet: pokemon() }],
      actorSheet: sourceTrainer,
      map: map(),
    })
    expect(firstPlan.operations.map(operation => operation.kind)).toEqual([
      'inventory', 'effect', 'resource', 'resource',
    ])
    const first = reduceItemOperationPlan({
      plan: firstPlan, map: map(),
      sheets: new Map([['trainer:ash', sourceTrainer], ['pokemon:pikachu', pokemon()]]), groupInventory: null,
    })
    const effect = first.map?.encounterState?.effects.find(value => value.payload && 'capabilityId' in value.payload
      && value.payload.capabilityId === capabilityId)
    expect(effect).toMatchObject({
      kind: 'capability', stackPolicy: { kind: stackPolicy }, transferPolicy: 'expire',
      source: { placementId: 'ash-placement' },
      affected: { placementIds: ['pikachu-placement'] },
      payload: { capabilityId, action: 'grant', value: canonicalId === 'Dire Hit' ? 2 : 5 },
      duration: { kind: durationKind, remaining },
    })
    expect(firstPlan.receiptFacts.map(fact => fact.label).join(' ')).toContain(
      canonicalId === 'Dire Hit' ? 'Critical Hit Range +2' : 'prevented for 5 target turns',
    )

    const secondCommand = structuredClone(command())
    secondCommand.operationId = 'op_item_plan_reduce_0002'
    const secondPlan = planDeterministicItemOperation({
      command: secondCommand, definition,
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'potion-row',
        instanceId: 'item-instance:trainer:ash:medicalKit:potion-row', canonicalItemId: canonicalId,
        displayLabel: canonicalId, quantity: 2, revision: 3, ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{ participantId: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu', revision: 2, sheet: pokemon() }],
      actorSheet: sourceTrainer,
      map: first.map,
    })
    const reapplicationMap = structuredClone(first.map!)
    const targetLedger = reapplicationMap.encounterState!.turnResources['pikachu-placement']
    if (targetLedger) targetLedger.oncePerTurnFlags = []
    reapplicationMap.encounterState!.turnResources['ash-placement']!.actions.standard.spent = 0
    const second = reduceItemOperationPlan({
      plan: secondPlan, map: reapplicationMap,
      sheets: new Map([['trainer:ash', sourceTrainer], ['pokemon:pikachu', pokemon()]]), groupInventory: null,
    })
    const matching = second.map?.encounterState?.effects.filter(value => value.payload && 'capabilityId' in value.payload
      && value.payload.capabilityId === capabilityId) ?? []
    expect(matching).toHaveLength(1)
    expect(matching[0]?.source.operationId).not.toBe(effect?.source.operationId)
    expect(matching[0]?.duration.remaining).toBe(remaining)

    if (canonicalId === 'Guard Spec' && effect?.duration.kind === 'turns') {
      const partiallyElapsedMap = structuredClone(first.map!)
      const active = partiallyElapsedMap.encounterState!.effects.find(value => value.id === effect.id)!
      if (active.duration.kind !== 'turns') throw new Error('Expected Guard Spec turn duration.')
      active.duration.remaining = 2
      partiallyElapsedMap.encounterState!.turnResources['ash-placement']!.actions.standard.spent = 0
      const targetLedger = partiallyElapsedMap.encounterState!.turnResources['pikachu-placement']
      if (targetLedger) targetLedger.oncePerTurnFlags = []
      const refreshed = reduceItemOperationPlan({
        plan: secondPlan, map: partiallyElapsedMap,
        sheets: new Map([['trainer:ash', sourceTrainer], ['pokemon:pikachu', pokemon()]]), groupInventory: null,
      })
      const refreshedEffect = refreshed.map?.encounterState?.effects.find(value => value.id === effect.id)
      expect(refreshedEffect?.duration).toMatchObject({ kind: 'turns', subject: 'target', boundary: 'end', remaining: 5 })
      expect(refreshedEffect?.source.operationId).not.toBe(effect.source.operationId)
    }
  })

  it('anchors generic daily temporary effects to the explicit persisted campaign minute', () => {
    const base = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Dire Hit')
    const dailyDefinition: ItemRuntimeDefinition = {
      ...base,
      definitionSha256: 'd'.repeat(64),
      spec: {
        ...base.spec,
        canonicalId: 'Daily Duration Fixture',
        duration: { kind: 'daily', amount: 2 },
      },
    }
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: 'Daily Duration Fixture', qty: 2 }] }
    const dailyCommand = command()
    dailyCommand.readSet = [
      ...dailyCommand.readSet,
      { kind: 'campaign-clock', id: 'campaign', revision: 7 },
    ]
    const dailyPlan = planDeterministicItemOperation({
      command: dailyCommand,
      definition: dailyDefinition,
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'potion-row',
        instanceId: 'item-instance:trainer:ash:medicalKit:potion-row', canonicalItemId: 'Daily Duration Fixture',
        displayLabel: 'Daily Duration Fixture', quantity: 2, revision: 3,
        ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{
        participantId: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu',
        revision: 2, sheet: pokemon(),
      }],
      actorSheet: sourceTrainer,
      map: map(),
      campaignMinute: 4_321,
    })
    expect(dailyPlan.operations.find(operation => operation.kind === 'effect')?.payload.effect)
      .toMatchObject({
        duration: {
          kind: 'campaign-time', remaining: null, startedAtCampaignMinute: 4_321,
          expiresAtCampaignMinute: 7_201, durationMinutes: 2_880,
        },
      })
    expect(() => planDeterministicItemOperation({
      command: dailyCommand,
      definition: dailyDefinition,
      source: {
        containerKind: 'trainer', containerSlug: 'ash', section: 'medicalKit', rowId: 'potion-row',
        instanceId: 'item-instance:trainer:ash:medicalKit:potion-row', canonicalItemId: 'Daily Duration Fixture',
        displayLabel: 'Daily Duration Fixture', quantity: 2, revision: 3,
        ownerSheet: { kind: 'trainer', slug: 'ash' },
      },
      targets: [{
        participantId: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu',
        revision: 2, sheet: pokemon(),
      }],
      actorSheet: sourceTrainer,
      map: map(),
    })).toThrow('Daily item durations require the authoritative nonnegative campaign minute.')
  })

  it('reduces reviewed condition categories deterministically without relying on listed IDs', () => {
    const conditionPlan = structuredClone(planned())
    conditionPlan.operations = [{
      operationId: 'target.conditions', ordinal: 0, kind: 'condition',
      aggregate: { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
      subjectId: 'pikachu-placement', payload: {
        action: 'remove', mode: 'persistent', selection: 'all-applicable',
        currentConditions: ['Burned', 'Confused', 'Tripped'],
        removedConditionIds: ['Burned'], removedEntries: ['Burned'],
        resultingConditions: ['Confused', 'Tripped'],
      },
      label: 'Remove persistent conditions',
    }]
    const target = pokemon()
    target.combat = { ...target.combat, conditions: ['Burned', 'Confused', 'Tripped'] }
    const reduced = reduceItemOperationPlan({
      plan: conditionPlan,
      map: map(),
      sheets: new Map([['trainer:ash', trainer()], ['pokemon:pikachu', target]]),
      groupInventory: null,
    })
    expect((reduced.sheets.get('pokemon:pikachu') as CharacterSheet).combat?.conditions).toEqual(['Confused', 'Tripped'])
  })

  it('rejects operation payload drift before returning any reduced documents', () => {
    const drifted = structuredClone(planned())
    drifted.operations[1]!.payload = { ...drifted.operations[1]!.payload, clientAmount: 999 }
    const before = pokemon()
    expect(() => reduceItemOperationPlan({
      plan: drifted, map: map(), sheets: new Map([['trainer:ash', trainer()], ['pokemon:pikachu', before]]), groupInventory: null,
    })).toThrow('invalid payload shape')
    expect(before.combat?.currentHp).toBe(1)
  })

  it('fails without producing a partial reduction when the action is already spent', () => {
    const sourceMap = map()
    const ledger = sourceMap.encounterState!.turnResources['ash-placement']!
    sourceMap.encounterState = {
      ...sourceMap.encounterState!,
      turnResources: {
        'ash-placement': { ...ledger, actions: { ...ledger.actions, standard: { ...ledger.actions.standard, spent: 1 } } },
      },
    }
    const sourceTrainer = trainer()
    expect(() => reduceItemOperationPlan({
      plan: planned(), map: sourceMap,
      sheets: new Map([['trainer:ash', sourceTrainer], ['pokemon:pikachu', pokemon()]]),
      groupInventory: null,
    })).toThrow()
    expect(sourceTrainer.inventory?.medicalKit?.[0]?.qty).toBe(2)
  })
})
