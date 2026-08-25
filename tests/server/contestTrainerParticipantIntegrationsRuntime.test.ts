import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { executeContestCommandUseCase, ContestUseCaseError } from '../../server/useCases/contests'
import { contestCurrentContestant, contestPerformerIsPokemon, contestPerformerIsTrainer, type ContestDocumentV1 } from '../../shared/contests/document'
import { emptyContestStatRecord } from '../../shared/contests/ids'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const operationId = (suffix: string): string => `contest-op:v1:${suffix.padEnd(8, 'x')}`
const base = (contestId: string, commandKind: string, suffix: string, revision: number) => ({ schemaVersion: 1, contestId, commandKind, operationId: operationId(suffix), expectedRevision: revision, clientId: 'participant-integrations-test' })
const emptySpend = () => emptyContestStatRecord(() => 0)
const feature = (canonicalId: string, choices: readonly { choiceId: string, values: readonly string[] }[] = []) => ({
  name: canonicalId,
  automation: { schemaVersion: 1, instanceId: `feature:${canonicalId.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}:1`, canonicalId, definitionVersion: 1, rank: 1, choices, acquisition: { kind: 'gm', sourceId: 'participant-integrations-test' }, prerequisiteOverride: null },
})

const setup = () => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  for (const suffix of ['a', 'b', 'c']) {
    sheets.save({
      kind: 'trainer', slug: `trainer-${suffix}`, revision: 0, updatedAt: 1,
      document: {
        slug: `trainer-${suffix}`, name: `Trainer ${suffix.toUpperCase()}`, level: 8, ap: { max: 8, spent: 0, bound: 0, drained: 0 },
        skills: { charm: { rankBonus: 1 } }, currentTeam: [`pokemon-${suffix}`], movelist: [{ name: 'Charm' }, { name: 'Tackle' }],
        features: suffix === 'a' ? [feature('Coordinator'), feature('Style Flourish', [{ choiceId: 'contestStat', values: ['Cute'] }]), feature('Reliable Performance')] : [],
      },
    })
    sheets.save({
      kind: 'pokemon', slug: `pokemon-${suffix}`, revision: 0, updatedAt: 1,
      document: {
        slug: `pokemon-${suffix}`, nickname: `Partner ${suffix.toUpperCase()}`, species: 'Pikachu', level: 10, totalExp: 100,
        stats: { spd: { base: 10 } }, movelist: [{ name: 'Growl' }, { name: 'Tackle' }],
        abilities: suffix === 'a' ? [{ name: 'Beautiful' }, { name: 'Fashion Designer' }] : [],
      },
    })
  }
  // Deterministic ones keep both post-appeal reroll offers observable.
  const deps = { database, sheets, random: { nextInteger: (minimum: number) => minimum }, now: () => 900, publishPersistedRealtimeEvent: () => {}, reportAfterCommitPublicationFailure: () => {} }
  return { database, sheets, deps }
}

const stored = (context: ReturnType<typeof setup>, contestId: string): ContestDocumentV1 => createSqliteContestRepository(context.database).get(contestId)!.document
const appeal = (document: ContestDocumentV1, suffix: string, performerId: string, moveOptionId: string, spentDice = emptySpend()) => ({
  ...base(document.contestId, 'declare-appeal', suffix, document.revision), contestantId: contestCurrentContestant(document)!.contestantId, performerId, moveOptionId, partnerEffectTargetPerformerId: null, spentDice,
})
const intervention = (document: ContestDocumentV1, suffix: string, interventionId: string, contestantId: string, targetPerformerId: string, appealId: string | null = null) => ({
  ...base(document.contestId, 'use-intervention', suffix, document.revision), contestantId, interventionId, targetContestantId: null, targetPerformerId, appealId, choices: {},
})

