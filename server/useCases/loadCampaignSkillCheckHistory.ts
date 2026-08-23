import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  parseCampaignSkillCheckHistoryResponse,
  type CampaignSkillCheckHistoryEntryV1,
  type CampaignSkillCheckHistoryOutcome,
  type CampaignSkillCheckHistoryResponseV1,
} from '#shared/skillChecks/campaignHistory'
import type { SkillCheckDocumentV1 } from '#shared/skillChecks/contract'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteSkillCheckRepository, type SkillCheckRepository } from '../storage/skillCheckRepository'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export type CampaignSkillCheckHistoryAuthority =
  | { readonly kind: 'gm' }
  | { readonly kind: 'owner', readonly profile: PlayerProfile }

export interface LoadCampaignSkillCheckHistoryInput {
  readonly authority: CampaignSkillCheckHistoryAuthority
  readonly limit?: number
}

export interface LoadCampaignSkillCheckHistoryDependencies {
  readonly database?: RotomDatabase
  readonly skillCheckRepository?: SkillCheckRepository
  readonly now?: () => number
}

export class CampaignSkillCheckHistoryError extends UseCaseHttpError<400 | 409> {
  readonly code: 'invalid-limit' | 'repository-mismatch' | 'invalid-time'
  constructor(statusCode: 400 | 409, code: CampaignSkillCheckHistoryError['code'], message: string) {
    super(statusCode, message)
    this.code = code
  }
}

const fail = (
  statusCode: 400 | 409,
  code: CampaignSkillCheckHistoryError['code'],
  message: string,
): never => { throw new CampaignSkillCheckHistoryError(statusCode, code, message) }

const digest = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')

const resultForOwner = (
  document: SkillCheckDocumentV1,
  profileId: string,
): CampaignSkillCheckHistoryOutcome => {
  if (document.visibility === 'gm-only-results') return 'withheld'
  const ownedSubjectIds = new Set(document.subjects
    .filter(subject => subject.controllerProfileIds.includes(profileId))
    .map(subject => subject.subjectId))
  const outcomes = [...new Set(document.acceptedResults
    .filter(result => ownedSubjectIds.has(result.subjectId))
    .map(result => result.outcome))]
  if (outcomes.length === 1) return outcomes[0]!
  return outcomes.length > 1 ? 'mixed' : 'withheld'
}

export const loadCampaignSkillCheckHistoryUseCase = (
  input: LoadCampaignSkillCheckHistoryInput,
  dependencies: LoadCampaignSkillCheckHistoryDependencies = {},
): CampaignSkillCheckHistoryResponseV1 => {
  const limit = input.limit ?? 20
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    return fail(400, 'invalid-limit', 'Campaign Skill Check history limit must be an integer from 1 through 20.')
  }
  const candidateDatabase = dependencies.skillCheckRepository?.database
  const database = dependencies.database ?? candidateDatabase ?? getRotomDatabase()
  if (candidateDatabase && candidateDatabase !== database) {
    return fail(409, 'repository-mismatch', 'Campaign Skill Check history repositories must share one RotomDatabase.')
  }
  const checks = dependencies.skillCheckRepository ?? createSqliteSkillCheckRepository(database)
  const serverNow = dependencies.now?.() ?? Date.now()
  if (!Number.isSafeInteger(serverNow) || serverNow < 0) {
    return fail(409, 'invalid-time', 'Campaign Skill Check history time is invalid.')
  }
  const ownerProfileId = input.authority.kind === 'owner' ? String(input.authority.profile.id) : null
  const visible = checks.list({ states: ['accepted', 'cancelled', 'timed-out'], limit: 500 })
    .filter(stored => ownerProfileId === null
      || stored.document.subjects.some(subject => subject.controllerProfileIds.includes(ownerProfileId)))
    .slice(0, limit)
  const entries: CampaignSkillCheckHistoryEntryV1[] = visible.map((stored) => {
    const document = stored.document
    if (document.terminalAt === null) {
      return fail(409, 'invalid-time', 'Terminal Skill Check history is missing terminal time authority.')
    }
    return Object.freeze({
      entryId: `campaign-skill-check-history:v1:${digest({
        checkId: document.checkId,
        createdAt: document.createdAt,
      })}` as const,
      publicLabel: document.publicLabel,
      state: document.state as CampaignSkillCheckHistoryEntryV1['state'],
      outcome: document.state !== 'accepted'
        ? null
        : ownerProfileId === null
          ? 'resolved'
          : resultForOwner(document, ownerProfileId),
      terminalAt: document.terminalAt,
    })
  })
  return parseCampaignSkillCheckHistoryResponse({
    schemaVersion: 1,
    projection: 'campaign-skill-check-history',
    audience: input.authority.kind === 'gm' ? 'gm' : 'owner',
    entries,
    serverNow,
  })
}
