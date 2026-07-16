import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterZone, type EncounterZone } from '#shared/moveAutomation/encounterZones'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  DEFAULT_BATTLEFIELD_ZONE_ENTRY_DEFINITIONS,
  canonicalBattlefieldZoneComponents,
  createBattlefieldZoneEntryDefinitionRegistry,
  type BattlefieldZoneEntryHandlerDefinition,
} from '~~/server/domain/moveAutomation/battlefieldZoneDefinitions'
import { materializeBattlefieldZoneEntryLifecycle } from '~~/server/domain/moveAutomation/battlefieldZoneEntry'
import { planBattlefieldZoneMovement } from '~~/server/domain/moveAutomation/planBattlefieldZoneMovement'
import {
  resolveMovement,
  type AuthoritativeMovementSuccess,
} from '~~/server/domain/movement/resolveMovement'

const placement = (
  sideId: 'red' | 'blue' | undefined = 'blue',
): SheetPlacement => ({
  id: 'mover',
  sheetKind: 'pokemon',
  sheetSlug: 'mover',
  ...(sideId ? { sideId } : {}),
  position: { x: 0, y: 0, z: 0 },
})

const sheet = (
  types: readonly string[] = ['Normal'],
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug: 'mover',
  nickname: 'Mover',
  species: 'Pikachu',
  level: 20,
  revision: 3,
  types: [...types],
  capabilities: { overland: 12 },
  combat: { currentHp: 60, conditions: [] },
  ...overrides,
})

const sheets = (value = sheet()) => ({
  pokemon: new Map([['mover', value]]),
  trainer: new Map<string, TrainerSheet>(),
})

const zoneComponents = (
  kind: 'hazard' | 'pledge',
  effectId: string,
) => canonicalBattlefieldZoneComponents({ kind, effectId })