const preparePerformance = (context: ReturnType<typeof setup>): ContestDocumentV1 => {
  const contestId = 'contest:v1:participant-integrations'
  let response = executeContestCommandUseCase({
    ...base(contestId, 'create-contest', 'create', 0),
    settings: { name: 'Paired integrations', hallName: 'Hall', description: '', variantId: 'standard', participantVariantId: 'trainer-participant', participantMethodId: 'simultaneous', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '' },
  }, { role: 'gm' }, context.deps)
  for (const suffix of ['a', 'b', 'c']) response = executeContestCommandUseCase({ ...base(contestId, 'enroll-contestant', `enroll-${suffix}`, response.result.revision), contestantId: `contestant:entry-${suffix}`, trainerSheetSlug: `trainer-${suffix}`, pokemonSheetSlugs: [`pokemon-${suffix}`], controller: { kind: 'gm' }, rotationOrder: [] }, { role: 'gm' }, context.deps)
  response = executeContestCommandUseCase(base(contestId, 'start-introduction', 'start-intro', response.result.revision), { role: 'gm' }, context.deps)
  for (const suffix of ['a', 'b', 'c']) response = executeContestCommandUseCase({ ...base(contestId, 'declare-introduction', `intro-${suffix}`, response.result.revision), contestantId: `contestant:entry-${suffix}`, skillId: 'charm', generatedStatId: 'cute', bonusStatIds: {} }, { role: 'gm' }, context.deps)
  executeContestCommandUseCase(base(contestId, 'start-performance', 'start-performance', response.result.revision), { role: 'gm' }, context.deps)
  let document = stored(context, contestId)
  let step = 0
  while (contestCurrentContestant(document)!.contestantId !== 'contestant:entry-a') {
    const actor = contestCurrentContestant(document)!
    const atCursor = document.appealLedger.filter(row => row.contestantId === actor.contestantId && row.round === document.round && row.turn === document.turnIndex + 1)
    const performer = atCursor.length === 0
      ? actor.performers.find(contestPerformerIsTrainer)!
      : actor.performers.find(candidate => candidate.performerId !== atCursor[0]!.performerId)!
    const previous = [...document.appealLedger].reverse().find(row => row.contestantId === actor.contestantId && row.performerId === performer.performerId)
    const move = performer.moves.find(row => row.available && row.optionId !== previous?.moveOptionId)!
    executeContestCommandUseCase(appeal(document, `wait-${step++}`, performer.performerId, move.optionId), { role: 'gm' }, context.deps)
    document = stored(context, contestId)
  }
  return document
}

