import { afterEach, describe, expect, it, vi } from 'vitest'
import { sheetItemTargetId } from '#shared/itemAutomation/sheetActions'
import { parseItemMedicalTreatmentState } from '#shared/itemAutomation/medicalTreatments'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { computePokemonHealingVitals } from '~/utils/sheets/healing'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteItemOperationRepository } from '../../server/storage/itemOperationRepository'
import { createSqliteItemExtendedActionRepository } from '../../server/storage/itemExtendedActionRepository'
import { createSqliteCampaignClockRepository } from '../../server/storage/campaignClockRepository'
import { loadSheetItemActionsUseCase } from '../../server/useCases/loadSheetItemActions'
import {
  loadItemExtendedActionsUseCase,
  manageItemExtendedActionUseCase,
} from '../../server/useCases/manageItemExtendedAction'
import {
  loadItemGuidedAdjudicationUseCase,
  manageItemGuidedAdjudicationUseCase,
} from '../../server/useCases/manageItemGuidedAdjudication'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => {
  while (databases.length) databases.pop()!.close()
})

const trainer = (): TrainerSheet => ({
  slug: 'medic', name: 'Rook', level: 10, revision: 3, currentTeam: ['volt'],
  ap: { max: 7 },
  skillBackground: { adept: 'medicineEd' },
  skills: { medicineEd: { modifier: 2 } },
  inventory: { medicalKit: [{ id: 'first-aid-row', name: 'First Aid Kit', qty: 1 }] },
})
const pokemon = (): CharacterSheet => ({
  slug: 'volt', nickname: 'Volt', species: 'Pikachu', level: 5, revision: 2,
  stats: { hp: { added: 0 } },
  combat: { currentHp: 1, injuries: 2, conditions: ['Burned', 'Badly Poisoned', 'Confused'] },
})
const profile = (): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_medic01',
  displayName: 'Medic player',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'medic' }],
})
const seed = (database: RotomDatabase, medicalKit: NonNullable<TrainerSheet['inventory']>['medicalKit'] = trainer().inventory!.medicalKit): void => {
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  sheets.save({
    kind: 'trainer', slug: 'medic', revision: 3, updatedAt: 10,
    document: { ...trainer(), inventory: { medicalKit } } as unknown as Record<string, unknown>,
  })
  sheets.save({
    kind: 'pokemon', slug: 'volt', revision: 2, updatedAt: 10,
    document: pokemon() as unknown as Record<string, unknown>,
  })
}

const advanceClock = (database: RotomDatabase, input: {
  readonly expectedRevision: number
  readonly targetCampaignMinute: number
  readonly digit: string
}): void => {
  const operationId = `breeding-operation:v1:${input.digit.repeat(32)}`
  database.withTransaction(() => {
    database.connection.prepare(`
      INSERT INTO breeding_operations (
        operation_id, command_sha256, command_kind, command_json, status,
        result_json, result_definition_sha256, created_at_campaign_minute,
        settled_at_campaign_minute
      ) VALUES (?, ?, 'advance-campaign-clock', '{}', 'pending', NULL, NULL, ?, NULL)
    `).run(operationId, 'a'.repeat(64), input.targetCampaignMinute)
    expect(createSqliteCampaignClockRepository(database).advance({
      expectedRevision: input.expectedRevision,
      targetCampaignMinute: input.targetCampaignMinute,
      operationId,
    }).kind).toBe('applied')
  })
}

const ids = (suffix: string) => ({
  activityId: `item-activity:v1:${suffix.padStart(32, '0')}`,
  startOperationId: `item-activity-operation:v1:${`1${suffix}`.padStart(32, '0')}`,
  settlementOperationId: `sheet-item:v1:${`2${suffix}`.padStart(32, '0')}`,
  completeOperationId: `item-activity-operation:v1:${`3${suffix}`.padStart(32, '0')}`,
  interruptOperationId: `item-activity-operation:v1:${`4${suffix}`.padStart(32, '0')}`,
})

