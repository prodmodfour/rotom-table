import { afterEach, describe, expect, it } from 'vitest'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { executeItemOperationUseCase } from '../../server/useCases/executeItemOperation'
import { resumeItemOperationUseCase } from '../../server/useCases/resumeItemOperation'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'

const databases: RotomDatabase[] = []
const open = () => { const value = openRotomDatabase({ path: ':memory:' }); databases.push(value); return value }
afterEach(() => { while (databases.length) databases.pop()!.close() })
const trainer = (): TrainerSheet => ({ slug: 'ash', name: 'Ash', level: 10, revision: 3, inventory: { medicalKit: [{ id: 'potion-row', name: 'Potion', qty: 2 }] } })
const pokemon = (): CharacterSheet => ({ slug: 'pikachu', nickname: 'Pikachu', species: 'Pikachu', level: 5, revision: 2, stats: { hp: { added: 0 } }, combat: { currentHp: 1 } })
const arena = (): TabletopMap => ({
  schemaVersion: 2, slug: 'arena', name: 'Arena', revision: 4, dimensions: { x: 5, y: 3, z: 5 }, voxels: [], createdAt: 1, updatedAt: 10,
  placements: [
    { id: 'ash-placement', sheetKind: 'trainer', sheetSlug: 'ash', position: { x: 1, y: 0, z: 1 } },
    { id: 'pikachu-placement', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 2, y: 0, z: 1 } },
  ],
  encounterState: { ...createEmptyEncounterState(), turnResources: { 'ash-placement': createEncounterTurnResourceLedger({ placementId: 'ash-placement', round: 1 }) } },
  initiative: { activeId: 'ash-placement', round: 1 },
})
const offerId = () => buildEncounterPresentationProjection({ role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [pokemon()], trainerSheets: [trainer()], generatedAt: 10 }).offers.find(offer => offer.source.canonicalId === 'Potion')!.offerId
const command = (): UseItemCommandV1 => ({
  schemaVersion: 1, operationId: 'op_item_pending_resume1', context: 'encounter', offerId: offerId(),
  sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row', actorParticipantId: 'ash-placement',
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 3 },
  targetIds: [], choices: [{ choiceId: 'target', optionIds: [] }],
  readSet: [
    { kind: 'map', id: 'arena', revision: 4 }, { kind: 'encounter', id: 'arena', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 }, { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
  ],
})
const seed = (database: RotomDatabase) => {
  createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: arena(), revision: 4, updatedAt: 10 })
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({ kind: 'trainer', slug: 'ash', document: trainer() as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
  sheets.save({ kind: 'pokemon', slug: 'pikachu', document: pokemon() as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
}

describe('item pending choice and exact resume', () => {
  it('reserves without consuming, then resumes the original operation exactly once', () => {
    const database = open(); seed(database)
    const pending = executeItemOperationUseCase({ role: 'gm', command: command() }, { database, now: () => 100 })
    expect(pending.result).toMatchObject({ status: 'pending', decisionId: expect.any(String), reservationId: expect.any(String) })
    expect(executeItemOperationUseCase({ role: 'gm', command: command() }, { database, now: () => 150 }).result)
      .toMatchObject({ status: 'pending', exactReplay: true, decisionId: (pending.result as { decisionId: string }).decisionId })
    const journal = createSqliteItemOperationRepository({ database }).get(command().operationId)!
    expect(journal.pendingDecision?.choices[0]?.options.map(option => option.optionId)).toContain('pikachu-placement')
    const result = resumeItemOperationUseCase({ role: 'gm', command: {
      schemaVersion: 1, operationId: command().operationId, decisionId: journal.pendingDecision!.decisionId,
      choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
    } }, { database, now: () => 200 })
    expect(result.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Potion' })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    expect((sheets.getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect((sheets.getByRef('pokemon', 'pikachu')!.sheet as unknown as CharacterSheet).combat?.currentHp).toBeGreaterThan(1)
    const replay = resumeItemOperationUseCase({ role: 'gm', command: {
      schemaVersion: 1, operationId: command().operationId, decisionId: journal.pendingDecision!.decisionId,
      choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
    } }, { database })
    expect(replay.result).toEqual({ ...result.result, exactReplay: true })
    expect((sheets.getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet).inventory?.medicalKit?.[0]?.qty).toBe(1)
    expect(() => resumeItemOperationUseCase({ role: 'gm', command: {
      schemaVersion: 1, operationId: command().operationId, decisionId: journal.pendingDecision!.decisionId,
      choices: [{ choiceId: 'target', optionIds: ['ash-placement'] }],
    } }, { database })).toThrow('already resumed with different choices')
  })

  it('resumes a pending Dire Hit target into one durable effect and exact-replays it', () => {
    const database = open()
    const sourceTrainer = trainer()
    sourceTrainer.inventory = { medicalKit: [{ id: 'potion-row', name: 'Dire Hit', qty: 2 }] }
    createSqliteMapRepository<TabletopMap>(database).save({ slug: 'arena', document: arena(), revision: 4, updatedAt: 10 })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.save({ kind: 'trainer', slug: 'ash', document: sourceTrainer as unknown as Record<string, unknown>, revision: 3, updatedAt: 10 })
    sheets.save({ kind: 'pokemon', slug: 'pikachu', document: pokemon() as unknown as Record<string, unknown>, revision: 2, updatedAt: 10 })
    const offer = buildEncounterPresentationProjection({
      role: 'gm', map: arena(), mapRevision: 4, pokemonSheets: [pokemon()],
      trainerSheets: [sourceTrainer], generatedAt: 10,
    }).offers.find(value => value.source.canonicalId === 'Dire Hit')!
    const direHitCommand = command()
    direHitCommand.operationId = 'op_item_dire_hit_resume1'
    direHitCommand.offerId = offer.offerId
    const pending = executeItemOperationUseCase({ role: 'gm', command: direHitCommand }, { database, now: () => 100 })
    expect(pending.result.status).toBe('pending')
    const record = createSqliteItemOperationRepository({ database }).get(direHitCommand.operationId)!
    const resumeCommand = {
      schemaVersion: 1 as const, operationId: direHitCommand.operationId,
      decisionId: record.pendingDecision!.decisionId,
      choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
    }
    const accepted = resumeItemOperationUseCase({ role: 'gm', command: resumeCommand }, { database, now: () => 200 })
    expect(accepted.result).toMatchObject({ status: 'accepted', canonicalItemId: 'Dire Hit', exactReplay: false })
    expect(createSqliteMapRepository<TabletopMap>(database).get('arena')?.document.encounterState?.effects).toHaveLength(1)
    expect(resumeItemOperationUseCase({ role: 'gm', command: resumeCommand }, { database, now: () => 300 }).result)
      .toMatchObject({ status: 'accepted', exactReplay: true })
    expect(createSqliteMapRepository<TabletopMap>(database).get('arena')?.document.encounterState?.effects).toHaveLength(1)
  })

  it.each(['operation-resume', 'map', 'sheet', 'operation', 'realtime'] as const)(
    'rolls the resumed command and every mechanical write back after the %s boundary',
    (boundary) => {
      const database = open(); seed(database)
      executeItemOperationUseCase({ role: 'gm', command: command() }, { database, now: () => 100 })
      const before = createSqliteItemOperationRepository({ database }).get(command().operationId)!
      const realtimeBefore = database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()
      expect(() => resumeItemOperationUseCase({ role: 'gm', command: {
        schemaVersion: 1, operationId: command().operationId, decisionId: before.pendingDecision!.decisionId,
        choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
      } }, {
        database,
        now: () => 200,
        failAfterWrite: value => { if (value === boundary) throw new Error(`fixture failure after ${boundary}`) },
      })).toThrow(`fixture failure after ${boundary}`)
      const after = createSqliteItemOperationRepository({ database }).get(command().operationId)!
      expect(after).toEqual(before)
      const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
      expect((sheets.getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet).inventory?.medicalKit?.[0]?.qty).toBe(2)
      expect((sheets.getByRef('pokemon', 'pikachu')!.sheet as unknown as CharacterSheet).combat?.currentHp).toBe(1)
      expect(createSqliteMapRepository<TabletopMap>(database).get('arena')?.revision).toBe(4)
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual(realtimeBefore)
    },
  )

  it('fails closed when any original read-set authority changed before resume', () => {
    const database = open(); seed(database)
    executeItemOperationUseCase({ role: 'gm', command: command() }, { database, now: () => 100 })
    const journal = createSqliteItemOperationRepository({ database }).get(command().operationId)!
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const target = sheets.getByRef('pokemon', 'pikachu')!
    sheets.applyLivePlayUpdate({ kind: 'pokemon', slug: 'pikachu', expectedRevision: 2, nextSheet: { ...target.sheet, revision: 2 } })
    expect(() => resumeItemOperationUseCase({ role: 'gm', command: {
      schemaVersion: 1, operationId: command().operationId, decisionId: journal.pendingDecision!.decisionId,
      choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
    } }, { database })).toThrow()
    expect((sheets.getByRef('trainer', 'ash')!.sheet as unknown as TrainerSheet).inventory?.medicalKit?.[0]?.qty).toBe(2)
  })
})
