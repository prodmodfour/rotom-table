import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { executeContestCommandUseCase, loadContestUseCase, ContestUseCaseError } from '../../server/useCases/contests'
import { createSeededContestRandomSource } from '../../shared/contests/dice'
import { contestPerformerIsPokemon, contestPerformerIsTrainer } from '../../shared/contests/document'
import { CONTEST_STAT_IDS } from '../../shared/contests/ids'
import type { ContestGmProjectionV1, ContestOwnerProjectionV1, ContestPublicProjectionV1 } from '../../shared/contests/projections'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const operationId = (suffix: string): string => `contest-op:v1:${suffix.padEnd(8, 'x')}`
const commandBase = (contestId: string, commandKind: string, suffix: string, expectedRevision: number) => ({
  schemaVersion: 1,
  contestId,
  commandKind,
  operationId: operationId(suffix),
  expectedRevision,
  clientId: 'trainer-participant-test',
})

const setup = () => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({
    kind: 'trainer', slug: 'trainer-avery', revision: 0, updatedAt: 10,
    document: { slug: 'trainer-avery', name: 'Avery', level: 7, skills: { charm: { rankBonus: 1 } }, movelist: [{ name: 'Charm' }, { name: 'Unreviewed Contest Technique' }], currentTeam: ['pokemon-spark'] },
  })
  sheets.save({
    kind: 'pokemon', slug: 'pokemon-spark', revision: 0, updatedAt: 10,
    document: { slug: 'pokemon-spark', nickname: 'Spark', species: 'Pikachu', level: 12, stats: { spd: { base: 15 } }, movelist: [{ name: 'Growl' }] },
  })
  sheets.save({
    kind: 'pokemon', slug: 'pokemon-unlinked', revision: 0, updatedAt: 10,
    document: { slug: 'pokemon-unlinked', nickname: 'Hidden', species: 'Pikachu', level: 10, stats: { spd: { base: 10 } }, movelist: [{ name: 'Growl' }] },
  })
  const owner = {
    id: 'profile_owner001',
    displayName: 'Owner',
    linkedCharacters: [
      { sheetKind: 'trainer', sheetSlug: 'trainer-avery' },
      { sheetKind: 'pokemon', sheetSlug: 'pokemon-spark' },
    ],
    createdAt: 1,
    updatedAt: 1,
  } as any
  const trainerOnly = {
    id: 'profile_trainonly',
    displayName: 'Trainer only',
    linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-avery' }],
    createdAt: 1,
    updatedAt: 1,
  } as any
  const profiles = new Map([[owner.id, owner], [trainerOnly.id, trainerOnly]])
  const deps = {
    database,
    random: createSeededContestRandomSource(53),
    now: () => 100,
    readProfile: (id: unknown) => typeof id === 'string' ? profiles.get(id) ?? null : null,
    publishPersistedRealtimeEvent: () => {},
    reportAfterCommitPublicationFailure: () => {},
  }
  return { database, sheets, owner, trainerOnly, deps }
}

const createParticipantContest = (context: ReturnType<typeof setup>, contestId = 'contest:v1:trainer-participant-runtime') => executeContestCommandUseCase({
  ...commandBase(contestId, 'create-contest', `create-${contestId.at(-1)}`, 0),
  settings: {
    name: 'Trainer Participant Contest',
    hallName: 'Jubilife Hall',
    description: '',
    variantId: 'standard',
    participantVariantId: 'trainer-participant',
    participantMethodId: 'simultaneous',
    contestTypeId: 'cute',
    significanceMultiplier: 1,
    awardRibbon: true,
    prize: { declared: true, money: 0, items: [], notes: '' },
    gmNotes: 'private setup note',
  },
}, { role: 'gm' }, context.deps)

const enrollmentCommand = (contestId: string, expectedRevision: number, profileId = 'profile_owner001', pokemonSheetSlugs = ['pokemon-spark']) => ({
  ...commandBase(contestId, 'enroll-contestant', 'enroll-pair', expectedRevision),
  contestantId: 'contestant:avery-pair',
  trainerSheetSlug: 'trainer-avery',
  pokemonSheetSlugs,
  controller: { kind: 'profile', profileId },
  rotationOrder: [],
})

