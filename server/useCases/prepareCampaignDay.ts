import {
  CAMPAIGN_DAY_PREFLIGHT_AFFECTED_SHEET_LIMIT,
  CAMPAIGN_DAY_PREFLIGHT_SCHEMA_VERSION,
  parseCampaignDayPreflightProjection,
  type CampaignDayPreflightAffectedSheetV1,
  type CampaignDayPreflightBlockerV1,
  type CampaignDayPreflightChangeKind,
  type CampaignDayPreflightImpactV1,
  type CampaignDayPreflightProjectionV1,
} from '../../shared/campaignDayPreflight'
import {
  CAMPAIGN_DAY_MINUTES,
  CampaignDayContractError,
  parseCampaignDayOperationCommandV1,
  projectCampaignNextDayResult,
  type CampaignDayOperationCommandV1,
  type CampaignNextDayResult,
} from '../../shared/campaignDay'
import type { CampaignAttentionReason } from '../../shared/campaignAttention/model'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TrainerSheet } from '../../src/types/trainerSheet'
import { pokemonHpSnapshot, trainerHpSnapshot } from '../../src/utils/sheetSpawn'
import { createSqliteCampaignDayOperationRepository, campaignDayOperationCommandSha256 } from '../storage/campaignDayOperationRepository'
import { getRotomDatabase, type RotomDatabase } from '../storage/database'
import { createSqliteSheetRepository, type StoredSheetDocument } from '../storage/sheetRepository'
import {
  campaignDayPreflightId,
  readCampaignDayPreflightAuthority,
  type CampaignDayPreflightAuthoritySnapshot,
} from '../domain/campaignDay/preflightAuthority'
import { AdvanceCampaignDayUseCaseError, advanceCampaignDayUseCase } from './advanceCampaignDay'

export interface PrepareCampaignDayInput {
  readonly command: unknown
}

export interface PrepareCampaignDayDependencies {
  readonly database?: RotomDatabase
  readonly now?: () => number
  readonly readAuthority?: (input: {
    readonly database: RotomDatabase
    readonly command: CampaignDayOperationCommandV1
  }) => CampaignDayPreflightAuthoritySnapshot
}

const attentionLabels: Readonly<Record<CampaignAttentionReason, string>> = Object.freeze({
  'level-threshold': 'Level review',
  'advancement-review': 'Advancement review',
  'unspent-advancement': 'Unspent advancement',
  'invalid-advancement': 'Advancement repair',
  'move-learning': 'Move decision',
  'ability-choice': 'Ability decision',
  'evolution-choice': 'Evolution decision',
  'form-choice': 'Form decision',
  'post-evolution-review': 'Post-evolution review',
  'trainer-advancement': 'Trainer advancement',
  'capture-review': 'Capture review',
  'team-overflow': 'Team capacity work',
  'hatch-review': 'Hatch review',
  'ownership-review': 'Ownership review',
  'medical-review': 'Medical attention',
  'recovery-review': 'Recovery review',
  'equipment-review': 'Equipment review',
  'skill-check-response': 'Skill Check response',
  'skill-check-resolution': 'Skill Check GM review',
  'continuation-review': 'Campaign follow-up',
})

const changed = (left: unknown, right: unknown): boolean => (
  stableJsonStringify(left ?? null) !== stableJsonStringify(right ?? null)
)
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : []
const object = (value: unknown): Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
)
const conditions = (kind: 'pokemon' | 'trainer', sheet: Record<string, unknown>): readonly unknown[] => (
  kind === 'pokemon' ? array(object(sheet.combat).conditions) : array(sheet.conditions)
)
const hp = (kind: 'pokemon' | 'trainer', sheet: Record<string, unknown>) => kind === 'pokemon'
  ? pokemonHpSnapshot(sheet as unknown as CharacterSheet)
  : trainerHpSnapshot(sheet as unknown as TrainerSheet)

