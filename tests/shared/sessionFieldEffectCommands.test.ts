import { describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
} from '#shared/sessionCommands'
import {
  parseClientId,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import type { PlayerSessionActor } from '#shared/sessionPermissions'
import { parseSessionRevision } from '#shared/sessionRevisions'
import {
  FIELD_EFFECT_COMMAND_SCOPE_FIELD,
  REMOVE_FIELD_EFFECT_COMMAND_TYPE,
  SET_FIELD_EFFECT_COMMAND_TYPE,
  TICK_FIELD_EFFECT_DURATIONS_COMMAND_TYPE,
  createFieldEffectCommandScope,
  fieldEffectKindMatchesCategory,
  isFieldEffectCommandType,
  isFieldEffectCommandValidationCode,
  isSessionFieldEffectCategory,
  isSessionRoomKind,
  isSessionTerrainEffectKind,
  isSessionWeatherKind,
  validateFieldEffectCommand,
  validateRemoveFieldEffectCommand,
  validateSetFieldEffectCommand,
  validateTickFieldEffectDurationsCommand,
  type RemoveFieldEffectCommand,
  type SetFieldEffectCommand,
  type TickFieldEffectDurationsCommand,
} from '#shared/sessionFieldEffectCommands'

const sessionId = parseSessionId('session_fieldeffshared')
const gmClientId = parseClientId('client_fieldeffgm')
const playerClientId = parseClientId('client_fieldeffpl')
const playerId = parsePlayerId('player_fieldeff01')
const displayName = parseSessionDisplayName('Field Player')

const gmActor = {
  role: 'gm' as const,
  clientId: gmClientId,
}

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId,
  clientId: playerClientId,
  displayName,
}

const createSetCommand = (
  overrides: Partial<SetFieldEffectCommand> = {},
): SetFieldEffectCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: SET_FIELD_EFFECT_COMMAND_TYPE,
  opId: parseOpId('op_setfieldeff01'),
  baseRevision: parseSessionRevision(0),
  scopes: [createFieldEffectCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    category: 'weather',
    kind: 'sunny',
    rounds: 5,
    source: 'Sunny Day',
  },
  metadata: {
    traceId: 'trace-field-effect',
  },
  ...overrides,
})

const createRemoveCommand = (
  overrides: Partial<RemoveFieldEffectCommand> = {},
): RemoveFieldEffectCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: REMOVE_FIELD_EFFECT_COMMAND_TYPE,
  opId: parseOpId('op_removefielde'),
  baseRevision: parseSessionRevision(0),
  scopes: [createFieldEffectCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    category: 'terrain',
    kind: 'electric',
  },
  ...overrides,
})

const createTickCommand = (
  overrides: Partial<TickFieldEffectDurationsCommand> = {},
): TickFieldEffectDurationsCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: TICK_FIELD_EFFECT_DURATIONS_COMMAND_TYPE,
  opId: parseOpId('op_tickfieldeff'),
  baseRevision: parseSessionRevision(0),
  scopes: [createFieldEffectCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    amount: 1,
  },
  ...overrides,
})

