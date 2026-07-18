import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import { executeMoveSpec } from '~~/server/domain/moveAutomation/executeSpec'
import { createFiniteAuthoritativeMoveRandomStream } from '~~/server/domain/moveAutomation/random'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import { findMove } from '~~/data/ptuReference'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createMoveAutomationScriptFromMoveData } from '~/utils/moveAutomationDerived'
import { redBlueEncounterStateFixture } from '../fixtures/moveAutomation/encounterSides'

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
  sideId?: string,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
  ...(sideId ? { sideId } : {}),
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'branch-arena',
  name: 'Branch Arena',
  revision: 7,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [{ kind: 'sunny' }], terrains: [], rooms: [] },
  encounterState: redBlueEncounterStateFixture(),
  placements: [
    placement('actor-token', 'actor', 0, 'red'),
    placement('ally-token', 'ally', 1, 'red'),
    placement('enemy-token', 'enemy', 2, 'blue'),
    placement('unknown-token', 'unknown', 3),
  ],
  lights: [],
  initiative: { activeId: 'actor-token', round: 1 },
})

const pokemonSheet = (slug: string): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'enemy' ? 'Snorlax' : 'Pikachu',
  level: 20,
  revision: 3,
  movelist: slug === 'actor' ? [{ name: 'Pollen Puff' }] : [],
  combat: { currentHp: 50 },
})

const intent = (
  selectedPlacementIds: readonly string[],
): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Pollen Puff',
  selection: {
    kind: 'target-count',
    targetPlacementIds: [...selectedPlacementIds],
  },
})

