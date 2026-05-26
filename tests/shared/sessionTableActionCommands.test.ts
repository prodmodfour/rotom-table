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
  MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  MODIFY_HP_COMMAND_TYPE,
  createModifyCombatStagesSheetCommandScope,
  createModifyCombatStagesTokenCommandScope,
  createModifyHpSheetCommandScope,
  createModifyHpTokenCommandScope,
  isModifyCombatStagesCommandValidationCode,
  isModifyHpCommandValidationCode,
  validateModifyCombatStagesCommand,
  validateModifyHpCommand,
  type ModifyCombatStagesCommand,
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

const createModifyHpCommand = (overrides: Partial<ModifyHpCommand> = {}): ModifyHpCommand => ({
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

const createModifyCombatStagesCommand = (
  overrides: Partial<ModifyCombatStagesCommand> = {},
): ModifyCombatStagesCommand => ({
  schemaVersion: SESSION_COMMAND_ENVELOPE_VERSION,
  sessionId,
  actor: playerActor,
  type: MODIFY_COMBAT_STAGES_COMMAND_TYPE,
  opId: parseOpId('op_modifycs001'),
  baseRevision: parseSessionRevision(0),
  scopes: [
    createModifyCombatStagesTokenCommandScope(tokenResource),
    createModifyCombatStagesSheetCommandScope(sheetResource),
  ],
  payload: {
    tokenId: 'token-pikachu',
    stages: { atk: 1, def: -1, satk: 0, sdef: 2, spd: 0, acc: -2 },
  },
  ...overrides,
})

describe('session table action commands', () => {
  it('validates modifyHp commands for assigned token resources', () => {
    const result = validateModifyHpCommand(createModifyHpCommand(), {
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
    expect(validateModifyHpCommand(createModifyHpCommand({ actor: gmActor }), { assignments: [] }).valid).toBe(true)

    const sheetAssigned = validateModifyHpCommand(createModifyHpCommand(), {
      assignments: [sheetAssignment],
    })
    expect(sheetAssigned.valid).toBe(true)
    if (!sheetAssigned.valid) throw new Error('expected sheet-assigned player to pass')
    expect(sheetAssigned.permittedResource).toEqual(sheetResource)
  })

  it('reports payload and scope validation issues', () => {
    const invalidPayload = validateModifyHpCommand(createModifyHpCommand({
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

    const invalidScope = validateModifyHpCommand(createModifyHpCommand({
      scopes: [createModifyHpTokenCommandScope({ ...tokenResource, tokenId: 'other-token' })],
    }), { assignments: [assignment] })

    expect(invalidScope.valid).toBe(false)
    if (invalidScope.valid) throw new Error('expected invalid scope')
    expect(invalidScope.issues).toContainEqual(expect.objectContaining({ code: 'invalid-token-scope' }))
  })

  it('denies players without a controllable visible token or sheet assignment', () => {
    const result = validateModifyHpCommand(createModifyHpCommand(), {
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

  it('validates modifyCombatStages commands for GM and assigned token or sheet controllers', () => {
    const tokenAssigned = validateModifyCombatStagesCommand(createModifyCombatStagesCommand(), {
      assignments: [assignment],
    })

    expect(tokenAssigned.valid).toBe(true)
    if (!tokenAssigned.valid) throw new Error('expected valid combat-stage command')
    expect(tokenAssigned.command.type).toBe(MODIFY_COMBAT_STAGES_COMMAND_TYPE)
    expect(tokenAssigned.payload).toEqual({
      tokenId: 'token-pikachu',
      stages: { atk: 1, def: -1, satk: 0, sdef: 2, spd: 0, acc: -2 },
    })
    expect(tokenAssigned.tokenResource).toEqual(tokenResource)
    expect(tokenAssigned.sheetResource).toEqual(sheetResource)
    expect(tokenAssigned.permission).toMatchObject({ allowed: true, role: 'player' })

    expect(validateModifyCombatStagesCommand(createModifyCombatStagesCommand({ actor: gmActor }), {
      assignments: [],
    }).valid).toBe(true)

    const sheetAssigned = validateModifyCombatStagesCommand(createModifyCombatStagesCommand(), {
      assignments: [sheetAssignment],
    })
    expect(sheetAssigned.valid).toBe(true)
    if (!sheetAssigned.valid) throw new Error('expected sheet-assigned combat-stage command')
    expect(sheetAssigned.permittedResource).toEqual(sheetResource)
  })

  it('reports modifyCombatStages payload, scope, and permission issues', () => {
    const invalidPayload = validateModifyCombatStagesCommand(createModifyCombatStagesCommand({
      payload: {
        tokenId: '',
        stages: { atk: 7, def: -7, satk: 0, sdef: 2.5, spd: 0, acc: '1' },
      } as unknown as ModifyCombatStagesCommand['payload'],
    }), { assignments: [assignment] })

    expect(invalidPayload.valid).toBe(false)
    if (invalidPayload.valid) throw new Error('expected invalid combat-stage payload')
    expect(invalidPayload.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'invalid-token-id',
      'invalid-stages',
    ]))
    expect(isModifyCombatStagesCommandValidationCode('invalid-stages')).toBe(true)

    const invalidScope = validateModifyCombatStagesCommand(createModifyCombatStagesCommand({
      scopes: [createModifyCombatStagesTokenCommandScope({ ...tokenResource, tokenId: 'other-token' })],
    }), { assignments: [assignment] })
    expect(invalidScope.valid).toBe(false)
    if (invalidScope.valid) throw new Error('expected invalid combat-stage scope')
    expect(invalidScope.issues).toContainEqual(expect.objectContaining({ code: 'invalid-token-scope' }))

    const unauthorized = validateModifyCombatStagesCommand(createModifyCombatStagesCommand(), {
      assignments: [],
    })
    expect(unauthorized.valid).toBe(false)
    if (unauthorized.valid) throw new Error('expected unauthorized combat-stage result')
    expect(unauthorized.permission).toMatchObject({
      allowed: false,
      reason: 'missing-player-identity',
    })
    expect(unauthorized.issues).toContainEqual(expect.objectContaining({ code: 'permission-denied' }))
  })
})