describe('Trainer Participant Contest enrollment runtime', () => {
  it('persists and projects one exact Trainer beside one Pokémon through existing sheet and controller authority', () => {
    const context = setup()
    const created = createParticipantContest(context)
    const command = enrollmentCommand(created.result.contestId, created.result.revision)
    const enrolled = executeContestCommandUseCase(command, { role: 'gm' }, context.deps)
    const gm = enrolled.projection as ContestGmProjectionV1
    const contestant = gm.contestants[0]!
    const pokemon = contestant.performers.find(contestPerformerIsPokemon)!
    const trainer = contestant.performers.find(contestPerformerIsTrainer)!

    expect(gm).toMatchObject({ participantVariantId: 'trainer-participant', stage: 'setup', revision: 1 })
    expect(contestant).toMatchObject({ trainerSheetSlug: 'trainer-avery', trainerSheetRevision: 0, controller: { kind: 'profile', profileId: context.owner.id } })
    expect(pokemon).toMatchObject({ pokemonSheetSlug: 'pokemon-spark', pokemonSheetRevision: 0, displayName: 'Spark' })
    expect(trainer).toMatchObject({ trainerSheetSlug: 'trainer-avery', trainerSheetRevision: 0, displayName: 'Avery' })
    expect(trainer.moves.find(row => row.label === 'Charm')).toMatchObject({ available: true, source: 'sheet' })
    expect(trainer.moves.find(row => row.label === 'Unreviewed Contest Technique')).toMatchObject({ available: false, unavailableCode: 'contest.move-identity-missing' })
    for (const statId of CONTEST_STAT_IDS) expect(trainer.dicePools[statId]).toEqual({ total: 0, remaining: 0, contributors: [] })

    const owner = loadContestUseCase(created.result.contestId, { role: 'player', playerProfile: context.owner }, context.deps) as ContestOwnerProjectionV1
    expect(owner.audience).toBe('owner')
    expect(owner.ownContestant.performers.map(row => row.performerKind)).toEqual(['pokemon', 'trainer'])
    const publicProjection = loadContestUseCase(created.result.contestId, { role: 'player', playerProfile: null }, context.deps) as ContestPublicProjectionV1
    expect(publicProjection.participantVariantId).toBe('trainer-participant')
    expect(publicProjection.scoreboard[0]).toMatchObject({
      displayName: 'Avery',
      pokemonName: 'Spark',
      performers: [
        { performerKind: 'pokemon', displayName: 'Spark', activePerformer: true, voltage: 0 },
        { performerKind: 'trainer', displayName: 'Avery', activePerformer: true, voltage: 0 },
      ],
    })
    expect('contestants' in publicProjection).toBe(false)
    expect(JSON.stringify(publicProjection)).not.toContain('trainer-avery')
    expect(JSON.stringify(publicProjection)).not.toContain('pokemon-spark')
    expect(JSON.stringify(publicProjection)).not.toContain('providerIds')
    expect(JSON.stringify(publicProjection)).not.toContain('dicePools')

    const stored = createSqliteContestRepository(context.database).get(created.result.contestId)!.document
    expect(stored.contestants[0]?.performers.map(row => row.performerKind)).toEqual(['pokemon', 'trainer'])
    expect(stored.contestants[0]?.trainerSheetRevision).toBe(trainer.trainerSheetRevision)
  })

  it('replays enrollment exactly without duplicate performers or changed sheet reads', () => {
    const context = setup()
    const created = createParticipantContest(context, 'contest:v1:trainer-participant-replay')
    const command = enrollmentCommand(created.result.contestId, created.result.revision)
    const first = executeContestCommandUseCase(command, { role: 'gm' }, context.deps)

    context.sheets.delete('trainer', 'trainer-avery')
    context.sheets.delete('pokemon', 'pokemon-spark')
    const retry = executeContestCommandUseCase(command, { role: 'gm' }, context.deps)
    expect(retry.result).toMatchObject({ exactRetry: true, revision: first.result.revision })
    const stored = createSqliteContestRepository(context.database).get(created.result.contestId)!.document
    expect(stored.contestants).toHaveLength(1)
    expect(stored.contestants[0]?.performers).toHaveLength(2)
    expect(createSqliteContestRepository(context.database).findOperation(command.operationId)).not.toBeNull()

    expect(() => executeContestCommandUseCase({ ...command, pokemonSheetSlugs: ['pokemon-unlinked'] }, { role: 'gm' }, context.deps)).toThrow(/reused with changed input/)
    expect(createSqliteContestRepository(context.database).get(created.result.contestId)?.revision).toBe(first.result.revision)
  })

  it('rejects missing or incomplete current sheet/profile authority atomically', () => {
    const context = setup()
    const created = createParticipantContest(context, 'contest:v1:trainer-participant-control')
    const revision = created.result.revision
    const incomplete = enrollmentCommand(created.result.contestId, revision, context.trainerOnly.id, ['pokemon-spark'])
    expect(() => executeContestCommandUseCase(incomplete, { role: 'gm' }, context.deps)).toThrowError(ContestUseCaseError)
    expect(createSqliteContestRepository(context.database).get(created.result.contestId)?.revision).toBe(revision)
    expect(createSqliteContestRepository(context.database).findOperation(incomplete.operationId)).toBeNull()

    const missingPokemon = { ...enrollmentCommand(created.result.contestId, revision), operationId: operationId('missing-pokemon'), pokemonSheetSlugs: ['pokemon-missing'] }
    expect(() => executeContestCommandUseCase(missingPokemon, { role: 'gm' }, context.deps)).toThrow(/does not control every enrolled Pokémon|sheet was not found/)
    expect(createSqliteContestRepository(context.database).get(created.result.contestId)?.revision).toBe(revision)
    expect(createSqliteContestRepository(context.database).findOperation(missingPokemon.operationId)).toBeNull()

    const duplicatePokemon = { ...enrollmentCommand(created.result.contestId, revision), operationId: operationId('duplicate-pokemon'), pokemonSheetSlugs: ['pokemon-spark', 'pokemon-spark'] }
    expect(() => executeContestCommandUseCase(duplicatePokemon, { role: 'gm' }, context.deps)).toThrow(/exactly one Pokémon|only once/)
    expect(createSqliteContestRepository(context.database).get(created.result.contestId)?.revision).toBe(revision)
  })

  it('rejects an incomplete participant lineup without rolling, spending, or advancing the document', () => {
    const context = setup()
    const created = createParticipantContest(context, 'contest:v1:trainer-participant-gate')
    const enrolled = executeContestCommandUseCase(enrollmentCommand(created.result.contestId, created.result.revision), { role: 'gm' }, context.deps)
    const start = commandBase(created.result.contestId, 'start-introduction', 'start-gated', enrolled.result.revision)
    expect(() => executeContestCommandUseCase(start, { role: 'gm' }, context.deps)).toThrow(/three through five contestants/)
    const stored = createSqliteContestRepository(context.database).get(created.result.contestId)!.document
    expect(stored).toMatchObject({ revision: enrolled.result.revision, stage: 'setup', diceJournal: [], appealLedger: [] })
    expect(createSqliteContestRepository(context.database).findOperation(start.operationId)).toBeNull()
  })

  it('rejects unknown participant formats at the strict command boundary', () => {
    const context = setup()
    const command = {
      ...commandBase('contest:v1:trainer-participant-unknown', 'create-contest', 'create-unknown', 0),
      settings: {
        name: 'Unknown Format', hallName: 'Hall', description: '', variantId: 'standard', participantVariantId: 'trainer-and-two-pokemon', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true,
        prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '',
      },
    }
    expect(() => executeContestCommandUseCase(command, { role: 'gm' }, context.deps)).toThrow(/participantVariantId.*unsupported/)
    expect(createSqliteContestRepository(context.database).get(command.contestId)).toBeNull()
    expect(createSqliteContestRepository(context.database).findOperation(command.operationId)).toBeNull()
  })
})
