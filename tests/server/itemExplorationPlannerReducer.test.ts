import { describe, expect, it } from 'vitest'
import { planDeterministicItemOperation } from '../../server/domain/itemAutomation/planner'
import { reduceItemOperationPlan } from '../../server/domain/itemAutomation/reducer'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import {
  ITEM_BAIT_NEXT_TURN_STANDARD_FLAG_ID,
  ITEM_REPEL_NEXT_TURN_SHIFT_FLAG_ID,
  parseItemExplorationEncounterState,
  parseItemExplorationState,
} from '#shared/itemAutomation/exploration'
import { parseItemNonEncounterExecutionSnapshot } from '#shared/itemAutomation/nonEncounter'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { parseEncounterEvent } from '#shared/moveAutomation/events'
import {
  reduceEncounterResourceEvent,
  scheduleExplorationNextTurnForfeit,
} from '../../server/domain/moveAutomation/reduceEncounterResources'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { ItemRuntimeDefinition } from '#shared/itemAutomation/spec'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const trainer = (itemName: string, section: keyof NonNullable<TrainerSheet['inventory']> = 'foodStuff'): TrainerSheet => ({
  slug: 'ash', name: 'Ash', level: 10, revision: 3,
  skillBackground: { adept: 'occultEd' },
  inventory: { [section]: [{ id: 'item-row', name: itemName, qty: 2 }] },
})
const wild = (): CharacterSheet => ({
  slug: 'wild-rattata', nickname: 'Wild Rattata', species: 'Rattata', level: 5, revision: 2,
  skills: { focus: '2d6' }, capabilities: { overland: 4 },
  stats: { spd: { added: 0 } },
})
const arena = (): TabletopMap => ({
  schemaVersion: 2, slug: 'arena', name: 'Arena', revision: 4,
  dimensions: { x: 10, y: 3, z: 8 }, groundLevelY: 0,
  voxels: [], createdAt: 1, updatedAt: 10,
  placements: [
    { id: 'ash-placement', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 1, y: 0, z: 1 } },
    { id: 'wild-placement', sheetKind: 'pokemon', sheetSlug: 'wild-rattata', position: { x: 2, y: 0, z: 1 } },
  ],
  encounterState: {
    ...createEmptyEncounterState(),
    turnResources: { 'ash-placement': createEncounterTurnResourceLedger({ placementId: 'ash-placement', round: 1 }) },
  },
  initiative: { activeId: 'ash-placement', round: 1 },
})

const sheetTargetId = 'sheet-target:v1:trainer:ash'
const sourceInstanceId = (section: string): string => `item-instance:trainer:ash:${section}:item-row`
const snapshot = (context: 'campaign' | 'sheet' | 'extended-action', phase: 'immediate' | 'completion' = 'immediate') => (
  parseItemNonEncounterExecutionSnapshot({
    schemaVersion: 1,
    context,
    campaignTime: { clockRevision: 7, campaignMinute: 110 },
    actor: { sheetKind: 'trainer', sheetSlug: 'ash', sheetRevision: 3 },
    targetAuthorities: [{
      targetId: sheetTargetId, sheetKind: 'trainer', sheetSlug: 'ash', sheetRevision: 3,
      ownerTrainerSlug: 'ash', authority: 'actor',
    }],
    extendedAction: phase === 'completion'
      ? { mode: 'extended', phase: 'completion', activityId: 'item-activity:dowsing:00000001', activityRevision: 1, startedAtCampaignMinute: 100 }
      : { mode: 'immediate', phase: 'completion', activityId: null, activityRevision: null, startedAtCampaignMinute: null },
    gmConfirmation: { required: false, status: 'not-required', evidenceId: null },
  })
)

