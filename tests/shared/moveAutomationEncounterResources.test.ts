import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_ACTION_TYPES,
  ENCOUNTER_RESOURCE_LIMITS,
  EncounterResourceValidationError,
  createEncounterTurnResourceLedger,
  createEmptyEncounterTurnResources,
  parseEncounterTurnResources,
} from '#shared/moveAutomation/encounterResources'

const actorLedger = () => createEncounterTurnResourceLedger({
  placementId: 'actor-token',
  round: 2,
  turn: 4,
  movementBudget: 7,
})

describe('encounter turn resources contract', () => {
  it('creates canonical bounded action, reaction, movement, flag, and setup state', () => {
    const ledger = actorLedger()

    expect(createEmptyEncounterTurnResources()).toEqual({})
    expect(Object.keys(ledger.actions)).toEqual(ENCOUNTER_ACTION_TYPES)
    expect(ledger).toMatchObject({
      placementId: 'actor-token',
      round: 2,
      turn: 4,
      reaction: { available: true, resetOn: ['round-start'] },
      movement: { budget: 7, spent: 0, resetOn: ['turn-start'] },
      oncePerTurnFlags: [],
      setupExecute: null,
    })
    expect(ledger.actions.standard).toEqual({
      type: 'standard',
      budget: 1,
      spent: 0,
      resetOn: ['turn-start'],
    })
    expect(ledger.actions.swift.resetOn).toEqual(['round-start'])
    expect(ledger.actions.free.budget).toBeNull()
    expect(ENCOUNTER_RESOURCE_LIMITS.placementLedgers).toBe(256)
  })

  it('round-trips and canonically orders detached placement ledgers and flags', () => {
    const actor = actorLedger()
    const input = {
      'target-token': createEncounterTurnResourceLedger({ placementId: 'target-token' }),
      'actor-token': {
        ...actor,
        actions: Object.fromEntries(
          [...ENCOUNTER_ACTION_TYPES].reverse().map(type => [type, actor.actions[type]]),
        ),
        oncePerTurnFlags: [
          { id: 'move.scratch', sourceOperationId: 'op_scratch01', resetOn: ['turn-start'] },
          { id: 'feature.guard', sourceOperationId: 'op_guard0001', resetOn: ['round-end'] },
        ],
        setupExecute: {
          canonicalMoveId: 'Solar Beam',
          resolutionId: 'resolution.solar.1',
          sourceOperationId: 'op_solar001',
          status: 'ready-to-execute',
          createdRound: 2,
          createdTurn: 4,
          resetOn: ['scene-end', 'recall', 'knockout'],
        },
      },
    }
    const json = JSON.parse(JSON.stringify(input)) as unknown
    const parsed = parseEncounterTurnResources(json)

    expect(Object.keys(parsed)).toEqual(['actor-token', 'target-token'])
    expect(Object.keys(parsed['actor-token']!.actions)).toEqual(ENCOUNTER_ACTION_TYPES)
    expect(parsed['actor-token']!.oncePerTurnFlags.map(flag => flag.id)).toEqual([
      'feature.guard',
      'move.scratch',
    ])
    expect(parsed['actor-token']!.setupExecute).toMatchObject({
      canonicalMoveId: 'Solar Beam',
      status: 'ready-to-execute',
    })
    expect(parsed).not.toBe(json)
    expect(parsed['actor-token']).not.toBe((json as Record<string, unknown>)['actor-token'])
  })

  it('rejects malformed ledgers, duplicate flags, invalid bounds, and unknown fields', () => {
    const ledger = actorLedger()
    expect(() => parseEncounterTurnResources({
      actor: { ...ledger, placementId: 'other' },
    })).toThrow('must match directory key actor')
    expect(() => parseEncounterTurnResources({
      'actor-token': {
        ...ledger,
        actions: { ...ledger.actions, standard: { ...ledger.actions.standard, spent: -1 } },
      },
    })).toThrow('turnResources.actor-token.actions.standard.spent: must be from 0')
    expect(() => parseEncounterTurnResources({
      'actor-token': {
        ...ledger,
        oncePerTurnFlags: [
          { id: 'same.flag', sourceOperationId: 'op_one00001', resetOn: ['turn-start'] },
          { id: 'same.flag', sourceOperationId: 'op_two00002', resetOn: ['turn-start'] },
        ],
      },
    })).toThrowError(EncounterResourceValidationError)
    expect(() => parseEncounterTurnResources({
      'actor-token': { ...ledger, arbitraryPatch: {} },
    })).toThrow('unknown arbitraryPatch')
    expect(() => parseEncounterTurnResources({
      'actor-token': { ...ledger, turn: 1, round: null },
    })).toThrow('requires a non-null round')
  })
})
