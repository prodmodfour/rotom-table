import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { createEncounterDocument, parseEncounterDocument } from '#shared/encounterDocuments/model'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
  type EncounterSettlementDocument,
  type EncounterSettlementParticipant,
} from '#shared/encounterSettlement/document'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet } from '~/types/characterSheet'
import { createDefaultGroupInventoryDocument, type GroupInventoryDocument } from '~/types/groupInventory'
import type { TabletopMap } from '~/types/map'
import { applyCombatStagesToSheet } from '~/utils/sheetMutations'
import { pokemonExperienceNeededForLevel } from '~/utils/sheets/pokemonExperience'
import {
  planEncounterSettlementAtomicCommit,
  type EncounterSettlementAtomicAuthoritySnapshot,
  type EncounterSettlementAtomicComponentPlans,
} from '../../server/domain/encounterSettlement/atomicCommit'
import {
  planEncounterSettlementBatchExperience,
  type EncounterSettlementExperienceAuthoritySnapshot,
} from '../../server/domain/encounterSettlement/experienceAllocation'
import { planEncounterSettlementLootAllocation } from '../../server/domain/encounterSettlement/lootAllocation'
import type { EncounterSettlementCapturePlan } from '../../server/domain/encounterSettlement/captureSettlement'
import { planEncounterSettlementOutcomes } from '../../server/domain/encounterSettlement/outcomeSettlement'
import {
  ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS,
  planEncounterSettlementTemporaryCleanup,
} from '../../server/domain/encounterSettlement/temporaryCleanup'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteEncounterDocumentRepository } from '../../server/storage/encounterDocumentRepository'
import {
  createSqliteEncounterSettlementRepository,
  EncounterSettlementRepositoryError,
  type EncounterSettlementAtomicWriteBoundary,
} from '../../server/storage/encounterSettlementRepository'
import { createSqliteGroupInventoryRepository } from '../../server/storage/groupInventoryRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'

const participant: EncounterSettlementParticipant = {
  participantId: 'participant-mon-a',
  sourceAuthority: { kind: 'map', id: 'atomic-store-arena', revision: 20 },
  sheetKind: 'pokemon', sheetSlug: 'mon-a', sheetRevision: 4,
  sideId: 'heroes', ownerParticipantId: null, settlementRole: 'combatant', disposition: 'active',
}

const seedSheet = (): CharacterSheet => applyCombatStagesToSheet('pokemon', {
  slug: 'mon-a', folder: '', species: 'Bulbasaur', nickname: 'Bud',
  level: 10, totalExp: pokemonExperienceNeededForLevel(10)!, revision: 4, updatedAt: 900,
  combat: { currentHp: 13, injuries: 1, conditions: ['Poisoned'] },
  stats: {
    atk: { stage: 0 }, def: { stage: 0 }, satk: { stage: 0 },
    sdef: { stage: 0 }, spd: { stage: 0 },
  },
  combatStages: { acc: 0 }, movelist: [],
} as never, { atk: 3, def: -1, satk: 0, sdef: 2, spd: 1, acc: 2 }) as unknown as CharacterSheet

const seedMap = (): TabletopMap => ({
  schemaVersion: 2, slug: 'atomic-store-arena', name: 'Atomic Store Arena', folder: '',
  revision: 20, updatedAt: 900, dimensions: { x: 8, y: 3, z: 8 }, voxels: [],
  placements: [{
    id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'mon-a',
    position: { x: 1, y: 0, z: 1 }, initiative: 12,
  }],
  initiative: { activeId: 'token-a', round: 2 },
  encounterState: createEmptyEncounterState(),
})

const seedEncounter = () => parseEncounterDocument({
  ...createEncounterDocument({
    encounterId: 'encounter-atomic-store-a', name: 'Atomic storage encounter',
    linkedMapSlug: 'atomic-store-arena', recipe: 'trainer-duel', now: 800,
  }),
  revision: 12, lifecycle: 'active', updatedAt: 900,
})

