import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { executeContestCommandUseCase, loadContestUseCase } from '../../server/useCases/contests'
import { CONTEST_STAT_IDS } from '../../shared/contests/ids'
import type { ContestGmProjectionV1, ContestOwnerProjectionV1, ContestPublicProjectionV1 } from '../../shared/contests/projections'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const op = (id: string): string => `contest-op:v1:${id.replace(/[^a-z0-9-]/giu, '-').padEnd(8, 'x')}`
const base = (contestId: string, commandKind: string, id: string, expectedRevision: number) => ({ schemaVersion: 1, contestId, commandKind, operationId: op(id), expectedRevision, clientId: 'battle-introduction-runtime' })

const setup = () => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const profiles = new Map<string, any>()
  for (const [side, trainerName] of [['north', 'Mara'], ['south', 'Dax']] as const) {
    const trainerSlug = `trainer-${side}`, pokemonSlugs = Array.from({ length: 3 }, (_, index) => `pokemon-${side}-${index + 1}`)
    sheets.save({ kind: 'trainer', slug: trainerSlug, revision: 0, updatedAt: 1, document: { slug: trainerSlug, name: trainerName, level: 10, skills: { charm: { rankBonus: 1 }, command: { rankBonus: 2 } }, currentTeam: pokemonSlugs } })
    pokemonSlugs.forEach((slug, index) => sheets.save({ kind: 'pokemon', slug, revision: 0, updatedAt: 1, document: { slug, nickname: `${side} ${index + 1}`, species: 'Pikachu', level: 10, stats: { spd: { base: 10 + index } }, movelist: [{ name: 'Growl' }] } }))
    const profile = { id: `profile_${side}owner`, displayName: trainerName, linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainerSlug }, ...pokemonSlugs.map(sheetSlug => ({ sheetKind: 'pokemon', sheetSlug }))], createdAt: 1, updatedAt: 1 }
    profiles.set(profile.id, profile)
  }
  let randomCalls = 0
  const deps = {
    database,
    random: { nextInteger: (_minimum: number, maximum: number) => { randomCalls += 1; return maximum } },
    now: () => 700,
    readProfile: (id: unknown) => typeof id === 'string' ? profiles.get(id) ?? null : null,
    publishPersistedRealtimeEvent: () => {},
    reportAfterCommitPublicationFailure: () => {},
  }
  return { database, deps, profiles, randomCalls: () => randomCalls }
}

const prepare = (context: ReturnType<typeof setup>) => {
  const contestId = 'contest:v1:battle-introduction-runtime'
  let response = executeContestCommandUseCase({
    ...base(contestId, 'create-contest', 'create', 0),
    settings: { name: 'Neon Team Clash', hallName: 'Castelia Hall', description: '', variantId: 'battle', participantVariantId: null, participantMethodId: null, contestTypeId: 'cool', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: 'private plan' },
  }, { role: 'gm' }, context.deps)
  for (const side of ['north', 'south'] as const) response = executeContestCommandUseCase({
    ...base(contestId, 'enroll-contestant', `enroll-${side}`, response.result.revision), contestantId: `contestant:battle-${side}`, trainerSheetSlug: `trainer-${side}`,
    pokemonSheetSlugs: [1, 2, 3].map(index => `pokemon-${side}-${index}`), controller: { kind: 'profile', profileId: `profile_${side}owner` }, rotationOrder: [],
  }, { role: 'gm' }, context.deps)
  response = executeContestCommandUseCase(base(contestId, 'start-introduction', 'start', response.result.revision), { role: 'gm' }, context.deps)
  return { contestId, response }
}

