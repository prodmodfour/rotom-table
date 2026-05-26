import { describe, expect, it } from 'vitest'
import { SESSION_COMMAND_RESULT_SCHEMA_VERSION } from '#shared/sessionCommandResults'
import { parseOpId } from '#shared/sessionCommands'
import { SESSION_MESSAGE_SCHEMA_VERSION, type SessionCommandRejectMessage } from '#shared/sessionMessages'
import { parseClientId, parseSessionId } from '#shared/sessionIdentity'
import { parseSessionRevision } from '#shared/sessionRevisions'
import {
  formatSessionCommandRejectionNotice,
  labelForSessionCommandType,
  sanitizeSessionCommandRejectionText,
} from '~/utils/sessionCommandRejectionUi'

const SESSION_ID = parseSessionId('session_rejectui0001')
const CLIENT_ID = parseClientId('client_rejectui01')
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
    })
    expect(notice?.detail).toBe('Token changed after revision 1. Refresh first.')
    expect(notice?.summary).toContain('authoritative session map unchanged')
    expect(notice?.guidance).toContain('Refresh the session map')
    expect(notice?.guidance).toContain('try the action again')
  })

  it('keeps unauthorized notices player-safe without dumping permission or state objects', () => {
    const notice = formatSessionCommandRejectionNotice(commandReject({
      reason: 'unauthorized',
      message: 'You do not control that token.',
      retryable: false,
      commandType: 'useAbility',
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
      reasonLabel: 'Not allowed',
      title: 'Action not allowed in this session',
      detail: 'You do not control that token.',
      retryable: false,
    })
    expect(notice?.guidance).toContain('Ask the GM to assign')
    expect(renderedText).not.toContain('do-not-render')
    expect(renderedText).not.toContain('token-secret')
    expect(renderedText).not.toContain('internal permission text')
  })

  it('sanitizes control characters, caps long details, and hides invalid protocol paths', () => {
    const longText = `bad\u0000value ${'x'.repeat(260)}`

    expect(sanitizeSessionCommandRejectionText(longText)).toMatch(/^bad value x+…$/)
    expect(sanitizeSessionCommandRejectionText(longText).length).toBeLessThanOrEqual(220)
    expect(formatSessionCommandRejectionNotice(commandReject({ message: '   \n\t   ' }))?.detail)
      .toBe('Move token was rejected by session hosting.')

    const invalid = formatSessionCommandRejectionNotice(commandReject({
      reason: 'invalid',
      message: 'payload.secretPath: expected string',
      retryable: false,
      issues: [{ path: 'payload.secretPath', code: 'bad', message: 'expected string' }],
    }))
    expect(invalid?.detail).toBe('Move token was rejected because the request was incomplete or malformed.')
    expect(JSON.stringify(invalid)).not.toContain('secretPath')
  })

  it('humanizes unknown command types without exposing raw protocol punctuation', () => {
    expect(labelForSessionCommandType('custom.session-action')).toBe('Custom session action')
  })
})