const seedSettlement = (): EncounterSettlementDocument => {
  const created = createEncounterSettlementDocument({
    settlementId: 'encounter-settlement:v1:00000000000000000000000000000080',
    rewardPackageId: 'atomic-store-rewards-a',
    encounter: {
      encounterId: 'encounter-atomic-store-a', encounterRevision: 12,
      linkedMapSlug: 'atomic-store-arena', linkedMapRevision: 20, campaignMinute: 480,
    },
  })
  return parseEncounterSettlementDocument({
    ...created,
    status: 'ready',
    participants: [participant],
    rewardPackage: {
      rewardPackageId: 'atomic-store-rewards-a', status: 'ready',
      lines: [{
        rewardId: 'reward-xp-a', visibility: 'participant-owner',
        sourceAuthority: { kind: 'encounter-document', id: 'encounter-atomic-store-a', revision: 12 },
        disposition: 'pending', payload: { kind: 'experience', amount: 25 },
      }, {
        rewardId: 'reward-money-a', visibility: 'destination-owner',
        sourceAuthority: { kind: 'encounter-document', id: 'encounter-atomic-store-a', revision: 12 },
        disposition: 'pending', payload: { kind: 'money', amount: 75 },
      }],
    },
    temporaryCleanup: [{
      cleanupId: 'cleanup-stage-a', kind: 'combat-stages',
      authority: { kind: 'map', id: 'atomic-store-arena', revision: 20 },
      participantIds: ['participant-mon-a'], sourceIds: ['sheet:pokemon:mon-a'],
      behavior: 'reset', state: 'ready', decisionId: null, receiptId: null,
    }, {
      cleanupId: 'cleanup-resource-a', kind: 'encounter-resources',
      authority: { kind: 'map', id: 'atomic-store-arena', revision: 20 },
      participantIds: ['participant-mon-a'],
      sourceIds: [ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS.encounterResources],
      behavior: 'reset', state: 'ready', decisionId: null, receiptId: null,
    }, {
      cleanupId: 'cleanup-initiative-a', kind: 'initiative',
      authority: { kind: 'map', id: 'atomic-store-arena', revision: 20 },
      participantIds: ['participant-mon-a'],
      sourceIds: [ENCOUNTER_SETTLEMENT_CLEANUP_SOURCE_IDS.initiative],
      behavior: 'reset', state: 'ready', decisionId: null, receiptId: null,
    }],
    createdAtCampaignMinute: 480,
    updatedAtCampaignMinute: 480,
  })
}

interface AtomicStorageFixture {
  readonly database: RotomDatabase
  readonly settlement: EncounterSettlementDocument
  readonly authority: EncounterSettlementAtomicAuthoritySnapshot
  readonly plan: ReturnType<typeof planEncounterSettlementAtomicCommit>
  readonly command: {
    readonly schemaVersion: 1
    readonly operationId: string
    readonly settlementId: string
    readonly expectedSettlementRevision: number
    readonly planDefinitionSha256: string
    readonly confirmed: true
  }
}

