import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterHistory } from '#shared/moveAutomation/encounterHistory'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  parseMoveEffectOperation,
  type MoveDamageEffectOperation,
  type MoveEffectDamageBaseStabTiming,
  type MoveEffectRoundingPolicy,
} from '#shared/moveAutomation/effects'
import type { MoveExpression } from '#shared/moveAutomation/expressions'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  MoveContextualDamageBaseResolutionError,
  resolveContextualMoveDamageBase,
} from '~~/server/domain/moveAutomation/damageBase'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import { resolveImmediateMoveSpec } from '~~/server/domain/moveAutomation/resolveImmediateSpec'
import type { MoveSpecV2Runtime } from '~~/server/domain/moveAutomation/registry'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'contextual-damage-base-arena',
  name: 'Contextual Damage Base Arena',
  revision: 9,
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', 0),
    placement('target-token', 'target', 1),
  ],
  lights: [],
  initiative: { activeId: 'actor-token', round: 2 },
  encounterState: {
    ...createEmptyEncounterState(),
    history: {
      ...createEmptyEncounterHistory(),
      consecutiveMoves: [{
        placementId: 'actor-token',
        canonicalId: 'Tackle',
        count: 3,
        lastResolutionId: 'resolution.previous-tackle',
      }],
    },
  },
})

const pokemonSheet = (
  slug: string,
  overrides: Partial<CharacterSheet>,
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'actor' ? 'Eevee' : 'Snorlax',
  level: slug === 'actor' ? 24 : 30,
  revision: slug === 'actor' ? 2 : 5,
  movelist: slug === 'actor' ? [{ name: 'Tackle' }] : [],
  combat: { currentHp: slug === 'actor' ? 45 : 60 },
  ...overrides,
})

