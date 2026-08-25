import { createHash } from 'node:crypto'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '../../shared/moveAutomation/encounterState'
import { normalizePlayerProfile, type PlayerProfile } from '../../shared/playerProfiles'
import type {
  RequestSkillCheckCommandV1,
  ResolveSkillCheckCommandV1,
  RespondSkillCheckCommandV1,
} from '../../shared/skillChecks/contract'
import { parseExecuteEquipmentActionCommand } from '../../shared/itemAutomation/equipmentActions'
import { createEmptySheetEquipmentState } from '../../shared/itemAutomation/equipment'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TabletopMap } from '../../src/types/map'
import type { TrainerSheet } from '../../src/types/trainerSheet'
import { activeEquipmentState } from '../fixtures/equipment'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteContestRepository } from '../../server/storage/contestRepository'
import { createSqliteEncounterDocumentRepository } from '../../server/storage/encounterDocumentRepository'
import { createSqliteEquipmentActionOperationRepository } from '../../server/storage/equipmentActionOperationRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteSkillCheckRepository } from '../../server/storage/skillCheckRepository'
import { buildEncounterPresentationProjection } from '../../server/domain/encounterPresentation/buildProjection'
import { createEncounterEquipmentGrantQueries } from '../../server/domain/moveAutomation/equipmentGrantQueries'
import { executeEquipmentActionUseCase } from '../../server/useCases/executeEquipmentAction'
import { executeContestCommandUseCase } from '../../server/useCases/contests'
import { manageGmSkillCheckUseCase } from '../../server/useCases/manageGmSkillChecks'
import { respondSubjectSkillCheckUseCase } from '../../server/useCases/manageSubjectSkillChecks'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const contestOp = (suffix: string): string => `contest-op:v1:${suffix.replace(/[^a-z0-9-]/giu, '-').padEnd(8, 'x')}`
const contestBase = (contestId: string, commandKind: string, suffix: string, expectedRevision: number) => ({
  schemaVersion: 1,
  contestId,
  commandKind,
  operationId: contestOp(suffix),
  expectedRevision,
  clientId: 'p11-backup-restore',
})

