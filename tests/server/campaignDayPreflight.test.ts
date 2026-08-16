import { afterEach, describe, expect, it } from 'vitest'
import type { CampaignContinuationProjectionV1 } from '../../shared/campaignContinuation'
import { parseCampaignDayOperationCommandV1 } from '../../shared/campaignDay'
import type { CampaignDayPreflightAuthoritySnapshot } from '../../server/domain/campaignDay/preflightAuthority'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { createSqliteCampaignDayOperationRepository } from '../../server/storage/campaignDayOperationRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { prepareCampaignDayUseCase } from '../../server/useCases/prepareCampaignDay'
import { advanceCampaignDayAfterPreflightUseCase } from '../../server/useCases/advanceCampaignDayAfterPreflight'

const databases: RotomDatabase[] = []
const database = (): RotomDatabase => {
  const value = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(value)
  return value
}
afterEach(() => { for (const value of databases.splice(0)) value.close() })

const command = (hex = 'a') => parseCampaignDayOperationCommandV1({
  schemaVersion: 1,
  operationId: `campaign-day:v1:${hex.repeat(32)}`,
  kind: 'advance-one-day',
  days: 1,
})

const continuation = (overrides: Partial<CampaignContinuationProjectionV1> = {}): CampaignContinuationProjectionV1 => ({
  schemaVersion: 1,
  snapshotId: `campaign-continuation-snapshot:v1:${'c'.repeat(64)}`,
  attention: {
    schemaVersion: 1,
    snapshotId: `campaign-attention-snapshot:v1:${'d'.repeat(64)}`,
    scope: 'gm', campaignMinute: 0, items: [],
    summary: { total: 0, blocking: 0, urgent: 0, normal: 0, informational: 0 },
  },
  activeEncounter: null,
  additionalActiveEncounters: 0,
  unfinishedSettlement: null,
  additionalUnfinishedSettlements: 0,
  eggs: { active: 0, incubating: 0, ready: 0, needsAdjudication: 0, hatching: 0, href: '/breeding' },
  ...overrides,
})

const authority = (
  db: RotomDatabase,
  fingerprint = 'a',
  projected = continuation(),
): CampaignDayPreflightAuthoritySnapshot => ({
  authoritySha256: fingerprint.repeat(64),
  continuation: projected,
  campaignClock: createSqliteCampaignClockRepository(db).get(),
})

const seedRecoverablePokemon = (db: RotomDatabase): void => {
  createSqliteSheetRepository<Record<string, unknown>>(db).saveSetupSheet('pokemon', 'sparky', {
    slug: 'sparky', nickname: 'Sparky', species: '', level: 5,
    combat: { currentHp: 1, injuries: 1, conditions: ['Burned'] },
    moveUsage: { daily: { spark: { moveName: 'Spark', uses: 1 } } },
    revision: 1,
  })
}

