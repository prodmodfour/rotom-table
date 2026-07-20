import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import {
  parseMoveEffectOperation,
  type MoveEffectRecipientSelectorKind,
} from '#shared/moveAutomation/effects'
import {
  parseMoveResolutionAuditTrace,
  type MoveResolutionAuditTrace,
  type MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import {
  createEmptyEncounterState,
  parseEncounterState,
} from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  MoveCoreTokenEffectReductionError,
  reduceMoveCoreTokenEffects,
} from '~~/server/domain/moveAutomation/reducers/coreTokenEffects'
import type {
  MoveCoreTokenDynamicRecipientSets,
  MoveCoreTokenEffectOperation,
  MoveResolvedCoreTokenEffectOperation,
} from '~~/server/domain/moveAutomation/reducers/coreTokenEffectTypes'
import {
  createStandardMoveCoreTokenEffectImmunityQueries,
} from '~~/server/domain/moveAutomation/reducers/immunities'
import type { CharacterSheet } from '~/types/characterSheet'
import type { CombatStageMap } from '~/types/combatStages'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { normalizeCombatStages } from '~/utils/combatStages'
import { conditionEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'core-reducer-arena',
  name: 'Core Reducer Arena',
  revision: 8,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', 0),
    placement('target-token', 'target', 1),
    placement('bystander-token', 'bystander', 2),
  ],
  lights: [],
  activeScene: { name: 'Reducer Scene', startedAt: 100 },
  temporaryHitPoints: {
    scene: { name: 'Reducer Scene', startedAt: 100 },
    byPlacementId: { 'target-token': 5 },
  },
  initiative: { activeId: 'actor-token', round: 1 },
})

const pokemonSheet = (
  slug: string,
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'target' ? 'Clefairy' : 'Pikachu',
  level: 20,
  revision: 4,
  movelist: slug === 'actor' ? [{ name: 'Tackle' }] : [],
  combat: { currentHp: 999 },
  ...overrides,
})

const intent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Tackle',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

interface CoreReducerHpFixture {
  readonly actor?: number
  readonly target?: number
  readonly bystander?: number
  readonly targetInjuries?: number
}

interface CoreReducerStageFixture {
  readonly actor?: Partial<CombatStageMap>
  readonly target?: Partial<CombatStageMap>
  readonly bystander?: Partial<CombatStageMap>
}

interface CoreReducerConditionFixture {
  readonly actor?: readonly string[]
  readonly target?: readonly string[]
  readonly bystander?: readonly string[]
}

const sheetStageFields = (
  value: Partial<CombatStageMap> | undefined,
): Pick<CharacterSheet, 'stats' | 'combatStages'> => {
  const stages = normalizeCombatStages(value)
  return {
    stats: {
      atk: { stage: stages.atk },
      def: { stage: stages.def },
      satk: { stage: stages.satk },
      sdef: { stage: stages.sdef },
      spd: { stage: stages.spd },
    },
    combatStages: { acc: stages.acc },
  }
}

