import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createEncounterSettlementDocument,
  parseEncounterSettlementDocument,
  type EncounterSettlementDocument,
} from '#shared/encounterSettlement/document'
import {
  assertEncounterSettlementCorrectionPlanCurrent,
  EncounterSettlementCorrectionError,
  planEncounterSettlementCorrection,
  type EncounterSettlementCorrectionAuthoritySnapshot,
} from '../../server/domain/encounterSettlement/correction'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteEncounterSettlementRepository } from '../../server/storage/encounterSettlementRepository'
import {
  createSqliteEncounterSettlementCorrectionRepository,
  type EncounterSettlementCorrectionWriteBoundary,
} from '../../server/storage/encounterSettlementCorrectionRepository'
import { correctEncounterSettlement } from '../../server/useCases/correctEncounterSettlement'

const settlementDocuments = (): { base: EncounterSettlementDocument, completed: EncounterSettlementDocument } => {
  const created = createEncounterSettlementDocument({
    settlementId: 'encounter-settlement:correction-a',
    rewardPackageId: 'reward-package-correction-a',
    encounter: {
      encounterId: 'encounter-correction-a', encounterRevision: 8,
      linkedMapSlug: 'correction-arena', linkedMapRevision: 10, campaignMinute: 500,
    },
  })
  const participant = {
    participantId: 'participant-correction-a',
    sourceAuthority: { kind: 'map' as const, id: 'correction-arena', revision: 10 },
    sheetKind: 'pokemon' as const, sheetSlug: 'correction-mon', sheetRevision: 5,
    sideId: 'heroes', ownerParticipantId: null,
    settlementRole: 'combatant' as const, disposition: 'active' as const,
  }
  const base = parseEncounterSettlementDocument({
    ...created,
    status: 'ready',
    participants: [participant],
    persistentConsequences: [{
      consequenceId: 'consequence-correction-a', participantId: participant.participantId,
      kind: 'hp', authority: { kind: 'sheet', id: 'correction-mon', revision: 5 },
      field: 'combat.currentHp', behavior: 'preserve',
      snapshot: { kind: 'integer', before: 12, after: 12 },
      state: 'ready', decisionId: null, receiptId: null,
    }],
    rewardPackage: { rewardPackageId: 'reward-package-correction-a', status: 'ready', lines: [] },
    updatedAtCampaignMinute: 500,
  })
  const consequenceReceiptId = 'settlement-receipt:consequence-correction-a'
  const completionReceiptId = 'settlement-receipt:completion-correction-a'
  const completed = parseEncounterSettlementDocument({
    ...base,
    revision: 1,
    status: 'completed',
    persistentConsequences: base.persistentConsequences.map(row => ({
      ...row, state: 'applied', receiptId: consequenceReceiptId,
    })),
    rewardPackage: { ...base.rewardPackage, status: 'committed' },
    receipts: [{
      receiptId: consequenceReceiptId, kind: 'consequence', audience: 'participant-owner',
      operationId: 'settlement-operation:original-commit-a', result: 'accepted',
      subjects: [{ kind: 'consequence', id: 'consequence-correction-a' }],
      sourceReceiptId: null, acceptedAtCampaignMinute: 550,
    }, {
      receiptId: completionReceiptId, kind: 'completion', audience: 'public',
      operationId: 'settlement-operation:original-commit-a', result: 'accepted',
      subjects: [{ kind: 'settlement', id: base.settlementId }],
      sourceReceiptId: null, acceptedAtCampaignMinute: 550,
    }],
    completion: {
      state: 'accepted', operationId: 'settlement-operation:original-commit-a',
      receiptId: completionReceiptId, completedEncounterRevision: 9,
      completedAtCampaignMinute: 550,
    },
    updatedAtCampaignMinute: 550,
  })
  return { base, completed }
}

const authority = (
  settlement = settlementDocuments().completed,
): EncounterSettlementCorrectionAuthoritySnapshot => ({
  completeness: 'authoritative-current',
  settlement,
  correctionAuthority: { kind: 'sheet', id: 'correction-mon', revision: 6 },
  correctionAuthorityDefinitionSha256: 'a'.repeat(64),
  campaignMinute: 600,
})

const plan = () => planEncounterSettlementCorrection({
  operationId: 'settlement-correction-operation:a',
  sourceReceiptId: 'settlement-receipt:consequence-correction-a',
  reasonCode: 'clerical-corrected',
  gmPrincipalKey: 'gm:alpha',
  committedAt: 1_200,
  authority: authority(),
})

