import { describe, expect, it } from 'vitest'
import { createEmptyCapabilityRuntimeState } from '#shared/capabilityAutomation/state'
import {
  ENCOUNTER_EFFECT_LIMITS,
  ENCOUNTER_HISTORY_LIMITS,
  ENCOUNTER_RESOURCE_LIMITS,
  MAP_GROUND_ITEM_LIMITS,
  ENCOUNTER_SIDE_LIMITS,
  ENCOUNTER_STATE_LIMITS,
  ENCOUNTER_STATE_SCHEMA_VERSION,
  ENCOUNTER_ZONE_LIMITS,
  EncounterStateValidationError,
  createEmptyEncounterHistory,
  createEmptyEncounterState,
  encounterStateHasSide,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import { numericEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const canonicalEncounterState = () => ({
  schemaVersion: ENCOUNTER_STATE_SCHEMA_VERSION,
  sides: {},
  effects: [],
  counters: {},
  history: createEmptyEncounterHistory(),
  turnResources: {},
  abilityUsage: {
    schemaVersion: 1,
    sceneId: null,
    entries: [],
  },
  abilityTiming: {
    schemaVersion: 1,
    sceneId: null,
    round: { windowId: null, sequence: null, uses: [] },
    turn: { windowId: null, sequence: null, uses: [] },
    cooldowns: [],
    receipts: [],
  },
  abilityEffectLifecycle: {
    schemaVersion: 1,
    entries: [],
  },
  abilityOwnedState: {
    schemaVersion: 1,
    entries: [],
    receipts: [],
  },
  abilityEventReceipts: {
    schemaVersion: 1,
    entries: [],
  },
  equipmentProviderReceipts: {
    schemaVersion: 1,
    entries: [],
  },
  abilityReactionAvailability: {
    schemaVersion: 1,
    sceneId: null,
    roundId: null,
    roundSequence: null,
    entries: [],
    receipts: [],
  },
  abilityEntities: {
    schemaVersion: 1,
    entries: [],
    receipts: [],
  },
  abilityTransformations: {
    schemaVersion: 1,
    entries: [],
    receipts: [],
  },
  capabilityRuntime: createEmptyCapabilityRuntimeState(),
  zones: [],
  groundItems: [],
  pendingResolutionSummaries: [],
})

const sideConditionZone = (sideId = 'allies') => ({
  id: 'zone.side.reflect',
  kind: 'side-condition',
  source: {
    kind: 'operation',
    operationId: 'op.reflect',
    moveId: 'reflect',
    placementId: 'actor-token',
  },
  sideId,
  geometry: { kind: 'side', sideId },
  layer: 1,
  duration: { kind: 'rounds', boundary: 'end', remaining: 5 },
  stacking: { kind: 'refresh', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: {
    targeting: [],
    damage: [{
      id: 'reflect.reduction',
      attribute: 'damage-reduction',
      operation: 'multiply',
      value: 0.5,
      reasonCode: 'zone.reflect.reduction',
    }],
    movement: [],
  },
  tags: ['barrier', 'side-condition'],
  payload: { conditionId: 'reflect' },
})

describe('move automation encounter state', () => {
  it('creates the bounded canonical empty envelope', () => {
    const state = createEmptyEncounterState()

    expect(state).toEqual(canonicalEncounterState())
    expect(ENCOUNTER_STATE_LIMITS).toEqual({
      sides: 32,
      effects: ENCOUNTER_EFFECT_LIMITS.count,
      counters: 0,
      history: ENCOUNTER_HISTORY_LIMITS.moveUsesPerScene,
      turnResources: ENCOUNTER_RESOURCE_LIMITS.placementLedgers,
      zones: ENCOUNTER_ZONE_LIMITS.count,
      groundItems: MAP_GROUND_ITEM_LIMITS.count,
      pendingResolutionSummaries: 64,
      itemFormChanges: 128,
      itemExploration: 32,
    })
    expect(JSON.stringify(state)).toBe(
      '{"schemaVersion":1,"sides":{},"effects":[],"counters":{},"history":{"sceneId":null,"currentRound":null,"currentTurn":null,"lastDeclaredMoves":[],"lastCompletedMoves":[],"lastDamagingMovesReceived":[],"damageBySourceThisTurn":[],"damageBySourceThisRound":[],"actedThisTurnPlacementIds":[],"actedThisRoundPlacementIds":[],"consecutiveMoves":[],"switchedPlacementIds":[],"faintedPlacementIds":[],"switches":[],"knockouts":[],"moveAncestry":[],"moveUses":[],"eventMoveLinks":[]},"turnResources":{},"abilityUsage":{"schemaVersion":1,"sceneId":null,"entries":[]},"abilityTiming":{"schemaVersion":1,"sceneId":null,"round":{"windowId":null,"sequence":null,"uses":[]},"turn":{"windowId":null,"sequence":null,"uses":[]},"cooldowns":[],"receipts":[]},"abilityEffectLifecycle":{"schemaVersion":1,"entries":[]},"abilityOwnedState":{"schemaVersion":1,"entries":[],"receipts":[]},"abilityEventReceipts":{"schemaVersion":1,"entries":[]},"equipmentProviderReceipts":{"schemaVersion":1,"entries":[]},"abilityReactionAvailability":{"schemaVersion":1,"sceneId":null,"roundId":null,"roundSequence":null,"entries":[],"receipts":[]},"abilityEntities":{"schemaVersion":1,"entries":[],"receipts":[]},"abilityTransformations":{"schemaVersion":1,"entries":[],"receipts":[]},"capabilityRuntime":{"schemaVersion":1,"usages":{"schemaVersion":1,"entries":[]},"modes":[],"links":[],"tasks":[],"pendingAdjudications":[],"checkPenalties":[]},"zones":[],"groundItems":[],"pendingResolutionSummaries":[]}',
    )
    expect(parseEncounterState({ ...canonicalEncounterState(), history: {} }).history)
      .toEqual(createEmptyEncounterHistory())
  })

  it('round-trips typed sides and effects through JSON without sharing containers', () => {
    const effect = {
      ...numericEncounterEffectFixture(),
      affected: {
        placementIds: [],
        sideIds: ['allies'],
        cells: [],
      },
    }
    const state = {
      ...createEmptyEncounterState(),
      sides: {
        rivals: { id: 'rivals', label: 'Rivals', color: '#AA33CC', status: 'inactive' as const },
        allies: { id: 'allies', label: '  Allies  ', color: '#33AA44', status: 'active' as const },
      },
      effects: [effect],
    }
    const structured = structuredClone(state)
    const json = JSON.parse(JSON.stringify(state)) as unknown
    const parsed = parseEncounterState(json)

    expect(structured).toEqual(state)
    expect(parsed).toEqual({
      ...createEmptyEncounterState(),
      sides: {
        allies: { id: 'allies', label: 'Allies', color: '#33aa44', status: 'active' },
        rivals: { id: 'rivals', label: 'Rivals', color: '#aa33cc', status: 'inactive' },
      },
      effects: [effect],
    })
    expect(Object.keys(parsed.sides)).toEqual(['allies', 'rivals'])
    expect(encounterStateHasSide(parsed, 'allies')).toBe(true)
    expect(encounterStateHasSide(parsed, 'unknown')).toBe(false)
    expect(encounterStateHasSide(undefined, 'allies')).toBe(false)
    expect(parsed).not.toBe(json)
    expect(parsed.sides).not.toBe((json as { sides: unknown }).sides)
    expect(parsed.sides.allies).not.toBe((json as { sides: { allies: unknown } }).sides.allies)
    expect(parsed.effects).not.toBe((json as { effects: unknown }).effects)
    expect(parsed.effects[0]?.payload).not.toBe((json as { effects: { payload: unknown }[] }).effects[0]?.payload)
    expect(parsed.counters).not.toBe((json as { counters: unknown }).counters)
    expect(parsed.history).not.toBe((json as { history: unknown }).history)
    expect(parsed.history.lastDeclaredMoves)
      .not.toBe((json as { history: { lastDeclaredMoves: unknown } }).history.lastDeclaredMoves)
    expect(parsed.groundItems).not.toBe((json as { groundItems: unknown }).groundItems)

    const another = createEmptyEncounterState()
    expect(another.effects).not.toBe(state.effects)
    expect(another.turnResources).not.toBe(state.turnResources)
    expect(another.history).not.toBe(state.history)
    expect(another.groundItems).not.toBe(state.groundItems)
  })

  it('round-trips bounded ground items and validates optional side hints', () => {
    const item = {
      id: 'ground-item-1',
      canonicalItemId: 'iron-ball',
      canonicalItemName: 'Iron Ball',
      quantity: 1,
      position: { x: 2, y: 0, z: 3 },
      sourceResource: { kind: 'map' as const, slug: 'arena', revision: 4 },
      sourceOperationId: 'op_drop_item_0001',
      sideId: 'allies',
      ownerPlacementId: 'actor-token',
    }
    const source = {
      ...canonicalEncounterState(),
      sides: { allies: { id: 'allies', label: 'Allies', status: 'active' } },
      groundItems: [item],
    }
    const parsed = parseEncounterState(source)

    expect(parsed.groundItems).toEqual([item])
    expect(parsed.groundItems).not.toBe(source.groundItems)
    expect(parsed.groundItems[0]).not.toBe(item)
    expect(parsed.groundItems[0]?.position).not.toBe(item.position)
    expect(() => parseEncounterState({
      ...source,
      groundItems: [{ ...item, sideId: 'unknown-side' }],
    })).toThrow('encounterState.groundItems[0].sideId: references unknown encounter side unknown-side')
    expect(() => parseEncounterState({
      ...source,
      groundItems: [item, { ...item }],
    })).toThrow('duplicates map-ground item ground-item-1')
  })

  it('normalizes the preceding schema-v1 shape with no ground-item container', () => {
    const legacy = canonicalEncounterState() as Record<string, unknown>
    delete legacy.groundItems

    expect(parseEncounterState(legacy)).toEqual(canonicalEncounterState())
  })

  it('round-trips zones and validates every owning or affected side reference', () => {
    const source = {
      ...canonicalEncounterState(),
      sides: {
        allies: { id: 'allies', label: 'Allies', status: 'active' },
      },
      zones: [sideConditionZone()],
    }
    const parsed = parseEncounterState(source)

    expect(parsed.zones).toEqual(source.zones)
    expect(parsed.zones).not.toBe(source.zones)
    expect(parsed.zones[0]?.geometry).not.toBe(source.zones[0]?.geometry)
    expect(() => parseEncounterState({
      ...source,
      zones: [sideConditionZone('unknown-side')],
    })).toThrow('encounterState.zones[0].sideId: references unknown encounter side unknown-side')
    expect(() => parseEncounterState({
      ...source,
      zones: [{ ...sideConditionZone(), sideId: null, geometry: { kind: 'side', sideId: 'unknown-side' } }],
    })).toThrow('encounterState.zones[0].geometry.sideId: references unknown encounter side unknown-side')
  })

  it('round-trips bounded public pending summaries without private window data', () => {
    const summary = {
      schemaVersion: 1 as const,
      resolutionId: 'resolution-pending-1',
      actorPlacementId: 'actor-token',
      canonicalMoveId: 'Pending Test',
      phase: 'hit' as const,
      status: 'pending' as const,
      outstandingWindowCount: 1,
      createdAt: 1_000,
      updatedAt: 1_000,
    }
    const source = {
      ...canonicalEncounterState(),
      pendingResolutionSummaries: [summary],
    }
    const parsed = parseEncounterState(source)

    expect(parsed.pendingResolutionSummaries).toEqual([summary])
    expect(parsed.pendingResolutionSummaries).not.toBe(source.pendingResolutionSummaries)
    expect(parsed.pendingResolutionSummaries[0]).not.toBe(summary)
    expect(() => parseEncounterState({
      ...source,
      pendingResolutionSummaries: [summary, { ...summary }],
    })).toThrow('duplicates pending resolution resolution-pending-1')
    expect(() => parseEncounterState({
      ...source,
      pendingResolutionSummaries: [{ ...summary, optionIds: ['private-option'] }],
    })).toThrow('must contain exactly the supported fields')
  })

  it('rejects malformed side identities, records, presentation hints, and directory overflow', () => {
    expect(() => parseEncounterState({
      ...canonicalEncounterState(),
      sides: { 'Team A': { id: 'Team A', label: 'Team A', status: 'active' } },
    })).toThrow('directory keys must match /^[a-z0-9-]+$/')
    expect(() => parseEncounterState({
      ...canonicalEncounterState(),
      sides: { allies: { id: 'opponents', label: 'Allies', status: 'active' } },
    })).toThrow('must match directory key allies')
    expect(() => parseEncounterState({
      ...canonicalEncounterState(),
      sides: { allies: { id: 'allies', label: 'Allies', status: 'archived' } },
    })).toThrow('encounterState.sides.allies.status: must be active or inactive')
    expect(() => parseEncounterState({
      ...canonicalEncounterState(),
      sides: { allies: { id: 'allies', label: 'Allies', color: 'green', status: 'active' } },
    })).toThrow('encounterState.sides.allies.color: must be a six-digit #rrggbb color')
    expect(() => parseEncounterState({
      ...canonicalEncounterState(),
      sides: { allies: { id: 'allies', label: 'Allies', status: 'active', mechanics: {} } },
    })).toThrow('unknown mechanics')

    const oversizedSides = Object.fromEntries(Array.from(
      { length: ENCOUNTER_SIDE_LIMITS.count + 1 },
      (_, index) => {
        const id = `side-${index}`
        return [id, { id, label: `Side ${index}`, status: 'active' }]
      },
    ))
    expect(() => parseEncounterState({ ...canonicalEncounterState(), sides: oversizedSides }))
      .toThrow(`encounterState.sides: must contain at most ${ENCOUNTER_SIDE_LIMITS.count} entries`)
  })

  it('rejects unsupported versions, malformed envelopes, effects, and reserved containers', () => {
    const futureVersion = { ...canonicalEncounterState(), schemaVersion: 2 }
    expect(() => parseEncounterState(futureVersion)).toThrowError(EncounterStateValidationError)
    try {
      parseEncounterState(futureVersion)
    } catch (error) {
      expect(error).toMatchObject({
        code: 'unsupported-schema-version',
        path: 'encounterState.schemaVersion',
      })
    }

    expect(() => parseEncounterState({ ...canonicalEncounterState(), extra: true }))
      .toThrow('must contain exactly the supported fields')
    expect(() => parseEncounterState({ ...canonicalEncounterState(), zones: {} }))
      .toThrow('encounterState.zones: must be an array')
    expect(() => parseEncounterState({ ...canonicalEncounterState(), sides: [] }))
      .toThrow('encounterState.sides: must be a plain object directory')
    expect(() => parseEncounterState({ ...canonicalEncounterState(), counters: [] }))
      .toThrow('encounterState.counters: must be a plain object directory')
    expect(() => parseEncounterState({ ...canonicalEncounterState(), effects: [{}] }))
      .toThrow('encounterState.effects[0]: must contain exactly the supported fields')
    expect(() => parseEncounterState({
      ...canonicalEncounterState(),
      effects: [{
        ...numericEncounterEffectFixture(),
        affected: { placementIds: [], sideIds: ['unknown-side'], cells: [] },
      }],
    })).toThrow('references unknown encounter side unknown-side')
    expect(() => parseEncounterState({ ...canonicalEncounterState(), history: { currentRound: 1 } }))
      .toThrow('encounterState.history: must contain exactly the supported fields')
    expect(() => parseEncounterState({ ...canonicalEncounterState(), turnResources: { actor: {} } }))
      .toThrow('encounterState.turnResources.actor: must contain exactly the supported fields')
  })
})
