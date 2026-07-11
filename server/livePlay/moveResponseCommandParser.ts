import {
  MOVE_RESPONSE_COMMAND_TYPES,
  MoveResponseCommandValidationError,
  parseMoveResponseCommand,
  type MoveResponseCommand,
  type MoveResponseCommandType,
} from '#shared/moveAutomation/responseCommands'
import type {
  PendingMoveResponseOption,
  PendingMoveResponseWindow,
} from '#shared/moveAutomation/pendingResolution'
import {
  sqlitePendingMoveResolutionRepository,
  type PendingMoveResolutionRepository,
  type StoredPendingMoveResolution,
} from '../storage/pendingMoveResolutionRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export type MoveResponseCommandParserErrorCode =
  | 'invalid-command'
  | 'unknown-resolution'
  | 'inactive-resolution'
  | 'duplicate-response'
  | 'map-mismatch'
  | 'unknown-window'
  | 'window-kind-mismatch'
  | 'pass-not-allowed'
  | 'unknown-option'

export class MoveResponseCommandParserError
  extends UseCaseHttpError<400 | 404 | 409> {
  readonly code: MoveResponseCommandParserErrorCode

  constructor(
    statusCode: 400 | 404 | 409,
    code: MoveResponseCommandParserErrorCode,
    message: string,
  ) {
    super(statusCode, message)
    this.name = 'MoveResponseCommandParserError'
    this.code = code
  }
}

export interface MoveResponseCommandParserDependencies {
  readonly pendingResolutionRepository?: Pick<PendingMoveResolutionRepository, 'getById'>
}

export interface ParsedMoveResponseCommand {
  readonly command: MoveResponseCommand
  readonly storedResolution: StoredPendingMoveResolution
  readonly window: PendingMoveResponseWindow | null
  readonly option: PendingMoveResponseOption | null
}

const parserError = (
  statusCode: 400 | 404 | 409,
  code: MoveResponseCommandParserErrorCode,
  message: string,
): never => {
  throw new MoveResponseCommandParserError(statusCode, code, message)
}

export const parseMoveResponseCommandSyntax = (
  value: unknown,
  expectedType?: MoveResponseCommandType,
): MoveResponseCommand => {
  try {
    return parseMoveResponseCommand(value, expectedType)
  }
  catch (error) {
    if (error instanceof MoveResponseCommandValidationError) {
      return parserError(400, 'invalid-command', error.message)
    }
    throw error
  }
}

const commandWindowId = (command: MoveResponseCommand): string | null => (
  'windowId' in command.payload ? command.payload.windowId : null
)

const commandOptionId = (command: MoveResponseCommand): string | null => (
  'optionId' in command.payload ? command.payload.optionId : null
)

const expectedWindowKind = (
  type: MoveResponseCommandType,
): PendingMoveResponseWindow['kind'] | null => {
  if (type === MOVE_RESPONSE_COMMAND_TYPES.CHOOSE) return 'choice'
  if (type === MOVE_RESPONSE_COMMAND_TYPES.REACT) return 'reaction'
  return null
}

const assertUnusedResponseIdentity = (
  command: MoveResponseCommand,
  stored: StoredPendingMoveResolution,
  windowId: string | null,
): void => {
  if (
    command.opId === stored.originOpId
    || stored.resolution.chosenOptions.some(choice => choice.responseOpId === command.opId)
  ) {
    parserError(
      409,
      'duplicate-response',
      'This move response operation ID has already been used by the resolution.',
    )
  }

  if (
    windowId !== null
    && stored.resolution.chosenOptions.some(choice => choice.windowId === windowId)
  ) {
    parserError(
      409,
      'duplicate-response',
      'This move response window has already received a response.',
    )
  }
}

const resolveWindow = (
  command: MoveResponseCommand,
  stored: StoredPendingMoveResolution,
  windowId: string,
): PendingMoveResponseWindow => {
  const window = stored.resolution.outstandingWindows.find(
    candidate => candidate.windowId === windowId,
  )
  if (!window) {
    return parserError(
      400,
      'unknown-window',
      'The referenced move response window is invalid or no longer available.',
    )
  }

  const requiredKind = expectedWindowKind(command.type)
  if (requiredKind !== null && window.kind !== requiredKind) {
    parserError(
      400,
      'window-kind-mismatch',
      `${command.type} cannot answer a ${window.kind} response window.`,
    )
  }

  if (command.type === MOVE_RESPONSE_COMMAND_TYPES.PASS && !window.allowPass) {
    parserError(400, 'pass-not-allowed', 'The referenced move response window does not allow pass.')
  }

  return window
}

const resolveOption = (
  optionId: string | null,
  window: PendingMoveResponseWindow,
): PendingMoveResponseOption | null => {
  if (optionId === null) return null
  const option = window.options.find(candidate => candidate.id === optionId)
  if (!option) {
    return parserError(
      400,
      'unknown-option',
      'The referenced move response option is invalid or no longer available.',
    )
  }
  return option
}

/**
 * Parses client intent and resolves every submitted ID against one current
 * durable pending record. No use-case callback runs until this boundary has
 * rejected malformed, stale, duplicate, or forged references.
 */
export const parsePendingMoveResponseCommand = (
  value: unknown,
  options: MoveResponseCommandParserDependencies & {
    readonly expectedType?: MoveResponseCommandType
  } = {},
): ParsedMoveResponseCommand => {
  const command = parseMoveResponseCommandSyntax(value, options.expectedType)
  const repository = options.pendingResolutionRepository
    ?? sqlitePendingMoveResolutionRepository
  const storedResolution = repository.getById(command.payload.resolutionId)

  if (!storedResolution) {
    return parserError(404, 'unknown-resolution', 'The referenced pending move resolution was not found.')
  }
  if (
    storedResolution.originMapSlug !== command.mapSlug
    || storedResolution.resolution.originMapSlug !== command.mapSlug
  ) {
    return parserError(400, 'map-mismatch', 'The move response does not belong to this map.')
  }
  if (
    storedResolution.status !== 'pending'
    || storedResolution.resolution.status !== 'pending'
  ) {
    return parserError(
      409,
      'inactive-resolution',
      'The referenced move resolution is no longer accepting responses.',
    )
  }

  const windowId = commandWindowId(command)
  assertUnusedResponseIdentity(command, storedResolution, windowId)

  if (command.type === MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL) {
    return Object.freeze({
      command,
      storedResolution,
      window: null,
      option: null,
    })
  }

  if (windowId === null) {
    return parserError(400, 'invalid-command', 'This move response command requires a window ID.')
  }
  const window = resolveWindow(command, storedResolution, windowId)
  const option = resolveOption(commandOptionId(command), window)

  return Object.freeze({ command, storedResolution, window, option })
}