const safeLabel = (kind: 'pokemon' | 'trainer', sheet: Record<string, unknown>): string => {
  const candidates = kind === 'pokemon'
    ? [sheet.nickname, sheet.name, sheet.species]
    : [sheet.name]
  const value = candidates.find(candidate => typeof candidate === 'string'
    && candidate.trim().length > 0 && !/\p{C}/u.test(candidate))
  if (typeof value !== 'string') return kind === 'pokemon' ? 'Pokémon sheet' : 'Trainer sheet'
  return value.trim().slice(0, 120)
}

const affectedSheet = (input: {
  readonly before: StoredSheetDocument<Record<string, unknown>>
  readonly after: StoredSheetDocument<Record<string, unknown>>
}): CampaignDayPreflightAffectedSheetV1 => {
  const kind = input.before.kind
  const before = input.before.document
  const after = input.after.document
  const beforeHp = hp(kind, before)
  const afterHp = hp(kind, after)
  const changes: CampaignDayPreflightChangeKind[] = []
  if (afterHp.currentHp !== beforeHp.currentHp) changes.push('hit-points')
  if (afterHp.injuries !== beforeHp.injuries) changes.push('injury')
  if (changed(conditions(kind, before), conditions(kind, after))) changes.push('conditions')
  if (kind === 'pokemon' && changed(before.moveUsage, after.moveUsage)) changes.push('daily-moves')
  if (kind === 'trainer' && changed(before.ap, after.ap)) changes.push('trainer-ap')
  if (changes.length === 0) changes.push('daily-resources')
  return Object.freeze({
    kind,
    label: safeLabel(kind, before),
    href: kind === 'pokemon'
      ? `/sheets/pokemon/${encodeURIComponent(input.before.slug)}`
      : `/sheets/trainers/${encodeURIComponent(input.before.slug)}`,
    changes: Object.freeze(changes),
  })
}

const impactFromResult = (input: {
  readonly result: CampaignNextDayResult
  readonly affectedSheets: readonly CampaignDayPreflightAffectedSheetV1[]
}): CampaignDayPreflightImpactV1 => {
  const sorted = [...input.affectedSheets].sort((left, right) => (
    left.kind.localeCompare(right.kind) || left.href.localeCompare(right.href)
  ))
  const visible = sorted.slice(0, CAMPAIGN_DAY_PREFLIGHT_AFFECTED_SHEET_LIMIT)
  return Object.freeze({
    totalSheets: input.result.totalSheets,
    affectedSheetCount: input.result.updatedSheets,
    affectedSheets: Object.freeze(visible),
    additionalAffectedSheets: input.result.updatedSheets - visible.length,
    pokemonAffected: input.result.pokemonUpdated,
    trainerAffected: input.result.trainerUpdated,
    hitPointsRestored: input.result.hitPointsRestored,
    injuriesHealed: input.result.injuriesHealed,
    conditionsCleared: input.result.conditionsCleared,
    dailyMoveUsesCleared: input.result.dailyMoveUsesCleared,
    dailyMoveEntriesCleared: input.result.dailyMoveEntriesCleared,
    trainerApRestored: input.result.trainerApRestored,
    reconciledEggs: input.result.campaignClock.reconciledEggs,
    creditedEggCampaignMinutes: input.result.campaignClock.creditedEggCampaignMinutes,
    skippedPausedEggCampaignMinutes: input.result.campaignClock.skippedPausedEggCampaignMinutes,
    expiredEffects: input.result.expiredEffects.length,
  })
}

const blockersFromContinuation = (
  continuation: ReturnType<typeof readCampaignDayPreflightAuthority>['continuation'],
): readonly CampaignDayPreflightBlockerV1[] => {
  const blockers: CampaignDayPreflightBlockerV1[] = []
  if (continuation.activeEncounter) blockers.push({
    kind: 'active-encounter',
    reason: null,
    label: 'Active encounter must be resolved',
    count: 1 + continuation.additionalActiveEncounters,
    href: continuation.activeEncounter.href,
  })
  if (continuation.unfinishedSettlement) blockers.push({
    kind: 'unfinished-settlement',
    reason: null,
    label: 'Encounter settlement must be finished',
    count: 1 + continuation.additionalUnfinishedSettlements,
    href: continuation.unfinishedSettlement.href,
  })
  const byReason = new Map<CampaignAttentionReason, typeof continuation.attention.items>()
  for (const item of continuation.attention.items) {
    if (item.urgency !== 'blocking') continue
    byReason.set(item.reason, Object.freeze([...(byReason.get(item.reason) ?? []), item]))
  }
  for (const reason of [...byReason.keys()].sort()) {
    const items = byReason.get(reason)!
    blockers.push({
      kind: 'attention',
      reason,
      label: attentionLabels[reason],
      count: items.length,
      href: items[0]?.legalActions[0]?.href ?? '/campaign',
    })
  }
  return Object.freeze(blockers)
}

