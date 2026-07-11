import { describe, expect, it, vi } from 'vitest'
import {
  MOVE_RESPONSE_COMMAND_LIMITS,
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type MoveResponseCommandType,
} from '#shared/moveAutomation/responseCommands'
import {
  parsePendingMoveResolution,
  type PendingMoveResolution,
} from '#shared/moveAutomation/pendingResolution'
import {
  MoveResponseCommandParserError,
  parsePendingMoveResponseCommand,
} from '~~/server/livePlay/moveResponseCommandParser'
import type {
  PendingMoveResolutionRepository,
  StoredPendingMoveResolution,
} from '~~/server/storage/pendingMoveResolutionRepository'
import {
  createPendingMoveResolutionFixture,
  createTerminalMoveResolutionFixture,
} from '../fixtures/moveAutomation/pendingResolution'

const responseCommand = (
  type: MoveResponseCommandType = MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: 'op_response0001',
  mapSlug: 'pending-arena',
  baseRevision: 12,
  type,
  payload: type === MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL
    ? { resolutionId: 'resolution-pending-1' }
    : type === MOVE_RESPONSE_COMMAND_TYPES.PASS
      || type === MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE
      ? { resolutionId: 'resolution-pending-1', windowId: 'window.branch' }
      : {
          resolutionId: 'resolution-pending-1',
          windowId: 'window.branch',
          optionId: 'option.attack',
        },
  ...overrides,
})

const storedResolution = (
  resolution: PendingMoveResolution,
): StoredPendingMoveResolution => ({
  schemaVersion: 1,
  resolutionId: resolution.resolutionId,
  originMapSlug: resolution.originMapSlug,
  originOpId: resolution.originOpId,
  status: resolution.status,
  resolution,
  revision: 0,
  createdAt: resolution.createdAt,
  updatedAt: resolution.updatedAt,
  terminalOpId: null,
})

const repositoryFor = (
  ...resolutions: readonly PendingMoveResolution[]
): Pick<PendingMoveResolutionRepository, 'getById'> => {
  const records = new Map(resolutions.map(resolution => [
    resolution.resolutionId,
    storedResolution(resolution),
  ]))
  return { getById: vi.fn(id => records.get(id) ?? null) }
}

const reactionResolution = (): PendingMoveResolution => {
  const source = createPendingMoveResolutionFixture()
  return parsePendingMoveResolution({
    ...source,
    trace: {
      ...source.trace,
      events: source.trace.events.map((event) => {
        if (event.kind === 'operation') {
          return { ...event, operationKind: 'reaction-request' }
        }
        if (event.kind === 'choice') {
          return { ...event, requestKind: 'reaction' }
        }
        return event
      }),
    },
    outstandingWindows: source.outstandingWindows.map(window => ({
      ...window,
      kind: 'reaction',
      priority: 5,
    })),
  })
}

const withoutPass = (): PendingMoveResolution => {
  const source = createPendingMoveResolutionFixture()
  return parsePendingMoveResolution({
    ...source,
    outstandingWindows: source.outstandingWindows.map(window => ({
      ...window,
      allowPass: false,
    })),
  })
}

const expectParserError = (
  callback: () => unknown,
  code: MoveResponseCommandParserError['code'],
): void => {
  try {
    callback()
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveResponseCommandParserError)
    expect(error).toMatchObject({ code })
    return
  }
  throw new Error(`Expected move response parser error ${code}`)
}

