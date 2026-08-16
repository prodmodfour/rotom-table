import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { createEncounterSettlementDocument, parseEncounterSettlementDocument } from '#shared/encounterSettlement/document'
import type { PlayerProfile } from '#shared/playerProfiles'
import {
  getEncounterSettlementOperationStatus,
  GetEncounterSettlementOperationStatusUseCaseError,
} from '../../server/useCases/getEncounterSettlementOperationStatus'
import { loadEncounterSettlement } from '../../server/useCases/loadEncounterSettlement'
import type { StoredEncounterSettlementOperation } from '../../server/storage/encounterSettlementRepository'
import type { StoredEncounterSettlementCorrection } from '../../server/storage/encounterSettlementCorrectionRepository'

const profile = {
  schemaVersion: 1,
  id: 'profile_12345678',
  displayName: 'Player',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'owner-trainer' }],
} as PlayerProfile

const settlement = () => {
  const created = createEncounterSettlementDocument({
    settlementId: 'encounter-settlement:recovery-a',
    rewardPackageId: 'reward-package-recovery-a',
    encounter: {
      encounterId: 'encounter-recovery-a', encounterRevision: 2,
      linkedMapSlug: 'recovery-arena', linkedMapRevision: 3, campaignMinute: 100,
    },
  })
  return parseEncounterSettlementDocument({
    ...created,
    revision: 4,
    status: 'blocked',
    participants: [{
      participantId: 'participant-owner-a',
      sourceAuthority: { kind: 'map', id: 'recovery-arena', revision: 3 },
      sheetKind: 'trainer', sheetSlug: 'owner-trainer', sheetRevision: 6,
      sideId: 'heroes', ownerParticipantId: null, settlementRole: 'combatant', disposition: 'active',
    }],
    unresolvedGates: [{
      gateId: 'private-gate-a', kind: 'private-choice', blocking: true, audience: 'participant-owner',
      authorityRefs: [{ kind: 'sheet', id: 'owner-trainer', revision: 6 }],
      participantIds: ['participant-owner-a'], resolutionKinds: ['choose'], openedAtSettlementRevision: 4,
    }],
    rewardPackage: {
      rewardPackageId: 'reward-package-recovery-a', status: 'ready',
      lines: [{
        rewardId: 'owner-money-a', visibility: 'destination-owner',
        sourceAuthority: { kind: 'encounter-document', id: 'encounter-recovery-a', revision: 2 },
        disposition: 'pending', payload: { kind: 'money', amount: 90 },
      }, {
        rewardId: 'secret-note-a', visibility: 'gm',
        sourceAuthority: { kind: 'objective', id: 'secret-objective-a', revision: 1 },
        disposition: 'pending',
        payload: { kind: 'narrative', factId: 'secret-fact-a', note: 'NEVER PUBLIC GM NOTE' },
      }],
    },
    allocations: [{
      allocationId: 'owner-money-allocation-a', rewardId: 'owner-money-a',
      destination: { kind: 'trainer-inventory', id: 'owner-trainer', revision: 6 },
      method: 'fixed', amount: 90, weight: null, state: 'proposed', decisionId: null, receiptId: null,
    }],
    updatedAtCampaignMinute: 100,
  })
}

const loadDependencies = () => ({
  settlementRepository: {
    get: () => settlement(),
    listHistoryFacts: () => [{
      factId: 'private-history-id-a', settlementId: 'internal-settlement-id', operationId: 'internal-operation-id',
      kind: 'loot-award' as const, audience: 'destination-owner' as const,
      subjectKind: 'inventory' as const, subjectId: 'trainer-inventory:owner-trainer',
      resultCode: 'money-committed', payload: { rewardId: 'owner-money-a', amount: 90 },
      createdAtCampaignMinute: 101,
    }],
  },
  correctionRepository: { listBySettlement: () => [] },
  mapRepository: { getBySlug: () => ({ slug: 'recovery-arena', playerVisible: true }) },
  sheetRepository: {
    list: () => [{
      kind: 'trainer' as const, slug: 'owner-trainer', revision: 6, updatedAt: 1,
      document: { slug: 'owner-trainer', currentTeam: [], boxedPokemon: [] },
    }],
  },
  groupRepository: { get: () => null },
})

const commitCommand = {
  schemaVersion: 1 as const,
  operationId: 'settlement-operation:recovery-a',
  settlementId: 'encounter-settlement:recovery-a',
  expectedSettlementRevision: 3,
  planDefinitionSha256: 'a'.repeat(64),
  confirmed: true as const,
}
const commandHash = createHash('sha256').update(stableJsonStringify(commitCommand)).digest('hex')
const storedCommit = (): StoredEncounterSettlementOperation => ({
  operationId: commitCommand.operationId,
  settlementId: commitCommand.settlementId,
  principalKey: 'role:gm',
  commandSha256: commandHash,
  command: commitCommand,
  planDefinitionSha256: commitCommand.planDefinitionSha256,
  authorityDefinitionSha256: 'b'.repeat(64),
  result: {
    schemaVersion: 1,
    operationId: commitCommand.operationId,
    settlementId: commitCommand.settlementId,
    settlementRevision: 4,
    encounterId: 'encounter-recovery-a', encounterRevision: 3,
    mapSlug: 'recovery-arena', mapRevision: 4,
    sheetRevisions: [], groupRevisions: [], historyFactIds: [], attentionSourceIds: [],
    completedAtCampaignMinute: 101,
  },
  resultDefinitionSha256: 'c'.repeat(64),
  settlementRevision: 4,
  createdAt: 1,
  acceptedAtCampaignMinute: 101,
})

