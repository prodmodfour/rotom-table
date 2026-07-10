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

const buildContext = () => buildAuthoritativeMoveRulesContext({
  map: mapFixture(),
  pokemonSheets: new Map([
    ['actor', pokemonSheet('actor')],
    ['target', pokemonSheet('target', {
      types: ['Fairy', 'Electric'],
      abilities: [{ name: 'Keen Eye' }],
      stats: { atk: { stage: 5 } },
      combatStages: { acc: 0 },
      combat: { currentHp: 999, conditions: ['Burned'] },
    })],
    ['bystander', pokemonSheet('bystander')],
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
) => reduceMoveCoreTokenEffects({
  context: buildContext(),
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
        amount: 12,
        minimumRemaining: null,
        applyTypeImmunity: false,
      })),
      emission(operation('operation.temp-loss', 'direct-hp', {
        mode: 'lose',
        pool: 'temporary-hit-points',
        amount: 5,
        minimumRemaining: null,
        applyTypeImmunity: false,
      })),
      emission(operation('operation.heal', 'heal', {
        mode: 'fixed',
        pool: 'hit-points',
        amount: 1_000,
        rounding: 'floor',
      })),
    ]
    const traceBefore = structuredClone(traceFor(operations))
    const inputContextBefore = structuredClone(context.map)
    const damage = {
      resolve: () => ({
        hpLoss: loss,
        preventedBy: null,
        consultedPlacementIds: [],
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

  it('records type immunity and full-HP healing as a no-op plan', () => {
    const operations = [
      emission(operation('operation.dragon-loss', 'direct-hp', {
        mode: 'lose',
        pool: 'hit-points',
        amount: 20,
        minimumRemaining: null,
        applyTypeImmunity: true,
      })),
      emission(operation('operation.full-heal', 'heal', {
        mode: 'percent-max',
        pool: 'hit-points',
        amount: 50,
        rounding: 'floor',
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
      mode: 'fixed',
      pool: 'hit-points',
      amount: 5,
      rounding: 'floor',
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
      mode: 'fixed',
      pool: 'hit-points',
      amount: 5,
      rounding: 'floor',
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