const tableDigest = (database: RotomDatabase, table: string, orderBy: string): string => sha256(JSON.stringify(
  database.connection.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all(),
))
const rowCount = (database: RotomDatabase, table: string): number => Number((database.connection
  .prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)

const seedEquipmentStates = (database: RotomDatabase) => {
  const shield: TrainerSheet = {
    slug: 'backup-shield-trainer', name: 'Shield Keeper', level: 20, currentHp: 50,
    skills: { athletics: { modifier: 1 } }, currentTeam: [],
    equipmentState: activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'backup-shield-trainer', slotId: 'offHand', canonicalItemId: 'Light Shield',
    }),
  }
  const netter: TrainerSheet = {
    slug: 'backup-net-trainer', name: 'Net Keeper', level: 20, currentHp: 50,
    equipmentState: activeEquipmentState({
      ownerKind: 'trainer', ownerSlug: 'backup-net-trainer', slotId: 'mainHand', additionalSlotIds: ['offHand'],
      canonicalItemId: 'Weighted Nets',
      configuration: { configurationId: 'equipment.weighted-nets.v1', values: { durabilityMaximum: 50 } },
    }),
  }
  const target: CharacterSheet = {
    slug: 'backup-net-target', nickname: 'Netted Target', species: 'Pidgey', level: 10,
    combat: { currentHp: 40 }, capabilities: { sky: 6, levitate: 4 },
    equipmentState: createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: 'backup-net-target' }),
  }
  const map: TabletopMap = {
    schemaVersion: 2, slug: 'p11-backup-equipment-map', name: 'Backup equipment state', revision: 1,
    dimensions: { x: 12, y: 4, z: 12 }, groundLevelY: 0, playerVisible: true, voxels: [],
    placements: [
      { id: 'backup-shield-token', sheetKind: 'trainer', sheetSlug: shield.slug, position: { x: 1, y: 0, z: 1 } },
      { id: 'backup-net-token', sheetKind: 'trainer', sheetSlug: netter.slug, position: { x: 1, y: 0, z: 3 } },
      { id: 'backup-target-token', sheetKind: 'pokemon', sheetSlug: target.slug, position: { x: 4, y: 0, z: 3 } },
    ],
    encounterState: createEmptyEncounterState(),
  }
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  maps.save({ slug: map.slug, document: map, revision: 1, updatedAt: 10 })
  sheets.save({ kind: 'trainer', slug: shield.slug, revision: 1, updatedAt: 10, document: { ...shield, revision: 1, updatedAt: 10 } })
  sheets.save({ kind: 'trainer', slug: netter.slug, revision: 1, updatedAt: 10, document: { ...netter, revision: 1, updatedAt: 10 } })
  sheets.save({ kind: 'pokemon', slug: target.slug, revision: 1, updatedAt: 10, document: { ...target, revision: 1, updatedAt: 10 } })

  const commandFor = (
    currentMap: TabletopMap,
    actorPlacementId: string,
    actionId: 'equipment.light-shield.ready' | 'equipment.weighted-nets.throw',
    operationId: string,
    targetPlacementIds: readonly string[],
  ) => {
    const sheetRows = [
      { kind: 'trainer' as const, slug: shield.slug, sheet: { ...shield, revision: 1, updatedAt: 10 } },
      { kind: 'trainer' as const, slug: netter.slug, sheet: { ...netter, revision: 1, updatedAt: 10 } },
      { kind: 'pokemon' as const, slug: target.slug, sheet: { ...target, revision: 1, updatedAt: 10 } },
    ]
    const source = createEncounterEquipmentGrantQueries({ map: currentMap, sheets: sheetRows })
      .resolve(actorPlacementId)!.active.find(row => row.grant.kind === 'action' && row.grant.actionId === actionId)!
    const projection = buildEncounterPresentationProjection({
      role: 'gm', map: currentMap, mapRevision: currentMap.revision ?? 0,
      pokemonSheets: [target], trainerSheets: [shield, netter], generatedAt: 20,
    })
    const offer = projection.offers.find(row => row.actor.participantId === actorPlacementId && row.intent.actionId === actionId)!
    return parseExecuteEquipmentActionCommand({
      schemaVersion: 1, operationId, offerId: offer.offerId, mapSlug: currentMap.slug,
      baseRevision: currentMap.revision ?? 0, actorPlacementId, actionId,
      equipmentInstanceId: source.instanceId, equipmentInstanceRevision: source.instanceRevision,
      targetEquipmentInstanceId: null, targetEquipmentInstanceRevision: null,
      targetPlacementIds: [...targetPlacementIds], cells: [], inventorySourceInstanceId: null,
      skillCheckId: null, gmAdjudication: null,
    })
  }

  const shieldCommand = commandFor(map, 'backup-shield-token', 'equipment.light-shield.ready', 'p11-backup-shield-ready', [])
  executeEquipmentActionUseCase({ role: 'gm', clientId: 'backup-client-a', command: shieldCommand }, {
    database, now: () => 30, randomInt: () => 10,
  })
  const afterShield = maps.getBySlug(map.slug)!
  const netCommand = commandFor(afterShield, 'backup-net-token', 'equipment.weighted-nets.throw', 'p11-backup-weighted-net', ['backup-target-token'])
  executeEquipmentActionUseCase({ role: 'gm', clientId: 'backup-client-b', command: netCommand }, {
    database, now: () => 40, randomInt: () => 10,
  })
  return { mapSlug: map.slug, shieldCommand, netCommand, shield }
}

const seedSkillCheck = (database: RotomDatabase, shield: TrainerSheet) => {
  const profile = normalizePlayerProfile({
    schemaVersion: 1, id: 'profile_backupowner', displayName: 'Backup owner',
    linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: shield.slug }],
  })
  const request: RequestSkillCheckCommandV1 = {
    schemaVersion: 1, operationId: 'skill-check-op:v1:p11_backup_request_0001', expectedRevision: 0,
    commandKind: 'request', checkId: 'skill-check:v1:p11-backup-restore',
    publicLabel: 'Hold the restored gate', prompt: 'Make an Athletics check.', gmNotes: 'private backup note',
    visibility: 'participants-results', comparison: { kind: 'dc', difficulty: { kind: 'explicit', difficultyClass: 10 }, concealment: 'subjects-after-acceptance' },
    situationalModifier: 0, expiresAt: null,
    subjects: [{ subjectId: 'skill-check-subject:v1:p11-backup-shield', kind: 'trainer', sheetSlug: shield.slug, skillId: 'athletics' }],
  }
  const respond: RespondSkillCheckCommandV1 = {
    schemaVersion: 1, operationId: 'skill-check-op:v1:p11_backup_respond_0001', expectedRevision: 1,
    commandKind: 'respond', checkId: request.checkId, subjectId: request.subjects[0]!.subjectId, decision: 'accept',
  }
  const resolve: ResolveSkillCheckCommandV1 = {
    schemaVersion: 1, operationId: 'skill-check-op:v1:p11_backup_resolve_0001', expectedRevision: 2,
    commandKind: 'resolve', checkId: request.checkId,
  }
  const checks = createSqliteSkillCheckRepository(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const common = { database, skillCheckRepository: checks, sheetRepository: sheets, listProfiles: () => [profile] as readonly PlayerProfile[] }
  manageGmSkillCheckUseCase({ principalId: 'director', command: request }, { ...common, now: () => 50 })
  respondSubjectSkillCheckUseCase({ authority: { kind: 'profile', profile }, command: respond }, { ...common, now: () => 60 })
  manageGmSkillCheckUseCase({ principalId: 'director', command: resolve }, { ...common, now: () => 70, randomInt: () => 4 })
  return { profile, resolve }
}