describe('pending move response command parser', () => {
  it('resolves choose, react, and pass references against durable server windows', () => {
    const choice = createPendingMoveResolutionFixture()
    const reaction = reactionResolution()

    const parsedChoice = parsePendingMoveResponseCommand(responseCommand(), {
      pendingResolutionRepository: repositoryFor(choice),
      expectedType: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
    })
    const parsedReaction = parsePendingMoveResponseCommand(
      responseCommand(MOVE_RESPONSE_COMMAND_TYPES.REACT),
      {
        pendingResolutionRepository: repositoryFor(reaction),
        expectedType: MOVE_RESPONSE_COMMAND_TYPES.REACT,
      },
    )
    const parsedPass = parsePendingMoveResponseCommand(
      responseCommand(MOVE_RESPONSE_COMMAND_TYPES.PASS),
      {
        pendingResolutionRepository: repositoryFor(choice),
        expectedType: MOVE_RESPONSE_COMMAND_TYPES.PASS,
      },
    )

    expect(parsedChoice).toMatchObject({
      command: { type: 'choose' },
      window: { windowId: 'window.branch', kind: 'choice' },
      option: { id: 'option.attack' },
    })
    expect(parsedReaction).toMatchObject({
      command: { type: 'react' },
      window: { kind: 'reaction', priority: 5 },
      option: { id: 'option.attack' },
    })
    expect(parsedPass).toMatchObject({
      command: { type: 'pass' },
      window: { allowPass: true },
      option: null,
    })
  })

  it('parses GM cancel and force-resolve without client mechanics', () => {
    const pending = createPendingMoveResolutionFixture()
    const repository = repositoryFor(pending)

    const cancel = parsePendingMoveResponseCommand(
      responseCommand(MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL),
      { pendingResolutionRepository: repository },
    )
    const force = parsePendingMoveResponseCommand(
      responseCommand(MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE),
      { pendingResolutionRepository: repository },
    )

    expect(cancel).toMatchObject({ command: { type: 'gm-cancel' }, window: null, option: null })
    expect(force).toMatchObject({
      command: { type: 'gm-force-resolve' },
      window: { windowId: 'window.branch' },
      option: null,
    })
  })

  it('rejects unknown and terminal or expired resolutions', () => {
    expectParserError(() => parsePendingMoveResponseCommand(responseCommand(), {
      pendingResolutionRepository: repositoryFor(),
    }), 'unknown-resolution')

    const expired = createTerminalMoveResolutionFixture({
      status: 'expired',
      updatedAt: 1_100,
    })
    expectParserError(() => parsePendingMoveResponseCommand(responseCommand(), {
      pendingResolutionRepository: repositoryFor(expired),
    }), 'inactive-resolution')
  })

  it('rejects duplicate response operation and window identities', () => {
    const source = createPendingMoveResolutionFixture()
    const duplicateOp = {
      ...source,
      chosenOptions: [{
        windowId: 'window.previous',
        responseOpId: 'op_response0001',
        optionId: null,
        chosenBy: { kind: 'gm', id: null },
        chosenAt: 999,
      }],
    } as unknown as PendingMoveResolution
    const duplicateWindow = {
      ...source,
      chosenOptions: [{
        windowId: 'window.branch',
        responseOpId: 'op_previous001',
        optionId: 'option.attack',
        chosenBy: { kind: 'actor', id: null },
        chosenAt: 999,
      }],
    } as unknown as PendingMoveResolution

    expectParserError(() => parsePendingMoveResponseCommand(responseCommand(), {
      pendingResolutionRepository: repositoryFor(duplicateOp),
    }), 'duplicate-response')
    expectParserError(() => parsePendingMoveResponseCommand(responseCommand(), {
      pendingResolutionRepository: repositoryFor(duplicateWindow),
    }), 'duplicate-response')
  })

  it('rejects forged window and option IDs before a use case can run', () => {
    const pending = createPendingMoveResolutionFixture()
    const forgedWindow = responseCommand()
    forgedWindow.payload = {
      resolutionId: pending.resolutionId,
      windowId: 'window.forged',
      optionId: 'option.attack',
    }
    const forgedOption = responseCommand()
    forgedOption.payload = {
      resolutionId: pending.resolutionId,
      windowId: 'window.branch',
      optionId: 'option.forged',
    }

    expectParserError(() => parsePendingMoveResponseCommand(forgedWindow, {
      pendingResolutionRepository: repositoryFor(pending),
    }), 'unknown-window')
    expectParserError(() => parsePendingMoveResponseCommand(forgedOption, {
      pendingResolutionRepository: repositoryFor(pending),
    }), 'unknown-option')
  })

  it('rejects wrong window kinds, forbidden passes, and cross-map references', () => {
    const choice = createPendingMoveResolutionFixture()

    expectParserError(() => parsePendingMoveResponseCommand(
      responseCommand(MOVE_RESPONSE_COMMAND_TYPES.REACT),
      { pendingResolutionRepository: repositoryFor(choice) },
    ), 'window-kind-mismatch')
    expectParserError(() => parsePendingMoveResponseCommand(
      responseCommand(MOVE_RESPONSE_COMMAND_TYPES.PASS),
      { pendingResolutionRepository: repositoryFor(withoutPass()) },
    ), 'pass-not-allowed')
    expectParserError(() => parsePendingMoveResponseCommand(
      responseCommand(MOVE_RESPONSE_COMMAND_TYPES.CHOOSE, { mapSlug: 'other-arena' }),
      { pendingResolutionRepository: repositoryFor(choice) },
    ), 'map-mismatch')
  })

  it('rejects wrong route types and oversized IDs before repository access', () => {
    const pending = createPendingMoveResolutionFixture()
    const repository = repositoryFor(pending)
    const oversized = responseCommand()
    oversized.payload = {
      ...(oversized.payload as Record<string, unknown>),
      optionId: 'o'.repeat(MOVE_RESPONSE_COMMAND_LIMITS.optionIdChars + 1),
    }

    expectParserError(() => parsePendingMoveResponseCommand(
      responseCommand(MOVE_RESPONSE_COMMAND_TYPES.CHOOSE),
      {
        pendingResolutionRepository: repository,
        expectedType: MOVE_RESPONSE_COMMAND_TYPES.REACT,
      },
    ), 'invalid-command')
    expectParserError(() => parsePendingMoveResponseCommand(oversized, {
      pendingResolutionRepository: repository,
    }), 'invalid-command')
    expect(repository.getById).not.toHaveBeenCalled()
  })
})
