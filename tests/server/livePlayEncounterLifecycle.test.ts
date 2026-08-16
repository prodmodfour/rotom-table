import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect, type EncounterEffectDuration } from '#shared/moveAutomation/encounterEffects'
import { applyCombatStagesToSheet } from '~/utils/sheetMutations'
import type { PersistedSheet } from '../../server/storage/sheetRepository'
import type { TabletopMap } from '~/types/map'
import { LivePlayIntegrationHarness, assertAccepted } from './livePlayIntegrationHarness'
import { encounterEffectCommandRef } from '../../server/domain/moveAutomation/encounterEffectCommandRef'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqlitePendingMoveResolutionRepository } from '../../server/storage/pendingMoveResolutionRepository'
import { createPendingMoveResolutionFixture } from '../fixtures/moveAutomation/pendingResolution'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import { planEncounterLifecycle } from '../../server/domain/moveAutomation/planInitiativeLifecycle'
import type { EncounterLifecycleTriggerHandler } from '../../server/domain/moveAutomation/reduceLifecycle'
import { createEncounterEndLifecycleEvent } from '../../server/domain/moveAutomation/durationLifecycle'
import {
  ITEM_DIGESTION_EFFECT_TAG,
  ITEM_DIGESTION_HEAL_CAPABILITY_PREFIX,
} from '../../server/domain/itemAutomation/digestionBuffTrade'

const harnesses: LivePlayIntegrationHarness[] = []
afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.dispose()
})

const effect = (id: string, duration: EncounterEffectDuration) => parseEncounterEffect({
  id,
  kind: 'condition',
  source: {
    operationId: `operation.${id}`,
    moveId: 'item.duration-fixture',
    placementId: 'token-a',
  },
  affected: { placementIds: ['token-a'], sideIds: [], cells: [] },
  createdRound: 1,
  createdTurn: 0,
  duration,
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['item', 'temporary'],
  payload: { conditionId: 'sleep', action: 'apply', saveTiming: 'end-turn' },
  dispel: { policy: 'matching-tags', tags: ['item'] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
})

const digestionEffect = () => parseEncounterEffect({
  id: 'effect.item.digestion.leftovers', kind: 'capability',
  source: { operationId: 'operation.item.digestion', moveId: 'item.leftovers', placementId: 'token-a' },
  affected: { placementIds: ['token-a'], sideIds: [], cells: [] }, createdRound: 1, createdTurn: 0,
  duration: { kind: 'encounter', remaining: null }, stacks: 1, charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null }, chargePolicy: { kind: 'none', amount: null },
  tags: [ITEM_DIGESTION_EFFECT_TAG, 'item-digestion-source:0123456789abcdef0123456789abcdef'],
  payload: { capabilityId: `${ITEM_DIGESTION_HEAL_CAPABILITY_PREFIX}16`, action: 'grant', value: 1 },
  dispel: { policy: 'matching-tags', tags: [ITEM_DIGESTION_EFFECT_TAG] },
  transferPolicy: 'retain', suppression: { sources: [] },
})

const sheet = (slug: string, staged = false): PersistedSheet => {
  const base = {
    slug,
    species: slug === 'alpha-mon' ? 'Pikachu' : 'Eevee',
    nickname: slug,
    level: 20,
    revision: 0,
    updatedAt: 100,
    combat: { currentHp: 30, injuries: 0, conditions: [] },
    stats: {
      atk: { stage: 0 }, def: { stage: 0 }, satk: { stage: 0 },
      sdef: { stage: 0 }, spd: { stage: 0 },
    },
    combatStages: { acc: 0 },
    movelist: [],
  }
  return {
    kind: 'pokemon', slug, revision: 0, updatedAt: 100,
    sheet: staged
      ? applyCombatStagesToSheet('pokemon', base as never, {
          atk: 4, def: -2, satk: 1, sdef: 3, spd: -1, acc: 2,
        }) as unknown as Record<string, unknown>
      : base,
  }
}

