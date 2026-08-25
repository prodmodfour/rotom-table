import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { ContestUseCaseError, executeContestCommandUseCase, loadContestUseCase } from '../../server/useCases/contests'
import { contestPerformerIsPokemon } from '../../shared/contests/document'
import type { ContestGmProjectionV1, ContestOwnerProjectionV1, ContestPublicProjectionV1 } from '../../shared/contests/projections'

const databases: RotomDatabase[] = []
afterEach(() => { while (databases.length) databases.pop()!.close() })

const operationId = (suffix: string): string => `contest-op:v1:${suffix.replace(/[^a-z0-9-]/giu, '-').padEnd(8, 'x')}`
const commandBase = (contestId: string, commandKind: string, suffix: string, expectedRevision: number) => ({
  schemaVersion: 1,
  contestId,
  commandKind,
  operationId: operationId(suffix),
  expectedRevision,
  clientId: 'battle-setup-test',
})

const setup = () => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const team = (side: 'north' | 'south', trainerName: string) => {
    const trainerSlug = `trainer-${side}`
    const pokemonSlugs = Array.from({ length: 6 }, (_, index) => `pokemon-${side}-${index + 1}`)
    sheets.save({ kind: 'trainer', slug: trainerSlug, revision: 0, updatedAt: 10, document: { slug: trainerSlug, name: trainerName, level: 10, skills: { charm: { rankBonus: 1 }, command: { rankBonus: 2 } }, currentTeam: pokemonSlugs } })
    pokemonSlugs.forEach((slug, index) => sheets.save({ kind: 'pokemon', slug, revision: 0, updatedAt: 10, document: { slug, nickname: `${side === 'north' ? 'North' : 'South'} ${index + 1}`, species: 'Pikachu', level: 10 + index, stats: { spd: { base: 12 + index } }, movelist: [{ name: 'Growl' }] } }))
    return { trainerSlug, pokemonSlugs }
  }
  const north = team('north', 'Mara')
  const south = team('south', 'Dax')
  sheets.save({ kind: 'pokemon', slug: 'pokemon-ineligible', revision: 0, updatedAt: 10, document: { slug: 'pokemon-ineligible', nickname: 'Combined', species: 'Pikachu', level: 10, stats: { spd: { base: 10 } }, movelist: [{ name: 'Growl' }], letterPressCombinedInto: 'pokemon-north-1' } })
  const northOwner = { id: 'profile_northowner', displayName: 'North owner', linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: north.trainerSlug }, ...north.pokemonSlugs.map(sheetSlug => ({ sheetKind: 'pokemon', sheetSlug }))], createdAt: 1, updatedAt: 1 } as any
  const southOwner = { id: 'profile_southowner', displayName: 'South owner', linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: south.trainerSlug }, ...south.pokemonSlugs.map(sheetSlug => ({ sheetKind: 'pokemon', sheetSlug }))], createdAt: 1, updatedAt: 1 } as any
  const incompleteOwner = { id: 'profile_incomplete', displayName: 'Incomplete', linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: north.trainerSlug }, { sheetKind: 'pokemon', sheetSlug: north.pokemonSlugs[0] }], createdAt: 1, updatedAt: 1 } as any
  const profiles = new Map([northOwner, southOwner, incompleteOwner].map(profile => [profile.id, profile]))
  const deps = { database, now: () => 100, readProfile: (id: unknown) => typeof id === 'string' ? profiles.get(id) ?? null : null, publishPersistedRealtimeEvent: () => {}, reportAfterCommitPublicationFailure: () => {} }
  return { database, sheets, north, south, northOwner, southOwner, incompleteOwner, deps }
}

const createBattleContest = (context: ReturnType<typeof setup>, contestId = 'contest:v1:battle-setup-runtime') => executeContestCommandUseCase({
  ...commandBase(contestId, 'create-contest', `create-${contestId.at(-1)}`, 0),
  settings: {
    name: 'Neon Circuit Clash', hallName: 'Castelia Contest Hall', description: '', variantId: 'battle', participantVariantId: null, participantMethodId: null, contestTypeId: 'cool', significanceMultiplier: 1, awardRibbon: true,
    prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: 'Private Battle setup note',
  },
}, { role: 'gm' }, context.deps)

const enrollment = (input: { contestId: string, revision: number, side: 'north'|'south', trainerSlug: string, pokemonSlugs: readonly string[], profileId?: string, suffix?: string }) => ({
  ...commandBase(input.contestId, 'enroll-contestant', input.suffix ?? `enroll-${input.side}`, input.revision),
  contestantId: `contestant:battle-${input.side}`,
  trainerSheetSlug: input.trainerSlug,
  pokemonSheetSlugs: [...input.pokemonSlugs],
  controller: input.profileId ? { kind: 'profile', profileId: input.profileId } : { kind: 'gm' },
  rotationOrder: [],
})