const zone = (options: {
  readonly effectId?: string
  readonly kind?: 'hazard' | 'pledge'
  readonly layer?: number
  readonly cells?: readonly { readonly x: number; readonly y: number; readonly z: number }[]
  readonly hooks?: EncounterZone['hooks']
  readonly modifiers?: EncounterZone['modifiers']
  readonly sideId?: 'red' | 'blue' | null
} = {}): EncounterZone => {
  const kind = options.kind ?? 'hazard'
  const effectId = options.effectId ?? 'spikes'
  const components = zoneComponents(kind, effectId)
  return parseEncounterZone({
    id: `zone.${kind}.${effectId}`,
    kind,
    source: {
      kind: 'operation',
      operationId: `operation.${effectId}`,
      moveId: `move.${effectId}`,
      placementId: 'source',
    },
    sideId: options.sideId === undefined ? 'red' : options.sideId,
    geometry: {
      kind: 'cells',
      cells: options.cells ?? [{ x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
    },
    layer: options.layer ?? 1,
    duration: { kind: 'scene', remaining: null },
    stacking: (options.layer ?? 1) > 1
      ? { kind: 'add-layer', maxLayers: 2 }
      : { kind: 'refresh', maxLayers: null },
    hooks: options.hooks ?? components.hooks,
    modifiers: options.modifiers ?? components.modifiers,
    tags: ['test-zone'],
    payload: kind === 'hazard'
      ? {
          hazardId: effectId,
          familyId: `hazard.${effectId}`,
          charges: null,
          maxCharges: null,
        }
      : {
          pledgeId: effectId,
          familyId: `pledge.${effectId}`,
          charges: null,
          maxCharges: null,
        },
  })
}

const mapFixture = (options: {
  readonly zones?: readonly EncounterZone[]
  readonly mover?: SheetPlacement
} = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'zone-entry-arena',
  name: 'Zone Entry Arena',
  revision: 9,
  dimensions: { x: 5, y: 2, z: 1 },
  groundLevelY: 0,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [options.mover ?? placement()],
  activeScene: { name: 'Hazard Test', startedAt: 1 },
  initiative: { activeId: 'mover', round: 2 },
  encounterState: {
    ...createEmptyEncounterState(),
    sides: {
      red: { id: 'red', label: 'Red', status: 'active' },
      blue: { id: 'blue', label: 'Blue', status: 'active' },
    },
    zones: [...(options.zones ?? [zone()])],
  },
})

const movement = (
  map = mapFixture(),
  sheetValue = sheet(),
): AuthoritativeMovementSuccess => {
  const result = resolveMovement({
    map,
    sheets: sheets(sheetValue),
    placementId: 'mover',
    mode: 'shift',
    destination: { x: 3, y: 0, z: 0 },
  })
  if (!result.ok) throw new Error(`Expected legal movement: ${result.reasonCode} ${result.message}`)
  return result
}

const lifecycleInput = (
  resolved: AuthoritativeMovementSuccess,
) => ({
  movement: resolved,
  movementId: 'movement.zone-entry.test',
  sourceOperationId: 'operation.zone-entry.test',
  mode: 'voluntary' as const,
})

const plan = (options: {
  readonly map?: TabletopMap
  readonly sheet?: CharacterSheet
  readonly registry?: ReturnType<typeof createBattlefieldZoneEntryDefinitionRegistry>
} = {}) => {
  const map = options.map ?? mapFixture()
  const sheetValue = options.sheet ?? sheet()
  const resolvedSheets = sheets(sheetValue)
  return planBattlefieldZoneMovement({
    map,
    pokemonSheets: resolvedSheets.pokemon,
    trainerSheets: resolvedSheets.trainer,
    movement: lifecycleInput(movement(map, sheetValue)),
    time: 5_000,
    ...(options.registry ? { registry: options.registry } : {}),
  })
}

const customDefinition = (
  overrides: Partial<BattlefieldZoneEntryHandlerDefinition> = {},
): BattlefieldZoneEntryHandlerDefinition => ({
  handlerId: 'zone.hazard.test-entry.entry',
  targetPolicy: 'enemy',
  grounding: 'grounded',
  immuneTypeIds: [],
  absorbingTypeIds: [],
  removeOnAbsorb: false,
  removeOnTrigger: false,
  effects: [{
    minimumLayer: 1,
    maximumLayer: null,
    kind: 'direct-hp',
    amount: { kind: 'fixed', value: 7 },
    reasonCode: 'zone.hazard.test-entry.hp',
  }],
  ...overrides,
})

describe('battlefield zone movement entry effects', () => {
  it('charges authoritative Slow Terrain and plans one Spikes trigger per movement', () => {
    const map = mapFixture()
    const resolved = movement(map)

    expect(resolved.cost).toBe(5)
    expect(resolved.triggeringSteps.map(step => step.slowCostApplied)).toEqual([
      true,
      true,
      false,
    ])

    const result = plan({ map })
    expect(result.lifecycle.status).toBe('completed')
    expect(result.decisions.map(item => item.outcome)).toEqual([
      'triggered',
      'guarded-once-per-movement',
    ])
    expect(result.operations.map(operation => operation.kind)).toEqual([
      'direct-hp',
      'condition',
    ])
    expect(result.coreOperationResults).toMatchObject([
      {
        operationKind: 'direct-hp',
        outcome: 'applied',
        recipients: [{
          recipientId: 'mover',
          outcome: 'applied',
          previous: { kind: 'hp' },
        }],
      },
      {
        operationKind: 'condition',
        outcome: 'applied',
        recipients: [{
          recipientId: 'mover',
          changedFields: ['encounterEffects'],
        }],
      },
    ])
    const hpResult = result.coreOperationResults[0]?.recipients[0]
    expect(hpResult?.previous.kind).toBe('hp')
    expect(hpResult?.current.kind).toBe('hp')
    if (hpResult?.previous.kind !== 'hp' || hpResult.current.kind !== 'hp') {
      throw new Error('expected HP result')
    }
    expect(hpResult.previous.currentHp - hpResult.current.currentHp)
      .toBe(Math.floor(hpResult.previous.fullMaxHp * 0.1))
    expect(result.currentEncounterState.effects).toMatchObject([{
      kind: 'condition',
      affected: { placementIds: ['mover'] },
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
      payload: { conditionId: 'slowed', action: 'apply' },
    }])
    expect(result.stateChanges.changes.map(change => change.kind)).toEqual([
      'sheet-state',
      'encounter-state',
    ])
    expect(result.previousEncounterState.zones).toHaveLength(1)
    expect(result.currentEncounterState.zones).toHaveLength(1)
  })

  it('fails enemy mechanics closed for source-side, unknown-side, and airborne movers', () => {
    const resolved = movement(mapFixture())
    const cases = [
      {
        sideId: 'red' as const,
        grounding: 'grounded' as const,
        outcome: 'source-immune',
      },
      {
        sideId: null,
        grounding: 'grounded' as const,
        outcome: 'relationship-unknown',
      },
      {
        sideId: 'blue' as const,
        grounding: 'airborne' as const,
        outcome: 'not-grounded',
      },
    ]

    for (const testCase of cases) {
      const result = materializeBattlefieldZoneEntryLifecycle({
        map: mapFixture(),
        movement: lifecycleInput(resolved),
        subject: {
          placementId: 'mover',
          sideId: testCase.sideId,
          grounding: testCase.grounding,
          typeIds: ['normal'],
        },
      })
      expect(result.decisions.map(item => item.outcome)).toEqual([
        testCase.outcome,
        testCase.outcome,
      ])
      expect(result.decisions.every(item => item.operationIds.length === 0)).toBe(true)
    }

    const alliedMap = mapFixture({ mover: placement('red') })
    expect(movement(alliedMap).cost).toBe(3)
  })

  it('applies Toxic Spikes layers and preserves independent immunity outcomes', () => {
    const layerOne = plan({
      map: mapFixture({ zones: [zone({ effectId: 'toxic-spikes', cells: [{ x: 1, y: 0, z: 0 }] })] }),
      sheet: sheet(['Normal']),
    })
    expect(layerOne.operations.filter(operation => operation.kind === 'condition'))
      .toHaveLength(2)
    expect(layerOne.coreOperationResults.map(result => result.outcome)).toEqual([
      'applied',
      'applied',
    ])
    expect(layerOne.nextMap.encounterState?.effects).toMatchObject([{
      payload: { conditionId: 'slowed' },
    }])
    const conditionSheet = layerOne.stateChanges.changes.find(change => (
      change.kind === 'sheet-state'
    ))
    expect(conditionSheet).toMatchObject({
      kind: 'sheet-state',
      current: { combat: { conditions: ['Poisoned'] } },
    })

    const layerTwoMap = mapFixture({
      zones: [zone({
        effectId: 'toxic-spikes',
        layer: 2,
        cells: [{ x: 1, y: 0, z: 0 }],
      })],
    })
    const layerTwo = plan({ map: layerTwoMap, sheet: sheet(['Steel']) })
    expect(layerTwo.operations.filter(operation => operation.kind === 'condition').map(operation => (
      operation.kind === 'condition' ? operation.payload.conditionId : null
    ))).toEqual(['badly-poisoned', 'slowed'])
    expect(layerTwo.coreOperationResults).toMatchObject([
      {
        outcome: 'prevented',
        recipients: [{ outcome: 'prevented', reasonCode: 'condition-immunity' }],
      },
      {
        outcome: 'applied',
        recipients: [{ outcome: 'applied' }],
      },
    ])
    expect(layerTwo.stateChanges.changes.every(change => change.kind !== 'sheet-state')).toBe(true)
    expect(layerTwo.currentEncounterState.effects).toMatchObject([{
      payload: { conditionId: 'slowed' },
    }])
  })

  it('lets grounded Poison and Bug movers absorb their matching hazards exactly once', () => {
    for (const [effectId, typeId] of [
      ['toxic-spikes', 'Poison'],
      ['sticky-web', 'Bug'],
    ] as const) {
      const hazard = zone({ effectId })
      const map = mapFixture({ zones: [hazard] })
      const result = plan({ map, sheet: sheet([typeId]) })

      expect(result.decisions.map(item => item.outcome)).toEqual([
        'absorbed',
        'zone-already-removed',
      ])
      expect(result.operations.map(operation => operation.kind)).toEqual(['hazard'])
      expect(result.coreOperationResults).toEqual([])
      expect(result.hazardOperationResults).toMatchObject([{
        outcome: 'applied',
        details: { action: 'remove', removedCount: 1 },
      }])
      expect(result.currentEncounterState.zones).toEqual([])
      expect(result.stateChanges.changes).toMatchObject([{
        kind: 'encounter-state',
        previous: { zones: [expect.objectContaining({ id: hazard.id })] },
        current: { zones: [] },
      }])
      expect(movement(map, sheet([typeId])).cost).toBe(3)
    }
  })

  it('lowers Speed and applies timed Slowed for Sticky Web', () => {
    const map = mapFixture({
      zones: [zone({ effectId: 'sticky-web', cells: [{ x: 1, y: 0, z: 0 }] })],
    })
    const result = plan({ map })

    expect(result.operations.map(operation => operation.kind)).toEqual([
      'combat-stage',
      'condition',
    ])
    expect(result.coreOperationResults).toMatchObject([
      {
        operationKind: 'combat-stage',
        recipients: [{
          current: { kind: 'combat-stages', stages: { spd: -1 } },
        }],
      },
      {
        operationKind: 'condition',
        recipients: [{ changedFields: ['encounterEffects'] }],
      },
    ])
  })

  it('supports bounded fixed HP handlers and obeys each hook once policy deterministically', () => {
    const definitions = [
      ...DEFAULT_BATTLEFIELD_ZONE_ENTRY_DEFINITIONS,
      customDefinition(),
    ]
    const registry = createBattlefieldZoneEntryDefinitionRegistry(definitions)
    const customZone = zone({
      effectId: 'test-entry',
      hooks: {
        entry: [{
          id: 'zone.hazard.test-entry.entry',
          handlerId: 'zone.hazard.test-entry.entry',
          oncePerMovement: false,
        }],
        exit: [],
      },
      modifiers: { targeting: [], damage: [], movement: [] },
    })
    const map = mapFixture({ zones: [customZone] })
    const resolved = movement(map)
    const input = {
      map,
      movement: lifecycleInput(resolved),
      subject: {
        placementId: 'mover',
        sideId: 'blue' as const,
        grounding: 'grounded' as const,
        typeIds: ['normal'],
      },
      registry,
    }
    const first = materializeBattlefieldZoneEntryLifecycle(input)
    const replay = materializeBattlefieldZoneEntryLifecycle(input)

    expect(first.decisions.map(item => item.outcome)).toEqual(['triggered', 'triggered'])
    expect(first.decisions.flatMap(item => item.operationIds)).toHaveLength(2)
    expect(replay.decisions).toEqual(first.decisions)
    expect(replay.events).toEqual(first.events)

    const fixedPlan = plan({ map, registry })
    expect(fixedPlan.coreOperationResults).toHaveLength(2)
    const firstHp = fixedPlan.coreOperationResults[0]?.recipients[0]
    const secondHp = fixedPlan.coreOperationResults[1]?.recipients[0]
    if (
      firstHp?.previous.kind !== 'hp'
      || firstHp.current.kind !== 'hp'
      || secondHp?.previous.kind !== 'hp'
      || secondHp.current.kind !== 'hp'
    ) throw new Error('expected fixed HP entry results')
    expect(firstHp.previous.currentHp - firstHp.current.currentHp).toBe(7)
    expect(secondHp.previous.currentHp - secondHp.current.currentHp).toBe(7)

    const onceZone = parseEncounterZone({
      ...customZone,
      hooks: {
        entry: [{
          id: 'zone.hazard.test-entry.entry',
          handlerId: 'zone.hazard.test-entry.entry',
          oncePerMovement: true,
        }],
        exit: [],
      },
    })
    const onceMap = mapFixture({ zones: [onceZone] })
    const once = materializeBattlefieldZoneEntryLifecycle({
      ...input,
      map: onceMap,
      movement: lifecycleInput(movement(onceMap)),
    })
    expect(once.decisions.map(item => item.outcome)).toEqual([
      'triggered',
      'guarded-once-per-movement',
    ])
    expect(once.decisions.flatMap(item => item.operationIds)).toHaveLength(1)
  })

  it('rejects malformed registries, unknown handlers, and mismatched movement subjects', () => {
    expect(() => createBattlefieldZoneEntryDefinitionRegistry([
      customDefinition(),
      customDefinition(),
    ])).toThrow('is duplicated')
    expect(() => createBattlefieldZoneEntryDefinitionRegistry([
      customDefinition({
        effects: [{
          minimumLayer: 1,
          maximumLayer: null,
          kind: 'direct-hp',
          amount: { kind: 'fixed', value: -1 },
          reasonCode: 'zone.hazard.test-entry.hp',
        }],
      }),
    ])).toThrow('invalid fixed HP amount')

    const unknownZone = zone({
      effectId: 'unknown-entry',
      hooks: {
        entry: [{
          id: 'zone.hazard.unknown-entry.entry',
          handlerId: 'zone.hazard.unknown-entry.entry',
          oncePerMovement: true,
        }],
        exit: [],
      },
      modifiers: { targeting: [], damage: [], movement: [] },
    })
    const map = mapFixture({ zones: [unknownZone] })
    const resolved = movement(map)
    const common = {
      map,
      movement: lifecycleInput(resolved),
      subject: {
        placementId: 'mover',
        sideId: 'blue' as const,
        grounding: 'grounded' as const,
        typeIds: ['normal'],
      },
    }
    expect(() => materializeBattlefieldZoneEntryLifecycle(common))
      .toThrow('references unregistered handler')
    expect(() => materializeBattlefieldZoneEntryLifecycle({
      ...common,
      subject: { ...common.subject, placementId: 'forged-mover' },
    })).toThrow('subject must match the path')
  })
})
