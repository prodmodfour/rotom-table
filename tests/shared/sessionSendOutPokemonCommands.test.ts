import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
  type SessionCommandEnvelope,
} from '#shared/sessionCommands'
import {
  parseClientId,
  parsePlayerId,
  parseSessionId,
  sanitizeSessionDisplayName,
} from '#shared/sessionIdentity'
import type {
  GmSessionActor,
  PlayerAssignmentRecord,
  PlayerSessionActor,
  SessionTokenResourceRef,
} from '#shared/sessionPermissions'
import { parseSessionRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  SEND_OUT_POKEMON_COMMAND_TYPE,
  SEND_OUT_POKEMON_COMMAND_VALIDATION_CODES,
  SEND_OUT_POKEMON_SPAWN_SCOPE_FIELD,
  SEND_OUT_POKEMON_TRAINER_SCOPE_FIELD,
  assertValidSendOutPokemonCommand,
  createSendOutPokemonSpawnCommandScope,
  createSendOutPokemonTrainerCommandScope,
  isSendOutPokemonCommandValidationCode,
  validateSendOutPokemonCommand,
  type SendOutPokemonCommand,
  type SendOutPokemonCommandPayload,
  type SendOutPokemonCommandValidationCode,
} from '#shared/sessionTokenCommands'

const sessionId = parseSessionId('session_sendout00001')
const playerId = parsePlayerId('player_sendout01')
const otherPlayerId = parsePlayerId('player_sendout02')
const gmClientId = parseClientId('client_sendoutGM')
const playerClientId = parseClientId('client_sendoutPL')
const otherClientId = parseClientId('client_sendoutO2')
const displayName = sanitizeSessionDisplayName('Ash')
const otherDisplayName = sanitizeSessionDisplayName('Misty')
const opId = parseOpId('op_sendoutpkmn1')

const gmActor: GmSessionActor = {
  role: 'gm',
  clientId: gmClientId,
}

const playerActor: PlayerSessionActor = {
  role: 'player',
  playerId,
  clientId: playerClientId,
  displayName,
}

const otherPlayerActor: PlayerSessionActor = {
  role: 'player',
  playerId: otherPlayerId,
  clientId: otherClientId,
  displayName: otherDisplayName,
}

const trainerResource = {
  kind: 'token',
  tokenId: 'token-ash',
  mapSlug: 'viridian-gym',
  sheetKind: 'trainer',
  sheetSlug: 'ash',
} as const satisfies SessionTokenResourceRef

const pokemonResource = {
  kind: 'token',
  tokenId: 'token-pikachu-1',
  mapSlug: 'viridian-gym',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionTokenResourceRef

const assignment = {
  playerId,
  displayName,
  controllableResources: [{ kind: 'token', tokenId: 'token-ash' }],
  visibleResources: [{ kind: 'map', mapSlug: 'viridian-gym' }],
  updatedAt: '2026-05-26T00:00:00.000Z',
  updatedByClientId: gmClientId,
} as const satisfies PlayerAssignmentRecord

const buildCommand = (
  overrides: Partial<SendOutPokemonCommandPayload> = {},
  actor: PlayerSessionActor | GmSessionActor = playerActor,
): SendOutPokemonCommand<typeof actor> => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor,
  type: SEND_OUT_POKEMON_COMMAND_TYPE,
  opId,
  baseRevision: parseSessionRevision(7),
  scopes: [
    createSendOutPokemonTrainerCommandScope(trainerResource),
    createSendOutPokemonSpawnCommandScope(pokemonResource),
  ],
  payload: {
    trainerTokenId: 'token-ash',
    pokemonSlug: 'pikachu',
    tokenId: 'token-pikachu-1',
    position: { x: 4, y: 1, z: 6 },
    facing: 'south-east',
    ...overrides,
  },
})

