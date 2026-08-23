import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { executeContestCommandUseCase, loadContestUseCase } from '../../server/useCases/contests'
import { createSeededContestRandomSource } from '../../shared/contests/dice'
import { contestCurrentContestant, contestPerformerIsPokemon, contestPerformerIsTrainer, parseContestDocument, type ContestDocumentV1 } from '../../shared/contests/document'
import { CONTEST_STAT_IDS, emptyContestStatRecord } from '../../shared/contests/ids'
import type { ContestGmProjectionV1 } from '../../shared/contests/projections'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const operationId = (suffix: string): string => `contest-op:v1:${suffix.padEnd(8, 'x')}`
const base = (contestId: string, commandKind: string, suffix: string, revision: number) => ({ schemaVersion: 1, contestId, commandKind, operationId: operationId(suffix), expectedRevision: revision, clientId: 'trainer-appeal-runtime' })
const emptySpend = () => emptyContestStatRecord(() => 0)

const setup = (rotation = false) => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  for (const [index, suffix] of ['a', 'b', 'c'].entries()) {
    sheets.save({
      kind: 'trainer', slug: `trainer-${suffix}`, revision: 0, updatedAt: 1,
      document: {
        slug: `trainer-${suffix}`, name: `Trainer ${suffix.toUpperCase()}`, level: 8, skills: { charm: { rankBonus: index } },
        movelist: [{ name: 'Charm' }, { name: 'Tackle' }, { name: 'Howl' }, { name: 'Bash!' }, { name: `Unreviewed Appeal ${suffix.toUpperCase()}` }], currentTeam: rotation ? [1, 2, 3].map(number => `pokemon-${suffix}-${number}`) : [`pokemon-${suffix}`],
      },
    })
    for (const number of rotation ? [1, 2, 3] : [null]) {
      const pokemonSlug = number === null ? `pokemon-${suffix}` : `pokemon-${suffix}-${number}`
      sheets.save({ kind: 'pokemon', slug: pokemonSlug, revision: 0, updatedAt: 1, document: { slug: pokemonSlug, nickname: `Partner ${suffix.toUpperCase()}${number ?? ''}`, species: 'Pikachu', level: 10, stats: { spd: { base: 10 + index * 5 + (number ?? 0) } }, movelist: [{ name: 'Growl' }, { name: 'Tackle' }] } })
    }
  }
  const profiles = new Map(['a', 'b', 'c'].map(suffix => {
    const profile = { id: `profile_owner${suffix}001`, displayName: `Owner ${suffix.toUpperCase()}`, linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: `trainer-${suffix}` }, { sheetKind: 'pokemon', sheetSlug: `pokemon-${suffix}` }], createdAt: 1, updatedAt: 1 }
    return [profile.id, profile] as const
  }))
  const seeded = createSeededContestRandomSource(570)
  let randomCalls = 0, now = 700
  const deps = {
    database,
    random: { nextInteger: (minimum: number, maximum: number) => { randomCalls += 1; return seeded.nextInteger(minimum, maximum) } },
    now: () => ++now,
    publishPersistedRealtimeEvent: () => {},
    reportAfterCommitPublicationFailure: () => {},
    readProfile: (profileId: unknown) => typeof profileId === 'string' ? profiles.get(profileId) ?? null : null,
  }
  return { database, deps, profiles, randomCalls: () => randomCalls }
}

