import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { executeContestCommandUseCase, loadContestUseCase } from '../../server/useCases/contests'
import { createSeededContestRandomSource } from '../../shared/contests/dice'
import type { ContestGmProjectionV1 } from '../../shared/contests/projections'
import { detectCampaignSheetAdvancementAttention } from '../../server/domain/campaignAttention/advancementDetector'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const op = (value: string) => `contest-op:v1:${value.padEnd(8, 'x')}`
const common = (contestId: string, commandKind: string, operationId: string, expectedRevision: number) => ({ schemaVersion: 1, contestId, commandKind, operationId: op(operationId), expectedRevision, clientId: 'test-client' })

describe('authoritative Contest journey', () => {
  it('runs creation through atomic ribbon and experience settlement with exact retry', () => {
    const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    for (let index = 0; index < 3; index += 1) {
      const trainerSlug = `trainer-${index + 1}`, pokemonSlug = `pokemon-${index + 1}`
      sheets.save({ kind: 'trainer', slug: trainerSlug, revision: 0, updatedAt: 100, document: { slug: trainerSlug, name: `Trainer ${index + 1}`, level: 5, skills: {}, inventory: {}, currentTeam: [pokemonSlug] } })
      sheets.save({ kind: 'pokemon', slug: pokemonSlug, revision: 0, updatedAt: 100, document: { slug: pokemonSlug, nickname: `Partner ${index + 1}`, species: 'Pikachu', level: 10, totalExp: 100, stats: { spd: { base: 20, added: 10, stage: 6 } }, movelist: [{ name: 'Charm' }, { name: 'Growl' }], contestStats: 'legacy note' } })
    }
    const deps = { database, random: createSeededContestRandomSource(42), now: () => 1_000, publishPersistedRealtimeEvent: () => {}, reportAfterCommitPublicationFailure: () => {} }
    const contestId = 'contest:v1:golden-cute'
    let response = executeContestCommandUseCase({
      ...common(contestId, 'create-contest', 'create000', 0),
      settings: { name: 'Golden Cute Contest', hallName: 'Jubilife Hall', variantId: 'standard', contestTypeId: 'cute', significanceMultiplier: 1.5, awardRibbon: true, prize: { declared: true, money: 500, items: [{ itemId: 'Poffin', quantity: 2, targetTrainerSlug: null }, { itemId: 'Fancy Clothes', quantity: 2, targetTrainerSlug: null }], notes: '' } },
    }, { role: 'gm' }, deps)
    expect(response.result.revision).toBe(0)
    for (let index = 0; index < 3; index += 1) {
      response = executeContestCommandUseCase({
        ...common(contestId, 'enroll-contestant', `enroll0${index}`, response.result.revision), contestantId: `contestant:c${index + 1}`,
        trainerSheetSlug: `trainer-${index + 1}`, pokemonSheetSlugs: [`pokemon-${index + 1}`], controller: { kind: 'gm' }, rotationOrder: [],
      }, { role: 'gm' }, deps)
    }
    response = executeContestCommandUseCase(common(contestId, 'start-introduction', 'startintro', response.result.revision), { role: 'gm' }, deps)
    for (let index = 0; index < 3; index += 1) response = executeContestCommandUseCase({
      ...common(contestId, 'declare-introduction', `intro000${index}`, response.result.revision), contestantId: `contestant:c${index + 1}`, skillId: 'charm', generatedStatId: 'cute',
    }, { role: 'gm' }, deps)
    const introduced = response.projection as ContestGmProjectionV1
    expect(introduced.scoreboard.every(row => row.letter)).toBe(true)
    response = executeContestCommandUseCase(common(contestId, 'start-performance', 'startperf', response.result.revision), { role: 'gm' }, deps)
    let appeals = 0
    while (response.result.stage === 'performance') {
      const projection = response.projection as ContestGmProjectionV1
      const contestant = projection.contestants.find(row => row.contestantId === projection.activeContestantId)!
      const performer = contestant.performers[0]!
      const move = performer.moves.find(row => row.available && row.optionId !== contestant.lastMoveOptionId)!
      response = executeContestCommandUseCase({
        ...common(contestId, 'declare-appeal', `appeal${String(appeals).padStart(3, '0')}`, response.result.revision), contestantId: contestant.contestantId,
        performerId: performer.performerId, moveOptionId: move.optionId, spentDice: { beauty: 0, cool: 0, cute: 0, smart: 0, tough: 0 },
      }, { role: 'gm' }, deps)
      appeals += 1
      expect(appeals).toBeLessThanOrEqual(9)
    }
    expect(appeals).toBe(9)
    expect(response.result.stage).toBe('settling')
    response = executeContestCommandUseCase(common(contestId, 'prepare-settlement', 'prepare00', response.result.revision), { role: 'gm' }, deps)
    const commitCommand = common(contestId, 'commit-settlement', 'commit000', response.result.revision)
    response = executeContestCommandUseCase(commitCommand, { role: 'gm' }, deps)
    expect(response.result.stage).toBe('completed')
    const retry = executeContestCommandUseCase(commitCommand, { role: 'gm' }, deps)
    expect(retry.result.exactRetry).toBe(true)
    const winner = (response.projection as ContestGmProjectionV1).scoreboard.find(row => row.placement === 1)!
    const winnerContestant = (response.projection as ContestGmProjectionV1).contestants.find(row => row.contestantId === winner.contestantId)!
    const pokemon = sheets.getByRef('pokemon', winnerContestant.performers[0]!.pokemonSheetSlug)!.sheet as any
    const trainer = sheets.getByRef('trainer', winnerContestant.trainerSheetSlug)!.sheet as any
    expect(pokemon.contestRibbons).toHaveLength(1)
    expect(pokemon.totalExp).toBeGreaterThan(100)
    expect(trainer.contestResults).toHaveLength(1)
    expect(trainer.contestResults[0]).toMatchObject({ ribbonAwarded: true, ribbonIds: [`${contestId}:ribbon:${pokemon.slug}`] })
    expect(trainer.money).toBe(500)
    expect(trainer.inventory.foodStuff.find((row: any) => row.name === 'Poffin')?.qty).toBe(2)
    expect(trainer.inventory.equipment.filter((row: any) => row.name === 'Fancy Clothes')).toHaveLength(2)
    expect(detectCampaignSheetAdvancementAttention({ sheets: sheets.list(), campaignMinute: 0 }).some(item => item.entity.id === pokemon.slug)).toBe(true)
    expect((loadContestUseCase(contestId, { role: 'gm' }, deps) as ContestGmProjectionV1).stage).toBe('completed')
  })
})
