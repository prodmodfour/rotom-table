import { afterEach, describe, expect, it } from 'vitest'
import {
  createEmptyEncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  parseEncounterEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import type {
  MoveDirectHpEffectOperation,
  MoveHealEffectOperation,
} from '#shared/moveAutomation/effects'
import type { EncounterLifecycleTriggerHandler } from '~~/server/domain/moveAutomation/reduceLifecycle'
import type { PersistedSheet } from '~~/server/storage/sheetRepository'
import type { TabletopMap } from '~/types/map'
import { LivePlayIntegrationHarness, assertAccepted } from './livePlayIntegrationHarness'

const harnesses: LivePlayIntegrationHarness[] = []

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.dispose()
})

const sceneEffect = (): EncounterEffect => parseEncounterEffect({
  id: 'effect.scene-boundary-residual',
  kind: 'numeric-modifier',
  source: {
    operationId: 'operation.scene-boundary-source',
    moveId: 'move.scene-boundary-source',
    placementId: 'token-a',
  },
  affected: {
    placementIds: ['token-a'],
    sideIds: [],
    cells: [],
  },
  createdRound: 1,
  createdTurn: 0,
  duration: { kind: 'scene', remaining: null },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['scene-boundary-test'],
  payload: {
    attribute: 'damage',
    operation: 'add',
    value: 1,
    rounding: 'none',
  },
  dispel: { policy: 'none', tags: [] },
  suppression: { sources: [] },
})

const activeScene = { name: 'Old Scene', startedAt: 1_700_000_000_100 }

const lifecycleMap = (effect: EncounterEffect): TabletopMap => ({
  schemaVersion: 2,
  revision: 0,
  slug: 'integration-arena',
  name: 'Scene Lifecycle Arena',
  folder: '',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [{
    id: 'token-a',
    sheetKind: 'pokemon',
    sheetSlug: 'alpha-mon',
    position: { x: 1, y: 0, z: 1 },
    initiative: 20,
  }],
  lights: [],
  initiative: { activeId: 'token-a', round: 1 },
  activeScene,
  temporaryHitPoints: {
    scene: activeScene,
    byPlacementId: { 'token-a': 4 },
  },
  moveUsage: {
    scene: activeScene,
    byPlacementId: {
      'token-a': {
        tackle: { moveName: 'Tackle', frequency: 'scene', uses: 1 },
      },
    },
  },
  encounterState: {
    ...createEmptyEncounterState(),
    effects: [effect],
  },
  metadata: {},
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
})

const pokemonSheet = (): PersistedSheet => ({
  kind: 'pokemon',
  slug: 'alpha-mon',
  revision: 0,
  updatedAt: 1_700_000_000_000,
  sheet: {
    slug: 'alpha-mon',
    nickname: 'Alpha',
    species: 'Pikachu',
    level: 20,
    revision: 0,
    updatedAt: 1_700_000_000_000,
    combat: { currentHp: 30, injuries: 0, conditions: [] },
    moveUsage: {
      daily: {
        thunderbolt: { moveName: 'Thunderbolt', uses: 1, updatedAt: 1_700_000_000_000 },
      },
    },
    movelist: [],
  },
})

const sceneBoundaryHandler = (effectId: string): EncounterLifecycleTriggerHandler => ({
  id: 'handler.scene-boundary-test',
  resolve: ({ event, state }) => {
    if (event.kind === 'scene-end' && state.effects.some(effect => effect.id === effectId)) {
      const damage: MoveDirectHpEffectOperation = {
        id: 'operation.scene-end-damage',
        kind: 'direct-hp',
        source: { kind: 'encounter-effect', id: effectId },
        recipients: { kind: 'selected-targets' },
        phase: 'cleanup',
        reasonCode: 'lifecycle.scene-end-damage',
        payload: {
          mode: 'lose',
          pool: 'hit-points',
          calculation: { kind: 'fixed', value: 5 },
          copySource: null,
          bounds: { minimum: null, maximum: null },
          rounding: 'floor',
          applyTypeImmunity: false,
          cost: null,
          injury: {
            hitPointMarkers: 'apply-after-operation',
            massiveDamage: 'never',
          },
        },
      }
      return [{
        effectId,
        reasonCode: 'lifecycle.scene-end-trigger',
        operations: [damage],
        emittedEvents: [],
      }]
    }
    if (event.kind === 'scene-start') {
      const temporaryHp: MoveHealEffectOperation = {
        id: 'operation.scene-start-temporary-hp',
        kind: 'heal',
        source: { kind: 'lifecycle-event', id: event.eventId },
        recipients: { kind: 'area-targets' },
        phase: 'cleanup',
        reasonCode: 'lifecycle.scene-start-temporary-hp',
        payload: {
          mode: 'gain',
          pool: 'temporary-hit-points',
          calculation: { kind: 'fixed', value: 3 },
          bounds: { minimum: null, maximum: null },
          rounding: 'floor',
          injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
        },
      }
      return [{
        effectId: null,
        reasonCode: 'lifecycle.scene-start-trigger',
        operations: [temporaryHp],
        emittedEvents: [],
      }]
    }
    return []
  },
})

