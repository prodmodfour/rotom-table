import { describe, expect, it } from 'vitest'
import {
  SESSION_COMMAND_ENVELOPE_VERSION,
  parseOpId,
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
  SessionSheetResourceRef,
  SessionTokenResourceRef,
} from '#shared/sessionPermissions'
import { parseSessionRevision } from '#shared/sessionRevisions'
import {
  MODIFY_HP_COMMAND_TYPE,
  createModifyHpSheetCommandScope,
  createModifyHpTokenCommandScope,
  isModifyHpCommandValidationCode,
  validateModifyHpCommand,
  type ModifyHpCommand,
} from '#shared/sessionTableActionCommands'

const sessionId = parseSessionId('session_modifyhp0001')
const gmClientId = parseClientId('client_mhpgm001')
const playerClientId = parseClientId('client_mhppl001')
const playerId = parsePlayerId('player_mhp00001')
const displayName = sanitizeSessionDisplayName('HP Player')

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

const tokenResource = {
  kind: 'token',
  tokenId: 'token-pikachu',
  mapSlug: 'arena-map',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionTokenResourceRef

const sheetResource = {
  kind: 'sheet',
  sheetKind: 'pokemon',
  sheetSlug: 'pikachu',
} as const satisfies SessionSheetResourceRef

const assignment = {
  playerId,
  displayName,
  controllableResources: [tokenResource],
  visibleResources: [{ kind: 'map', mapSlug: 'arena-map' }, tokenResource, sheetResource],
  updatedAt: '2026-05-26T10:00:00.000Z',
  updatedByClientId: gmClientId,
} as const satisfies PlayerAssignmentRecord

const sheetAssignment = {
  ...assignment,
  controllableResources: [sheetResource],
} as const satisfies PlayerAssignmentRecord

const createCommand = (overrides: Partial<ModifyHpCommand> = {}): ModifyHpCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: MODIFY_HP_COMMAND_TYPE,
  opId: parseOpId('op_modifyhp001'),
  baseRevision: parseSessionRevision(0),
  scopes: [
    createModifyHpTokenCommandScope(tokenResource),
    createModifyHpSheetCommandScope(sheetResource),
  ],
  payload: {
    tokenId: 'token-pikachu',
    currentHp: 12,
    injuries: 1,
  },
  ...overrides,
})

describe('session table action commands', () => {
  it('validates modifyHp commands for assigned token resources', () => {
    const result = validateModifyHpCommand(createCommand(), {
      assignments: [assignment],
    })

    expect(result.valid).toBe(true)
    if (!result.valid) throw new Error('expected valid modifyHp command')
    expect(result.command.type).toBe(MODIFY_HP_COMMAND_TYPE)
    expect(result.payload).toEqual({ tokenId: 'token-pikachu', currentHp: 12, injuries: 1 })
    expect(result.tokenResource).toEqual(tokenResource)
    expect(result.sheetResource).toEqual(sheetResource)
    expect(result.permission).toMatchObject({ allowed: true, role: 'player' })
  })

  it('allows the GM and sheet-assigned players to modify HP', () => {
    expect(validateModifyHpCommand(createCommand({ actor: gmActor }), { assignments: [] }).valid).toBe(true)

    const sheetAssigned = validateModifyHpCommand(createCommand(), {
      assignments: [sheetAssignment],
    })
    expect(sheetAssigned.valid).toBe(true)
    if (!sheetAssigned.valid) throw new Error('expected sheet-assigned player to pass')
    expect(sheetAssigned.permittedResource).toEqual(sheetResource)
  })

  it('reports payload and scope validation issues', () => {
    const invalidPayload = validateModifyHpCommand(createCommand({
      payload: {
        tokenId: '',
        currentHp: 1.5,
        injuries: -1,
      },
    }), { assignments: [assignment] })

    expect(invalidPayload.valid).toBe(false)
    if (invalidPayload.valid) throw new Error('expected invalid payload')
    expect(invalidPayload.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'invalid-token-id',
      'invalid-current-hp',
      'invalid-injuries',
    ]))
    expect(isModifyHpCommandValidationCode('invalid-current-hp')).toBe(true)

    const invalidScope = validateModifyHpCommand(createCommand({
      scopes: [createModifyHpTokenCommandScope({ ...tokenResource, tokenId: 'other-token' })],
    }), { assignments: [assignment] })

    expect(invalidScope.valid).toBe(false)
    if (invalidScope.valid) throw new Error('expected invalid scope')
    expect(invalidScope.issues).toContainEqual(expect.objectContaining({ code: 'invalid-token-scope' }))
  })

  it('denies players without a controllable visible token or sheet assignment', () => {
    const result = validateModifyHpCommand(createCommand(), {
      assignments: [],
    })

    expect(result.valid).toBe(false)
    if (result.valid) throw new Error('expected unauthorized result')
    expect(result.permission).toMatchObject({
      allowed: false,
      reason: 'missing-player-identity',
    })
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'permission-denied' }))
  })
})
