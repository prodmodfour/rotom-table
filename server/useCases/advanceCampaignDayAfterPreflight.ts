import {
  CAMPAIGN_DAY_PREFLIGHT_ID_RE,
  type CampaignDayPreflightProjectionV1,
} from '../../shared/campaignDayPreflight'
import {
  CampaignDayContractError,
  parseCampaignDayOperationCommandV1,
} from '../../shared/campaignDay'
import {
  campaignDayPreflightId,
  readCampaignDayPreflightAuthority,
  type CampaignDayPreflightAuthoritySnapshot,
} from '../domain/campaignDay/preflightAuthority'
import { campaignDayOperationCommandSha256, createSqliteCampaignDayOperationRepository } from '../storage/campaignDayOperationRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import {
  AdvanceCampaignDayUseCaseError,
  advanceCampaignDayUseCase,
  type AdvanceCampaignDayResult,
} from './advanceCampaignDay'
import { prepareCampaignDayUseCase } from './prepareCampaignDay'

export interface AdvanceCampaignDayAfterPreflightInput {
  readonly command: unknown
  readonly preflightId: unknown
  readonly clientId?: string
}

export interface AdvanceCampaignDayAfterPreflightDependencies {
  readonly database?: RotomDatabase
  readonly now?: () => number
  readonly readAuthority?: (input: {
    readonly database: RotomDatabase
    readonly command: ReturnType<typeof parseCampaignDayOperationCommandV1>
  }) => CampaignDayPreflightAuthoritySnapshot
}

export interface AdvanceCampaignDayAfterPreflightResult {
  readonly result: AdvanceCampaignDayResult
  readonly preflight: CampaignDayPreflightProjectionV1
}

export const advanceCampaignDayAfterPreflightUseCase = (
  input: AdvanceCampaignDayAfterPreflightInput,
  dependencies: AdvanceCampaignDayAfterPreflightDependencies = {},
): AdvanceCampaignDayAfterPreflightResult => {
  let command
  try {
    command = parseCampaignDayOperationCommandV1(input.command)
  }
  catch (error) {
    if (error instanceof CampaignDayContractError) throw new AdvanceCampaignDayUseCaseError(400, error.message)
    throw error
  }
  const database = dependencies.database ?? getRotomDatabase()
  const operationRepository = createSqliteCampaignDayOperationRepository(database)
  const existing = operationRepository.get(command.operationId)
  if (existing) {
    if (existing.commandSha256 !== campaignDayOperationCommandSha256(command)) {
      throw new Error(`Campaign-day operation ${command.operationId} was retried with different command evidence.`)
    }
    return {
      result: advanceCampaignDayUseCase({ command, clientId: input.clientId }, { database, now: dependencies.now }),
      preflight: prepareCampaignDayUseCase({ command }, {
        database,
        now: dependencies.now,
        readAuthority: dependencies.readAuthority,
      }),
    }
  }
  if (typeof input.preflightId !== 'string' || !CAMPAIGN_DAY_PREFLIGHT_ID_RE.test(input.preflightId)) {
    throw new AdvanceCampaignDayUseCaseError(400, 'Campaign day advancement requires one exact reviewed preflight identity.')
  }
  const preflight = prepareCampaignDayUseCase({ command }, {
    database,
    now: dependencies.now,
    readAuthority: dependencies.readAuthority,
  })
  if (preflight.state === 'blocked') {
    throw new AdvanceCampaignDayUseCaseError(409, 'Campaign day preflight still has unresolved blockers.')
  }
  if (preflight.state !== 'ready' || preflight.preflightId !== input.preflightId) {
    throw new AdvanceCampaignDayUseCaseError(409, 'Campaign day preflight changed; review fresh authority before advancing.')
  }
  const result = advanceCampaignDayUseCase({
    command,
    clientId: input.clientId,
    assertPreflightCurrent: () => {
      const current = (dependencies.readAuthority ?? readCampaignDayPreflightAuthority)({ database, command })
      if (campaignDayPreflightId(current.authoritySha256) !== input.preflightId) {
        throw new AdvanceCampaignDayUseCaseError(
          409,
          'Campaign day preflight changed during advancement; review fresh authority before retrying.',
        )
      }
    },
  }, { database, now: dependencies.now })
  return { result, preflight }
}