const seedLinkedBattleContest = (database: RotomDatabase) => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const profiles = new Map<string, any>()
  for (const [side, name, speed] of [['north', 'Mara', 7], ['south', 'Dax', 8]] as const) {
    const trainerSlug = `backup-battle-trainer-${side}`
    const pokemonSlugs = Array.from({ length: 3 }, (_, index) => `backup-battle-pokemon-${side}-${index + 1}`)
    sheets.save({ kind: 'trainer', slug: trainerSlug, revision: 0, updatedAt: 1, document: {
      slug: trainerSlug, name, level: 10, stats: { spd: { base: speed } },
      skills: { charm: { rankBonus: 1 }, command: { rankBonus: 2 } }, currentTeam: pokemonSlugs,
      equipmentState: createEmptySheetEquipmentState({ ownerKind: 'trainer', ownerSlug: trainerSlug }),
    } })
    pokemonSlugs.forEach((slug, index) => sheets.save({ kind: 'pokemon', slug, revision: 0, updatedAt: 1, document: {
      slug, nickname: `${side} ${index + 1}`, species: 'Pikachu', level: 10,
      stats: { spd: { base: 10 + index } }, movelist: [{ name: 'Growl' }],
      equipmentState: createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: slug }),
    } }))
    const profile = {
      id: `profile_backup_${side}`, displayName: name,
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: trainerSlug }, ...pokemonSlugs.map(sheetSlug => ({ sheetKind: 'pokemon', sheetSlug }))],
      createdAt: 1, updatedAt: 1,
    }
    profiles.set(profile.id, profile)
  }
  const deps = {
    database, random: { nextInteger: (_minimum: number, maximum: number) => maximum }, now: () => 100,
    readProfile: (id: unknown) => typeof id === 'string' ? profiles.get(id) ?? null : null,
    publishPersistedRealtimeEvent: () => {}, reportAfterCommitPublicationFailure: () => {},
  }
  const contestId = 'contest:v1:p11-backup-battle'
  let response = executeContestCommandUseCase({
    ...contestBase(contestId, 'create-contest', 'backup-create', 0),
    settings: {
      name: 'Backup Battle Contest', hallName: 'Restore Hall', description: '', variantId: 'battle',
      participantVariantId: null, participantMethodId: null, contestTypeId: 'cool', significanceMultiplier: 1,
      awardRibbon: true, prize: { declared: true, money: 0, items: [], notes: '' }, gmNotes: 'private restore plan',
    },
  }, { role: 'gm' }, deps)
  for (const side of ['north', 'south'] as const) response = executeContestCommandUseCase({
    ...contestBase(contestId, 'enroll-contestant', `backup-enroll-${side}`, response.result.revision),
    contestantId: `contestant:backup-battle-${side}`,
    trainerSheetSlug: `backup-battle-trainer-${side}`,
    pokemonSheetSlugs: Array.from({ length: 3 }, (_, index) => `backup-battle-pokemon-${side}-${index + 1}`),
    controller: { kind: 'profile', profileId: `profile_backup_${side}` }, rotationOrder: [],
  }, { role: 'gm' }, deps)
  response = executeContestCommandUseCase(contestBase(contestId, 'start-introduction', 'backup-start', response.result.revision), { role: 'gm' }, deps)
  for (const [side, skillId, statId] of [['north', 'command', 'cool'], ['south', 'charm', 'cute']] as const) response = executeContestCommandUseCase({
    ...contestBase(contestId, 'declare-introduction', `backup-intro-${side}`, response.result.revision),
    contestantId: `contestant:backup-battle-${side}`, skillId, generatedStatId: statId, bonusStatIds: {},
  }, { role: 'gm' }, deps)
  const linkCommand = contestBase(contestId, 'create-battle-encounter', 'backup-link', response.result.revision)
  executeContestCommandUseCase(linkCommand, { role: 'gm' }, deps)
  return { contestId, linkCommand, deps }
}

