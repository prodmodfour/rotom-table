import { createHash } from 'node:crypto'
import { stableJsonStringify } from '../../../shared/automation/stableJson'
import type { CampaignDayOperationCommandV1 } from '../../../shared/campaignDay'
import type { CampaignClockV1 } from '../../../shared/campaignClock'
import { campaignDayOperationCommandSha256 } from '../../storage/campaignDayOperationRepository'
import type { RotomDatabase } from '../../storage/database'
import { createSqliteMapInteractionModeRepository } from '../../storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '../../storage/mapRepository'
import { createSqliteSheetRepository } from '../../storage/sheetRepository'
import { createSqliteCampaignClockRepository } from '../../storage/campaignClockRepository'
import { loadCampaignContinuationUseCase } from '../../useCases/loadCampaignContinuation'

export const CAMPAIGN_DAY_PREFLIGHT_AUTHORITY_LIMIT = 10_000

interface EggAuthorityRow {
  readonly egg_id: unknown
  readonly revision: unknown
  readonly status: unknown
  readonly updated_at_campaign_minute: unknown
  readonly last_operation_id: unknown
}

const sha256 = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const bounded = (count: number, label: string): void => {
  if (!Number.isSafeInteger(count) || count < 0 || count > CAMPAIGN_DAY_PREFLIGHT_AUTHORITY_LIMIT) {
    throw new Error(`Campaign-day preflight ${label} must be complete and bounded to ${CAMPAIGN_DAY_PREFLIGHT_AUTHORITY_LIMIT} records.`)
  }
}

export interface CampaignDayPreflightAuthoritySnapshot {
  readonly authoritySha256: string
  readonly continuation: ReturnType<typeof loadCampaignContinuationUseCase>
  readonly campaignClock: CampaignClockV1
}

export const readCampaignDayPreflightAuthority = (input: {
  readonly database: RotomDatabase
  readonly command: CampaignDayOperationCommandV1
}): CampaignDayPreflightAuthoritySnapshot => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(input.database)
  const maps = createSqliteMapRepository(input.database)
  const modes = createSqliteMapInteractionModeRepository(input.database)
  const pokemon = [...sheets.list('pokemon')]
  const trainers = [...sheets.list('trainer')]
  const mapRows = [...maps.list()]
  bounded(pokemon.length + trainers.length, 'sheet read')
  bounded(mapRows.length, 'map read')

  const eggCountRow = input.database.connection.prepare(
    'SELECT COUNT(*) AS count FROM pokemon_eggs',
  ).get() as { readonly count?: unknown } | undefined
  if (!Number.isSafeInteger(eggCountRow?.count)) throw new Error('Campaign-day preflight lost its complete Egg count.')
  const eggCount = Number(eggCountRow!.count)
  bounded(eggCount, 'Egg read')
  const eggs = input.database.connection.prepare(`
    SELECT egg_id, revision, status, updated_at_campaign_minute, last_operation_id
      FROM pokemon_eggs
     ORDER BY egg_id ASC
     LIMIT ?
  `).all(CAMPAIGN_DAY_PREFLIGHT_AUTHORITY_LIMIT + 1) as unknown as EggAuthorityRow[]
  if (eggs.length !== eggCount) throw new Error('Campaign-day preflight lost its complete Egg identity read.')

  const continuation = loadCampaignContinuationUseCase({ role: 'gm' }, { database: input.database })
  const campaignClock = createSqliteCampaignClockRepository(input.database).get()
  const materials = {
    schemaVersion: 1,
    commandSha256: campaignDayOperationCommandSha256(input.command),
    campaignClock,
    continuationSnapshotId: continuation.snapshotId,
    sheets: [...pokemon.map(row => ({ kind: 'pokemon' as const, row })), ...trainers.map(row => ({ kind: 'trainer' as const, row }))]
      .map(({ kind, row }) => ({
        kind,
        slug: row.slug,
        revision: row.revision,
        updatedAt: row.updatedAt,
        documentSha256: sha256(row.document),
      }))
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.slug.localeCompare(right.slug)),
    maps: mapRows.map(row => ({
      slug: row.slug,
      revision: row.revision,
      updatedAt: row.updatedAt,
      documentSha256: sha256(row.document),
      interactionMode: modes.get(row.slug),
    })).sort((left, right) => left.slug.localeCompare(right.slug)),
    eggs: eggs.map((row) => {
      if (typeof row.egg_id !== 'string' || !Number.isSafeInteger(row.revision)
        || typeof row.status !== 'string' || !Number.isSafeInteger(row.updated_at_campaign_minute)
        || (row.last_operation_id !== null && typeof row.last_operation_id !== 'string')) {
        throw new Error('Campaign-day preflight encountered malformed Egg authority columns.')
      }
      return {
        eggId: row.egg_id,
        revision: row.revision,
        status: row.status,
        updatedAtCampaignMinute: row.updated_at_campaign_minute,
        lastOperationId: row.last_operation_id,
      }
    }),
  }
  return Object.freeze({
    authoritySha256: sha256(materials),
    continuation,
    campaignClock,
  })
}

export const campaignDayPreflightId = (authoritySha256: string): string => {
  if (!/^[a-f0-9]{64}$/.test(authoritySha256)) throw new Error('Campaign-day preflight authority hash is malformed.')
  return `campaign-day-preflight:v1:${authoritySha256}`
}
