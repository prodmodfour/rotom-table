import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterZone } from '#shared/moveAutomation/encounterZones'
import {
  parseMoveEffectOperation,
  type MoveEffectOperation,
  type MoveEffectOperationKind,
  type MoveEffectRecipientSelectorKind,
} from '#shared/moveAutomation/effects'
import {
  parseMoveResolutionAuditTrace,
  type MoveResolutionAuditTrace,
  type MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import {
  MoveMapOperationReductionError,
  reduceMoveMapOperations,
  type MoveMapEffectOperation,
  type MoveResolvedMapEffectOperation,
} from '~~/server/domain/moveAutomation/reducers/mapOperations'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  capabilityEncounterEffectFixture,
  moveListOverlayEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'map-reducer-arena',
  name: 'Map Reducer Arena',
  revision: 8,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [{ kind: 'rainy', rounds: 2 }], terrains: [], rooms: [] },
  encounterState: createEmptyEncounterState(),
  placements: [
    placement('actor-token', 'actor', 0),
    placement('target-token', 'target', 1),
    placement('bystander-token', 'bystander', 2),
  ],
  lights: [],
  activeScene: { name: 'Reducer Scene', startedAt: 100 },
  initiative: { activeId: 'actor-token', round: 2 },
  metadata: { note: 'preserved' },
  ...overrides,
})

const pokemonSheet = (
  slug: string,
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug,
  nickname: slug === 'actor' ? 'Sparky' : slug,
  species: slug === 'target' ? 'Snorlax' : 'Pikachu',
  level: 20,
  revision: slug === 'actor' ? 4 : 5,
  movelist: slug === 'actor' ? [{ name: 'Reducer Move', frequency: 'Scene x2' }] : [],
  combat: { currentHp: 50 },
  ...overrides,
})

const intent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Reducer Move',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