describe('campaign-day preflight and guarded advancement', () => {
  it('dry-runs exact campaign-day mechanics without persisting sheets, clock, operations, or realtime rows', () => {
    const db = database()
    seedRecoverablePokemon(db)
    const before = createSqliteSheetRepository<Record<string, unknown>>(db).getByRef('pokemon', 'sparky')
    const prepared = prepareCampaignDayUseCase({ command: command() }, {
      database: db, now: () => 500,
      readAuthority: () => authority(db),
    })
    expect(prepared).toMatchObject({
      state: 'ready',
      clock: { currentCampaignMinute: 0, targetCampaignMinute: 1440 },
      impact: {
        totalSheets: 1, affectedSheetCount: 1, pokemonAffected: 1,
        injuriesHealed: 1, conditionsCleared: 1, dailyMoveEntriesCleared: 1,
      },
    })
    expect(prepared.impact.affectedSheets).toEqual([{
      kind: 'pokemon', label: 'Sparky', href: '/sheets/pokemon/sparky',
      changes: ['hit-points', 'injury', 'conditions', 'daily-moves'],
    }])
    expect(createSqliteSheetRepository<Record<string, unknown>>(db).getByRef('pokemon', 'sparky')).toEqual(before)
    expect(createSqliteCampaignClockRepository(db).get()).toMatchObject({ revision: 0, campaignMinute: 0 })
    expect(createSqliteCampaignDayOperationRepository(db).get(command().operationId)).toBeNull()
    expect((db.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as { count: number }).count).toBe(0)
  })

  it('projects active encounters, settlements, and grouped blocking attention without private identities', () => {
    const db = database()
    const blockingItem = {
      schemaVersion: 1,
      itemId: 'campaign-attention:v1:private', reason: 'team-overflow', audience: 'owner', urgency: 'blocking',
      entity: { kind: 'trainer-sheet', id: 'private-trainer' },
      sourceEvent: { kind: 'sheet-authority', eventId: 'private-event', campaignMinute: 0 },
      authority: { kind: 'sheet', id: 'private-trainer', revision: 1 },
      requiredDecision: null,
      legalActions: [{
        actionId: 'private-action', intent: 'review-team', href: '/sheets/trainers/mira',
        authority: { kind: 'sheet', id: 'private-trainer', revision: 1 }, requiresConfirmation: false,
      }],
      resolution: { state: 'open', revision: 0, code: null, resolutionEventId: null, resolvedAtCampaignMinute: null },
      createdAtCampaignMinute: 0,
    } as const
    const projected = continuation({
      activeEncounter: { label: 'Harbor duel', state: 'active', round: 2, participantCount: 4, href: '/play/harbor' },
      unfinishedSettlement: { label: 'Old lighthouse', state: 'needs-review', openWorkCount: 2, href: '/play/lighthouse' },
      attention: {
        ...continuation().attention,
        items: [blockingItem],
        summary: { total: 1, blocking: 1, urgent: 0, normal: 0, informational: 0 },
      },
    })
    const prepared = prepareCampaignDayUseCase({ command: command() }, {
      database: db, readAuthority: () => authority(db, 'b', projected),
    })
    expect(prepared.state).toBe('blocked')
    expect(prepared.blockers).toEqual([
      { kind: 'active-encounter', reason: null, label: 'Active encounter must be resolved', count: 1, href: '/play/harbor' },
      { kind: 'unfinished-settlement', reason: null, label: 'Encounter settlement must be finished', count: 1, href: '/play/lighthouse' },
      { kind: 'attention', reason: 'team-overflow', label: 'Team capacity work', count: 1, href: '/sheets/trainers/mira' },
    ])
    expect(JSON.stringify(prepared)).not.toContain('private-trainer')
    expect(JSON.stringify(prepared)).not.toContain('private-event')
    expect(JSON.stringify(prepared)).not.toContain('private-action')
  })

  it('commits only the exact ready preflight and rejects stale authority before any write', () => {
    const readyDb = database()
    seedRecoverablePokemon(readyDb)
    const readyAuthority = () => authority(readyDb, 'e')
    const prepared = prepareCampaignDayUseCase({ command: command('b') }, {
      database: readyDb, now: () => 500, readAuthority: readyAuthority,
    })
    const accepted = advanceCampaignDayAfterPreflightUseCase({
      command: command('b'), preflightId: prepared.preflightId, clientId: 'gm-client',
    }, { database: readyDb, now: () => 500, readAuthority: readyAuthority })
    expect(accepted.result).toMatchObject({ replayed: false, updatedSheets: 1, injuriesHealed: 1 })
    expect(createSqliteCampaignClockRepository(readyDb).get()).toMatchObject({ revision: 1, campaignMinute: 1440 })

    const staleDb = database()
    seedRecoverablePokemon(staleDb)
    let reads = 0
    const changingAuthority = () => authority(staleDb, reads++ === 0 ? 'f' : '0')
    expect(() => advanceCampaignDayAfterPreflightUseCase({
      command: command('c'), preflightId: `campaign-day-preflight:v1:${'f'.repeat(64)}`,
    }, { database: staleDb, now: () => 500, readAuthority: changingAuthority })).toThrow(
      'Campaign day preflight changed during advancement',
    )
    expect(createSqliteCampaignClockRepository(staleDb).get()).toMatchObject({ revision: 0, campaignMinute: 0 })
    expect(createSqliteCampaignDayOperationRepository(staleDb).get(command('c').operationId)).toBeNull()
  })

  it('recovers an already accepted exact command without requiring a now-stale preflight identity', () => {
    const db = database()
    seedRecoverablePokemon(db)
    const readAuthority = () => authority(db, '9')
    const prepared = prepareCampaignDayUseCase({ command: command('d') }, { database: db, readAuthority })
    const first = advanceCampaignDayAfterPreflightUseCase({
      command: command('d'), preflightId: prepared.preflightId,
    }, { database: db, readAuthority })
    expect(first.result.replayed).toBe(false)
    const replay = advanceCampaignDayAfterPreflightUseCase({
      command: command('d'), preflightId: undefined,
    }, { database: db, readAuthority })
    expect(replay.result.replayed).toBe(true)
    expect(replay.preflight).toMatchObject({ state: 'already-accepted', accepted: { replayed: true } })
  })
})
