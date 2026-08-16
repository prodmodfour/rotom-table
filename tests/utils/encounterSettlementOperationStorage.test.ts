import { describe, expect, it } from 'vitest'
import {
  ENCOUNTER_SETTLEMENT_PENDING_SCHEMA_VERSION,
  clearPendingEncounterSettlementOperation,
  EncounterSettlementRecoveryConflictError,
  parsePendingEncounterSettlementOperation,
  pendingEncounterSettlementLockStorageKey,
  pendingEncounterSettlementStorageKey,
  readPendingEncounterSettlementOperation,
  removePendingEncounterSettlementOperation,
  writePendingEncounterSettlementOperation,
} from '~/utils/encounterSettlementOperationStorage'

const command = {
  schemaVersion: 1 as const,
  operationId: 'settlement-commit:v1:0000000001000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  settlementId: 'encounter-settlement:riverside-training',
  expectedSettlementRevision: 3,
  planDefinitionSha256: 'a'.repeat(64),
  confirmed: true as const,
}
const pending = () => ({
  schemaVersion: ENCOUNTER_SETTLEMENT_PENDING_SCHEMA_VERSION,
  encounterId: 'encounter-riverside-training',
  command,
  createdAt: 1_000,
})
const memoryStorage = () => {
  const rows = new Map<string, string>()
  return {
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => { rows.set(key, value) },
    removeItem: (key: string) => { rows.delete(key) },
    rows,
  }
}

describe('pending Finish Encounter operation storage', () => {
  it('retains only one strict exact commit command for explicit recovery', () => {
    const storage = memoryStorage()
    expect(writePendingEncounterSettlementOperation(storage, pending())).toEqual(pending())
    expect(readPendingEncounterSettlementOperation(storage, pending().encounterId)).toEqual(pending())
    expect([...storage.rows.keys()].sort()).toEqual([
      pendingEncounterSettlementLockStorageKey(pending().encounterId),
      pendingEncounterSettlementStorageKey(pending().encounterId),
    ].sort())
    removePendingEncounterSettlementOperation(storage, pending().encounterId)
    expect(readPendingEncounterSettlementOperation(storage, pending().encounterId)).toBeNull()
  })

  it('excludes another tab command and clears only the exact retained operation', () => {
    const storage = memoryStorage()
    const retained = writePendingEncounterSettlementOperation(storage, pending())
    const competing = {
      ...pending(),
      command: {
        ...command,
        operationId: 'settlement-commit:v1:0000000001001:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    }
    expect(() => writePendingEncounterSettlementOperation(storage, competing))
      .toThrow(EncounterSettlementRecoveryConflictError)
    expect(clearPendingEncounterSettlementOperation(storage, competing)).toBe(false)
    expect(readPendingEncounterSettlementOperation(storage, pending().encounterId)).toEqual(retained)
    expect(clearPendingEncounterSettlementOperation(storage, retained)).toBe(true)
    expect(readPendingEncounterSettlementOperation(storage, pending().encounterId)).toBeNull()
  })

  it('rejects command expansion and removes malformed durable records', () => {
    expect(() => parsePendingEncounterSettlementOperation({ ...pending(), privateEvidence: {} }))
      .toThrow(/invalid/)
    expect(() => parsePendingEncounterSettlementOperation({
      ...pending(), command: { ...command, clientPatch: [] },
    })).toThrow()

    const storage = memoryStorage()
    const key = pendingEncounterSettlementStorageKey(pending().encounterId)
    storage.setItem(key, JSON.stringify({ ...pending(), createdAt: -1 }))
    expect(readPendingEncounterSettlementOperation(storage, pending().encounterId)).toBeNull()
    expect(storage.rows.has(key)).toBe(false)
  })
})
