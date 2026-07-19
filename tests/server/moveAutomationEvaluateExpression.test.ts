import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { MOVE_RULE_AST_LIMITS } from '#shared/moveAutomation/ast'
import { createEmptyEncounterHistory } from '#shared/moveAutomation/encounterHistory'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  parseMoveExpression,
  type MoveExpression,
} from '#shared/moveAutomation/expressions'
import { parseMovePredicate } from '#shared/moveAutomation/predicates'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  DIGESTION_BUFF_TRADED_CAPABILITY_ID,
  recordDigestionBuffTrade,
} from '~~/server/domain/moveAutomation/digestionBuffTrade'
import {
  MOVE_EXPRESSION_EVALUATION_LIMITS,
  MoveExpressionEvaluationError,
  evaluateMoveExpression,
  evaluateMovePredicate,
  evaluateMoveSelector,
  type MoveExpressionNumericPolicy,
  type MoveRuleSelectorState,
} from '~~/server/domain/moveAutomation/evaluateExpression'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import {
  ENCOUNTER_ACTED_SINCE_ENTRY_FLAG_ID,
} from '~~/server/domain/moveAutomation/reduceEncounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const pokemonSheet = (
  slug: string,
  options: {
    readonly species: string
    readonly currentHp: number
    readonly stage?: number
  },
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: options.species,
  level: slug === 'actor' ? 20 : 30,
  revision: slug === 'actor' ? 3 : 5,
  movelist: slug === 'actor' ? [{ name: 'Tackle' }] : [],
  stats: { atk: { added: slug === 'actor' ? 4 : 0, stage: options.stage ?? 0 } },
  combatStages: { acc: slug === 'actor' ? 1 : 0 },
  combat: {
    currentHp: options.currentHp,
    ...(slug === 'target' ? { conditions: ['Burned'] } : {}),
  },
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'expression-arena',
  name: 'Expression Arena',
  revision: 7,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: {
    weather: [{ kind: 'sunny', rounds: 3 }],
    terrains: [{ kind: 'grassy', rounds: 2, scope: 'field' }],
    rooms: [],
  },
  placements: [
    placement('actor-token', 'actor', 0),
    placement('target-token', 'target', 1),
    placement('other-token', 'other', 2),
  ],
  lights: [],
  initiative: { activeId: 'actor-token', round: 1 },
  encounterState: {
    ...createEmptyEncounterState(),
    history: {
      ...createEmptyEncounterHistory(),
      consecutiveMoves: [{
        placementId: 'actor-token',
        canonicalId: 'Tackle',
        targetPlacementId: 'target-token',
        count: 4,
        lastResolutionId: 'resolution.previous-tackle',
      }],
    },
  },
})

const intent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Tackle',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

