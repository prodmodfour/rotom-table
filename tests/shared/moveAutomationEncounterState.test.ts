import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_STATE_LIMITS,
  ENCOUNTER_STATE_SCHEMA_VERSION,
  EncounterStateValidationError,
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'

const canonicalEncounterState = () => ({
  schemaVersion: ENCOUNTER_STATE_SCHEMA_VERSION,
  sides: {},
  effects: [],
  counters: {},
  history: {},
  turnResources: {},
  zones: [],
  pendingResolutionSummaries: [],
})

describe('move automation encounter state', () => {
  it('creates the bounded canonical empty envelope', () => {
    const state = createEmptyEncounterState()

    expect(state).toEqual(canonicalEncounterState())
    expect(ENCOUNTER_STATE_LIMITS).toEqual({
      sides: 0,
      effects: 0,
      counters: 0,
      history: 0,
      turnResources: 0,
      zones: 0,
      pendingResolutionSummaries: 0,
    })
    expect(JSON.stringify(state)).toBe(
      '{"schemaVersion":1,"sides":{},"effects":[],"counters":{},"history":{},"turnResources":{},"zones":[],"pendingResolutionSummaries":[]}',
    )
  })

  it('round-trips through structured clone and JSON without sharing containers', () => {
    const state = createEmptyEncounterState()
    const structured = structuredClone(state)
    const json = JSON.parse(JSON.stringify(state)) as unknown
    const parsed = parseEncounterState(json)

    expect(structured).toEqual(state)
    expect(parsed).toEqual(state)
    expect(parsed).not.toBe(json)
    expect(parsed.sides).not.toBe((json as { sides: unknown }).sides)
    expect(parsed.counters).not.toBe((json as { counters: unknown }).counters)

    const another = createEmptyEncounterState()
    expect(another.effects).not.toBe(state.effects)
    expect(another.turnResources).not.toBe(state.turnResources)
  })

  it('rejects unsupported versions, malformed envelopes, and non-empty reserved containers', () => {
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
      .toThrow('encounterState.effects: must contain at most 0 entries')
    expect(() => parseEncounterState({ ...canonicalEncounterState(), turnResources: { actor: {} } }))
      .toThrow('encounterState.turnResources: must contain at most 0 entries')
  })
})
