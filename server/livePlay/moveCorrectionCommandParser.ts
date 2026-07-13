import {
  MoveCorrectionCommandValidationError,
  parseGmMoveCorrectionCommand,
  type GmMoveCorrectionCommand,
} from '#shared/moveAutomation/correctionCommands'
import type { AcceptedMoveAvailableCompensationOperation } from '../domain/moveAutomation/acceptedMoveCompensation'
import {
  sqliteLivePlayOpRepository,
  type LivePlayOpRepository,
  type SqliteLivePlayOpRecord,
} from '../storage/opRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export type MoveCorrectionCommandParserErrorCode =
  | 'invalid-command'
  | 'unknown-origin'
  | 'origin-not-accepted'
  | 'origin-not-correctable'
  | 'unknown-operation'
  | 'unavailable-operation'

export class MoveCorrectionCommandParserError extends UseCaseHttpError<400 | 404 | 409> {
  readonly code: MoveCorrectionCommandParserErrorCode

  constructor(
    statusCode: 400 | 404 | 409,
    code: MoveCorrectionCommandParserErrorCode,
    message: string,
  ) {
    super(statusCode, message)
    this.name = 'MoveCorrectionCommandParserError'
    this.code = code
  }
}

export interface ParsedMoveCorrectionCommand {
  readonly command: GmMoveCorrectionCommand
  readonly origin: SqliteLivePlayOpRecord
  /** Canonical source-record order, never client array order. */
  readonly operations: readonly AcceptedMoveAvailableCompensationOperation[]
}

export interface MoveCorrectionCommandParserDependencies {
  readonly opRepository?: Pick<LivePlayOpRepository, 'getStoredOpRecord'>
}

const parserError = (
  statusCode: 400 | 404 | 409,
  code: MoveCorrectionCommandParserErrorCode,
  message: string,
): never => {
  throw new MoveCorrectionCommandParserError(statusCode, code, message)
}

export const parseMoveCorrectionCommandSyntax = (
  value: unknown,
): GmMoveCorrectionCommand => {
  try {
    return parseGmMoveCorrectionCommand(value)
  }
  catch (error) {
    if (error instanceof MoveCorrectionCommandValidationError) {
      return parserError(400, 'invalid-command', error.message)
    }
    throw error
  }
}

/**
 * Resolve selected IDs only against the private accepted-operation record.
 * No submitted inverse value, scope, revision, or mechanics field crosses this
 * boundary.
 */
export const parseMoveCorrectionCommand = (
  value: unknown,
  dependencies: MoveCorrectionCommandParserDependencies = {},
): ParsedMoveCorrectionCommand => {
  const command = parseMoveCorrectionCommandSyntax(value)
  const repository = dependencies.opRepository ?? sqliteLivePlayOpRepository
  const origin = repository.getStoredOpRecord(
    command.mapSlug,
    command.payload.originOperationId,
  )
  if (!origin) {
    return parserError(404, 'unknown-origin', 'The referenced accepted move operation was not found.')
  }
  if (!origin.result.ok) {
    return parserError(409, 'origin-not-accepted', 'Only an accepted move operation can be corrected.')
  }
  if (!origin.moveCompensation) {
    return parserError(
      409,
      'origin-not-correctable',
      'The accepted move has no reviewed correction metadata.',
    )
  }

  const requested = new Set(command.payload.operationIds)
  const byId = new Map(origin.moveCompensation.operations.map(operation => [
    operation.operationId,
    operation,
  ]))
  for (const operationId of command.payload.operationIds) {
    const operation = byId.get(operationId)
    if (!operation) {
      return parserError(
        400,
        'unknown-operation',
        `Correction operation ${operationId} is not part of the accepted move.`,
      )
    }
    if (operation.availability !== 'available') {
      return parserError(
        409,
        'unavailable-operation',
        `Correction operation ${operationId} is not safely reversible.`,
      )
    }
  }

  const operations = origin.moveCompensation.operations.filter(
    (operation): operation is AcceptedMoveAvailableCompensationOperation => (
      requested.has(operation.operationId) && operation.availability === 'available'
    ),
  )
  if (operations.length !== requested.size) {
    return parserError(400, 'unknown-operation', 'One or more correction operations could not be resolved.')
  }

  return Object.freeze({
    command,
    origin,
    operations: Object.freeze([...operations]),
  })
}