const buildContext = (options: {
  readonly map?: TabletopMap
  readonly selectedPlacementIds?: readonly string[]
  readonly candidatePlacementIds?: readonly string[]
} = {}) => buildAuthoritativeMoveRulesContext({
  map: options.map ?? mapFixture(),
  pokemonSheets: new Map([
    ['actor', pokemonSheet('actor', { species: 'Pikachu', currentHp: 40, stage: 2 })],
    ['target', pokemonSheet('target', { species: 'Snorlax', currentHp: 60, stage: -1 })],
    ['other', pokemonSheet('other', { species: 'Abra', currentHp: 20 })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: intent(),
  selectedPlacementIds: options.selectedPlacementIds ?? ['target-token'],
  candidatePlacementIds: options.candidatePlacementIds ?? ['target-token', 'other-token'],
  random: createFiniteAuthoritativeMoveRandomStream([]),
  time: 1_000,
})

const selectorState = (overrides: Partial<MoveRuleSelectorState> = {}): MoveRuleSelectorState => ({
  targetIds: ['target-token'],
  hitTargetIds: ['target-token'],
  missedTargetIds: [],
  damagedTargetIds: [],
  faintedTargetIds: [],
  ...overrides,
})

const constant = (value: string | number | boolean | null) => ({
  kind: 'constant' as const,
  value,
})

const expression = (value: unknown): MoveExpression => parseMoveExpression(value)

const expectEvaluationError = (
  run: () => unknown,
  code: MoveExpressionEvaluationError['code'],
): MoveExpressionEvaluationError => {
  try {
    run()
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveExpressionEvaluationError)
    expect((error as MoveExpressionEvaluationError).code).toBe(code)
    return error as MoveExpressionEvaluationError
  }
}

describe('bounded authoritative move expression evaluator', () => {
  it('preserves arithmetic properties over generated bounded integer inputs', () => {
    const context = buildContext()
    let seed = 0x51f15e
    const nextInteger = (): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return (seed % 2_001) - 1_000
    }

    for (let index = 0; index < 250; index += 1) {
      const left = nextInteger()
      const right = nextInteger() || 1
      const add = expression({
        kind: 'arithmetic',
        operator: 'add',
        operands: [constant(left), constant(right)],
      })
      const subtract = expression({
        kind: 'arithmetic',
        operator: 'subtract',
        operands: [constant(left), constant(right)],
      })
      const modulo = expression({
        kind: 'arithmetic',
        operator: 'modulo',
        operands: [constant(left), constant(right)],
      })

      expect(evaluateMoveExpression({ expression: add, context }).value).toBe(left + right)
      expect(evaluateMoveExpression({ expression: subtract, context }).value).toBe(left - right)
      const expectedModulo = Object.is(left % right, -0) ? 0 : left % right
      expect(evaluateMoveExpression({ expression: modulo, context }).value).toBe(expectedModulo)
      expect(evaluateMoveExpression({ expression: add, context })).toEqual(
        evaluateMoveExpression({ expression: add, context }),
      )
    }
  })

  it('queries scene-local authoritative capability markers without client state', () => {
    const map = mapFixture()
    const marked = recordDigestionBuffTrade({
      map,
      placement: map.placements[0]!,
      operationId: 'item.trade-digestion-buff',
      moveId: 'item.snack',
    })
    const context = buildContext({ map: marked })

    expect(evaluateMoveExpression({
      expression: expression({
        kind: 'capability',
        subject: { kind: 'actor' },
        capabilityId: DIGESTION_BUFF_TRADED_CAPABILITY_ID,
      }),
      context,
    }).value).toBe(true)
    expect(evaluateMoveExpression({
      expression: expression({
        kind: 'capability',
        subject: { kind: 'current-target' },
        capabilityId: DIGESTION_BUFF_TRADED_CAPABILITY_ID,
      }),
      context,
      selectorState: selectorState(),
    }).value).toBe(false)
  })

  it('applies an explicit root-only integer rounding policy', () => {
    const context = buildContext()
    const dividedThenDoubled = expression({
      kind: 'arithmetic',
      operator: 'multiply',
      operands: [
        {
          kind: 'arithmetic',
          operator: 'divide',
          operands: [constant(5), constant(2)],
        },
        constant(2),
      ],
    })
    const expectedByPolicy: Record<MoveExpressionNumericPolicy, number> = {
      preserve: 5,
      'integer-floor': 5,
      'integer-round': 5,
      'integer-ceil': 5,
      'integer-truncate': 5,
    }

    for (const [numericPolicy, expected] of Object.entries(expectedByPolicy)) {
      const result = evaluateMoveExpression({
        expression: dividedThenDoubled,
        context,
        numericPolicy: numericPolicy as MoveExpressionNumericPolicy,
        rootNodeId: 'formula.damage',
      })
      expect(result.value).toBe(expected)
      expect(result.trace).toEqual([
        expect.objectContaining({ nodeId: 'formula.damage.operands.0.operands.0', value: 5 }),
        expect.objectContaining({ nodeId: 'formula.damage.operands.0.operands.1', value: 2 }),
        expect.objectContaining({ nodeId: 'formula.damage.operands.0', value: 2.5 }),
        expect.objectContaining({ nodeId: 'formula.damage.operands.1', value: 2 }),
        expect.objectContaining({ nodeId: 'formula.damage', value: expected }),
      ])
    }

    const fraction = expression({
      kind: 'arithmetic',
      operator: 'divide',
      operands: [constant(-7), constant(2)],
    })
    expect(evaluateMoveExpression({ expression: fraction, context }).value).toBe(-3.5)
    expect(evaluateMoveExpression({ expression: fraction, context, numericPolicy: 'integer-floor' }).value).toBe(-4)
    expect(evaluateMoveExpression({ expression: fraction, context, numericPolicy: 'integer-round' }).value).toBe(-3)
    expect(evaluateMoveExpression({ expression: fraction, context, numericPolicy: 'integer-ceil' }).value).toBe(-3)
    expect(evaluateMoveExpression({ expression: fraction, context, numericPolicy: 'integer-truncate' }).value).toBe(-3)
  })

  it('evaluates aggregates, clamp, and only the selected lookup-table branch', () => {
    const context = buildContext()
    const formula = expression({
      kind: 'lookup-table',
      input: { kind: 'weather' },
      entries: [{
        key: 'sunny',
        value: {
          kind: 'clamp',
          value: {
            kind: 'arithmetic',
            operator: 'add',
            operands: [
              { kind: 'min', values: [constant(8), constant(3)] },
              { kind: 'max', values: [constant(4), constant(9)] },
            ],
          },
          minimum: constant(0),
          maximum: constant(10),
        },
      }],
      fallback: {
        kind: 'arithmetic',
        operator: 'divide',
        operands: [constant(1), constant(0)],
      },
    })

    const result = evaluateMoveExpression({
      expression: formula,
      context,
      rootNodeId: 'weather-formula',
    })

    expect(result.value).toBe(10)
    expect(result.trace.at(-1)).toEqual({
      nodeType: 'expression',
      nodeId: 'weather-formula',
      expressionKind: 'lookup-table',
      value: 10,
    })
    expect(result.trace.map(entry => entry.nodeId)).not.toContain('weather-formula.fallback')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.trace)).toBe(true)
  })

  it('resolves authoritative selectors, stats, ratios, stages, weight class, types, fields, and history', () => {
    const context = buildContext()
    const state = selectorState()
    const target = context.queries.tokens.get('target-token')!
    const actor = context.actor.token
    const selectedCandidate = {
      kind: 'intersection' as const,
      selectors: [
        { kind: 'selected-targets' as const },
        { kind: 'candidate-targets' as const },
      ],
    }

    expect(evaluateMoveSelector({
      selector: selectedCandidate,
      context,
      selectorState: state,
    })).toEqual(['target-token'])
    expect(evaluateMoveExpression({
      expression: expression({ kind: 'stat', subject: { kind: 'actor' }, stat: 'attack' }),
      context,
      selectorState: state,
    }).value).toBe(actor.atk)
    expect(evaluateMoveExpression({
      expression: expression({
        kind: 'stat',
        subject: { kind: 'actor' },
        stat: 'attack',
        combatStagePolicy: 'honor',
        stageModifierPolicy: 'honor',
      }),
      context,
      selectorState: state,
    }).value).toBe(Math.floor(actor.atk * 1.4))
    expect(evaluateMoveExpression({
      expression: expression({ kind: 'stat', subject: selectedCandidate, stat: 'current-hp' }),
      context,
      selectorState: state,
    }).value).toBe(target.currentHp)
    expect(evaluateMoveExpression({
      expression: expression({
        kind: 'hp-ratio',
        subject: { kind: 'current-target' },
        ratio: 'current-to-maximum',
      }),
      context,
      selectorState: state,
    }).value).toBe(target.currentHp / target.maxHp)
    expect(evaluateMoveExpression({
      expression: expression({
        kind: 'condition',
        subject: { kind: 'current-target' },
        conditionId: 'burned',
      }),
      context,
      selectorState: state,
    }).value).toBe(true)
    expect(evaluateMoveExpression({
      expression: expression({
        kind: 'condition',
        subject: { kind: 'current-target' },
        conditionId: 'frozen',
      }),
      context,
      selectorState: state,
    }).value).toBe(false)
    expect(evaluateMoveExpression({
      expression: expression({
        kind: 'combat-stage',
        subject: { kind: 'actor' },
        stage: 'atk',
      }),
      context,
      selectorState: state,
    }).value).toBe(actor.combatStages.atk)
    expect(evaluateMoveExpression({
      expression: expression({
        kind: 'combat-stage-total',
        subject: { kind: 'actor' },
        direction: 'positive',
        stageModifierPolicy: 'honor',
      }),
      context,
      selectorState: state,
    }).value).toBe(3)
    expect(evaluateMoveExpression({
      expression: expression({
        kind: 'combat-stage-total',
        subject: { kind: 'current-target' },
        direction: 'negative',
        stageModifierPolicy: 'ignore',
      }),
      context,
      selectorState: state,
    }).value).toBe(1)
    expect(evaluateMoveExpression({
      expression: expression({
        kind: 'max',
        values: [
          {
            kind: 'stat',
            subject: { kind: 'actor' },
            stat: 'attack',
            combatStagePolicy: 'honor',
            stageModifierPolicy: 'honor',
          },
          {
            kind: 'stat',
            subject: { kind: 'actor' },
            stat: 'special-attack',
            combatStagePolicy: 'honor',
            stageModifierPolicy: 'honor',
          },
        ],
      }),
      context,
      selectorState: state,
    }).value).toBe(Math.max(
      Math.floor(actor.atk * 1.4),
      actor.satk,
    ))
    expect(evaluateMoveExpression({
      expression: expression({
        kind: 'weight',
        subject: { kind: 'current-target' },
        metric: 'weight-class',
      }),
      context,
      selectorState: state,
    }).value).toBe(6)
    expect(evaluateMoveExpression({
      expression: expression({ kind: 'type', of: 'move', subject: null }),
      context,
      canonicalMoveId: 'Tackle',
    }).value).toBe('normal')
    expect(evaluateMoveExpression({
      expression: expression({
        kind: 'type',
        of: 'primary',
        subject: { kind: 'current-target' },
      }),
      context,
      selectorState: state,
    }).value).toBe('normal')
    expect(evaluateMoveExpression({ expression: expression({ kind: 'weather' }), context }).value).toBe('sunny')
    expect(evaluateMoveExpression({ expression: expression({ kind: 'terrain' }), context }).value).toBe('grassy')
    expect(evaluateMoveExpression({
      expression: expression({
        kind: 'move-history',
        subject: { kind: 'actor' },
        query: 'acted-this-turn',
      }),
      context,
    }).value).toBe(false)
    const consecutiveUse = expression({
      kind: 'move-history',
      subject: { kind: 'actor' },
      query: 'consecutive-use-count',
    })
    expect(evaluateMoveExpression({
      expression: consecutiveUse,
      context,
      canonicalMoveId: 'Tackle',
    }).value).toBe(4)
    expect(evaluateMoveExpression({
      expression: consecutiveUse,
      context,
      canonicalMoveId: 'Scratch',
    }).value).toBe(0)

    expect(context.reads.snapshot()).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'pokemon', slug: 'target', revision: 5 },
    ])
  })

  it('queries the server-owned opening-action resource without accepting client state', () => {
    const openingAction = expression({
      kind: 'encounter-resource',
      subject: { kind: 'actor' },
      query: 'acted-since-entry',
    })
    expect(evaluateMoveExpression({
      expression: openingAction,
      context: buildContext(),
    }).value).toBe(false)

    const map = mapFixture()
    const ledger = createEncounterTurnResourceLedger({
      placementId: 'actor-token',
      round: 1,
      turn: 0,
    })
    const actedContext = buildContext({
      map: {
        ...map,
        encounterState: {
          ...map.encounterState!,
          turnResources: {
            'actor-token': {
              ...ledger,
              oncePerTurnFlags: [{
                id: ENCOUNTER_ACTED_SINCE_ENTRY_FLAG_ID,
                sourceOperationId: 'operation.opening-action.test',
                resetOn: ['scene-end', 'recall', 'send-out'],
              }],
            },
          },
        },
      },
    })
    const result = evaluateMoveExpression({
      expression: openingAction,
      context: actedContext,
      rootNodeId: 'fake-out.opening-action',
    })
    expect(result.value).toBe(true)
    expect(result.trace.at(-1)).toEqual({
      nodeType: 'expression',
      nodeId: 'fake-out.opening-action',
      expressionKind: 'encounter-resource',
      value: true,
    })
  })

  it('traces comparisons and every reviewed boolean branch by deterministic node ID', () => {
    const context = buildContext()
    const predicate = parseMovePredicate({
      kind: 'all',
      predicates: [
        {
          kind: 'comparison',
          operator: 'greater-than',
          left: {
            kind: 'arithmetic',
            operator: 'add',
            operands: [constant(2), constant(3)],
          },
          right: constant(4),
        },
        {
          kind: 'not',
          predicate: { kind: 'constant', value: false },
        },
        {
          kind: 'any',
          predicates: [
            { kind: 'constant', value: false },
            {
              kind: 'comparison',
              operator: 'equal',
              left: { kind: 'weather' },
              right: constant('sunny'),
            },
          ],
        },
      ],
    })

    const first = evaluateMovePredicate({
      predicate,
      context,
      rootNodeId: 'precondition.can-use',
    })
    const second = evaluateMovePredicate({
      predicate,
      context,
      rootNodeId: 'precondition.can-use',
    })

    expect(first.value).toBe(true)
    expect(first).toEqual(second)
    expect(first.trace.at(-1)).toEqual({
      nodeType: 'predicate',
      nodeId: 'precondition.can-use',
      predicateKind: 'all',
      value: true,
    })
    expect(first.trace.map(entry => entry.nodeId)).toEqual([
      'precondition.can-use.predicates.0.left.operands.0',
      'precondition.can-use.predicates.0.left.operands.1',
      'precondition.can-use.predicates.0.left',
      'precondition.can-use.predicates.0.right',
      'precondition.can-use.predicates.0',
      'precondition.can-use.predicates.1.predicate',
      'precondition.can-use.predicates.1',
      'precondition.can-use.predicates.2.predicates.0',
      'precondition.can-use.predicates.2.predicates.1.left',
      'precondition.can-use.predicates.2.predicates.1.right',
      'precondition.can-use.predicates.2.predicates.1',
      'precondition.can-use.predicates.2',
      'precondition.can-use',
    ])
  })

  it('rejects non-finite values, zero divisors, overflow, invalid bounds, and type mismatches', () => {
    const context = buildContext()
    const forgedNonFinite = {
      kind: 'constant',
      value: Number.POSITIVE_INFINITY,
    } as MoveExpression
    expectEvaluationError(
      () => evaluateMoveExpression({ expression: forgedNonFinite, context }),
      'non-finite-value',
    )
    expectEvaluationError(
      () => evaluateMoveExpression({
        expression: expression({
          kind: 'arithmetic',
          operator: 'divide',
          operands: [constant(1), constant(0)],
        }),
        context,
      }),
      'divide-by-zero',
    )
    expectEvaluationError(
      () => evaluateMoveExpression({
        expression: expression({
          kind: 'arithmetic',
          operator: 'multiply',
          operands: [constant(MOVE_RULE_AST_LIMITS.numericMagnitude), constant(2)],
        }),
        context,
      }),
      'numeric-overflow',
    )
    expectEvaluationError(
      () => evaluateMoveExpression({
        expression: expression({
          kind: 'clamp',
          value: constant(5),
          minimum: constant(10),
          maximum: constant(1),
        }),
        context,
      }),
      'invalid-clamp-bounds',
    )
    expectEvaluationError(
      () => evaluateMovePredicate({
        predicate: parseMovePredicate({
          kind: 'comparison',
          operator: 'less-than',
          left: constant(true),
          right: constant(1),
        }),
        context,
      }),
      'comparison-type-mismatch',
    )
  })

  it('rejects excessive depth and missing or ambiguous authoritative subjects', () => {
    const context = buildContext({ selectedPlacementIds: [] })
    let tooDeep: MoveExpression = constant(1)
    for (let index = 0; index <= MOVE_EXPRESSION_EVALUATION_LIMITS.depth; index += 1) {
      tooDeep = {
        kind: 'clamp',
        value: tooDeep,
        minimum: constant(0),
        maximum: constant(10),
      }
    }
    expectEvaluationError(
      () => evaluateMoveExpression({ expression: tooDeep, context }),
      'limit-exceeded',
    )

    expectEvaluationError(
      () => evaluateMoveExpression({
        expression: expression({
          kind: 'stat',
          subject: { kind: 'current-target' },
          stat: 'level',
        }),
        context,
        selectorState: selectorState({ targetIds: [] }),
      }),
      'missing-selector',
    )

    const ambiguousContext = buildContext({
      selectedPlacementIds: ['target-token', 'other-token'],
    })
    expectEvaluationError(
      () => evaluateMoveExpression({
        expression: expression({
          kind: 'stat',
          subject: { kind: 'selected-targets' },
          stat: 'level',
        }),
        context: ambiguousContext,
      }),
      'ambiguous-selector',
    )
    expectEvaluationError(
      () => evaluateMoveExpression({
        expression: expression({
          kind: 'weight',
          subject: { kind: 'actor' },
          metric: 'kilograms',
        }),
        context,
      }),
      'query-value-unavailable',
    )
  })
})
