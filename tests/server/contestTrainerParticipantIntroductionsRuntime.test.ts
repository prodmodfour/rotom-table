import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { executeContestCommandUseCase, loadContestUseCase } from '../../server/useCases/contests'
import { createSeededContestRandomSource } from '../../shared/contests/dice'
import { CONTEST_STAT_IDS } from '../../shared/contests/ids'
import type { ContestGmProjectionV1 } from '../../shared/contests/projections'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const op = (id: string) => `contest-op:v1:${id.padEnd(8, 'x')}`
const base = (contestId: string, commandKind: string, operation: string, expectedRevision: number) => ({ schemaVersion: 1, contestId, commandKind, operationId: op(operation), expectedRevision, clientId: 'trainer-introduction-runtime' })
const setup = () => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  for (const [index, suffix] of ['a', 'b', 'c'].entries()) {
    sheets.save({
      kind: 'trainer', slug: `trainer-${suffix}`, revision: 0, updatedAt: 1,
      document: { slug: `trainer-${suffix}`, name: `Trainer ${suffix.toUpperCase()}`, level: 8, skills: { charm: { rankBonus: index } }, movelist: [{ name: 'Charm' }], currentTeam: [`pokemon-${suffix}`] },
    })
    sheets.save({
      kind: 'pokemon', slug: `pokemon-${suffix}`, revision: 0, updatedAt: 1,
      document: { slug: `pokemon-${suffix}`, nickname: `Partner ${suffix.toUpperCase()}`, species: 'Pikachu', level: 10, stats: { spd: { base: 10 + index * 5 } }, movelist: [{ name: 'Growl' }] },
    })
  }
  const seeded = createSeededContestRandomSource(56)
  let randomCalls = 0
  const deps = {
    database,
    random: { nextInteger: (minimum: number, maximum: number) => { randomCalls += 1; return seeded.nextInteger(minimum, maximum) } },
    now: () => 600,
    publishPersistedRealtimeEvent: () => {},
    reportAfterCommitPublicationFailure: () => {},
  }
  return { database, sheets, deps, randomCalls: () => randomCalls }
}

describe('Trainer Participant introduction runtime', () => {
  it('commits canonical Trainer introductions and letters once, recovers exact retry, and hands off to Simultaneous performance', () => {
    const context = setup(), contestId = 'contest:v1:trainer-introduction-runtime'
    let response = executeContestCommandUseCase({
      ...base(contestId, 'create-contest', 'create-intro', 0),
      settings: { name: 'Trainer Introductions', hallName: 'Hall', description: '', variantId: 'standard', participantVariantId: 'trainer-participant', participantMethodId: 'simultaneous', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '' },
    }, { role: 'gm' }, context.deps)
    for (const suffix of ['a', 'b', 'c']) response = executeContestCommandUseCase({
      ...base(contestId, 'enroll-contestant', `enroll-${suffix}`, response.result.revision),
      contestantId: `contestant:entry-${suffix}`, trainerSheetSlug: `trainer-${suffix}`, pokemonSheetSlugs: [`pokemon-${suffix}`], controller: { kind: 'gm' }, rotationOrder: [],
    }, { role: 'gm' }, context.deps)
    response = executeContestCommandUseCase({ ...base(contestId, 'start-introduction', 'start-intro', response.result.revision) }, { role: 'gm' }, context.deps)
    expect(response.projection).toMatchObject({ stage: 'introduction', participantMethodId: 'simultaneous' })

    const first = { ...base(contestId, 'declare-introduction', 'intro-a', response.result.revision), contestantId: 'contestant:entry-a', skillId: 'charm', generatedStatId: 'cute', bonusStatIds: {} }
    response = executeContestCommandUseCase(first, { role: 'gm' }, context.deps)
    const callsAfterFirst = context.randomCalls(), firstRevision = response.result.revision
    expect(callsAfterFirst).toBeGreaterThan(0)
    expect((response.projection as ContestGmProjectionV1).contestants[0]?.introduction).toMatchObject({ status: 'accepted', performerId: 'performer:trainer-trainer-a', skillId: 'charm' })
    const retry = executeContestCommandUseCase(first, { role: 'gm' }, context.deps)
    expect(retry.result).toMatchObject({ exactRetry: true, revision: firstRevision })
    expect(context.randomCalls()).toBe(callsAfterFirst)
    expect((retry.projection as ContestGmProjectionV1).contestants[0]?.introduction.results).toEqual((response.projection as ContestGmProjectionV1).contestants[0]?.introduction.results)
    expect(() => executeContestCommandUseCase({ ...first, skillId: 'command' }, { role: 'gm' }, context.deps)).toThrow(/operation ID was reused with changed input/i)
    const stale = { ...base(contestId, 'declare-introduction', 'intro-stale', firstRevision - 1), contestantId: 'contestant:entry-b', skillId: 'charm', generatedStatId: 'cute', bonusStatIds: {} }
    expect(() => executeContestCommandUseCase(stale, { role: 'gm' }, context.deps)).toThrow(/revision/i)
    expect(context.randomCalls()).toBe(callsAfterFirst)
    expect(createSqliteContestRepository(context.database).findOperation(op('intro-stale'))).toBeNull()

    for (const suffix of ['b', 'c']) response = executeContestCommandUseCase({
      ...base(contestId, 'declare-introduction', `intro-${suffix}`, response.result.revision), contestantId: `contestant:entry-${suffix}`, skillId: 'charm', generatedStatId: 'cute', bonusStatIds: {},
    }, { role: 'gm' }, context.deps)
    const gm = response.projection as ContestGmProjectionV1
    expect(gm.contestants.map(row => row.letter).sort()).toEqual(['A', 'B', 'C'])
    expect(gm.contestants.every(row => row.introduction.status === 'accepted' && row.introduction.performerId === row.performers.find(performer => performer.performerKind === 'trainer')?.performerId)).toBe(true)
    expect(gm.contestants.every(row => CONTEST_STAT_IDS.every(statId => row.performers.find(performer => performer.performerKind === 'trainer')!.dicePools[statId].total === 0))).toBe(true)
    expect(gm.contestants.every(row => row.performers.find(performer => performer.performerKind === 'pokemon')!.dicePools.cute.contributors.some(contribution => contribution.kind === 'introduction') || row.introduction.generatedDice === 0)).toBe(true)

    const publicProjection = loadContestUseCase(contestId, { role: 'player' }, context.deps)
    expect(publicProjection.scoreboard.map(row => row.letter).sort()).toEqual(['A', 'B', 'C'])
    expect(JSON.stringify(publicProjection)).not.toContain('performer:trainer-')
    expect(JSON.stringify(publicProjection)).not.toContain('introduction-evidence')

    const startPerformance = { ...base(contestId, 'start-performance', 'start-performance', response.result.revision) }, callsBeforePerformance = context.randomCalls()
    response = executeContestCommandUseCase(startPerformance, { role: 'gm' }, context.deps)
    expect(context.randomCalls()).toBe(callsBeforePerformance)
    const stored = createSqliteContestRepository(context.database).get(contestId)!
    expect(stored).toMatchObject({ revision: response.result.revision, document: { stage: 'performance', round: 1, turnIndex: 0, appealLedger: [] } })
    expect(stored.document.contestants.every(contestant => contestant.voltage === 0 && Object.keys(contestant.performerVoltages).length === contestant.performers.length && Object.values(contestant.performerVoltages).every(voltage => voltage === 0))).toBe(true)
    expect(createSqliteContestRepository(context.database).findOperation(op('start-performance'))).not.toBeNull()
  })
})
