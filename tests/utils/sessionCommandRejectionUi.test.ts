import { describe, expect, it, vi } from 'vitest'
import { SESSION_COMMAND_RESULT_SCHEMA_VERSION } from '#shared/sessionCommandResults'
import { parseOpId } from '#shared/sessionCommands'
import { SESSION_MESSAGE_SCHEMA_VERSION, type SessionCommandRejectMessage } from '#shared/sessionMessages'
import {
  parseClientId,
  parsePlayerId,
  parseSessionDisplayName,
  parseSessionId,
} from '#shared/sessionIdentity'
import { parseSessionRevision } from '#shared/sessionRevisions'
import {
  formatSessionCommandRejectionNotice,
  labelForSessionCommandType,
  runSessionCommandRejectionRefreshAction,
  sanitizeSessionCommandRejectionText,
} from '~/utils/sessionCommandRejectionUi'

const SESSION_ID = parseSessionId('session_rejectui0001')
const CLIENT_ID = parseClientId('client_rejectui01')
const PLAYER_ID = parsePlayerId('player_rejectui01')
const DISPLAY_NAME = parseSessionDisplayName('Leaf')
const OP_ID = parseOpId('op_rejectui000001')
const REVISION_1 = parseSessionRevision(1)
const REVISION_2 = parseSessionRevision(2)

const commandReject = (
  overrides: Partial<SessionCommandRejectMessage['result']> = {},
): SessionCommandRejectMessage => ({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'commandReject',
  direction: 'server',
  sessionId: SESSION_ID,
  result: {
    schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
    status: 'rejected',
    accepted: false,
    reason: 'stale',
    message: 'Token changed after revision 1.\nRefresh first.',
    retryable: true,
    sessionId: SESSION_ID,
    opId: OP_ID,
    commandType: 'moveToken',
    actor: { role: 'gm', clientId: CLIENT_ID },
    currentRevision: REVISION_2,
    scopes: [],
    baseRevision: REVISION_1,
    changedScopes: [],
    currentState: { tokenId: 'token-pikachu', mapSlug: 'arena-map' },
    ...overrides,
  } as SessionCommandRejectMessage['result'],
})

describe('session command rejection UI helpers', () => {
  it('formats stale rejections with refresh and retry guidance', () => {
    const notice = formatSessionCommandRejectionNotice(commandReject())

    expect(notice).toMatchObject({
      opId: OP_ID,
      commandType: 'moveToken',
      commandLabel: 'Move token',
      reason: 'stale',
      reasonLabel: 'Stale session map',
      title: 'Action needs the latest session map',
      currentRevision: REVISION_2,
      baseRevision: REVISION_1,
      retryable: true,
      refreshLabel: 'Refresh session map',
      dismissLabel: 'Dismiss',
      kind: 'stale-session-map',
    })
    expect(notice?.detail).toBe('Token changed after revision 1. Refresh first.')
    expect(notice?.summary).toContain('authoritative session map unchanged')
    expect(notice?.guidance).toContain('Refresh the session map')
    expect(notice?.guidance).toContain('try the action again')
  })

  it('tells the GM when session hosting has no available map state', () => {
    const notice = formatSessionCommandRejectionNotice(commandReject({
      reason: 'conflict',
      message: 'Map arena-map is not available in the authoritative session state.',
      retryable: true,
      conflictingScopes: [{ lane: 'map', mapSlug: 'arena-map' }],
    }))

    expect(notice).toMatchObject({
      kind: 'session-map-unavailable',
      reasonLabel: 'Map unavailable',
      title: 'Select an available session map before sending live session commands',
      detail: 'This command targeted map "arena-map", but the active live session does not have that map available.',
    })
    expect(notice?.summary).toContain('active live session does not have an available copy')
    expect(notice?.guidance).toContain('Verify the map is available')
    expect(notice?.guidance).toContain('refresh the session map')
  })

  it('explains missing selected-map rejections with a select-and-refresh recovery', () => {
    const notice = formatSessionCommandRejectionNotice(commandReject({
      reason: 'conflict',
      message: 'moveToken commands must identify a map or the session must have a selected map.',
      retryable: false,
      conflictingScopes: [],
    }))

    expect(notice).toMatchObject({
      kind: 'missing-session-map',
      reasonLabel: 'No session map',
      title: 'Select a session map before sending commands',
      detail: 'The command did not identify a session map, and the live session has no selected map yet.',
    })
    expect(notice?.guidance).toContain('Select an available session map')
    expect(notice?.guidance).toContain('refresh')
  })

  it('keeps unauthorized token notices player-safe without dumping permission or state objects', () => {
    const notice = formatSessionCommandRejectionNotice(commandReject({
      reason: 'unauthorized',
      message: 'You do not control that token.',
      retryable: false,
      commandType: 'useAbility',
      actor: {
        role: 'player',
        playerId: PLAYER_ID,
        clientId: CLIENT_ID,
        displayName: DISPLAY_NAME,
      },
      permission: {
        allowed: false,
        reason: 'resource-not-assigned',
        message: 'internal permission text should not be expanded',
      },
      resource: { kind: 'token', tokenId: 'token-secret', mapSlug: 'arena-map' },
      currentState: { privateSheetValue: 'do-not-render' },
    }))

    const renderedText = JSON.stringify(notice)
    expect(notice).toMatchObject({
      commandLabel: 'Use ability',
      kind: 'unauthorized-token',
      reasonLabel: 'Token not assigned',
      title: 'This token is not assigned for control',
      detail: 'You do not control that token.',
      retryable: false,
    })
    expect(notice?.guidance).toContain('Ask the GM to assign this token')
    expect(renderedText).not.toContain('do-not-render')
    expect(renderedText).not.toContain('token-secret')
    expect(renderedText).not.toContain('internal permission text')
  })

  it('sanitizes control characters, caps long details, and hides invalid protocol paths', () => {
    const longText = `bad\u0000value ${'x'.repeat(260)}`

    expect(sanitizeSessionCommandRejectionText(longText)).toMatch(/^bad value x+…$/)
    expect(sanitizeSessionCommandRejectionText(longText).length).toBeLessThanOrEqual(220)
    expect(formatSessionCommandRejectionNotice(commandReject({ message: '   \n\t   ' }))?.detail)
      .toBe('Move token used an older session map revision.')

    const invalid = formatSessionCommandRejectionNotice(commandReject({
      reason: 'invalid',
      message: 'payload.secretPath: expected string',
      retryable: false,
      issues: [{ path: 'payload.secretPath', code: 'bad', message: 'expected string' }],
    }))
    expect(invalid?.detail).toBe('Move token was rejected because the request was incomplete or malformed.')
    expect(JSON.stringify(invalid)).not.toContain('secretPath')
  })

  it('runs the rejection-banner refresh callbacks in order', () => {
    const calls: string[] = []
    const resetDismissal = vi.fn(() => calls.push('reset'))
    const refreshSessionSnapshot = vi.fn(() => {
      calls.push('refresh')
      return { ok: true as const, delivery: 'hello-queued' as const }
    })

    const result = runSessionCommandRejectionRefreshAction({
      resetDismissal,
      refreshSessionSnapshot,
    })

    expect(result).toEqual({ ok: true, delivery: 'hello-queued' })
    expect(calls).toEqual(['reset', 'refresh'])
    expect(resetDismissal).toHaveBeenCalledTimes(1)
    expect(refreshSessionSnapshot).toHaveBeenCalledTimes(1)
  })

  it('humanizes unknown command types without exposing raw protocol punctuation', () => {
    expect(labelForSessionCommandType('custom.session-action')).toBe('Custom session action')
  })
})
