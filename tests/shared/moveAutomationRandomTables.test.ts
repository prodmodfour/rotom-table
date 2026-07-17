import { describe, expect, it } from 'vitest'
import {
  MOVE_RANDOM_SELECTION_LIMITS,
  MoveRandomSelectionValidationError,
  parseMoveRandomMovePoolDefinition,
  parseMoveRandomTableDefinition,
  randomSelectionRollId,
} from '#shared/moveAutomation/randomTables'

const table = (distribution: 'equal' | 'weighted' = 'equal') => ({
  tableId: 'table.random-condition',
  distribution,
  entries: [{
    id: 'paralyzed',
    weight: distribution === 'equal' ? null : 1,
    operationIds: ['condition.paralyzed'],
    predicate: null,
  }, {
    id: 'burned',
    weight: distribution === 'equal' ? null : 2,
    operationIds: ['condition.burned', 'log.burned'],
    predicate: { kind: 'constant', value: true },
  }],
  maximumRerolls: 1,
})

const expectError = (
  operation: () => unknown,
  code: MoveRandomSelectionValidationError['code'],
  path: string,
): void => {
  expect(operation).toThrowError(expect.objectContaining<Partial<MoveRandomSelectionValidationError>>({
    code,
    path,
  }))
}

describe('reviewed random table contracts', () => {
  it('parses immutable equal operation lists for Dire Claw, Tri Attack, and Nature Power shapes', () => {
    const input = table()
    const parsed = parseMoveRandomTableDefinition(input)
    input.entries[0]!.operationIds.push('client.patch')

    expect(parsed).toMatchObject({
      distribution: 'equal',
      entries: [
        { id: 'paralyzed', weight: null, operationIds: ['condition.paralyzed'] },
        { id: 'burned', weight: null, operationIds: ['condition.burned', 'log.burned'] },
      ],
      maximumRerolls: 1,
    })
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.entries)).toBe(true)
    expect(Object.isFrozen(parsed.entries[1]!.predicate)).toBe(true)
    expect(structuredClone(parsed)).toEqual(parsed)
  })

  it('parses weighted Magnitude and Present-style outcome lists', () => {
    const parsed = parseMoveRandomTableDefinition(table('weighted'))
    expect(parsed.entries.map(entry => entry.weight)).toEqual([1, 2])

    const wrongWeight = table('weighted')
    wrongWeight.entries[0]!.weight = null
    expectError(
      () => parseMoveRandomTableDefinition(wrongWeight),
      'invalid-random-selection',
      'randomTable.entries[0].weight',
    )
  })

  it('strictly bounds identities, operation references, weights, and invalid-entry rerolls', () => {
    expectError(
      () => parseMoveRandomTableDefinition({ ...table(), clientScript: 'roll()' }),
      'invalid-random-selection',
      'randomTable',
    )

    const duplicate = table()
    duplicate.entries[1]!.id = duplicate.entries[0]!.id
    expectError(
      () => parseMoveRandomTableDefinition(duplicate),
      'duplicate-id',
      'randomTable.entries.id',
    )

    expectError(
      () => parseMoveRandomTableDefinition({
        ...table(),
        maximumRerolls: MOVE_RANDOM_SELECTION_LIMITS.maximumRerolls + 1,
      }),
      'invalid-random-selection',
      'randomTable.maximumRerolls',
    )
  })
})

describe('reviewed random move-pool contracts', () => {
  it('parses explicit Metronome allow/deny pools without executable alternatives', () => {
    const parsed = parseMoveRandomMovePoolDefinition({
      poolId: 'pool.metronome',
      rollId: 'metronome.pool-roll',
      source: {
        kind: 'explicit',
        canonicalIds: ['Scratch', 'Swords Dance', 'Explosion'],
      },
      allowCanonicalIds: ['Scratch', 'Swords Dance', 'Explosion'],
      denyCanonicalIds: ['Explosion'],
      maximumRerolls: 2,
    })

    expect(parsed.source).toEqual({
      kind: 'explicit',
      canonicalIds: ['Scratch', 'Swords Dance', 'Explosion'],
    })
    expect(Object.keys(parsed)).toEqual([
      'poolId',
      'rollId',
      'source',
      'allowCanonicalIds',
      'denyCanonicalIds',
      'maximumRerolls',
    ])
    expect(Object.isFrozen(parsed.denyCanonicalIds)).toBe(true)
  })

  it('parses actor and recipient authoritative lists for Sleep Talk and Assist', () => {
    for (const owners of ['actor', 'operation-recipients', 'actor-and-operation-recipients'] as const) {
      const parsed = parseMoveRandomMovePoolDefinition({
        poolId: `pool.${owners}`,
        rollId: `roll.${owners}`,
        source: { kind: 'authoritative-move-lists', owners },
        allowCanonicalIds: [],
        denyCanonicalIds: ['Sleep Talk', 'Assist'],
        maximumRerolls: 1,
      })
      expect(parsed.source).toEqual({ kind: 'authoritative-move-lists', owners })
    }
  })

  it('rejects duplicates, oversized roll IDs, client candidates on authoritative sources, and unknown fields', () => {
    const base = {
      poolId: 'pool.sleep-talk',
      rollId: 'roll.sleep-talk',
      source: { kind: 'authoritative-move-lists', owners: 'actor' },
      allowCanonicalIds: [],
      denyCanonicalIds: ['Sleep Talk'],
      maximumRerolls: 1,
    }
    expectError(
      () => parseMoveRandomMovePoolDefinition({
        ...base,
        denyCanonicalIds: ['Sleep Talk', 'Sleep Talk'],
      }),
      'duplicate-id',
      'movePool.denyCanonicalIds',
    )
    expectError(
      () => parseMoveRandomMovePoolDefinition({
        ...base,
        rollId: `r${'x'.repeat(MOVE_RANDOM_SELECTION_LIMITS.rollIdLength)}`,
      }),
      'limit-exceeded',
      'movePool.rollId',
    )
    expectError(
      () => parseMoveRandomMovePoolDefinition({
        ...base,
        source: {
          kind: 'authoritative-move-lists',
          owners: 'actor',
          canonicalIds: ['Client Move'],
        },
      }),
      'invalid-random-selection',
      'movePool.source',
    )
  })

  it('derives stable replay roll IDs within the bounded retry namespace', () => {
    expect(randomSelectionRollId('roll.pool', 1)).toBe('roll.pool')
    expect(randomSelectionRollId('roll.pool', 2)).toBe('roll.pool.reroll-1')
    expect(randomSelectionRollId('roll.pool', 17)).toBe('roll.pool.reroll-16')
  })
})