const map = (input: {
  readonly effects?: readonly ReturnType<typeof parseEncounterEffect>[]
  readonly pendingStatus?: 'pending' | 'resuming' | 'committed'
} = {}): TabletopMap => {
  const state = createEmptyEncounterState()
  return {
    schemaVersion: 2,
    slug: 'integration-arena',
    name: 'Integration Arena',
    folder: '',
    revision: 0,
    updatedAt: 100,
    dimensions: { x: 8, y: 3, z: 8 },
    playerVisible: true,
    voxels: [],
    placements: [
      { id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'alpha-mon', position: { x: 1, y: 0, z: 1 }, initiative: 12 },
      { id: 'token-b', sheetKind: 'pokemon', sheetSlug: 'beta-mon', position: { x: 2, y: 0, z: 1 }, initiative: 9 },
    ],
    lights: [],
    initiative: { activeId: 'token-a', round: 1 },
    encounterState: {
      ...state,
      effects: [...(input.effects ?? [])],
      pendingResolutionSummaries: input.pendingStatus ? [{
        schemaVersion: 1,
        resolutionId: 'resolution.pending.1',
        actorPlacementId: 'token-a',
        canonicalMoveId: 'Thunderbolt',
        phase: 'target',
        status: input.pendingStatus,
        outstandingWindowCount: input.pendingStatus === 'committed' ? 0 : 1,
        createdAt: 100,
        updatedAt: 100,
      }] : [],
    },
  }
}

const createHarness = (tableMap: TabletopMap): LivePlayIntegrationHarness => {
  const harness = LivePlayIntegrationHarness.create({
    map: tableMap,
    sheets: [sheet('alpha-mon', true), sheet('beta-mon')],
  })
  harnesses.push(harness)
  return harness
}