const buildContext = (overrides: {
  readonly map?: TabletopMap
  readonly actorSheet?: CharacterSheet
} = {}) => buildAuthoritativeMoveRulesContext({
  map: overrides.map ?? mapFixture(),
  pokemonSheets: new Map([
    ['actor', overrides.actorSheet ?? pokemonSheet('actor')],
    ['target', pokemonSheet('target')],
    ['bystander', pokemonSheet('bystander')],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: intent(),
  candidatePlacementIds: ['target-token', 'bystander-token'],
  selectedPlacementIds: ['target-token'],
  random: () => 0,
  time: 5_000,
})

const operation = (
  id: string,
  kind: MoveEffectOperationKind,
  payload: Record<string, unknown>,
  phase: MoveEffectOperation['phase'],
  recipients: MoveEffectRecipientSelectorKind = 'none',
): MoveMapEffectOperation => parseMoveEffectOperation({
  id,
  kind,
  source: { kind: 'move', id: 'move.reducer-test' },
  recipients: { kind: recipients },
  phase,
  reasonCode: `move.reducer-test.${id.split('.').at(-1)}`,
  payload,
}) as MoveMapEffectOperation

const emission = (
  value: MoveMapEffectOperation,
  recipientIds: readonly string[] = [],
): MoveResolvedMapEffectOperation => ({ operation: value, recipientIds })

const traceFor = (
  operations: readonly MoveResolvedMapEffectOperation[],
): MoveResolutionAuditTrace => {
  let sequence = 0
  let previousPhase: MoveEffectOperation['phase'] | null = null
  const events: Array<Record<string, unknown>> = []
  for (const { operation: value, recipientIds } of operations) {
    if (value.phase !== previousPhase) {
      sequence += 1
      events.push({
        sequence,
        kind: 'phase-transition',
        reasonCode: `${value.phase}-phase`,
        from: previousPhase,
        to: value.phase,
      })
      previousPhase = value.phase
    }
    sequence += 1
    events.push({
      sequence,
      kind: 'operation',
      phase: value.phase,
      operationId: value.id,
      operationKind: value.kind,
      recipientIds: [...recipientIds],
      outcome: 'applied',
      reasonCode: value.reasonCode,
      input: value.payload as unknown as MoveResolutionTraceJsonValue,
      result: { status: 'emitted' },
    })
  }
  return parseMoveResolutionAuditTrace({
    schemaVersion: 1,
    program: {
      canonicalId: 'Reducer Move',
      runtimeKind: 'movespec-v2',
      runtimeVersion: 2,
      definitionHash: 'a'.repeat(64),
    },
    ruleset: {
      rulesetId: 'ptu-1.05-repository-reference-2026-07-09',
      sourceDataSha256: 'b'.repeat(64),
    },
    ancestry: [],
    events,
  })
}

const dynamicRecipients = () => ({
  attackedTargetIds: ['target-token', 'bystander-token'],
  hitTargetIds: ['target-token'],
  missedTargetIds: ['bystander-token'],
  damagedTargetIds: ['target-token'],
  faintedTargetIds: [],
})

const presentation = () => ({
  operationId: 'op_mapreduce001',
  move: { name: 'Reducer Move', type: 'Fire' },
  selectedTargetIds: ['target-token'],
  area: {
    templateKind: 'line' as const,
    cells: [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
    direction: 'east' as const,
  },
})

const reduce = (options: {
  readonly context?: ReturnType<typeof buildContext>
  readonly initialMap?: TabletopMap
  readonly operations: readonly MoveResolvedMapEffectOperation[]
  readonly hazards?: Parameters<typeof reduceMoveMapOperations>[0]['hazards']
  readonly usageResources?: Parameters<typeof reduceMoveMapOperations>[0]['usageResources']
}) => reduceMoveMapOperations({
  context: options.context ?? buildContext(),
  ...(options.initialMap ? { initialMap: options.initialMap } : {}),
  operations: options.operations,
  dynamicRecipients: dynamicRecipients(),
  usageResources: options.usageResources ?? [{
    resourceId: 'move.frequency-use',
    placementId: 'actor-token',
    move: {
      moveName: 'Reducer Move',
      moveKey: 'reducer-move',
      frequency: 'Scene x2',
    },
  }],
  hazards: options.hazards,
  presentation: presentation(),
  actorName: 'Sparky',
  frequency: 'Scene x2',
  trace: traceFor(options.operations),
})

const operationTraceEvents = (trace: MoveResolutionAuditTrace) => trace.events.filter(
  event => event.kind === 'operation',
)

const cell = (x: number, z = 0): GridAnchor => ({ x, y: 0, z })

const removableObscurationZone = (
  kind: 'smoke' | 'barrier',
  id: string,
  at: GridAnchor,
) => parseEncounterZone({
  id,
  kind,
  source: {
    kind: 'operation',
    operationId: `operation.seed-${kind}`,
    moveId: kind === 'smoke' ? 'smokescreen' : 'barrier',
    placementId: 'actor-token',
  },
  sideId: null,
  geometry: { kind: 'cells', cells: [at] },
  layer: 1,
  duration: { kind: 'scene', remaining: null },
  stacking: { kind: kind === 'smoke' ? 'refresh' : 'independent', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: [kind],
  payload: kind === 'smoke' ? { smokeId: 'smokescreen' } : { barrierId: 'barrier' },
})

const hazardZone = (id: string, familyId: string, at: GridAnchor) => parseEncounterZone({
  id,
  kind: 'hazard',
  source: {
    kind: 'operation',
    operationId: 'operation.seed-hazard',
    moveId: 'move.seed-hazard',
    placementId: 'actor-token',
  },
  sideId: null,
  geometry: { kind: 'cells', cells: [at] },
  layer: 1,
  duration: { kind: 'scene', remaining: null },
  stacking: { kind: 'add-layer', maxLayers: 3 },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['hazard', 'move-zone', 'spikes'],
  payload: {
    hazardId: 'spikes',
    familyId,
    charges: null,
    maxCharges: null,
  },
})

describe('MoveSpec map, usage, and log reducers', () => {
  it('reduces placeholders, usage, logs, and presentation into one map revision', () => {
    const operations = [
      emission(operation('operation.sun', 'field', {
        action: 'apply',
        category: 'weather',
        fieldId: 'sunny',
        rounds: 5,
      }, 'schedule')),
      emission(operation('operation.spikes', 'hazard', {
        action: 'add',
        familyId: 'hazard.spikes',
        zoneKind: 'hazard',
        effectId: 'spikes',
        ownership: 'neutral',
        geometry: {
          kind: 'selection',
          cellSetId: 'cells.spikes',
          count: { kind: 'exact', count: 2 },
          adjacency: 'orthogonal',
          connectedness: 'none',
        },
        layers: 1,
        maxLayers: 3,
        charges: null,
        maxCharges: null,
      }, 'schedule')),
      emission(operation('operation.usage', 'usage', {
        action: 'spend',
        resourceId: 'move.frequency-use',
        amount: 1,
      }, 'usage', 'actor'), ['actor-token']),
      emission(operation('operation.log-hit', 'log', {
        messageKey: 'move.reducer-test.hit',
        arguments: [
          { key: 'amount', value: 12 },
          { key: 'critical', value: false },
        ],
      }, 'cleanup', 'hit-targets'), ['target-token']),
    ]
    const context = buildContext()
    const mapBefore = structuredClone(context.map)

    const result = reduce({
      context,
      operations,
      hazards: { cellSets: new Map([['cells.spikes', [cell(3), cell(4)]]]) },
    })
    const repeated = reduce({
      context,
      operations,
      hazards: { cellSets: new Map([['cells.spikes', [cell(3), cell(4)]]]) },
    })

    expect(context.map).toEqual(mapBefore)
    expect(repeated).toEqual(result)
    expect(result.previousRevision).toBe(8)
    expect(result.revision).toBe(9)
    expect(result.nextMap.revision).toBe(9)
    expect(result.nextMap.updatedAt).toBe(5_000)
    expect(result.nextMap.fieldEffects?.weather).toEqual([{
      kind: 'sunny',
      rounds: 5,
      source: 'move.reducer-test',
    }])
    expect(result.nextMap.hazards).toEqual([])
    expect(result.nextMap.encounterState?.zones).toEqual([
      expect.objectContaining({
        kind: 'weather',
        source: {
          kind: 'operation',
          operationId: 'operation.sun',
          moveId: 'move.reducer-test',
          placementId: 'actor-token',
        },
        sideId: null,
        duration: { kind: 'rounds', boundary: 'end', remaining: 5 },
        fieldPolicy: {
          priority: 0,
          replacementGroup: 'field.weather',
          suppression: { sources: [] },
        },
        payload: { weatherId: 'sunny' },
      }),
      expect.objectContaining({
        kind: 'hazard',
        sideId: null,
        geometry: { kind: 'cells', cells: [cell(3)] },
        layer: 1,
        stacking: { kind: 'add-layer', maxLayers: 3 },
        payload: {
          hazardId: 'spikes',
          familyId: 'hazard.spikes',
          charges: null,
          maxCharges: null,
        },
      }),
      expect.objectContaining({
        kind: 'hazard',
        sideId: null,
        geometry: { kind: 'cells', cells: [cell(4)] },
      }),
    ])
    expect(result.nextMap.moveUsage?.byPlacementId['actor-token']?.['reducer-move']).toMatchObject({
      frequency: 'scene',
      uses: 1,
      updatedAt: 5_000,
    })

    expect(result.stateChanges.changes.map(change => change.kind)).toEqual([
      'encounter-state',
      'map-field-effects',
      'map-move-usage',
      'map-metadata',
    ])
    expect(result.stateChanges.groups.map).toHaveLength(1)
    expect(result.stateChanges.groups.map[0]?.changes).toHaveLength(3)
    expect(result.stateChanges.groups.encounter).toHaveLength(1)
    expect(result.stateChanges.groups.map[0]?.changes.find(change => (
      change.kind === 'map-metadata'
    ))?.compensation).toEqual({
      kind: 'unavailable',
      safety: 'externally-observed',
      reasonCode: 'accepted-log-may-be-observed',
    })
    expect(result.stateChanges.expectedRevisions).toEqual([
      { kind: 'map', mapSlug: 'map-reducer-arena', expectedRevision: 8 },
    ])
    expect(result.operationResults.map(item => item.outcome)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
    ])
    expect(result.usage).toEqual([
      expect.objectContaining({
        operationId: 'operation.usage',
        resourceId: 'move.frequency-use',
        previousUsage: expect.objectContaining({ uses: 0 }),
        usage: expect.objectContaining({ uses: 1 }),
      }),
    ])
    expect(result.structuredLog).toEqual([{
      operationId: 'operation.log-hit',
      phase: 'cleanup',
      reasonCode: 'move.reducer-test.log-hit',
      messageKey: 'move.reducer-test.hit',
      recipientIds: ['target-token'],
      arguments: [
        { key: 'amount', value: 12 },
        { key: 'critical', value: false },
      ],
    }])
    expect(result.nextMap.metadata?.moveLog).toEqual([
      expect.objectContaining({
        at: 5_000,
        userId: 'actor-token',
        userName: 'Sparky',
        moveName: 'Reducer Move',
        scriptKind: 'movespec-v2',
        scriptVersion: 2,
        definitionHash: 'a'.repeat(64),
        lines: ['Sparky used Reducer Move.', 'Frequency: Scene x2'],
        structured: result.structuredLog,
      }),
    ])
    expect(result.presentation).toMatchObject({
      operationId: 'op_mapreduce001',
      actorPlacementId: 'actor-token',
      attackedTargetIds: ['target-token', 'bystander-token'],
      hitTargetIds: ['target-token'],
      outcomeKind: 'mixed',
      area: { templateKind: 'line', direction: 'east' },
    })
    expect(operationTraceEvents(result.trace).map(event => (
      event.kind === 'operation' ? [event.operationId, event.outcome, event.result] : null
    ))).toEqual([
      ['operation.sun', 'applied', expect.objectContaining({ status: 'applied' })],
      ['operation.spikes', 'applied', expect.objectContaining({ status: 'applied' })],
      ['operation.usage', 'applied', expect.objectContaining({ status: 'applied' })],
      ['operation.log-hit', 'applied', expect.objectContaining({ status: 'applied' })],
    ])
    expect(result.sheetReads).toEqual([{ kind: 'pokemon', slug: 'actor', revision: 4 }])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.nextMap)).toBe(true)
    expect(Object.isFrozen(result.structuredLog)).toBe(true)
  })

  it('materializes and removes typed move-list effects through temporary-effect operations', () => {
    const add = emission(operation('operation.copy-move', 'temporary-effect', {
      action: 'add',
      effectId: 'effect.move-list.target-token',
      definition: {
        kind: 'move-list-overlay',
        duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 2 },
        stacks: 1,
        charges: null,
        stackPolicy: { kind: 'replace', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null },
        tags: ['move-list', 'temporary'],
        payload: {
          action: 'add',
          canonicalMoveId: 'Scratch',
          copiedSpecHash: 'c'.repeat(64),
        },
        dispel: { policy: 'matching-tags', tags: ['move-list'] },
        transferPolicy: 'expire',
      },
    }, 'schedule', 'hit-targets'), ['target-token'])

    const added = reduce({ operations: [add] })

    expect(added.nextMap.encounterState?.effects).toEqual([
      expect.objectContaining({
        id: 'effect.move-list.target-token',
        kind: 'move-list-overlay',
        source: {
          operationId: 'operation.copy-move',
          moveId: 'move.reducer-test',
          placementId: 'actor-token',
        },
        affected: {
          placementIds: ['target-token'],
          sideIds: [],
          cells: [],
        },
        createdRound: 2,
        createdTurn: 0,
        duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 2 },
        payload: {
          action: 'add',
          canonicalMoveId: 'Scratch',
          copiedSpecHash: 'c'.repeat(64),
        },
      }),
    ])
    expect(added.operationResults[0]).toMatchObject({
      outcome: 'applied',
      details: {
        action: 'add',
        effectId: 'effect.move-list.target-token',
        transitionKinds: ['added'],
      },
    })
    expect(added.stateChanges.groups.encounter).toHaveLength(1)

    const seededMap = mapFixture({
      encounterState: {
        ...createEmptyEncounterState(),
        effects: [moveListOverlayEncounterEffectFixture()],
      },
    })
    const remove = emission(operation('operation.remove-copy', 'temporary-effect', {
      action: 'remove',
      effectId: 'effect.move-list.target-token',
    }, 'cleanup'))
    const removed = reduce({ context: buildContext({ map: seededMap }), operations: [remove] })

    expect(removed.nextMap.encounterState?.effects).toEqual([])
    expect(removed.operationResults[0]).toMatchObject({
      outcome: 'applied',
      details: { action: 'remove', transitionKinds: ['removed'] },
    })
  })

  it('coalesces prior core encounter effects with native hazard zones', () => {
    const context = buildContext()
    const initialMap: TabletopMap = {
      ...structuredClone(context.map),
      encounterState: {
        ...createEmptyEncounterState(),
        effects: [capabilityEncounterEffectFixture()],
      },
    }
    const hazard = emission(operation('operation.core-and-hazard', 'hazard', {
      action: 'add',
      familyId: 'hazard.sticky-web',
      zoneKind: 'hazard',
      effectId: 'sticky-web',
      ownership: 'neutral',
      geometry: {
        kind: 'selection',
        cellSetId: 'cells.web',
        count: { kind: 'exact', count: 1 },
        adjacency: 'orthogonal',
        connectedness: 'none',
      },
      layers: 1,
      maxLayers: 1,
      charges: null,
      maxCharges: null,
    }, 'schedule'))

    const result = reduce({
      context,
      initialMap,
      operations: [hazard],
      hazards: { cellSets: new Map([['cells.web', [cell(5, 5)]]]) },
    })

    expect(result.nextMap.encounterState?.effects).toEqual(initialMap.encounterState?.effects)
    expect(result.nextMap.encounterState?.zones).toHaveLength(1)
    expect(result.stateChanges.groups.encounter).toHaveLength(1)
    expect(result.stateChanges.groups.encounter[0]?.changes).toHaveLength(1)
    expect(result.stateChanges.groups.encounter[0]?.changes[0]).toMatchObject({
      kind: 'encounter-state',
      previous: { effects: [], zones: [] },
      current: {
        effects: [expect.objectContaining({ id: 'effect.capability.actor-token' })],
        zones: [expect.objectContaining({ payload: expect.objectContaining({ hazardId: 'sticky-web' }) })],
      },
    })
  })

  it('groups Daily map and sheet usage in the same atomic revision envelope', () => {
    const dailyActor = pokemonSheet('actor', {
      revision: 11,
      movelist: [{ name: 'Reducer Move', frequency: 'Daily x2' }],
    })
    const context = buildContext({ actorSheet: dailyActor })
    const usageOperation = emission(operation('operation.daily-usage', 'usage', {
      action: 'spend',
      resourceId: 'move.daily-use',
      amount: 1,
    }, 'usage', 'actor'), ['actor-token'])

    const result = reduceMoveMapOperations({
      context,
      operations: [usageOperation],
      dynamicRecipients: dynamicRecipients(),
      usageResources: [{
        resourceId: 'move.daily-use',
        placementId: 'actor-token',
        move: { moveName: 'Reducer Move', moveKey: 'reducer-move', frequency: 'Daily x2' },
      }],
      presentation: presentation(),
      actorName: 'Sparky',
      frequency: 'Daily x2',
      trace: traceFor([usageOperation]),
    })

    expect(result.revision).toBe(9)
    expect(result.stateChanges.changes.map(change => change.kind)).toEqual([
      'map-move-usage',
      'sheet-state',
      'map-metadata',
    ])
    expect(result.stateChanges.expectedRevisions).toEqual([
      { kind: 'map', mapSlug: 'map-reducer-arena', expectedRevision: 8 },
      { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'actor', expectedRevision: 11 },
    ])
    const sheetChange = result.stateChanges.groups.sheets[0]?.changes[0]
    expect(sheetChange).toMatchObject({
      kind: 'sheet-state',
      expectedRevision: 11,
      current: {
        revision: 12,
        updatedAt: 5_000,
        moveUsage: { daily: { 'reducer-move': { uses: 1, updatedAt: 5_000 } } },
      },
      changedFields: ['moveUsage'],
      compensation: {
        kind: 'inverse',
        strategy: 'restore-previous-value',
      },
    })
    expect(result.nextMap.moveUsage?.byPlacementId['actor-token']?.['reducer-move']).toMatchObject({
      frequency: 'daily',
      uses: 1,
    })
    expect(result.stateChanges.groups.map).toHaveLength(1)
    expect(result.stateChanges.groups.sheets).toHaveLength(1)
  })

  it('removes authoritative fields/zones and traces absent zone IDs as no-ops', () => {
    const map = mapFixture({
      // Legacy rows stay in their compatibility lane; typed move operations do
      // not match free-form owners or mutate them.
      hazards: [{ kind: 'fire', ...cell(4), owner: 'legacy-label' }],
      fieldEffects: { weather: [{ kind: 'sunny', rounds: 2 }], terrains: [], rooms: [] },
      encounterState: {
        ...createEmptyEncounterState(),
        zones: [
          hazardZone('zone.seed.spikes', 'hazard.spikes', cell(3)),
          removableObscurationZone('barrier', 'zone.seed.barrier', cell(4)),
          removableObscurationZone('smoke', 'zone.seed.smoke', cell(5)),
        ],
      },
    })
    const context = buildContext({ map })
    const operations = [
      emission(operation('operation.remove-sun', 'field', {
        action: 'remove', category: 'weather', fieldId: 'sunny',
      }, 'cleanup')),
      emission(operation('operation.remove-spikes', 'hazard', {
        action: 'remove',
        target: { kind: 'zone-id', zoneId: 'zone.seed.spikes' },
      }, 'cleanup')),
      emission(operation('operation.remove-barrier', 'hazard', {
        action: 'remove',
        target: { kind: 'zone-id', zoneId: 'zone.seed.barrier' },
      }, 'cleanup')),
      emission(operation('operation.remove-smoke', 'hazard', {
        action: 'remove',
        target: { kind: 'zone-id', zoneId: 'zone.seed.smoke' },
      }, 'cleanup')),
      emission(operation('operation.remove-missing', 'hazard', {
        action: 'remove',
        target: { kind: 'zone-id', zoneId: 'zone.missing' },
      }, 'cleanup')),
    ]

    const result = reduce({ context, operations })

    expect(result.nextMap.fieldEffects?.weather).toEqual([])
    expect(result.nextMap.hazards).toEqual([{ kind: 'fire', ...cell(4), owner: 'legacy-label' }])
    expect(result.nextMap.encounterState?.zones).toEqual([])
    expect(result.operationResults.map(item => item.outcome)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
      'no-op',
    ])
    expect(operationTraceEvents(result.trace).map(event => (
      event.kind === 'operation' ? event.outcome : null
    ))).toEqual(['applied', 'applied', 'applied', 'applied', 'no-op'])
  })

  it('fails closed for unresolved geometry, side fields, and forged recipients', () => {
    const hazard = emission(operation('operation.unresolved-hazard', 'hazard', {
      action: 'add',
      familyId: 'hazard.spikes',
      zoneKind: 'hazard',
      effectId: 'spikes',
      ownership: 'neutral',
      geometry: {
        kind: 'selection',
        cellSetId: 'cells.missing',
        count: { kind: 'exact', count: 1 },
        adjacency: 'orthogonal',
        connectedness: 'none',
      },
      layers: 1,
      maxLayers: 3,
      charges: null,
      maxCharges: null,
    }, 'schedule'))
    const context = buildContext()
    const before = structuredClone(context.map)

    expect(() => reduce({ context, operations: [hazard] })).toThrowError(expect.objectContaining({
      name: MoveMapOperationReductionError.name,
      code: 'hazard-geometry-missing',
    }))
    expect(context.map).toEqual(before)

    const side = emission(operation('operation.side-field', 'field', {
      action: 'apply', category: 'side', fieldId: 'reflect', rounds: 5,
    }, 'schedule'))
    expect(() => reduce({ operations: [side] })).toThrowError(expect.objectContaining({
      code: 'field-placeholder-unsupported',
    }))

    const forgedLog = emission(operation('operation.forged-log', 'log', {
      messageKey: 'move.reducer-test.log', arguments: [],
    }, 'cleanup', 'hit-targets'), ['bystander-token'])
    expect(() => reduce({ operations: [forgedLog] })).toThrowError(expect.objectContaining({
      code: 'recipient-set-mismatch',
    }))
  })
})