describe('P11-083 backup, restore, restart, and reconnect certification', () => {
  it('round-trips checks, readied shields, netted targets, and a linked Battle Contest with no lost or duplicate authority', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rotom-p11-backup-restore-'))
    const livePath = join(directory, 'live.sqlite')
    const backupPath = join(directory, 'stopped-service-backup.sqlite')
    let database: RotomDatabase | null = null
    try {
      database = openRotomDatabase({ path: livePath, enableWal: false })
      const equipment = seedEquipmentStates(database)
      const skill = seedSkillCheck(database, equipment.shield)
      const battle = seedLinkedBattleContest(database)
      const linkedBefore = createSqliteContestRepository(database).get(battle.contestId)!.document.battle!.encounter!
      const trackedTables: Record<string, string> = {
        maps: 'slug', sheets: 'kind, slug', equipment_action_operations: 'operation_id',
        skill_checks: 'check_id', skill_check_operations: 'operation_id', contests: 'contest_id',
        contest_operations: 'operation_id', encounter_documents: 'encounter_id', realtime_events: 'sequence',
      }
      const before = Object.fromEntries(Object.entries(trackedTables).map(([table, order]) => [table, tableDigest(database!, table, order)]))
      const countsBefore = Object.fromEntries(Object.keys(trackedTables).map(table => [table, rowCount(database!, table)]))
      expect(database.connection.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      database.close()
      database = null

      // Preferred operator workflow: stop writers, then copy the closed SQLite authority.
      copyFileSync(livePath, backupPath)
      database = openRotomDatabase({ path: backupPath, enableWal: false })
      expect(database.connection.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      expect(database.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      for (const [table, order] of Object.entries(trackedTables)) {
        expect(tableDigest(database, table, order), table).toBe(before[table])
        expect(rowCount(database, table), table).toBe(countsBefore[table])
      }

      const restoredMap = createSqliteMapRepository<TabletopMap>(database).getBySlug(equipment.mapSlug)!
      expect(restoredMap.encounterState?.effects.filter(effect => effect.tags.includes('equipment.shield.ready'))).toHaveLength(3)
      expect(restoredMap.encounterState?.effects.filter(effect => effect.tags.includes('equipment.weighted-net'))).toHaveLength(4)
      expect(createSqliteSkillCheckRepository(database).get('skill-check:v1:p11-backup-restore')?.document.state).toBe('accepted')
      const restoredContest = createSqliteContestRepository(database).get(battle.contestId)!.document
      expect(restoredContest.battle?.encounter).toEqual(linkedBefore)
      expect(createSqliteEncounterDocumentRepository(database).get(linkedBefore.link.encounterId)?.battleContest).toEqual(linkedBefore)

      const eventsBeforeRetry = rowCount(database, 'realtime_events')
      const equipmentOpsBeforeRetry = rowCount(database, 'equipment_action_operations')
      expect(executeEquipmentActionUseCase({ role: 'gm', command: equipment.shieldCommand }, {
        database, now: () => { throw new Error('restored exact retry must not read time') },
      })).toMatchObject({ exactReplay: true })
      expect(rowCount(database, 'equipment_action_operations')).toBe(equipmentOpsBeforeRetry)

      const checks = createSqliteSkillCheckRepository(database)
      const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
      const skillReplay = manageGmSkillCheckUseCase({ principalId: 'director', command: skill.resolve }, {
        database, skillCheckRepository: checks, sheetRepository, listProfiles: () => [skill.profile],
        now: () => { throw new Error('restored exact retry must not read time') },
        randomInt: () => { throw new Error('restored exact retry must not reroll') },
      })
      expect(skillReplay.receipt.exactReplay).toBe(true)

      const battleReplay = executeContestCommandUseCase(battle.linkCommand, { role: 'gm' }, { ...battle.deps, database })
      expect(battleReplay.result.exactRetry).toBe(true)
      expect(createSqliteMapRepository<TabletopMap>(database).list()).toHaveLength(2)
      expect(createSqliteEncounterDocumentRepository(database).list()).toHaveLength(1)
      expect(rowCount(database, 'realtime_events')).toBe(eventsBeforeRetry)

      database.close()
      database = openRotomDatabase({ path: backupPath, enableWal: false })
      const reconnectMap = createSqliteMapRepository<TabletopMap>(database).getBySlug(equipment.mapSlug)!
      expect(reconnectMap).toEqual(restoredMap)
      expect(createSqliteContestRepository(database).get(battle.contestId)!.document.battle?.encounter).toEqual(linkedBefore)
      expect(createSqliteSkillCheckRepository(database).get(skill.resolve.checkId)?.document.state).toBe('accepted')
      expect(rowCount(database, 'equipment_action_operations')).toBe(equipmentOpsBeforeRetry)
      expect(rowCount(database, 'realtime_events')).toBe(eventsBeforeRetry)
    }
    finally {
      database?.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