describe('Battle Contest two-Trainer setup runtime', () => {
  it('derives and persists the 6–12 round budget from the first accepted 3–6 Pokémon roster', () => {
    const context = setup()
    const created = createBattleContest(context)
    expect(created.projection).toMatchObject({ variantId: 'battle', stage: 'setup', battle: { declaredPokemonPerTrainer: null, roundBudget: null } })

    const first = executeContestCommandUseCase(enrollment({ contestId: created.result.contestId, revision: created.result.revision, side: 'north', trainerSlug: context.north.trainerSlug, pokemonSlugs: context.north.pokemonSlugs, profileId: context.northOwner.id }), { role: 'gm' }, context.deps)
    const gm = first.projection as ContestGmProjectionV1
    expect(gm.battle).toEqual({ declaredPokemonPerTrainer: 6, roundBudget: 12, encounter: null })
    expect(gm.contestants).toHaveLength(1)
    expect(gm.contestants[0]?.performers.filter(contestPerformerIsPokemon)).toHaveLength(6)
    expect(gm.contestants[0]?.rotationOrder).toEqual([])

    const second = executeContestCommandUseCase(enrollment({ contestId: created.result.contestId, revision: first.result.revision, side: 'south', trainerSlug: context.south.trainerSlug, pokemonSlugs: context.south.pokemonSlugs, profileId: context.southOwner.id }), { role: 'gm' }, context.deps)
    expect((second.projection as ContestGmProjectionV1).contestants).toHaveLength(2)
    expect(second.projection.battle).toEqual({ declaredPokemonPerTrainer: 6, roundBudget: 12, encounter: null })

    const start = { ...commandBase(created.result.contestId, 'start-introduction', 'start-battle', second.result.revision) }
    const started = executeContestCommandUseCase(start, { role: 'gm' }, context.deps)
    expect(started.result).toMatchObject({ stage: 'introduction', revision: 3, exactRetry: false })
    const retry = executeContestCommandUseCase(start, { role: 'gm' }, context.deps)
    expect(retry.result).toMatchObject({ stage: 'introduction', revision: 3, exactRetry: true })
    const stored = createSqliteContestRepository(context.database).get(created.result.contestId)!.document
    expect(stored).toMatchObject({ stage: 'introduction', battle: { declaredPokemonPerTrainer: 6, roundBudget: 12 }, policy: { lockedAt: 100 } })
    expect(stored.diceJournal).toEqual([])

    expect(stored.contestants.every(team => team.introduction.status === 'pending' && team.battleTeamDiceSpendJournal.length === 0)).toBe(true)
  })

  it('requires the second team to match the first declared roster size with atomic rejection', () => {
    const context = setup()
    const created = createBattleContest(context, 'contest:v1:battle-equal-rosters')
    const firstCommand = enrollment({ contestId: created.result.contestId, revision: 0, side: 'north', trainerSlug: context.north.trainerSlug, pokemonSlugs: context.north.pokemonSlugs.slice(0, 4), suffix: 'north-four' })
    const first = executeContestCommandUseCase(firstCommand, { role: 'gm' }, context.deps)
    expect(first.projection.battle).toEqual({ declaredPokemonPerTrainer: 4, roundBudget: 8, encounter: null })

    const unequal = enrollment({ contestId: created.result.contestId, revision: first.result.revision, side: 'south', trainerSlug: context.south.trainerSlug, pokemonSlugs: context.south.pokemonSlugs.slice(0, 3), suffix: 'south-three' })
    expect(() => executeContestCommandUseCase(unequal, { role: 'gm' }, context.deps)).toThrow(/exactly 4 Pokémon/)
    const repository = createSqliteContestRepository(context.database)
    expect(repository.get(created.result.contestId)?.document).toMatchObject({ revision: 1, battle: { declaredPokemonPerTrainer: 4, roundBudget: 8 } })
    expect(repository.get(created.result.contestId)?.document.contestants).toHaveLength(1)
    expect(repository.findOperation(unequal.operationId)).toBeNull()

    const prematureStart = commandBase(created.result.contestId, 'start-introduction', 'premature-start', first.result.revision)
    expect(() => executeContestCommandUseCase(prematureStart, { role: 'gm' }, context.deps)).toThrow(/exactly two Trainer teams/)
    expect(repository.get(created.result.contestId)?.revision).toBe(1)
  })

  it('enforces 3–6 distinct independently eligible Pokémon and exactly two distinct Trainers', () => {
    const context = setup()
    const created = createBattleContest(context, 'contest:v1:battle-roster-bounds')
    const tooSmall = enrollment({ contestId: created.result.contestId, revision: 0, side: 'north', trainerSlug: context.north.trainerSlug, pokemonSlugs: context.north.pokemonSlugs.slice(0, 2), suffix: 'too-small' })
    expect(() => executeContestCommandUseCase(tooSmall, { role: 'gm' }, context.deps)).toThrow(/3 through 6 distinct Pokémon/)

    const duplicate = enrollment({ contestId: created.result.contestId, revision: 0, side: 'north', trainerSlug: context.north.trainerSlug, pokemonSlugs: [context.north.pokemonSlugs[0]!, context.north.pokemonSlugs[0]!, context.north.pokemonSlugs[1]!], suffix: 'duplicate' })
    expect(() => executeContestCommandUseCase(duplicate, { role: 'gm' }, context.deps)).toThrow(/only once/)

    const ineligible = enrollment({ contestId: created.result.contestId, revision: 0, side: 'north', trainerSlug: context.north.trainerSlug, pokemonSlugs: [context.north.pokemonSlugs[0]!, context.north.pokemonSlugs[1]!, 'pokemon-ineligible'], suffix: 'ineligible' })
    expect(() => executeContestCommandUseCase(ineligible, { role: 'gm' }, context.deps)).toThrow(/cannot act independently/)

    const first = executeContestCommandUseCase(enrollment({ contestId: created.result.contestId, revision: 0, side: 'north', trainerSlug: context.north.trainerSlug, pokemonSlugs: context.north.pokemonSlugs.slice(0, 3), suffix: 'valid-north' }), { role: 'gm' }, context.deps)
    const duplicateTrainer = { ...enrollment({ contestId: created.result.contestId, revision: first.result.revision, side: 'south', trainerSlug: context.north.trainerSlug, pokemonSlugs: context.south.pokemonSlugs.slice(0, 3), suffix: 'duplicate-trainer' }), contestantId: 'contestant:battle-south' }
    expect(() => executeContestCommandUseCase(duplicateTrainer, { role: 'gm' }, context.deps)).toThrow(/Trainer is already enrolled/)

    const second = executeContestCommandUseCase(enrollment({ contestId: created.result.contestId, revision: first.result.revision, side: 'south', trainerSlug: context.south.trainerSlug, pokemonSlugs: context.south.pokemonSlugs.slice(0, 3), suffix: 'valid-south' }), { role: 'gm' }, context.deps)
    const third = { ...enrollment({ contestId: created.result.contestId, revision: second.result.revision, side: 'south', trainerSlug: context.south.trainerSlug, pokemonSlugs: context.south.pokemonSlugs.slice(3, 6), suffix: 'third-team' }), contestantId: 'contestant:battle-third' }
    expect(() => executeContestCommandUseCase(third, { role: 'gm' }, context.deps)).toThrow(/exactly two Trainer teams/)
    expect(createSqliteContestRepository(context.database).get(created.result.contestId)?.revision).toBe(2)
  })

  it('uses existing profile ownership as controller consent for the Trainer and every roster Pokémon', () => {
    const context = setup()
    const created = createBattleContest(context, 'contest:v1:battle-controller-consent')
    const incomplete = enrollment({ contestId: created.result.contestId, revision: 0, side: 'north', trainerSlug: context.north.trainerSlug, pokemonSlugs: context.north.pokemonSlugs.slice(0, 3), profileId: context.incompleteOwner.id, suffix: 'incomplete-owner' })
    expect(() => executeContestCommandUseCase(incomplete, { role: 'gm' }, context.deps)).toThrowError(ContestUseCaseError)
    expect(() => executeContestCommandUseCase(incomplete, { role: 'gm' }, context.deps)).toThrow(/does not control every enrolled Pokémon/)
    expect(createSqliteContestRepository(context.database).get(created.result.contestId)?.revision).toBe(0)

    const accepted = executeContestCommandUseCase(enrollment({ contestId: created.result.contestId, revision: 0, side: 'north', trainerSlug: context.north.trainerSlug, pokemonSlugs: context.north.pokemonSlugs.slice(0, 3), profileId: context.northOwner.id, suffix: 'complete-owner' }), { role: 'gm' }, context.deps)
    const owner = loadContestUseCase(created.result.contestId, { role: 'player', playerProfile: context.northOwner }, context.deps) as ContestOwnerProjectionV1
    expect(owner).toMatchObject({ audience: 'owner', ownerContestantId: 'contestant:battle-north', battle: { declaredPokemonPerTrainer: 3, roundBudget: 6 } })
    expect(owner.ownContestant.controller).toEqual({ kind: 'profile', profileId: context.northOwner.id })
    expect(accepted.result.revision).toBe(1)
  })

  it('projects public team identities and derived setup facts without private sheet or provider authority', () => {
    const context = setup()
    const created = createBattleContest(context, 'contest:v1:battle-setup-privacy')
    const first = executeContestCommandUseCase(enrollment({ contestId: created.result.contestId, revision: 0, side: 'north', trainerSlug: context.north.trainerSlug, pokemonSlugs: context.north.pokemonSlugs.slice(0, 3), profileId: context.northOwner.id, suffix: 'privacy-north' }), { role: 'gm' }, context.deps)
    executeContestCommandUseCase(enrollment({ contestId: created.result.contestId, revision: first.result.revision, side: 'south', trainerSlug: context.south.trainerSlug, pokemonSlugs: context.south.pokemonSlugs.slice(0, 3), profileId: context.southOwner.id, suffix: 'privacy-south' }), { role: 'gm' }, context.deps)

    const projected = loadContestUseCase(created.result.contestId, { role: 'player', playerProfile: null }, context.deps) as ContestPublicProjectionV1
    expect(projected).toMatchObject({ variantId: 'battle', battle: { declaredPokemonPerTrainer: 3, roundBudget: 6 }, stage: 'setup' })
    expect(projected.scoreboard.map(row => row.performers.map(performer => performer.displayName))).toEqual([
      ['North 1', 'North 2', 'North 3'],
      ['South 1', 'South 2', 'South 3'],
    ])
    const serialized = JSON.stringify(projected)
    for (const forbidden of ['trainer-north', 'trainer-south', 'pokemon-north-', 'pokemon-south-', 'profile_northowner', 'profile_southowner', 'providerIds', 'dicePools', 'gmNotes', 'operationId']) expect(serialized).not.toContain(forbidden)
    expect('contestants' in projected).toBe(false)
  })

  it('resets a lone removed team declaration but preserves the shared contract while either team remains', () => {
    const context = setup()
    const created = createBattleContest(context, 'contest:v1:battle-remove-team')
    const first = executeContestCommandUseCase(enrollment({ contestId: created.result.contestId, revision: 0, side: 'north', trainerSlug: context.north.trainerSlug, pokemonSlugs: context.north.pokemonSlugs.slice(0, 5), suffix: 'remove-north' }), { role: 'gm' }, context.deps)
    const removed = executeContestCommandUseCase({ ...commandBase(created.result.contestId, 'remove-contestant', 'remove-only', first.result.revision), contestantId: 'contestant:battle-north' }, { role: 'gm' }, context.deps)
    expect(removed.projection.battle).toEqual({ declaredPokemonPerTrainer: null, roundBudget: null, encounter: null })

    const newFirst = executeContestCommandUseCase(enrollment({ contestId: created.result.contestId, revision: removed.result.revision, side: 'north', trainerSlug: context.north.trainerSlug, pokemonSlugs: context.north.pokemonSlugs.slice(0, 3), suffix: 'new-north' }), { role: 'gm' }, context.deps)
    const second = executeContestCommandUseCase(enrollment({ contestId: created.result.contestId, revision: newFirst.result.revision, side: 'south', trainerSlug: context.south.trainerSlug, pokemonSlugs: context.south.pokemonSlugs.slice(0, 3), suffix: 'new-south' }), { role: 'gm' }, context.deps)
    const removeSecond = executeContestCommandUseCase({ ...commandBase(created.result.contestId, 'remove-contestant', 'remove-second', second.result.revision), contestantId: 'contestant:battle-south' }, { role: 'gm' }, context.deps)
    expect(removeSecond.projection.battle).toEqual({ declaredPokemonPerTrainer: 3, roundBudget: 6, encounter: null })
  })

  it('rejects participant layering and missing fixed Contest type at the create boundary', () => {
    const context = setup()
    const layered = {
      ...commandBase('contest:v1:battle-layered', 'create-contest', 'battle-layered', 0),
      settings: { name: 'Layered', hallName: 'Hall', description: '', variantId: 'battle', participantVariantId: 'trainer-participant', participantMethodId: 'simultaneous', contestTypeId: 'cool', significanceMultiplier: 1, awardRibbon: false, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: '' },
    }
    expect(() => executeContestCommandUseCase(layered, { role: 'gm' }, context.deps)).toThrow(/Battle Contest uses its own two-team roster format/)
    const missingType = { ...layered, contestId: 'contest:v1:battle-no-type', operationId: operationId('battle-no-type'), settings: { ...layered.settings, participantVariantId: null, participantMethodId: null, contestTypeId: null } }
    expect(() => executeContestCommandUseCase(missingType, { role: 'gm' }, context.deps)).toThrow(/Choose a Contest type/)
    expect(createSqliteContestRepository(context.database).get(layered.contestId)).toBeNull()
    expect(createSqliteContestRepository(context.database).get(missingType.contestId)).toBeNull()
  })
})