const buildContext = (randomValues: readonly number[] = []) => buildAuthoritativeMoveRulesContext({
  map: mapFixture(),
  pokemonSheets: new Map([
    ['actor', pokemonSheet('actor', {
      types: ['Normal'],
      stats: {
        atk: { added: 2, stage: 2 },
        def: { added: 1, stage: 1 },
        satk: { added: 0, stage: -1 },
        sdef: { added: 0, stage: 0 },
        spd: { added: 8, stage: 1 },
      },
    })],
    ['target', pokemonSheet('target', {
      stats: {
        atk: { added: 0, stage: 0 },
        def: { added: 0, stage: 0 },
        satk: { added: 0, stage: 0 },
        sdef: { added: 0, stage: 0 },
        spd: { added: 1, stage: -1 },
      },
      combat: { currentHp: 60, conditions: ['Burned'] },
    })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: {
    schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
    placementId: 'actor-token',
    moveName: 'Tackle',
    selection: { kind: 'single-target', targetPlacementId: 'target-token' },
  } satisfies ResolveMoveIntent,
  candidatePlacementIds: ['target-token'],
  selectedPlacementIds: ['target-token'],
  random: createFiniteAuthoritativeMoveRandomStream(randomValues),
  time: 2_000,
})

const contextualOperation = (options: {
  readonly id: string
  readonly expression: MoveExpression
  readonly minimum?: number
  readonly maximum?: number
  readonly rounding?: MoveEffectRoundingPolicy
  readonly stabTiming?: MoveEffectDamageBaseStabTiming
}): MoveDamageEffectOperation => {
  const operation = parseMoveEffectOperation({
    id: `operation.${options.id}`,
    kind: 'damage',
    source: { kind: 'move', id: 'move.tackle' },
    recipients: { kind: 'attacked-targets' },
    phase: 'damage',
    reasonCode: `move.tackle.${options.id}`,
    payload: {
      damageClass: 'physical',
      damageBase: {
        kind: 'expression',
        expression: options.expression,
        minimum: options.minimum ?? 0,
        maximum: options.maximum ?? 28,
        rounding: options.rounding ?? 'floor',
        stabTiming: options.stabTiming ?? 'none',
      },
      moveType: 'normal',
      accuracyRollId: null,
      criticalRollId: null,
    },
  })
  if (operation.kind !== 'damage') throw new Error('Expected damage operation')
  return operation
}

const constant = (value: number) => ({ kind: 'constant' as const, value })

const stagedSpeed = (subject: 'actor' | 'current-target') => ({
  kind: 'stat' as const,
  subject: { kind: subject },
  stat: 'speed' as const,
  combatStagePolicy: 'honor' as const,
  stageModifierPolicy: 'honor' as const,
})

const resolve = (
  operation: MoveDamageEffectOperation,
  options: { readonly hasStab?: boolean; readonly context?: ReturnType<typeof buildContext> } = {},
) => resolveContextualMoveDamageBase({
  context: options.context ?? buildContext(),
  operation,
  recipientId: 'target-token',
  hasStab: options.hasStab ?? false,
  canonicalMoveId: 'Tackle',
})

describe('native MoveSpec contextual Damage Base resolver', () => {
  it('evaluates HP, speed, weight, status, history, stage, and lookup inputs', () => {
    const context = buildContext()
    const actor = context.queries.tokens.get('actor-token')!
    const target = context.queries.tokens.get('target-token')!
    const actorSpeed = context.queries.stats.resolve('actor-token', {
      stat: 'speed',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })!.value
    const targetSpeed = context.queries.stats.resolve('target-token', {
      stat: 'speed',
      combatStagePolicy: 'honor',
      stageModifierPolicy: 'honor',
    })!.value
    const weightClass = context.queries.targetStates.resolve('target-token')!.weightClass!

    const cases: Array<{
      readonly id: string
      readonly expression: MoveExpression
      readonly expected: number
    }> = [
      {
        id: 'hp-ratio',
        expression: {
          kind: 'arithmetic',
          operator: 'multiply',
          operands: [
            {
              kind: 'hp-ratio',
              subject: { kind: 'current-target' },
              ratio: 'current-to-maximum',
            },
            constant(20),
          ],
        },
        expected: Math.floor(target.currentHp / target.maxHp * 20),
      },
      {
        id: 'speed-ratio',
        expression: {
          kind: 'arithmetic',
          operator: 'divide',
          operands: [stagedSpeed('actor'), stagedSpeed('current-target')],
        },
        expected: Math.floor(actorSpeed / targetSpeed),
      },
      {
        id: 'weight-class',
        expression: {
          kind: 'weight',
          subject: { kind: 'current-target' },
          metric: 'weight-class',
        },
        expected: weightClass,
      },
      {
        id: 'status',
        expression: {
          kind: 'lookup-table',
          input: {
            kind: 'condition',
            subject: { kind: 'current-target' },
            conditionId: 'burned',
          },
          entries: [{ key: true, value: constant(12) }],
          fallback: constant(6),
        },
        expected: 12,
      },
      {
        id: 'history',
        expression: {
          kind: 'move-history',
          subject: { kind: 'actor' },
          query: 'consecutive-use-count',
        },
        expected: 3,
      },
      {
        id: 'positive-stages',
        expression: {
          kind: 'combat-stage-total',
          subject: { kind: 'actor' },
          direction: 'positive',
          stageModifierPolicy: 'honor',
        },
        expected: 4,
      },
      {
        id: 'lookup-table',
        expression: {
          kind: 'lookup-table',
          input: {
            kind: 'weight',
            subject: { kind: 'current-target' },
            metric: 'weight-class',
          },
          entries: [{ key: weightClass, value: constant(9) }],
          fallback: constant(3),
        },
        expected: 9,
      },
    ]

    for (const testCase of cases) {
      const result = resolve(contextualOperation(testCase), { context })
      expect(result.finalDamageBase, testCase.id).toBe(testCase.expected)
      expect(result.evaluationTrace.at(-1), testCase.id).toMatchObject({
        nodeId: `operation.${testCase.id}.damageBase.target-token`,
        value: testCase.id === 'speed-ratio'
          ? actorSpeed / targetSpeed
          : expect.anything(),
      })
      expect(Object.isFrozen(result)).toBe(true)
      expect(Object.isFrozen(result.evaluationTrace)).toBe(true)
    }

    expect(actor.id).toBe('actor-token')
    expect(context.reads.snapshot()).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 2 },
      { kind: 'pokemon', slug: 'target', revision: 5 },
    ])
  })

  it('orders rounding, STAB, and inclusive min/max bounds explicitly', () => {
    const expression: MoveExpression = {
      kind: 'arithmetic',
      operator: 'divide',
      operands: [constant(99), constant(5)],
    }
    const before = resolve(contextualOperation({
      id: 'stab-before',
      expression,
      minimum: 1,
      maximum: 20,
      rounding: 'ceil',
      stabTiming: 'before-bounds',
    }), { hasStab: true })
    const after = resolve(contextualOperation({
      id: 'stab-after',
      expression,
      minimum: 1,
      maximum: 20,
      rounding: 'ceil',
      stabTiming: 'after-bounds',
    }), { hasStab: true })
    const none = resolve(contextualOperation({
      id: 'stab-none',
      expression,
      minimum: 1,
      maximum: 20,
      rounding: 'floor',
      stabTiming: 'none',
    }), { hasStab: true })
    const minimum = resolve(contextualOperation({
      id: 'minimum',
      expression: constant(-10),
      minimum: 2,
      maximum: 20,
    }))

    expect(before).toMatchObject({
      expressionValue: 19.8,
      roundedExpressionValue: 20,
      stabBonus: 2,
      valueBeforeBounds: 22,
      boundedValue: 20,
      finalDamageBase: 20,
    })
    expect(after).toMatchObject({
      roundedExpressionValue: 20,
      stabBonus: 2,
      valueBeforeBounds: 20,
      boundedValue: 20,
      finalDamageBase: 22,
    })
    expect(none).toMatchObject({
      roundedExpressionValue: 19,
      stabBonus: 0,
      boundedValue: 19,
      finalDamageBase: 19,
    })
    expect(minimum).toMatchObject({
      valueBeforeBounds: -10,
      boundedValue: 2,
      finalDamageBase: 2,
    })
  })

  it('retains the per-target DB and node trace through immediate damage reduction', () => {
    const context = buildContext([0, 0])
    const operation = contextualOperation({
      id: 'accepted-trace',
      expression: {
        kind: 'arithmetic',
        operator: 'divide',
        operands: [
          {
            kind: 'stat',
            subject: { kind: 'current-target' },
            stat: 'current-hp',
          },
          constant(10),
        ],
      },
      minimum: 1,
      maximum: 20,
      stabTiming: 'after-bounds',
    })
    const definition = validateMoveSpec({
      schemaVersion: 2,
      canonicalId: 'Tackle',
      version: 2,
      targeting: {
        kind: 'single-target',
        minTargets: 1,
        maxTargets: 1,
        selector: { kind: 'selected-targets' },
      },
      preconditions: [],
      costs: [],
      phases: [{ phase: 'damage', operations: [operation] }],
      registeredHandlerId: null,
      presentation: {
        displayName: 'Tackle',
        vfxKey: null,
        tags: ['damage'],
      },
    })
    const runtime: MoveSpecV2Runtime = {
      canonicalId: 'Tackle',
      kind: 'movespec-v2',
      version: definition.spec.version,
      definitionHash: definition.definitionHash,
      sourceModule: 'tests/contextual-damage-base',
      definition,
    }
    const entryResult = context.queries.resolveActorMoveEntry('Tackle')
    if (!entryResult.ok) throw new Error(entryResult.message)

    const resolution = resolveImmediateMoveSpec({
      context,
      runtime,
      entry: entryResult.entry,
      authoritativeTargetIds: ['target-token'],
    })
    const damageEvent = resolution.trace.events.find(event => (
      event.kind === 'operation' && event.operationId === 'operation.accepted-trace'
    ))

    expect(resolution.transaction.hpUpdates).toHaveLength(1)
    expect(damageEvent).toMatchObject({
      kind: 'operation',
      outcome: 'applied',
      result: {
        recipients: [{
          recipientId: 'target-token',
          details: {
            calculation: {
              contextualDamageBase: {
                expressionValue: 6,
                boundedValue: 6,
                stabBonus: 2,
                finalDamageBase: 8,
              },
              evaluationTrace: [
                expect.objectContaining({
                  nodeId: 'operation.accepted-trace.damageBase.target-token.operands.0',
                  value: 60,
                }),
                expect.objectContaining({
                  nodeId: 'operation.accepted-trace.damageBase.target-token.operands.1',
                  value: 10,
                }),
                expect.objectContaining({
                  nodeId: 'operation.accepted-trace.damageBase.target-token',
                  value: 6,
                }),
              ],
              damagePipeline: {
                damageBase: 8,
                hpLoss: expect.any(Number),
                stages: expect.arrayContaining([
                  expect.objectContaining({
                    stage: 'base-damage-base',
                    damageBase: 8,
                    modifiers: expect.arrayContaining([
                      expect.objectContaining({
                        id: 'damage.base-roll',
                        priority: -100_000,
                        source: { kind: 'move', id: 'Tackle' },
                        stackingGroup: 'base-damage-roll',
                        reasonCode: 'damage.base-roll',
                      }),
                    ]),
                  }),
                  expect.objectContaining({ stage: 'final-hp-loss' }),
                ]),
              },
            },
          },
        }],
      },
    })
    expect(resolution.rollLedger[0]?.formula).toEqual({
      kind: 'dice',
      count: 2,
      sides: 8,
      modifier: 10,
    })
  })

  it('rejects non-numeric contextual results instead of coercing status values', () => {
    const operation = contextualOperation({
      id: 'non-numeric',
      expression: {
        kind: 'condition',
        subject: { kind: 'current-target' },
        conditionId: 'burned',
      },
    })

    expect(() => resolve(operation)).toThrowError(expect.objectContaining({
      name: MoveContextualDamageBaseResolutionError.name,
      code: 'non-numeric-damage-base',
      operationId: 'operation.non-numeric',
      recipientId: 'target-token',
    }))
  })
})
