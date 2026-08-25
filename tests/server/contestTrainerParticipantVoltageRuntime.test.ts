import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { executeContestCommandUseCase } from '../../server/useCases/contests'
import { createSeededContestRandomSource } from '../../shared/contests/dice'
import { contestCurrentContestant, contestPerformerIsPokemon, contestPerformerIsTrainer, parseContestDocument, type ContestDocumentV1 } from '../../shared/contests/document'
import { emptyContestStatRecord } from '../../shared/contests/ids'
import { projectContestOwner, projectContestPublic } from '../../shared/contests/projections'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })
const operationId = (suffix: string): string => `contest-op:v1:${suffix.padEnd(8, 'x')}`
const base = (contestId: string, commandKind: string, suffix: string, revision: number) => ({ schemaVersion: 1, contestId, commandKind, operationId: operationId(suffix), expectedRevision: revision, clientId: 'trainer-voltage-runtime' })
const emptySpend = () => emptyContestStatRecord(() => 0)

const setup = (rotation = false) => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  for (const [index, suffix] of ['a', 'b', 'c'].entries()) {
    sheets.save({ kind: 'trainer', slug: `trainer-${suffix}`, revision: 0, updatedAt: 1, document: { slug: `trainer-${suffix}`, name: `Trainer ${suffix.toUpperCase()}`, level: 8, skills: { charm: { rankBonus: index } }, movelist: [{ name: 'Charm' }, { name: 'Tackle' }, { name: 'Triple Axel' }, { name: 'Howl' }, { name: 'Overdrive' }], currentTeam: rotation ? [1, 2, 3].map(number => `pokemon-${suffix}-${number}`) : [`pokemon-${suffix}`] } })
    for (const number of rotation ? [1, 2, 3] : [null]) {
      const slug = number === null ? `pokemon-${suffix}` : `pokemon-${suffix}-${number}`
      sheets.save({ kind: 'pokemon', slug, revision: 0, updatedAt: 1, document: { slug, nickname: `Partner ${suffix.toUpperCase()}${number ?? ''}`, species: 'Pikachu', level: 10, stats: { spd: { base: 10 + index * 5 + (number ?? 0) } }, movelist: [{ name: 'Growl' }, { name: 'Tackle' }, { name: 'Nuzzle' }] } })
    }
  }
  const seeded = createSeededContestRandomSource(580)
  let randomCalls = 0, now = 800
  const deps = { database, random: { nextInteger: (minimum: number, maximum: number) => { randomCalls += 1; return seeded.nextInteger(minimum, maximum) } }, now: () => ++now, publishPersistedRealtimeEvent: () => {}, reportAfterCommitPublicationFailure: () => {} }
  return { database, sheets, deps, randomCalls: () => randomCalls }
}

