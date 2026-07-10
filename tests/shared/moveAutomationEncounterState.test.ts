import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_EFFECT_LIMITS,
  ENCOUNTER_HISTORY_LIMITS,
  ENCOUNTER_RESOURCE_LIMITS,
  ENCOUNTER_SIDE_LIMITS,
  ENCOUNTER_STATE_LIMITS,
  ENCOUNTER_STATE_SCHEMA_VERSION,
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
  zones: [],
  pendingResolutionSummaries: [],
})

describe('move automation encounter state', () => {
  it('creates the bounded canonical empty envelope', () => {
    const state = createEmptyEncounterState()

    expect(state).toEqual(canonicalEncounterState())
    expect(ENCOUNTER_STATE_LIMITS).toEqual({
      sides: 32,
      effects: ENCOUNTER_EFFECT_LIMITS.count,
      counters: 0,
      history: ENCOUNTER_HISTORY_LIMITS.moveAncestryPerScene,
      turnResources: ENCOUNTER_RESOURCE_LIMITS.placementLedgers,
      zones: 0,
      pendingResolutionSummaries: 0,
    })
    expect(JSON.stringify(state)).toBe(
      '{"schemaVersion":1,"sides":{},"effects":[],"counters":{},"history":{"sceneId":null,"currentRound":null,"currentTurn":null,"lastDeclaredMoves":[],"lastCompletedMoves":[],"lastDamagingMovesReceived":[],"damageBySourceThisTurn":[],"damageBySourceThisRound":[],"actedThisTurnPlacementIds":[],"actedThisRoundPlacementIds":[],"consecutiveMoves":[],"switchedPlacementIds":[],"faintedPlacementIds":[],"switches":[],"knockouts":[],"moveAncestry":[],"eventMoveLinks":[]},"turnResources":{},"zones":[],"pendingResolutionSummaries":[]}',
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

    const another = createEmptyEncounterState()
    expect(another.effects).not.toBe(state.effects)
    expect(another.turnResources).not.toBe(state.turnResources)
    expect(another.history).not.toBe(state.history)
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
