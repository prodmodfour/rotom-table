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
  INITIATIVE_COMMAND_SCOPE_FIELD,
  NEXT_INITIATIVE_COMMAND_TYPE,
  PREVIOUS_INITIATIVE_COMMAND_TYPE,
  SET_INITIATIVE_COMMAND_TYPE,
  createInitiativeCommandScope,
  isInitiativeCommandType,
  isInitiativeCommandValidationCode,
  validateInitiativeCommand,
  validateNextInitiativeCommand,
  validatePreviousInitiativeCommand,
  validateSetInitiativeCommand,
  type NextInitiativeCommand,
  type SetInitiativeCommand,
} from '#shared/sessionInitiativeCommands'

const sessionId = parseSessionId('session_initiative001')
const gmClientId = parseClientId('client_initgm001')
const playerClientId = parseClientId('client_initpl001')
const playerId = parsePlayerId('player_init0001')
const displayName = parseSessionDisplayName('Misty')

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
  overrides: Partial<SetInitiativeCommand> = {},
): SetInitiativeCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: SET_INITIATIVE_COMMAND_TYPE,
  opId: parseOpId('op_setinitiative001'),
  baseRevision: parseSessionRevision(0),
  scopes: [createInitiativeCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    tokenId: 'token-pikachu',
    initiative: 14,
    activeId: 'token-pikachu',
    round: 2,
  },
  metadata: {
    traceId: 'trace-set-initiative',
  },
  ...overrides,
})

const createNextCommand = (
  overrides: Partial<NextInitiativeCommand> = {},
): NextInitiativeCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: gmActor,
  type: NEXT_INITIATIVE_COMMAND_TYPE,
  opId: parseOpId('op_nextinitiative01'),
  baseRevision: parseSessionRevision(0),
  scopes: [createInitiativeCommandScope('arena-map')],
  payload: {
    mapSlug: 'arena-map',
    orderIds: ['token-pikachu', 'token-bulbasaur'],
    activeId: 'token-pikachu',
    round: 1,
  },
  ...overrides,
})

