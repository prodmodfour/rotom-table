import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import type { MoveResolutionOperationTraceEvent } from '#shared/moveAutomation/trace'
import type { MoveSpec } from '#shared/moveAutomation/spec'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import {
  registeredMoveAutomationRuntimeFor,
  type MoveSpecV2Runtime,
} from '~~/server/domain/moveAutomation/registry'
import { resolveImmediateMoveSpec } from '~~/server/domain/moveAutomation/resolveImmediateSpec'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const TEST_ACCURACY_GATED_CONDITION_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Ember',
  version: 2,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [],
  costs: [],
  phases: [{
    phase: 'accuracy',
    operations: [{
      id: 'test.ember.accuracy',
      kind: 'roll',
      source: { kind: 'move', id: 'move.ember' },
      recipients: { kind: 'attacked-targets' },
      phase: 'accuracy',
      reasonCode: 'test.ember.accuracy',
      payload: {
        rollId: 'test.ember.accuracy-roll',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      },
    }],
  }, {
    phase: 'damage',
    operations: [{
      id: 'test.ember.damage',
      kind: 'damage',
      source: { kind: 'operation', id: 'test.ember.accuracy' },
      recipients: { kind: 'hit-targets' },
      phase: 'damage',
      reasonCode: 'test.ember.damage',
      payload: {
        damageClass: 'special',
        damageBase: 4,
        moveType: 'fire',
        accuracyRollId: 'test.ember.accuracy-roll',
        criticalRollId: null,
      },
    }],
  }, {
    phase: 'after-damage',
    operations: [{
      id: 'test.ember.burn',
      kind: 'condition',
      source: { kind: 'operation', id: 'test.ember.damage' },
      recipients: { kind: 'hit-targets' },
      phase: 'after-damage',
      reasonCode: 'test.ember.burn',
      payload: {
        action: 'apply',
        conditionId: 'burned',
        accuracyRollTrigger: {
          rollId: 'test.ember.accuracy-roll',
          trigger: { kind: 'range', minimum: 18 },
        },
      },
    }],
  }],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Ember threshold test',
    vfxKey: null,
    tags: ['condition', 'damage'],
  },
} as const satisfies MoveSpec)

const TEST_DEFINITION = validateMoveSpec(TEST_ACCURACY_GATED_CONDITION_SPEC)
const TEST_RUNTIME: MoveSpecV2Runtime = Object.freeze({
  canonicalId: TEST_DEFINITION.spec.canonicalId,
  kind: 'movespec-v2',
  version: TEST_DEFINITION.spec.version,
  definitionHash: TEST_DEFINITION.definitionHash,
  sourceModule: 'tests/server/moveAutomationSecondaryConditions.test.ts',
  definition: TEST_DEFINITION,
})

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'secondary-condition-arena',
  name: 'Secondary Condition Arena',
  revision: 4,
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  placements: [
    placement('actor-token', 'actor', 0),
    placement('target-token', 'target', 1),
  ],
  initiative: { activeId: 'actor-token', round: 1 },
})