describe('encounter settlement load and uncertain-operation recovery', () => {
  it('marks stale drafts, restores current owner data, and keeps GM notes and internal identities private', () => {
    const response = loadEncounterSettlement({
      role: 'player', playerProfile: profile,
      settlementId: 'encounter-settlement:recovery-a', expectedRevision: 2, historyLimit: 10,
    }, loadDependencies())

    expect(response).toMatchObject({
      freshness: 'stale-draft',
      settlement: {
        revision: 4,
        audience: 'owner',
        rewards: [{ kind: 'money', amount: 90, disposition: 'pending' }],
        unresolvedGates: [{ kind: 'private-choice', resolutionKinds: ['choose'] }],
      },
      history: [{ kind: 'loot-award', resultCode: 'money-committed', detail: { amount: 90 } }],
    })
    const json = JSON.stringify(response)
    expect(json).not.toMatch(/NEVER PUBLIC|private-history-id|internal-operation|owner-money-a|allocation-a|profile_12345678/)

    const gm = loadEncounterSettlement({
      role: 'gm', playerProfile: null,
      settlementId: 'encounter-settlement:recovery-a', expectedRevision: 4,
    }, loadDependencies())
    expect(JSON.stringify(gm)).toContain('NEVER PUBLIC GM NOTE')
    expect(gm.freshness).toBe('current')
  })

  it('does not treat an arbitrary existing group inventory as player destination authority', () => {
    const base = settlement()
    const withPrivateGroup = parseEncounterSettlementDocument({
      ...base,
      rewardPackage: {
        ...base.rewardPackage,
        lines: [...base.rewardPackage.lines, {
          rewardId: 'private-group-money-a', visibility: 'destination-owner',
          sourceAuthority: { kind: 'encounter-document', id: 'encounter-recovery-a', revision: 2 },
          disposition: 'pending', payload: { kind: 'money', amount: 777 },
        }],
      },
      allocations: [...base.allocations, {
        allocationId: 'private-group-allocation-a', rewardId: 'private-group-money-a',
        destination: { kind: 'group-inventory', id: 'gm-private-stash', revision: 1 },
        method: 'fixed', amount: 777, weight: null, state: 'proposed', decisionId: null, receiptId: null,
      }],
    })
    const dependencies = loadDependencies()
    const response = loadEncounterSettlement({
      role: 'player', playerProfile: profile,
      settlementId: withPrivateGroup.settlementId,
    }, {
      ...dependencies,
      settlementRepository: {
        get: () => withPrivateGroup,
        listHistoryFacts: dependencies.settlementRepository.listHistoryFacts,
      },
      groupRepository: { get: () => ({ slug: 'gm-private-stash' }) as never },
    })

    expect(response.settlement.rewards).toEqual([
      { kind: 'money', amount: 90, disposition: 'pending' },
    ])
    expect(JSON.stringify(response)).not.toContain('777')
  })

  it('returns only safe accepted status and requires explicit retry when no durable result exists', () => {
    const accepted = getEncounterSettlementOperationStatus({
      role: 'gm', principalKey: 'role:gm', command: commitCommand,
    }, {
      settlementRepository: { getOperation: () => storedCommit() },
      correctionRepository: { getOperation: () => null },
    })
    expect(accepted).toEqual({
      status: 'accepted', operationKind: 'commit', settlementRevision: 4,
      acceptedAtCampaignMinute: 101, retry: 'not-needed',
    })
    expect(JSON.stringify(accepted)).not.toMatch(/operationId|settlement-operation|encounter-settlement/)

    expect(getEncounterSettlementOperationStatus({
      role: 'gm', principalKey: 'role:gm', command: commitCommand,
    }, {
      settlementRepository: { getOperation: () => null },
      correctionRepository: { getOperation: () => null },
    })).toEqual({ status: 'unknown', retry: 'explicit-only' })
  })

  it('fails closed for another principal, ambiguous journals, malformed commands, and player recovery', () => {
    const correction = { operationId: commitCommand.operationId } as StoredEncounterSettlementCorrection
    expect(() => getEncounterSettlementOperationStatus({
      role: 'gm', principalKey: 'role:other', command: commitCommand,
    }, {
      settlementRepository: { getOperation: () => storedCommit() },
      correctionRepository: { getOperation: () => null },
    })).toThrowError(expect.objectContaining<Partial<GetEncounterSettlementOperationStatusUseCaseError>>({ statusCode: 409 }))

    expect(() => getEncounterSettlementOperationStatus({
      role: 'gm', principalKey: 'role:gm', command: commitCommand,
    }, {
      settlementRepository: { getOperation: () => storedCommit() },
      correctionRepository: { getOperation: () => correction },
    })).toThrow(/ambiguous/)

    expect(() => getEncounterSettlementOperationStatus({
      role: 'player', principalKey: 'role:gm', command: commitCommand,
    })).toThrowError(expect.objectContaining<Partial<GetEncounterSettlementOperationStatusUseCaseError>>({ statusCode: 403 }))
    expect(() => getEncounterSettlementOperationStatus({
      role: 'gm', principalKey: 'role:gm', command: { ...commitCommand, confirmed: false },
    })).toThrowError(expect.objectContaining<Partial<GetEncounterSettlementOperationStatusUseCaseError>>({ statusCode: 400 }))
  })
})