describe('session initiative commands', () => {
  it('defines initiative command type and scope helpers', () => {
    expect(isInitiativeCommandType(SET_INITIATIVE_COMMAND_TYPE)).toBe(true)
    expect(isInitiativeCommandType(NEXT_INITIATIVE_COMMAND_TYPE)).toBe(true)
    expect(isInitiativeCommandType(PREVIOUS_INITIATIVE_COMMAND_TYPE)).toBe(true)
    expect(isInitiativeCommandType('modifyHp')).toBe(false)
    expect(createInitiativeCommandScope('arena-map')).toEqual({
      lane: 'initiative',
      field: INITIATIVE_COMMAND_SCOPE_FIELD,
      mapSlug: 'arena-map',
    })
  })

  it('validates GM setInitiative payloads for scores, active turns, and rounds', () => {
    const result = validateSetInitiativeCommand(createSetCommand())

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected valid setInitiative')
    expect(result.mapSlug).toBe('arena-map')
    expect(result.payload).toEqual({
      mapSlug: 'arena-map',
      tokenId: 'token-pikachu',
      initiative: 14,
      activeId: 'token-pikachu',
      round: 2,
    })
    expect(result.permission).toMatchObject({ allowed: true, role: 'gm' })

    const clearScore = validateSetInitiativeCommand(createSetCommand({
      payload: {
        mapSlug: 'arena-map',
        tokenId: 'token-pikachu',
        initiative: null,
        activeId: null,
      },
    }))
    expect(clearScore.valid).toBe(true)

    const manualOrder = validateSetInitiativeCommand(createSetCommand({
      payload: {
        mapSlug: 'arena-map',
        manualOrderIds: ['token-bulbasaur', 'token-pikachu'],
      },
    }))
    expect(manualOrder.valid).toBe(true)
    if (!manualOrder.valid) throw new Error('expected valid manual order setInitiative')
    expect(manualOrder.payload).toEqual({
      mapSlug: 'arena-map',
      manualOrderIds: ['token-bulbasaur', 'token-pikachu'],
    })

    const clearManualOrder = validateSetInitiativeCommand(createSetCommand({
      payload: {
        mapSlug: 'arena-map',
        manualOrderIds: null,
      },
    }))
    expect(clearManualOrder.valid).toBe(true)
  })

  it('validates nextInitiative and previousInitiative GM commands', () => {
    const next = validateNextInitiativeCommand(createNextCommand())
    expect(next.valid).toBe(true)
    if (!next.valid) throw new Error('expected valid nextInitiative')
    expect(next.mapSlug).toBe('arena-map')
    expect(next.payload).toEqual({
      mapSlug: 'arena-map',
      orderIds: ['token-pikachu', 'token-bulbasaur'],
      activeId: 'token-pikachu',
      round: 1,
    })

    const previous = validatePreviousInitiativeCommand({
      ...createNextCommand(),
      type: PREVIOUS_INITIATIVE_COMMAND_TYPE,
      opId: parseOpId('op_previnitiative01'),
    })
    expect(previous.valid).toBe(true)
  })

  it('reports setInitiative payload and scope issues', () => {
    const invalid = validateSetInitiativeCommand(createSetCommand({
      scopes: [createInitiativeCommandScope('other-map')],
      payload: {
        mapSlug: 'arena-map',
        tokenId: '',
        initiative: 1000,
        activeId: '',
        round: 0,
      } as unknown as SetInitiativeCommand['payload'],
    }))

    expect(invalid.valid).toBe(false)
    if (invalid.valid) throw new Error('expected invalid setInitiative')
    const issueByPath = new Map(invalid.issues.map((issue) => [issue.path, issue]))
    expect(issueByPath.get('payload.tokenId')?.code).toBe('invalid-token-id')
    expect(issueByPath.get('payload.initiative')?.code).toBe('invalid-initiative')
    expect(issueByPath.get('payload.activeId')?.code).toBe('invalid-active-id')
    expect(issueByPath.get('payload.round')?.code).toBe('invalid-round')

    const mismatchedMap = validateSetInitiativeCommand(createSetCommand({
      scopes: [createInitiativeCommandScope('other-map')],
      payload: {
        mapSlug: 'arena-map',
        tokenId: 'token-pikachu',
        initiative: 10,
      },
    }))
    expect(mismatchedMap.valid).toBe(false)
    if (mismatchedMap.valid) throw new Error('expected mismatched map rejection')
    expect(new Map(mismatchedMap.issues.map((issue) => [issue.path, issue])).get('payload.mapSlug')?.code)
      .toBe('invalid-map-slug')
    const duplicateManualOrder = validateSetInitiativeCommand(createSetCommand({
      payload: {
        mapSlug: 'arena-map',
        manualOrderIds: ['token-pikachu', 'token-pikachu'],
      },
    }))
    expect(duplicateManualOrder.valid).toBe(false)
    if (duplicateManualOrder.valid) throw new Error('expected duplicate manual order rejection')
    expect(new Map(duplicateManualOrder.issues.map((issue) => [issue.path, issue])).get('payload.manualOrderIds[1]')?.code)
      .toBe('invalid-order')

    const emptyManualOrder = validateSetInitiativeCommand(createSetCommand({
      payload: {
        mapSlug: 'arena-map',
        manualOrderIds: [],
      },
    }))
    expect(emptyManualOrder.valid).toBe(false)
    if (emptyManualOrder.valid) throw new Error('expected empty manual order rejection')
    expect(new Map(emptyManualOrder.issues.map((issue) => [issue.path, issue])).get('payload.manualOrderIds')?.code)
      .toBe('invalid-order')

    const nonStringManualOrder = validateSetInitiativeCommand(createSetCommand({
      payload: {
        mapSlug: 'arena-map',
        manualOrderIds: ['token-pikachu', 42],
      } as unknown as SetInitiativeCommand['payload'],
    }))
    expect(nonStringManualOrder.valid).toBe(false)
    if (nonStringManualOrder.valid) throw new Error('expected non-string manual order rejection')
    expect(new Map(nonStringManualOrder.issues.map((issue) => [issue.path, issue])).get('payload.manualOrderIds[1]')?.code)
      .toBe('invalid-order')

    const tokenOnly = validateSetInitiativeCommand(createSetCommand({
      payload: {
        mapSlug: 'arena-map',
        tokenId: 'token-pikachu',
        manualOrderIds: ['token-pikachu'],
      },
    }))
    expect(tokenOnly.valid).toBe(false)
    if (tokenOnly.valid) throw new Error('expected token-only rejection')
    expect(new Map(tokenOnly.issues.map((issue) => [issue.path, issue])).get('payload.tokenId')?.code)
      .toBe('invalid-token-id')

    expect(isInitiativeCommandValidationCode('invalid-round')).toBe(true)
    expect(isInitiativeCommandValidationCode('not-real')).toBe(false)
  })

  it('rejects player actors because initiative control is GM-only', () => {
    const result = validateInitiativeCommand(createSetCommand({ actor: playerActor }))

    expect(result.valid).toBe(false)
    if (result.valid) throw new Error('expected player denial')
    expect(result.permission).toMatchObject({
      allowed: false,
      reason: 'gm-required',
    })
    expect(result.issues.some((issue) => issue.code === 'permission-denied')).toBe(true)
  })
})