const buildContext = (options: {
  readonly selectedPlacementIds?: readonly string[]
  readonly draws?: readonly number[]
} = {}) => {
  const selectedPlacementIds = options.selectedPlacementIds ?? ['ally-token', 'enemy-token']
  return buildAuthoritativeMoveRulesContext({
    map: mapFixture(),
    pokemonSheets: new Map([
      ['actor', pokemonSheet('actor')],
      ['ally', pokemonSheet('ally')],
      ['enemy', pokemonSheet('enemy')],
      ['unknown', pokemonSheet('unknown')],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: intent(selectedPlacementIds),
    candidatePlacementIds: selectedPlacementIds,
    selectedPlacementIds,
    random: createFiniteAuthoritativeMoveRandomStream(options.draws ?? []),
    time: 20_000,
    legacyScripts: new Map([[
      'Pollen Puff',
      createMoveAutomationScriptFromMoveData(findMove('Pollen Puff')!),
    ]]),
  })
}

const operation = (
  id: string,
  kind: string,
  recipients: string,
  phase: string,
  payload: Record<string, unknown>,
) => ({
  id,
  kind,
  source: { kind: 'move', id: 'move.pollen-puff' },
  recipients: { kind: recipients },
  phase,
  reasonCode: `move.pollen-puff.${id.split('.').at(-1)}`,
  payload,
})

const baseSpec = (options: {
  readonly targeting?: Record<string, unknown>
  readonly phases: readonly Record<string, unknown>[]
}) => ({
  schemaVersion: 2,
  canonicalId: 'Pollen Puff',
  version: 1,
  targeting: options.targeting ?? {
    kind: 'none',
    minTargets: 0,
    maxTargets: 0,
    selector: null,
  },
  preconditions: [],
  costs: [],
  phases: options.phases,
  registeredHandlerId: null,
  presentation: {
    displayName: 'Pollen Puff',
    vfxKey: null,
    tags: ['test-only'],
  },
})

const traceOperations = (result: ReturnType<typeof executeMoveSpec>) => result.trace.events
  .filter(event => event.kind === 'operation')

describe('MoveSpec optional and exclusive branches', () => {
  it('routes Pollen Puff-style ally, enemy, and unknown recipients through server relationships', () => {
    const spec = baseSpec({
      targeting: {
        kind: 'multi-target',
        minTargets: 3,
        maxTargets: 3,
        selector: { kind: 'selected-targets' },
      },
      phases: [
        {
          phase: 'target',
          operations: [operation(
            'operation.target-branch',
            'branch',
            'attacked-targets',
            'target',
            {
              kind: 'relationship',
              selectionId: 'branch.pollen-puff-target',
              scope: 'recipient',
              branches: {
                self: { id: 'branch.heal-self', operationIds: ['operation.heal'] },
                ally: { id: 'branch.heal-ally', operationIds: ['operation.heal'] },
                enemy: {
                  id: 'branch.damage-enemy',
                  operationIds: ['operation.accuracy', 'operation.damage'],
                },
                unknown: { id: 'branch.unknown-side', operationIds: [] },
              },
            },
          )],
        },
        {
          phase: 'accuracy',
          operations: [operation(
            'operation.accuracy',
            'roll',
            'attacked-targets',
            'accuracy',
            {
              rollId: 'roll.accuracy',
              formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
            },
          )],
        },
        {
          phase: 'damage',
          operations: [operation(
            'operation.damage',
            'damage',
            'hit-targets',
            'damage',
            {
              damageClass: 'special',
              damageBase: 9,
              moveType: 'bug',
              accuracyRollId: 'roll.accuracy',
              criticalRollId: null,
            },
          )],
        },
        {
          phase: 'after-damage',
          operations: [operation(
            'operation.heal',
            'heal',
            'attacked-targets',
            'after-damage',
            {
              mode: 'gain',
              pool: 'hit-points',
              calculation: { kind: 'percent-max', percent: 50 },
              bounds: { minimum: null, maximum: null },
              rounding: 'floor',
              injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
            },
          )],
        },
      ],
    })
    const context = buildContext({
      selectedPlacementIds: ['ally-token', 'enemy-token', 'unknown-token'],
      draws: [0.9, 0.5, 0.5],
    })
    const result = executeMoveSpec({
      definition: validateMoveSpec(spec),
      context,
    })

    expect(result.kind).toBe('complete')
    expect(result.branchSelections).toEqual([{
      operationId: 'operation.target-branch',
      selectionId: 'branch.pollen-puff-target',
      scope: 'recipient',
      decisions: [
        {
          recipientId: 'ally-token',
          branchId: 'branch.heal-ally',
          reasonCode: 'relationship-ally',
        },
        {
          recipientId: 'enemy-token',
          branchId: 'branch.damage-enemy',
          reasonCode: 'relationship-enemy',
        },
        {
          recipientId: 'unknown-token',
          branchId: 'branch.unknown-side',
          reasonCode: 'relationship-unknown-side',
        },
      ],
    }])
    expect(result.operations.map(({ operation: emitted, recipientIds }) => ({
      id: emitted.id,
      recipientIds,
    }))).toEqual([
      {
        id: 'operation.target-branch',
        recipientIds: ['ally-token', 'enemy-token', 'unknown-token'],
      },
      { id: 'operation.accuracy', recipientIds: ['enemy-token'] },
      { id: 'operation.damage', recipientIds: ['enemy-token'] },
      { id: 'operation.heal', recipientIds: ['ally-token'] },
    ])
    expect(result.hitTargetIds).toEqual(['enemy-token'])
    expect(result.rollLedger).toHaveLength(2)
    expect(traceOperations(result)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationId: 'operation.target-branch',
        outcome: 'applied',
        result: {
          selection: expect.objectContaining({
            selectionId: 'branch.pollen-puff-target',
          }),
        },
      }),
    ]))
    expect(Object.isFrozen(result.branchSelections)).toBe(true)
    expect(Object.isFrozen(result.branchSelections[0]?.decisions)).toBe(true)
  })

  it('selects one resolution-wide predicate path and never emits the other path', () => {
    const spec = baseSpec({
      phases: [
        {
          phase: 'hit',
          operations: [operation(
            'operation.weather-branch',
            'branch',
            'none',
            'hit',
            {
              kind: 'predicate',
              selectionId: 'branch.sunny',
              scope: 'resolution',
              predicate: {
                kind: 'comparison',
                operator: 'equal',
                left: { kind: 'weather' },
                right: { kind: 'constant', value: 'sunny' },
              },
              whenTrue: { id: 'branch.sunny-active', operationIds: ['operation.sunny-log'] },
              whenFalse: { id: 'branch.not-sunny', operationIds: ['operation.other-log'] },
            },
          )],
        },
        {
          phase: 'cleanup',
          operations: [
            operation(
              'operation.sunny-log',
              'log',
              'none',
              'cleanup',
              { messageKey: 'move.pollen-puff.sunny', arguments: [] },
            ),
            operation(
              'operation.other-log',
              'log',
              'none',
              'cleanup',
              { messageKey: 'move.pollen-puff.other', arguments: [] },
            ),
          ],
        },
      ],
    })
    const result = executeMoveSpec({
      definition: validateMoveSpec(spec),
      context: buildContext({ selectedPlacementIds: [] }),
    })

    expect(result.kind).toBe('complete')
    expect(result.branchSelections[0]).toMatchObject({
      selectionId: 'branch.sunny',
      decisions: [{ recipientId: null, branchId: 'branch.sunny-active' }],
    })
    expect(result.operations.map(({ operation: emitted }) => emitted.id)).toEqual([
      'operation.weather-branch',
      'operation.sunny-log',
    ])
    expect(traceOperations(result)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationId: 'operation.other-log',
        outcome: 'prevented',
        result: { status: 'branch-not-selected', selectionId: 'branch.sunny' },
      }),
    ]))
  })

  it('routes authoritative check outcomes into their reviewed later operations', () => {
    const spec = baseSpec({
      targeting: {
        kind: 'single-target',
        minTargets: 1,
        maxTargets: 1,
        selector: { kind: 'selected-targets' },
      },
      phases: [
        {
          phase: 'hit',
          operations: [
            operation(
              'operation.save',
              'check',
              'attacked-targets',
              'hit',
              {
                kind: 'save',
                checkId: 'check.resist',
                roll: {
                  rollId: 'roll.resist',
                  source: {
                    kind: 'fixed',
                    formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
                  },
                  modifiers: [],
                  reroll: { count: 0, keep: 'latest' },
                  resourceReroll: null,
                },
                dc: { kind: 'constant', value: 10 },
                tie: { kind: 'failure' },
                branches: { success: 'branch.resisted', failure: 'branch.affected' },
              },
            ),
            operation(
              'operation.save-branch',
              'branch',
              'attacked-targets',
              'hit',
              {
                kind: 'check',
                selectionId: 'branch.save-result',
                scope: 'recipient',
                checkId: 'check.resist',
                branches: {
                  success: {
                    id: 'branch.resisted',
                    operationIds: ['operation.resisted-log'],
                  },
                  failure: {
                    id: 'branch.affected',
                    operationIds: ['operation.affected-log'],
                  },
                },
              },
            ),
          ],
        },
        {
          phase: 'cleanup',
          operations: [
            operation(
              'operation.resisted-log',
              'log',
              'attacked-targets',
              'cleanup',
              { messageKey: 'move.check.resisted', arguments: [] },
            ),
            operation(
              'operation.affected-log',
              'log',
              'attacked-targets',
              'cleanup',
              { messageKey: 'move.check.affected', arguments: [] },
            ),
          ],
        },
      ],
    })
    const result = executeMoveSpec({
      definition: validateMoveSpec(spec),
      context: buildContext({ selectedPlacementIds: ['enemy-token'], draws: [0.9] }),
    })

    expect(result.kind).toBe('complete')
    expect(result.resolvedChecks).toMatchObject([{
      checkId: 'check.resist',
      recipientId: 'enemy-token',
      outcome: 'success',
      selectedBranchId: 'branch.resisted',
    }])
    expect(result.branchSelections).toEqual([{
      operationId: 'operation.save-branch',
      selectionId: 'branch.save-result',
      scope: 'recipient',
      decisions: [{
        recipientId: 'enemy-token',
        branchId: 'branch.resisted',
        reasonCode: 'branch-check-success',
      }],
    }])
    expect(result.operations.map(({ operation: emitted }) => emitted.id)).toEqual([
      'operation.save',
      'operation.save-branch',
      'operation.resisted-log',
    ])
    expect(traceOperations(result)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operationId: 'operation.affected-log',
        outcome: 'prevented',
      }),
    ]))
  })

  it('returns one typed target-specific pending choice without exposing branch mechanics', () => {
    const stageOperation = (id: string, selectedStage: 'atk' | 'def') => operation(
      id,
      'combat-stage',
      'attacked-targets',
      'after-damage',
      {
        action: 'modify',
        stage: 'selected-stat',
        selectedStage,
        value: 1,
        stageSource: null,
        rounding: null,
      },
    )
    const spec = baseSpec({
      targeting: {
        kind: 'multi-target',
        minTargets: 2,
        maxTargets: 2,
        selector: { kind: 'selected-targets' },
      },
      phases: [
        {
          phase: 'hit',
          operations: [operation(
            'operation.choose-stat',
            'branch',
            'attacked-targets',
            'hit',
            {
              kind: 'choice',
              selectionId: 'branch.selected-stat',
              scope: 'recipient',
              requestId: 'request.selected-stat',
              promptKey: 'move.choose-stat',
              options: [
                {
                  id: 'option.attack',
                  labelKey: 'stat.attack',
                  operationIds: ['operation.raise-attack'],
                },
                {
                  id: 'option.defense',
                  labelKey: 'stat.defense',
                  operationIds: ['operation.raise-defense'],
                },
              ],
              pass: null,
            },
          )],
        },
        {
          phase: 'after-damage',
          operations: [
            stageOperation('operation.raise-attack', 'atk'),
            stageOperation('operation.raise-defense', 'def'),
          ],
        },
      ],
    })
    const context = buildContext()
    const mapBefore = structuredClone(context.map)
    const result = executeMoveSpec({
      definition: validateMoveSpec(spec),
      context,
    })

    expect(result.kind).toBe('pending-request')
    if (result.kind !== 'pending-request') return
    expect(result.request).toEqual({
      kind: 'branch-choice',
      operationId: 'operation.choose-stat',
      phase: 'hit',
      reasonCode: 'move.pollen-puff.choose-stat',
      recipientIds: ['ally-token', 'enemy-token'],
      requestId: 'request.selected-stat',
      promptKey: 'move.choose-stat',
      options: [
        { id: 'option.attack', labelKey: 'stat.attack' },
        { id: 'option.defense', labelKey: 'stat.defense' },
      ],
      allowPass: false,
      selectionId: 'branch.selected-stat',
      scope: 'recipient',
    })
    expect(result.operations.map(({ operation: emitted }) => emitted.id)).toEqual([
      'operation.choose-stat',
    ])
    expect(result.branchSelections).toEqual([])
    expect(result.rollLedger).toEqual([])
    expect(context.map).toEqual(mapBefore)
    expect(JSON.stringify(result.request)).not.toContain('operation.raise-')
    expect(JSON.stringify(result.request)).not.toContain('combat-stage')
  })

  it('models an optional effect as one reviewed option plus an explicit empty pass path', () => {
    const spec = baseSpec({
      phases: [
        {
          phase: 'hit',
          operations: [operation(
            'operation.optional-effect',
            'branch',
            'actor',
            'hit',
            {
              kind: 'choice',
              selectionId: 'branch.optional-effect',
              scope: 'resolution',
              requestId: 'request.optional-effect',
              promptKey: 'move.optional-effect',
              options: [{
                id: 'option.apply',
                labelKey: 'choice.apply',
                operationIds: ['operation.apply-effect'],
              }],
              pass: { id: 'option.pass', operationIds: [] },
            },
          )],
        },
        {
          phase: 'cleanup',
          operations: [operation(
            'operation.apply-effect',
            'log',
            'none',
            'cleanup',
            { messageKey: 'move.optional-effect.applied', arguments: [] },
          )],
        },
      ],
    })
    const result = executeMoveSpec({
      definition: validateMoveSpec(spec),
      context: buildContext({ selectedPlacementIds: [] }),
    })

    expect(result.kind).toBe('pending-request')
    if (result.kind !== 'pending-request') return
    expect(result.request).toMatchObject({
      kind: 'branch-choice',
      scope: 'resolution',
      allowPass: true,
      options: [{ id: 'option.apply', labelKey: 'choice.apply' }],
    })
    expect(result.operations.map(({ operation: emitted }) => emitted.id)).toEqual([
      'operation.optional-effect',
    ])
  })

  it('skips a nested check-result branch when its optional outer choice passes', () => {
    const checkRoll = (rollId: string) => ({
      rollId,
      source: {
        kind: 'fixed',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      },
      modifiers: [],
      reroll: { count: 0, keep: 'latest' },
      resourceReroll: null,
    })
    const spec = baseSpec({
      targeting: {
        kind: 'single-target',
        minTargets: 1,
        maxTargets: 1,
        selector: { kind: 'selected-targets' },
      },
      phases: [{
        phase: 'hit',
        operations: [
          operation('operation.optional-check', 'branch', 'attacked-targets', 'hit', {
            kind: 'choice',
            selectionId: 'branch.optional-check',
            scope: 'recipient',
            requestId: 'request.optional-check',
            promptKey: 'move.optional-check',
            options: [{
              id: 'option.check',
              labelKey: 'choice.check',
              operationIds: ['operation.check', 'operation.check-result'],
            }],
            pass: { id: 'option.pass', operationIds: [] },
          }),
          operation('operation.check', 'check', 'attacked-targets', 'hit', {
            kind: 'opposed',
            checkId: 'check.optional',
            actorRoll: checkRoll('roll.optional.actor'),
            targetRoll: checkRoll('roll.optional.target'),
            tie: { kind: 'failure' },
            branches: { success: 'branch.success', failure: 'branch.failure' },
          }),
          operation('operation.check-result', 'branch', 'attacked-targets', 'hit', {
            kind: 'check',
            selectionId: 'branch.check-result',
            scope: 'recipient',
            checkId: 'check.optional',
            branches: {
              success: { id: 'branch.success', operationIds: ['operation.success-log'] },
              failure: { id: 'branch.failure', operationIds: [] },
            },
          }),
          operation('operation.success-log', 'log', 'attacked-targets', 'hit', {
            messageKey: 'move.optional-check.success',
            arguments: [],
          }),
        ],
      }],
    })
    const result = executeMoveSpec({
      definition: validateMoveSpec(spec),
      context: buildContext({ selectedPlacementIds: ['enemy-token'], draws: [] }),
      responses: [{ requestId: 'request.optional-check', optionId: null }],
    })

    expect(result.kind).toBe('complete')
    expect(result.rollLedger).toEqual([])
    expect(result.resolvedChecks).toEqual([])
    expect(traceOperations(result)).toEqual(expect.arrayContaining([
      expect.objectContaining({ operationId: 'operation.optional-check', outcome: 'no-op' }),
      expect.objectContaining({ operationId: 'operation.check', outcome: 'prevented' }),
      expect.objectContaining({ operationId: 'operation.check-result', outcome: 'prevented' }),
      expect.objectContaining({ operationId: 'operation.success-log', outcome: 'prevented' }),
    ]))
  })
})
