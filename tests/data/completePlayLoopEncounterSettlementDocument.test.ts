import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/encounter-settlement-document.v1.json'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'
import {
  ENCOUNTER_SETTLEMENT_AUDIENCES,
  ENCOUNTER_SETTLEMENT_AUTHORITY_KINDS,
  ENCOUNTER_SETTLEMENT_BEHAVIORS,
  ENCOUNTER_SETTLEMENT_CLEANUP_KINDS,
  ENCOUNTER_SETTLEMENT_CONSEQUENCE_KINDS,
  ENCOUNTER_SETTLEMENT_DOCUMENT_SCHEMA_VERSION,
  ENCOUNTER_SETTLEMENT_GATE_KINDS,
  ENCOUNTER_SETTLEMENT_GATE_RESOLUTIONS,
  ENCOUNTER_SETTLEMENT_LIMITS,
  ENCOUNTER_SETTLEMENT_STATUSES,
} from '../../shared/encounterSettlement/document'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P8-071 encounter settlement document contract', () => {
  it('is versioned and bound to the current encounter, workspace, fixture, gap, and runtime models', () => {
    expect(contract).toMatchObject({
      schemaVersion: ENCOUNTER_SETTLEMENT_DOCUMENT_SCHEMA_VERSION,
      ticket: 'P8-071',
      status: 'current-semantics',
      contract: 'encounter-settlement-document-v1',
    })
    const sources = {
      encounterDocumentModelSha256: 'shared/encounterDocuments/model.ts',
      settlementDocumentModelSha256: 'shared/encounterSettlement/document.ts',
      settlementGapMatrixSha256: 'data/complete-play-loop/settlement-gap-matrix.v1.json',
      settlementFixturesSha256: 'data/complete-play-loop/fixtures/settlements.v1.json',
      encounterStateModelSha256: 'shared/moveAutomation/encounterState.ts',
      encounterWorkspaceModelSha256: 'shared/encounterWorkspace/model.ts',
    } as const
    expect(Object.keys(contract.sourceEvidence)).toEqual(Object.keys(sources))
    for (const [key, path] of Object.entries(sources)) {
      expect(acceptedSuccessorHead(path, contract.sourceEvidence[key as keyof typeof sources]), path).toBe(sha256(path))
    }
  })

  it('keeps orchestration separate from every existing mechanics authority', () => {
    expect(contract.ownership.documentOwns).toEqual(expect.arrayContaining([
      'settlement lifecycle and revision',
      'unresolved gate inventory',
      'reward package and allocation declarations',
      'terminal completion evidence',
    ]))
    expect(contract.ownership.documentDoesNotOwn).toEqual(expect.arrayContaining([
      'encounter or map mechanics',
      'sheet HP, Injuries, conditions, Experience, money, inventory, equipment, moves, or ownership',
      'capture creation or roster mutation',
      'operation idempotency or realtime event storage',
    ]))
    expect(contract.ownership.rule).toContain('never becomes a parallel mechanics authority')
    expect(contract.encounterReference.purpose).toContain('no EncounterDocument or map payload is embedded')
    expect(contract.participants.forbiddenCopies).toContain('sheet document')
    expect(contract.persistentConsequences.snapshotAuthority).toContain('preview only')
  })

  it('matches the strict runtime discriminants, bounds, and terminal pairing', () => {
    expect(contract.root.statuses).toEqual([...ENCOUNTER_SETTLEMENT_STATUSES])
    expect(contract.unresolvedGates.kinds).toEqual([...ENCOUNTER_SETTLEMENT_GATE_KINDS])
    expect(contract.unresolvedGates.boundedResolutions).toEqual([...ENCOUNTER_SETTLEMENT_GATE_RESOLUTIONS])
    expect(contract.persistentConsequences.kinds).toEqual([...ENCOUNTER_SETTLEMENT_CONSEQUENCE_KINDS])
    expect(contract.persistentConsequences.behaviors).toEqual([...ENCOUNTER_SETTLEMENT_BEHAVIORS])
    expect(contract.temporaryCleanup.kinds).toEqual([...ENCOUNTER_SETTLEMENT_CLEANUP_KINDS])
    expect(contract.privacy.audiences).toEqual([...ENCOUNTER_SETTLEMENT_AUDIENCES])
    expect(ENCOUNTER_SETTLEMENT_AUTHORITY_KINDS).toEqual(expect.arrayContaining([
      'encounter-document', 'map', 'sheet', 'group-inventory', 'capture-operation', 'resource',
    ]))
    expect(contract.limits).toEqual({
      participants: ENCOUNTER_SETTLEMENT_LIMITS.participants,
      unresolvedGates: ENCOUNTER_SETTLEMENT_LIMITS.unresolvedGates,
      consequences: ENCOUNTER_SETTLEMENT_LIMITS.consequences,
      rewardLines: ENCOUNTER_SETTLEMENT_LIMITS.rewardLines,
      allocations: ENCOUNTER_SETTLEMENT_LIMITS.allocations,
      cleanupEntries: ENCOUNTER_SETTLEMENT_LIMITS.cleanupEntries,
      decisions: ENCOUNTER_SETTLEMENT_LIMITS.decisions,
      receipts: ENCOUNTER_SETTLEMENT_LIMITS.receipts,
      decisionOptions: ENCOUNTER_SETTLEMENT_LIMITS.decisionOptions,
      narrativeCharacters: ENCOUNTER_SETTLEMENT_LIMITS.narrativeChars,
    })
    expect(contract.completion.terminalPairing).toEqual({ completed: 'accepted', cancelled: 'cancelled' })
    expect(contract.root.unknownFields).toBe('reject')
  })

  it('covers every required settlement section and assigns later mechanics to ordered tickets', () => {
    expect(contract.root.fields).toEqual([
      'schemaVersion', 'settlementId', 'revision', 'status', 'encounter', 'participants',
      'unresolvedGates', 'persistentConsequences', 'rewardPackage', 'allocations',
      'temporaryCleanup', 'decisions', 'receipts', 'completion',
      'createdAtCampaignMinute', 'updatedAtCampaignMinute',
    ])
    expect(contract.rewardPackage.payloadKinds).toEqual([
      'experience', 'money', 'item', 'capture', 'narrative',
    ])
    expect(contract.temporaryCleanup.sourceAware).toBe(true)
    expect(contract.unresolvedGates.allBlocking).toBe(true)
    expect(Object.keys(contract.futureTicketOwnership)).toEqual([
      'P8-072', 'P8-073', 'P8-074', 'P8-075', 'P8-076', 'P8-077',
      'P8-078', 'P8-079', 'P8-080', 'P8-081', 'P8-082',
    ])
    expect(contract.privacy.projectionRule).toContain('never expose this server document verbatim')
  })
})
