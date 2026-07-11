import { defineEventHandler, type EventHandler } from 'h3'
import type { AuthRole } from '#shared/auth'
import type { MoveResponseCommandType } from '#shared/moveAutomation/responseCommands'
import {
  parseMoveResponseCommandSyntax,
  parsePendingMoveResponseCommand,
  type MoveResponseCommandParserDependencies,
  type ParsedMoveResponseCommand,
} from './moveResponseCommandParser'
import { requireAuthRole, requireGm } from '../utils/auth'
import { readObjectBody, requireWritableCampaignMode } from '../utils/http'
import { throwUseCaseHttpError } from '../utils/useCaseHttp'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export const MOVE_RESPONSE_ROUTE_NOT_IMPLEMENTED_MESSAGE =
  'Durable move response execution is not available until pending-resolution resume orchestration is enabled.' as const

export interface ExecuteParsedMoveResponseInput extends ParsedMoveResponseCommand {
  readonly role: AuthRole
}

export type ExecuteParsedMoveResponse = (
  input: ExecuteParsedMoveResponseInput,
) => unknown | Promise<unknown>

export interface CreateMoveResponseRouteOptions {
  readonly expectedType: MoveResponseCommandType
  readonly gmOnly?: boolean
  readonly parserDependencies?: MoveResponseCommandParserDependencies
  readonly execute?: ExecuteParsedMoveResponse
}

const unavailableExecution = (): never => {
  throw new UseCaseHttpError(501, MOVE_RESPONSE_ROUTE_NOT_IMPLEMENTED_MESSAGE)
}

/** Thin route boundary shared by each response verb. */
export const createMoveResponseRoute = (
  options: CreateMoveResponseRouteOptions,
): EventHandler => defineEventHandler(async (event) => {
  const role = options.gmOnly ? requireGm(event) : requireAuthRole(event)
  requireWritableCampaignMode()
  const body = await readObjectBody<Record<string, unknown>>(event)

  try {
    if (!options.execute) {
      parseMoveResponseCommandSyntax(body, options.expectedType)
      return unavailableExecution()
    }

    const parsed = parsePendingMoveResponseCommand(body, {
      ...options.parserDependencies,
      expectedType: options.expectedType,
    })
    return await options.execute({ role, ...parsed })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
