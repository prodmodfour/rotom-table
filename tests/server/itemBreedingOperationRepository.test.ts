import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteItemBreedingOperationRepository } from '../../server/storage/itemBreedingOperationRepository'

const databases: RotomDatabase[] = []
const open = () => { const value = openRotomDatabase({ path: ':memory:', enableWal: false }); databases.push(value); return value }
afterEach(() => { while (databases.length) databases.pop()?.close() })
const command = {
  schemaVersion: 1 as const, kind: 'assign-egg-warmer' as const,
  operationId: `item-breeding:v1:${'a'.repeat(32)}`,
  trainerSheetSlug: 'trainer-owner', expectedTrainerRevision: 2,
  warmerUnitOptionId: `breeding-item-option:v1:${'b'.repeat(32)}`,
  eggOptionIds: [`breeding-item-option:v1:${'c'.repeat(32)}`],
}
const result = {
  schemaVersion: 1 as const, operationId: command.operationId, kind: command.kind, status: 'accepted' as const,
  trainerSheetSlug: command.trainerSheetSlug, trainerRevision: 3, egg: null,
  assignment: { warmerLabel: 'Egg Warmer', assignedEggLabels: ['Eevee Egg'], capacity: 4 as const, progressRateNumerator: 2 as const, progressRateDenominator: 1 as const },
  message: 'One Egg assigned.',
}
const hash = createHash('sha256').update(stableJsonStringify(command)).digest('hex')

describe('item breeding operation repository', () => {
  it('round-trips canonical principal-bound replay evidence', () => {
    const repository = createSqliteItemBreedingOperationRepository(open())
    const stored = repository.insert({ commandSha256: hash, principalKey: 'gm', command, result, evidence: { source: 'reviewed' }, createdAt: 50 })
    expect(repository.find(command.operationId)).toEqual(stored)
    expect(stored).toMatchObject({ commandSha256: hash, principalKey: 'gm', command, result, evidence: { source: 'reviewed' }, createdAt: 50 })
  })

  it('rejects cross-Trainer results and unbounded principal identity before storage', () => {
    const repository = createSqliteItemBreedingOperationRepository(open())
    expect(() => repository.insert({ commandSha256: hash, principalKey: 'gm', command,
      result: { ...result, trainerSheetSlug: 'trainer-other' }, evidence: {}, createdAt: 50 })).toThrow('identity is invalid')
    expect(() => repository.insert({ commandSha256: hash, principalKey: 'x'.repeat(161), command,
      result, evidence: {}, createdAt: 50 })).toThrow('identity is invalid')
  })
})