describe('Trainer Participant normal Contest integrations', () => {
  it('binds Pokémon abilities and Trainer Features to the exact paired performer with ordinary ledgers and replay safety', () => {
    const context = setup()
    let document = preparePerformance(context)
    const actor = contestCurrentContestant(document)!, trainer = actor.performers.find(contestPerformerIsTrainer)!, pokemon = actor.performers.find(contestPerformerIsPokemon)!

    const beautiful = intervention(document, 'beautiful', 'Beautiful', actor.contestantId, pokemon.performerId)
    let response = executeContestCommandUseCase(beautiful, { role: 'gm' }, context.deps)
    document = stored(context, document.contestId)
    expect(document.contestants.find(row => row.contestantId === actor.contestantId)!.performers.find(row => row.performerId === pokemon.performerId)!.dicePools.beauty).toMatchObject({ total: 2, remaining: 2 })
    expect(document.contestants.find(row => row.contestantId === actor.contestantId)!.usedInterventionIds).toContain(`Beautiful@${pokemon.performerId}`)
    expect(executeContestCommandUseCase(beautiful, { role: 'gm' }, context.deps).result).toMatchObject({ exactRetry: true, revision: response.result.revision })
    expect(() => executeContestCommandUseCase(intervention(document, 'beautiful-again', 'Beautiful', actor.contestantId, pokemon.performerId), { role: 'gm' }, context.deps)).toThrow(/already been used/)

    const fashion = intervention(document, 'fashion', 'Fashion Designer', actor.contestantId, pokemon.performerId)
    response = executeContestCommandUseCase(fashion, { role: 'gm' }, context.deps)
    document = stored(context, document.contestId)
    expect((context.sheets.getByRef('pokemon', 'pokemon-a')!.sheet as any).abilityUsage.entries).toContainEqual(expect.objectContaining({ canonicalId: 'Fashion Designer', clauseId: 'contest-decorative-twine', spent: 1 }))
    expect(executeContestCommandUseCase(fashion, { role: 'gm' }, context.deps).result).toMatchObject({ exactRetry: true, revision: response.result.revision })
    expect((context.sheets.getByRef('pokemon', 'pokemon-a')!.sheet as any).abilityUsage.entries[0].spent).toBe(1)
    expect(() => executeContestCommandUseCase(intervention(document, 'fashion-trainer', 'Fashion Designer', actor.contestantId, trainer.performerId), { role: 'gm' }, context.deps)).toThrowError(ContestUseCaseError)

    const pokemonAppeal = appeal(document, 'pokemon-appeal', pokemon.performerId, pokemon.moves.find(row => row.optionId === 'move:growl')!.optionId)
    executeContestCommandUseCase(pokemonAppeal, { role: 'gm' }, context.deps)
    document = stored(context, document.contestId)
    let accepted = document.appealLedger.at(-1)!
    expect(accepted).toMatchObject({ performerId: pokemon.performerId, acceptedResults: expect.any(Array) })
    expect(accepted.contributors).toContainEqual(expect.objectContaining({ id: 'accepted-intervention', dice: 2 }))
    expect(document.pendingInterventionAppealId).toBe(accepted.appealId)

    const coordinator = intervention(document, 'coordinator', 'Coordinator', actor.contestantId, pokemon.performerId, accepted.appealId)
    executeContestCommandUseCase(coordinator, { role: 'gm' }, context.deps)
    document = stored(context, document.contestId)
    accepted = document.appealLedger.at(-1)!
    expect(accepted.journalIds).toHaveLength(2)
    expect(document.pendingInterventionAppealId).toBe(accepted.appealId)
    expect(document.contestants.find(row => row.contestantId === actor.contestantId)!.usedInterventionIds).toContain('Coordinator')

    const flourish = intervention(document, 'flourish', 'Style Flourish', actor.contestantId, pokemon.performerId, accepted.appealId)
    response = executeContestCommandUseCase(flourish, { role: 'gm' }, context.deps)
    document = stored(context, document.contestId)
    expect(document.appealLedger.at(-1)!.journalIds).toHaveLength(3)
    expect(document.pendingInterventionAppealId).toBeNull()
    expect((context.sheets.getByRef('trainer', 'trainer-a')!.sheet as any).featureApState.spent).toBe(1)
    expect(executeContestCommandUseCase(flourish, { role: 'gm' }, context.deps).result).toMatchObject({ exactRetry: true, revision: response.result.revision })
    expect((context.sheets.getByRef('trainer', 'trainer-a')!.sheet as any).featureApState.spent).toBe(1)
    expect(document).toMatchObject({ round: 1, turnIndex: document.turnIndex })
    expect(document.contestants.find(row => row.contestantId === actor.contestantId)!.performerVoltages).toMatchObject({ [pokemon.performerId]: 2, [trainer.performerId]: 0 })

    const reliable = intervention(document, 'reliable', 'Reliable Performance', actor.contestantId, trainer.performerId)
    executeContestCommandUseCase(reliable, { role: 'gm' }, context.deps)
    document = stored(context, document.contestId)
    expect((context.sheets.getByRef('trainer', 'trainer-a')!.sheet as any).featureApState.spent).toBe(3)
    executeContestCommandUseCase(appeal(document, 'trainer-appeal', trainer.performerId, trainer.moves.find(row => row.optionId === 'move:charm')!.optionId), { role: 'gm' }, context.deps)
    document = stored(context, document.contestId)
    expect(document.appealLedger.at(-1)).toMatchObject({ performerId: trainer.performerId, acceptedResults: expect.arrayContaining([]) })
    expect(document.appealLedger.at(-1)!.acceptedResults.every(result => result === 0)).toBe(true)
    expect(document.pendingInterventionAppealId).toBeNull()
  })

  it('rolls back an ordinary Daily charge when the paired Contest write fails', () => {
    const context = setup()
    const document = preparePerformance(context), actor = contestCurrentContestant(document)!, pokemon = actor.performers.find(contestPerformerIsPokemon)!
    const command = intervention(document, 'fashion-rollback', 'Fashion Designer', actor.contestantId, pokemon.performerId)
    const repository = createSqliteContestRepository(context.database)
    const contests = { ...repository, replace: () => { throw new Error('injected paired Contest write failure') } }
    expect(() => executeContestCommandUseCase(command, { role: 'gm' }, { ...context.deps, contests })).toThrow(/injected paired Contest write failure/)
    expect((context.sheets.getByRef('pokemon', 'pokemon-a')!.sheet as any).abilityUsage).toBeUndefined()
    expect(createSqliteContestRepository(context.database).findOperation(command.operationId)).toBeNull()
    expect(createSqliteContestRepository(context.database).get(document.contestId)!.revision).toBe(document.revision)
  })
})