const setup = (path = ':memory:'): AtomicStorageFixture => {
  const database = openRotomDatabase({ path, enableWal: false })
  database.connection.prepare(`
    UPDATE campaign_clock SET campaign_minute = 500 WHERE singleton = 1
  `).run()
  const storedSheet = createSqliteSheetRepository(database).save({
    kind: 'pokemon', slug: 'mon-a', document: seedSheet(), revision: 4, updatedAt: 900,
  })
  createSqliteMapRepository(database).save({
    slug: 'atomic-store-arena', document: seedMap(), revision: 20, updatedAt: 900,
  })
  const encounter = seedEncounter()
  database.connection.prepare(`
    INSERT INTO encounter_documents (encounter_id, linked_map_slug, document_json, revision, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(encounter.encounterId, encounter.linkedMapSlug, stableJsonStringify(encounter), 12, 900)
  const group = {
    ...createDefaultGroupInventoryDocument({ slug: 'main', now: 900 }),
    revision: 5,
    updatedAt: 900,
    money: 20,
  } satisfies GroupInventoryDocument
  const storedGroup = createSqliteGroupInventoryRepository(database).save({
    slug: 'main', document: group, revision: 5, updatedAt: 900,
  })
  const currentGroup = createSqliteGroupInventoryRepository(database).get('main')!
  expect(storedGroup.slug).toBe('main')

  const settlement = seedSettlement()
  createSqliteEncounterSettlementRepository(database).create(settlement)
  const currentSheet = storedSheet.document as CharacterSheet
  const currentMap = createSqliteMapRepository(database).getBySlug('atomic-store-arena')!
  const currentEncounter = createSqliteEncounterDocumentRepository(database).get(encounter.encounterId)!

  const experience = planEncounterSettlementBatchExperience({
    settlement,
    authority: {
      completeness: 'authoritative-current',
      pokemonSheets: [{ sheetSlug: 'mon-a', revision: 4, sheet: currentSheet }],
      declarations: [{
        rewardId: 'reward-xp-a',
        destination: { kind: 'participant', id: 'participant-mon-a', revision: 4 },
        method: 'fixed', recipients: [{ participantId: 'participant-mon-a', weight: null, amount: null }],
        permission: {
          status: 'allowed',
          authority: { kind: 'encounter-document', id: encounter.encounterId, revision: 12 },
          reasonId: null,
        },
      }],
    } satisfies EncounterSettlementExperienceAuthoritySnapshot,
  })
  const loot = planEncounterSettlementLootAllocation({
    settlement,
    authority: {
      completeness: 'authoritative-current',
      declarations: [{
        kind: 'money', rewardId: 'reward-money-a',
        destination: { kind: 'group-inventory', id: 'main', revision: 5 }, amount: 75,
        permission: {
          status: 'allowed',
          authority: { kind: 'group-inventory', id: 'main', revision: 5 },
          reasonId: null,
        },
      }],
      containers: [{ kind: 'group', slug: 'main', revision: 5, document: currentGroup.document }],
    },
  })
  const capture: EncounterSettlementCapturePlan = {
    complete: true, authorityDefinitionSha256: 'a'.repeat(64), document: settlement,
    allocations: [], destinationAuthorities: [], previews: [], sheetWrites: [],
    requiredDecisions: [], pendingRewardIds: [], deniedRewardIds: [],
  }
  const outcomes = planEncounterSettlementOutcomes({
    settlement,
    authority: {
      completeness: 'authoritative-current', encounterDocument: currentEncounter,
      declarations: [], campaignConsequencesComplete: true, campaignConsequences: [],
      authorization: {
        status: 'allowed',
        authority: { kind: 'encounter-document', id: encounter.encounterId, revision: 12 },
        reasonId: null,
      },
      writeTimestamp: 1_000,
    },
  })
  const cleanup = planEncounterSettlementTemporaryCleanup({
    settlement,
    authority: {
      completeness: 'authoritative-current', map: currentMap,
      sheetsComplete: true,
      sheets: [{ kind: 'pokemon', slug: 'mon-a', revision: 4, document: currentSheet }],
      activeReservationOperationIds: [], transformationsComplete: true, transformations: [],
      authorization: {
        status: 'allowed', authority: { kind: 'map', id: currentMap.slug, revision: 20 }, reasonId: null,
      },
      writeTimestamp: 1_000,
    },
  })
  const components: EncounterSettlementAtomicComponentPlans = { experience, loot, capture, outcomes, cleanup }
  const authority: EncounterSettlementAtomicAuthoritySnapshot = {
    completeness: 'authoritative-current',
    settlement,
    eligibility: {
      completeness: 'authoritative-current', encounter: settlement.encounter,
      participants: [participant], blockingFacts: [],
    },
    sheetsComplete: true,
    sheets: [{ kind: 'pokemon', slug: 'mon-a', revision: 4, document: currentSheet }],
    groupsComplete: true,
    groups: [{ slug: 'main', revision: 5, document: currentGroup.document }],
    map: currentMap,
    encounterDocument: currentEncounter,
    additionalRewardDestinations: [],
  }
  const plan = planEncounterSettlementAtomicCommit({
    operationId: 'settlement-operation:atomic-storage-a',
    campaignMinute: 500, committedAt: 1_000, authority, components,
  })
  const command = {
    schemaVersion: 1 as const,
    operationId: plan.operationId,
    settlementId: plan.settlementId,
    expectedSettlementRevision: plan.expectedSettlementRevision,
    planDefinitionSha256: plan.planDefinitionSha256,
    confirmed: true as const,
  }
  return { database, settlement, authority, plan, command }
}

const allBoundaries = (fixture: AtomicStorageFixture): readonly EncounterSettlementAtomicWriteBoundary[] => [
  'after-encounter-write',
  ...(fixture.plan.mapWrite ? ['after-map-write' as const] : []),
  ...fixture.plan.sheetWrites.map(write => `after-sheet-write:${write.kind}:${write.slug}` as const),
  ...fixture.plan.groupWrites.map(write => `after-group-write:${write.slug}` as const),
  'after-settlement-write',
  'after-operation-write',
  ...fixture.plan.historyFacts.map(fact => `after-history-write:${fact.factId}` as const),
  ...fixture.plan.attentionSources.map(source => `after-attention-write:${source.sourceId}` as const),
  'after-realtime-write',
  'before-commit',
]

const assertOriginalState = (fixture: AtomicStorageFixture): void => {
  const repository = createSqliteEncounterSettlementRepository(fixture.database)
  expect(repository.get(fixture.settlement.settlementId)).toEqual(fixture.settlement)
  expect(repository.getOperation(fixture.plan.operationId)).toBeNull()
  expect(repository.listHistoryFacts(fixture.settlement.settlementId)).toEqual([])
  expect(repository.listAttentionSources(fixture.settlement.settlementId)).toEqual([])
  expect(fixture.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get())
    .toEqual({ count: 0 })
  expect(createSqliteEncounterDocumentRepository(fixture.database).get('encounter-atomic-store-a')?.revision).toBe(12)
  expect(createSqliteMapRepository(fixture.database).getBySlug('atomic-store-arena')?.revision).toBe(20)
  expect(createSqliteSheetRepository(fixture.database).get('pokemon', 'mon-a')?.revision).toBe(4)
  expect(createSqliteGroupInventoryRepository(fixture.database).get('main')?.revision).toBe(5)
}

describe('SQLite atomic encounter settlement repository', () => {
  it('commits every domain once and returns exact durable replay across restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rotom-settlement-atomic-'))
    const path = join(directory, 'campaign.sqlite')
    const fixture = setup(path)
    const repository = createSqliteEncounterSettlementRepository(fixture.database)
    const first = repository.applyAtomicCommit({
      principalKey: 'gm:alpha', command: fixture.command, plan: fixture.plan,
      reauthorize: () => fixture.authority,
    })

    expect(first.replayed).toBe(false)
    expect(first.result).toMatchObject({
      settlementRevision: 1, encounterRevision: 13, mapRevision: 21,
      sheetRevisions: [{ kind: 'pokemon', slug: 'mon-a', revision: 5 }],
      groupRevisions: [{ slug: 'main', revision: 6 }],
    })
    expect(repository.get(fixture.settlement.settlementId)?.status).toBe('completed')
    expect(repository.listHistoryFacts(fixture.settlement.settlementId)).toHaveLength(fixture.plan.historyFacts.length)
    expect(repository.listAttentionSources(fixture.settlement.settlementId)).toEqual([
      expect.objectContaining({ status: 'open', revision: 0, reason: 'level-threshold' }),
    ])
    expect(first.persistedRealtimeEvents.length).toBeGreaterThan(8)
    expect(fixture.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get())
      .toEqual({ count: first.persistedRealtimeEvents.length })
    expect(createSqliteGroupInventoryRepository(fixture.database).get('main')?.document.money).toBe(95)
    fixture.database.close()

    const reopened = openRotomDatabase({ path, enableWal: false })
    const replay = createSqliteEncounterSettlementRepository(reopened).applyAtomicCommit({
      principalKey: 'gm:alpha', command: fixture.command, plan: fixture.plan,
      reauthorize: () => { throw new Error('exact replay must not reauthorize changed terminal state') },
    })
    expect(replay).toEqual({ replayed: true, result: first.result, persistedRealtimeEvents: [] })
    expect(() => createSqliteEncounterSettlementRepository(reopened).applyAtomicCommit({
      principalKey: 'gm:other', command: fixture.command, plan: fixture.plan,
      reauthorize: () => fixture.authority,
    })).toThrowError(EncounterSettlementRepositoryError)
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('detects audit-row payload drift against the hash-bound accepted operation plan', () => {
    const fixture = setup()
    const repository = createSqliteEncounterSettlementRepository(fixture.database)
    repository.applyAtomicCommit({
      principalKey: 'gm:alpha', command: fixture.command, plan: fixture.plan,
      reauthorize: () => fixture.authority,
    })
    const row = fixture.database.connection.prepare(`
      SELECT fact_id, fact_json FROM encounter_settlement_history_facts
      WHERE settlement_id = ? ORDER BY fact_id LIMIT 1
    `).get(fixture.plan.settlementId) as { readonly fact_id: string, readonly fact_json: string }
    const changed = JSON.parse(row.fact_json) as Record<string, unknown>
    changed.payload = { changed: 'without accepted evidence' }
    fixture.database.connection.prepare(`
      UPDATE encounter_settlement_history_facts SET fact_json = ? WHERE fact_id = ?
    `).run(JSON.stringify(changed), row.fact_id)

    expect(() => repository.listHistoryFacts(fixture.plan.settlementId))
      .toThrow(/no longer matches its immutable operation evidence/)
    fixture.database.close()
  })

  it('rolls back every individual write boundary without terminal evidence or partial revisions', () => {
    const exemplar = setup()
    const boundaries = allBoundaries(exemplar)
    exemplar.database.close()
    expect(boundaries.length).toBeGreaterThan(10)

    for (const boundary of boundaries) {
      const fixture = setup()
      const repository = createSqliteEncounterSettlementRepository(fixture.database)
      expect(() => repository.applyAtomicCommit({
        principalKey: 'gm:alpha', command: fixture.command, plan: fixture.plan,
        reauthorize: () => fixture.authority,
        onWriteBoundary: current => {
          if (current === boundary) throw new Error(`injected rollback at ${boundary}`)
        },
      })).toThrow(`injected rollback at ${boundary}`)
      assertOriginalState(fixture)
      fixture.database.close()
    }
  })

  it('rejects an operation identity already present in the correction journal', () => {
    const fixture = setup()
    fixture.database.connection.prepare(`
      INSERT INTO encounter_settlement_corrections (
        operation_id, settlement_id, principal_key, source_receipt_id, reason_code,
        command_sha256, command_json, offer_definition_sha256,
        authority_definition_sha256, evidence_json, result_json,
        result_definition_sha256, settlement_revision, created_at,
        accepted_at_campaign_minute
      ) VALUES (?, ?, 'gm:other', 'settlement-receipt:collision', 'clerical-corrected',
        ?, '{}', ?, ?, '{}', '{}', ?, 1, 1, 1)
    `).run(
      fixture.plan.operationId,
      fixture.plan.settlementId,
      'a'.repeat(64),
      'b'.repeat(64),
      'c'.repeat(64),
      'd'.repeat(64),
    )

    expect(() => createSqliteEncounterSettlementRepository(fixture.database).applyAtomicCommit({
      principalKey: 'gm:alpha', command: fixture.command, plan: fixture.plan,
      reauthorize: () => fixture.authority,
    })).toThrow(/already bound to a correction/)
    expect(createSqliteEncounterSettlementRepository(fixture.database)
      .get(fixture.plan.settlementId)?.revision).toBe(0)
    fixture.database.close()
  })

  it('rejects stale complete authority and campaign-clock drift before the first write', () => {
    const staleAuthority = setup()
    expect(() => createSqliteEncounterSettlementRepository(staleAuthority.database).applyAtomicCommit({
      principalKey: 'gm:alpha', command: staleAuthority.command, plan: staleAuthority.plan,
      reauthorize: () => ({ ...staleAuthority.authority, sheets: [] }),
    })).toThrow(/current complete authority no longer matches/)
    assertOriginalState(staleAuthority)
    staleAuthority.database.close()

    const staleClock = setup()
    staleClock.database.connection.prepare(`UPDATE campaign_clock SET campaign_minute = 501 WHERE singleton = 1`).run()
    expect(() => createSqliteEncounterSettlementRepository(staleClock.database).applyAtomicCommit({
      principalKey: 'gm:alpha', command: staleClock.command, plan: staleClock.plan,
      reauthorize: () => staleClock.authority,
    })).toThrow(/Campaign clock changed/)
    assertOriginalState(staleClock)
    staleClock.database.close()
  })
})