interface Fixture {
  readonly database: RotomDatabase
  readonly authority: EncounterSettlementCorrectionAuthoritySnapshot
  readonly plan: ReturnType<typeof plan>
  readonly command: {
    readonly schemaVersion: 1
    readonly operationId: string
    readonly settlementId: string
    readonly expectedSettlementRevision: number
    readonly offerDefinitionSha256: string
    readonly confirmed: true
  }
}

const setup = (path = ':memory:'): Fixture => {
  const database = openRotomDatabase({ path, enableWal: false })
  database.connection.prepare(`UPDATE campaign_clock SET campaign_minute = 600 WHERE singleton = 1`).run()
  const documents = settlementDocuments()
  const settlementRepository = createSqliteEncounterSettlementRepository(database)
  settlementRepository.create(documents.base)
  settlementRepository.replace({ expectedRevision: 0, document: documents.completed })
  const currentAuthority = authority(documents.completed)
  const correctionPlan = planEncounterSettlementCorrection({
    operationId: 'settlement-correction-operation:a',
    sourceReceiptId: 'settlement-receipt:consequence-correction-a',
    reasonCode: 'clerical-corrected',
    gmPrincipalKey: 'gm:alpha',
    committedAt: 1_200,
    authority: currentAuthority,
  })
  return {
    database,
    authority: currentAuthority,
    plan: correctionPlan,
    command: {
      schemaVersion: 1,
      operationId: correctionPlan.operationId,
      settlementId: correctionPlan.settlementId,
      expectedSettlementRevision: correctionPlan.expectedSettlementRevision,
      offerDefinitionSha256: correctionPlan.offerDefinitionSha256,
      confirmed: true,
    },
  }
}