const startCommand = (database: RotomDatabase, suffix = '1', canonicalItemId = 'First Aid Kit') => {
  const projection = loadSheetItemActionsUseCase({ role: 'gm', trainerSlug: 'medic' }, { database, now: () => 100 })
  const offer = projection.offers.find(candidate => candidate.source.canonicalId === canonicalItemId)!
  const identity = ids(suffix)
  return {
    identity,
    command: {
      schemaVersion: 1 as const,
      kind: 'start' as const,
      operationId: identity.startOperationId,
      activityId: identity.activityId,
      settlementOperationId: identity.settlementOperationId,
      trainerSlug: 'medic',
      trainerRevision: projection.trainerRevision,
      offerId: offer.offerId,
      targetIds: [sheetItemTargetId('pokemon', 'volt')],
    },
  }
}

const start = (database: RotomDatabase, suffix = '1', canonicalItemId = 'First Aid Kit') => {
  const declaration = startCommand(database, suffix, canonicalItemId)
  const response = manageItemExtendedActionUseCase({ role: 'gm', command: declaration.command }, {
    database,
    now: () => 100,
  })
  return { ...declaration, response }
}

describe('durable medical item Extended Actions', () => {
  it('starts without mechanics, completes atomically once, preserves the reusable kit, and exact-replays', () => {
    const database = open()
    seed(database)
    const randomInt = vi.fn(() => 6)
    const declared = start(database)
    expect(declared.response.result).toMatchObject({ status: 'in-progress', revision: 0, exactReplay: false })
    expect(declared.response.activity).toMatchObject({
      status: 'in-progress', item: { canonicalId: 'First Aid Kit' },
      actor: { label: 'Rook' }, target: { label: 'Volt' },
      startedAtCampaignMinute: 0,
      completion: {
        costs: ['Medicine Education check', '1 AP on completion', 'Reusable kit'],
        safePendingNotice: 'No roll, AP, HP, condition, or inventory change has been applied yet.',
      },
      permissions: { canComplete: true, canInterrupt: true },
    })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    expect(sheets.getByRef('trainer', 'medic')?.revision).toBe(3)
    expect(sheets.getByRef('pokemon', 'volt')?.revision).toBe(2)
    expect(createSqliteItemOperationRepository({ database }).get(declared.identity.settlementOperationId)).toBeNull()
    expect(randomInt).not.toHaveBeenCalled()
    const startEvent = database.connection.prepare(`
      SELECT channel, event_type, access_json, event_json FROM realtime_events ORDER BY sequence LIMIT 1
    `).get() as { channel: string, event_type: string, access_json: string, event_json: string }
    expect(startEvent).toMatchObject({
      channel: 'sheet:trainer:medic',
      event_type: 'item-extended-action-updated',
    })
    expect(JSON.parse(startEvent.access_json)).toEqual({
      kind: 'sheet-access', sheetKind: 'trainer', sheetSlug: 'medic',
    })
    expect(JSON.parse(startEvent.event_json).data).toEqual({
      schemaVersion: 1,
      activityId: declared.identity.activityId,
      status: 'in-progress',
      revision: 0,
    })
    expect(startEvent.event_json).not.toContain('first-aid-row')
    expect(startEvent.event_json).not.toContain('canonicalDefinitionSha256')

    const command = {
      schemaVersion: 1 as const,
      kind: 'complete' as const,
      operationId: declared.identity.completeOperationId,
      activityId: declared.identity.activityId,
      expectedRevision: 0,
    }
    const completed = manageItemExtendedActionUseCase({ role: 'gm', command }, {
      database, now: () => 200, randomInt,
    })
    expect(completed.result).toMatchObject({ status: 'completed', revision: 1, exactReplay: false })
    expect(completed.result.status === 'completed' && completed.result.itemResult).toMatchObject({
      operationId: declared.identity.settlementOperationId, status: 'accepted', exactReplay: false,
    })
    expect(createSqliteItemOperationRepository({ database }).get(declared.identity.settlementOperationId)?.plan)
      .toMatchObject({
        nonEncounterContext: {
          context: 'extended-action',
          extendedAction: {
            mode: 'extended', phase: 'completion',
            activityId: declared.identity.activityId,
            activityRevision: 0,
            startedAtCampaignMinute: 0,
          },
        },
      })
    expect(completed.activity).toMatchObject({
      status: 'completed', revision: 1,
      terminal: { kind: 'completed', message: 'Treatment completed.' },
      permissions: { canComplete: false, canInterrupt: false },
    })
    expect(randomInt).toHaveBeenCalledTimes(4)
    const acceptedTrainer = sheets.getByRef('trainer', 'medic')!
    const acceptedPokemon = sheets.getByRef('pokemon', 'volt')!
    expect(acceptedTrainer.revision).toBe(4)
    expect((acceptedTrainer.sheet as unknown as TrainerSheet).inventory?.medicalKit)
      .toEqual([{ id: 'first-aid-row', name: 'First Aid Kit', qty: 1 }])
    expect((acceptedTrainer.sheet as unknown as TrainerSheet).featureApState?.drains).toEqual([
      expect.objectContaining({ amount: 1, recovery: 'extended-rest', canonicalId: 'First Aid Kit' }),
    ])
    expect(acceptedPokemon.revision).toBe(3)
    expect((acceptedPokemon.sheet as unknown as CharacterSheet).combat).toMatchObject({
      currentHp: computePokemonHealingVitals(pokemon()).maxHp,
      injuries: 2,
      conditions: ['Confused'],
    })

    const replay = manageItemExtendedActionUseCase({ role: 'gm', command }, {
      database, now: () => 300, randomInt,
    })
    expect(replay.result).toMatchObject({ status: 'completed', revision: 1, exactReplay: true })
    expect(replay.result.status === 'completed' && replay.result.itemResult.exactReplay).toBe(true)
    expect(randomInt).toHaveBeenCalledTimes(4)
    expect(sheets.getByRef('trainer', 'medic')?.revision).toBe(4)
    expect(sheets.getByRef('pokemon', 'volt')?.revision).toBe(3)
    const lateStartReplay = manageItemExtendedActionUseCase({ role: 'gm', command: declared.command }, { database })
    expect(lateStartReplay.result).toMatchObject({
      operationId: declared.identity.startOperationId,
      status: 'in-progress', revision: 0, exactReplay: true,
    })
    expect(lateStartReplay.activity.status).toBe('completed')
    expect(() => manageItemExtendedActionUseCase({ role: 'gm', command: {
      ...command,
      operationId: 'item-activity-operation:v1:99999999999999999999999999999999',
    } }, { database })).toThrow('changed. Refresh before completing')
  })

  it('applies Bandages only at accepted completion, consumes one exact source, and starts timed treatment without early healing', () => {
    const database = open()
    seed(database, [{ id: 'bandages-row', name: 'Bandages', qty: 2 }])
    const randomInt = vi.fn(() => { throw new Error('Bandages must not roll.') })
    const declared = start(database, '8', 'Bandages')
    expect(declared.response.activity).toMatchObject({
      status: 'in-progress',
      item: { canonicalId: 'Bandages' },
      completion: {
        costs: ['1 Bandages on completion'],
        sourceNotice: 'One exact source item is consumed only with accepted completion.',
      },
    })
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    expect((sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet).itemMedicalTreatments).toBeUndefined()
    expect((sheets.getByRef('trainer', 'medic')!.sheet as unknown as TrainerSheet).inventory?.medicalKit)
      .toEqual([{ id: 'bandages-row', name: 'Bandages', qty: 2 }])

    const command = {
      schemaVersion: 1 as const,
      kind: 'complete' as const,
      operationId: declared.identity.completeOperationId,
      activityId: declared.identity.activityId,
      expectedRevision: 0,
    }
    const completed = manageItemExtendedActionUseCase({ role: 'gm', command }, {
      database, now: () => 200, randomInt,
    })
    expect(completed.activity.terminal).toEqual({
      kind: 'completed',
      message: 'Bandages applied. Timed healing is now active and will stop if the target loses HP.',
    })
    const acceptedTrainer = sheets.getByRef('trainer', 'medic')!
    const acceptedPokemon = sheets.getByRef('pokemon', 'volt')!
    expect((acceptedTrainer.sheet as unknown as TrainerSheet).inventory?.medicalKit)
      .toEqual([{ id: 'bandages-row', name: 'Bandages', qty: 1 }])
    expect((acceptedPokemon.sheet as unknown as CharacterSheet).combat).toMatchObject({
      currentHp: 1, injuries: 2,
    })
    expect(parseItemMedicalTreatmentState(
      (acceptedPokemon.sheet as unknown as CharacterSheet).itemMedicalTreatments,
    ).entries).toEqual([
      expect.objectContaining({
        canonicalItemId: 'Bandages', status: 'active', revision: 0,
        appliedAtCampaignMinute: 0, nextTickCampaignMinute: 30,
        endsAtCampaignMinute: 360, ticksApplied: 0, hitPointsRestored: 0,
        injuryRemoved: false, sourceOperationId: declared.identity.settlementOperationId,
      }),
    ])
    expect(randomInt).not.toHaveBeenCalled()

    const replay = manageItemExtendedActionUseCase({ role: 'gm', command }, {
      database, now: () => 300, randomInt,
    })
    expect(replay.result).toMatchObject({ status: 'completed', exactReplay: true })
    expect(sheets.getByRef('trainer', 'medic')?.revision).toBe(4)
    expect(sheets.getByRef('pokemon', 'volt')?.revision).toBe(3)
    expect(randomInt).not.toHaveBeenCalled()
  })

  it('moves completed Poultices into bounded GM adjudication before any treatment, Loyalty, or consumption settlement', () => {
    const database = open()
    seed(database, [{ id: 'poultices-row', name: 'Poultices', qty: 2 }])
    const declared = start(database, 'd', 'Poultices')
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const command = {
      schemaVersion: 1 as const,
      kind: 'complete' as const,
      operationId: declared.identity.completeOperationId,
      activityId: declared.identity.activityId,
      expectedRevision: 0,
    }
    const completed = manageItemExtendedActionUseCase({ role: 'gm', command }, {
      database, now: () => 200, publishPersistedRealtimeEvent: () => undefined,
    })
    expect(completed.result.status === 'completed' && completed.result.itemResult).toMatchObject({
      status: 'pending', canonicalItemId: 'Poultices',
    })
    expect(completed.activity).toMatchObject({
      status: 'completed',
      terminal: { kind: 'completed', message: expect.stringContaining('reserved for bounded GM adjudication') },
      completion: {
        sourceNotice: expect.stringContaining('consumed only with GM acceptance'),
        safePendingNotice: expect.stringContaining('No HP, condition, Loyalty, treatment, or inventory change'),
      },
    })
    expect((sheets.getByRef('trainer', 'medic')!.sheet as unknown as TrainerSheet).inventory?.medicalKit)
      .toEqual([{ id: 'poultices-row', name: 'Poultices', qty: 2 }])
    expect((sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet).itemMedicalTreatments).toBeUndefined()

    const queue = loadItemGuidedAdjudicationUseCase({ role: 'gm' }, { database })
    expect(queue.requests).toHaveLength(1)
    expect(queue.requests[0]).toMatchObject({ itemLabel: 'Poultices', timingLabel: 'Extended Action completion' })
    const accepted = manageItemGuidedAdjudicationUseCase({
      role: 'gm',
      command: {
        schemaVersion: 1,
        operationId: 'item-guided-operation:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        action: 'resolve',
        requestId: queue.requests[0]!.requestId,
        expectedRevision: 0,
        optionId: 'record-no-loyalty-change',
      },
    }, { database, now: () => 300, publishPersistedRealtimeEvent: () => undefined })
    expect(accepted.result.request.status).toBe('accepted')
    expect((sheets.getByRef('trainer', 'medic')!.sheet as unknown as TrainerSheet).inventory?.medicalKit)
      .toEqual([{ id: 'poultices-row', name: 'Poultices', qty: 1 }])
    expect(parseItemMedicalTreatmentState(
      (sheets.getByRef('pokemon', 'volt')!.sheet as unknown as CharacterSheet).itemMedicalTreatments,
    ).entries).toEqual([expect.objectContaining({ canonicalItemId: 'Poultices', status: 'active' })])
  })

  it('interrupts before any roll, AP, HP, condition, inventory, or sheet revision change', () => {
    const database = open()
    seed(database)
    const declared = start(database)
    const randomInt = vi.fn(() => 6)
    const interrupted = manageItemExtendedActionUseCase({ role: 'gm', command: {
      schemaVersion: 1,
      kind: 'interrupt',
      operationId: declared.identity.interruptOperationId,
      activityId: declared.identity.activityId,
      expectedRevision: 0,
      reason: 'user-cancelled',
    } }, { database, now: () => 150, randomInt })
    expect(interrupted.result).toMatchObject({ status: 'interrupted', revision: 1, itemResult: null })
    expect(interrupted.activity.terminal?.message).toContain('before any item mechanics')
    expect(randomInt).not.toHaveBeenCalled()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    expect(sheets.getByRef('trainer', 'medic')?.revision).toBe(3)
    expect(sheets.getByRef('pokemon', 'volt')?.revision).toBe(2)
    expect(createSqliteItemOperationRepository({ database }).get(declared.identity.settlementOperationId)).toBeNull()
  })

  it('fails closed for another actor activity, unauthorized access, source loss, and AP loss', () => {
    const database = open()
    seed(database)
    const first = start(database, '1')
    const second = startCommand(database, '2')
    expect(() => manageItemExtendedActionUseCase({ role: 'gm', command: second.command }, { database }))
      .toThrow('already has an item Extended Action in progress')
    expect(() => loadItemExtendedActionsUseCase({
      role: 'player', playerProfile: null, trainerSlug: 'medic',
    }, { database })).toThrow('does not control')
    expect(loadItemExtendedActionsUseCase({
      role: 'player', playerProfile: profile(), trainerSlug: 'medic',
    }, { database })).toHaveLength(1)

    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const storedTrainer = sheets.getByRef('trainer', 'medic')!
    const changed = structuredClone(storedTrainer.sheet) as unknown as TrainerSheet
    changed.inventory = { medicalKit: [] }
    expect(sheets.applyLivePlayUpdate({
      kind: 'trainer', slug: 'medic', expectedRevision: 3,
      nextSheet: changed as unknown as Record<string, unknown>, sourceOperationId: 'test-source-loss',
    })).not.toBe('stale')
    const randomInt = vi.fn(() => 4)
    expect(() => manageItemExtendedActionUseCase({ role: 'gm', command: {
      schemaVersion: 1,
      kind: 'complete',
      operationId: first.identity.completeOperationId,
      activityId: first.identity.activityId,
      expectedRevision: 0,
    } }, { database, randomInt })).toThrow('source is no longer available')
    expect(randomInt).not.toHaveBeenCalled()
    expect(createSqliteItemExtendedActionRepository(database).get(first.identity.activityId)?.status).toBe('in-progress')
    expect(createSqliteItemOperationRepository({ database }).get(first.identity.settlementOperationId)).toBeNull()
  })

  it('revalidates current AP and ownership at completion while preserving safe interruption', () => {
    const database = open()
    seed(database)
    const declared = start(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const stored = sheets.getByRef('trainer', 'medic')!
    const noAp = structuredClone(stored.sheet) as unknown as TrainerSheet
    noAp.ap = { max: 0 }
    noAp.currentTeam = []
    expect(sheets.applyLivePlayUpdate({
      kind: 'trainer', slug: 'medic', expectedRevision: 3,
      nextSheet: noAp as unknown as Record<string, unknown>, sourceOperationId: 'test-ap-loss',
    })).not.toBe('stale')
    const loaded = loadItemExtendedActionsUseCase({ role: 'gm', trainerSlug: 'medic' }, { database })
    expect(loaded[0]?.permissions).toMatchObject({
      canComplete: false,
      canInterrupt: true,
      unavailableReason: expect.any(String),
    })
    const playerProjection = loadItemExtendedActionsUseCase({
      role: 'player', playerProfile: profile(), trainerSlug: 'medic',
    }, { database })[0]!
    expect(playerProjection.target).toMatchObject({
      label: 'Volt', summary: null, conditionLabels: [],
    })
    const randomInt = vi.fn(() => 5)
    expect(() => manageItemExtendedActionUseCase({ role: 'gm', command: {
      schemaVersion: 1,
      kind: 'complete',
      operationId: declared.identity.completeOperationId,
      activityId: declared.identity.activityId,
      expectedRevision: 0,
    } }, { database, randomInt })).toThrow(/AP|eligible|target/i)
    expect(randomInt).not.toHaveBeenCalled()
    const interrupted = manageItemExtendedActionUseCase({ role: 'gm', command: {
      schemaVersion: 1,
      kind: 'interrupt',
      operationId: declared.identity.interruptOperationId,
      activityId: declared.identity.activityId,
      expectedRevision: 0,
      reason: 'user-cancelled',
    } }, { database })
    expect(interrupted.result.status).toBe('interrupted')
    expect(sheets.getByRef('trainer', 'medic')?.revision).toBe(4)
  })

  it('binds start and terminal evidence to monotonic campaign time without inventing a minimum duration', () => {
    const database = open()
    seed(database)
    advanceClock(database, { expectedRevision: 0, targetCampaignMinute: 4321, digit: '7' })
    const declared = start(database)
    expect(declared.response.activity.startedAtCampaignMinute).toBe(4321)
    advanceClock(database, { expectedRevision: 1, targetCampaignMinute: 4381, digit: '8' })
    const interrupted = manageItemExtendedActionUseCase({ role: 'gm', command: {
      schemaVersion: 1,
      kind: 'interrupt',
      operationId: declared.identity.interruptOperationId,
      activityId: declared.identity.activityId,
      expectedRevision: 0,
      reason: 'gm-interrupted',
    } }, { database, now: () => 200 })
    expect(interrupted.activity).toMatchObject({
      startedAtCampaignMinute: 4321,
      updatedAtCampaignMinute: 4381,
      status: 'interrupted',
    })
  })

  it('rolls back activity settlement, item evidence, sheet writes, and realtime evidence on an injected write failure', () => {
    const database = open()
    seed(database)
    const declared = start(database)
    expect(() => manageItemExtendedActionUseCase({ role: 'gm', command: {
      schemaVersion: 1,
      kind: 'complete',
      operationId: declared.identity.completeOperationId,
      activityId: declared.identity.activityId,
      expectedRevision: 0,
    } }, {
      database,
      now: () => 200,
      randomInt: () => 2,
      failAfterWrite: boundary => { if (boundary === 'sheet') throw new Error('injected item write failure') },
    })).toThrow('injected item write failure')
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    expect(sheets.getByRef('trainer', 'medic')?.revision).toBe(3)
    expect(sheets.getByRef('pokemon', 'volt')?.revision).toBe(2)
    expect(createSqliteItemExtendedActionRepository(database).get(declared.identity.activityId)).toMatchObject({
      status: 'in-progress', revision: 0, result: null,
    })
    expect(createSqliteItemOperationRepository({ database }).get(declared.identity.settlementOperationId)).toBeNull()
    const eventCount = database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get() as { count: number }
    // Start publishes one activity event; completion contributes no durable rows after rollback.
    expect(Number(eventCount.count)).toBe(1)
  })
})