describe('Battle Contest Trainer-team Introductions', () => {
  it('accepts one Introduction per Trainer, builds team-scoped dice, and never assigns Contest initiative', () => {
    const context = setup(); let { contestId, response } = prepare(context)
    const north = { ...base(contestId, 'declare-introduction', 'intro-north', response.result.revision), contestantId: 'contestant:battle-north', skillId: 'command', generatedStatId: 'cool', bonusStatIds: {} }
    response = executeContestCommandUseCase(north, { role: 'player', playerProfile: context.profiles.get('profile_northowner') }, context.deps)
    const callsAfterNorth = context.randomCalls(), northRevision = response.result.revision
    const northTeam = (response.projection as ContestOwnerProjectionV1).ownContestant
    expect(northTeam.introduction).toMatchObject({ status: 'accepted', performerId: null, skillId: 'command', generatedStatId: 'cool', matchingAppealBonus: 0, letterTotal: 0 })
    expect(northTeam.teamDicePools.cool).toMatchObject({ total: northTeam.introduction.generatedDice, remaining: northTeam.introduction.generatedDice })
    expect(northTeam.teamDicePools.cool.contributors).toContainEqual(expect.objectContaining({ kind: 'introduction', active: true }))
    expect(northTeam.performers.every(performer => CONTEST_STAT_IDS.every(statId => performer.dicePools[statId].contributors.every(row => row.kind !== 'introduction')))).toBe(true)
    expect(northTeam.letter).toBeNull()

    const retry = executeContestCommandUseCase(north, { role: 'player', playerProfile: context.profiles.get('profile_northowner') }, context.deps)
    expect(retry.result).toMatchObject({ exactRetry: true, revision: northRevision })
    expect(context.randomCalls()).toBe(callsAfterNorth)
    expect(() => executeContestCommandUseCase({ ...north, skillId: 'charm', generatedStatId: 'cute' }, { role: 'player', playerProfile: context.profiles.get('profile_northowner') }, context.deps)).toThrow(/operation ID was reused with changed input/i)

    response = executeContestCommandUseCase({ ...base(contestId, 'declare-introduction', 'intro-south', response.result.revision), contestantId: 'contestant:battle-south', skillId: 'charm', generatedStatId: 'cute', bonusStatIds: {} }, { role: 'player', playerProfile: context.profiles.get('profile_southowner') }, context.deps)
    const gm = loadContestUseCase(contestId, { role: 'gm' }, context.deps) as ContestGmProjectionV1
    expect(gm.contestants.every(team => team.introduction.status === 'accepted' && team.letter === null && team.introduction.letterTotal === 0)).toBe(true)
    expect(gm.contestants.map(team => CONTEST_STAT_IDS.reduce((sum, statId) => sum + team.teamDicePools[statId].total, 0))).toEqual(gm.contestants.map(team => team.introduction.generatedDice))
    expect(gm.history.at(-1)).toMatchObject({ type: 'battle-team-pools-ready', headline: 'Battle team pools ready' })
    expect('diceJournal' in gm).toBe(false)

    const blocked = base(contestId, 'start-performance', 'start-performance', response.result.revision)
    expect(() => executeContestCommandUseCase(blocked, { role: 'gm' }, context.deps)).toThrow(/encounter authority is created and linked/)
    expect(createSqliteContestRepository(context.database).get(contestId)?.revision).toBe(response.result.revision)
  })

  it('keeps opponent pools, roll evidence, providers, sheets, and operations out of public projections', () => {
    const context = setup(); let { contestId, response } = prepare(context)
    response = executeContestCommandUseCase({ ...base(contestId, 'declare-introduction', 'privacy-north', response.result.revision), contestantId: 'contestant:battle-north', skillId: 'command', generatedStatId: 'cool', bonusStatIds: {} }, { role: 'gm' }, context.deps)
    executeContestCommandUseCase({ ...base(contestId, 'declare-introduction', 'privacy-south', response.result.revision), contestantId: 'contestant:battle-south', skillId: 'charm', generatedStatId: 'cute', bonusStatIds: {} }, { role: 'gm' }, context.deps)

    const publicProjection = loadContestUseCase(contestId, { role: 'player' }, context.deps) as ContestPublicProjectionV1
    expect(publicProjection.scoreboard.every(row => row.letter === null)).toBe(true)
    const publicJson = JSON.stringify(publicProjection)
    for (const forbidden of ['teamDicePools', 'introductionSkillDice', 'providerIds', 'diceJournal', 'operationId', 'trainer-north', 'trainer-south', 'pokemon-north-', 'pokemon-south-', 'private plan']) expect(publicJson).not.toContain(forbidden)

    const northOwner = loadContestUseCase(contestId, { role: 'player', playerProfile: context.profiles.get('profile_northowner') }, context.deps) as ContestOwnerProjectionV1
    expect(northOwner.ownContestant.teamDicePools.cool.total).toBeGreaterThan(0)
    expect(JSON.stringify(northOwner)).not.toContain('privacy-south')
    expect('contestants' in northOwner).toBe(false)
  })
})