const nonEncounterCommand = (input: {
  itemName: string
  section?: string
  mode?: string
  context?: 'campaign' | 'sheet' | 'extended-action'
  choices?: UseItemCommandV1['choices']
  operationId?: string
}): UseItemCommandV1 => {
  const section = input.section ?? 'foodStuff'
  const context = input.context ?? 'campaign'
  return {
    schemaVersion: 1,
    operationId: input.operationId ?? `op_exploration_${input.itemName.toLowerCase().replace(/\s+/gu, '_')}_0001`,
    context,
    offerId: `offer:${input.itemName}`,
    sourceInstanceId: sourceInstanceId(section),
    actorParticipantId: null,
    actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
    source: { kind: 'trainer', slug: 'ash', section: section as never, rowId: 'item-row', expectedRevision: 3 },
    targetIds: [sheetTargetId],
    choices: [
      { choiceId: 'target', optionIds: [sheetTargetId] },
      ...(input.mode ? [{ choiceId: 'exploration-use-mode', optionIds: [input.mode] }] : []),
      ...(input.choices ?? []),
    ],
    readSet: [
      { kind: 'campaign-clock', id: 'campaign', revision: 7 },
      { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    ],
  }
}

const source = (definition: ItemRuntimeDefinition, section: string, quantity = 2) => ({
  containerKind: 'trainer' as const,
  containerSlug: 'ash', section: section as never, rowId: 'item-row',
  instanceId: sourceInstanceId(section), canonicalItemId: definition.canonicalId,
  displayLabel: definition.canonicalId, quantity, revision: 3,
  ownerSheet: { kind: 'trainer' as const, slug: 'ash' },
})

const planNonEncounter = (input: {
  itemName: string
  section?: string
  mode?: string
  context?: 'campaign' | 'sheet' | 'extended-action'
  choices?: UseItemCommandV1['choices']
  roll?: (sides: number) => number
}) => {
  const section = input.section ?? 'foodStuff'
  const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require(input.itemName)
  const actor = trainer(input.itemName, section as never)
  const command = nonEncounterCommand(input)
  return {
    actor,
    plan: planDeterministicItemOperation({
      command,
      definition,
      source: source(definition, section),
      targets: [{ participantId: sheetTargetId, sheetKind: 'trainer', sheetSlug: 'ash', revision: 3, sheet: actor }],
      actorSheet: actor,
      campaignMinute: 110,
      operationTimestamp: 1_700_000_000_000,
      nonEncounterContext: snapshot(command.context as 'campaign' | 'sheet' | 'extended-action', command.context === 'extended-action' ? 'completion' : 'immediate'),
      ...(input.roll ? { rollHealingDie: input.roll } : {}),
    }),
  }
}

describe('P8-057 exploration planner and reducer', () => {
  it.each([
    ['Bait', false],
    ['Fishing Lure', true],
    ['Honey', false],
  ] as const)('starts durable %s route checks and consumes only non-reusable sources', (itemName, reusable) => {
    const { actor, plan } = planNonEncounter({ itemName, mode: itemName === 'Fishing Lure' ? undefined : 'route-lure' })
    expect(plan.operations.map(operation => [operation.kind, operation.payload.action])).toContainEqual(['campaign-fact', 'start-route-lure'])
    expect(plan.operations.some(operation => operation.kind === 'inventory')).toBe(!reusable)
    const reduced = reduceItemOperationPlan({
      plan, map: null, sheets: new Map([['trainer:ash', actor]]), groupInventory: null,
    })
    const result = reduced.sheets.get('trainer:ash') as TrainerSheet
    expect(parseItemExplorationState(result.serverPrivate?.itemExploration).routeLures[0]).toMatchObject({
      canonicalItemId: itemName, reusable, startedAtCampaignMinute: 110,
      nextCheckAtCampaignMinute: 125, status: 'active',
    })
    expect(result.inventory?.foodStuff?.[0]?.qty).toBe(reusable ? 2 : 1)
  })

  it.each([
    ['Repel', 60, 15],
    ['Super Repel', 120, 25],
    ['Max Repel', 300, 35],
  ] as const)('applies %s as an exact campaign-clock route ward', (itemName, duration, maximumLevel) => {
    const { actor, plan } = planNonEncounter({ itemName, section: 'medicalKit', mode: 'route-ward' })
    const reduced = reduceItemOperationPlan({ plan, map: null, sheets: new Map([['trainer:ash', actor]]), groupInventory: null })
    const result = reduced.sheets.get('trainer:ash') as TrainerSheet
    expect(parseItemExplorationState(result.serverPrivate?.itemExploration).repels[0]).toMatchObject({
      canonicalItemId: itemName, startedAtCampaignMinute: 110,
      expiresAtCampaignMinute: 110 + duration, maximumAffectedWildLevel: maximumLevel,
    })
    expect(result.inventory?.medicalKit?.[0]?.qty).toBe(1)
  })

  it('resolves Dowsing only at Extended Action completion and grants exact color variants', () => {
    const rolls = [6, 4, 2, 5, 1, 4, 1, 2, 3, 4]
    const { actor, plan } = planNonEncounter({
      itemName: 'Dowsing Rod', section: 'keyItems', context: 'extended-action',
      choices: [
        { choiceId: 'dowsing-terrain', optionIds: ['cave'] },
        { choiceId: 'dowsing-skill-stunt', optionIds: [] },
      ],
      roll: sides => {
        expect(sides).toBe(6)
        return rolls.shift()!
      },
    })
    expect(rolls).toEqual([])
    expect(plan.operations.some(operation => operation.kind === 'inventory')).toBe(false)
    const reduced = reduceItemOperationPlan({ plan, map: null, sheets: new Map([['trainer:ash', actor]]), groupInventory: null })
    const result = reduced.sheets.get('trainer:ash') as TrainerSheet
    expect(result.inventory?.keyItems?.filter(row => row.name === 'Shards').map(row => row.itemVariant?.color))
      .toEqual(['Red', 'Orange', 'Yellow', 'Green'])
    expect(result.inventory?.keyItems?.find(row => row.name === 'Dowsing Rod')?.qty).toBe(2)
    expect(parseItemExplorationState(result.serverPrivate?.itemExploration).dowsingUses[0]?.roll.successes).toBe(4)
  })

  it('uses server-owned Focus dice for wild Bait distraction and schedules only a failed target forfeiture', () => {
    const actor = trainer('Bait')
    const target = wild()
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Bait')
    const command: UseItemCommandV1 = {
      schemaVersion: 1, operationId: 'op_exploration_bait_wild_0001', context: 'encounter',
      offerId: 'offer:Bait:wild', sourceInstanceId: sourceInstanceId('foodStuff'),
      actorParticipantId: 'ash-placement', actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
      source: { kind: 'trainer', slug: 'ash', section: 'foodStuff', rowId: 'item-row', expectedRevision: 3 },
      targetIds: ['wild-placement'],
      choices: [
        { choiceId: 'target', optionIds: ['wild-placement'] },
        { choiceId: 'exploration-use-mode', optionIds: ['wild-distraction'] },
      ],
      readSet: [
        { kind: 'map', id: 'arena', revision: 4 }, { kind: 'encounter', id: 'arena', revision: 4 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'wild-rattata', revision: 2 },
      ],
    }
    const queue = [1, 1]
    const plan = planDeterministicItemOperation({
      command, definition, source: source(definition, 'foodStuff'),
      targets: [{ participantId: 'wild-placement', sheetKind: 'pokemon', sheetSlug: 'wild-rattata', revision: 2, sheet: target }],
      actorSheet: actor, map: arena(), rollHealingDie: () => queue.shift()!,
    })
    expect(queue).toEqual([])
    expect(plan.operations.find(operation => operation.payload.action === 'wild-distraction')?.payload)
      .toMatchObject({ focusDc: 12, focus: { expression: '2d6', rolls: [1, 1], total: 2 }, failed: true })
    const reduced = reduceItemOperationPlan({
      plan, map: arena(), sheets: new Map([['trainer:ash', actor], ['pokemon:wild-rattata', target]]), groupInventory: null,
    })
    expect(reduced.map?.encounterState?.turnResources['wild-placement']?.oncePerTurnFlags)
      .toContainEqual(expect.objectContaining({ id: ITEM_BAIT_NEXT_TURN_STANDARD_FLAG_ID }))
    expect((reduced.sheets.get('trainer:ash') as TrainerSheet).inventory?.foodStuff?.[0]?.qty).toBe(1)
  })

  it.each([
    [ITEM_BAIT_NEXT_TURN_STANDARD_FLAG_ID, 'standard'],
    [ITEM_REPEL_NEXT_TURN_SHIFT_FLAG_ID, 'shift'],
  ] as const)('consumes %s at the exact next turn and forfeits only the %s Action', (flagId, action) => {
    const scheduled = scheduleExplorationNextTurnForfeit({
      resources: {}, placementId: 'wild-placement', flagId,
      sourceOperationId: 'item-exploration:v1:11111111111111111111111111111111',
      round: 1, turn: 2,
    })
    const next = reduceEncounterResourceEvent(scheduled, parseEncounterEvent({
      schemaVersion: 2,
      eventId: `event.exploration.${action}.turn-start`,
      kind: 'turn-start',
      sourceOperationId: 'op.exploration.turn-start',
      causalParentEventId: null,
      reasonCode: 'item.exploration.next-turn-forfeit',
      round: 1, turn: 3, placementId: 'wild-placement', sideId: 'wild',
    }))
    expect(next['wild-placement']?.oncePerTurnFlags.some(flag => flag.id === flagId)).toBe(false)
    expect(next['wild-placement']?.actions[action].spent).toBe(1)
    expect(next['wild-placement']?.actions[action === 'standard' ? 'shift' : 'standard'].spent).toBe(0)
  })

  it('stores a direct Repel GM-positioning decision only on a server-owned hit', () => {
    const actor = trainer('Repel', 'medicalKit')
    const target = wild()
    const definition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Repel')
    const command: UseItemCommandV1 = {
      schemaVersion: 1, operationId: 'op_exploration_repel_wild_0001', context: 'encounter',
      offerId: 'offer:Repel:wild', sourceInstanceId: sourceInstanceId('medicalKit'),
      actorParticipantId: 'ash-placement', actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
      source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'item-row', expectedRevision: 3 },
      targetIds: ['wild-placement'],
      choices: [
        { choiceId: 'target', optionIds: ['wild-placement'] },
        { choiceId: 'exploration-use-mode', optionIds: ['wild-spray'] },
      ],
      readSet: [
        { kind: 'map', id: 'arena', revision: 4 }, { kind: 'encounter', id: 'arena', revision: 4 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
        { kind: 'sheet', sheetKind: 'pokemon', id: 'wild-rattata', revision: 2 },
      ],
    }
    const plan = planDeterministicItemOperation({
      command, definition, source: source(definition, 'medicalKit'),
      targets: [{ participantId: 'wild-placement', sheetKind: 'pokemon', sheetSlug: 'wild-rattata', revision: 2, sheet: target }],
      actorSheet: actor, map: arena(), rollHealingDie: sides => sides === 20 ? 20 : 1,
    })
    const reduced = reduceItemOperationPlan({
      plan, map: arena(), sheets: new Map([['trainer:ash', actor], ['pokemon:wild-rattata', target]]), groupInventory: null,
    })
    const pending = parseItemExplorationEncounterState(reduced.map?.encounterState?.itemExploration).repelPositioning
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      sourceOperationId: command.operationId, sourcePlacementId: 'ash-placement',
      targetPlacementId: 'wild-placement', maximumAffectedWildLevel: 15,
      accuracy: { naturalRoll: 20, hit: true }, status: 'pending-position',
    })
    expect((reduced.sheets.get('trainer:ash') as TrainerSheet).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect(reduced.map?.encounterState?.turnResources['ash-placement']?.actions.standard.spent).toBe(1)
  })
})