describe('encounter settlement corrections', () => {
  it('links one exact owning correction authority without rewriting original accepted evidence', () => {
    const correction = plan()
    expect(correction.nextDocument).toMatchObject({
      revision: 2,
      status: 'completed',
      completion: { operationId: 'settlement-operation:original-commit-a' },
    })
    expect(correction.nextDocument.decisions.at(-1)).toMatchObject({
      kind: 'gm-correction', status: 'accepted', selectedOptionId: expect.any(String),
      decidedBy: { kind: 'gm', principalId: 'gm:alpha' },
    })
    expect(correction.nextDocument.receipts.at(-1)).toMatchObject({
      kind: 'correction', result: 'corrected',
      sourceReceiptId: 'settlement-receipt:consequence-correction-a',
    })
    expect(correction.nextDocument.receipts[0]).toEqual(authority().settlement.receipts[0])
    expect(assertEncounterSettlementCorrectionPlanCurrent({ plan: correction, authority: authority() })).toBe(correction)
    expect(() => planEncounterSettlementCorrection({
      operationId: 'settlement-correction-operation:b',
      sourceReceiptId: 'settlement-receipt:consequence-correction-a',
      reasonCode: 'clerical-corrected', gmPrincipalKey: 'gm:alpha', committedAt: 1_201,
      authority: authority(correction.nextDocument),
    })).toThrowError(EncounterSettlementCorrectionError)
  })

  it('persists correction, immutable audit, realtime, safe response, and exact restart replay', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rotom-settlement-correction-'))
    const path = join(directory, 'campaign.sqlite')
    const fixture = setup(path)
    const repository = createSqliteEncounterSettlementCorrectionRepository(fixture.database)
    const published: number[] = []
    const response = correctEncounterSettlement({
      role: 'gm', principalKey: 'gm:alpha', command: fixture.command,
    }, {
      repository,
      loadPreparedPlan: () => fixture.plan,
      loadCurrentAuthority: () => fixture.authority,
      publishRealtimeEvent: event => published.push(event.sequence),
    })
    expect(response).toEqual({
      replayed: false, status: 'accepted', settlementRevision: 2,
      reasonCode: 'clerical-corrected', correctedAtCampaignMinute: 600,
    })
    expect(published.length).toBeGreaterThan(1)
    expect(repository.listBySettlement(fixture.plan.settlementId)).toEqual([
      expect.objectContaining({
        operationId: fixture.plan.operationId,
        reasonCode: 'clerical-corrected', settlementRevision: 2,
      }),
    ])
    expect(createSqliteEncounterSettlementRepository(fixture.database).get(fixture.plan.settlementId)?.revision).toBe(2)
    fixture.database.close()

    const reopened = openRotomDatabase({ path, enableWal: false })
    const replayed = correctEncounterSettlement({
      role: 'gm', principalKey: 'gm:alpha', command: fixture.command,
    }, {
      repository: createSqliteEncounterSettlementCorrectionRepository(reopened),
      loadPreparedPlan: () => fixture.plan,
      loadCurrentAuthority: () => { throw new Error('replay must not reauthorize') },
      publishRealtimeEvent: () => { throw new Error('replay must not republish') },
    })
    expect(replayed).toEqual({ ...response, replayed: true })
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('detects correction audit drift against its exact accepted offer hash', () => {
    const fixture = setup()
    const repository = createSqliteEncounterSettlementCorrectionRepository(fixture.database)
    repository.apply({
      principalKey: 'gm:alpha', command: fixture.command, plan: fixture.plan,
      reauthorize: () => fixture.authority,
    })
    const evidence = JSON.parse(fixture.database.connection.prepare(`
      SELECT evidence_json FROM encounter_settlement_corrections WHERE operation_id = ?
    `).get(fixture.plan.operationId)!.evidence_json as string) as Record<string, unknown>
    evidence.reasonCode = 'reward-adjusted'
    fixture.database.connection.prepare(`
      UPDATE encounter_settlement_corrections SET evidence_json = ? WHERE operation_id = ?
    `).run(JSON.stringify(evidence), fixture.plan.operationId)

    expect(() => repository.listBySettlement(fixture.plan.settlementId))
      .toThrow(/plan evidence is invalid or changed/)
    fixture.database.close()
  })

  it('rolls back every correction boundary and denies players, stale authority, and completion correction', () => {
    const boundaries: EncounterSettlementCorrectionWriteBoundary[] = [
      'after-settlement-write', 'after-correction-write', 'after-realtime-write', 'before-commit',
    ]
    for (const boundary of boundaries) {
      const fixture = setup()
      expect(() => createSqliteEncounterSettlementCorrectionRepository(fixture.database).apply({
        principalKey: 'gm:alpha', command: fixture.command, plan: fixture.plan,
        reauthorize: () => fixture.authority,
        onWriteBoundary: current => {
          if (current === boundary) throw new Error(`rollback ${boundary}`)
        },
      })).toThrow(`rollback ${boundary}`)
      expect(createSqliteEncounterSettlementRepository(fixture.database).get(fixture.plan.settlementId)?.revision).toBe(1)
      expect(createSqliteEncounterSettlementCorrectionRepository(fixture.database).listBySettlement(fixture.plan.settlementId)).toEqual([])
      expect(fixture.database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 0 })
      fixture.database.close()
    }

    const collision = setup()
    collision.database.connection.prepare(`
      INSERT INTO encounter_settlement_operations (
        operation_id, settlement_id, principal_key, command_sha256, command_json,
        plan_definition_sha256, authority_definition_sha256, evidence_json,
        result_json, result_definition_sha256, settlement_revision, created_at,
        accepted_at_campaign_minute
      ) VALUES (?, ?, 'gm:other', ?, '{}', ?, ?, '{}', '{}', ?, 1, 1, 1)
    `).run(
      collision.plan.operationId,
      collision.plan.settlementId,
      'a'.repeat(64),
      'b'.repeat(64),
      'c'.repeat(64),
      'd'.repeat(64),
    )
    expect(() => createSqliteEncounterSettlementCorrectionRepository(collision.database).apply({
      principalKey: 'gm:alpha', command: collision.command, plan: collision.plan,
      reauthorize: () => collision.authority,
    })).toThrow(/already bound to a settlement commit/)
    expect(createSqliteEncounterSettlementRepository(collision.database)
      .get(collision.plan.settlementId)?.revision).toBe(1)
    collision.database.close()

    const denied = setup()
    expect(() => correctEncounterSettlement({
      role: 'player', principalKey: 'profile:player', command: denied.command,
    }, {
      repository: createSqliteEncounterSettlementCorrectionRepository(denied.database),
      loadPreparedPlan: () => denied.plan, loadCurrentAuthority: () => denied.authority,
    })).toThrowError(expect.objectContaining({ statusCode: 403 }))
    denied.database.close()

    expect(() => planEncounterSettlementCorrection({
      operationId: 'settlement-correction-operation:completion',
      sourceReceiptId: 'settlement-receipt:completion-correction-a',
      reasonCode: 'clerical-corrected', gmPrincipalKey: 'gm:alpha', committedAt: 1_200,
      authority: authority(),
    })).toThrow(/Completion and cancelled receipts cannot be corrected/)

    const stale = plan()
    expect(() => assertEncounterSettlementCorrectionPlanCurrent({
      plan: stale,
      authority: { ...authority(), correctionAuthorityDefinitionSha256: 'b'.repeat(64) },
    })).toThrow(/no longer matches/)
  })
})
