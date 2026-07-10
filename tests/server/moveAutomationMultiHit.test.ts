import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import type { MoveMultiHitEffectOperation } from '#shared/moveAutomation/effects'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  executeMoveSpec,
} from '~~/server/domain/moveAutomation/executeSpec'
import {
  createFiniteAuthoritativeMoveRandomStream,
  type AuthoritativeMoveRandomDrawStream,
} from '~~/server/domain/moveAutomation/random'
import { resolveImmediateMoveSpec } from '~~/server/domain/moveAutomation/resolveImmediateSpec'
import type { MoveSpecV2Runtime } from '~~/server/domain/moveAutomation/registry'
import {
  validateMoveSpec,
  type ValidatedMoveSpecDefinition,
} from '~~/server/domain/moveAutomation/validateSpec'
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
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'actor' ? 'Charmander' : 'Snorlax',
  level: 20,
  revision: slug === 'actor' ? 3 : 7,
  movelist: slug === 'actor' ? [{ name: 'Tackle' }] : [],
  types: slug === 'actor' ? ['Fire'] : ['Normal'],
  combat: { currentHp: 100 },
  stats: {
    atk: { added: 0, stage: 0 },
    def: { added: 0, stage: 0 },
    satk: { added: 0, stage: 0 },
    sdef: { added: 0, stage: 0 },
    spd: { added: 0, stage: 0 },
  },
  ...overrides,
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'multi-hit-arena',
  name: 'Multi-Hit Arena',
  revision: 5,
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
  initiative: { activeId: 'actor-token', round: 1 },
})

const intent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Tackle',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

