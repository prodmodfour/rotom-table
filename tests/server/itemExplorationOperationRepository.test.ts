import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteItemExplorationOperationRepository } from '../../server/storage/itemExplorationOperationRepository'
import { LATEST_STORAGE_SCHEMA_VERSION } from '../../server/storage/migrations'
import type {
  ItemExplorationOperationCommandV1,
  ItemExplorationOperationResultV1,
} from '#shared/itemAutomation/exploration'

const databases: RotomDatabase[] = []
const open = (): RotomDatabase => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}
afterEach(() => { while (databases.length) databases.pop()!.close() })

const command = (): ItemExplorationOperationCommandV1 => ({
  schemaVersion: 1,
  operationId: 'item-exploration:v1:11111111111111111111111111111111',
  kind: 'settle-direct-repel',
  mapSlug: 'route-map',
  mapRevision: 7,
  decisionId: 'item-repel-position:v1:22222222222222222222222222222222',
  destination: { x: 5, y: 0, z: 1 },
})
const result = (): ItemExplorationOperationResultV1 => ({
  schemaVersion: 1,
  operationId: command().operationId,
  kind: 'settle-direct-repel',
  status: 'accepted',
  exactReplay: false,
  message: 'The exact endpoint was accepted.',
  trainerSlug: null,
  trainerRevision: null,
  mapSlug: 'route-map',
  mapRevision: 8,
  activity: null,
})

describe('item exploration operation repository', () => {
  it('persists canonical principal-bound commands, results, and private evidence at current schema', () => {
    const database = open()
    expect(database.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: LATEST_STORAGE_SCHEMA_VERSION })
    const repository = createSqliteItemExplorationOperationRepository(database)
    const stored = repository.insert({
      commandSha256: 'a'.repeat(64),
      principalKey: 'gm',
      command: command(),
      result: result(),
      evidence: { kind: 'direct-repel-positioning', privatePath: [{ x: 2, y: 0, z: 1 }, { x: 5, y: 0, z: 1 }] },
      createdAt: 500,
    })
    expect(stored).toEqual(repository.find(command().operationId))
    expect(stored).toMatchObject({
      commandSha256: 'a'.repeat(64), principalKey: 'gm', createdAt: 500,
      command: { mapSlug: 'route-map', mapRevision: 7 },
      result: { mapSlug: 'route-map', mapRevision: 8 },
      evidence: { kind: 'direct-repel-positioning' },
    })
    expect(() => repository.insert({ ...stored })).toThrow(/UNIQUE constraint failed/i)
  })

  it('fails closed when indexed authority or canonical JSON is corrupted', () => {
    const database = open()
    const repository = createSqliteItemExplorationOperationRepository(database)
    repository.insert({
      commandSha256: 'b'.repeat(64), principalKey: 'gm', command: command(), result: result(),
      evidence: { kind: 'direct-repel-positioning' }, createdAt: 500,
    })
    database.connection.prepare(`
      UPDATE item_exploration_operations SET aggregate_id = 'other-map'
      WHERE operation_id = ?
    `).run(command().operationId)
    expect(() => repository.find(command().operationId)).toThrow('indexes or canonical JSON disagree')
  })
})
