import { describe, expect, it } from 'vitest'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import {
  createEmptyEncounterState,
  type EncounterSideId,
} from '#shared/moveAutomation/encounterState'
import {
  parseEncounterZone,
  type EncounterGlobalFieldZone,
  type EncounterZone,
  type EncounterZoneCell,
} from '#shared/moveAutomation/encounterZones'
import {
  parseMoveEffectOperation,
  type MoveBattlefieldZoneFilter,
  type MoveBattlefieldZoneMutation,
  type MoveFieldEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  parseMoveResolutionAuditTrace,
  type MoveResolutionAuditTrace,
  type MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import { createEncounterGlobalFieldZone } from '~~/server/domain/moveAutomation/fieldLifecycle'
import { projectBattlefieldZones } from '~~/server/domain/moveAutomation/battlefieldZones'
import {
  MoveMapOperationReductionError,
  reduceMoveMapOperations,
  type MoveMapOperationReduction,
  type MoveResolvedMapEffectOperation,
} from '~~/server/domain/moveAutomation/reducers/mapOperations'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GridAnchor, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const actorPlacementId = 'actor-token'
const targetPlacementId = 'target-token'

const placement = (
  id: string,
  sheetSlug: string,
  sideId: EncounterSideId,
  position: GridAnchor,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  sideId,
  position,
})

const sheet = (slug: string): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'actor' ? 'Cinderace' : 'Eevee',
  level: 20,
  revision: 1,
  combat: { currentHp: 50 },
  movelist: [{ name: 'Field Mutation Scenario' }],
})

const mapFixture = (
  zones: readonly EncounterZone[] = [],
  fieldEffects: TabletopMap['fieldEffects'] = { weather: [], terrains: [], rooms: [] },
): TabletopMap => ({
  schemaVersion: 2,
  slug: 'field-mutation-arena',
  name: 'Field Mutation Arena',
  revision: 12,
  dimensions: { x: 10, y: 3, z: 10 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects,
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      red: { id: 'red', label: 'Red', status: 'active' },
      blue: { id: 'blue', label: 'Blue', status: 'active' },
    },
    zones,
  },
  placements: [
    placement(actorPlacementId, 'actor', 'red', { x: 1, y: 0, z: 2 }),
    placement(targetPlacementId, 'target', 'blue', { x: 7, y: 0, z: 2 }),
  ],
  lights: [],
  activeScene: { name: 'Cleanup Scene', startedAt: 100 },
  initiative: { activeId: actorPlacementId, round: 2 },
})

