import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { executeContestCommandUseCase } from '../../server/useCases/contests'
import { createSeededContestRandomSource } from '../../shared/contests/dice'
import { CONTEST_STAT_IDS } from '../../shared/contests/ids'
import type { ContestGmProjectionV1 } from '../../shared/contests/projections'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const op = (value: string): string => `contest-op:v1:${value.padEnd(8, 'x')}`
const common = (contestId: string, commandKind: string, operation: string, expectedRevision: number) => ({ schemaVersion: 1, contestId, commandKind, operationId: op(operation), expectedRevision, clientId: 'shared-dice-runtime' })

const setup = () => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({
    kind: 'trainer', slug: 'trainer-style', revision: 0, updatedAt: 1,
    document: {
      slug: 'trainer-style', name: 'Style Trainer', level: 10, skills: {}, inventory: {},
      features: [{ name: 'Style Expert', automation: { schemaVersion: 1, instanceId: 'feature:style-expert:shared-dice', canonicalId: 'Style Expert', definitionVersion: 1, rank: 1, choices: [{ choiceId: 'contestStat', values: ['Cute'] }], acquisition: { kind: 'gm', sourceId: 'shared-dice-runtime' }, prerequisiteOverride: null } }],
      movelist: [{ name: 'Charm' }], currentTeam: ['pokemon-style'],
    },
  })
  sheets.save({
    kind: 'pokemon', slug: 'pokemon-style', revision: 0, updatedAt: 1,
    document: { slug: 'pokemon-style', nickname: 'Spark', species: 'Pikachu', level: 10, stats: { spd: { base: 20 }, satk: { base: 10 } }, movelist: [{ name: 'Growl' }] },
  })
  const deps = { database, random: createSeededContestRandomSource(54), now: () => 100, publishPersistedRealtimeEvent: () => {}, reportAfterCommitPublicationFailure: () => {} }
  return { database, sheets, deps }
}

describe('Trainer Participant shared dice runtime', () => {
  it('persists one Pokémon pool shared by reference, withdraws lost Feature dice once, and preserves exact command replay', () => {
    const context = setup(), contestId = 'contest:v1:shared-dice-runtime'
    let response = executeContestCommandUseCase({
      ...common(contestId, 'create-contest', 'create-shared', 0),
      settings: { name: 'Shared Dice Contest', hallName: 'Hall', description: '', variantId: 'standard', participantVariantId: 'trainer-participant', participantMethodId: 'simultaneous', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '' },
    }, { role: 'gm' }, context.deps)
    const enroll = {
      ...common(contestId, 'enroll-contestant', 'enroll-shared', response.result.revision),
      contestantId: 'contestant:style-pair', trainerSheetSlug: 'trainer-style', pokemonSheetSlugs: ['pokemon-style'], controller: { kind: 'gm' }, rotationOrder: [],
    }
    response = executeContestCommandUseCase(enroll, { role: 'gm' }, context.deps)
    const enrolled = (response.projection as ContestGmProjectionV1).contestants[0]!
    const pokemon = enrolled.performers.find(performer => performer.performerKind === 'pokemon')!, trainerPerformer = enrolled.performers.find(performer => performer.performerKind === 'trainer')!
    expect(pokemon.dicePools.cute.contributors).toContainEqual(expect.objectContaining({ kind: 'feature-poffin-equivalent', label: 'Style Expert', dice: 2, active: true }))
    expect(pokemon.dicePools.cute.total).toBeGreaterThanOrEqual(2)
    expect(enrolled.teamDicePools.cute).toEqual({ total: 0, remaining: 0, contributors: [] })
    expect(enrolled.sharedDiceSpendJournal).toEqual([])
    expect(enrolled.teamContestDiceSpent).toBe(0)
    expect(CONTEST_STAT_IDS.every(statId => trainerPerformer.dicePools[statId].total === 0 && trainerPerformer.dicePools[statId].remaining === 0)).toBe(true)
    const beforeTotal = pokemon.dicePools.cute.total

    const trainerStored = context.sheets.getByRef('trainer', 'trainer-style')!, trainer = structuredClone(trainerStored.sheet) as any
    trainer.features = []
    expect(context.sheets.applyLivePlayUpdate({ kind: 'trainer', slug: 'trainer-style', expectedRevision: trainerStored.revision, nextSheet: trainer, sourceOperationId: op('remove-style') })).toBe('applied')

    const persistRefresh = { ...common(contestId, 'update-settings', 'persist-refresh', response.result.revision), patch: { gmNotes: 'Persist source-loss refresh.' } }
    response = executeContestCommandUseCase(persistRefresh, { role: 'gm' }, context.deps)
    const refreshed = (response.projection as ContestGmProjectionV1).contestants[0]!
    const refreshedPokemon = refreshed.performers.find(performer => performer.performerKind === 'pokemon')!
    expect(refreshedPokemon.dicePools.cute.total).toBe(beforeTotal - 2)
    expect(refreshedPokemon.dicePools.cute.contributors).toContainEqual(expect.objectContaining({ kind: 'feature-poffin-equivalent', label: 'Style Expert', dice: 2, active: false }))
    expect(refreshed.teamDicePools.cute.total).toBe(0)

    const retry = executeContestCommandUseCase(persistRefresh, { role: 'gm' }, context.deps)
    expect(retry.result).toMatchObject({ exactRetry: true, revision: response.result.revision })
    const stored = createSqliteContestRepository(context.database).get(contestId)!.document.contestants[0]!
    const storedPokemon = stored.performers.find(row => row.performerKind === 'pokemon')!
    expect(storedPokemon.dicePools.cute.total).toBe(beforeTotal - 2)
    expect(storedPokemon.dicePools.cute.contributors.filter(row => row.label === 'Style Expert')).toHaveLength(1)
    expect(stored.sharedDiceSpendJournal).toEqual([])
  })

  it('refuses a persisted row corrupted to give the Trainer copied pool authority', () => {
    const context = setup(), contestId = 'contest:v1:shared-dice-corrupt'
    let response = executeContestCommandUseCase({
      ...common(contestId, 'create-contest', 'create-corrupt', 0),
      settings: { name: 'Shared Dice Corruption', hallName: 'Hall', description: '', variantId: 'standard', participantVariantId: 'trainer-participant', participantMethodId: 'simultaneous', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '' },
    }, { role: 'gm' }, context.deps)
    response = executeContestCommandUseCase({
      ...common(contestId, 'enroll-contestant', 'enroll-corrupt', response.result.revision),
      contestantId: 'contestant:corrupt-pair', trainerSheetSlug: 'trainer-style', pokemonSheetSlugs: ['pokemon-style'], controller: { kind: 'gm' }, rotationOrder: [],
    }, { role: 'gm' }, context.deps)
    const repository = createSqliteContestRepository(context.database), corrupt = structuredClone(repository.get(contestId)!.document) as any
    const pokemon = corrupt.contestants[0].performers.find((performer: any) => performer.performerKind === 'pokemon')
    const trainer = corrupt.contestants[0].performers.find((performer: any) => performer.performerKind === 'trainer')
    trainer.dicePools.cute = structuredClone(pokemon.dicePools.cute)
    context.database.connection.prepare('UPDATE contests SET document_json = ? WHERE contest_id = ?').run(JSON.stringify(corrupt), contestId)
    expect(() => repository.get(contestId)).toThrow(/cannot retain a parallel Contest dice pool/)
    expect(repository.findOperation(op('enroll-corrupt'))?.resultRevision).toBe(response.result.revision)
  })
})