const preparePerformance = (context: ReturnType<typeof setup>, profileControllers = false, rotation = false): ContestDocumentV1 => {
  const contestId = 'contest:v1:trainer-appeals-runtime'
  let response = executeContestCommandUseCase({
    ...base(contestId, 'create-contest', 'create-appeals', 0),
    settings: { name: 'Trainer Appeals', hallName: 'Appeal Hall', description: '', variantId: rotation ? 'rotation' : 'standard', participantVariantId: 'trainer-participant', participantMethodId: 'alternating', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '' },
  }, { role: 'gm' }, context.deps)
  for (const suffix of ['a', 'b', 'c']) response = executeContestCommandUseCase({
    ...base(contestId, 'enroll-contestant', `enroll-${suffix}`, response.result.revision), contestantId: `contestant:entry-${suffix}`, trainerSheetSlug: `trainer-${suffix}`, pokemonSheetSlugs: rotation ? [1, 2, 3].map(number => `pokemon-${suffix}-${number}`) : [`pokemon-${suffix}`], controller: profileControllers ? { kind: 'profile', profileId: `profile_owner${suffix}001` } : { kind: 'gm' }, rotationOrder: rotation ? [0, 1, 2] : [],
  }, { role: 'gm' }, context.deps)
  response = executeContestCommandUseCase(base(contestId, 'start-introduction', 'start-intro', response.result.revision), { role: 'gm' }, context.deps)
  for (const suffix of ['a', 'b', 'c']) response = executeContestCommandUseCase({
    ...base(contestId, 'declare-introduction', `intro-${suffix}`, response.result.revision), contestantId: `contestant:entry-${suffix}`, skillId: 'charm', generatedStatId: 'cute', bonusStatIds: {},
  }, { role: 'gm' }, context.deps)
  response = executeContestCommandUseCase(base(contestId, 'start-performance', 'start-performance', response.result.revision), { role: 'gm' }, context.deps)
  expect(response.projection).toMatchObject({ stage: 'performance', round: 1, turnIndex: 0, participantMethodId: 'alternating' })
  return createSqliteContestRepository(context.database).get(contestId)!.document
}

const appealCommand = (document: ContestDocumentV1, suffix: string, performerId: string, moveOptionId: string, spentDice = emptySpend()) => ({
  ...base(document.contestId, 'declare-appeal', suffix, document.revision), contestantId: contestCurrentContestant(document)!.contestantId, performerId, moveOptionId, spentDice,
})

const legalAlternatingPerformer = (document: ContestDocumentV1) => {
  const contestant = contestCurrentContestant(document)!
  const previous = [...document.appealLedger].reverse().find(appeal => appeal.contestantId === contestant.contestantId)
  const previousPerformer = previous ? contestant.performers.find(performer => performer.performerId === previous.performerId) : null
  return previousPerformer && contestPerformerIsTrainer(previousPerformer)
    ? contestant.performers.find(contestPerformerIsPokemon)!
    : previousPerformer && contestPerformerIsPokemon(previousPerformer)
      ? contestant.performers.find(contestPerformerIsTrainer)!
      : contestant.performers.find(contestPerformerIsTrainer)!
}

