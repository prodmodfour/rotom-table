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
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
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
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
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

const buildContext = (
  map: TabletopMap = mapFixture(),
  hp: CoreReducerHpFixture = {},
) => buildAuthoritativeMoveRulesContext({
  map,
  pokemonSheets: new Map([
    ['actor', pokemonSheet('actor', {
      combat: { currentHp: hp.actor ?? 999 },
    })],
    ['target', pokemonSheet('target', {
      types: ['Fairy', 'Electric'],
      abilities: [{ name: 'Keen Eye' }],
      stats: { atk: { stage: 5 } },
      combatStages: { acc: 0 },
      combat: {
        currentHp: hp.target ?? 999,
        injuries: hp.targetInjuries ?? 0,
        conditions: ['Burned'],
      },
    })],
    ['bystander', pokemonSheet('bystander', {
      combat: { currentHp: hp.bystander ?? 999 },
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
): MoveCoreTokenEffectOperation => parseMoveEffectOperation({
  id,
  kind,
  source: { kind: 'move', id: 'move.reducer-test' },
  recipients: { kind: recipients },
  phase: 'hit',
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
  injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  ...overrides,
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

const emission = (
  value: MoveCoreTokenEffectOperation,
  recipientIds: readonly string[] = ['target-token'],
): MoveResolvedCoreTokenEffectOperation => ({
  operation: value,
  recipientIds,
})

const traceFor = (
  operations: readonly MoveResolvedCoreTokenEffectOperation[],
): MoveResolutionAuditTrace => parseMoveResolutionAuditTrace({
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
  events: [
    {
      sequence: 1,
      kind: 'phase-transition',
      reasonCode: 'hit-phase',
      from: null,
      to: 'hit',
    },
    ...operations.map(({ operation: value, recipientIds }, index) => ({
      sequence: index + 2,
      kind: 'operation' as const,
      phase: value.phase,
      operationId: value.id,
      operationKind: value.kind,
      recipientIds: [...recipientIds],
      outcome: 'applied' as const,
      reasonCode: value.reasonCode,
      input: value.payload as unknown as MoveResolutionTraceJsonValue,
      result: { status: 'emitted' },
    })),
  ],
})

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
  immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType }),
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
      dynamicRecipients: dynamicRecipients(),
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
      dynamicRecipients: dynamicRecipients(),
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
