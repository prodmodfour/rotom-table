import { describe, expect, it } from 'vitest'
import {
  ITEM_EXPLORATION_SHARD_COLORS,
  parseItemExplorationState,
  parseItemShardInventoryVariant,
  projectItemExplorationState,
} from '#shared/itemAutomation/exploration'
import {
  applyItemRepelCampaignEffect,
  applyResolvedItemDowsing,
  dowsingDailyUsage,
  resolveItemDowsing,
  resolveItemRouteLureCheck,
  settleItemRouteLure,
  startItemRouteLure,
  strongestActiveRepel,
} from '../../server/domain/itemAutomation/exploration'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import type { TrainerSheet } from '~/types/trainerSheet'

const trainer = (): TrainerSheet => ({
  slug: 'explorer',
  name: 'Explorer',
  level: 10,
  revision: 4,
  skillBackground: { name: 'Occultist', adept: 'occultEd' },
  inventory: {
    keyItems: [{ id: 'dowsing-rod-row', name: 'Dowsing Rod', qty: 1 }],
  },
})

const operationId = (value: number): string => `op_exploration_${String(value).padStart(8, '0')}`

const startLure = (canonicalId: 'Bait' | 'Fishing Lure' | 'Honey', value = 1) => startItemRouteLure({
  current: null,
  definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId),
  sourceOperationId: operationId(value),
  sourceInstanceId: `item-instance:trainer:explorer:foodStuff:${canonicalId.toLowerCase().replace(' ', '-')}-row`,
  campaignMinute: 100,
})