const buildContext = (
  map: TabletopMap = mapFixture(),
  hp: CoreReducerHpFixture = {},
  stages: CoreReducerStageFixture = {},
  conditions: CoreReducerConditionFixture = {},
) => buildAuthoritativeMoveRulesContext({
  map,
  pokemonSheets: new Map([
    ['actor', pokemonSheet('actor', {
      ...sheetStageFields(stages.actor),
      combat: {
        currentHp: hp.actor ?? 999,
        conditions: [...(conditions.actor ?? [])],
      },
    })],
    ['target', pokemonSheet('target', {
      types: ['Fairy', 'Electric'],
      abilities: [{ name: 'Keen Eye' }],
      ...sheetStageFields(stages.target ?? { atk: 5 }),
      combat: {
        currentHp: hp.target ?? 999,
        injuries: hp.targetInjuries ?? 0,
        conditions: [...(conditions.target ?? ['Burned'])],
      },
    })],
    ['bystander', pokemonSheet('bystander', {
      ...sheetStageFields(stages.bystander),
      combat: {
        currentHp: hp.bystander ?? 999,
        conditions: [...(conditions.bystander ?? [])],
      },
    })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: intent(),
  candidatePlacementIds: ['target-token', 'bystander-token'],
  selectedPlacementIds: ['target-token'],
  random: () => 0,
  time: 5_000,
})

const operation = (
  id: string,
  kind: MoveCoreTokenEffectOperation['kind'],
  payload: Record<string, unknown>,
  recipients: MoveEffectRecipientSelectorKind = 'attacked-targets',
  phase: MoveCoreTokenEffectOperation['phase'] = 'hit',
): MoveCoreTokenEffectOperation => parseMoveEffectOperation({
  id,
  kind,
  source: { kind: 'move', id: 'move.reducer-test' },
  recipients: { kind: recipients },
  phase,
  reasonCode: `move.reducer-test.${id.split('.').at(-1)}`,
  payload,
}) as MoveCoreTokenEffectOperation

const actorHpOperation = (
  id: string,
  kind: 'direct-hp' | 'heal',
  phase: 'declare' | 'pay' | 'hit' | 'damage' | 'after-damage' | 'cleanup',
  payload: Record<string, unknown>,
  source: { kind: 'move' | 'operation'; id: string } = {
    kind: 'move',
    id: 'move.reducer-test',
  },
): MoveCoreTokenEffectOperation => parseMoveEffectOperation({
  id,
  kind,
  source,
  recipients: { kind: 'actor' },
  phase,
  reasonCode: `move.reducer-test.${id.split('.').at(-1)}`,
  payload,
}) as MoveCoreTokenEffectOperation

const directHpPayload = (overrides: Record<string, unknown> = {}) => ({
  mode: 'lose',
  pool: 'hit-points',
  calculation: { kind: 'fixed', value: 1 },
  copySource: null,
  bounds: { minimum: null, maximum: null },
  rounding: 'floor',
  applyTypeImmunity: false,
  cost: null,
  injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  ...overrides,
})

const damageDealtCalculation = (
  damageOperationId: string,
  aggregation: 'per-target' | 'aggregate',
  percent = 50,
) => ({
  kind: 'damage-dealt',
  damageOperationId,
  percent,
  aggregation,
  preventedDamage: 'zero',
})

const healPayload = (overrides: Record<string, unknown> = {}) => ({
  mode: 'gain',
  pool: 'hit-points',
  calculation: { kind: 'fixed', value: 1 },
  bounds: { minimum: null, maximum: null },
  rounding: 'floor',
  injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  ...overrides,
})

const combatStagePayload = (overrides: Record<string, unknown> = {}) => ({
  action: 'modify',
  stage: 'atk',
  selectedStage: null,
  value: 1,
  stageSource: null,
  rounding: null,
  ...overrides,
})

const emission = (
  value: MoveCoreTokenEffectOperation,
  recipientIds: readonly string[] = ['target-token'],
): MoveResolvedCoreTokenEffectOperation => ({
  operation: value,
  recipientIds,
})

const traceFor = (
  operations: readonly MoveResolvedCoreTokenEffectOperation[],
): MoveResolutionAuditTrace => {
  const events: Array<Record<string, unknown>> = []
  let sequence = 1
  let activePhase: MoveCoreTokenEffectOperation['phase'] | null = null
  for (const { operation: value, recipientIds } of operations) {
    if (activePhase !== value.phase) {
      events.push({
        sequence: sequence++,
        kind: 'phase-transition',
        reasonCode: `${value.phase}-phase`,
        from: activePhase,
        to: value.phase,
      })
      activePhase = value.phase
    }
    events.push({
      sequence: sequence++,
      kind: 'operation',
      phase: value.phase,
      operationId: value.id,
      operationKind: value.kind,
      recipientIds: [...recipientIds],
      outcome: 'applied',
      reasonCode: value.reasonCode,
      input: value.payload as unknown as MoveResolutionTraceJsonValue,
      result: { status: 'emitted' },
    })
  }
  return parseMoveResolutionAuditTrace({
    schemaVersion: 1,
    program: {
      canonicalId: 'Reducer Test',
      runtimeKind: 'movespec-v2',
      runtimeVersion: 1,
      definitionHash: 'a'.repeat(64),
    },
    ruleset: {
      rulesetId: 'ptu-1.05-repository-reference-2026-07-09',
      sourceDataSha256: 'b'.repeat(64),
    },
    ancestry: [],
    events,
  })
}

const dynamicRecipients = (
  attackedTargetIds: readonly string[] = ['target-token'],
): MoveCoreTokenDynamicRecipientSets => ({
  attackedTargetIds,
  hitTargetIds: attackedTargetIds,
  missedTargetIds: [],
  damagedTargetIds: attackedTargetIds,
  faintedTargetIds: [],
})

const reduce = (
  operations: readonly MoveResolvedCoreTokenEffectOperation[],
  moveType: string | null = 'Normal',
  context = buildContext(),
) => reduceMoveCoreTokenEffects({
  context,
  operations,
  dynamicRecipients: dynamicRecipients(),
  immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType, context }),
  trace: traceFor(operations),
})

const operationTraceOutcomes = (trace: MoveResolutionAuditTrace) => trace.events
  .filter(event => event.kind === 'operation')
  .map(event => event.kind === 'operation' ? event.outcome : null)

describe('MoveSpec core token effect reducers', () => {
  it('reduces ordered damage, temporary-HP, injury, and capped healing into typed plans', () => {
    const context = buildContext()
    const target = context.queries.tokens.get('target-token')!
    const loss = Math.floor((target.fullMaxHp ?? target.maxHp) * 0.7)
    const operations = [
      emission(operation('operation.damage', 'damage', {
        damageClass: 'physical',
        damageBase: 4,
        moveType: 'normal',
        accuracyRollId: null,
        criticalRollId: null,
      })),
      emission(operation('operation.temp-set', 'direct-hp', {
        mode: 'set',
        pool: 'temporary-hit-points',
        calculation: { kind: 'fixed', value: 12 },
        copySource: null,
        bounds: { minimum: null, maximum: null },
        rounding: 'floor',
        applyTypeImmunity: false,
        cost: null,
        injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
      })),
      emission(operation('operation.temp-loss', 'direct-hp', {
        mode: 'lose',
        pool: 'temporary-hit-points',
        calculation: { kind: 'fixed', value: 5 },
        copySource: null,
        bounds: { minimum: null, maximum: null },
        rounding: 'floor',
        applyTypeImmunity: false,
        cost: null,
        injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
      })),
      emission(operation('operation.heal', 'heal', {
        mode: 'gain',
        pool: 'hit-points',
        calculation: { kind: 'fixed', value: 1_000 },
        bounds: { minimum: null, maximum: null },
        rounding: 'floor',
        injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
      })),
    ]
    const traceBefore = structuredClone(traceFor(operations))
    const inputContextBefore = structuredClone(context.map)
    const damage = {
      resolve: () => ({
        hpLoss: loss,
        preventedBy: null,
        consultedPlacementIds: [],
        details: {
          attackStat: { nodeId: 'damage.attack-stat', value: 18 },
          defenseStat: { nodeId: 'damage.defense-stat', value: 12 },
        },
      }),
    }

    const result = reduceMoveCoreTokenEffects({
      context,
      operations,
      dynamicRecipients: dynamicRecipients(),
      damage,
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor(operations),
    })
    const repeated = reduceMoveCoreTokenEffects({
      context,
      operations,
      dynamicRecipients: dynamicRecipients(),
      damage,
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor(operations),
    })

    expect(context.map).toEqual(inputContextBefore)
    expect(traceFor(operations)).toEqual(traceBefore)
    expect(repeated).toEqual(result)
    expect(result.stateChanges.changes.map(change => change.kind)).toEqual([
      'map-temporary-hit-points',
      'sheet-state',
    ])
    expect(result.operationResults[0]?.recipients[0]?.details).toMatchObject({
      requestedHpLoss: loss,
      absorbedByTemporaryHp: 5,
      massiveDamageInjuries: 1,
      markerInjuries: 1,
      calculation: {
        attackStat: { nodeId: 'damage.attack-stat', value: 18 },
        defenseStat: { nodeId: 'damage.defense-stat', value: 12 },
      },
    })
    const sheetChange = result.stateChanges.groups.sheets[0]?.changes[0]
    expect(sheetChange).toMatchObject({
      sourceOperationId: null,
      reasonCode: 'core-token-effects',
      expectedRevision: 4,
      changedFields: ['hp'],
      compensation: {
        kind: 'inverse',
        strategy: 'restore-previous-value',
      },
      current: { revision: 5, updatedAt: 5_000 },
    })
    if (sheetChange?.kind !== 'sheet-state') throw new Error('Expected sheet state change')
    const currentSheet = sheetChange.current as CharacterSheet
    expect(currentSheet.combat?.injuries).toBeGreaterThan(0)
    const healResult = result.operationResults[3]?.recipients[0]
    expect(healResult?.current).toMatchObject({
      kind: 'hp',
      currentHp: healResult.current.kind === 'hp' ? healResult.current.maxHp : -1,
    })
    const temporaryHpChange = result.stateChanges.groups.map[0]?.changes[0]
    expect(temporaryHpChange).toMatchObject({
      kind: 'map-temporary-hit-points',
      sourceOperationId: null,
      reasonCode: 'core-token-effects',
      current: {
        byPlacementId: { 'target-token': 7 },
      },
    })
    expect(result.operationResults.map(item => item.outcome)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
    ])
    expect(operationTraceOutcomes(result.trace)).toEqual([
      'applied',
      'applied',
      'applied',
      'applied',
    ])
    expect(result.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'target', revision: 4 },
    ])
    expect(Object.isFrozen(result.operationResults)).toBe(true)
    expect(Object.isFrozen(result.trace)).toBe(true)
  })

  it('evaluates fixed, percentage, and bounded formula healing and loss per recipient', () => {
    const calculations = [
      { calculation: { kind: 'fixed', value: 7 }, amount: (_max: number, _actorMax: number) => 7 },
      { calculation: { kind: 'percent-max', percent: 10 }, amount: (max: number) => Math.floor(max * 0.1) },
      { calculation: { kind: 'percent-current', percent: 50 }, amount: () => 15 },
      { calculation: { kind: 'percent-missing', percent: 50 }, amount: (max: number) => Math.floor((max - 30) * 0.5) },
      {
        calculation: {
          kind: 'formula',
          expression: {
            kind: 'arithmetic',
            operator: 'divide',
            operands: [
              { kind: 'stat', subject: { kind: 'actor' }, stat: 'maximum-hp' },
              { kind: 'constant', value: 10 },
            ],
          },
        },
        amount: (_max: number, actorMax: number) => Math.floor(actorMax / 10),
      },
    ]

    for (const entry of calculations) {
      const healContext = buildContext(mapFixture(), { actor: 20, target: 30 })
      const targetMax = healContext.queries.tokens.get('target-token')!.maxHp
      const actorMax = healContext.actor.token.maxHp
      const amount = entry.amount(targetMax, actorMax)
      const heal = emission(operation(
        `operation.heal-${entry.calculation.kind}`,
        'heal',
        healPayload({ calculation: entry.calculation }),
      ))
      const healed = reduce([heal], 'Normal', healContext)
      const healedState = healed.operationResults[0]?.recipients[0]?.current
      expect(healedState).toMatchObject({
        kind: 'hp',
        currentHp: Math.min(targetMax, 30 + amount),
      })
      expect(healed.operationResults[0]?.recipients[0]?.details).toMatchObject({
        mode: 'gain',
        calculation: {
          kind: entry.calculation.kind,
          roundedValue: amount,
        },
      })

      const lossContext = buildContext(mapFixture(), { actor: 20, target: 30 })
      const loss = emission(operation(
        `operation.loss-${entry.calculation.kind}`,
        'direct-hp',
        directHpPayload({ calculation: entry.calculation }),
      ))
      const lost = reduce([loss], 'Normal', lossContext)
      expect(lost.operationResults[0]?.recipients[0]?.current).toMatchObject({
        kind: 'hp',
        currentHp: 30 - amount,
      })
      expect(lost.operationResults[0]?.recipients[0]?.details).toMatchObject({
        mode: 'lose',
        calculation: {
          kind: entry.calculation.kind,
          roundedValue: amount,
        },
      })
      expect(operationTraceOutcomes(lost.trace)).toEqual(['applied'])
      if (entry.calculation.kind === 'formula') {
        expect(lost.sheetReads).toEqual(expect.arrayContaining([
          { kind: 'pokemon', slug: 'target', revision: 4 },
          { kind: 'pokemon', slug: 'actor', revision: 4 },
        ]))
        expect(lost.operationResults[0]?.recipients[0]?.details).toMatchObject({
          calculation: { evaluationTrace: expect.arrayContaining([
            expect.objectContaining({ nodeType: 'expression', value: actorMax }),
          ]) },
        })
      }
    }

    const injuredContext = buildContext(mapFixture(), {
      target: 20,
      targetInjuries: 2,
    })
    const injuredTarget = injuredContext.queries.tokens.get('target-token')!
    expect(injuredTarget.fullMaxHp).toBeGreaterThan(injuredTarget.maxHp)
    const fractionalLoss = emission(operation(
      'operation.full-max-fraction',
      'direct-hp',
      directHpPayload({ calculation: { kind: 'percent-max', percent: 10 } }),
    ))
    const fractionalResult = reduce([fractionalLoss], 'Normal', injuredContext)
    expect(fractionalResult.operationResults[0]?.recipients[0]?.details).toMatchObject({
      calculation: {
        kind: 'percent-max',
        basisValue: injuredTarget.fullMaxHp,
        roundedValue: Math.floor(injuredTarget.fullMaxHp! / 10),
      },
    })
  })

  it('derives multi-target drain and recoil from actual damage with explicit rounding scope', () => {
    const run = (aggregation: 'per-target' | 'aggregate') => {
      const context = buildContext(mapFixture(), { actor: 10, target: 30, bystander: 30 })
      const damage = emission(operation(
        'operation.linked-source',
        'damage',
        {
          damageClass: 'physical',
          damageBase: 4,
          moveType: 'normal',
          accuracyRollId: null,
          criticalRollId: null,
        },
        'attacked-targets',
        'damage',
      ), ['target-token', 'bystander-token'])
      const drain = emission(actorHpOperation(
        'operation.drain',
        'heal',
        'after-damage',
        healPayload({
          calculation: damageDealtCalculation(damage.operation.id, aggregation),
        }),
        { kind: 'operation', id: damage.operation.id },
      ), ['actor-token'])
      const recoil = emission(actorHpOperation(
        'operation.recoil',
        'direct-hp',
        'after-damage',
        directHpPayload({
          calculation: damageDealtCalculation(damage.operation.id, aggregation, 25),
        }),
        { kind: 'operation', id: damage.operation.id },
      ), ['actor-token'])
      const operations = [damage, drain, recoil]
      return reduceMoveCoreTokenEffects({
        context,
        operations,
        dynamicRecipients: dynamicRecipients(['target-token', 'bystander-token']),
        damage: {
          resolve: ({ recipient }) => ({
            hpLoss: recipient.placement.id === 'target-token' ? 7 : 5,
            preventedBy: null,
            consultedPlacementIds: [],
          }),
        },
        immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
        trace: traceFor(operations),
      })
    }

    const aggregate = run('aggregate')
    const perTarget = run('per-target')

    expect(aggregate.operationResults[0]?.recipients.map(recipient => (
      recipient.details && typeof recipient.details === 'object'
        ? (recipient.details as Record<string, unknown>).effectiveHpLost
        : null
    ))).toEqual([7, 5])
    expect(aggregate.operationResults[1]?.recipients[0]).toMatchObject({
      previous: { kind: 'hp', currentHp: 10 },
      current: { kind: 'hp', currentHp: 16 },
      details: {
        calculation: {
          kind: 'damage-dealt',
          rawValue: 6,
          roundedValue: 6,
          damageSource: {
            operationId: 'operation.linked-source',
            aggregation: 'aggregate',
            totalEffectiveHpLost: 12,
            recipients: [
              { recipientId: 'target-token', effectiveHpLost: 7, prevented: false },
              { recipientId: 'bystander-token', effectiveHpLost: 5, prevented: false },
            ],
          },
        },
      },
    })
    expect(aggregate.operationResults[2]?.recipients[0]).toMatchObject({
      previous: { kind: 'hp', currentHp: 16 },
      current: { kind: 'hp', currentHp: 13 },
      details: {
        calculation: {
          kind: 'damage-dealt',
          rawValue: 3,
          roundedValue: 3,
        },
      },
    })
    expect(perTarget.operationResults[1]?.recipients[0]?.details).toMatchObject({
      calculation: {
        rawValue: 6,
        roundedValue: 5,
        damageSource: { aggregation: 'per-target' },
      },
    })
    expect(perTarget.operationResults[2]?.recipients[0]?.details).toMatchObject({
      calculation: { rawValue: 3, roundedValue: 2 },
    })
    expect(operationTraceOutcomes(aggregate.trace)).toEqual(['applied', 'applied', 'applied'])
    expect(aggregate.stateChanges.groups.sheets).toHaveLength(3)
    expect(aggregate.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'target', revision: 4 },
      { kind: 'pokemon', slug: 'bystander', revision: 4 },
      { kind: 'pokemon', slug: 'actor', revision: 4 },
    ])
  })

  it('treats prevented/no damage as zero while honoring independent completion costs', () => {
    const context = buildContext(mapFixture(), { actor: 20, target: 30, bystander: 30 })
    const damage = emission(operation(
      'operation.prevented-source',
      'damage',
      {
        damageClass: 'special',
        damageBase: 4,
        moveType: 'dragon',
        accuracyRollId: null,
        criticalRollId: null,
      },
      'attacked-targets',
      'damage',
    ), ['target-token', 'bystander-token'])
    const drain = emission(actorHpOperation(
      'operation.prevented-drain',
      'heal',
      'after-damage',
      healPayload({
        calculation: damageDealtCalculation(damage.operation.id, 'aggregate'),
      }),
      { kind: 'operation', id: damage.operation.id },
    ), ['actor-token'])
    const recoil = emission(actorHpOperation(
      'operation.prevented-recoil',
      'direct-hp',
      'after-damage',
      directHpPayload({
        calculation: damageDealtCalculation(damage.operation.id, 'aggregate', 25),
      }),
      { kind: 'operation', id: damage.operation.id },
    ), ['actor-token'])
    const damageCost = emission(actorHpOperation(
      'operation.damage-cost',
      'direct-hp',
      'after-damage',
      directHpPayload({
        calculation: { kind: 'fixed', value: 4 },
        cost: {
          kind: 'cost',
          timing: 'damage',
          minimumRemaining: null,
          damageOperationId: damage.operation.id,
        },
      }),
    ), ['actor-token'])
    const completionCost = emission(actorHpOperation(
      'operation.completion-cost',
      'direct-hp',
      'cleanup',
      directHpPayload({
        calculation: { kind: 'fixed', value: 4 },
        cost: {
          kind: 'cost',
          timing: 'completion',
          minimumRemaining: null,
          damageOperationId: null,
        },
      }),
    ), ['actor-token'])
    const operations = [damage, drain, recoil, damageCost, completionCost]
    const result = reduceMoveCoreTokenEffects({
      context,
      operations,
      dynamicRecipients: dynamicRecipients(['target-token', 'bystander-token']),
      damage: {
        resolve: ({ recipient }) => recipient.placement.id === 'target-token'
          ? {
              hpLoss: 99,
              preventedBy: 'Dragon type',
              moveType: 'Dragon',
              consultedPlacementIds: [],
            }
          : {
              hpLoss: 0,
              preventedBy: null,
              moveType: 'Dragon',
              consultedPlacementIds: [],
            },
      },
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Dragon' }),
      trace: traceFor(operations),
    })

    expect(result.operationResults.map(item => item.outcome)).toEqual([
      'prevented',
      'no-op',
      'no-op',
      'no-op',
      'applied',
    ])
    expect(result.operationResults.slice(1, 3).map(item => item.recipients[0]?.reasonCode))
      .toEqual(['linked-damage-zero', 'linked-damage-zero'])
    expect(result.operationResults[1]?.recipients[0]?.details).toMatchObject({
      calculation: {
        damageSource: {
          totalEffectiveHpLost: 0,
          preventedDamage: 'zero',
          recipients: [
            { recipientId: 'target-token', prevented: true, effectiveHpLost: 0 },
            { recipientId: 'bystander-token', prevented: false, effectiveHpLost: 0 },
          ],
        },
      },
    })
    expect(result.operationResults[3]?.recipients[0]).toMatchObject({
      reasonCode: 'hp-cost-trigger-not-met',
      current: { kind: 'hp', currentHp: 20 },
    })
    expect(result.operationResults[4]?.recipients[0]?.current).toMatchObject({
      kind: 'hp',
      currentHp: 16,
    })
    expect(operationTraceOutcomes(result.trace)).toEqual([
      'prevented',
      'no-op',
      'no-op',
      'no-op',
      'applied',
    ])
  })

  it('enforces fixed/max-HP cost timing and affordability and resolves self-KO', () => {
    const declarationContext = buildContext(mapFixture(), { actor: 40 })
    const actorMaxHp = declarationContext.actor.token.fullMaxHp
      ?? declarationContext.actor.token.maxHp
    const declarationCost = emission(actorHpOperation(
      'operation.max-hp-cost',
      'direct-hp',
      'pay',
      directHpPayload({
        calculation: { kind: 'percent-max', percent: 25 },
        cost: {
          kind: 'cost',
          timing: 'declaration',
          minimumRemaining: null,
          damageOperationId: null,
        },
      }),
    ), ['actor-token'])
    const paid = reduceMoveCoreTokenEffects({
      context: declarationContext,
      operations: [declarationCost],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([declarationCost]),
    })
    expect(paid.operationResults[0]?.recipients[0]).toMatchObject({
      previous: { kind: 'hp', currentHp: 40 },
      current: { kind: 'hp', currentHp: 40 - Math.floor(actorMaxHp * 0.25) },
      details: {
        cost: { kind: 'cost', timing: 'declaration' },
        calculation: {
          kind: 'percent-max',
          basisValue: actorMaxHp,
          roundedValue: Math.floor(actorMaxHp * 0.25),
        },
      },
    })

    const hitCost = emission(actorHpOperation(
      'operation.hit-cost',
      'direct-hp',
      'hit',
      directHpPayload({
        calculation: { kind: 'fixed', value: 5 },
        cost: {
          kind: 'cost',
          timing: 'hit',
          minimumRemaining: 1,
          damageOperationId: null,
        },
      }),
    ), ['actor-token'])
    const missed = reduceMoveCoreTokenEffects({
      context: buildContext(mapFixture(), { actor: 20 }),
      operations: [hitCost],
      dynamicRecipients: {
        ...dynamicRecipients(),
        hitTargetIds: [],
        damagedTargetIds: [],
      },
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([hitCost]),
    })
    expect(missed.operationResults[0]?.recipients[0]).toMatchObject({
      outcome: 'no-op',
      reasonCode: 'hp-cost-trigger-not-met',
      current: { kind: 'hp', currentHp: 20 },
    })

    const unaffordable = emission(actorHpOperation(
      'operation.unaffordable-cost',
      'direct-hp',
      'pay',
      directHpPayload({
        calculation: { kind: 'fixed', value: 5 },
        cost: {
          kind: 'cost',
          timing: 'declaration',
          minimumRemaining: 0,
          damageOperationId: null,
        },
      }),
    ), ['actor-token'])
    expect(() => reduceMoveCoreTokenEffects({
      context: buildContext(mapFixture(), { actor: 4 }),
      operations: [unaffordable],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([unaffordable]),
    })).toThrowError(expect.objectContaining({ code: 'hp-precondition-failed' }))

    const sacrificeMap = mapFixture()
    sacrificeMap.temporaryHitPoints = {
      scene: { ...sacrificeMap.activeScene! },
      byPlacementId: { 'actor-token': 6, 'target-token': 5 },
    }
    const sacrifice = emission(actorHpOperation(
      'operation.sacrifice',
      'direct-hp',
      'cleanup',
      directHpPayload({
        mode: 'set',
        calculation: { kind: 'fixed', value: 0 },
        cost: {
          kind: 'sacrifice',
          timing: 'completion',
          minimumRemaining: null,
          damageOperationId: null,
        },
      }),
    ), ['actor-token'])
    const sacrificed = reduceMoveCoreTokenEffects({
      context: buildContext(sacrificeMap, { actor: 20 }),
      operations: [sacrifice],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([sacrifice]),
    })
    expect(sacrificed.operationResults[0]?.recipients[0]).toMatchObject({
      outcome: 'applied',
      previous: { kind: 'hp', currentHp: 20, temporaryHp: 6 },
      current: { kind: 'hp', currentHp: 0, temporaryHp: 0 },
      changedFields: ['hp', 'temporaryHitPoints'],
      details: { cost: { kind: 'sacrifice', timing: 'completion' } },
    })
    expect(sacrificed.stateChanges.groups.map[0]?.changes[0]).toMatchObject({
      kind: 'map-temporary-hit-points',
      current: { byPlacementId: { 'target-token': 5 } },
    })
  })

  it('applies final minimum/maximum bounds and set, copy, and simultaneous split modes', () => {
    const boundedContext = buildContext(mapFixture(), { target: 30 })
    const boundedOperations = [
      emission(operation('operation.set-bounded', 'direct-hp', directHpPayload({
        mode: 'set',
        calculation: { kind: 'fixed', value: 100 },
        bounds: { minimum: null, maximum: 40 },
      }))),
      emission(operation('operation.loss-bounded', 'direct-hp', directHpPayload({
        calculation: { kind: 'fixed', value: 100 },
        bounds: { minimum: 12, maximum: null },
      }))),
      emission(operation('operation.heal-bounded', 'heal', healPayload({
        calculation: { kind: 'fixed', value: 100 },
        bounds: { minimum: null, maximum: 18 },
      }))),
    ]
    const bounded = reduce(boundedOperations, 'Normal', boundedContext)
    expect(bounded.operationResults.map(result => (
      result.recipients[0]?.current.kind === 'hp'
        ? result.recipients[0].current.currentHp
        : null
    ))).toEqual([40, 12, 18])
    expect(bounded.operationResults[1]?.recipients[0]?.details).toMatchObject({
      previousPoolValue: 40,
      requestedPoolValue: -60,
      boundedPoolValue: 12,
      appliedPoolValue: 12,
    })

    const copyContext = buildContext(mapFixture(), { actor: 17, target: 5 })
    const copy = emission(operation('operation.copy-actor-hp', 'direct-hp', directHpPayload({
      mode: 'copy',
      calculation: null,
      copySource: { kind: 'actor' },
    })))
    const copied = reduce([copy], 'Normal', copyContext)
    expect(copied.operationResults[0]?.recipients[0]).toMatchObject({
      consultedPlacementIds: ['actor-token'],
      current: { kind: 'hp', currentHp: 17 },
      details: {
        calculation: {
          kind: 'copy',
          sourcePlacementId: 'actor-token',
          roundedValue: 17,
        },
      },
    })
    expect(copied.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'target', revision: 4 },
      { kind: 'pokemon', slug: 'actor', revision: 4 },
    ])

    const splitContext = buildContext(mapFixture(), { actor: 30, target: 10 })
    const split = emission(operation(
      'operation.split-hp',
      'direct-hp',
      directHpPayload({ mode: 'split', calculation: null }),
    ), ['actor-token', 'target-token'])
    const splitResult = reduceMoveCoreTokenEffects({
      context: splitContext,
      operations: [split],
      dynamicRecipients: dynamicRecipients(['actor-token', 'target-token']),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([split]),
    })
    expect(splitResult.operationResults[0]?.recipients.map((recipient) => (
      recipient.current.kind === 'hp' ? recipient.current.currentHp : null
    ))).toEqual([20, 20])
    expect(splitResult.operationResults[0]?.recipients[0]?.details).toMatchObject({
      calculation: {
        kind: 'split',
        basisValue: 40,
        rawValue: 20,
        roundedValue: 20,
      },
    })
    expect(splitResult.stateChanges.groups.sheets).toHaveLength(2)

    const swapContext = buildContext(mapFixture(), { actor: 30, target: 10 })
    const swap = emission(operation(
      'operation.swap-hp',
      'direct-hp',
      directHpPayload({
        mode: 'swap',
        calculation: null,
        applyTypeImmunity: false,
      }),
      'actor-and-attacked-targets',
    ), ['actor-token', 'target-token'])
    const swapResult = reduceMoveCoreTokenEffects({
      context: swapContext,
      operations: [swap],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([swap]),
    })
    expect(swapResult.operationResults[0]?.recipients).toMatchObject([
      {
        recipientId: 'actor-token',
        current: { kind: 'hp', currentHp: 10 },
        details: { calculation: { kind: 'swap', sourcePlacementId: 'target-token' } },
      },
      {
        recipientId: 'target-token',
        current: { kind: 'hp', currentHp: 30 },
        details: { calculation: { kind: 'swap', sourcePlacementId: 'actor-token' } },
      },
    ])
    expect(swapResult.stateChanges.groups.sheets).toHaveLength(2)

    const immuneSwap = emission(operation(
      'operation.swap-hp-immune',
      'direct-hp',
      directHpPayload({
        mode: 'swap',
        calculation: null,
        applyTypeImmunity: true,
      }),
      'actor-and-attacked-targets',
    ), ['actor-token', 'target-token'])
    const preventedSwap = reduceMoveCoreTokenEffects({
      context: buildContext(mapFixture(), { actor: 30, target: 10 }),
      operations: [immuneSwap],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Dragon' }),
      trace: traceFor([immuneSwap]),
    })
    expect(preventedSwap.operationResults[0]?.recipients).toMatchObject([
      {
        recipientId: 'actor-token',
        outcome: 'no-op',
        reasonCode: 'hp-redistribution-prevented',
        current: { kind: 'hp', currentHp: 30 },
      },
      {
        recipientId: 'target-token',
        outcome: 'prevented',
        reasonCode: 'type-immunity',
        current: { kind: 'hp', currentHp: 10 },
      },
    ])
    expect(preventedSwap.stateChanges.changes).toEqual([])

    const invalidSwap = emission(operation(
      'operation.invalid-swap',
      'direct-hp',
      directHpPayload({ mode: 'swap', calculation: null }),
    ))
    expect(() => reduceMoveCoreTokenEffects({
      context: buildContext(mapFixture(), { actor: 30, target: 10 }),
      operations: [invalidSwap],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([invalidSwap]),
    })).toThrowError(expect.objectContaining({ code: 'invalid-hp-recipient-count' }))
  })

  it('resolves level-based and fractional direct loss without stats or effectiveness scaling', () => {
    const context = buildContext(mapFixture(), { actor: 20, target: 30 })
    const levelLoss = emission(operation(
      'operation.level-loss',
      'direct-hp',
      directHpPayload({
        calculation: {
          kind: 'formula',
          expression: {
            kind: 'stat',
            subject: { kind: 'actor' },
            stat: 'level',
          },
        },
        applyTypeImmunity: true,
      }),
    ))
    const fractionalLoss = emission(operation(
      'operation.fractional-loss',
      'direct-hp',
      directHpPayload({
        calculation: { kind: 'percent-current', percent: 50 },
        applyTypeImmunity: true,
      }),
    ))
    // Ground is weak against the target's Electric type. Direct HP still uses
    // the authored scalar exactly instead of entering the damage pipeline.
    const result = reduce([levelLoss, fractionalLoss], 'Ground', context)

    expect(result.operationResults[0]?.recipients[0]).toMatchObject({
      previous: { kind: 'hp', currentHp: 30 },
      current: { kind: 'hp', currentHp: 10 },
      details: {
        calculation: {
          kind: 'formula',
          roundedValue: 20,
          evaluationTrace: expect.arrayContaining([
            expect.objectContaining({ expressionKind: 'stat', value: 20 }),
          ]),
        },
      },
    })
    expect(result.operationResults[1]?.recipients[0]).toMatchObject({
      previous: { kind: 'hp', currentHp: 10 },
      current: { kind: 'hp', currentHp: 5 },
      details: { calculation: { kind: 'percent-current', basisValue: 10, roundedValue: 5 } },
    })
    expect(result.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'target', revision: 4 },
      { kind: 'pokemon', slug: 'actor', revision: 4 },
    ])

    const immune = reduce([levelLoss], 'Dragon', buildContext(mapFixture(), { target: 30 }))
    expect(immune.operationResults[0]?.recipients[0]).toMatchObject({
      outcome: 'prevented',
      reasonCode: 'type-immunity',
      current: { kind: 'hp', currentHp: 30 },
    })
    const immunityIgnored = emission(operation(
      'operation.level-loss-no-immunity',
      'direct-hp',
      directHpPayload({
        calculation: {
          kind: 'formula',
          expression: { kind: 'stat', subject: { kind: 'actor' }, stat: 'level' },
        },
        applyTypeImmunity: false,
      }),
    ))
    expect(reduce(
      [immunityIgnored],
      'Dragon',
      buildContext(mapFixture(), { target: 30 }),
    ).operationResults[0]?.recipients[0]?.current).toMatchObject({
      kind: 'hp',
      currentHp: 10,
    })
  })

  it('links Final Gambit-style loss to actual real HP removed by an earlier sacrifice', () => {
    const map = mapFixture()
    map.temporaryHitPoints = {
      scene: { ...map.activeScene! },
      byPlacementId: { 'actor-token': 6 },
    }
    const sacrifice = emission(actorHpOperation(
      'operation.final-gambit-sacrifice',
      'direct-hp',
      'cleanup',
      directHpPayload({
        mode: 'set',
        calculation: { kind: 'fixed', value: 0 },
        cost: {
          kind: 'sacrifice',
          timing: 'completion',
          minimumRemaining: null,
          damageOperationId: null,
        },
      }),
    ), ['actor-token'])
    const targetLoss = emission(operation(
      'operation.final-gambit-loss',
      'direct-hp',
      directHpPayload({
        calculation: {
          kind: 'hp-lost',
          hpOperationId: sacrifice.operation.id,
          pool: 'hit-points',
          percent: 100,
          aggregation: 'aggregate',
        },
        applyTypeImmunity: true,
      }),
      'hit-targets',
      'cleanup',
    ))
    const operations = [sacrifice, targetLoss]
    const result = reduceMoveCoreTokenEffects({
      context: buildContext(map, { actor: 23, target: 50 }),
      operations,
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Fighting' }),
      trace: traceFor(operations),
    })

    expect(result.operationResults[0]?.recipients[0]).toMatchObject({
      previous: { kind: 'hp', currentHp: 23, temporaryHp: 6 },
      current: { kind: 'hp', currentHp: 0, temporaryHp: 0 },
    })
    expect(result.operationResults[1]?.recipients[0]).toMatchObject({
      previous: { kind: 'hp', currentHp: 50 },
      current: { kind: 'hp', currentHp: 27 },
      details: {
        calculation: {
          kind: 'hp-lost',
          basisValue: 23,
          roundedValue: 23,
          hpLossSource: {
            operationId: 'operation.final-gambit-sacrifice',
            pool: 'hit-points',
            totalHpLost: 23,
            recipients: [{ recipientId: 'actor-token', hpLost: 23, prevented: false }],
          },
        },
      },
    })
    expect(result.stateChanges.groups.sheets).toHaveLength(2)
    expect(result.stateChanges.groups.map[0]?.changes[0]).toMatchObject({
      kind: 'map-temporary-hit-points',
    })
    expect(result.stateChanges.groups.map[0]?.changes[0]).toHaveProperty('current', undefined)

    const immuneResult = reduceMoveCoreTokenEffects({
      context: buildContext(map, { actor: 23, target: 50 }),
      operations,
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Dragon' }),
      trace: traceFor(operations),
    })
    expect(immuneResult.operationResults.map(operationResult => operationResult.outcome))
      .toEqual(['applied', 'prevented'])
    expect(immuneResult.operationResults[1]?.recipients[0]?.current).toMatchObject({
      kind: 'hp',
      currentHp: 50,
    })
  })

  it('derives fixed splash recipients cardinally adjacent to authoritative hit targets', () => {
    const splash = emission(operation(
      'operation.flame-burst-splash',
      'direct-hp',
      directHpPayload({ calculation: { kind: 'fixed', value: 5 } }),
      'cardinally-adjacent-to-hit-targets',
      'after-damage',
    ), ['actor-token', 'bystander-token'])
    const context = buildContext(mapFixture(), { actor: 30, target: 30, bystander: 30 })
    const result = reduceMoveCoreTokenEffects({
      context,
      operations: [splash],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Fire' }),
      trace: traceFor([splash]),
    })

    expect(result.operationResults[0]).toMatchObject({
      recipientIds: ['actor-token', 'bystander-token'],
      recipients: [
        { recipientId: 'actor-token', current: { kind: 'hp', currentHp: 25 } },
        { recipientId: 'bystander-token', current: { kind: 'hp', currentHp: 25 } },
      ],
    })
    expect(result.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 4 },
      { kind: 'pokemon', slug: 'bystander', revision: 4 },
      { kind: 'pokemon', slug: 'target', revision: 4 },
    ])
    expect(context.map.placements.map(placement => placement.position.x)).toEqual([0, 1, 2])

    const missed = emission(splash.operation, [])
    const missedResult = reduceMoveCoreTokenEffects({
      context: buildContext(mapFixture(), { actor: 30, target: 30, bystander: 30 }),
      operations: [missed],
      dynamicRecipients: {
        ...dynamicRecipients(),
        hitTargetIds: [],
        damagedTargetIds: [],
      },
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Fire' }),
      trace: traceFor([missed]),
    })
    expect(missedResult.operationResults[0]).toMatchObject({
      recipientIds: [],
      outcome: 'no-op',
      recipients: [],
    })
    expect(missedResult.stateChanges.changes).toEqual([])

    expect(() => reduceMoveCoreTokenEffects({
      context: buildContext(mapFixture(), { actor: 30, target: 30, bystander: 30 }),
      operations: [emission(splash.operation, ['target-token'])],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Fire' }),
      trace: traceFor([splash]),
    })).toThrowError(expect.objectContaining({ code: 'recipient-set-mismatch' }))
  })

  it('supports full healing and scene-local temporary HP for actor and area recipients', () => {
    const context = buildContext(mapFixture(), { actor: 5, target: 20, bystander: 20 })
    const full = emission(operation('operation.actor-full-heal', 'heal', healPayload({
      mode: 'full',
      calculation: null,
    }), 'actor'), ['actor-token'])
    const areaTemporaryHp = emission(operation(
      'operation.area-temporary-hp',
      'heal',
      healPayload({
        pool: 'temporary-hit-points',
        calculation: { kind: 'fixed', value: 3 },
      }),
      'area-targets',
    ), ['target-token', 'bystander-token'])

    const result = reduceMoveCoreTokenEffects({
      context,
      operations: [full, areaTemporaryHp],
      dynamicRecipients: dynamicRecipients(['target-token', 'bystander-token']),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([full, areaTemporaryHp]),
    })

    expect(result.operationResults[0]).toMatchObject({
      recipientIds: ['actor-token'],
      recipients: [{ current: { kind: 'hp', currentHp: context.actor.token.maxHp } }],
    })
    expect(result.operationResults[1]).toMatchObject({
      recipientIds: ['target-token', 'bystander-token'],
      recipients: [
        { current: { kind: 'hp', temporaryHp: 8 } },
        { current: { kind: 'hp', temporaryHp: 3 } },
      ],
    })
    expect(result.stateChanges.groups.map[0]?.changes[0]).toMatchObject({
      kind: 'map-temporary-hit-points',
      current: {
        byPlacementId: {
          'target-token': 8,
          'bystander-token': 3,
        },
      },
    })
    expect(operationTraceOutcomes(result.trace)).toEqual(['applied', 'applied'])

    const noSceneMap = mapFixture()
    delete noSceneMap.activeScene
    delete noSceneMap.temporaryHitPoints
    const noSceneContext = buildContext(noSceneMap, { target: 20, bystander: 20 })
    const unavailable = reduceMoveCoreTokenEffects({
      context: noSceneContext,
      operations: [areaTemporaryHp],
      dynamicRecipients: dynamicRecipients(['target-token', 'bystander-token']),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([areaTemporaryHp]),
    })
    expect(unavailable.operationResults[0]).toMatchObject({
      outcome: 'no-op',
      recipients: [
        { reasonCode: 'temporary-hp-scene-unavailable' },
        { reasonCode: 'temporary-hp-scene-unavailable' },
      ],
    })
    expect(unavailable.stateChanges.changes).toEqual([])
  })

  it('accepts only interpreter-authorized ordered subsets for recipient-scoped branches', () => {
    const operationDefinition = operation(
      'operation.recipient-branch-heal',
      'heal',
      healPayload({ calculation: { kind: 'fixed', value: 3 } }),
      'area-targets',
    )
    const selected = emission(operationDefinition, ['target-token'])
    const common = {
      context: buildContext(mapFixture(), { target: 20, bystander: 20 }),
      dynamicRecipients: dynamicRecipients(['target-token', 'bystander-token']),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
    }

    expect(() => reduceMoveCoreTokenEffects({
      ...common,
      operations: [selected],
      trace: traceFor([selected]),
    })).toThrowError(expect.objectContaining({ code: 'recipient-set-mismatch' }))

    const reduced = reduceMoveCoreTokenEffects({
      ...common,
      operations: [selected],
      branchControlledOperationIds: new Set([operationDefinition.id]),
      trace: traceFor([selected]),
    })
    expect(reduced.operationResults).toMatchObject([{
      recipientIds: ['target-token'],
      recipients: [{ recipientId: 'target-token', outcome: 'applied' }],
    }])

    const widened = emission(operationDefinition, ['actor-token'])
    expect(() => reduceMoveCoreTokenEffects({
      ...common,
      operations: [widened],
      branchControlledOperationIds: new Set([operationDefinition.id]),
      trace: traceFor([widened]),
    })).toThrowError(expect.objectContaining({ code: 'recipient-set-mismatch' }))
  })

  it('applies HP-marker Injuries only after direct HP resolution and never Massive Damage', () => {
    const context = buildContext()
    const target = context.queries.tokens.get('target-token')!
    const lossAmount = Math.floor((target.fullMaxHp ?? target.maxHp) * 0.7)
    const withMarkers = emission(operation('operation.marker-loss', 'direct-hp', directHpPayload({
      calculation: { kind: 'fixed', value: lossAmount },
      injury: {
        hitPointMarkers: 'apply-after-operation',
        massiveDamage: 'never',
      },
    })))
    const marked = reduce([withMarkers], 'Normal', context)
    expect(marked.operationResults[0]?.recipients[0]?.details).toMatchObject({
      injury: {
        policy: {
          hitPointMarkers: 'apply-after-operation',
          massiveDamage: 'never',
        },
        injuryDelta: expect.any(Number),
        markerInjuries: expect.any(Number),
        massiveDamageInjuries: 0,
      },
    })
    const markedCurrent = marked.operationResults[0]?.recipients[0]?.current
    expect(markedCurrent?.kind === 'hp' ? markedCurrent.injuries : 0).toBeGreaterThan(0)

    const ignoredContext = buildContext()
    const ignored = emission(operation('operation.ignored-marker-loss', 'direct-hp', directHpPayload({
      calculation: { kind: 'fixed', value: lossAmount },
      injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
    })))
    const ignoredResult = reduce([ignored], 'Normal', ignoredContext)
    expect(ignoredResult.operationResults[0]?.recipients[0]).toMatchObject({
      current: { kind: 'hp', injuries: 0 },
      details: {
        injury: {
          policy: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
          injuryDelta: 0,
          markerInjuries: 0,
          massiveDamageInjuries: 0,
        },
      },
    })
  })

  it('applies cap-aware delta, set, invert, clear, all-Stats, and selected-Stat transforms', () => {
    const operations = [
      emission(operation('operation.cap-aware-delta', 'combat-stage', combatStagePayload({
        value: 3,
      }), 'actor'), ['actor-token']),
      emission(operation('operation.at-cap', 'combat-stage', combatStagePayload({
        value: 1,
      }), 'actor'), ['actor-token']),
      emission(operation('operation.selected-stat', 'combat-stage', combatStagePayload({
        action: 'set',
        stage: 'selected-stat',
        selectedStage: 'def',
        value: -4,
      }), 'actor'), ['actor-token']),
      emission(operation('operation.invert-stats', 'combat-stage', combatStagePayload({
        action: 'invert',
        stage: 'all-stats',
        value: null,
      }), 'actor'), ['actor-token']),
      emission(operation('operation.clear-positive', 'combat-stage', combatStagePayload({
        action: 'clear-positive',
        stage: 'all-stats',
        value: null,
      }), 'actor'), ['actor-token']),
      emission(operation('operation.clear-negative', 'combat-stage', combatStagePayload({
        action: 'clear-negative',
        stage: 'all',
        value: null,
      }), 'actor'), ['actor-token']),
      emission(operation('operation.reset-cleared', 'combat-stage', combatStagePayload({
        action: 'reset',
        stage: 'all',
        value: null,
      }), 'actor'), ['actor-token']),
    ]
    const context = buildContext(mapFixture(), {}, {
      actor: { atk: 5, def: 1, satk: 2, sdef: -3, spd: 1, acc: -5 },
    })
    const result = reduceMoveCoreTokenEffects({
      context,
      operations,
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor(operations),
    })

    expect(result.operationResults.map(item => item.outcome)).toEqual([
      'applied',
      'no-op',
      'applied',
      'applied',
      'applied',
      'applied',
      'no-op',
    ])
    expect(result.operationResults[0]?.recipients[0]?.details).toMatchObject({
      action: 'modify',
      changes: [{
        stage: 'atk',
        previous: 5,
        unboundedRequested: 8,
        requested: 6,
        current: 6,
        requestedDelta: 1,
        appliedDelta: 1,
        capped: true,
        outcome: 'applied',
      }],
    })
    expect(result.operationResults[1]?.recipients[0]).toMatchObject({
      reasonCode: 'combat-stage-unchanged',
      details: {
        changes: [{
          previous: 6,
          unboundedRequested: 7,
          requested: 6,
          appliedDelta: 0,
          capped: true,
          outcome: 'no-op',
        }],
      },
    })
    const inverted = result.operationResults[3]?.recipients[0]?.current
    expect(inverted).toEqual({
      kind: 'combat-stages',
      stages: { atk: -6, def: 4, satk: -2, sdef: 3, spd: -1, acc: -5 },
    })
    expect(result.operationResults[4]?.recipients[0]?.current).toEqual({
      kind: 'combat-stages',
      stages: { atk: -6, def: 0, satk: -2, sdef: 0, spd: -1, acc: -5 },
    })
    expect(result.operationResults[5]?.recipients[0]?.current).toEqual({
      kind: 'combat-stages',
      stages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
    })
    expect(operationTraceOutcomes(result.trace)).toEqual([
      'applied',
      'no-op',
      'applied',
      'applied',
      'applied',
      'applied',
      'no-op',
    ])
  })

  it('copies combat stages from one authoritative source without mutating it', () => {
    const context = buildContext(mapFixture(), {}, {
      actor: { atk: -2, def: 1, satk: 0, sdef: 4, spd: -1, acc: 0 },
      target: { atk: 3, def: -4, satk: 2, sdef: 0, spd: 5, acc: -2 },
    })
    const copy = emission(operation(
      'operation.copy-stages',
      'combat-stage',
      combatStagePayload({
        action: 'copy',
        stage: 'all',
        value: null,
        stageSource: { kind: 'selected-targets' },
      }),
      'actor',
    ), ['actor-token'])
    const result = reduceMoveCoreTokenEffects({
      context,
      operations: [copy],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([copy]),
    })

    const sourceStages = { atk: 3, def: -4, satk: 2, sdef: 0, spd: 5, acc: -2 }
    expect(result.operationResults[0]).toMatchObject({
      outcome: 'applied',
      recipientIds: ['actor-token'],
      recipients: [{
        recipientId: 'actor-token',
        consultedPlacementIds: ['target-token'],
        details: { action: 'copy', sourcePlacementId: 'target-token' },
        current: { kind: 'combat-stages', stages: sourceStages },
      }],
    })
    expect(context.queries.tokens.get('target-token')?.combatStages).toEqual(sourceStages)
    expect(result.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 4 },
      { kind: 'pokemon', slug: 'target', revision: 4 },
    ])
    expect(result.stateChanges.groups.sheets).toHaveLength(1)
    expect(result.stateChanges.groups.sheets[0]?.changes[0]).toMatchObject({
      sourceOperationId: 'operation.copy-stages',
      reasonCode: 'move.reducer-test.copy-stages',
    })
  })

  it('swaps selected stage groups atomically while leaving Accuracy outside all-stats', () => {
    const context = buildContext(mapFixture(), {}, {
      actor: { atk: 1, def: 2, satk: 3, sdef: 4, spd: 5, acc: -6 },
      target: { atk: -1, def: -2, satk: -3, sdef: -4, spd: -5, acc: 6 },
    })
    const swap = emission(operation(
      'operation.swap-stats',
      'combat-stage',
      combatStagePayload({
        action: 'swap',
        stage: 'all-stats',
        value: null,
      }),
      'actor-and-attacked-targets',
    ), ['actor-token', 'target-token'])
    const result = reduceMoveCoreTokenEffects({
      context,
      operations: [swap],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([swap]),
    })

    expect(result.operationResults[0]?.recipients.map(recipient => recipient.current)).toEqual([
      {
        kind: 'combat-stages',
        stages: { atk: -1, def: -2, satk: -3, sdef: -4, spd: -5, acc: -6 },
      },
      {
        kind: 'combat-stages',
        stages: { atk: 1, def: 2, satk: 3, sdef: 4, spd: 5, acc: 6 },
      },
    ])
    expect(result.stateChanges.groups.sheets).toHaveLength(2)
    expect(result.stateChanges.groups.sheets.map(group => group.changes[0]?.sourceOperationId))
      .toEqual(['operation.swap-stats', 'operation.swap-stats'])
  })

  it('splits and transfers stage values from operation-entry snapshots', () => {
    const splitContext = buildContext(mapFixture(), {}, {
      actor: { atk: -4 },
      target: { atk: 5 },
      bystander: { atk: 2 },
    })
    const split = emission(operation(
      'operation.split-attack',
      'combat-stage',
      combatStagePayload({
        action: 'split',
        stage: 'atk',
        value: null,
        rounding: 'round',
      }),
      'actor-and-attacked-targets',
    ), ['actor-token', 'target-token', 'bystander-token'])
    const splitResult = reduceMoveCoreTokenEffects({
      context: splitContext,
      operations: [split],
      dynamicRecipients: dynamicRecipients(['target-token', 'bystander-token']),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([split]),
    })
    expect(splitResult.operationResults[0]?.recipients.map((recipient) => (
      recipient.current.kind === 'combat-stages' ? recipient.current.stages.atk : null
    ))).toEqual([1, 1, 1])

    const transferContext = buildContext(mapFixture(), {}, {
      actor: { atk: 5, acc: 0 },
      target: { atk: 3, acc: -2 },
    })
    const transfer = emission(operation(
      'operation.transfer-stages',
      'combat-stage',
      combatStagePayload({
        action: 'transfer',
        stage: 'all',
        value: null,
        stageSource: { kind: 'selected-targets' },
      }),
      'actor-and-attacked-targets',
    ), ['actor-token', 'target-token'])
    const transferResult = reduceMoveCoreTokenEffects({
      context: transferContext,
      operations: [transfer],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([transfer]),
    })
    expect(transferResult.operationResults[0]?.recipients).toMatchObject([
      {
        recipientId: 'actor-token',
        outcome: 'applied',
        current: { kind: 'combat-stages', stages: { atk: 6, acc: -2 } },
        details: {
          sourcePlacementId: 'target-token',
          changes: expect.arrayContaining([
            expect.objectContaining({ stage: 'atk', capped: true, appliedDelta: 1 }),
          ]),
        },
      },
      {
        recipientId: 'target-token',
        outcome: 'applied',
        current: { kind: 'combat-stages', stages: { atk: 0, acc: 0 } },
      },
    ])
  })

  it('preserves both swap sources when one coupled stage change is prevented', () => {
    const context = buildContext(mapFixture(), {}, {
      actor: { acc: -1 },
      target: { acc: 2 },
    })
    const swap = emission(operation(
      'operation.swap-accuracy',
      'combat-stage',
      combatStagePayload({
        action: 'swap',
        stage: 'acc',
        value: null,
      }),
      'actor-and-attacked-targets',
    ), ['actor-token', 'target-token'])
    const result = reduceMoveCoreTokenEffects({
      context,
      operations: [swap],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([swap]),
    })

    expect(result.operationResults[0]).toMatchObject({
      outcome: 'prevented',
      recipients: [
        {
          recipientId: 'actor-token',
          outcome: 'no-op',
          reasonCode: 'combat-stage-redistribution-prevented',
          current: { kind: 'combat-stages', stages: { acc: -1 } },
        },
        {
          recipientId: 'target-token',
          outcome: 'prevented',
          reasonCode: 'combat-stage-immunity',
          blockers: [{ subject: 'acc', source: 'Keen Eye' }],
          current: { kind: 'combat-stages', stages: { acc: 2 } },
        },
      ],
    })
    expect(result.stateChanges.changes).toEqual([])
    expect(operationTraceOutcomes(result.trace)).toEqual(['prevented'])
  })

  it('plans mixed self and target stage changes with per-operation provenance', () => {
    const operations = [
      emission(operation(
        'operation.raise-self',
        'combat-stage',
        combatStagePayload({ stage: 'atk', value: 2 }),
        'actor',
      ), ['actor-token']),
      emission(operation(
        'operation.lower-target',
        'combat-stage',
        combatStagePayload({ stage: 'def', value: -2 }),
        'attacked-targets',
      )),
    ]
    const result = reduce(operations, 'Normal', buildContext(mapFixture(), {}, {
      actor: { atk: 0 },
      target: { def: 0 },
    }))

    expect(result.operationResults.map(item => item.outcome)).toEqual(['applied', 'applied'])
    expect(result.stateChanges.groups.sheets).toHaveLength(2)
    expect(result.stateChanges.groups.sheets.map(group => group.changes[0]?.sourceOperationId))
      .toEqual(['operation.raise-self', 'operation.lower-target'])
  })

  it('cleanses major/minor groups with exclusions and replaces only matching conditions', () => {
    const context = buildContext(mapFixture(), {}, {}, {
      target: ['Burned', 'Sleep', 'Confused', 'Helping Hand'],
    })
    const operations = [
      emission(operation('operation.clear-major', 'condition', {
        action: 'clear',
        conditionId: null,
        filter: {
          groups: ['major'],
          conditionIds: [],
          excludedConditionIds: ['sleep'],
        },
      })),
      emission(operation('operation.clear-minor', 'condition', {
        action: 'clear',
        conditionId: null,
        filter: {
          groups: ['minor'],
          conditionIds: [],
          excludedConditionIds: [],
        },
      })),
      emission(operation('operation.replace-sleep', 'condition', {
        action: 'replace',
        conditionId: 'poisoned',
        filter: {
          groups: [],
          conditionIds: ['sleep'],
          excludedConditionIds: [],
        },
      })),
    ]

    const result = reduce(operations, 'Normal', context)

    expect(result.operationResults.map(item => item.outcome)).toEqual([
      'applied',
      'applied',
      'applied',
    ])
    expect(result.operationResults.map(item => item.recipients[0]?.details)).toMatchObject([
      { removedConditions: ['Burned'] },
      { removedConditions: ['Confused'] },
      { condition: 'Poisoned', removedConditions: ['Sleep'] },
    ])
    const sheetChange = result.stateChanges.groups.sheets[0]?.changes[0]
    if (sheetChange?.kind !== 'sheet-state') throw new Error('Expected condition sheet change')
    expect((sheetChange.current as CharacterSheet).combat?.conditions).toEqual([
      'Poisoned',
      'Helping Hand',
    ])
    expect(operationTraceOutcomes(result.trace)).toEqual(['applied', 'applied', 'applied'])
  })

  it('selects random conditions only from an earlier server-owned roll ledger entry', () => {
    const context = buildContext(mapFixture(), {}, {}, { target: [] })
    context.random.roll({
      rollId: 'roll.random-condition',
      parentEffectId: 'operation.random-condition-roll',
      formula: { kind: 'uniform-integer', minimum: 2, maximum: 2 },
      reason: 'reducer random condition fixture',
    })
    const randomCondition = emission(operation('operation.random-condition', 'condition', {
      action: 'random-choice',
      conditionId: null,
      randomChoice: {
        rollId: 'roll.random-condition',
        conditionIds: ['burned', 'confused', 'poisoned'],
      },
    }))

    const result = reduce([randomCondition], 'Normal', context)

    expect(result.operationResults[0]).toMatchObject({
      outcome: 'applied',
      recipients: [{
        details: {
          condition: 'Confused',
          randomRollId: 'roll.random-condition',
        },
        current: { kind: 'conditions', conditions: ['Confused'] },
      }],
    })
    const sheetChange = result.stateChanges.groups.sheets[0]?.changes[0]
    if (sheetChange?.kind !== 'sheet-state') throw new Error('Expected random condition write')
    expect((sheetChange.current as CharacterSheet).combat?.conditions).toEqual(['Confused'])
  })

  it('stores source-linked duration, save, and capped stack policy in encounter state', () => {
    const context = buildContext(mapFixture(), {}, {}, { target: [] })
    const timedFlinch = (id: string) => emission(operation(id, 'condition', {
      action: 'apply',
      conditionId: 'flinch',
      duration: {
        effectId: 'effect.flinch-window',
        duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
      },
      saveTiming: 'none',
      stackPolicy: { kind: 'add-stack', maxStacks: 2 },
    }))
    const operations = [
      timedFlinch('operation.flinch-one'),
      timedFlinch('operation.flinch-two'),
      timedFlinch('operation.flinch-capped'),
    ]

    const result = reduce(operations, 'Normal', context)

    expect(result.operationResults.map(item => item.outcome)).toEqual([
      'applied',
      'applied',
      'no-op',
    ])
    expect(result.operationResults[2]?.recipients[0]).toMatchObject({
      reasonCode: 'condition-stack-capped',
      details: { lifecycleTransitions: ['stack-capped'] },
    })
    expect(result.stateChanges.groups.sheets).toEqual([])
    expect(result.stateChanges.groups.encounter).toHaveLength(1)
    const encounterChange = result.stateChanges.groups.encounter[0]?.changes[0]
    expect(encounterChange).toMatchObject({
      kind: 'encounter-state',
      expectedRevision: 8,
      sourceOperationId: null,
      current: {
        effects: [{
          kind: 'condition',
          source: {
            moveId: 'move.reducer-test',
            placementId: 'actor-token',
          },
          affected: { placementIds: ['target-token'], sideIds: [], cells: [] },
          duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
          stacks: 2,
          stackPolicy: { kind: 'add-stack', maxStacks: 2 },
          payload: { conditionId: 'flinch', action: 'apply', saveTiming: null },
        }],
      },
    })
    expect(result.stateChanges.expectedRevisions).toEqual([
      { kind: 'map', mapSlug: 'core-reducer-arena', expectedRevision: 8 },
    ])
  })

  it('cleanses matching persistent and direct source-linked condition layers together', () => {
    const sourceLinked = parseEncounterEffect({
      ...conditionEncounterEffectFixture(),
      id: 'effect.condition.confusion',
      affected: { placementIds: ['target-token'], sideIds: [], cells: [] },
      payload: { conditionId: 'confused', action: 'apply', saveTiming: 'end-turn' },
    })
    const map = mapFixture()
    map.encounterState = {
      ...createEmptyEncounterState(),
      effects: [sourceLinked],
    }
    const context = buildContext(map, {}, {}, { target: ['Burned'] })
    const cleanse = emission(operation('operation.cleanse-status', 'condition', {
      action: 'clear',
      conditionId: null,
      filter: {
        groups: ['status'],
        conditionIds: [],
        excludedConditionIds: [],
      },
    }))

    const result = reduce([cleanse], 'Normal', context)

    expect(result.operationResults[0]?.recipients[0]).toMatchObject({
      outcome: 'applied',
      changedFields: ['conditions', 'encounterEffects'],
      details: {
        removedConditions: ['Burned'],
        removedEffectIds: ['effect.condition.confusion'],
      },
    })
    expect(result.stateChanges.changes.map(change => change.kind)).toEqual([
      'encounter-state',
      'sheet-state',
    ])
    expect(result.stateChanges.groups.encounter[0]?.changes[0]?.current).toMatchObject({
      effects: [],
    })
  })

  it('transfers conditions atomically and retains the source when destination immunity blocks', () => {
    const blockedContext = buildContext(mapFixture(), {}, {}, {
      actor: ['Paralysis'],
      target: [],
    })
    const transferParalysis = emission(operation(
      'operation.transfer-paralysis',
      'condition',
      {
        action: 'transfer',
        conditionId: 'paralysis',
        conditionSource: { kind: 'actor' },
      },
      'actor-and-attacked-targets',
    ), ['actor-token', 'target-token'])

    const blocked = reduce([transferParalysis], 'Normal', blockedContext)
    expect(blocked.operationResults[0]).toMatchObject({
      outcome: 'prevented',
      recipients: [
        {
          recipientId: 'actor-token',
          outcome: 'no-op',
          reasonCode: 'condition-transfer-prevented',
          current: { conditions: ['Paralysis'] },
        },
        {
          recipientId: 'target-token',
          outcome: 'prevented',
          blockers: [{ subject: 'Paralysis', source: 'Electric type' }],
        },
      ],
    })
    expect(blocked.stateChanges.changes).toEqual([])

    const successContext = buildContext(mapFixture(), {}, {}, {
      actor: ['Poisoned'],
      target: [],
    })
    const transferPoison = emission(operation(
      'operation.transfer-poison',
      'condition',
      {
        action: 'transfer',
        conditionId: 'poisoned',
        conditionSource: { kind: 'actor' },
      },
      'actor-and-attacked-targets',
    ), ['actor-token', 'target-token'])
    const success = reduce([transferPoison], 'Normal', successContext)

    expect(success.operationResults[0]?.recipients).toMatchObject([
      {
        recipientId: 'actor-token',
        outcome: 'applied',
        current: { conditions: [] },
      },
      {
        recipientId: 'target-token',
        outcome: 'applied',
        current: { conditions: ['Poisoned'] },
      },
    ])
    expect(success.stateChanges.groups.sheets).toHaveLength(2)
  })

  it('applies Misty first-turn protection when a Status Affliction is transferred', () => {
    const terrainMap = mapFixture()
    terrainMap.fieldEffects = {
      weather: [],
      terrains: [{ kind: 'misty', scope: 'field' }],
      rooms: [],
    }
    terrainMap.encounterState = createEmptyEncounterState()
    const context = buildContext(terrainMap, {}, {}, {
      actor: ['Poisoned'],
      target: [],
    })
    const transferPoison = emission(operation(
      'operation.transfer-poison-misty',
      'condition',
      {
        action: 'transfer',
        conditionId: 'poisoned',
        conditionSource: { kind: 'actor' },
      },
      'actor-and-attacked-targets',
    ), ['actor-token', 'target-token'])

    const result = reduce([transferPoison], 'Normal', context)
    const encounterChange = result.stateChanges.groups.encounter[0]?.changes[0]
    if (!encounterChange || encounterChange.kind !== 'encounter-state') {
      throw new Error('Expected Misty transfer protection in encounter state')
    }
    const protection = parseEncounterState(encounterChange.current).effects.find(effect => (
      effect.kind === 'condition' && effect.payload.action === 'suppress'
    ))

    expect(result.operationResults[0]?.recipients).toMatchObject([
      {
        recipientId: 'actor-token',
        outcome: 'applied',
        current: { conditions: [] },
        changedFields: ['conditions'],
      },
      {
        recipientId: 'target-token',
        outcome: 'applied',
        current: { conditions: ['Poisoned'] },
        changedFields: ['conditions', 'encounterEffects'],
        details: {
          firstTurnProtection: {
            terrainKind: 'misty',
            zoneId: 'legacy.terrain.misty',
            reasonCode: 'terrain.misty.first-turn-status-protection',
            effectIds: [protection?.id],
          },
          terrain: [expect.objectContaining({
            interaction: 'condition',
            terrainKind: 'misty',
            placementId: 'target-token',
            outcome: 'applied',
            reasonCode: 'terrain.misty.first-turn-status-protection',
          })],
        },
      },
    ])
    expect(protection).toMatchObject({
      id: expect.stringMatching(/^condition-protection\.[0-9a-f]{32}$/),
      affected: { placementIds: ['target-token'] },
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
      payload: { conditionId: 'poisoned', action: 'suppress', saveTiming: null },
    })
    expect(result.stateChanges.groups.sheets).toHaveLength(2)
  })

  it('honors typed side and cell condition prevention from authoritative encounter state', () => {
    const prevention = (id: string, affected: Record<string, unknown>) => parseEncounterEffect({
      ...conditionEncounterEffectFixture(),
      id,
      source: {
        operationId: `operation.${id}`,
        moveId: 'move.condition-ward',
        placementId: 'bystander-token',
      },
      affected,
      payload: { conditionId: 'confused', action: 'prevent', saveTiming: null },
    })
    const protectedMap = (effect: ReturnType<typeof prevention>): TabletopMap => {
      const map = mapFixture()
      map.placements = map.placements.map(placement => ({
        ...placement,
        sideId: placement.id === 'actor-token' ? 'enemies' : 'allies',
      }))
      map.encounterState = {
        ...createEmptyEncounterState(),
        sides: {
          allies: { id: 'allies', label: 'Allies', status: 'active' },
          enemies: { id: 'enemies', label: 'Enemies', status: 'active' },
        },
        effects: [effect],
      }
      return map
    }
    const confuse = emission(operation('operation.apply-confusion', 'condition', {
      action: 'apply',
      conditionId: 'confused',
    }))
    const scenarios = [
      prevention('effect.side-condition-ward', {
        placementIds: [], sideIds: ['allies'], cells: [],
      }),
      prevention('effect.cell-condition-ward', {
        placementIds: [], sideIds: [], cells: [{ x: 1, y: 0, z: 0 }],
      }),
    ]

    for (const effect of scenarios) {
      const context = buildContext(protectedMap(effect), {}, {}, { target: [] })
      const result = reduce([confuse], 'Normal', context)
      expect(result.operationResults[0]?.recipients[0]).toMatchObject({
        outcome: 'prevented',
        reasonCode: 'condition-immunity',
        blockers: [{ source: `Encounter effect ${effect.id}` }],
        consultedPlacementIds: ['bystander-token'],
      })
      expect(result.sheetReads).toEqual([
        { kind: 'pokemon', slug: 'target', revision: 4 },
        { kind: 'pokemon', slug: 'bystander', revision: 4 },
      ])
      expect(result.stateChanges.changes).toEqual([])
    }
  })

  it('gates actor conditions on the applied outcome of an earlier typed operation', () => {
    const stage = emission(operation('operation.raise-target', 'combat-stage', {
      ...combatStagePayload(),
    }))
    const condition = emission(operation(
      'operation.actor-rage',
      'condition',
      {
        action: 'apply',
        conditionId: 'rage',
        conditionSource: null,
        filter: null,
        randomChoice: null,
        operationOutcomeTrigger: {
          operationId: 'operation.raise-target',
          outcome: 'applied',
        },
        duration: null,
        saveTiming: 'canonical',
        stackPolicy: { kind: 'refresh', maxStacks: null },
      },
      'actor',
      'after-damage',
    ), ['actor-token'])

    const applied = reduce([stage, condition], 'Normal', buildContext())
    expect(applied.operationResults[1]).toMatchObject({
      operationId: 'operation.actor-rage',
      outcome: 'applied',
    })
    expect(applied.operationResults[1]?.recipients[0]?.details).toMatchObject({
      operationOutcomeTrigger: {
        operationId: 'operation.raise-target',
        expectedOutcome: 'applied',
        actualOutcome: 'applied',
        matched: true,
      },
    })

    const capped = reduce(
      [stage, condition],
      'Normal',
      buildContext(mapFixture(), {}, { target: { atk: 6 } }),
    )
    expect(capped.operationResults[0]).toMatchObject({ outcome: 'no-op' })
    expect(capped.operationResults[1]).toMatchObject({ outcome: 'no-op' })
    expect(capped.operationResults[1]?.recipients[0]).toMatchObject({
      reasonCode: 'condition-operation-trigger-not-met',
      changedFields: [],
    })
  })

  it('preserves condition/stage immunity and cap no-ops in the audit trace', () => {
    const operations = [
      emission(operation('operation.burn-again', 'condition', {
        action: 'apply',
        conditionId: 'burned',
      })),
      emission(operation('operation.paralyze', 'condition', {
        action: 'apply',
        conditionId: 'paralysis',
      })),
      emission(operation('operation.remove-burn', 'condition', {
        action: 'remove',
        conditionId: 'burned',
      })),
      emission(operation('operation.clear-empty', 'condition', {
        action: 'clear',
        conditionId: null,
      })),
      emission(operation('operation.raise-atk', 'combat-stage', {
        action: 'modify',
        stage: 'atk',
        value: 2,
      })),
      emission(operation('operation.raise-atk-cap', 'combat-stage', {
        action: 'modify',
        stage: 'atk',
        value: 1,
      })),
      emission(operation('operation.lower-accuracy', 'combat-stage', {
        action: 'modify',
        stage: 'acc',
        value: -1,
      })),
      emission(operation('operation.reset-stages', 'combat-stage', {
        action: 'reset',
        stage: 'all',
        value: null,
      })),
    ]

    const result = reduce(operations)

    expect(result.operationResults.map(item => item.outcome)).toEqual([
      'no-op',
      'prevented',
      'applied',
      'no-op',
      'applied',
      'no-op',
      'prevented',
      'applied',
    ])
    expect(result.operationResults[0]?.recipients[0]).toMatchObject({
      reasonCode: 'condition-already-applied',
      changedFields: [],
    })
    expect(result.operationResults[1]).toMatchObject({
      reasonCode: 'move.reducer-test.paralyze',
      recipients: [{
        reasonCode: 'condition-immunity',
        blockers: [{ subject: 'Paralysis', source: 'Electric type' }],
      }],
    })
    expect(result.operationResults[5]?.recipients[0]?.reasonCode).toBe('combat-stage-unchanged')
    expect(result.operationResults[6]?.recipients[0]).toMatchObject({
      reasonCode: 'combat-stage-immunity',
      blockers: [{ subject: 'acc', source: 'Keen Eye' }],
    })
    expect(operationTraceOutcomes(result.trace)).toEqual([
      'no-op',
      'prevented',
      'applied',
      'no-op',
      'applied',
      'no-op',
      'prevented',
      'applied',
    ])
    expect(result.stateChanges.changes).toHaveLength(1)
    const sheetChange = result.stateChanges.groups.sheets[0]?.changes[0]
    expect(sheetChange).toMatchObject({
      kind: 'sheet-state',
      sourceOperationId: null,
      reasonCode: 'core-token-effects',
      changedFields: ['conditions', 'combatStages'],
    })
    if (sheetChange?.kind !== 'sheet-state') throw new Error('Expected sheet state change')
    const current = sheetChange.current as CharacterSheet
    expect(current.combat?.conditions).toEqual([])
    expect(current.stats?.atk?.stage).toBe(0)
    expect(current.combatStages?.acc).toBe(0)
  })

  it('keeps effective encounter conditions out of persistent sheet reductions', () => {
    const sleepEffect = conditionEncounterEffectFixture()
    const map = mapFixture()
    map.encounterState = {
      ...createEmptyEncounterState(),
      effects: [sleepEffect],
    }
    const context = buildContext(map)
    const applyPersistentSleep = emission(operation('operation.persist-sleep', 'condition', {
      action: 'apply',
      conditionId: 'sleep',
    }))

    expect(context.queries.tokens.get('target-token')).toMatchObject({
      sheetConditions: ['Burned'],
      conditions: ['Burned', 'Sleep'],
    })

    const result = reduceMoveCoreTokenEffects({
      context,
      operations: [applyPersistentSleep],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([applyPersistentSleep]),
    })

    expect(result.operationResults[0]).toMatchObject({
      outcome: 'applied',
      recipients: [{
        previous: { kind: 'conditions', conditions: ['Burned'] },
        current: { kind: 'conditions', conditions: ['Burned', 'Sleep'] },
      }],
    })
    expect(result.stateChanges.changes.map(change => change.kind)).toEqual(['sheet-state'])
    const sheetChange = result.stateChanges.groups.sheets[0]?.changes[0]
    if (sheetChange?.kind !== 'sheet-state') throw new Error('Expected sheet state change')
    expect((sheetChange.current as CharacterSheet).combat?.conditions).toEqual([
      'Burned',
      'Sleep',
    ])
    expect(context.map.encounterState?.effects).toEqual([sleepEffect])
  })

  it('records type immunity and full-HP healing as a no-op plan', () => {
    const operations = [
      emission(operation('operation.dragon-loss', 'direct-hp', {
        mode: 'lose',
        pool: 'hit-points',
        calculation: { kind: 'fixed', value: 20 },
        copySource: null,
        bounds: { minimum: null, maximum: null },
        rounding: 'floor',
        applyTypeImmunity: true,
        cost: null,
        injury: {
          hitPointMarkers: 'apply-after-operation',
          massiveDamage: 'never',
        },
      })),
      emission(operation('operation.full-heal', 'heal', {
        mode: 'full',
        pool: 'hit-points',
        calculation: null,
        bounds: { minimum: null, maximum: null },
        rounding: 'floor',
        injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
      })),
    ]

    const result = reduce(operations, 'Dragon')

    expect(result.stateChanges.changes).toEqual([])
    expect(result.operationResults).toMatchObject([
      {
        outcome: 'prevented',
        recipients: [{
          reasonCode: 'type-immunity',
          blockers: [{ source: 'Dragon type' }],
        }],
      },
      {
        outcome: 'no-op',
        recipients: [{ reasonCode: 'hp-at-cap' }],
      },
    ])
    expect(operationTraceOutcomes(result.trace)).toEqual(['prevented', 'no-op'])
  })

  it('fails closed when standard damage has no authoritative damage result', () => {
    const damage = emission(operation('operation.unresolved-damage', 'damage', {
      damageClass: 'physical',
      damageBase: 4,
      moveType: 'normal',
      accuracyRollId: null,
      criticalRollId: null,
    }))

    expect(() => reduceMoveCoreTokenEffects({
      context: buildContext(),
      operations: [damage],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([damage]),
    })).toThrowError(expect.objectContaining({
      code: 'damage-resolution-missing',
    }))
  })

  it('includes indirect condition-immunity providers in the reducer read set', () => {
    const context = buildContext()
    const sleep = emission(operation('operation.sleep', 'condition', {
      action: 'apply',
      conditionId: 'sleep',
    }))
    const bystander = context.queries.tokens.get('bystander-token')!

    const result = reduceMoveCoreTokenEffects({
      context,
      operations: [sleep],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({
        moveType: 'Normal',
        conditionContext: {
          sweetVeilProviderCandidates: [bystander],
          isAlly: () => true,
        },
      }),
      trace: traceFor([sleep]),
    })

    expect(result.operationResults[0]?.recipients[0]?.consultedPlacementIds).toEqual([
      'bystander-token',
    ])
    expect(result.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'target', revision: 4 },
      { kind: 'pokemon', slug: 'bystander', revision: 4 },
    ])
  })

  it('rejects emitted recipients outside the authoritative selector set', () => {
    const actorOperation = operation('operation.actor-heal', 'heal', {
      mode: 'gain',
      pool: 'hit-points',
      calculation: { kind: 'fixed', value: 5 },
      bounds: { minimum: null, maximum: null },
      rounding: 'floor',
      injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
    }, 'actor')
    const wrongActorEmission = emission(actorOperation, ['target-token'])

    expect(() => reduceMoveCoreTokenEffects({
      context: buildContext(),
      operations: [wrongActorEmission],
      dynamicRecipients: dynamicRecipients(),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([wrongActorEmission]),
    })).toThrowError(expect.objectContaining({
      name: MoveCoreTokenEffectReductionError.name,
      code: 'recipient-set-mismatch',
    }))

    const targetOperation = emission(operation('operation.target-heal', 'heal', {
      mode: 'gain',
      pool: 'hit-points',
      calculation: { kind: 'fixed', value: 5 },
      bounds: { minimum: null, maximum: null },
      rounding: 'floor',
      injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
    }), ['bystander-token'])
    expect(() => reduceMoveCoreTokenEffects({
      context: buildContext(),
      operations: [targetOperation],
      dynamicRecipients: dynamicRecipients(['target-token']),
      immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal' }),
      trace: traceFor([targetOperation]),
    })).toThrowError(expect.objectContaining({ code: 'recipient-set-mismatch' }))
  })
})