const context = (options: {
  readonly random: AuthoritativeMoveRandomDrawStream
  readonly targetHp?: number
}) => buildAuthoritativeMoveRulesContext({
  map: mapFixture(),
  pokemonSheets: new Map([
    ['actor', pokemonSheet('actor')],
    ['target', pokemonSheet('target', {
      combat: { currentHp: options.targetHp ?? 100 },
    })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
  intent: intent(),
  candidatePlacementIds: ['target-token'],
  selectedPlacementIds: ['target-token'],
  random: options.random,
  time: 10_000,
})

const damage = {
  damageClass: 'physical' as const,
  damageBase: 1,
  moveType: 'normal',
  accuracyRollId: null,
  criticalRollId: null,
}

const multiHitOperation = (
  payload: MoveMultiHitEffectOperation['payload'],
): MoveMultiHitEffectOperation => ({
  id: 'operation.multi-hit',
  kind: 'multi-hit',
  source: { kind: 'move', id: 'move.tackle' },
  recipients: { kind: 'attacked-targets' },
  phase: 'damage',
  reasonCode: 'move.tackle.multi-hit',
  payload,
})

const definitionFor = (
  operation: MoveMultiHitEffectOperation,
): ValidatedMoveSpecDefinition => validateMoveSpec({
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
  presentation: { displayName: 'Tackle', vfxKey: null, tags: ['multi-hit'] },
})

const execute = (options: {
  readonly operation: MoveMultiHitEffectOperation
  readonly randomValues: readonly number[]
  readonly targetHp?: number
}) => executeMoveSpec({
  definition: definitionFor(options.operation),
  context: context({
    random: createFiniteAuthoritativeMoveRandomStream(options.randomValues),
    targetHp: options.targetHp,
  }),
  authoritativeTargetIds: ['target-token'],
})

const operationTrace = (result: ReturnType<typeof executeMoveSpec>) => result.trace.events.find(
  event => event.kind === 'operation' && event.operationId === 'operation.multi-hit',
)

describe('native MoveSpec multi-hit sequences', () => {
  it('resolves per-hit accuracy, damage, criticals, and ordered effects independently', () => {
    const operation = multiHitOperation({
      count: { kind: 'fixed', hits: 3 },
      accuracy: {
        kind: 'per-hit',
        rollId: 'roll.strike-accuracy',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        stopOnMiss: false,
      },
      critical: { kind: 'accuracy' },
      damage,
      effects: [{
        id: 'effect.burn-target',
        timing: 'after-each',
        trigger: 'damage',
        recipient: 'target',
        kind: 'condition',
        reasonCode: 'move.tackle.burn-target',
        payload: { action: 'apply', conditionId: 'burned' },
      }, {
        id: 'effect.raise-actor-attack',
        timing: 'after-all',
        trigger: 'hit',
        recipient: 'actor',
        kind: 'combat-stage',
        reasonCode: 'move.tackle.raise-actor-attack',
        payload: { action: 'modify', stage: 'atk', value: 1 },
      }],
    })
    const rules = context({
      random: createFiniteAuthoritativeMoveRandomStream([0.5, 0, 0, 0.95, 0]),
    })
    const mapBefore = structuredClone(rules.map)
    const sheetsBefore = structuredClone(rules.resolvedSheets)
    const result = executeMoveSpec({
      definition: definitionFor(operation),
      context: rules,
      authoritativeTargetIds: ['target-token'],
    })

    expect(result.kind).toBe('complete')
    expect(result.rollLedger.map(entry => ({
      id: entry.rollId,
      natural: entry.naturalResult,
    }))).toEqual([
      { id: 'roll.strike-accuracy.t1.h1', natural: 11 },
      { id: 'operation.multi-hit.t1.h1.roll', natural: 1 },
      { id: 'roll.strike-accuracy.t1.h2', natural: 1 },
      { id: 'roll.strike-accuracy.t1.h3', natural: 20 },
      { id: 'operation.multi-hit.t1.h3.roll', natural: 1 },
    ])
    expect(result.resolvedRolls.map(roll => ({
      purpose: roll.purpose,
      hitIndex: roll.hitIndex,
    }))).toEqual([
      { purpose: 'accuracy', hitIndex: 1 },
      { purpose: 'damage', hitIndex: 1 },
      { purpose: 'accuracy', hitIndex: 2 },
      { purpose: 'accuracy', hitIndex: 3 },
      { purpose: 'damage', hitIndex: 3 },
    ])
    const sequence = result.multiHitExecutions[0]!
    expect(sequence.resolution).toMatchObject({
      totalAttemptedHitCount: 3,
      totalSuccessfulHitCount: 2,
      stoppedForKnockout: false,
      targets: [{
        targetId: 'target-token',
        plannedHitCount: 3,
        attemptedHitCount: 3,
        successfulHitCount: 2,
        missedHitCount: 1,
        stopReason: 'completed',
        strikes: [
          {
            hitIndex: 1,
            accuracy: { hit: true, naturalResult: 11 },
            damage: { criticalHit: { critical: false } },
            afterEach: {
              effects: [{ effectId: 'effect.burn-target', outcome: 'applied' }],
            },
          },
          {
            hitIndex: 2,
            accuracy: { hit: false, naturalResult: 1 },
            damage: null,
          },
          {
            hitIndex: 3,
            accuracy: { hit: true, naturalResult: 20 },
            damage: { criticalHit: { critical: true } },
            afterEach: {
              effects: [{ effectId: 'effect.burn-target', outcome: 'no-op' }],
            },
          },
        ],
      }],
      afterAllActor: {
        effects: [{ effectId: 'effect.raise-actor-attack', outcome: 'applied' }],
      },
    })
    expect(sequence.conditionUpdates).toEqual([
      { id: 'target-token', conditions: ['Burned'] },
    ])
    expect(sequence.combatStageUpdates).toEqual([
      expect.objectContaining({
        id: 'actor-token',
        stages: expect.objectContaining({ atk: 1 }),
      }),
    ])
    expect(sequence.stateChanges.changes).toHaveLength(2)
    expect(result.hitTargetIds).toEqual(['target-token'])
    expect(result.missedTargetIds).toEqual([])
    expect(operationTrace(result)).toMatchObject({
      kind: 'operation',
      operationKind: 'multi-hit',
      outcome: 'applied',
      result: {
        targets: [{
          strikes: [
            expect.objectContaining({ hitIndex: 1 }),
            expect.objectContaining({ hitIndex: 2 }),
            expect.objectContaining({ hitIndex: 3 }),
          ],
        }],
      },
    })
    expect(rules.map).toEqual(mapBefore)
    expect(rules.resolvedSheets).toEqual(sheetsBefore)
    expect(Object.isFrozen(sequence)).toBe(true)
    expect(Object.isFrozen(sequence.resolution.targets[0]!.strikes)).toBe(true)
  })

  it('supports direct hit-count rolls and independent per-hit critical rolls', () => {
    const operation = multiHitOperation({
      count: {
        kind: 'roll',
        scope: 'recipient',
        rollId: 'roll.hit-count',
        formula: { kind: 'uniform-integer', minimum: 2, maximum: 2 },
        minimum: 2,
        maximum: 2,
      },
      accuracy: { kind: 'automatic' },
      critical: {
        kind: 'per-hit',
        rollId: 'roll.strike-critical',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      },
      damage,
      effects: [],
    })
    const result = execute({
      operation,
      randomValues: [0, 0.95, 0, 0, 0],
    })

    expect(result.rollLedger.map(entry => entry.rollId)).toEqual([
      'roll.hit-count.t1',
      'roll.strike-critical.t1.h1',
      'operation.multi-hit.t1.h1.roll',
      'roll.strike-critical.t1.h2',
      'operation.multi-hit.t1.h2.roll',
    ])
    expect(result.multiHitExecutions[0]!.resolution.targets[0]).toMatchObject({
      plannedHitCount: 2,
      successfulHitCount: 2,
      strikes: [
        {
          hitIndex: 1,
          criticalRollId: 'roll.strike-critical.t1.h1',
          damage: { criticalHit: { critical: true } },
        },
        {
          hitIndex: 2,
          criticalRollId: 'roll.strike-critical.t1.h2',
          damage: { criticalHit: { critical: false } },
        },
      ],
    })
  })

  it('records one reviewed hit-count table and stops draws immediately on knockout', () => {
    const operation = multiHitOperation({
      count: {
        kind: 'table',
        scope: 'sequence',
        rollId: 'roll.hit-count',
        tableId: 'table.five-strike',
        drawFormula: { kind: 'dice', count: 1, sides: 8, modifier: 0 },
        entries: [
          { minimum: 1, maximum: 1, hits: 1 },
          { minimum: 2, maximum: 3, hits: 2 },
          { minimum: 4, maximum: 6, hits: 3 },
          { minimum: 7, maximum: 7, hits: 4 },
          { minimum: 8, maximum: 8, hits: 5 },
        ],
      },
      accuracy: {
        kind: 'once',
        rollId: 'roll.sequence-accuracy',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      },
      critical: { kind: 'none' },
      damage,
      effects: [],
    })
    const first = execute({
      operation,
      randomValues: [0.5, 0.999, 0],
      targetHp: 1,
    })
    const retry = execute({
      operation,
      randomValues: [0.5, 0.999, 0],
      targetHp: 1,
    })

    expect(first).toEqual(retry)
    expect(first.rollLedger).toEqual(retry.rollLedger)
    expect(first.rollLedger.map(entry => ({
      id: entry.rollId,
      formula: entry.formula,
      result: entry.finalValue,
    }))).toEqual([
      {
        id: 'roll.sequence-accuracy.t1',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        result: 11,
      },
      {
        id: 'roll.hit-count',
        formula: { kind: 'table', tableId: 'table.five-strike' },
        result: 5,
      },
      {
        id: 'operation.multi-hit.t1.h1.roll',
        formula: { kind: 'dice', count: 1, sides: 6, modifier: 1 },
        result: 2,
      },
    ])
    expect(first.multiHitExecutions[0]!.resolution.targets[0]).toMatchObject({
      hitCountRollId: 'roll.hit-count',
      plannedHitCount: 5,
      attemptedHitCount: 1,
      successfulHitCount: 1,
      stopReason: 'knockout',
      strikes: [{
        hitIndex: 1,
        knockout: true,
        stoppedAfterStrike: true,
      }],
    })
    expect(first.multiHitExecutions[0]!.hpUpdates).toEqual([
      expect.objectContaining({ id: 'target-token', currentHp: 0 }),
    ])
    expect(first.faintedTargetIds).toEqual(['target-token'])
    expect(first.trace.events.filter(event => event.kind === 'roll')).toHaveLength(3)
  })

  it('honors stop-on-miss without rolling count-independent damage or later strikes', () => {
    const operation = multiHitOperation({
      count: { kind: 'fixed', hits: 5 },
      accuracy: {
        kind: 'per-hit',
        rollId: 'roll.strike-accuracy',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        stopOnMiss: true,
      },
      critical: { kind: 'none' },
      damage,
      effects: [],
    })
    const result = execute({ operation, randomValues: [0] })

    expect(result.rollLedger.map(entry => entry.rollId)).toEqual([
      'roll.strike-accuracy.t1.h1',
    ])
    expect(result.multiHitExecutions[0]).toMatchObject({
      outcome: 'no-op',
      stateChanges: { changes: [] },
      resolution: {
        totalAttemptedHitCount: 1,
        totalSuccessfulHitCount: 0,
        targets: [{
          plannedHitCount: 5,
          missedHitCount: 1,
          stopReason: 'stop-on-miss',
        }],
      },
    })
    expect(result.hitTargetIds).toEqual([])
    expect(result.missedTargetIds).toEqual(['target-token'])
  })

  it('carries aggregate strike state through immediate native planning projection', () => {
    const operation = multiHitOperation({
      count: { kind: 'fixed', hits: 2 },
      accuracy: { kind: 'automatic' },
      critical: { kind: 'none' },
      damage,
      effects: [],
    })
    const definition = definitionFor(operation)
    const runtime: MoveSpecV2Runtime = {
      canonicalId: 'Tackle',
      kind: 'movespec-v2',
      version: definition.spec.version,
      definitionHash: definition.definitionHash,
      sourceModule: 'tests/multi-hit',
      definition,
    }
    const rules = context({
      random: createFiniteAuthoritativeMoveRandomStream([0, 0]),
    })
    const entry = rules.queries.resolveActorMoveEntry('Tackle')
    if (!entry.ok) throw new Error(entry.message)

    const resolution = resolveImmediateMoveSpec({
      context: rules,
      runtime,
      entry: entry.entry,
      authoritativeTargetIds: ['target-token'],
    })

    expect(resolution.transaction).toMatchObject({
      attackedTargetIds: ['target-token'],
      hitTargetIds: ['target-token'],
      hpUpdates: [expect.objectContaining({ id: 'target-token' })],
    })
    expect(resolution.transaction.logLines.at(-1)).toContain('2 hit, 0 missed')
    expect(resolution.native.dynamicRecipients).toMatchObject({
      hitTargetIds: ['target-token'],
      damagedTargetIds: ['target-token'],
      faintedTargetIds: [],
    })
    expect(resolution.native.coreStateChanges.changes).toEqual([
      expect.objectContaining({
        kind: 'sheet-state',
        sourceOperationId: 'operation.multi-hit',
        reasonCode: 'move.tackle.multi-hit',
        changedFields: ['hp'],
      }),
    ])
    expect(resolution.rollLedger).toHaveLength(2)
  })
})
