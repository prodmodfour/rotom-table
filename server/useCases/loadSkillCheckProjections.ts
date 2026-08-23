import type { PlayerProfile } from '#shared/playerProfiles'
import type { SkillCheckState } from '#shared/skillChecks/contract'
import { parseSkillCheckRoleProjectionResponse, type SkillCheckRoleProjectionResponseV1 } from '#shared/skillChecks/projections'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildSkillCheckGmProjection, buildSkillCheckSpectatorProjection } from '../domain/skillChecks/roleProjections'
import type { SkillCheckSubjectSheetSnapshot } from '../domain/skillChecks/resolveCheck'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteSkillCheckRepository, type SkillCheckRepository } from '../storage/skillCheckRepository'
import { createSqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { loadSubjectSkillChecksUseCase, SubjectSkillCheckWorkflowError } from './manageSubjectSkillChecks'

export type SkillCheckProjectionAuthority =
  | { readonly kind: 'gm' }
  | { readonly kind: 'subject', readonly profile: PlayerProfile }
  | { readonly kind: 'spectator' }

export interface LoadSkillCheckProjectionsInput {
  readonly authority: SkillCheckProjectionAuthority
  readonly states?: readonly SkillCheckState[]
  readonly limit?: number
}

export interface LoadSkillCheckProjectionDependencies {
  readonly database?: RotomDatabase
  readonly skillCheckRepository?: SkillCheckRepository
  readonly sheetRepository?: Pick<SheetRepository<Record<string, unknown>>, 'get'> & { readonly database?: RotomDatabase }
  readonly now?: () => number
}

const databaseFor = (dependencies: LoadSkillCheckProjectionDependencies): RotomDatabase => {
  const candidates = [dependencies.skillCheckRepository?.database, dependencies.sheetRepository?.database]
    .filter((candidate): candidate is RotomDatabase => Boolean(candidate))
  const database = dependencies.database ?? candidates[0] ?? getRotomDatabase()
  if (candidates.some(candidate => candidate !== database)) {
    throw new SubjectSkillCheckWorkflowError(409, 'repository-mismatch', 'Skill Check projection repositories must share one RotomDatabase.')
  }
  return database
}

const snapshot = (
  subject: { readonly subjectId: string, readonly kind: 'trainer' | 'pokemon', readonly sheetSlug: string },
  sheets: Pick<SheetRepository<Record<string, unknown>>, 'get'>,
): SkillCheckSubjectSheetSnapshot | undefined => {
  const stored = sheets.get(subject.kind, subject.sheetSlug)
  if (!stored) return undefined
  return Object.freeze({
    kind: subject.kind,
    slug: stored.slug,
    revision: stored.revision,
    sheet: stored.document as unknown as CharacterSheet | TrainerSheet,
  })
}

export const loadSkillCheckProjectionsUseCase = (
  input: LoadSkillCheckProjectionsInput,
  dependencies: LoadSkillCheckProjectionDependencies = {},
): SkillCheckRoleProjectionResponseV1 => {
  const database = databaseFor(dependencies)
  const checks = dependencies.skillCheckRepository ?? createSqliteSkillCheckRepository(database)
  const sheets = dependencies.sheetRepository ?? createSqliteSheetRepository<Record<string, unknown>>(database)
  const now = dependencies.now?.() ?? Date.now()
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new SubjectSkillCheckWorkflowError(409, 'state-conflict', 'Skill Check projection time is invalid.')
  }
  if (input.authority.kind === 'subject') {
    const response = loadSubjectSkillChecksUseCase({
      authority: { kind: 'profile', profile: input.authority.profile },
      states: input.states,
      limit: input.limit,
    }, {
      database,
      skillCheckRepository: checks,
      sheetRepository: sheets,
      now: () => now,
    })
    return parseSkillCheckRoleProjectionResponse({
      schemaVersion: 1,
      audience: 'subject',
      checks: response.requests,
      serverNow: response.serverNow,
    })
  }
  const stored = checks.list({ states: input.states, limit: input.limit ?? 500 })
  if (input.authority.kind === 'spectator') {
    return parseSkillCheckRoleProjectionResponse({
      schemaVersion: 1,
      audience: 'spectator',
      checks: stored.map(check => buildSkillCheckSpectatorProjection(check.document)),
      serverNow: now,
    })
  }
  return parseSkillCheckRoleProjectionResponse({
    schemaVersion: 1,
    audience: 'gm',
    checks: stored.map(check => buildSkillCheckGmProjection({
      document: check.document,
      snapshots: new Map(check.document.subjects.flatMap(subject => {
        const subjectSnapshot = snapshot(subject, sheets)
        return subjectSnapshot ? [[subject.subjectId, subjectSnapshot] as const] : []
      })),
    })),
    serverNow: now,
  })
}