describe('sendOutPokemon command contract and validator', () => {
  it('defines the payload and trainer/spawn token scope helpers', () => {
    const payload = {
      trainerTokenId: 'token-ash',
      pokemonSlug: 'pikachu',
      tokenId: 'token-pikachu-1',
      position: { x: 4, y: 1, z: 6 },
      facing: 'south-east',
    } as const satisfies SendOutPokemonCommandPayload
    const trainerScope = createSendOutPokemonTrainerCommandScope(trainerResource)
    const spawnScope = createSendOutPokemonSpawnCommandScope(pokemonResource)

    expect(SEND_OUT_POKEMON_COMMAND_TYPE).toBe('sendOutPokemon')
    expect(SEND_OUT_POKEMON_TRAINER_SCOPE_FIELD).toBe('sendOut')
    expect(SEND_OUT_POKEMON_SPAWN_SCOPE_FIELD).toBe('spawn')
    expect(SEND_OUT_POKEMON_COMMAND_VALIDATION_CODES).toContain('permission-denied')
    expect(isSendOutPokemonCommandValidationCode('invalid-pokemon-slug')).toBe(true)
    expect(isSendOutPokemonCommandValidationCode('invalid-sheet-kind')).toBe(false)
    expect(trainerScope).toEqual({
      lane: 'token',
      resource: trainerResource,
      field: 'sendOut',
      mapSlug: 'viridian-gym',
    })
    expect(spawnScope).toEqual({
      lane: 'token',
      resource: pokemonResource,
      field: 'spawn',
      mapSlug: 'viridian-gym',
    })

    expectTypeOf<(typeof SEND_OUT_POKEMON_COMMAND_VALIDATION_CODES)[number]>()
      .toEqualTypeOf<SendOutPokemonCommandValidationCode>()
    expectTypeOf(payload).toMatchTypeOf<SendOutPokemonCommandPayload>()
  })

  it('accepts valid player commands when the trainer token is assigned and visible', () => {
    const command = buildCommand()
    const result = validateSendOutPokemonCommand(command, { assignments: [assignment] })

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected sendOutPokemon command to validate')
    expect(result.command).toBe(command)
    expect(result.payload).toEqual(command.payload)
    expect(result.resource).toEqual(trainerResource)
    expect(result.trainerResource).toEqual(trainerResource)
    expect(result.pokemonResource).toEqual(pokemonResource)
    expect(result.permission).toMatchObject({ allowed: true, role: 'player' })
    expect(assertValidSendOutPokemonCommand(command, { assignments: [assignment] })).toBe(command)
    expectTypeOf(result.command).toMatchTypeOf<SessionCommandEnvelope<'sendOutPokemon'>>()
    expectTypeOf(result.command.baseRevision).toEqualTypeOf<SessionRevision>()
  })

  it('allows GM commands without player assignments', () => {
    const command = buildCommand({}, gmActor)
    const result = validateSendOutPokemonCommand(command)

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected GM sendOutPokemon command to validate')
    expect(result.permission).toMatchObject({ allowed: true, role: 'gm' })
  })

  it('validates payload shape and requires distinct trainer/spawn token scopes', () => {
    const invalidPayloadCommand = {
      ...buildCommand(),
      type: 'moveToken',
      payload: {
        trainerTokenId: '',
        pokemonSlug: '',
        tokenId: '',
        position: { x: -1, y: 1.5, z: Number.NaN },
        facing: 'north',
      },
    }
    const invalidScopeCommand = {
      ...buildCommand(),
      scopes: [createSendOutPokemonTrainerCommandScope(trainerResource)],
    }
    const mapMismatchCommand = {
      ...buildCommand(),
      scopes: [
        createSendOutPokemonTrainerCommandScope(trainerResource),
        createSendOutPokemonSpawnCommandScope({ ...pokemonResource, mapSlug: 'other-map' }),
      ],
    }

    const payloadResult = validateSendOutPokemonCommand(invalidPayloadCommand, { assignments: [assignment] })
    const payloadIssueByPath = new Map(payloadResult.issues.map((issue) => [issue.path, issue]))
    const scopeResult = validateSendOutPokemonCommand(invalidScopeCommand, { assignments: [assignment] })
    const mapMismatchResult = validateSendOutPokemonCommand(mapMismatchCommand, { assignments: [assignment] })

    expect(payloadResult.valid).toBe(false)
    expect(payloadIssueByPath.get('type')?.code).toBe('invalid-command-type')
    expect(payloadIssueByPath.get('payload.trainerTokenId')?.code).toBe('invalid-trainer-token-id')
    expect(payloadIssueByPath.get('payload.pokemonSlug')?.code).toBe('invalid-pokemon-slug')
    expect(payloadIssueByPath.get('payload.tokenId')?.code).toBe('invalid-token-id')
    expect(payloadIssueByPath.get('payload.position.x')?.code).toBe('invalid-position')
    expect(payloadIssueByPath.get('payload.position.y')?.code).toBe('invalid-position')
    expect(payloadIssueByPath.get('payload.position.z')?.code).toBe('invalid-position')
    expect(payloadIssueByPath.get('payload.facing')?.code).toBe('invalid-facing')
    expect(scopeResult.valid).toBe(false)
    expect(scopeResult.issues).toMatchObject([{ path: 'scopes', code: 'invalid-token-scope' }])
    expect(mapMismatchResult.valid).toBe(false)
    expect(mapMismatchResult.issues).toMatchObject([{ path: 'scopes', code: 'invalid-token-scope' }])
  })

  it('denies player commands when the trainer token is unassigned, hidden, or unknown', () => {
    const unassignedCommand = {
      ...buildCommand({ trainerTokenId: 'token-brock' }),
      scopes: [
        createSendOutPokemonTrainerCommandScope({ ...trainerResource, tokenId: 'token-brock' }),
        createSendOutPokemonSpawnCommandScope(pokemonResource),
      ],
    }
    const hiddenAssignment = {
      ...assignment,
      visibleResources: [],
    } satisfies PlayerAssignmentRecord
    const unknownPlayerCommand = buildCommand({}, otherPlayerActor)

    const unassignedResult = validateSendOutPokemonCommand(unassignedCommand, { assignments: [assignment] })
    const hiddenResult = validateSendOutPokemonCommand(buildCommand(), { assignments: [hiddenAssignment] })
    const unknownResult = validateSendOutPokemonCommand(unknownPlayerCommand, { assignments: [assignment] })

    expect(unassignedResult.valid).toBe(false)
    expect(unassignedResult).toMatchObject({
      permission: { allowed: false, reason: 'resource-not-assigned', role: 'player' },
    })
    expect(hiddenResult.valid).toBe(false)
    expect(hiddenResult).toMatchObject({
      permission: { allowed: false, reason: 'resource-not-visible', role: 'player' },
    })
    expect(unknownResult.valid).toBe(false)
    expect(unknownResult).toMatchObject({
      permission: { allowed: false, reason: 'missing-player-identity', role: 'player' },
    })
    expect(() => assertValidSendOutPokemonCommand(unassignedCommand, { assignments: [assignment] }, 'test send out'))
      .toThrow('test send out is invalid')
  })
})
