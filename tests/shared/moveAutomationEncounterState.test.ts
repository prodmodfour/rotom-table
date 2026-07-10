import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_SIDE_LIMITS,
  ENCOUNTER_STATE_LIMITS,
  ENCOUNTER_STATE_SCHEMA_VERSION,
  EncounterStateValidationError,
  createEmptyEncounterState,
  encounterStateHasSide,
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
      sides: 32,
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

  it('round-trips typed sides through structured clone and JSON without sharing containers', () => {
    const state = {
      ...createEmptyEncounterState(),
      sides: {
        rivals: { id: 'rivals', label: 'Rivals', color: '#AA33CC', status: 'inactive' as const },
        allies: { id: 'allies', label: '  Allies  ', color: '#33AA44', status: 'active' as const },
      },
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
    })
    expect(Object.keys(parsed.sides)).toEqual(['allies', 'rivals'])
    expect(encounterStateHasSide(parsed, 'allies')).toBe(true)
    expect(encounterStateHasSide(parsed, 'unknown')).toBe(false)
    expect(encounterStateHasSide(undefined, 'allies')).toBe(false)
    expect(parsed).not.toBe(json)
    expect(parsed.sides).not.toBe((json as { sides: unknown }).sides)
    expect(parsed.sides.allies).not.toBe((json as { sides: { allies: unknown } }).sides.allies)
    expect(parsed.counters).not.toBe((json as { counters: unknown }).counters)

    const another = createEmptyEncounterState()
    expect(another.effects).not.toBe(state.effects)
    expect(another.turnResources).not.toBe(state.turnResources)
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