describe('live-play encounter duration lifecycle', () => {
  it('reserves lifecycle budget for built-in encounter cleanup and fails before reduction if callers exhaust it', () => {
    const handlers = Array.from({ length: 64 }, (_, index): EncounterLifecycleTriggerHandler => ({
      id: `handler.fixture.${index}`,
      resolve: () => [],
    }))
    expect(() => planEncounterLifecycle({
      map: map(),
      events: [createEncounterEndLifecycleEvent({
        mapSlug: 'integration-arena', operationId: 'op_encounter_budget_01', reason: 'completed',
      })],
      time: 100,
      loadSheets: () => ({ pokemonSheets: new Map(), trainerSheets: new Map() }),
      handlers,
    })).toThrow(/caller trigger handlers after reserving \d+ built-in handlers/)
  })

  it('ends encounter durations and stages exactly once without ending the scene lane', async () => {
    const harness = createHarness(map({ effects: [
      effect('effect.item.encounter', { kind: 'encounter', remaining: null }),
      digestionEffect(),
      effect('effect.item.turns', { kind: 'turns', subject: 'target', boundary: 'end', remaining: 5 }),
      effect('effect.item.rounds', { kind: 'rounds', boundary: 'end', remaining: 2 }),
      effect('effect.item.scene', { kind: 'scene', remaining: null }),
      effect('effect.item.dismiss', { kind: 'explicit-dismissal', remaining: null }),
    ] }))
    const remote = await harness.loadClient('remote-client')
    const command = harness.endEncounterCommand({
      opId: 'op_end_encounter_01', baseRevision: 0, reason: 'completed',
    })

    const first = await harness.endEncounter({
      actor: { role: 'gm', clientId: 'gm-client' }, command,
    })
    const accepted = assertAccepted(first.result)
    expect(accepted).toMatchObject({ previousRevision: 0, revision: 1 })
    expect(accepted.patches).toHaveLength(1)
    expect(accepted.patches[0]).toMatchObject({
      type: 'map.encounterLifecycle',
      scopes: [{ kind: 'map', lane: 'encounter' }],
      payload: {
        command: 'endEncounter',
        reason: 'completed',
        effectId: null,
        lifecycle: {
          events: [expect.objectContaining({ kind: 'encounter-end', reasonCode: 'encounter.end.completed' })],
          effectTransitions: [
            expect.objectContaining({ effectId: 'effect.item.encounter', reasonCode: 'effect-encounter-ended' }),
            expect.objectContaining({ effectId: 'effect.item.digestion.leftovers', reasonCode: 'effect-encounter-ended' }),
            expect.objectContaining({ effectId: 'effect.item.turns', reasonCode: 'effect-encounter-ended' }),
            expect.objectContaining({ effectId: 'effect.item.rounds', reasonCode: 'effect-encounter-ended' }),
          ],
        },
      },
    })
    const persistedMap = await harness.readMap()
    expect(persistedMap?.encounterState?.effects.map(value => value.id)).toEqual([
      'effect.item.scene', 'effect.item.dismiss',
    ])
    const persistedSheet = (await harness.readSheet('pokemon', 'alpha-mon'))!
    expect((persistedSheet.sheet.stats as Record<string, { stage?: number }>).atk?.stage).toBe(0)
    expect((persistedSheet.sheet.combatStages as { acc?: number }).acc).toBe(0)
    expect(persistedSheet.revision).toBe(1)
    expect(remote.patchFailures).toEqual([])
    expect(remote.map?.encounterState).toEqual(persistedMap?.encounterState)

    const replay = await harness.endEncounter({
      actor: { role: 'gm', clientId: 'gm-client' }, command,
    })
    expect(replay.result).toEqual(first.result)
    expect((await harness.readMap())?.revision).toBe(1)
    expect((await harness.readSheet('pokemon', 'alpha-mon'))?.revision).toBe(1)
    expect(harness.operationRecordCount()).toBe(1)
  })

  it('rejects malformed lifecycle payloads and route-type drift before mutation', async () => {
    const harness = createHarness(map({ effects: [
      effect('effect.item.dismiss', { kind: 'explicit-dismissal', remaining: null }),
    ] }))
    const malformed = structuredClone(harness.dismissEncounterEffectCommand({
      opId: 'op_dismiss_malformed_01', baseRevision: 0, effectId: 'effect.item.dismiss',
    })) as unknown as Record<string, unknown>
    malformed.payload = { effectId: 'effect.item.dismiss', rawEffectId: 'forbidden' }
    const rejected = await harness.dismissEncounterEffect({
      actor: { role: 'gm', clientId: 'gm-client' },
      command: malformed as never,
    })
    expect(rejected.result).toMatchObject({ ok: false, reason: 'invalid' })
    expect((await harness.readMap())?.revision).toBe(0)
  })

  it('dismisses only exact explicitly dismissible effects and remains GM-only', async () => {
    const harness = createHarness(map({ effects: [
      effect('effect.item.dismiss', { kind: 'explicit-dismissal', remaining: null }),
      effect('effect.item.scene', { kind: 'scene', remaining: null }),
    ] }))
    const unauthorized = await harness.dismissEncounterEffect({
      actor: { role: 'player', clientId: 'player-client' },
      command: harness.dismissEncounterEffectCommand({
        opId: 'op_dismiss_denied_01', baseRevision: 0, effectId: 'effect.item.dismiss',
      }),
    })
    expect(unauthorized.result).toMatchObject({ ok: false, reason: 'unauthorized' })
    expect((await harness.readMap())?.revision).toBe(0)

    const command = harness.dismissEncounterEffectCommand({
      opId: 'op_dismiss_effect_01', baseRevision: 0,
      effectId: encounterEffectCommandRef('effect.item.dismiss'),
    })
    const first = await harness.dismissEncounterEffect({
      actor: { role: 'gm', clientId: 'gm-client' }, command,
    })
    expect(assertAccepted(first.result)).toMatchObject({ revision: 1 })
    expect((await harness.readMap())?.encounterState?.effects.map(value => value.id))
      .toEqual(['effect.item.scene'])
    const replay = await harness.dismissEncounterEffect({
      actor: { role: 'gm', clientId: 'gm-client' }, command,
    })
    expect(replay.result).toEqual(first.result)

    const wrongDuration = await harness.dismissEncounterEffect({
      actor: { role: 'gm', clientId: 'gm-client' },
      command: harness.dismissEncounterEffectCommand({
        opId: 'op_dismiss_scene_01', baseRevision: 1, effectId: 'effect.item.scene',
      }),
    })
    expect(wrongDuration.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect((await harness.readMap())?.revision).toBe(1)
  })

  it('fails closed on a durable pending item operation even without a public summary', async () => {
    const harness = createHarness(map())
    const command: UseItemCommandV1 = {
      schemaVersion: 1,
      operationId: 'op_item_pending_encounter_end_01',
      context: 'encounter',
      offerId: 'offer:item:potion',
      sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
      actorParticipantId: 'token-a',
      actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 1 },
      source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 1 },
      targetIds: ['token-a'],
      choices: [],
      readSet: [
        { kind: 'map', id: 'integration-arena', revision: 0 },
        { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 1 },
      ],
    }
    createSqliteItemOperationRepository({ database: harness.database, clock: () => 100 }).createPending({
      command,
      canonicalItemId: 'Potion',
      canonicalDefinitionSha256: 'a'.repeat(64),
      plan: {
        schemaVersion: 1,
        operationId: command.operationId,
        canonicalItemId: 'Potion',
        canonicalDefinitionSha256: 'a'.repeat(64),
        readSet: command.readSet,
        operations: [],
        receiptFacts: [],
      },
    })

    const rejected = await harness.endEncounter({
      actor: { role: 'gm', clientId: 'gm-client' },
      command: harness.endEncounterCommand({ opId: 'op_end_pending_item_01', baseRevision: 0 }),
    })
    expect(rejected.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: 'Encounter end is unavailable while an item or move resolution is pending.',
    })
    expect((await harness.readMap())?.revision).toBe(0)
  })

  it('fails closed on durable pending Move authority even when the map summary is absent', async () => {
    const harness = createHarness(map())
    const resolution = createPendingMoveResolutionFixture({
      resolutionId: 'resolution-encounter-end-durable',
      originMapSlug: 'integration-arena',
      originOpId: 'op_pending_move_end_01',
      actorPlacementId: 'token-a',
    })
    createSqlitePendingMoveResolutionRepository(harness.database).create({ resolution })

    const rejected = await harness.endEncounter({
      actor: { role: 'gm', clientId: 'gm-client' },
      command: harness.endEncounterCommand({ opId: 'op_end_pending_move_01', baseRevision: 0 }),
    })
    expect(rejected.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: 'Encounter end is unavailable while an item or move resolution is pending.',
    })
    expect((await harness.readMap())?.revision).toBe(0)
  })

  it('reconnects to authoritative cleanup after missing the realtime boundary', async () => {
    const harness = createHarness(map({ effects: [
      effect('effect.item.encounter', { kind: 'encounter', remaining: null }),
      effect('effect.item.scene', { kind: 'scene', remaining: null }),
    ] }))
    const remote = await harness.loadClient('reconnecting-client')
    remote.disconnect()
    const response = await harness.endEncounter({
      actor: { role: 'gm', clientId: 'gm-client' },
      command: harness.endEncounterCommand({ opId: 'op_end_reconnect_01', baseRevision: 0 }),
    })
    expect(assertAccepted(response.result)).toMatchObject({ revision: 1 })
    expect(remote.missedEvents).toBeGreaterThan(0)
    expect(remote.map?.revision).toBe(0)

    const reloaded = await remote.reconnect()
    expect(reloaded.revision).toBe(1)
    expect(reloaded.encounterState?.effects.map(value => value.id)).toEqual(['effect.item.scene'])
    expect(remote.patchFailures).toEqual([])
  })

  it('fails closed on active pending work but ignores terminal public summaries', async () => {
    const blocked = createHarness(map({ pendingStatus: 'pending' }))
    const rejected = await blocked.endEncounter({
      actor: { role: 'gm', clientId: 'gm-client' },
      command: blocked.endEncounterCommand({ opId: 'op_end_pending_01', baseRevision: 0 }),
    })
    expect(rejected.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: 'Encounter end is unavailable while an item or move resolution is pending.',
    })
    expect((await blocked.readMap())?.revision).toBe(0)

    const terminal = createHarness(map({ pendingStatus: 'committed' }))
    const accepted = await terminal.endEncounter({
      actor: { role: 'gm', clientId: 'gm-client' },
      command: terminal.endEncounterCommand({ opId: 'op_end_terminal_01', baseRevision: 0 }),
    })
    expect(assertAccepted(accepted.result)).toMatchObject({ revision: 1 })
  })
})