const preparePerformance = (context: ReturnType<typeof setup>, rotation = false): ContestDocumentV1 => {
  const contestId = 'contest:v1:trainer-voltage-runtime'
  let response = executeContestCommandUseCase({ ...base(contestId, 'create-contest', 'create-voltage', 0), settings: { name: 'Paired Voltage', hallName: 'Voltage Hall', description: '', variantId: rotation ? 'rotation' : 'standard', participantVariantId: 'trainer-participant', participantMethodId: 'simultaneous', contestTypeId: 'cute', significanceMultiplier: 1, awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '' } }, { role: 'gm' }, context.deps)
  for (const suffix of ['a', 'b', 'c']) response = executeContestCommandUseCase({ ...base(contestId, 'enroll-contestant', `enroll-${suffix}`, response.result.revision), contestantId: `contestant:entry-${suffix}`, trainerSheetSlug: `trainer-${suffix}`, pokemonSheetSlugs: rotation ? [1, 2, 3].map(number => `pokemon-${suffix}-${number}`) : [`pokemon-${suffix}`], controller: { kind: 'gm' }, rotationOrder: rotation ? [0, 1, 2] : [] }, { role: 'gm' }, context.deps)
  response = executeContestCommandUseCase(base(contestId, 'start-introduction', 'start-intro', response.result.revision), { role: 'gm' }, context.deps)
  for (const suffix of ['a', 'b', 'c']) response = executeContestCommandUseCase({ ...base(contestId, 'declare-introduction', `intro-${suffix}`, response.result.revision), contestantId: `contestant:entry-${suffix}`, skillId: 'charm', generatedStatId: 'cute', bonusStatIds: {} }, { role: 'gm' }, context.deps)
  executeContestCommandUseCase(base(contestId, 'start-performance', 'start-performance', response.result.revision), { role: 'gm' }, context.deps)
  return createSqliteContestRepository(context.database).get(contestId)!.document
}
const appeal = (document: ContestDocumentV1, suffix: string, performerId: string, moveOptionId: string, partnerEffectTargetPerformerId: string | null = null) => ({ ...base(document.contestId, 'declare-appeal', suffix, document.revision), contestantId: contestCurrentContestant(document)!.contestantId, performerId, moveOptionId, partnerEffectTargetPerformerId, spentDice: emptySpend() })
const acceptedAtCurrentTurn = (document: ContestDocumentV1) => document.appealLedger.filter(row => row.round === document.round && row.turn === document.turnIndex + 1 && row.contestantId === contestCurrentContestant(document)?.contestantId)
describe('Trainer Participant paired Voltage runtime', () => {
  it('keeps independent performer Voltage and advances a Simultaneous chart turn only after both members appeal', () => {
    const context = setup()
    let document = preparePerformance(context)
    const current = contestCurrentContestant(document)!, trainer = current.performers.find(contestPerformerIsTrainer)!, pokemon = current.performers.find(contestPerformerIsPokemon)!
    expect(current).toMatchObject({ voltage: 0, performerVoltages: { [trainer.performerId]: 0, [pokemon.performerId]: 0 } })
    const ownerDocument = structuredClone(document) as any; ownerDocument.contestants.find((row: any) => row.contestantId === current.contestantId).controller = { kind: 'profile', profileId: 'profile_voltage01' }
    const ownerBefore = projectContestOwner(parseContestDocument(ownerDocument), 'profile_voltage01')!
    expect(ownerBefore).toMatchObject({ ownsCurrentDecision: true, ownCurrentPerformerId: null, ownLegalPerformerIds: [trainer.performerId, pokemon.performerId] })
    const first = appeal(document, 'trainer-charm', trainer.performerId, 'move:charm')
    executeContestCommandUseCase(first, { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    let updated = document.contestants.find(row => row.contestantId === current.contestantId)!
    expect(document).toMatchObject({ stage: 'performance', round: 1, turnIndex: 0 })
    expect(updated).toMatchObject({ voltage: 0, performerVoltages: { [trainer.performerId]: 2, [pokemon.performerId]: 0 } })
    expect(document.appealLedger.at(-1)).toMatchObject({ performerId: trainer.performerId, voltageBefore: 0, voltageAfter: 2, consequences: [expect.objectContaining({ contestantId: current.contestantId, performerId: trainer.performerId, voltageDelta: 2, reason: 'Excitement' })] })
    const publicAfter = projectContestPublic(document)
    const publicPair = publicAfter.scoreboard.find(row => row.contestantId === current.contestantId)!
    expect(publicPair.performers).toEqual([
      expect.objectContaining({ performerKind: 'pokemon', displayName: pokemon.displayName, activePerformer: true, voltage: 0 }),
      expect.objectContaining({ performerKind: 'trainer', displayName: trainer.displayName, activePerformer: true, voltage: 2 }),
    ])
    expect(JSON.stringify(publicPair)).not.toContain('providerIds')
    expect(JSON.stringify(publicPair)).not.toContain('performerId')
    const ownerAfterDocument = structuredClone(document) as any; ownerAfterDocument.contestants.find((row: any) => row.contestantId === current.contestantId).controller = { kind: 'profile', profileId: 'profile_voltage01' }
    const ownerAfter = projectContestOwner(parseContestDocument(ownerAfterDocument), 'profile_voltage01')!
    expect(ownerAfter).toMatchObject({ ownCurrentPerformerId: pokemon.performerId, ownLegalPerformerIds: [pokemon.performerId] })
    expect(ownerAfter.ownContestant.performerVoltages).toMatchObject({ [trainer.performerId]: 2, [pokemon.performerId]: 0 })
    const forgedVoltage = structuredClone(document) as any
    forgedVoltage.contestants.find((row: any) => row.contestantId === current.contestantId).performerVoltages[pokemon.performerId] = 1
    expect(() => parseContestDocument(forgedVoltage)).toThrow(/does not reconcile with accepted performer appeal/)
    const missingVoltage = structuredClone(document) as any
    delete missingVoltage.contestants.find((row: any) => row.contestantId === current.contestantId).performerVoltages[pokemon.performerId]
    expect(() => parseContestDocument(missingVoltage)).toThrow(/exact per-performer Voltage/)
    const callsAfterFirst = context.randomCalls()
    const retry = executeContestCommandUseCase(first, { role: 'gm' }, context.deps)
    expect(retry.result.exactRetry).toBe(true)
    expect(context.randomCalls()).toBe(callsAfterFirst)
    expect(() => executeContestCommandUseCase(appeal(document, 'trainer-again', trainer.performerId, 'move:tackle'), { role: 'gm' }, context.deps)).toThrow(/not active for this appeal/)
    executeContestCommandUseCase(appeal(document, 'pokemon-growl', pokemon.performerId, 'move:growl'), { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    updated = document.contestants.find(row => row.contestantId === current.contestantId)!
    expect(document.turnIndex).toBe(1)
    expect(updated).toMatchObject({ voltage: 0, performerVoltages: { [trainer.performerId]: 2, [pokemon.performerId]: 2 } })
    expect(document.appealLedger.slice(-2).map(row => row.performerId)).toEqual([trainer.performerId, pokemon.performerId])
  })

  it('applies an explicit Get Ready choice to the same-turn partner once without retaining a second multiplier', () => {
    const context = setup()
    let document = preparePerformance(context)
    const current = contestCurrentContestant(document)!, trainer = current.performers.find(contestPerformerIsTrainer)!, pokemon = current.performers.find(contestPerformerIsPokemon)!
    executeContestCommandUseCase(appeal(document, 'partner-get-ready', trainer.performerId, 'move:howl', pokemon.performerId), { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    expect(document.appealLedger.at(-1)).toMatchObject({ performerId: trainer.performerId, effectId: 'get-ready', partnerEffectTargetPerformerId: pokemon.performerId, baseMoveDiceMultiplier: 1 })
    executeContestCommandUseCase(appeal(document, 'partner-ready-use', pokemon.performerId, 'move:growl'), { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    const partnerAppeal = document.appealLedger.at(-1)!
    expect(partnerAppeal).toMatchObject({ performerId: pokemon.performerId, baseMoveDiceMultiplier: 2 })
    expect(partnerAppeal.contributors.find(row => row.id === 'effect:excitement')).toMatchObject({ dice: 6 })
    expect(partnerAppeal.contributors.find(row => row.id === 'effect:excitement')!.explanation).toContain('×2')
    const forged = structuredClone(document) as any
    forged.appealLedger.at(-1).baseMoveDiceMultiplier = 1
    expect(() => parseContestDocument(forged)).toThrow(/Get Ready authority|base contributor explanation/)
  })

  it('can transfer Attention Grabber gains to the paired member while debiting both adjacent pairs', () => {
    const context = setup()
    let document = preparePerformance(context)
    const opening = contestCurrentContestant(document)!, openingTrainer = opening.performers.find(contestPerformerIsTrainer)!, openingPokemon = opening.performers.find(contestPerformerIsPokemon)!
    executeContestCommandUseCase(appeal(document, 'seed-adjacent', openingTrainer.performerId, 'move:triple-axel'), { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    executeContestCommandUseCase(appeal(document, 'seed-complete', openingPokemon.performerId, 'move:growl'), { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    const actor = contestCurrentContestant(document)!, trainer = actor.performers.find(contestPerformerIsTrainer)!, pokemon = actor.performers.find(contestPerformerIsPokemon)!, trainerBefore = actor.performerVoltages[trainer.performerId], pokemonBefore = actor.performerVoltages[pokemon.performerId]
    expect(trainerBefore).toBe(1); expect(pokemonBefore).toBe(1)
    executeContestCommandUseCase(appeal(document, 'transfer-attention', trainer.performerId, 'move:overdrive', pokemon.performerId), { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    const accepted = document.appealLedger.at(-1)!, updated = document.contestants.find(row => row.contestantId === actor.contestantId)!
    expect(accepted).toMatchObject({ performerId: trainer.performerId, effectId: 'attention-grabber', partnerEffectTargetPerformerId: pokemon.performerId, voltageBefore: trainerBefore, voltageAfter: trainerBefore })
    const adjacentLoss = -accepted.consequences.filter(row => row.contestantId !== actor.contestantId).reduce((sum, row) => sum + row.voltageDelta, 0)
    const partnerGain = accepted.consequences.find(row => row.contestantId === actor.contestantId && row.performerId === pokemon.performerId)!.voltageDelta
    expect(adjacentLoss).toBeGreaterThan(0)
    expect(partnerGain).toBe(Math.min(5 - pokemonBefore, adjacentLoss))
    expect(updated.performerVoltages[trainer.performerId]).toBe(trainerBefore)
    expect(updated.performerVoltages[pokemon.performerId]).toBe(pokemonBefore + partnerGain)
  })

  it('binds Rotation adjacency and the paired second appeal to each round-locked Pokémon only', () => {
    const context = setup(true)
    let document = preparePerformance(context, true)
    const actor = contestCurrentContestant(document)!, trainer = actor.performers.find(contestPerformerIsTrainer)!, activePokemon = actor.performers[actor.rotationOrder[0]!]!, inactivePokemon = actor.performers.filter(contestPerformerIsPokemon).find(performer => performer.performerId !== activePokemon.performerId)!
    expect(Object.keys(actor.performerVoltages)).toHaveLength(4)
    executeContestCommandUseCase(appeal(document, 'rotation-special', trainer.performerId, 'move:triple-axel'), { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    const accepted = document.appealLedger.at(-1)!
    for (const targetId of accepted.adjacentContestantIds) {
      const target = document.contestants.find(row => row.contestantId === targetId)!, targetTrainer = target.performers.find(contestPerformerIsTrainer)!, targetActive = target.performers[target.rotationOrder[0]!]!
      expect(target.performerVoltages[targetTrainer.performerId]).toBe(1)
      expect(target.performerVoltages[targetActive.performerId]).toBe(1)
      expect(target.performers.filter(contestPerformerIsPokemon).filter(performer => performer.performerId !== targetActive.performerId).every(performer => target.performerVoltages[performer.performerId] === 0)).toBe(true)
    }
    expect(() => executeContestCommandUseCase(appeal(document, 'rotation-inactive', inactivePokemon.performerId, inactivePokemon.moves.find(row => row.available)!.optionId), { role: 'gm' }, context.deps)).toThrow(/not active for this appeal/)
    executeContestCommandUseCase(appeal(document, 'rotation-active', activePokemon.performerId, activePokemon.moves.find(row => row.optionId === 'move:growl')!.optionId), { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    expect(document.turnIndex).toBe(1)
    expect(document.appealLedger.slice(-2).map(row => row.performerId)).toEqual([trainer.performerId, activePokemon.performerId])
  })

  it('completes two distinct appeals at every Simultaneous chart cursor and keeps ambiguous Voltage corrections fail-closed', () => {
    const context = setup()
    let document = preparePerformance(context), sequence = 0
    while (document.stage === 'performance') {
      const current = contestCurrentContestant(document)!, accepted = acceptedAtCurrentTurn(document)
      const trainer = current.performers.find(contestPerformerIsTrainer)!, pokemon = current.performers.find(contestPerformerIsPokemon)!
      const performer = accepted.length ? (accepted[0]!.performerId === trainer.performerId ? pokemon : trainer) : sequence % 2 === 0 ? trainer : pokemon
      const previous = [...document.appealLedger].reverse().find(row => row.contestantId === current.contestantId && row.performerId === performer.performerId)
      const option = performer.moves.find(row => row.available && row.optionId !== previous?.moveOptionId)!
      executeContestCommandUseCase(appeal(document, `complete-${sequence++}`, performer.performerId, option.optionId), { role: 'gm' }, context.deps)
      document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    }
    expect(document.stage).toBe('settling')
    expect(document.appealLedger).toHaveLength(18)
    const cursorGroups = new Map<string, typeof document.appealLedger>()
    for (const row of document.appealLedger) { const key = `${row.round}:${row.turn}:${row.contestantId}`; cursorGroups.set(key, [...(cursorGroups.get(key) ?? []), row]) }
    expect(cursorGroups.size).toBe(9)
    expect([...cursorGroups.values()].every(rows => rows.length === 2 && new Set(rows.map(row => row.performerId)).size === 2)).toBe(true)
    expect(document.contestants.every(row => row.voltage === 0 && Object.keys(row.performerVoltages).length === 2 && Object.values(row.performerVoltages).every(voltage => voltage >= 0 && voltage <= 5))).toBe(true)
    expect(() => parseContestDocument(document)).not.toThrow()

    const target = document.contestants[0]!, correction = { ...base(document.contestId, 'apply-correction', 'ambiguous-voltage', document.revision), correctionKind: 'voltage-delta', contestantId: target.contestantId, statId: null, numericDelta: 1, replacementProfileId: null, reason: 'Attempt ambiguous shared correction.' }
    expect(() => executeContestCommandUseCase(correction, { role: 'gm' }, context.deps)).toThrow(/exact performer identity/)
    expect(createSqliteContestRepository(context.database).get(document.contestId)!.revision).toBe(document.revision)
    expect(createSqliteContestRepository(context.database).findOperation(operationId('ambiguous-voltage'))).toBeNull()
  })

  it('previews and atomically commits ordinary placement XP, Ribbon, and result receipts for paired entries', () => {
    const context = setup()
    let document = preparePerformance(context), sequence = 0
    while (document.stage === 'performance') {
      const current = contestCurrentContestant(document)!, accepted = acceptedAtCurrentTurn(document)
      const trainer = current.performers.find(contestPerformerIsTrainer)!, pokemon = current.performers.find(contestPerformerIsPokemon)!
      const performer = accepted.length ? (accepted[0]!.performerId === trainer.performerId ? pokemon : trainer) : sequence % 2 === 0 ? trainer : pokemon
      const previous = [...document.appealLedger].reverse().find(row => row.contestantId === current.contestantId && row.performerId === performer.performerId)
      const option = performer.moves.find(row => row.available && row.optionId !== previous?.moveOptionId)!
      executeContestCommandUseCase(appeal(document, `settle-${sequence++}`, performer.performerId, option.optionId), { role: 'gm' }, context.deps)
      document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    }
    const prepare = base(document.contestId, 'prepare-settlement', 'prepare-paired', document.revision)
    let response = executeContestCommandUseCase(prepare, { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    expect(document).toMatchObject({ stage: 'settling', settlement: { status: 'preview' } })
    expect(document.settlement!.entries).toHaveLength(3)
    for (const entry of document.settlement!.entries) {
      const contestant = document.contestants.find(row => row.contestantId === entry.contestantId)!
      expect(entry.experienceByPokemon).toHaveLength(1)
      expect(entry.experienceByPokemon[0]!.pokemonSheetSlug).toBe(contestant.performers.find(contestPerformerIsPokemon)!.pokemonSheetSlug)
      expect(entry.experienceByPokemon[0]!.experience).toBe(10 * Math.ceil((3 - entry.placement + 1) / 2))
    }
    const commit = base(document.contestId, 'commit-settlement', 'commit-paired', response.result.revision)
    response = executeContestCommandUseCase(commit, { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    expect(document).toMatchObject({ stage: 'completed', settlement: { status: 'committed', committedOperationId: commit.operationId } })
    const winner = document.contestants.find(row => row.finalPlacement === 1)!
    for (const contestant of document.contestants) {
      const trainerSheet = context.database.connection.prepare("SELECT document_json FROM sheets WHERE kind = 'trainer' AND slug = ?").get(contestant.trainerSheetSlug) as { document_json: string }
      const result = JSON.parse(trainerSheet.document_json).contestResults.at(-1)
      expect(result).toMatchObject({ contestId: document.contestId, placement: contestant.finalPlacement, pokemonSheetSlugs: [contestant.performers.find(contestPerformerIsPokemon)!.pokemonSheetSlug] })
    }
    const winningPokemon = winner.performers.find(contestPerformerIsPokemon)!
    const pokemonSheet = JSON.parse((context.database.connection.prepare("SELECT document_json FROM sheets WHERE kind = 'pokemon' AND slug = ?").get(winningPokemon.pokemonSheetSlug) as { document_json: string }).document_json)
    expect(pokemonSheet.contestRibbons).toContainEqual(expect.objectContaining({ contestId: document.contestId, placement: 1, pokemonSheetSlug: winningPokemon.pokemonSheetSlug }))
    const revisionAfterCommit = context.sheets.getByRef('pokemon', winningPokemon.pokemonSheetSlug)!.revision
    expect(executeContestCommandUseCase(commit, { role: 'gm' }, context.deps).result.exactRetry).toBe(true)
    expect(context.sheets.getByRef('pokemon', winningPokemon.pokemonSheetSlug)!.revision).toBe(revisionAfterCommit)
  })

  it('rolls back every paired reward write when one sheet commit conflicts', () => {
    const context = setup()
    let document = preparePerformance(context), sequence = 0
    while (document.stage === 'performance') {
      const current = contestCurrentContestant(document)!, accepted = acceptedAtCurrentTurn(document)
      const trainer = current.performers.find(contestPerformerIsTrainer)!, pokemon = current.performers.find(contestPerformerIsPokemon)!
      const performer = accepted.length ? (accepted[0]!.performerId === trainer.performerId ? pokemon : trainer) : trainer
      const previous = [...document.appealLedger].reverse().find(row => row.contestantId === current.contestantId && row.performerId === performer.performerId)
      const option = performer.moves.find(row => row.available && row.optionId !== previous?.moveOptionId)!
      executeContestCommandUseCase(appeal(document, `conflict-${sequence++}`, performer.performerId, option.optionId), { role: 'gm' }, context.deps)
      document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    }
    executeContestCommandUseCase(base(document.contestId, 'prepare-settlement', 'prepare-conflict', document.revision), { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    const original = context.sheets.applyLivePlayUpdate.bind(context.sheets)
    let writes = 0
    ;(context.sheets as any).applyLivePlayUpdate = (input: unknown) => ++writes === 2 ? 'conflict' : original(input as never)
    const commit = base(document.contestId, 'commit-settlement', 'commit-conflict', document.revision)
    expect(() => executeContestCommandUseCase(commit, { role: 'gm' }, { ...context.deps, sheets: context.sheets })).toThrow(/changed during settlement/)
    expect(createSqliteContestRepository(context.database).get(document.contestId)!.document).toMatchObject({ revision: document.revision, stage: 'settling', settlement: { status: 'preview' } })
    expect(createSqliteContestRepository(context.database).findOperation(commit.operationId)).toBeNull()
    for (const suffix of ['a', 'b', 'c']) expect((context.sheets.getByRef('trainer', `trainer-${suffix}`)!.sheet as any).contestResults).toBeUndefined()
  })

  it('applies adjacent Voltage effects to both paired members and assembles both values without duplicating chart position', () => {
    const context = setup()
    let document = preparePerformance(context)
    const actor = contestCurrentContestant(document)!, trainer = actor.performers.find(contestPerformerIsTrainer)!, pokemon = actor.performers.find(contestPerformerIsPokemon)!
    executeContestCommandUseCase(appeal(document, 'paired-special', trainer.performerId, 'move:triple-axel'), { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    const special = document.appealLedger.at(-1)!, actorAfterSpecial = document.contestants.find(row => row.contestantId === actor.contestantId)!
    expect(document.turnIndex).toBe(0)
    expect(special).toMatchObject({ contestantId: actor.contestantId, performerId: trainer.performerId, effectId: 'special-attention' })
    expect(special.centerOfAttention).toBe(special.adjacentContestantIds.length === 2)
    expect(actorAfterSpecial.performerVoltages).toMatchObject({ [trainer.performerId]: 0, [pokemon.performerId]: 0 })
    for (const targetId of special.adjacentContestantIds) {
      const target = document.contestants.find(row => row.contestantId === targetId)!
      const pairedIds = target.performers.map(performer => performer.performerId)
      expect(pairedIds.map(performerId => target.performerVoltages[performerId])).toEqual([1, 1])
      expect(special.consequences.filter(row => row.contestantId === targetId).map(row => row.performerId).sort()).toEqual([...pairedIds].sort())
    }
    expect(special.consequences).toHaveLength(special.adjacentContestantIds.length * 2)

    executeContestCommandUseCase(appeal(document, 'paired-double', pokemon.performerId, 'move:nuzzle'), { role: 'gm' }, context.deps)
    document = createSqliteContestRepository(context.database).get(document.contestId)!.document
    const doubled = document.appealLedger.at(-1)!
    expect(doubled).toMatchObject({ contestantId: actor.contestantId, performerId: pokemon.performerId, effectId: 'double-time', centerOfAttention: special.centerOfAttention, adjacentContestantIds: special.adjacentContestantIds })
    expect(doubled.contributors.find(row => row.kind === 'base')).toMatchObject({ dice: special.adjacentContestantIds.length * 2 })
    expect(document.turnIndex).toBe(1)

    const forged = structuredClone(document) as any
    const consequence = forged.appealLedger.at(-2).consequences[0]
    consequence.performerId = forged.contestants.find((row: any) => row.contestantId === consequence.contestantId).performers[0].performerId === consequence.performerId
      ? 'performer:not-enrolled'
      : forged.contestants.find((row: any) => row.contestantId === consequence.contestantId).performers[0].performerId
    expect(() => parseContestDocument(forged)).toThrow(/outside the target entry|exact acting or adjacent paired performer|duplicates canonical effect evidence/)
  })
})
