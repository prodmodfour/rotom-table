import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { parseCapabilityActionPublicResult, parseExecuteCapabilityActionCommand } from '#shared/capabilityAutomation/clientCommands'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteCapabilityAdjudicationRepository } from '../../server/storage/capabilityAdjudicationRepository'
import { createSqliteCapabilityResolutionOperationRepository } from '../../server/storage/capabilityResolutionOperationRepository'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => { while (databases.length) databases.pop()!.close() })

const command = parseExecuteCapabilityActionCommand({
  schemaVersion: 1, operationId: 'capability-operation-1', mapSlug: 'map', baseRevision: 3,
  offerId: 'offer', actorPlacementId: 'actor', capabilityInstanceId: 'capability:actor:Magnetic:base',
  canonicalId: 'Magnetic', actionId: 'manipulate-metal',
  selections: {
    targetPlacementIds: [], cells: [{ x: 1, y: 1, z: 1 }], optionId: null,
    recipientTrainerSlug: null, canonicalItemId: null, description: 'Open the iron latch', gmConfirmed: false,
  },
})
const commandSha = createHash('sha256').update(stableJsonStringify(command)).digest('hex')

describe('Capability SQLite operation authority', () => {
  it('round-trips canonical command/result/audit JSON and rejects operation-ID reuse', () => {
    const repository = createSqliteCapabilityResolutionOperationRepository(open())
    const result = parseCapabilityActionPublicResult({
      schemaVersion: 1, operationId: command.operationId, mapSlug: command.mapSlug, mapRevision: 4,
      actorPlacementId: command.actorPlacementId, canonicalId: command.canonicalId, actionId: command.actionId,
      outcome: 'applied', reasonCode: 'capability.bounded-adjudication-accepted', rolls: [], produced: [],
      changedMap: true, changedSheetSlugs: [], adjudicationNote: 'Open the iron latch',
    })
    repository.insert({ commandSha256: commandSha, command, result, audit: { definitionHash: 'a'.repeat(64) }, createdAt: 100 })
    expect(repository.find(command.operationId)).toEqual(expect.objectContaining({ commandSha256: commandSha, command, result }))
    expect(() => repository.insert({ commandSha256: commandSha, command, result, audit: {}, createdAt: 101 })).toThrow()
  })

  it('transitions an exact pending adjudication once and retains resolution identity', () => {
    const repository = createSqliteCapabilityAdjudicationRepository(open())
    repository.insert({
      requestId: command.operationId, commandSha256: commandSha, command,
      definitionHash: 'b'.repeat(64), status: 'pending', requestedAt: 100, expiresAt: 200,
      resolvedAt: null, resolutionOperationId: null, resolutionCommandSha256: null,
    })
    expect(repository.resolve({
      requestId: command.operationId, expectedStatus: 'pending', status: 'accepted',
      resolvedAt: 150, resolutionOperationId: 'resolution-operation-1',
      resolutionCommandSha256: 'c'.repeat(64),
    })).toBe('applied')
    expect(repository.resolve({
      requestId: command.operationId, expectedStatus: 'pending', status: 'rejected',
      resolvedAt: 151, resolutionOperationId: 'resolution-operation-2',
      resolutionCommandSha256: 'd'.repeat(64),
    })).toBe('stale')
    expect(repository.find(command.operationId)).toMatchObject({
      status: 'accepted', resolvedAt: 150, resolutionOperationId: 'resolution-operation-1',
      resolutionCommandSha256: 'c'.repeat(64),
    })
  })
})