describe('session field-effect commands', () => {
  it('defines field-effect command types, categories, kinds, and scope helpers', () => {
    expect(isFieldEffectCommandType(SET_FIELD_EFFECT_COMMAND_TYPE)).toBe(true)
    expect(isFieldEffectCommandType(REMOVE_FIELD_EFFECT_COMMAND_TYPE)).toBe(true)
    expect(isFieldEffectCommandType(TICK_FIELD_EFFECT_DURATIONS_COMMAND_TYPE)).toBe(true)
    expect(isFieldEffectCommandType('placeHazard')).toBe(false)
    expect(isSessionFieldEffectCategory('weather')).toBe(true)
    expect(isSessionWeatherKind('sunny')).toBe(true)
    expect(isSessionTerrainEffectKind('electric')).toBe(true)
    expect(isSessionRoomKind('trick')).toBe(true)
    expect(fieldEffectKindMatchesCategory('weather', 'electric')).toBe(false)
    expect(fieldEffectKindMatchesCategory('terrain', 'electric')).toBe(true)
    expect(createFieldEffectCommandScope('arena-map')).toEqual({
      lane: 'field-effect',
      field: FIELD_EFFECT_COMMAND_SCOPE_FIELD,
      mapSlug: 'arena-map',
    })
  })

  it('validates GM setFieldEffect payloads and normalizes source text', () => {
    const result = validateSetFieldEffectCommand(createSetCommand({
      payload: {
        mapSlug: 'arena-map',
        category: 'weather',
        kind: 'rainy',
        rounds: null,
        source: '  Rain Dance  ',
        weatherMode: 'append',
      },
    }))

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected valid setFieldEffect')
    expect(result.mapSlug).toBe('arena-map')
    expect(result.payload).toEqual({
      mapSlug: 'arena-map',
      category: 'weather',
      kind: 'rainy',
      rounds: null,
      source: 'Rain Dance',
      weatherMode: 'append',
    })
    expect(result.permission).toMatchObject({ allowed: true, role: 'gm' })
  })

  it('validates remove and tick payloads for category clears and duration ticks', () => {
    const removeOne = validateRemoveFieldEffectCommand(createRemoveCommand())
    expect(removeOne.valid).toBe(true)
    if (!removeOne.valid) throw new Error('expected valid removeFieldEffect')
    expect(removeOne.payload).toEqual({
      mapSlug: 'arena-map',
      category: 'terrain',
      kind: 'electric',
    })

    const clearAll = validateRemoveFieldEffectCommand(createRemoveCommand({
      payload: { mapSlug: 'arena-map', category: 'all' },
    }))
    expect(clearAll.valid).toBe(true)
    if (!clearAll.valid) throw new Error('expected valid clear all')
    expect(clearAll.payload).toEqual({ mapSlug: 'arena-map', category: 'all' })

    const tick = validateTickFieldEffectDurationsCommand(createTickCommand({
      payload: { mapSlug: 'arena-map', amount: 2 },
    }))
    expect(tick.valid).toBe(true)
    if (!tick.valid) throw new Error('expected valid tick')
    expect(tick.payload).toEqual({ mapSlug: 'arena-map', amount: 2 })
  })

  it('reports payload and scope issues', () => {
    const invalid = validateSetFieldEffectCommand(createSetCommand({
      scopes: [createFieldEffectCommandScope('other-map')],
      payload: {
        mapSlug: 'arena-map',
        category: 'weather',
        kind: 'electric',
        rounds: -1,
        source: '',
        terrainScope: 'field',
        startsNextRound: 'yes',
      } as unknown as SetFieldEffectCommand['payload'],
    }))

    expect(invalid.valid).toBe(false)
    if (invalid.valid) throw new Error('expected invalid setFieldEffect')
    const issueByPath = new Map(invalid.issues.map((issue) => [issue.path, issue]))
    expect(issueByPath.get('payload.kind')?.code).toBe('invalid-kind')
    expect(issueByPath.get('payload.rounds')?.code).toBe('invalid-rounds')
    expect(issueByPath.get('payload.source')?.code).toBe('invalid-source')
    expect(issueByPath.get('payload.terrainScope')?.code).toBe('invalid-terrain-scope')
    expect(issueByPath.get('payload.startsNextRound')?.code).toBe('invalid-starts-next-round')

    const mismatchedMap = validateSetFieldEffectCommand(createSetCommand({
      scopes: [createFieldEffectCommandScope('other-map')],
      payload: {
        mapSlug: 'arena-map',
        category: 'weather',
        kind: 'sunny',
        rounds: 5,
      },
    }))
    expect(mismatchedMap.valid).toBe(false)
    if (mismatchedMap.valid) throw new Error('expected mismatched map rejection')
    expect(new Map(mismatchedMap.issues.map((issue) => [issue.path, issue])).get('payload.mapSlug')?.code)
      .toBe('invalid-map-slug')

    const invalidRemove = validateRemoveFieldEffectCommand(createRemoveCommand({
      payload: { mapSlug: 'arena-map', category: 'all', kind: 'sunny' },
    }))
    expect(invalidRemove.valid).toBe(false)
    if (invalidRemove.valid) throw new Error('expected invalid remove')
    expect(invalidRemove.issues.some((issue) => issue.code === 'invalid-kind')).toBe(true)

    const invalidTick = validateTickFieldEffectDurationsCommand(createTickCommand({
      payload: { mapSlug: 'arena-map', amount: 0 },
    }))
    expect(invalidTick.valid).toBe(false)
    if (invalidTick.valid) throw new Error('expected invalid tick')
    expect(invalidTick.issues.some((issue) => issue.code === 'invalid-tick-amount')).toBe(true)
    expect(isFieldEffectCommandValidationCode('invalid-rounds')).toBe(true)
    expect(isFieldEffectCommandValidationCode('not-real')).toBe(false)
  })

  it('rejects player actors because field-effect editing is GM-only', () => {
    const result = validateFieldEffectCommand(createSetCommand({ actor: playerActor }))

    expect(result.valid).toBe(false)
    if (result.valid) throw new Error('expected player denial')
    expect(result.permission).toMatchObject({
      allowed: false,
      reason: 'gm-required',
    })
    expect(result.issues.some((issue) => issue.code === 'permission-denied')).toBe(true)
  })
})