describe('live-play scene lifecycle integration', () => {
  it('commits replacement boundaries, cleanup, due sheet work, and retry exactly once', async () => {
    const effect = sceneEffect()
    const harness = LivePlayIntegrationHarness.create({
      map: lifecycleMap(effect),
      sheets: [pokemonSheet()],
      lifecycleHandlers: [sceneBoundaryHandler(effect.id)],
    })
    harnesses.push(harness)
    const remote = await harness.loadClient('remote-scene-client')
    const replaceCommand = harness.setSceneCommand({
      opId: 'op_scene_replace',
      baseRevision: 0,
      name: 'New Scene',
    })

    const first = await harness.setScene({
      actor: { role: 'gm', clientId: 'gm-client' },
      command: replaceCommand,
    })
    const duplicate = await harness.setScene({
      actor: { role: 'gm', clientId: 'gm-client' },
      command: replaceCommand,
    })

    const accepted = assertAccepted(first.result)
    expect(accepted).toMatchObject({ previousRevision: 0, revision: 1 })
    expect(duplicate.result).toEqual(first.result)
    expect(harness.operationRecordCount()).toBe(1)
    expect((await harness.readMap())?.activeScene).toMatchObject({ name: 'New Scene' })
    expect((await harness.readMap())?.moveUsage).toBeUndefined()
    expect((await harness.readMap())?.temporaryHitPoints?.byPlacementId).toEqual({ 'token-a': 3 })
    expect((await harness.readMap())?.encounterState).toMatchObject({
      effects: [],
      counters: {},
      turnResources: {},
      pendingResolutionSummaries: [],
    })
    expect(((await harness.readSheet('pokemon', 'alpha-mon'))?.sheet.combat as { currentHp: number }).currentHp).toBe(25)
    expect((await harness.readSheet('pokemon', 'alpha-mon'))?.revision).toBe(1)
    expect((await harness.readSheet('pokemon', 'alpha-mon'))?.sheet.moveUsage).toEqual({
      daily: {
        thunderbolt: { moveName: 'Thunderbolt', uses: 1, updatedAt: 1_700_000_000_000 },
      },
    })
    expect(first.sheetUpdates?.map(update => `${update.kind}:${update.slug}`)).toEqual(['pokemon:alpha-mon'])

    const lifecycle = (accepted.patches[0]?.payload as {
      lifecycle?: {
        events: Array<{ kind: string, sceneId?: string }>
        operationIds: string[]
      }
    }).lifecycle
    expect(lifecycle?.events.map(event => event.kind)).toEqual(['scene-end', 'scene-start'])
    expect(lifecycle?.events[0]?.sceneId).toBeUndefined()
    expect(lifecycle?.operationIds).toEqual([
      'operation.scene-end-damage',
      'operation.scene-start-temporary-hp',
    ])
    expect(remote.patchFailures).toEqual([])
    expect(remote.map?.activeScene).toEqual((await harness.readMap())?.activeScene)
    expect(remote.map?.temporaryHitPoints).toEqual((await harness.readMap())?.temporaryHitPoints)
    expect(remote.map?.encounterState).toEqual((await harness.readMap())?.encounterState)

    const end = await harness.setScene({
      actor: { role: 'gm', clientId: 'gm-client' },
      command: harness.setSceneCommand({
        opId: 'op_scene_end_new',
        baseRevision: 1,
        name: null,
      }),
    })

    expect(assertAccepted(end.result)).toMatchObject({ previousRevision: 1, revision: 2 })
    expect((await harness.readMap())?.activeScene).toBeUndefined()
    expect((await harness.readMap())?.temporaryHitPoints).toBeUndefined()
    expect((await harness.readMap())?.moveUsage).toBeUndefined()
    expect((await harness.readMap())?.encounterState?.effects).toEqual([])
    expect(((await harness.readSheet('pokemon', 'alpha-mon'))?.sheet.combat as { currentHp: number }).currentHp).toBe(25)
    expect(harness.operationRecordCount()).toBe(2)
  })
})
