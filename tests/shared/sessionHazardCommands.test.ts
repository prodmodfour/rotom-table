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
import { parseSessionRevision } from '#shared/sessionRevisions'
import type { PlayerSessionActor } from '#shared/sessionPermissions'
import {
  HAZARD_COMMAND_SCOPE_FIELD,
  PLACE_HAZARD_COMMAND_TYPE,
  REMOVE_HAZARD_COMMAND_TYPE,
  createHazardCommandScope,
  isHazardCommandType,
  isHazardCommandValidationCode,
  isSessionHazardKind,
  validateHazardCommand,
  validatePlaceHazardCommand,
  validateRemoveHazardCommand,
  type PlaceHazardCommand,
  type RemoveHazardCommand,
} from '#shared/sessionHazardCommands'

const sessionId = parseSessionId('session_hazardshared001')
const gmClientId = parseClientId('client_hazardgm1')
const playerClientId = parseClientId('client_hazardpl1')
const playerId = parsePlayerId('player_hazard001')
const displayName = parseSessionDisplayName('Hazard Player')

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

const createPlaceCommand = (
  overrides: Partial<PlaceHazardCommand> = {},
): PlaceHazardCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: PLACE_HAZARD_COMMAND_TYPE,
  opId: parseOpId('op_placehazard01'),
  baseRevision: parseSessionRevision(0),
  scopes: [createHazardCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    hazard: {
      kind: 'toxic-spikes',
      x: 1,
      y: 0,
      z: 2,
      layer: 1,
      owner: 'Red side',
    },
  },
  metadata: {
    traceId: 'trace-place-hazard',
  },
  ...overrides,
})

const createRemoveCommand = (
  overrides: Partial<RemoveHazardCommand> = {},
): RemoveHazardCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: REMOVE_HAZARD_COMMAND_TYPE,
  opId: parseOpId('op_removehazard1'),
  baseRevision: parseSessionRevision(0),
  scopes: [createHazardCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    cell: {
      x: 1,
      y: 0,
      z: 2,
      kind: 'toxic-spikes',
    },
  },
  ...overrides,
})

describe('session hazard commands', () => {
  it('defines hazard command types, kinds, and scope helpers', () => {
    expect(isHazardCommandType(PLACE_HAZARD_COMMAND_TYPE)).toBe(true)
    expect(isHazardCommandType(REMOVE_HAZARD_COMMAND_TYPE)).toBe(true)
    expect(isHazardCommandType('setInitiative')).toBe(false)
    expect(isSessionHazardKind('spikes')).toBe(true)
    expect(isSessionHazardKind('toxic-spikes')).toBe(true)
    expect(isSessionHazardKind('not-a-hazard')).toBe(false)
    expect(createHazardCommandScope('arena-map')).toEqual({
      lane: 'hazard',
      field: HAZARD_COMMAND_SCOPE_FIELD,
      mapSlug: 'arena-map',
    })
  })

  it('validates GM placeHazard payloads and normalizes owner text', () => {
    const result = validatePlaceHazardCommand(createPlaceCommand({
      payload: {
        mapSlug: 'arena-map',
        hazard: {
          kind: 'toxic-spikes',
          x: 1,
          y: 0,
          z: 2,
          layer: 2,
          owner: '  Blue side  ',
        },
      },
    }))

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected valid placeHazard')
    expect(result.mapSlug).toBe('arena-map')
    expect(result.payload).toEqual({
      mapSlug: 'arena-map',
      hazard: {
        kind: 'toxic-spikes',
        x: 1,
        y: 0,
        z: 2,
        layer: 2,
        owner: 'Blue side',
      },
    })
    expect(result.permission).toMatchObject({ allowed: true, role: 'gm' })
  })

  it('validates GM removeHazard payloads with optional hazard kind', () => {
    const removeOne = validateRemoveHazardCommand(createRemoveCommand())
    expect(removeOne.valid).toBe(true)
    if (!removeOne.valid) throw new Error('expected valid removeHazard')
    expect(removeOne.payload.cell).toEqual({ x: 1, y: 0, z: 2, kind: 'toxic-spikes' })

    const removeAll = validateRemoveHazardCommand(createRemoveCommand({
      payload: {
        mapSlug: 'arena-map',
        cell: { x: 1, y: 0, z: 2 },
      },
    }))
    expect(removeAll.valid).toBe(true)
    if (!removeAll.valid) throw new Error('expected valid remove all hazards')
    expect(removeAll.payload.cell).toEqual({ x: 1, y: 0, z: 2 })
  })

  it('reports payload and scope issues', () => {
    const invalid = validatePlaceHazardCommand(createPlaceCommand({
      scopes: [createHazardCommandScope('other-map')],
      payload: {
        mapSlug: 'arena-map',
        hazard: {
          kind: 'not-real',
          x: -1,
          y: 0.5,
          z: Number.MAX_SAFE_INTEGER + 1,
          layer: 3,
          owner: '',
        },
      } as unknown as PlaceHazardCommand['payload'],
    }))

    expect(invalid.valid).toBe(false)
    if (invalid.valid) throw new Error('expected invalid placeHazard')
    const issueByPath = new Map(invalid.issues.map((issue) => [issue.path, issue]))
    expect(issueByPath.get('payload.hazard.kind')?.code).toBe('invalid-kind')
    expect(issueByPath.get('payload.hazard.x')?.code).toBe('invalid-cell')
    expect(issueByPath.get('payload.hazard.y')?.code).toBe('invalid-cell')
    expect(issueByPath.get('payload.hazard.z')?.code).toBe('invalid-cell')
    expect(issueByPath.get('payload.hazard.layer')?.code).toBe('invalid-layer')
    expect(issueByPath.get('payload.hazard.owner')?.code).toBe('invalid-owner')

    const mismatchedMap = validateRemoveHazardCommand(createRemoveCommand({
      scopes: [createHazardCommandScope('other-map')],
      payload: {
        mapSlug: 'arena-map',
        cell: { x: 1, y: 0, z: 2, kind: 'spikes' },
      },
    }))
    expect(mismatchedMap.valid).toBe(false)
    if (mismatchedMap.valid) throw new Error('expected mismatched map rejection')
    expect(new Map(mismatchedMap.issues.map((issue) => [issue.path, issue])).get('payload.mapSlug')?.code)
      .toBe('invalid-map-slug')
    expect(isHazardCommandValidationCode('invalid-layer')).toBe(true)
    expect(isHazardCommandValidationCode('not-real')).toBe(false)
  })

  it('rejects player actors because hazard editing is GM-only', () => {
    const result = validateHazardCommand(createPlaceCommand({ actor: playerActor }))

    expect(result.valid).toBe(false)
    if (result.valid) throw new Error('expected player denial')
    expect(result.permission).toMatchObject({
      allowed: false,
      reason: 'gm-required',
    })
    expect(result.issues.some((issue) => issue.code === 'permission-denied')).toBe(true)
  })
})