describe('Trainer Participant appeal runtime', () => {
  it('uses exact Trainer Move authority, rejects weapon/unknown identities without rolling, and recovers accepted appeal replay', () => {
    const context = setup()
    let document = preparePerformance(context)
    const current = contestCurrentContestant(document)!, trainer = current.performers.find(contestPerformerIsTrainer)!
    expect(trainer.moves).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Charm', optionId: 'move:charm', typeId: 'cute', effectId: 'excitement', available: true }),
      expect.objectContaining({ label: 'Bash!', optionId: 'weapon-move:bash', available: false, unavailableCode: 'weapon-move-no-canonical-contest-identity', unavailableReason: 'Weapon Moves have no reviewed canonical Contest identity.' }),
      expect.objectContaining({ available: false, unavailableCode: 'contest.move-identity-missing' }),
    ]))
    const callsBeforeFailures = context.randomCalls(), revisionBeforeFailures = document.revision
    expect(() => executeContestCommandUseCase(appealCommand(document, 'weapon-fail', trainer.performerId, 'weapon-move:bash'), { role: 'gm' }, context.deps)).toThrow(/no reviewed canonical Contest identity/)
    expect(() => executeContestCommandUseCase(appealCommand(document, 'unknown-fail', trainer.performerId, trainer.moves.find(move => move.unavailableCode === 'contest.move-identity-missing')!.optionId), { role: 'gm' }, context.deps)).toThrow(/reviewed Contest identity binding/)
    expect(context.randomCalls()).toBe(callsBeforeFailures)
    expect(createSqliteContestRepository(context.database).get(document.contestId)!.revision).toBe(revisionBeforeFailures)
    expect(createSqliteContestRepository(context.database).findOperation(operationId('weapon-fail'))).toBeNull()
    expect(createSqliteContestRepository(context.database).findOperation(operationId('unknown-fail'))).toBeNull()

    const pairedPokemon = current.performers.find(contestPerformerIsPokemon)!
    expect(pairedPokemon.dicePools.cute.remaining).toBeGreaterThan(0)
    const sharedSpend = { ...emptySpend(), cute: 1 }
    const command = appealCommand(document, 'trainer-charm', trainer.performerId, 'move:charm', sharedSpend)
    const accepted = executeContestCommandUseCase(command, { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    const ledger = document.appealLedger.at(-1)!
    expect(ledger).toMatchObject({ operationId: operationId('trainer-charm'), contestantId: current.contestantId, performerId: trainer.performerId, moveOptionId: 'move:charm', moveLabel: 'Charm', moveTypeId: 'cute', contestTypeId: 'cute', effectId: 'excitement', voltageBefore: 0, voltageAfter: 2 })
    expect(ledger.acceptedResults).toEqual(document.diceJournal.find(journal => journal.journalId === ledger.journalIds[0])!.results)
    expect(ledger.appealDelta).toBeGreaterThanOrEqual(0)
    expect(ledger.fumbleDelta).toBeGreaterThanOrEqual(0)
    expect(CONTEST_STAT_IDS.every(statId => trainer.dicePools[statId].total === 0)).toBe(true)
    expect(document.contestants.find(row => row.contestantId === current.contestantId)!.sharedDiceSpendJournal.at(-1)).toMatchObject({ performerId: trainer.performerId, pokemonPerformerId: pairedPokemon.performerId, spentDice: sharedSpend, pokemonSpentDice: sharedSpend })
    const callsAfterAccepted = context.randomCalls()
    const retry = executeContestCommandUseCase(command, { role: 'gm' }, context.deps)
    expect(retry.result).toMatchObject({ exactRetry: true, revision: accepted.result.revision })
    expect(context.randomCalls()).toBe(callsAfterAccepted)
    expect(createSqliteContestRepository(context.database).get(document.contestId)!.document.appealLedger).toHaveLength(1)
  })

  it('pairs a Rotation Trainer appeal with the round-locked Pokémon while spending the team Introduction pool first', () => {
    const context = setup(true)
    let document = preparePerformance(context, false, true)
    const current = contestCurrentContestant(document)!, trainer = current.performers.find(contestPerformerIsTrainer)!
    const pokemonIndex = current.rotationOrder[document.round - 1]!
    const pairedPokemon = current.performers[pokemonIndex]!
    expect(contestPerformerIsPokemon(pairedPokemon)).toBe(true)
    expect(current.teamDicePools.cute.remaining).toBeGreaterThan(0)
    const spentDice = { ...emptySpend(), cute: 1 }
    executeContestCommandUseCase(appealCommand(document, 'rotation-trainer', trainer.performerId, 'move:charm', spentDice), { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    const accepted = document.contestants.find(row => row.contestantId === current.contestantId)!
    expect(accepted.sharedDiceSpendJournal.at(-1)).toMatchObject({ performerId: trainer.performerId, pokemonPerformerId: pairedPokemon.performerId, spentDice, teamSpentDice: spentDice, pokemonSpentDice: emptySpend() })
    expect(accepted.teamDicePools.cute.remaining).toBe(current.teamDicePools.cute.remaining - 1)
    expect(CONTEST_STAT_IDS.every(statId => accepted.performers.find(contestPerformerIsTrainer)!.dicePools[statId].total === 0)).toBe(true)
  })

  it('lets only the snapshotted entry controller declare its Trainer appeal', () => {
    const context = setup()
    let document = preparePerformance(context, true)
    const current = contestCurrentContestant(document)!, trainer = current.performers.find(contestPerformerIsTrainer)!
    expect(current.controller.kind).toBe('profile')
    const command = appealCommand(document, 'owner-appeal', trainer.performerId, 'move:charm')
    const currentOwnerId = current.controller.kind === 'profile' ? current.controller.profileId : null
    const ownerBefore = loadContestUseCase(document.contestId, { role: 'player', playerProfile: context.profiles.get(currentOwnerId!) as never }, context.deps)
    expect(ownerBefore).toMatchObject({ audience: 'owner', ownsCurrentDecision: true, ownCurrentPerformerId: null, ownLegalPerformerIds: [trainer.performerId, current.performers.find(contestPerformerIsPokemon)!.performerId] })
    const callsBefore = context.randomCalls(), revisionBefore = document.revision
    const otherProfileId = [...context.profiles.keys()].find(profileId => profileId !== currentOwnerId)!
    expect(() => executeContestCommandUseCase(command, { role: 'player', playerProfile: context.profiles.get(otherProfileId) as never }, context.deps)).toThrow(/controller/i)
    expect(context.randomCalls()).toBe(callsBefore)
    expect(createSqliteContestRepository(context.database).get(document.contestId)!.revision).toBe(revisionBefore)
    const ownerProfileId = current.controller.kind === 'profile' ? current.controller.profileId : null
    const accepted = executeContestCommandUseCase(command, { role: 'player', playerProfile: context.profiles.get(ownerProfileId!) as never }, context.deps)
    expect(accepted.result).toMatchObject({ exactRetry: false, revision: revisionBefore + 1 })
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    expect(document.appealLedger.at(-1)).toMatchObject({ performerId: trainer.performerId, contestantId: current.contestantId })
  })

  it('keeps Get Ready on the same alternating performer instead of letting the partner consume it', () => {
    const context = setup()
    let document = preparePerformance(context), sequence = 0
    const target = contestCurrentContestant(document)!, trainer = target.performers.find(contestPerformerIsTrainer)!
    executeContestCommandUseCase(appealCommand(document, 'trainer-get-ready', trainer.performerId, 'move:howl'), { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    expect(document.appealLedger.at(-1)).toMatchObject({ contestantId: target.contestantId, performerId: trainer.performerId, effectId: 'get-ready' })
    let doubledAppeal = null as ContestDocumentV1['appealLedger'][number] | null
    while (document.stage === 'performance' && !doubledAppeal) {
      const current = contestCurrentContestant(document)!, legal = legalAlternatingPerformer(document)
      const previousForPerformer = [...document.appealLedger].reverse().find(appeal => appeal.contestantId === current.contestantId && appeal.performerId === legal.performerId)
      const option = current.contestantId === target.contestantId && legal.performerId === trainer.performerId
        ? legal.moves.find(move => move.optionId === 'move:charm')!
        : legal.moves.find(move => move.available && move.optionId !== previousForPerformer?.moveOptionId)!
      executeContestCommandUseCase(appealCommand(document, `ready-follow-${sequence++}`, legal.performerId, option.optionId), { role: 'gm' }, context.deps)
      document = createSqliteContestRepository(context.database).get(document.contestId)!.document
      if (current.contestantId === target.contestantId && legal.performerId === trainer.performerId) doubledAppeal = document.appealLedger.at(-1)!
    }
    expect(doubledAppeal).toMatchObject({ performerId: trainer.performerId, effectId: 'excitement' })
    expect(doubledAppeal!.contributors.find(contributor => contributor.id === 'effect:excitement')).toMatchObject({ dice: 6 })
    expect(doubledAppeal!.contributors.find(contributor => contributor.id === 'effect:excitement')!.explanation).toContain('×2')
    const partnerAppeal = document.appealLedger.find(appeal => appeal.contestantId === target.contestantId && appeal.performerId !== trainer.performerId)!
    expect(partnerAppeal.contributors.find(contributor => contributor.kind === 'base')!.explanation).not.toContain('×2')
  })

  it('enforces exact alternation, preserves ordinary scoring/fumble/effect journals, and stops before reward settlement', () => {
    const context = setup()
    let document = preparePerformance(context), sequence = 0
    while (document.stage === 'performance') {
      const current = contestCurrentContestant(document)!, legal = legalAlternatingPerformer(document)
      const previous = [...document.appealLedger].reverse().find(appeal => appeal.contestantId === current.contestantId)
      if (previous) {
        const priorPerformer = current.performers.find(performer => performer.performerId === previous.performerId)!
        const callsBefore = context.randomCalls()
        const illegal = priorPerformer.moves.find(move => move.available)!
        expect(() => executeContestCommandUseCase(appealCommand(document, `repeat-kind-${sequence}`, priorPerformer.performerId, illegal.optionId), { role: 'gm' }, context.deps)).toThrow(/not active for this appeal/)
        expect(context.randomCalls()).toBe(callsBefore)
      }
      const previousForPerformer = [...document.appealLedger].reverse().find(appeal => appeal.contestantId === current.contestantId && appeal.performerId === legal.performerId)
      const option = legal.moves.find(move => move.available && move.optionId !== previousForPerformer?.moveOptionId)!
      executeContestCommandUseCase(appealCommand(document, `appeal-${sequence++}`, legal.performerId, option.optionId), { role: 'gm' }, context.deps)
      document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    }
    expect(document.stage).toBe('settling')
    expect(document.appealLedger).toHaveLength(9)
    expect(document.contestants.every(contestant => contestant.finalScore === contestant.appeal - contestant.fumble)).toBe(true)
    expect(document.contestants.map(contestant => contestant.finalPlacement).sort()).toEqual([1, 2, 3])
    expect(() => parseContestDocument(document)).not.toThrow()
    const forgedSequence = structuredClone(document) as any
    const forgedContestant = forgedSequence.contestants[0]
    const forgedAppeals = forgedSequence.appealLedger.filter((appeal: any) => appeal.contestantId === forgedContestant.contestantId)
    const trainer = forgedContestant.performers.find((performer: any) => performer.performerKind === 'trainer')
    forgedAppeals[1].performerId = trainer.performerId; forgedAppeals[1].moveOptionId = 'move:charm'; forgedAppeals[1].moveLabel = 'Charm'
    expect(() => parseContestDocument(forgedSequence)).toThrow(/locked alternating Trainer\/Pokémon sequence/)
    const forgedWeapon = structuredClone(document) as any
    forgedWeapon.appealLedger[0].moveOptionId = 'weapon-move:bash'; forgedWeapon.appealLedger[0].moveLabel = 'Bash!'
    expect(() => parseContestDocument(forgedWeapon)).toThrow(/unavailable or mismatched enrolled option/)
    for (const contestant of document.contestants) {
      const kinds = document.appealLedger.filter(appeal => appeal.contestantId === contestant.contestantId).map(appeal => contestant.performers.find(performer => performer.performerId === appeal.performerId)!.performerKind)
      expect(kinds).toEqual([kinds[0], kinds[0] === 'trainer' ? 'pokemon' : 'trainer', kinds[0]])
    }
    const publicProjection = loadContestUseCase(document.contestId, { role: 'player' }, context.deps)
    expect(publicProjection).toMatchObject({ stage: 'settling' })
    expect(publicProjection.acceptedAppeals).toHaveLength(9)
    expect(publicProjection.acceptedAppeals.every(appeal => appeal.appealDelta >= 0 && appeal.fumbleDelta >= 0)).toBe(true)
    const gm = loadContestUseCase(document.contestId, { role: 'gm' }, context.deps) as ContestGmProjectionV1
    expect(gm.acceptedAppeals.filter(appeal => appeal.performerId.startsWith('performer:trainer-'))).toHaveLength(6)

    const settlementCommand = base(document.contestId, 'prepare-settlement', 'prepare-rewards', document.revision)
    expect(() => executeContestCommandUseCase(settlementCommand, { role: 'gm' }, context.deps)).toThrow(/placements and reward settlement are not active/)
    const stored = createSqliteContestRepository(context.database).get(document.contestId)!
    expect(stored).toMatchObject({ revision: document.revision, document: { settlement: null } })
    expect(createSqliteContestRepository(context.database).findOperation(operationId('prepare-rewards'))).toBeNull()
  })
})
