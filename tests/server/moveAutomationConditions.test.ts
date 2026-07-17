import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { parseEncounterState } from '#shared/moveAutomation/encounterState'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import {
  applyEncounterEffectLifecycleEvent,
} from '~~/server/domain/moveAutomation/effectLifecycle'
import { resolveImmediateMoveSpec } from '~~/server/domain/moveAutomation/resolveImmediateSpec'
import type { MoveSpecV2Runtime } from '~~/server/domain/moveAutomation/registry'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { projectEffectiveConditions } from '~/utils/encounterConditions'

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const sheet = (slug: string): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'actor' ? 'Pikachu' : 'Snorlax',
  level: 20,
  revision: slug === 'actor' ? 3 : 7,
  movelist: slug === 'actor' ? [{ name: 'Tackle' }] : [],
  types: ['Normal'],
  combat: { currentHp: 100, conditions: [] },
})

const map = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'condition-arena',
  name: 'Condition Arena',
  revision: 5,
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  placements: [
    placement('actor-token', 'actor', 0),
    placement('target-token', 'target', 1),
  ],
  initiative: { activeId: 'actor-token', round: 2 },
})

const intent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Tackle',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

describe('native MoveSpec typed conditions', () => {
  it('prevents Sleep through grounded authoritative Electric Terrain membership', () => {
    const definition = validateMoveSpec({
      schemaVersion: 2,
      canonicalId: 'Tackle',
      version: 2,
      targeting: {
        kind: 'single-target',
        minTargets: 1,
        maxTargets: 1,
        selector: { kind: 'selected-targets' },
      },
      preconditions: [],
      costs: [],
      phases: [{
        phase: 'hit',
        operations: [{
          id: 'operation.apply-sleep',
          kind: 'condition',
          source: { kind: 'move', id: 'move.tackle' },
          recipients: { kind: 'attacked-targets' },
          phase: 'hit',
          reasonCode: 'move.tackle.sleep',
          payload: {
            action: 'apply',
            conditionId: 'sleep',
            conditionSource: null,
            filter: null,
            randomChoice: null,
            duration: null,
            saveTiming: 'canonical',
            stackPolicy: { kind: 'refresh', maxStacks: null },
          },
        }],
      }],
      registeredHandlerId: null,
      presentation: { displayName: 'Tackle', vfxKey: null, tags: ['condition'] },
    })
    const runtime: MoveSpecV2Runtime = {
      canonicalId: 'Tackle',
      kind: 'movespec-v2',
      version: definition.spec.version,
      definitionHash: definition.definitionHash,
      sourceModule: 'tests/electric-terrain-condition',
      definition,
    }
    const terrainMap = map()
    terrainMap.fieldEffects = {
      weather: [],
      terrains: [{ kind: 'electric', scope: 'field' }],
      rooms: [],
    }
    const context = buildAuthoritativeMoveRulesContext({
      map: terrainMap,
      pokemonSheets: new Map([
        ['actor', sheet('actor')],
        ['target', sheet('target')],
      ]),
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: intent(),
      candidatePlacementIds: ['target-token'],
      selectedPlacementIds: ['target-token'],
      random: createFiniteAuthoritativeMoveRandomStream([]),
      time: 10_000,
    })
    const entry = context.queries.resolveActorMoveEntry('Tackle')
    if (!entry.ok) throw new Error(entry.message)

    const resolution = resolveImmediateMoveSpec({
      context,
      runtime,
      entry: entry.entry,
      authoritativeTargetIds: ['target-token'],
    })

    expect(resolution.transaction.conditionUpdates).toEqual([])
    expect(resolution.trace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'operation',
        operationId: 'operation.apply-sleep',
        outcome: 'prevented',
        reasonCode: 'move.tackle.sleep',
        result: expect.objectContaining({
          recipients: [expect.objectContaining({
            recipientId: 'target-token',
            outcome: 'prevented',
            reasonCode: 'condition-immunity',
            blockers: [{
              subject: 'Sleep',
              source: 'Electric Terrain (legacy.terrain.electric)',
            }],
          })],
        }),
      }),
    ]))
    expect(resolution.sheetReads).toContainEqual({
      kind: 'pokemon',
      slug: 'target',
      revision: 7,
    })
  })

  it('stores Misty first-turn protection as a target-turn suppression without preventing the affliction', () => {
    const definition = validateMoveSpec({
      schemaVersion: 2,
      canonicalId: 'Tackle',
      version: 2,
      targeting: {
        kind: 'single-target',
        minTargets: 1,
        maxTargets: 1,
        selector: { kind: 'selected-targets' },
      },
      preconditions: [],
      costs: [],
      phases: [{
        phase: 'hit',
        operations: [{
          id: 'operation.apply-burn',
          kind: 'condition',
          source: { kind: 'move', id: 'move.tackle' },
          recipients: { kind: 'attacked-targets' },
          phase: 'hit',
          reasonCode: 'move.tackle.burn',
          payload: {
            action: 'apply',
            conditionId: 'burned',
            conditionSource: null,
            filter: null,
            randomChoice: null,
            duration: null,
            saveTiming: 'canonical',
            stackPolicy: { kind: 'refresh', maxStacks: null },
          },
        }],
      }],
      registeredHandlerId: null,
      presentation: { displayName: 'Tackle', vfxKey: null, tags: ['condition'] },
    })
    const runtime: MoveSpecV2Runtime = {
      canonicalId: 'Tackle',
      kind: 'movespec-v2',
      version: definition.spec.version,
      definitionHash: definition.definitionHash,
      sourceModule: 'tests/misty-terrain-condition',
      definition,
    }
    const terrainMap = map()
    terrainMap.fieldEffects = {
      weather: [],
      terrains: [{ kind: 'misty', scope: 'field' }],
      rooms: [],
    }
    const context = buildAuthoritativeMoveRulesContext({
      map: terrainMap,
      pokemonSheets: new Map([
        ['actor', sheet('actor')],
        ['target', sheet('target')],
      ]),
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: intent(),
      candidatePlacementIds: ['target-token'],
      selectedPlacementIds: ['target-token'],
      random: createFiniteAuthoritativeMoveRandomStream([]),
      time: 10_000,
    })
    const entry = context.queries.resolveActorMoveEntry('Tackle')
    if (!entry.ok) throw new Error(entry.message)

    const resolution = resolveImmediateMoveSpec({
      context,
      runtime,
      entry: entry.entry,
      authoritativeTargetIds: ['target-token'],
    })
    const encounterChange = resolution.native.coreStateChanges.changes.find(
      change => change.kind === 'encounter-state',
    )
    const sheetChange = resolution.native.coreStateChanges.changes.find(
      change => change.kind === 'sheet-state',
    )
    if (!encounterChange || encounterChange.kind !== 'encounter-state') {
      throw new Error('Expected Misty encounter-state protection')
    }
    if (!sheetChange || sheetChange.kind !== 'sheet-state') {
      throw new Error('Expected persistent condition sheet state')
    }
    const effects = parseEncounterState(encounterChange.current).effects
    const suppression = effects.find(effect => (
      effect.kind === 'condition' && effect.payload.action === 'suppress'
    ))

    expect(resolution.transaction.conditionUpdates).toEqual([{
      id: 'target-token',
      conditions: ['Burned'],
    }])
    expect(suppression).toMatchObject({
      id: expect.stringMatching(/^condition-protection\.[0-9a-f]{32}$/),
      source: {
        operationId: 'operation.apply-burn',
        moveId: 'move.tackle',
        placementId: 'actor-token',
      },
      affected: { placementIds: ['target-token'] },
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
      tags: ['condition-protection', 'terrain', 'misty'],
      payload: { conditionId: 'burned', action: 'suppress', saveTiming: null },
      transferPolicy: 'expire',
    })
    expect(resolution.trace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationId: 'operation.apply-burn',
        outcome: 'applied',
        result: expect.objectContaining({
          recipients: [expect.objectContaining({
            details: expect.objectContaining({
              firstTurnProtection: {
                terrainKind: 'misty',
                zoneId: 'legacy.terrain.misty',
                reasonCode: 'terrain.misty.first-turn-status-protection',
                effectIds: [suppression?.id],
              },
            }),
          })],
        }),
      }),
    ]))
    expect(projectEffectiveConditions({
      sheetConditions: ['Burned'],
      encounterEffects: effects,
      target: { placementId: 'target-token' },
    }).conditions).toEqual([])

    const expired = applyEncounterEffectLifecycleEvent(
      { effects },
      { kind: 'turn-end', placementId: 'target-token' },
    )
    expect(expired.effects).toEqual([])
    expect(projectEffectiveConditions({
      sheetConditions: ['Burned'],
      encounterEffects: expired.effects,
      target: { placementId: 'target-token' },
    }).conditions).toEqual(['Burned'])
    expect((sheetChange.current as CharacterSheet).combat?.conditions).toEqual(['Burned'])
  })

  it('carries persistent and source-linked conditions into the immediate atomic plan', () => {
    const definition = validateMoveSpec({
      schemaVersion: 2,
      canonicalId: 'Tackle',
      version: 2,
      targeting: {
        kind: 'single-target',
        minTargets: 1,
        maxTargets: 1,
        selector: { kind: 'selected-targets' },
      },
      preconditions: [],
      costs: [],
      phases: [{
        phase: 'hit',
        operations: [{
          id: 'operation.condition-roll',
          kind: 'roll',
          source: { kind: 'move', id: 'move.tackle' },
          recipients: { kind: 'attacked-targets' },
          phase: 'hit',
          reasonCode: 'move.tackle.condition-roll',
          payload: {
            rollId: 'roll.condition',
            formula: { kind: 'dice', count: 1, sides: 2, modifier: 0 },
          },
        }, {
          id: 'operation.apply-random-condition',
          kind: 'condition',
          source: { kind: 'operation', id: 'operation.condition-roll' },
          recipients: { kind: 'attacked-targets' },
          phase: 'hit',
          reasonCode: 'move.tackle.random-condition',
          payload: {
            action: 'random-choice',
            conditionId: null,
            conditionSource: null,
            filter: null,
            randomChoice: {
              rollId: 'roll.condition',
              conditionIds: ['burned', 'poisoned'],
            },
            duration: null,
            saveTiming: 'canonical',
            stackPolicy: { kind: 'refresh', maxStacks: null },
          },
        }, {
          id: 'operation.apply-confusion',
          kind: 'condition',
          source: { kind: 'move', id: 'move.tackle' },
          recipients: { kind: 'attacked-targets' },
          phase: 'hit',
          reasonCode: 'move.tackle.confusion',
          payload: {
            action: 'apply',
            conditionId: 'confused',
            conditionSource: null,
            filter: null,
            randomChoice: null,
            duration: {
              effectId: 'effect.tackle-confusion',
              duration: {
                kind: 'turns',
                subject: 'target',
                boundary: 'end',
                remaining: 1,
              },
            },
            saveTiming: 'end-turn',
            stackPolicy: { kind: 'refresh', maxStacks: null },
          },
        }],
      }],
      registeredHandlerId: null,
      presentation: { displayName: 'Tackle', vfxKey: null, tags: ['condition'] },
    })
    const runtime: MoveSpecV2Runtime = {
      canonicalId: 'Tackle',
      kind: 'movespec-v2',
      version: definition.spec.version,
      definitionHash: definition.definitionHash,
      sourceModule: 'tests/conditions',
      definition,
    }
    const context = buildAuthoritativeMoveRulesContext({
      map: map(),
      pokemonSheets: new Map([
        ['actor', sheet('actor')],
        ['target', sheet('target')],
      ]),
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: intent(),
      candidatePlacementIds: ['target-token'],
      selectedPlacementIds: ['target-token'],
      random: createFiniteAuthoritativeMoveRandomStream([0]),
      time: 10_000,
    })
    const entry = context.queries.resolveActorMoveEntry('Tackle')
    if (!entry.ok) throw new Error(entry.message)

    const resolution = resolveImmediateMoveSpec({
      context,
      runtime,
      entry: entry.entry,
      authoritativeTargetIds: ['target-token'],
    })

    expect(resolution.transaction.conditionUpdates).toEqual([{
      id: 'target-token',
      conditions: ['Burned'],
    }])
    expect(resolution.native.coreStateChanges.changes.map(change => change.kind)).toEqual([
      'sheet-state',
      'encounter-state',
    ])
    expect(resolution.native.coreStateChanges.groups.encounter[0]?.changes[0]?.current)
      .toMatchObject({
        effects: [{
          source: {
            operationId: 'operation.apply-confusion',
            moveId: 'move.tackle',
            placementId: 'actor-token',
          },
          affected: { placementIds: ['target-token'] },
          payload: {
            conditionId: 'confused',
            action: 'apply',
            saveTiming: 'end-turn',
          },
        }],
      })
    expect(resolution.trace.events.filter(event => event.kind === 'operation'))
      .toMatchObject([
        { operationId: 'operation.condition-roll', outcome: 'applied' },
        { operationId: 'operation.apply-random-condition', outcome: 'applied' },
        { operationId: 'operation.apply-confusion', outcome: 'applied' },
      ])
  })
})