const contextFor = (map: TabletopMap) => buildAuthoritativeMoveRulesContext({
  map,
  pokemonSheets: new Map([
    ['actor', sheet('actor')],
    ['target', sheet('target')],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: {
    schemaVersion: 1,
    placementId: actorPlacementId,
    moveName: 'Field Mutation Scenario',
    selection: {
      kind: 'area',
      areaTemplateId: 'line:any:6',
      direction: 'east',
    },
  } satisfies ResolveMoveIntent,
  candidatePlacementIds: [targetPlacementId],
  selectedPlacementIds: [targetPlacementId],
  random: () => 0,
  time: 5_000,
})

const source = (
  operationId: string,
  placementId: string | null = actorPlacementId,
) => ({
  kind: 'operation' as const,
  operationId,
  moveId: 'move.seed-zone',
  placementId,
})

const commonZone = (input: {
  readonly id: string
  readonly kind: EncounterZone['kind']
  readonly sideId: EncounterSideId | null
  readonly geometry: EncounterZone['geometry']
  readonly tags: readonly string[]
  readonly payload: EncounterZone['payload']
  readonly sourcePlacementId?: string | null
}): EncounterZone => parseEncounterZone({
  id: input.id,
  kind: input.kind,
  source: source(`operation.seed-${input.id.replaceAll('.', '-')}`, input.sourcePlacementId),
  sideId: input.sideId,
  geometry: input.geometry,
  layer: 1,
  duration: { kind: 'scene', remaining: null },
  stacking: input.kind === 'hazard' || input.kind === 'pledge'
    ? { kind: 'add-layer', maxLayers: 3 }
    : { kind: 'refresh', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: input.tags,
  payload: input.payload,
})

const hazard = (input: {
  readonly id: string
  readonly sideId: EncounterSideId
  readonly cell: EncounterZoneCell
  readonly sourcePlacementId?: string
}): EncounterZone => commonZone({
  id: input.id,
  kind: 'hazard',
  sideId: input.sideId,
  geometry: { kind: 'cells', cells: [input.cell] },
  tags: ['hazard', 'move-zone'],
  payload: {
    hazardId: 'spikes',
    familyId: 'hazard.spikes',
    charges: null,
    maxCharges: null,
  },
  sourcePlacementId: input.sourcePlacementId,
})

const smoke = (id: string, cell: EncounterZoneCell): EncounterZone => commonZone({
  id,
  kind: 'smoke',
  sideId: null,
  geometry: { kind: 'cells', cells: [cell] },
  tags: ['smoke', 'obscuration'],
  payload: { smokeId: 'smokescreen' },
})

const localTerrain = (id: string, cell: EncounterZoneCell): EncounterZone => commonZone({
  id,
  kind: 'terrain',
  sideId: null,
  geometry: { kind: 'cells', cells: [cell] },
  tags: ['terrain', 'local-terrain'],
  payload: { terrainId: 'grassy' },
})

const sideCondition = (input: {
  readonly id: string
  readonly sideId: EncounterSideId
  readonly tag: 'blessing' | 'coat'
}): EncounterZone => commonZone({
  id: input.id,
  kind: 'side-condition',
  sideId: input.sideId,
  geometry: { kind: 'side', sideId: input.sideId },
  tags: ['side-condition', input.tag],
  payload: { conditionId: `${input.tag}-ward` },
})

const globalField = (input: {
  readonly kind: 'weather' | 'terrain' | 'room'
  readonly fieldId: string
  readonly operationId: string
  readonly sideId?: EncounterSideId | null
}): EncounterGlobalFieldZone => createEncounterGlobalFieldZone({
  kind: input.kind,
  fieldId: input.fieldId,
  source: source(input.operationId),
  sideId: input.sideId ?? null,
  duration: { kind: 'rounds', boundary: 'end', remaining: 5 },
  replacementGroup: input.kind === 'weather'
    ? 'field.weather'
    : `field.${input.kind}.${input.fieldId}`,
})

const allZones = (
  zoneKinds: MoveBattlefieldZoneFilter['zoneKinds'],
  overrides: Partial<MoveBattlefieldZoneFilter> = {},
): MoveBattlefieldZoneFilter => ({
  zoneKinds,
  source: 'any',
  side: 'any',
  requiredTags: [],
  geometry: null,
  ...overrides,
})

const selectionGeometry = (cellSetId: string, count: number) => ({
  kind: 'selection' as const,
  cellSetId,
  count: { kind: 'exact' as const, count },
  adjacency: 'orthogonal' as const,
  connectedness: 'none' as const,
})

const operation = (input: {
  readonly id: string
  readonly mutation: MoveBattlefieldZoneMutation
  readonly recipients?: MoveFieldEffectOperation['recipients']['kind']
}): MoveFieldEffectOperation => parseMoveEffectOperation({
  id: input.id,
  kind: 'field',
  source: { kind: 'move', id: 'move.field-mutation-scenario' },
  recipients: { kind: input.recipients ?? 'none' },
  phase: 'cleanup',
  reasonCode: `move.field-mutation.${input.id.split('.').at(-1)}`,
  payload: { action: 'mutate', mutation: input.mutation },
}) as MoveFieldEffectOperation

const traceFor = (operations: readonly MoveFieldEffectOperation[]): MoveResolutionAuditTrace => (
  parseMoveResolutionAuditTrace({
    schemaVersion: 1,
    program: {
      canonicalId: 'Field Mutation Scenario',
      runtimeKind: 'movespec-v2',
      runtimeVersion: 2,
      definitionHash: 'a'.repeat(64),
    },
    ruleset: {
      rulesetId: 'ptu-1.05-repository-reference-2026-07-09',
      sourceDataSha256: 'b'.repeat(64),
    },
    ancestry: [],
    events: [
      {
        sequence: 1,
        kind: 'phase-transition',
        reasonCode: 'cleanup-phase',
        from: null,
        to: 'cleanup',
      },
      ...operations.map((entry, index) => ({
        sequence: index + 2,
        kind: 'operation',
        phase: entry.phase,
        operationId: entry.id,
        operationKind: entry.kind,
        recipientIds: entry.recipients.kind === 'none' ? [] : [targetPlacementId],
        outcome: 'applied',
        reasonCode: entry.reasonCode,
        input: entry.payload as unknown as MoveResolutionTraceJsonValue,
        result: { status: 'emitted' },
      })),
    ],
  })
)

const run = (input: {
  readonly map: TabletopMap
  readonly operations: readonly MoveFieldEffectOperation[]
  readonly cellSets?: ReadonlyMap<string, readonly GridAnchor[]>
}): MoveMapOperationReduction => {
  const context = contextFor(input.map)
  const emissions: MoveResolvedMapEffectOperation[] = input.operations.map(entry => ({
    operation: entry,
    recipientIds: entry.recipients.kind === 'none' ? [] : [targetPlacementId],
  }))
  return reduceMoveMapOperations({
    context,
    operations: emissions,
    dynamicRecipients: {
      attackedTargetIds: [targetPlacementId],
      hitTargetIds: [targetPlacementId],
      missedTargetIds: [],
      damagedTargetIds: [targetPlacementId],
      faintedTargetIds: [],
    },
    ...(input.cellSets ? { hazards: { cellSets: input.cellSets } } : {}),
    presentation: {
      operationId: 'op_fieldmutation001',
      move: { name: 'Field Mutation Scenario', type: 'Normal' },
      selectedTargetIds: [targetPlacementId],
    },
    trace: traceFor(input.operations),
  })
}

const zoneById = (result: MoveMapOperationReduction, id: string): EncounterZone | undefined => (
  result.nextMap.encounterState?.zones.find(zone => zone.id === id)
)

const resultFor = (result: MoveMapOperationReduction, operationId: string) => (
  result.operationResults.find(operationResult => operationResult.operationId === operationId)
    ?? (() => { throw new Error(`Missing result for ${operationId}`) })()
)

const traceResultFor = (result: MoveMapOperationReduction, operationId: string) => {
  const event = result.trace.events.find(candidate => (
    candidate.kind === 'operation' && candidate.operationId === operationId
  ))
  if (!event || event.kind !== 'operation') throw new Error(`Missing trace for ${operationId}`)
  return event
}

describe('authoritative battlefield field mutations', () => {
  it('proves Court Change swaps only reviewed Blessings and Hazards between explicit sides', () => {
    const zones = [
      hazard({ id: 'zone.hazard.red', sideId: 'red', cell: { x: 2, y: 0, z: 2 } }),
      hazard({ id: 'zone.hazard.blue', sideId: 'blue', cell: { x: 6, y: 0, z: 2 } }),
      sideCondition({ id: 'zone.blessing.red', sideId: 'red', tag: 'blessing' }),
      sideCondition({ id: 'zone.blessing.blue', sideId: 'blue', tag: 'blessing' }),
      sideCondition({ id: 'zone.coat.red', sideId: 'red', tag: 'coat' }),
    ]
    const map = mapFixture(zones)
    const before = structuredClone(map)
    const operations = [
      operation({
        id: 'operation.court-change-hazards',
        mutation: {
          kind: 'swap-sides',
          counterpartSide: 'other-side',
          zoneKinds: ['hazard'],
          requiredTags: [],
        },
      }),
      operation({
        id: 'operation.court-change-blessings',
        mutation: {
          kind: 'swap-sides',
          counterpartSide: 'other-side',
          zoneKinds: ['side-condition'],
          requiredTags: ['blessing'],
        },
      }),
    ]

    const result = run({ map, operations })
    const current = result.nextMap.encounterState!.zones

    expect(map).toEqual(before)
    expect(current.filter(zone => zone.kind === 'hazard').map(zone => zone.sideId))
      .toEqual(['blue', 'red'])
    expect(zoneById(result, 'zone.blessing.red')).toMatchObject({
      sideId: 'blue',
      geometry: { kind: 'side', sideId: 'blue' },
      source: { operationId: 'operation.court-change-blessings' },
    })
    expect(zoneById(result, 'zone.blessing.blue')).toMatchObject({
      sideId: 'red',
      geometry: { kind: 'side', sideId: 'red' },
    })
    expect(zoneById(result, 'zone.coat.red')).toMatchObject({ sideId: 'red' })
    expect(resultFor(result, 'operation.court-change-hazards').details).toMatchObject({
      mutationKind: 'swap-sides',
      affectedZoneIds: ['zone.hazard.red', 'zone.hazard.blue'],
    })
    expect(resultFor(result, 'operation.court-change-blessings').details).toMatchObject({
      affectedZoneIds: ['zone.blessing.red', 'zone.blessing.blue'],
    })
  })

  it('proves Defog clears Weather and destroys Hazards, Blessings, and Coats', () => {
    const sunny = globalField({
      kind: 'weather',
      fieldId: 'sunny',
      operationId: 'operation.seed-sunny',
    })
    const zones = [
      sunny,
      hazard({ id: 'zone.hazard.defog', sideId: 'red', cell: { x: 3, y: 0, z: 2 } }),
      sideCondition({ id: 'zone.blessing.defog', sideId: 'red', tag: 'blessing' }),
      sideCondition({ id: 'zone.coat.defog', sideId: 'blue', tag: 'coat' }),
      smoke('zone.smoke.preserved', { x: 4, y: 0, z: 2 }),
    ]
    const operations = [
      operation({
        id: 'operation.defog-weather',
        mutation: { kind: 'remove', target: allZones(['weather']) },
      }),
      operation({
        id: 'operation.defog-hazards',
        mutation: { kind: 'destroy', target: allZones(['hazard']) },
      }),
      operation({
        id: 'operation.defog-blessings',
        mutation: {
          kind: 'destroy',
          target: allZones(['side-condition'], { requiredTags: ['blessing'] }),
        },
      }),
      operation({
        id: 'operation.defog-coats',
        mutation: {
          kind: 'destroy',
          target: allZones(['side-condition'], { requiredTags: ['coat'] }),
        },
      }),
    ]

    const result = run({
      map: mapFixture(zones, {
        weather: [{ kind: 'sunny', rounds: 5 }],
        terrains: [],
        rooms: [],
      }),
      operations,
    })

    expect(result.nextMap.fieldEffects?.weather).toEqual([])
    expect(result.nextMap.encounterState?.zones).toEqual([
      expect.objectContaining({ id: 'zone.smoke.preserved' }),
    ])
    expect(operations.map(entry => resultFor(result, entry.id).details)).toEqual([
      expect.objectContaining({ affectedZoneIds: [sunny.id] }),
      expect.objectContaining({ affectedZoneIds: ['zone.hazard.defog'] }),
      expect.objectContaining({ affectedZoneIds: ['zone.blessing.defog'] }),
      expect.objectContaining({ affectedZoneIds: ['zone.coat.defog'] }),
    ])
  })

  it('proves Rapid Spin destroys only Hazards in its authoritative radius cell set', () => {
    const near = hazard({
      id: 'zone.hazard.rapid-near',
      sideId: 'blue',
      cell: { x: 2, y: 0, z: 2 },
    })
    const far = hazard({
      id: 'zone.hazard.rapid-far',
      sideId: 'blue',
      cell: { x: 8, y: 0, z: 8 },
    })
    const cleanup = operation({
      id: 'operation.rapid-spin-cleanup',
      mutation: {
        kind: 'destroy',
        target: allZones(['hazard'], {
          geometry: selectionGeometry('cells.rapid-spin-radius', 2),
        }),
      },
    })

    const result = run({
      map: mapFixture([near, far]),
      operations: [cleanup],
      cellSets: new Map([['cells.rapid-spin-radius', [
        { x: 2, y: 0, z: 2 },
        { x: 3, y: 0, z: 2 },
      ]]]),
    })

    expect(result.nextMap.encounterState?.zones.map(zone => zone.id))
      .toEqual(['zone.hazard.rapid-far'])
    expect(resultFor(result, cleanup.id).details).toMatchObject({
      mutationKind: 'destroy',
      primaryZoneIds: ['zone.hazard.rapid-near'],
      affectedZoneIds: ['zone.hazard.rapid-near'],
    })
    expect(traceResultFor(result, cleanup.id)).toMatchObject({
      outcome: 'applied',
      result: {
        status: 'applied',
        details: { affectedZoneIds: ['zone.hazard.rapid-near'] },
      },
    })
  })

  it('proves Whirlwind destroys only Smoke and Hazards intersecting its server Line', () => {
    const inLineHazard = hazard({
      id: 'zone.hazard.whirlwind',
      sideId: 'blue',
      cell: { x: 3, y: 0, z: 2 },
    })
    const inLineSmoke = smoke('zone.smoke.whirlwind', { x: 4, y: 0, z: 2 })
    const outOfLineSmoke = smoke('zone.smoke.outside', { x: 4, y: 0, z: 5 })
    const cleanup = operation({
      id: 'operation.whirlwind-cleanup',
      mutation: {
        kind: 'destroy',
        target: allZones(['hazard', 'smoke'], {
          geometry: {
            kind: 'line',
            length: 4,
            count: { kind: 'exact', count: 4 },
            adjacency: 'orthogonal',
            connectedness: 'connected',
          },
        }),
      },
    })

    const result = run({
      map: mapFixture([inLineHazard, inLineSmoke, outOfLineSmoke]),
      operations: [cleanup],
    })

    expect(result.nextMap.encounterState?.zones.map(zone => zone.id))
      .toEqual(['zone.smoke.outside'])
    expect(resultFor(result, cleanup.id).details).toMatchObject({
      affectedZoneIds: ['zone.hazard.whirlwind', 'zone.smoke.whirlwind'],
    })
  })

  it('proves Steel Roller clears path-adjacent Hazards and consumes local and active global Terrain', () => {
    const grassy = globalField({
      kind: 'terrain',
      fieldId: 'grassy',
      operationId: 'operation.seed-grassy',
    })
    const zones = [
      hazard({ id: 'zone.hazard.roller-near', sideId: 'blue', cell: { x: 3, y: 0, z: 3 } }),
      hazard({ id: 'zone.hazard.roller-far', sideId: 'blue', cell: { x: 8, y: 0, z: 8 } }),
      localTerrain('zone.terrain.roller-near', { x: 4, y: 0, z: 2 }),
      localTerrain('zone.terrain.roller-far', { x: 8, y: 0, z: 7 }),
      grassy,
    ]
    const area = selectionGeometry('cells.steel-roller-path-and-adjacent', 4)
    const operations = [
      operation({
        id: 'operation.steel-roller-hazards',
        mutation: {
          kind: 'destroy',
          target: allZones(['hazard'], { geometry: area }),
        },
      }),
      operation({
        id: 'operation.steel-roller-terrain',
        mutation: { kind: 'consume-terrain', geometry: area, includeGlobal: true },
      }),
    ]
    const cells = [
      { x: 2, y: 0, z: 2 },
      { x: 3, y: 0, z: 2 },
      { x: 3, y: 0, z: 3 },
      { x: 4, y: 0, z: 2 },
    ]

    const result = run({
      map: mapFixture(zones, {
        weather: [],
        terrains: [{ kind: 'grassy', scope: 'field', rounds: 5 }],
        rooms: [],
      }),
      operations,
      cellSets: new Map([['cells.steel-roller-path-and-adjacent', cells]]),
    })

    expect(result.nextMap.fieldEffects?.terrains).toEqual([])
    expect(result.nextMap.encounterState?.zones.map(zone => zone.id)).toEqual([
      'zone.hazard.roller-far',
      'zone.terrain.roller-far',
    ])
    expect(resultFor(result, 'operation.steel-roller-hazards').details).toMatchObject({
      affectedZoneIds: ['zone.hazard.roller-near'],
    })
    expect(resultFor(result, 'operation.steel-roller-terrain').details).toMatchObject({
      mutationKind: 'consume-terrain',
      primaryZoneIds: ['zone.terrain.roller-near', grassy.id],
      affectedZoneIds: ['zone.terrain.roller-near', grassy.id],
      includeGlobal: true,
      areaCellCount: 4,
    })
  })

  it('clears and transfers one explicit side and filters removals by authoritative source', () => {
    const actorHazard = hazard({
      id: 'zone.hazard.actor-source',
      sideId: 'red',
      cell: { x: 2, y: 0, z: 2 },
      sourcePlacementId: actorPlacementId,
    })
    const targetHazard = hazard({
      id: 'zone.hazard.target-source',
      sideId: 'red',
      cell: { x: 3, y: 0, z: 2 },
      sourcePlacementId: targetPlacementId,
    })
    const transferable = sideCondition({
      id: 'zone.blessing.transfer',
      sideId: 'red',
      tag: 'blessing',
    })
    const operations = [
      operation({
        id: 'operation.remove-actor-source',
        mutation: {
          kind: 'remove',
          target: allZones(['hazard'], { source: 'actor' }),
        },
      }),
      operation({
        id: 'operation.transfer-red-blessing',
        mutation: {
          kind: 'transfer-side',
          target: allZones(['side-condition'], {
            side: 'source-side',
            requiredTags: ['blessing'],
          }),
          destinationSide: 'other-side',
        },
      }),
      operation({
        id: 'operation.clear-red-hazards',
        mutation: {
          kind: 'clear-side',
          target: allZones(['hazard'], { side: 'source-side' }),
        },
      }),
    ]

    const result = run({ map: mapFixture([actorHazard, targetHazard, transferable]), operations })

    expect(result.nextMap.encounterState?.zones).toEqual([
      expect.objectContaining({
        id: 'zone.blessing.transfer',
        sideId: 'blue',
        geometry: { kind: 'side', sideId: 'blue' },
      }),
    ])
    expect(resultFor(result, 'operation.remove-actor-source').details).toMatchObject({
      affectedZoneIds: ['zone.hazard.actor-source'],
    })
    expect(resultFor(result, 'operation.transfer-red-blessing').details).toMatchObject({
      affectedZoneIds: ['zone.blessing.transfer'],
    })
    expect(resultFor(result, 'operation.clear-red-hazards').details).toMatchObject({
      affectedZoneIds: ['zone.hazard.target-source'],
    })
  })

  it('fails closed for ambiguous side authority and missing suppression sources', () => {
    const zone = sideCondition({
      id: 'zone.blessing.ambiguous',
      sideId: 'red',
      tag: 'blessing',
    })
    const ambiguous = mapFixture([zone])
    ambiguous.encounterState = {
      ...ambiguous.encounterState!,
      sides: {
        ...ambiguous.encounterState!.sides,
        green: { id: 'green', label: 'Green', status: 'active' },
      },
    }
    const before = structuredClone(ambiguous)
    const swap = operation({
      id: 'operation.ambiguous-swap',
      mutation: {
        kind: 'swap-sides',
        counterpartSide: 'other-side',
        zoneKinds: ['side-condition'],
        requiredTags: [],
      },
    })

    expect(() => run({ map: ambiguous, operations: [swap] })).toThrowError(
      expect.objectContaining({
        name: MoveMapOperationReductionError.name,
        code: 'field-zone-invalid',
      }),
    )
    expect(ambiguous).toEqual(before)

    const sunny = globalField({
      kind: 'weather',
      fieldId: 'sunny',
      operationId: 'operation.seed-missing-source',
    })
    const suppress = operation({
      id: 'operation.missing-suppression-source',
      mutation: {
        kind: 'suppress',
        target: allZones(['weather']),
        sourceZoneId: 'zone.missing',
      },
    })
    expect(() => run({ map: mapFixture([sunny]), operations: [suppress] })).toThrowError(
      expect.objectContaining({ code: 'field-zone-invalid' }),
    )
  })

  it('retains suppressed fields and reactivates them when their exact source is destroyed', () => {
    const sunny = globalField({
      kind: 'weather',
      fieldId: 'sunny',
      operationId: 'operation.seed-sunny-suppression',
    })
    const suppressor = smoke('zone.smoke.suppressor', { x: 2, y: 0, z: 2 })
    const suppress = operation({
      id: 'operation.suppress-sun',
      mutation: {
        kind: 'suppress',
        target: allZones(['weather']),
        sourceZoneId: suppressor.id,
      },
    })

    const suppressed = run({ map: mapFixture([sunny, suppressor]), operations: [suppress] })
    const suppressedSun = zoneById(suppressed, sunny.id)
    expect(suppressedSun).toMatchObject({
      fieldPolicy: {
        suppression: {
          sources: [{
            zoneId: suppressor.id,
            reasonCode: suppress.reasonCode,
          }],
        },
      },
    })
    expect(projectBattlefieldZones(suppressed.nextMap).activeZones.map(zone => zone.id))
      .toEqual([suppressor.id])

    const destroySource = operation({
      id: 'operation.destroy-suppressor',
      mutation: {
        kind: 'destroy',
        target: allZones(['smoke'], { requiredTags: ['obscuration'] }),
      },
    })
    const reactivated = run({ map: suppressed.nextMap, operations: [destroySource] })

    expect(zoneById(reactivated, sunny.id)).toMatchObject({
      fieldPolicy: { suppression: { sources: [] } },
    })
    expect(projectBattlefieldZones(reactivated.nextMap).activeZones.map(zone => zone.id))
      .toEqual([sunny.id])
    expect(resultFor(reactivated, destroySource.id).details).toMatchObject({
      primaryZoneIds: [suppressor.id],
      suppressionClearedZoneIds: [sunny.id],
      affectedZoneIds: [suppressor.id, sunny.id],
    })
  })
})
