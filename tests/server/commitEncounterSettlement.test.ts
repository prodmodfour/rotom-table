import { describe, expect, it, vi } from 'vitest'
import {
  parseEncounterSettlementCommitCommand,
  parseEncounterSettlementCommitResult,
} from '#shared/encounterSettlement/atomicCommit'
import type {
  EncounterSettlementAtomicAuthoritySnapshot,
  EncounterSettlementAtomicCommitPlan,
} from '../../server/domain/encounterSettlement/atomicCommit'
import {
  commitEncounterSettlement,
  CommitEncounterSettlementUseCaseError,
} from '../../server/useCases/commitEncounterSettlement'
import { EncounterSettlementRepositoryError } from '../../server/storage/encounterSettlementRepository'

const command = {
  schemaVersion: 1 as const,
  operationId: 'settlement-operation:use-case-a',
  settlementId: 'encounter-settlement:use-case-a',
  expectedSettlementRevision: 3,
  planDefinitionSha256: 'a'.repeat(64),
  confirmed: true as const,
}
const result = parseEncounterSettlementCommitResult({
  schemaVersion: 1,
  operationId: command.operationId,
  settlementId: command.settlementId,
  settlementRevision: 4,
  encounterId: 'encounter-use-case-a',
  encounterRevision: 8,
  mapSlug: 'arena-use-case-a',
  mapRevision: 10,
  sheetRevisions: [],
  groupRevisions: [],
  historyFactIds: ['settlement-history:use-case-a'],
  attentionSourceIds: [],
  completedAtCampaignMinute: 500,
})
const plan = {
  operationId: command.operationId,
  settlementId: command.settlementId,
  expectedSettlementRevision: 3,
  planDefinitionSha256: command.planDefinitionSha256,
} as EncounterSettlementAtomicCommitPlan
const authority = {} as EncounterSettlementAtomicAuthoritySnapshot

describe('commit encounter settlement use case', () => {
  it('strictly parses the explicit confirmation boundary', () => {
    expect(parseEncounterSettlementCommitCommand(command)).toEqual(command)
    expect(() => parseEncounterSettlementCommitCommand({ ...command, confirmed: false })).toThrow(/must be true/)
    expect(() => parseEncounterSettlementCommitCommand({ ...command, extra: true })).toThrow(/must contain exactly/)
    expect(() => parseEncounterSettlementCommitCommand({ ...command, planDefinitionSha256: 'A'.repeat(64) }))
      .toThrow(/lowercase SHA-256/)
  })

  it('allows only a GM and forwards the exact server-owned plan and locked reauthorization', () => {
    const applyAtomicCommit = vi.fn((input) => {
      expect(input.command).toEqual(command)
      expect(input.plan).toBe(plan)
      expect(input.reauthorize()).toBe(authority)
      return { replayed: false, result, persistedRealtimeEvents: [] }
    })
    const loadPreparedPlan = vi.fn(() => plan)
    const loadCurrentAuthority = vi.fn(() => authority)

    expect(commitEncounterSettlement({
      role: 'gm', principalKey: 'gm:alpha', command,
    }, {
      repository: { applyAtomicCommit }, loadPreparedPlan, loadCurrentAuthority,
    })).toEqual({
      replayed: false,
      status: 'accepted',
      settlementRevision: 4,
      encounterRevision: 8,
      mapRevision: 10,
      changedSheetCount: 0,
      changedGroupCount: 0,
      historyFactCount: 1,
      attentionSourceCount: 0,
      completedAtCampaignMinute: 500,
    })
    expect(applyAtomicCommit).toHaveBeenCalledOnce()
    expect(loadCurrentAuthority).toHaveBeenCalledWith(plan, command)

    expect(() => commitEncounterSettlement({
      role: 'player', principalKey: 'profile:player', command,
    }, {
      repository: { applyAtomicCommit }, loadPreparedPlan, loadCurrentAuthority,
    })).toThrowError(expect.objectContaining<Partial<CommitEncounterSettlementUseCaseError>>({ statusCode: 403 }))
    expect(applyAtomicCommit).toHaveBeenCalledOnce()
  })

  it('keeps accepted durable settlement authoritative when post-commit publication fails', () => {
    const publicationFailure = new Error('publisher unavailable')
    const report = vi.fn()
    const response = commitEncounterSettlement({
      role: 'gm', principalKey: 'gm:alpha', command,
    }, {
      repository: {
        applyAtomicCommit: () => ({
          replayed: false,
          result,
          persistedRealtimeEvents: [{
            sequence: 7,
            access: { kind: 'gm-only' },
            event: {
              channel: 'encounter-settlements:encounter-use-case-a',
              type: 'encounter-settlement-updated',
              revision: 4,
              previousRevision: 3,
              data: {},
              sequence: 7,
              timestamp: 500,
            },
          }],
        }),
      },
      loadPreparedPlan: () => plan,
      loadCurrentAuthority: () => authority,
      publishRealtimeEvent: () => { throw publicationFailure },
      reportRealtimePublicationFailure: report,
    })

    expect(response.status).toBe('accepted')
    expect(report).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'encounter-settlement-commit',
      sequence: 7,
      error: publicationFailure,
    }))
  })

  it('fails closed for missing previews, malformed commands, duplicate identities, and stale authority', () => {
    const base = {
      loadCurrentAuthority: () => authority,
    }
    expect(() => commitEncounterSettlement({
      role: 'gm', principalKey: 'gm:alpha', command: { ...command, confirmed: false },
    }, {
      repository: { applyAtomicCommit: vi.fn() }, loadPreparedPlan: () => plan, ...base,
    })).toThrowError(expect.objectContaining<Partial<CommitEncounterSettlementUseCaseError>>({ statusCode: 400 }))

    expect(() => commitEncounterSettlement({
      role: 'gm', principalKey: 'gm:alpha', command,
    }, {
      repository: { applyAtomicCommit: vi.fn() }, loadPreparedPlan: () => null, ...base,
    })).toThrowError(expect.objectContaining<Partial<CommitEncounterSettlementUseCaseError>>({ statusCode: 409 }))

    for (const code of ['duplicate-operation', 'stale-authority'] as const) {
      expect(() => commitEncounterSettlement({
        role: 'gm', principalKey: 'gm:alpha', command,
      }, {
        repository: {
          applyAtomicCommit: () => {
            throw new EncounterSettlementRepositoryError(code, 'private storage detail')
          },
        },
        loadPreparedPlan: () => plan,
        ...base,
      })).toThrowError(expect.objectContaining<Partial<CommitEncounterSettlementUseCaseError>>({ statusCode: 409 }))
    }
  })
})
