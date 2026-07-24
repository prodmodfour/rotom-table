import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import { executeMoveSpec } from '~~/server/domain/moveAutomation/executeSpec'
import {
  createFiniteAuthoritativeMoveRandomStream,
  type AuthoritativeMoveRandomDrawStream,
} from '~~/server/domain/moveAutomation/random'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'check-arena',
  name: 'Check Arena',
  revision: 8,
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  placements: [
    placement('actor-token', 'actor', 0),
    placement('target-token', 'target', 1),
  ],
  initiative: { activeId: 'actor-token', round: 2 },
})

const pokemonSheet = (
  slug: string,
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'actor' ? 'Pikachu' : 'Snorlax',
  level: 20,
  revision: slug === 'actor' ? 3 : 7,
  movelist: slug === 'actor' ? [{ name: 'Tackle' }] : [],
  combat: { currentHp: 50 },
  ...overrides,
})

const intent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Tackle',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

const buildContext = (
  random: AuthoritativeMoveRandomDrawStream,
  map: TabletopMap = mapFixture(),
) => buildAuthoritativeMoveRulesContext({
    map,
    pokemonSheets: new Map([
      ['actor', pokemonSheet('actor', { skills: { athletics: '3d6+1' } })],
      ['target', pokemonSheet('target', { skills: { combat: '2d6' } })],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: intent(),
    candidatePlacementIds: ['target-token'],
    selectedPlacementIds: ['target-token'],
    random,
    time: 50_000,
  })

const fixedRoll = (rollId: string, overrides: Record<string, unknown> = {}) => ({
  rollId,
  source: {
    kind: 'fixed',
    formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
  },
  modifiers: [],
  reroll: { count: 0, keep: 'latest' },
  resourceReroll: null,
  ...overrides,
})

const checkOperation = (payload: Record<string, unknown>) => ({
  id: 'operation.check',
  kind: 'check',
  source: { kind: 'move', id: 'move.check-test' },
  recipients: { kind: 'attacked-targets' },
  phase: 'hit',
  reasonCode: 'move.check-test.check',
  payload,
})

const logOperation = () => ({
  id: 'operation.after-check',
  kind: 'log',
  source: { kind: 'operation', id: 'operation.check' },
  recipients: { kind: 'none' },
  phase: 'cleanup',
  reasonCode: 'move.check-test.after-check',
  payload: { messageKey: 'move.check-test.after-check', arguments: [] },
})

const definitionFor = (
  payload: Record<string, unknown>,
  includeLaterOperation = false,
) => validateMoveSpec({
  schemaVersion: 2,
  canonicalId: 'Check Test',
  version: 1,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [],
  costs: [],
  phases: [{ phase: 'hit', operations: [checkOperation(payload)] },
    ...(includeLaterOperation
      ? [{ phase: 'cleanup', operations: [logOperation()] }]
      : [])],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Check Test',
    vfxKey: null,
    tags: ['test-only'],
  },
})

const operationTrace = (result: ReturnType<typeof executeMoveSpec>) =>
  result.trace.events.find(event => (
    event.kind === 'operation' && event.operationId === 'operation.check'
  ))

const rollTrace = (result: ReturnType<typeof executeMoveSpec>) =>
  result.trace.events.filter(event => event.kind === 'roll')

describe('authoritative opposed checks and saving throws', () => {
  it('resolves both authoritative skill pools, modifiers, and the selected opposed branch', () => {
    const stream = createFiniteAuthoritativeMoveRandomStream([
      0, 0.2, 0.4, // actor: 1 + 2 + 3
      0, 0, // target: 1 + 1
    ])
    const result = executeMoveSpec({
      definition: definitionFor({
        kind: 'opposed',
        checkId: 'check.grapple',
        actorRoll: {
          rollId: 'roll.grapple.actor',
          source: { kind: 'skill', skill: 'athletics' },
          modifiers: [{
            sourceId: 'move.actor-bonus',
            reasonCode: 'move.check-test.actor-bonus',
            value: { kind: 'constant', value: 2 },
          }],
          reroll: { count: 0, keep: 'latest' },
          resourceReroll: null,
        },
        targetRoll: {
          rollId: 'roll.grapple.target',
          source: { kind: 'skill', skill: 'combat' },
          modifiers: [{
            sourceId: 'effect.target-bonus',
            reasonCode: 'effect.check-test.target-bonus',
            value: { kind: 'constant', value: 1 },
          }],
          reroll: { count: 0, keep: 'latest' },
          resourceReroll: null,
        },
        tie: { kind: 'failure' },
        branches: {
          success: 'branch.grappled',
          failure: 'branch.resisted',
        },
      }),
      context: buildContext(stream),
    })

    expect(result.kind).toBe('complete')
    expect(result.resolvedChecks).toMatchObject([{
      checkId: 'check.grapple',
      kind: 'opposed',
      recipientId: 'target-token',
      actor: {
        placementId: 'actor-token',
        source: {
          kind: 'skill',
          skill: 'athletics',
          formula: { kind: 'dice', count: 3, sides: 6, modifier: 0 },
          basisModifier: 1,
        },
        finalValue: 9,
      },
      target: {
        placementId: 'target-token',
        source: {
          kind: 'skill',
          skill: 'combat',
          formula: { kind: 'dice', count: 2, sides: 6, modifier: 0 },
          basisModifier: 0,
        },
        finalValue: 3,
      },
      outcome: 'success',
      status: 'resolved',
      selectedBranchId: 'branch.grappled',
    }])
    expect(result.rollLedger).toMatchObject([{
      rollId: 'roll.grapple.actor.t1.r1.a1',
      modifiers: [
        { sourceId: 'check-basis', value: 1 },
        { sourceId: 'move.actor-bonus', value: 2 },
      ],
      finalValue: 9,
    }, {
      rollId: 'roll.grapple.target.t1.r1.a1',
      modifiers: [
        { sourceId: 'check-basis', value: 0 },
        { sourceId: 'effect.target-bonus', value: 1 },
      ],
      finalValue: 3,
    }])
    expect(result.resolvedRolls).toMatchObject([
      { purpose: 'check', checkRole: 'actor', attemptIndex: 1 },
      { purpose: 'check', checkRole: 'target', attemptIndex: 1 },
    ])
    expect(result.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'pokemon', slug: 'target', revision: 7 },
    ])
    expect(rollTrace(result)).toHaveLength(2)
    expect(operationTrace(result)).toMatchObject({
      outcome: 'applied',
      result: {
        checks: [{
          outcome: 'success',
          selectedBranchId: 'branch.grappled',
        }],
      },
    })
    expect(Object.isFrozen(result.resolvedChecks)).toBe(true)
    expect(Object.isFrozen(result.resolvedChecks[0]?.actor?.attempts)).toBe(true)
  })

  it('applies ordered encounter skill-check modifiers to the authoritative check ledger', () => {
    const encounter = createEmptyEncounterState()
    const map: TabletopMap = {
      ...mapFixture(),
      encounterState: {
        ...encounter,
        effects: [{
          id: 'effect.helper.skill-check',
          kind: 'numeric-modifier',
          source: {
            operationId: 'op_helper_skill_check',
            moveId: 'ability.helper',
            placementId: 'actor-token',
          },
          affected: { placementIds: ['target-token'], sideIds: [], cells: [] },
          createdRound: 2, createdTurn: 1,
          duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 2 },
          stacks: 1, charges: null,
          stackPolicy: { kind: 'refresh', maxStacks: null },
          chargePolicy: { kind: 'none', amount: null },
          tags: ['ability', 'helper', 'skill-check'],
          payload: { attribute: 'skill-check', operation: 'add', value: 1, rounding: 'none' },
          dispel: { policy: 'matching-tags', tags: ['helper', 'skill-check'] },
          transferPolicy: 'expire',
          suppression: { sources: [] },
        }],
      },
    }
    const result = executeMoveSpec({
      definition: definitionFor({
        kind: 'save',
        checkId: 'check.helper-skill',
        roll: fixedRoll('roll.helper-skill', {
          source: { kind: 'skill', skill: 'combat' },
        }),
        dc: { kind: 'constant', value: 1 },
        tie: { kind: 'success' },
        branches: { success: 'branch.saved', failure: 'branch.failed' },
      }),
      context: buildContext(createFiniteAuthoritativeMoveRandomStream([0, 0]), map),
    })
    expect(result.kind).toBe('complete')
    expect(result.resolvedChecks[0]?.target.modifiers).toContainEqual(expect.objectContaining({
      sourceId: 'effect.helper.skill-check',
      reasonCode: 'encounter.skill-check-modifier',
      value: 1,
    }))
    expect(result.rollLedger[0]?.modifiers).toContainEqual({
      sourceId: 'effect.helper.skill-check',
      reason: 'encounter.skill-check-modifier',
      value: 1,
    })
  })

  it('records automatic rerolls and bounded tie rerolls before choosing a branch', () => {
    const stream = createFiniteAuthoritativeMoveRandomStream([
      0.2, 0.7, // round 1 actor keeps 15
      0.7, // round 1 target ties on 15
      0.1, 0.8, // round 2 actor keeps 17
      0.5, // round 2 target gets 11
    ])
    const result = executeMoveSpec({
      definition: definitionFor({
        kind: 'opposed',
        checkId: 'check.push',
        actorRoll: fixedRoll('roll.push.actor', {
          reroll: { count: 1, keep: 'highest' },
        }),
        targetRoll: fixedRoll('roll.push.target'),
        tie: {
          kind: 'reroll',
          maximumRerolls: 1,
          exhaustedOutcome: 'failure',
        },
        branches: { success: 'branch.pushed', failure: 'branch.steady' },
      }),
      context: buildContext(stream),
    })

    expect(result.kind).toBe('complete')
    expect(result.resolvedChecks[0]).toMatchObject({
      tieRerolls: 1,
      outcome: 'success',
      selectedBranchId: 'branch.pushed',
      actor: {
        finalValue: 17,
        attempts: [
          { tieRound: 1, rerollIndex: 0, finalValue: 5 },
          { tieRound: 1, rerollIndex: 1, finalValue: 15 },
          { tieRound: 2, rerollIndex: 0, finalValue: 3 },
          { tieRound: 2, rerollIndex: 1, finalValue: 17 },
        ],
      },
      target: {
        attempts: [
          { tieRound: 1, finalValue: 15 },
          { tieRound: 2, finalValue: 11 },
        ],
      },
    })
    expect(result.rollLedger).toHaveLength(6)
    expect(rollTrace(result)).toHaveLength(6)
  })

  it('evaluates a stat-backed save and DC expression with an explicit tie outcome', () => {
    const stream = createFiniteAuthoritativeMoveRandomStream([0])
    const result = executeMoveSpec({
      definition: definitionFor({
        kind: 'save',
        checkId: 'check.endure',
        roll: fixedRoll('roll.endure', {
          source: {
            kind: 'stat',
            stat: 'level',
            combatStagePolicy: 'ignore',
            stageModifierPolicy: 'ignore',
            formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
          },
        }),
        dc: {
          kind: 'arithmetic',
          operator: 'add',
          operands: [
            {
              kind: 'stat',
              subject: { kind: 'actor' },
              stat: 'level',
            },
            { kind: 'constant', value: 1 },
          ],
        },
        tie: { kind: 'success' },
        branches: { success: 'branch.saved', failure: 'branch.failed' },
      }),
      context: buildContext(stream),
    })

    expect(result.kind).toBe('complete')
    expect(result.resolvedChecks[0]).toMatchObject({
      kind: 'save',
      actor: null,
      target: {
        source: { kind: 'stat', stat: 'level', basisModifier: 20 },
        finalValue: 21,
      },
      dc: { value: 21 },
      outcome: 'success',
      selectedBranchId: 'branch.saved',
    })
    expect(result.resolvedChecks[0]?.dc?.evaluationTrace.at(-1)).toMatchObject({
      expressionKind: 'arithmetic',
      value: 21,
    })
    expect(result.rollLedger[0]?.modifiers).toEqual([{
      sourceId: 'check-basis',
      reason: 'check.stat.level',
      value: 20,
    }])
    expect(result.sheetReads).toEqual(expect.arrayContaining([
      { kind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'pokemon', slug: 'target', revision: 7 },
    ]))
  })

  it('selects the reviewed failure branch when a save is below its DC', () => {
    const result = executeMoveSpec({
      definition: definitionFor({
        kind: 'save',
        checkId: 'check.resist',
        roll: fixedRoll('roll.resist'),
        dc: { kind: 'constant', value: 15 },
        tie: { kind: 'failure' },
        branches: { success: 'branch.resisted', failure: 'branch.affected' },
      }),
      context: buildContext(createFiniteAuthoritativeMoveRandomStream([0])),
    })

    expect(result.kind).toBe('complete')
    expect(result.resolvedChecks).toMatchObject([{
      outcome: 'failure',
      status: 'resolved',
      selectedBranchId: 'branch.affected',
    }])
  })

  it('suspends before randomness when a human must choose the check stat', () => {
    const stream = createFiniteAuthoritativeMoveRandomStream([0.5])
    const result = executeMoveSpec({
      definition: definitionFor({
        kind: 'save',
        checkId: 'check.escape',
        roll: fixedRoll('roll.escape', {
          source: {
            kind: 'choice',
            requestId: 'request.escape-source',
            promptKey: 'move.check-test.choose-source',
            options: [{
              id: 'speed',
              labelKey: 'stat.speed',
              source: {
                kind: 'stat',
                stat: 'speed',
                combatStagePolicy: 'honor',
                stageModifierPolicy: 'honor',
                formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
              },
            }, {
              id: 'athletics',
              labelKey: 'skill.athletics',
              source: { kind: 'skill', skill: 'athletics' },
            }],
          },
        }),
        dc: { kind: 'constant', value: 15 },
        tie: { kind: 'failure' },
        branches: { success: 'branch.escaped', failure: 'branch.trapped' },
      }, true),
      context: buildContext(stream),
    })

    expect(result.kind).toBe('pending-request')
    if (result.kind !== 'pending-request') return
    expect(result.request).toEqual({
      kind: 'check-selection',
      operationId: 'operation.check',
      phase: 'hit',
      reasonCode: 'move.check-test.check',
      recipientIds: ['target-token'],
      requestId: 'request.escape-source',
      promptKey: 'move.check-test.choose-source',
      options: [
        { id: 'speed', labelKey: 'stat.speed' },
        { id: 'athletics', labelKey: 'skill.athletics' },
      ],
      allowPass: false,
      checkId: 'check.escape',
      role: 'target',
    })
    expect(result.operations.map(entry => entry.operation.id)).toEqual(['operation.check'])
    expect(result.rollLedger).toEqual([])
    expect(result.resolvedChecks).toEqual([])
    expect(stream.consumed).toBe(0)
    expect(stream.remaining).toBe(1)
    expect(operationTrace(result)).toMatchObject({ outcome: 'pending' })
    expect(result.trace.events).toContainEqual(expect.objectContaining({
      kind: 'choice',
      requestId: 'request.escape-source',
      requestKind: 'choice',
      outcome: 'requested',
    }))
  })

  it('records a provisional failure then returns a typed resource-spend reroll request', () => {
    const stream = createFiniteAuthoritativeMoveRandomStream([0, 0.9])
    const result = executeMoveSpec({
      definition: definitionFor({
        kind: 'save',
        checkId: 'check.recover',
        roll: fixedRoll('roll.recover', {
          resourceReroll: {
            requestId: 'request.recover-reroll',
            promptKey: 'move.check-test.spend-ap',
            resourceId: 'resource.action-point',
            amount: 1,
            trigger: 'on-failure',
            spendOption: { id: 'spend', labelKey: 'choice.spend-ap' },
            declineOption: { id: 'decline', labelKey: 'choice.keep-result' },
          },
        }),
        dc: { kind: 'constant', value: 15 },
        tie: { kind: 'failure' },
        branches: { success: 'branch.recovered', failure: 'branch.staggered' },
      }, true),
      context: buildContext(stream),
    })

    expect(result.kind).toBe('pending-request')
    if (result.kind !== 'pending-request') return
    expect(result.request).toEqual({
      kind: 'resource-spend',
      operationId: 'operation.check',
      phase: 'hit',
      reasonCode: 'move.check-test.check',
      recipientIds: ['target-token'],
      requestId: 'request.recover-reroll',
      promptKey: 'move.check-test.spend-ap',
      options: [
        { id: 'spend', labelKey: 'choice.spend-ap' },
        { id: 'decline', labelKey: 'choice.keep-result' },
      ],
      allowPass: false,
      checkId: 'check.recover',
      role: 'target',
      resourceId: 'resource.action-point',
      amount: 1,
      checkRecipientId: 'target-token',
    })
    expect(result.resolvedChecks).toMatchObject([{
      outcome: 'failure',
      status: 'provisional',
      selectedBranchId: null,
    }])
    expect(result.rollLedger).toHaveLength(1)
    expect(result.operations.map(entry => entry.operation.id)).toEqual(['operation.check'])
    expect(stream.consumed).toBe(1)
    expect(stream.remaining).toBe(1)
    expect(operationTrace(result)).toMatchObject({
      outcome: 'pending',
      result: {
        checks: [{ status: 'provisional', selectedBranchId: null }],
        request: {
          requestId: 'request.recover-reroll',
          requestKind: 'resource-spend',
        },
      },
    })
  })
})
