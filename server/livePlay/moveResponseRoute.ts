import { defineEventHandler, type EventHandler } from 'h3'
import type { AuthRole } from '#shared/auth'
import type { MoveResponseCommandType } from '#shared/moveAutomation/responseCommands'
import type { PlayerProfile } from '#shared/playerProfiles'
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
import { resolvePlayerProfileForPolicy } from '../policies/playerProfilePolicy'
import type { PendingMoveResponseAuthorizationGrant } from '../policies/pendingMoveResponsePolicy'
import {
  authorizePendingMoveResponseWindow,
  assertPendingMoveResponseProfileBoundary,
  type PendingMoveResponseAccessDependencies,
} from '../useCases/pendingMoveResponseAccess'

export const MOVE_RESPONSE_ROUTE_NOT_IMPLEMENTED_MESSAGE =
  'Durable move response execution is not available until pending-resolution resume orchestration is enabled.' as const

export interface ExecuteParsedMoveResponseInput extends ParsedMoveResponseCommand {
  readonly role: AuthRole
  readonly playerProfile: PlayerProfile | null
  readonly authorization: PendingMoveResponseAuthorizationGrant
}

export type ExecuteParsedMoveResponse = (
  input: ExecuteParsedMoveResponseInput,
) => unknown | Promise<unknown>

export type ReplayMoveResponse = (input: {
  readonly role: AuthRole
  readonly playerProfile: PlayerProfile | null
  readonly command: ReturnType<typeof parseMoveResponseCommandSyntax>
}) => unknown | null | Promise<unknown | null>

export interface CreateMoveResponseRouteOptions {
  readonly expectedType: MoveResponseCommandType
  readonly gmOnly?: boolean
  readonly parserDependencies?: Omit<MoveResponseCommandParserDependencies, 'authorize'>
  readonly accessDependencies?: PendingMoveResponseAccessDependencies
  readonly resolvePlayerProfile?: typeof resolvePlayerProfileForPolicy
  readonly replay?: ReplayMoveResponse
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
    const command = parseMoveResponseCommandSyntax(body, options.expectedType)
    const playerProfile = role === 'player'
      ? (options.resolvePlayerProfile ?? resolvePlayerProfileForPolicy)(command.profileId)
      : null
    assertPendingMoveResponseProfileBoundary({ role, command, playerProfile })
    const replay = await options.replay?.({ role, playerProfile, command })
    if (replay !== null && replay !== undefined) return replay

    let authorization: PendingMoveResponseAuthorizationGrant | null = null
    const parsed = parsePendingMoveResponseCommand(command, {
      ...options.parserDependencies,
      expectedType: options.expectedType,
      authorize: references => {
        authorization = authorizePendingMoveResponseWindow({
          role,
          command: references.command,
          playerProfile,
          storedResolution: references.storedResolution,
          window: references.window,
        }, options.accessDependencies)
      },
    })
    if (!authorization) {
      throw new UseCaseHttpError(403, 'This move response window is not available.')
    }
    if (!options.execute) return unavailableExecution()
    return await options.execute({ role, playerProfile, authorization, ...parsed })
  }
  catch (error) {
    throwUseCaseHttpError(error)
  }
})