describe('P8-057 exploration item domain', () => {
  it('persists exact 15-minute route checks, succeeds only on 15+, and requires GM settlement', () => {
    const started = startLure('Bait')
    expect(started.activity).toMatchObject({
      canonicalItemId: 'Bait', reusable: false, startedAtCampaignMinute: 100,
      nextCheckAtCampaignMinute: 115, status: 'active', attempts: [], outcome: null,
    })
    expect(() => resolveItemRouteLureCheck({
      current: started.state, activityId: started.activity.activityId, campaignMinute: 114, roll: 20,
    })).toThrow('not due')

    const first = resolveItemRouteLureCheck({
      current: started.state, activityId: started.activity.activityId, campaignMinute: 115, roll: 14,
    })
    expect(first.activity).toMatchObject({
      status: 'active', nextCheckAtCampaignMinute: 130,
      attempts: [{ attempt: 1, dueAtCampaignMinute: 115, resolvedAtCampaignMinute: 115, roll: 14, success: false }],
    })
    const second = resolveItemRouteLureCheck({
      current: first.state, activityId: first.activity.activityId, campaignMinute: 132, roll: 15,
    })
    expect(second.activity).toMatchObject({ status: 'awaiting-encounter', nextCheckAtCampaignMinute: null })
    expect(() => settleItemRouteLure({
      current: second.state, activityId: second.activity.activityId,
      outcome: 'encounter-introduced', gm: false,
    })).toThrow('Only a GM')
    const settled = settleItemRouteLure({
      current: second.state, activityId: second.activity.activityId,
      outcome: 'encounter-introduced', gm: true,
    })
    expect(settled.activity).toMatchObject({ status: 'completed', outcome: 'encounter-introduced' })
    expect(() => resolveItemRouteLureCheck({
      current: settled.state, activityId: settled.activity.activityId, campaignMinute: 145, roll: 20,
    })).toThrow('not awaiting')
  })

  it('ends after exactly three failed checks and never invents Fishing Lure loss', () => {
    let result = startLure('Fishing Lure', 2)
    expect(result.activity.reusable).toBe(true)
    for (const [index, minute] of [115, 130, 145].entries()) {
      result = resolveItemRouteLureCheck({
        current: result.state, activityId: result.activity.activityId, campaignMinute: minute!, roll: 1,
      })
      expect(result.activity.attempts).toHaveLength(index + 1)
    }
    expect(result.activity).toMatchObject({ status: 'completed', outcome: 'no-encounter', nextCheckAtCampaignMinute: null })
    expect(() => settleItemRouteLure({
      current: result.state, activityId: result.activity.activityId, outcome: 'lure-lost', gm: true,
    })).toThrow('active reusable source')

    const active = startLure('Fishing Lure', 3)
    expect(() => settleItemRouteLure({
      current: active.state, activityId: active.activity.activityId, outcome: 'lure-lost', gm: false,
    })).toThrow('explicit GM adjudication')
    expect(settleItemRouteLure({
      current: active.state, activityId: active.activity.activityId, outcome: 'lure-lost', gm: true,
    }).activity).toMatchObject({ status: 'cancelled', outcome: 'lure-lost', reusable: true })
  })

  it('applies exact Repel durations and chooses the strongest active route ward', () => {
    const repel = applyItemRepelCampaignEffect({
      current: null,
      definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Repel'),
      sourceOperationId: operationId(4), sourceInstanceId: 'item-instance:trainer:explorer:medicalKit:repel-row',
      campaignMinute: 200,
    })
    const max = applyItemRepelCampaignEffect({
      current: repel.state,
      definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Max Repel'),
      sourceOperationId: operationId(5), sourceInstanceId: 'item-instance:trainer:explorer:medicalKit:max-repel-row',
      campaignMinute: 220,
    })
    expect(repel.effect).toMatchObject({ expiresAtCampaignMinute: 260, maximumAffectedWildLevel: 15 })
    expect(max.effect).toMatchObject({ expiresAtCampaignMinute: 520, maximumAffectedWildLevel: 35 })
    expect(strongestActiveRepel(max.state, 259)?.canonicalItemId).toBe('Max Repel')
    expect(strongestActiveRepel(max.state, 520)).toBeNull()
    expect(() => applyItemRepelCampaignEffect({
      current: max.state,
      definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Super Repel'),
      sourceOperationId: operationId(6), sourceInstanceId: 'item-instance:trainer:explorer:medicalKit:super-row',
      campaignMinute: 230,
    })).toThrow('equal or stronger')
  })

  it('resolves exploding Dowsing dice and atomically grants color-preserving Shards once', () => {
    const source = trainer()
    // Four base dice + one cave die. The first six explodes into the sixth roll.
    // Four successes then receive exact Red, Orange, Yellow, and Green color rolls.
    const queue = [6, 4, 2, 5, 1, 4, 1, 2, 3, 4]
    const resolved = resolveItemDowsing({
      current: null,
      definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Dowsing Rod'),
      sheet: source,
      sourceOperationId: operationId(7),
      sourceInstanceId: 'item-instance:trainer:explorer:keyItems:dowsing-rod-row',
      campaignMinute: 300,
      terrainId: 'cave',
      skillStuntInstanceId: null,
      rollDie: (sides) => {
        expect(sides).toBe(6)
        return queue.shift()!
      },
    })
    expect(queue).toEqual([])
    expect(resolved.use.roll).toEqual({
      expression: '5d6!6', baseDice: 4, terrainBonusDice: 1,
      skillStuntBonusDice: 0, crystalResonanceBonusDice: 0,
      rolls: [6, 4, 2, 5, 1, 4], successes: 4, explodingSixes: 1,
    })
    expect(resolved.use.shardAwards).toEqual(ITEM_EXPLORATION_SHARD_COLORS.slice(0, 4))
    expect(resolved.shardRows.map(row => row.itemVariant)).toEqual([
      { schemaVersion: 1, kind: 'shard-color', color: 'Red' },
      { schemaVersion: 1, kind: 'shard-color', color: 'Orange' },
      { schemaVersion: 1, kind: 'shard-color', color: 'Yellow' },
      { schemaVersion: 1, kind: 'shard-color', color: 'Green' },
    ])
    const applied = applyResolvedItemDowsing({ sheet: source, use: resolved.use, shardRows: resolved.shardRows })
    expect(applied.inventory?.keyItems?.filter(row => row.name === 'Shards')).toHaveLength(4)
    expect(parseItemExplorationState(applied.serverPrivate?.itemExploration).dowsingUses).toHaveLength(1)
    expect(() => applyResolvedItemDowsing({ sheet: applied, use: resolved.use, shardRows: resolved.shardRows }))
      .toThrow('already exists')
    expect(parseItemShardInventoryVariant(applied.inventory!.keyItems![1]!.itemVariant)).toEqual({
      schemaVersion: 1, kind: 'shard-color', color: 'Red',
    })
  })

  it('enforces Trainer-wide daily Dowsing uses and projects only the current day result', () => {
    const state = parseItemExplorationState({
      schemaVersion: 1,
      routeLures: [],
      repels: [],
      dowsingUses: [{
        sourceOperationId: operationId(8),
        canonicalDefinitionSha256: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Dowsing Rod').definitionSha256,
        sourceInstanceId: 'item-instance:trainer:explorer:keyItems:first-rod',
        campaignDayIndex: 0,
        resolvedAtCampaignMinute: 100,
        terrainId: 'ordinary',
        skillStuntInstanceId: null,
        roll: {
          expression: '4d6!6', baseDice: 4, terrainBonusDice: 0,
          skillStuntBonusDice: 0, crystalResonanceBonusDice: 0,
          rolls: [1, 2, 3, 4], successes: 1, explodingSixes: 0,
        },
        shardAwards: ['Blue'],
        shardInventoryRowIds: ['item-shard-row:00000001'],
      }],
    })
    expect(dowsingDailyUsage({
      state, sourceInstanceId: 'item-instance:trainer:explorer:keyItems:second-rod',
      campaignMinute: 200, occultEducationRank: 4,
    })).toEqual({ used: 1, maximum: 2, campaignDayIndex: 0 })
    expect(projectItemExplorationState({ state, campaignMinute: 1_500, occultEducationRank: 4 }).dowsing)
      .toEqual({ campaignDayIndex: 1, uses: 0, maximumUses: 2, latest: null })
  })

  it('fails closed for malformed variants and inconsistent lifecycle evidence', () => {
    expect(() => parseItemShardInventoryVariant({ schemaVersion: 1, kind: 'shard-color', color: 'Purple' }))
      .toThrow('unsupported value')
    const started = startLure('Honey', 9)
    expect(() => parseItemExplorationState({
      ...started.state,
      routeLures: [{ ...started.activity, nextCheckAtCampaignMinute: 116 }],
    })).toThrow('inconsistent route-lure lifecycle')
  })
})
