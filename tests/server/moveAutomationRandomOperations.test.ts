import { describe, expect, it } from 'vitest'
import {
  parseMoveRandomMovePoolDefinition,
  parseMoveRandomTableDefinition,
} from '#shared/moveAutomation/randomTables'
import {
  materializeMovePoolCandidates,
  resolveReviewedMovePool,
} from '~~/server/domain/moveAutomation/movePools'
import {
  MoveRandomOperationError,
  resolveMoveRandomTable,
} from '~~/server/domain/moveAutomation/randomOperations'
import {
  createAuthoritativeMoveRandom,
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'

const operationTable = (options: {
  readonly distribution?: 'equal' | 'weighted'
  readonly maximumRerolls?: number
} = {}) => parseMoveRandomTableDefinition({
  tableId: 'table.canary-outcomes',
  distribution: options.distribution ?? 'equal',
  entries: [{
    id: 'dire-claw-paralysis',
    weight: options.distribution === 'weighted' ? 1 : null,
    operationIds: ['condition.paralyzed'],
    predicate: null,
  }, {
    id: 'tri-attack-burn',
    weight: options.distribution === 'weighted' ? 3 : null,
    operationIds: ['condition.burned'],
    predicate: null,
  }],
  maximumRerolls: options.maximumRerolls ?? 0,
})

describe('authoritative reviewed random operations', () => {
  it('selects equal and weighted nested operation lists with one recorded table roll', () => {
    const equalRandom = createAuthoritativeMoveRandom(
      createFiniteAuthoritativeMoveRandomStream([0.99]),
    )
    const equal = resolveMoveRandomTable({
      definition: operationTable(),
      rollId: 'roll.equal-outcome',
      parentEffectId: 'operation.random-outcome',
      reasonCode: 'move.tri-attack.random-condition',
      random: equalRandom,
    })
    expect(equal).toMatchObject({
      candidateCount: 2,
      selectedId: 'tri-attack-burn',
      selected: { operationIds: ['condition.burned'] },
      attemptCount: 1,
      rollIds: ['roll.equal-outcome'],
    })
    expect(equalRandom.complete()).toEqual([
      expect.objectContaining({
        formula: { kind: 'table', tableId: 'table.canary-outcomes' },
        naturalResult: 2,
        finalValue: 2,
      }),
    ])

    const weightedRandom = createAuthoritativeMoveRandom(
      createFiniteAuthoritativeMoveRandomStream([0.26]),
    )
    const weighted = resolveMoveRandomTable({
      definition: operationTable({ distribution: 'weighted' }),
      rollId: 'roll.weighted-outcome',
      parentEffectId: 'operation.random-outcome',
      reasonCode: 'move.present.random-outcome',
      random: weightedRandom,
    })
    expect(weighted.selectedId).toBe('tri-attack-burn')
    expect(weightedRandom.complete()[0]).toMatchObject({ naturalResult: 2, finalValue: 2 })
  })

  it('rerolls an inapplicable Magnitude-style entry within the shared finite budget', () => {
    const random = createAuthoritativeMoveRandom(
      createFiniteAuthoritativeMoveRandomStream([0, 0.99]),
    )
    let reservedRetries = 0
    const result = resolveMoveRandomTable({
      definition: operationTable({ maximumRerolls: 1 }),
      rollId: 'roll.magnitude',
      parentEffectId: 'operation.magnitude',
      reasonCode: 'move.magnitude.random-power',
      random,
      isEntryValid: entry => entry.id !== 'dire-claw-paralysis',
      reserveRetry: () => { reservedRetries += 1 },
    })

    expect(result).toMatchObject({
      candidateCount: 2,
      selectedId: 'tri-attack-burn',
      attemptCount: 2,
      rollIds: ['roll.magnitude', 'roll.magnitude.reroll-1'],
    })
    expect(reservedRetries).toBe(1)
    expect(random.complete()).toHaveLength(2)
  })

  it('fails closed after bounded invalid retries without mutating reviewed input', () => {
    const definition = operationTable({ maximumRerolls: 1 })
    const before = structuredClone(definition)
    const random = createAuthoritativeMoveRandom(
      createFiniteAuthoritativeMoveRandomStream([0, 0.99]),
    )

    expect(() => resolveMoveRandomTable({
      definition,
      rollId: 'roll.invalid',
      parentEffectId: 'operation.invalid',
      reasonCode: 'move.random.invalid',
      random,
      isEntryValid: () => false,
    })).toThrowError(expect.objectContaining<Partial<MoveRandomOperationError>>({
      code: 'random-rerolls-exhausted',
    }))
    expect(definition).toEqual(before)
  })
})

describe('reviewed random move pools', () => {
  const explicitPool = parseMoveRandomMovePoolDefinition({
    poolId: 'pool.metronome',
    rollId: 'roll.metronome',
    source: {
      kind: 'explicit',
      canonicalIds: ['Scratch', 'Explosion', 'Swords Dance'],
    },
    allowCanonicalIds: ['Scratch', 'Explosion', 'Swords Dance'],
    denyCanonicalIds: ['Explosion'],
    maximumRerolls: 1,
  })

  it('materializes stable explicit allow/deny candidates for Metronome', () => {
    expect(materializeMovePoolCandidates({ definition: explicitPool })).toEqual([
      'Scratch',
      'Swords Dance',
    ])
  })

  it('materializes private authoritative move lists for Assist and Sleep Talk', () => {
    const pool = parseMoveRandomMovePoolDefinition({
      poolId: 'pool.authoritative-list',
      rollId: 'roll.authoritative-list',
      source: { kind: 'authoritative-move-lists', owners: 'actor-and-operation-recipients' },
      allowCanonicalIds: ['Scratch', 'Ember', 'Swords Dance'],
      denyCanonicalIds: ['Ember'],
      maximumRerolls: 0,
    })
    const lists = [{
      ownerPlacementId: 'actor-token',
      canonicalIds: ['Scratch', 'Ember'],
    }, {
      ownerPlacementId: 'ally-token',
      canonicalIds: ['Swords Dance', 'Scratch'],
    }]

    expect(materializeMovePoolCandidates({
      definition: pool,
      authoritativeMoveLists: lists,
    })).toEqual(['Scratch', 'Swords Dance'])
  })

  it('records only candidate count and selected move identity, never private alternatives', () => {
    const random = createAuthoritativeMoveRandom(
      createFiniteAuthoritativeMoveRandomStream([0.99]),
    )
    const result = resolveReviewedMovePool({
      definition: explicitPool,
      parentEffectId: 'operation.metronome-child',
      reasonCode: 'move.metronome.random-child',
      random,
    })

    expect(result).toMatchObject({
      candidateCount: 2,
      selectedId: 'Swords Dance',
      selected: 'Swords Dance',
      attemptCount: 1,
    })
    expect(Object.keys(result)).toEqual([
      'candidateCount',
      'selectedId',
      'selected',
      'attemptCount',
      'rollIds',
    ])
    expect(JSON.stringify(result)).not.toContain('Scratch')
    expect(random.complete()[0]).toMatchObject({
      formula: { kind: 'table', tableId: 'pool.metronome' },
    })
  })
})