const pokemonSheet = (options: {
  readonly slug: string
  readonly species: string
  readonly types: readonly string[]
  readonly moves?: readonly { readonly name: string }[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.species,
  species: options.species,
  types: [...options.types],
  level: 20,
  revision: 3,
  movelist: [...(options.moves ?? [])],
  combat: { currentHp: 100, conditions: [] },
})

const moveIntent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Ember',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

const resolveTestSpec = (options: {
  readonly randomValues: readonly number[]
  readonly targetTypes?: readonly string[]
}) => {
  const context = buildAuthoritativeMoveRulesContext({
    map: mapFixture(),
    pokemonSheets: new Map([
      ['actor', pokemonSheet({
        slug: 'actor',
        species: 'Charmander',
        types: ['Fire'],
        moves: [{ name: 'Ember' }],
      })],
      ['target', pokemonSheet({
        slug: 'target',
        species: 'Bulbasaur',
        types: options.targetTypes ?? ['Grass'],
      })],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: moveIntent(),
    candidatePlacementIds: ['target-token'],
    selectedPlacementIds: ['target-token'],
    random: createFiniteAuthoritativeMoveRandomStream(options.randomValues),
    time: 5_000,
  })
  const entry = context.queries.resolveActorMoveEntry('Ember')
  if (!entry.ok) throw new Error(entry.message)
  return resolveImmediateMoveSpec({
    context,
    runtime: TEST_RUNTIME,
    entry: entry.entry,
    authoritativeTargetIds: ['target-token'],
  })
}

const operationEvent = (
  resolution: ReturnType<typeof resolveTestSpec>,
  operationId: string,
): MoveResolutionOperationTraceEvent => {
  const event = resolution.trace.events.find((candidate): candidate is MoveResolutionOperationTraceEvent => (
    candidate.kind === 'operation' && candidate.operationId === operationId
  ))
  if (!event) throw new Error(`Missing operation trace ${operationId}`)
  return event
}

describe('native v2 accuracy-gated secondary conditions', () => {
  it('keeps canonical Ember selected on legacy v1 in the foundation ticket', () => {
    const row = manifestJson.moves.find(candidate => candidate.canonicalId === 'Ember')
    expect(row?.runtime).toMatchObject({
      kind: 'legacy-v1',
      sourceModule: 'src/utils/move-automation/scripts/singleTargetAttacks.ts',
    })
    expect(registeredMoveAutomationRuntimeFor('Ember')).toMatchObject({
      kind: 'legacy-v1',
    })
  })

  it.each([
    { label: 'passes', accuracyRandom: 0.85, naturalResult: 18, outcome: 'applied', conditions: ['Burned'] },
    { label: 'fails', accuracyRandom: 0.80, naturalResult: 17, outcome: 'no-op', conditions: [] },
  ] as const)(
    '$label the reviewed threshold from the existing accuracy roll without another draw',
    ({ accuracyRandom, naturalResult, outcome, conditions }) => {
      // Exactly one accuracy draw and the reviewed two damage dice are
      // available. Any condition reroll would fail the finite stream.
      const resolution = resolveTestSpec({ randomValues: [accuracyRandom, 0, 0] })

      expect(resolution.rollLedger.map(roll => ({
        rollId: roll.rollId,
        naturalResult: roll.naturalResult,
      }))).toEqual([
        { rollId: 'test.ember.accuracy-roll.1', naturalResult },
        { rollId: 'test.ember.damage.roll.1', naturalResult: 2 },
      ])
      expect(resolution.transaction.hpUpdates).toHaveLength(1)
      expect(resolution.transaction.conditionUpdates).toEqual(conditions.length === 0
        ? []
        : [{ id: 'target-token', conditions }])
      expect(resolution.native.coreStateChanges.groups.sheets[0]?.changes[0])
        .toMatchObject({
          kind: 'sheet-state',
          changedFields: outcome === 'applied' ? ['hp', 'conditions'] : ['hp'],
        })
      expect(operationEvent(resolution, 'test.ember.burn')).toMatchObject({
        recipientIds: ['target-token'],
        outcome,
        result: {
          recipients: [{
            outcome,
            details: {
              accuracyRollTrigger: {
                requestedRollId: 'test.ember.accuracy-roll',
                resolvedRollId: 'test.ember.accuracy-roll.1',
                naturalResult,
                matched: outcome === 'applied',
              },
            },
          }],
        },
      })
    },
  )

  it('does not evaluate or apply the trigger for a missed recipient', () => {
    const resolution = resolveTestSpec({ randomValues: [0] })

    expect(resolution.transaction.attackedTargetIds).toEqual(['target-token'])
    expect(resolution.transaction.hitTargetIds).toEqual([])
    expect(resolution.transaction.hpUpdates).toEqual([])
    expect(resolution.transaction.conditionUpdates).toEqual([])
    expect(resolution.native.coreStateChanges.changes).toEqual([])
    expect(resolution.rollLedger).toHaveLength(1)
    expect(operationEvent(resolution, 'test.ember.burn')).toMatchObject({
      recipientIds: [],
      outcome: 'no-op',
      result: { recipients: [] },
    })
  })

  it('traces authoritative condition immunity without undoing qualifying damage', () => {
    const resolution = resolveTestSpec({
      randomValues: [0.85, 0, 0],
      targetTypes: ['Fire'],
    })

    expect(resolution.transaction.hpUpdates).toHaveLength(1)
    expect(resolution.transaction.conditionUpdates).toEqual([])
    expect(resolution.native.coreStateChanges.groups.sheets[0]?.changes[0])
      .toMatchObject({ kind: 'sheet-state', changedFields: ['hp'] })
    expect(operationEvent(resolution, 'test.ember.damage').outcome).toBe('applied')
    expect(operationEvent(resolution, 'test.ember.burn')).toMatchObject({
      outcome: 'prevented',
      result: {
        recipients: [{
          outcome: 'prevented',
          reasonCode: 'condition-immunity',
          blockers: [{ subject: 'Burned', source: 'Fire type' }],
          details: {
            accuracyRollTrigger: {
              naturalResult: 18,
              matched: true,
            },
          },
        }],
      },
    })
  })
})