const acceptedProjection = (result: CampaignNextDayResult): CampaignDayPreflightProjectionV1 => {
  const impact = impactFromResult({ result, affectedSheets: [] })
  return parseCampaignDayPreflightProjection({
    schemaVersion: CAMPAIGN_DAY_PREFLIGHT_SCHEMA_VERSION,
    state: 'already-accepted',
    preflightId: null,
    clock: {
      currentCampaignMinute: result.campaignClock.previousCampaignMinute,
      targetCampaignMinute: result.campaignClock.campaignMinute,
      minutesAdvanced: CAMPAIGN_DAY_MINUTES,
    },
    blockers: [],
    impact,
    accepted: { replayed: true, impact },
  })
}

export const prepareCampaignDayUseCase = (
  input: PrepareCampaignDayInput,
  dependencies: PrepareCampaignDayDependencies = {},
): CampaignDayPreflightProjectionV1 => {
  let command: CampaignDayOperationCommandV1
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
    return acceptedProjection(projectCampaignNextDayResult(existing.result, true))
  }

  return database.withTransaction(() => {
    const authority = (dependencies.readAuthority ?? readCampaignDayPreflightAuthority)({ database, command })
    const blockers = blockersFromContinuation(authority.continuation)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const before = [...sheets.list('pokemon'), ...sheets.list('trainer')]
    const beforeByKey = new Map(before.map(row => [`${row.kind}\u0000${row.slug}`, row]))
    const savepoint = 'campaign_day_preflight_dry_run'
    database.connection.exec(`SAVEPOINT ${savepoint}`)
    let result: CampaignNextDayResult
    let affected: CampaignDayPreflightAffectedSheetV1[]
    try {
      result = advanceCampaignDayUseCase({ command }, {
        database,
        now: dependencies.now,
        publishPersistedRealtimeEvent: () => undefined,
        reportAfterCommitPublicationFailure: () => undefined,
      })
      affected = before.flatMap((previous) => {
        const current = sheets.getByRef(previous.kind, previous.slug)
        if (!current || current.revision === previous.revision) return []
        const exactBefore = beforeByKey.get(`${previous.kind}\u0000${previous.slug}`)
        if (!exactBefore) throw new Error('Campaign-day preflight lost its exact before-sheet authority.')
        return [affectedSheet({
          before: exactBefore,
          after: {
            kind: current.kind,
            slug: current.slug,
            document: current.sheet,
            revision: current.revision,
            updatedAt: current.updatedAt,
          },
        })]
      })
      if (affected.length !== result.updatedSheets) {
        throw new Error('Campaign-day preflight affected-sheet rows do not match the exact dry-run result.')
      }
    }
    finally {
      database.connection.exec(`ROLLBACK TO ${savepoint}`)
      database.connection.exec(`RELEASE ${savepoint}`)
    }
    const impact = impactFromResult({ result, affectedSheets: affected })
    return parseCampaignDayPreflightProjection({
      schemaVersion: CAMPAIGN_DAY_PREFLIGHT_SCHEMA_VERSION,
      state: blockers.length > 0 ? 'blocked' : 'ready',
      preflightId: campaignDayPreflightId(authority.authoritySha256),
      clock: {
        currentCampaignMinute: authority.campaignClock.campaignMinute,
        targetCampaignMinute: authority.campaignClock.campaignMinute + CAMPAIGN_DAY_MINUTES,
        minutesAdvanced: CAMPAIGN_DAY_MINUTES,
      },
      blockers,
      impact,
      accepted: null,
    })
  })
}
