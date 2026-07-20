import { afterEach, describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import {
  createEmptyEncounterState,
  type EncounterSideDirectory,
} from '#shared/moveAutomation/encounterState'
import {
  parseEncounterEffect,
  type EncounterEffect,
} from '#shared/moveAutomation/encounterEffects'
import { REFLECT_V2_SEMANTIC_SCENARIOS } from '../fixtures/moveAutomation/reflectV2'
import { strikeCanaryV2Fixture } from '../fixtures/moveAutomation/strikeCanariesV2'
import { planAuthoritativeMoveState } from '~~/server/domain/planAuthoritativeMoveState'
import { planSceneLifecycle } from '~~/server/domain/moveAutomation/planSceneLifecycle'
import { createFiniteAuthoritativeMoveRandomStream } from '~~/server/domain/moveAutomation/random'
import {
  REFLECT_ACTIVATIONS,
  createReflectSideEffect,
  isReflectSideEffect,
  parseReflectSideEffect,
  type ReflectSideEffect,
} from '~~/server/domain/moveAutomation/reflect'
import {
  SIDE_DAMAGE_RESISTANCE_REASON_CODES,
} from '~~/server/domain/moveAutomation/sideDamageResistance'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import { REFLECT_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/reflect'
import type { PersistedSheet } from '~~/server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  LivePlayIntegrationHarness,
  assertAccepted,
} from './livePlayIntegrationHarness'

const SIDES = Object.freeze({
  allies: { id: 'allies', label: 'Allies', status: 'active' },
  enemies: { id: 'enemies', label: 'Enemies', status: 'active' },
} as const satisfies EncounterSideDirectory)

const reflectRow = manifestJson.moves.find(row => row.canonicalId === 'Reflect')!
const harnesses: LivePlayIntegrationHarness[] = []
const gm = { role: 'gm' as const, clientId: 'gm-reflect-client' }

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
  sideId?: string,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 1 },
  ...(sideId === undefined ? {} : { sideId }),
})

const pokemonSheet = (options: {
  readonly slug: string
  readonly species: string
  readonly moves?: CharacterSheet['movelist']
  readonly types?: readonly string[]
  readonly currentHp?: number
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.species,
  species: options.species,
  types: [...(options.types ?? ['Normal'])],
  level: 20,
  revision: 3,
  movelist: [...(options.moves ?? [])],
  stats: {
    hp: { added: 500 },
    atk: { added: 10, stage: 0 },
    def: { added: 10, stage: 0 },
    satk: { added: 10, stage: 0 },
    sdef: { added: 10, stage: 0 },
    spd: { added: 10, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: options.currentHp ?? 500, conditions: [] },
})

interface ReflectFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
}

const reflectEffect = (): ReflectSideEffect => createReflectSideEffect({
  actor: { id: 'reflector-token', sideId: 'allies' },
  sides: SIDES,
  createdRound: 2,
  createdTurn: 0,
})

const reflectFixture = (options: {
  readonly attackerMove?: string
  readonly attackerSideId?: string
  readonly targetSideId?: string
  readonly targetTypes?: readonly string[]
  readonly effects?: readonly EncounterEffect[]
  readonly revision?: number
  readonly slug?: string
} = {}): ReflectFixture => ({
  map: {
    schemaVersion: 2,
    slug: options.slug ?? 'reflect-v2-arena',
    name: 'Reflect v2 Arena',
    revision: options.revision ?? 7,
    dimensions: { x: 8, y: 3, z: 5 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...createEmptyEncounterState(),
      sides: SIDES,
      effects: [...(options.effects ?? [])],
    },
    placements: [
      placement('reflector-token', 'reflector', 0, 'allies'),
      placement('attacker-token', 'attacker', 1, options.attackerSideId ?? 'enemies'),
      placement('target-token', 'target', 2, options.targetSideId),
    ],
    lights: [],
    initiative: { activeId: 'attacker-token', round: 2 },
    activeScene: { name: 'Reflect Scene', startedAt: 100 },
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  },
  pokemonSheets: new Map([
    ['reflector', pokemonSheet({
      slug: 'reflector',
      species: 'Mr. Mime',
      moves: [{ name: 'Reflect' }],
    })],
    ['attacker', pokemonSheet({
      slug: 'attacker',
      species: 'Staraptor',
      moves: [{ name: options.attackerMove ?? 'Aerial Ace' }],
    })],
    ['target', pokemonSheet({
      slug: 'target',
      species: 'Snorlax',
      types: options.targetTypes,
    })],
  ]),
  trainerSheets: new Map<string, TrainerSheet>(),
})

const deterministicRandomSource = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? 0
}

const planDamage = (options: {
  readonly moveName: string
  readonly randomValues: readonly number[]
  readonly targetSideId?: string
  readonly targetTypes?: readonly string[]
  readonly effect?: ReflectSideEffect
  readonly additionalEffects?: readonly EncounterEffect[]
  readonly attackerSideId?: string
  readonly operationId: string
}) => {
  const fixture = reflectFixture({
    attackerMove: options.moveName,
    attackerSideId: options.attackerSideId,
    targetSideId: options.targetSideId,
    targetTypes: options.targetTypes,
    effects: [
      ...(options.additionalEffects ?? []),
      ...(options.effect ? [options.effect] : []),
    ],
  })
  const intent: ResolveMoveIntent = {
    schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
    placementId: 'attacker-token',
    moveName: options.moveName,
    selection: { kind: 'single-target', targetPlacementId: 'target-token' },
  }
  return planAuthoritativeMoveState({
    ...fixture,
    intent,
    random: deterministicRandomSource(options.randomValues),
    now: () => 5_000,
    operationId: options.operationId,
  })
}

const targetCurrentHp = (
  plan: ReturnType<typeof planAuthoritativeMoveState>,
): number => plan.resolution.transaction.hpUpdates.find(
  update => update.id === 'target-token',
)?.currentHp ?? 500

const persistedSheets = (
  sheets: ReadonlyMap<string, CharacterSheet>,
): readonly PersistedSheet[] => [...sheets].map(([slug, sheet]) => ({
  kind: 'pokemon' as const,
  slug,
  revision: 0,
  updatedAt: 1_700_000_000_000,
  sheet: {
    ...sheet,
    slug,
    revision: 0,
    updatedAt: 1_700_000_000_000,
  },
}))

const reflectCastIntent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'reflector-token',
  moveName: 'Reflect',
  selection: { kind: 'self' },
})

const attackIntent = (moveName = 'Aerial Ace'): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'attacker-token',
  moveName,
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.dispose()
})

describe('Reflect authoritative side mitigation', () => {
  it('selects the complete reviewed runtime and links its conformance evidence', () => {
    expect(reflectRow).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: 'ace2799926aef7982024cc4730ce4564b1d10c71e4b7b435abe766102da30caa',
        sourceModule: 'server/domain/moveAutomation/specs/reflect.ts',
      },
      capabilityTags: [
        'lifecycle.effects',
        'reactions.durable',
        'targeting.authoritative',
      ],
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(reflectRow.scenarioIds).toEqual(
      REFLECT_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(reflectRow.conformanceEvidence.scenarios).toEqual(
      REFLECT_V2_SEMANTIC_SCENARIOS,
    )
    expect(registeredMoveAutomationRuntimeFor('Reflect')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: REFLECT_MOVE_SPEC },
      definitionHash: reflectRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Reflect' }),
    )
  })

  it('creates the owned side effect through native v2 without a sheet marker or operator note', () => {
    const fixture = reflectFixture()
    const plan = planAuthoritativeMoveState({
      ...fixture,
      map: {
        ...fixture.map,
        initiative: { activeId: 'reflector-token', round: 2 },
      },
      intent: reflectCastIntent(),
      random: createFiniteAuthoritativeMoveRandomStream([]),
      now: () => 5_000,
      operationId: 'op_reflect_side_application',
    })
    const effect = plan.nextMap.encounterState?.effects.find(isReflectSideEffect)

    expect(plan.resolution.auditTrace.program.runtimeKind).toBe('movespec-v2')
    expect(plan.resolution.transaction.conditionUpdates).toEqual([])
    expect(plan.resolution.transaction.logLines.join(' ')).not.toMatch(/marker|manual|track/i)
    expect(effect).toMatchObject({
      affected: { placementIds: [], sideIds: ['allies'], cells: [] },
      charges: REFLECT_ACTIVATIONS,
      payload: { damageClass: 'physical', operation: 'resist-step', value: 1 },
    })
    expect(plan.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'reflect.apply-side-blessing',
      outcome: 'applied',
    }))
  })

  it('mitigates each native physical strike, consumes both charges, and traces both decisions', () => {
    const fixture = strikeCanaryV2Fixture('double-kick.v2-critical-double-hit')
    const mapWithSides: TabletopMap = {
      ...fixture.map,
      placements: fixture.map.placements.map(candidate => ({
        ...candidate,
        sideId: candidate.id === 'target-token' ? 'allies' : 'enemies',
      })),
      encounterState: {
        ...createEmptyEncounterState(),
        sides: SIDES,
        effects: [createReflectSideEffect({
          actor: { id: 'target-token', sideId: 'allies' },
          sides: SIDES,
          createdRound: 3,
          createdTurn: 0,
        })],
      },
    }
    const aided = planAuthoritativeMoveState({
      ...fixture,
      map: mapWithSides,
      random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
      now: () => 5_000,
      operationId: 'op_reflect_native_double_kick',
    })
    const baseline = planAuthoritativeMoveState({
      ...fixture,
      map: {
        ...mapWithSides,
        encounterState: { ...mapWithSides.encounterState!, effects: [] },
      },
      random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
      now: () => 5_000,
      operationId: 'op_reflect_native_baseline',
    })
    const activations = aided.resolution.sideDamageResistance?.activations ?? []

    expect(targetCurrentHp(aided)).toBeGreaterThan(targetCurrentHp(baseline))
    expect(activations).toHaveLength(2)
    expect(activations.map(item => item.damageOperationId)).toEqual([
      'double-kick.multi-hit.t1.h1.damage',
      'double-kick.multi-hit.t1.h2.damage',
    ])
    expect(activations.map(item => [item.previousMultiplier, item.adjustedMultiplier])).toEqual([
      [1.5, 1],
      [1.5, 1],
    ])
    expect(activations.map(item => [item.chargeBefore, item.chargeAfter])).toEqual([
      [2, 1],
      [1, 0],
    ])
    expect(aided.nextMap.encounterState?.effects.some(isReflectSideEffect)).toBe(false)
    expect(aided.resolution.auditTrace.events.filter(event => (
      event.kind === 'predicate'
      && event.reasonCode === SIDE_DAMAGE_RESISTANCE_REASON_CODES.activated
    ))).toHaveLength(2)
    expect(aided.resolution.auditTrace.events.filter(event => (
      event.kind === 'predicate'
      && event.reasonCode === SIDE_DAMAGE_RESISTANCE_REASON_CODES.chargeConsumed
    ))).toHaveLength(2)
    expect(JSON.stringify(aided.resolution.auditTrace.events)).toContain(
      '"sideDamageResistance":{"damageOperationId":"double-kick.multi-hit.t1.h1.damage"',
    )
  })

  it('mitigates one retired move’s native physical hit and leaves one shared charge', () => {
    const active = reflectEffect()
    const aided = planDamage({
      moveName: 'Aerial Ace',
      randomValues: [0, 0],
      targetSideId: 'allies',
      targetTypes: ['Normal'],
      effect: active,
      operationId: 'op_reflect_legacy_physical',
    })
    const baseline = planDamage({
      moveName: 'Aerial Ace',
      randomValues: [0, 0],
      targetSideId: 'allies',
      targetTypes: ['Normal'],
      operationId: 'op_reflect_legacy_baseline',
    })

    expect(aided.resolution.auditTrace.program.runtimeKind).toBe('movespec-v2')
    expect(targetCurrentHp(aided)).toBeGreaterThan(targetCurrentHp(baseline))
    expect(aided.resolution.sideDamageResistance?.activations).toEqual([
      expect.objectContaining({
        damageOperationId: 'aerial-ace.damage',
        targetSideId: 'allies',
        previousMultiplier: 1,
        adjustedMultiplier: 0.5,
        chargeBefore: 2,
        chargeAfter: 1,
      }),
    ])
    expect(aided.nextMap.encounterState?.effects.find(isReflectSideEffect)?.charges).toBe(1)
  })

  it('retains charges for special, immune, enemy, unknown-side, and suppressed recipients', () => {
    const active = reflectEffect()
    const suppressionSource = parseEncounterEffect({
      id: 'effect.reflect-suppression',
      kind: 'capability',
      source: {
        operationId: 'reflect.test-suppression',
        moveId: 'move.test-suppression',
        placementId: 'reflector-token',
      },
      affected: { placementIds: ['reflector-token'], sideIds: [], cells: [] },
      createdRound: 2,
      createdTurn: 0,
      duration: { kind: 'scene', remaining: null },
      stacks: 1,
      charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['suppression'],
      payload: { capabilityId: 'reflect-suppression', action: 'grant' },
      dispel: { policy: 'none', tags: [] },
      transferPolicy: 'retain',
      suppression: { sources: [] },
    })
    const suppressed = parseReflectSideEffect({
      ...active,
      suppression: {
        sources: [{
          effectId: suppressionSource.id,
          reasonCode: 'reflect.test-suppression',
        }],
      },
    })
    const cases = [
      {
        label: 'special',
        moveName: 'Aura Sphere',
        randomValues: [0, 0],
        targetSideId: 'allies',
        targetTypes: ['Normal'],
        effect: active,
        reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.classMismatch,
      },
      {
        label: 'immune',
        moveName: 'Pound',
        randomValues: [0.8, 0],
        targetSideId: 'allies',
        targetTypes: ['Ghost'],
        effect: active,
        reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.immune,
      },
      {
        label: 'enemy',
        moveName: 'Aerial Ace',
        randomValues: [0, 0],
        attackerSideId: 'allies',
        targetSideId: 'enemies',
        targetTypes: ['Normal'],
        effect: active,
        reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.unavailable,
      },
      {
        label: 'unknown-side',
        moveName: 'Aerial Ace',
        randomValues: [0, 0],
        targetSideId: undefined,
        targetTypes: ['Normal'],
        effect: active,
        reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.unknownSide,
      },
      {
        label: 'suppressed',
        moveName: 'Aerial Ace',
        randomValues: [0, 0],
        targetSideId: 'allies',
        targetTypes: ['Normal'],
        effect: suppressed,
        additionalEffects: [suppressionSource],
        reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.suppressed,
      },
    ] as const

    for (const scenario of cases) {
      const aided = planDamage({
        ...scenario,
        operationId: `op_reflect_skipped_${scenario.label}`,
      })
      const baseline = planDamage({
        moveName: scenario.moveName,
        randomValues: scenario.randomValues,
        attackerSideId: 'attackerSideId' in scenario
          ? scenario.attackerSideId
          : undefined,
        targetSideId: scenario.targetSideId,
        targetTypes: scenario.targetTypes,
        operationId: `op_reflect_baseline_${scenario.label}`,
      })
      const evaluation = aided.resolution.sideDamageResistance?.evaluations[0]

      expect(evaluation, scenario.label).toMatchObject({
        status: 'not-applicable',
        reasonCode: scenario.reasonCode,
        resistanceSteps: 0,
        chargeBefore: scenario.label === 'enemy' || scenario.label === 'unknown-side'
          ? null
          : REFLECT_ACTIVATIONS,
        chargeAfter: scenario.label === 'enemy' || scenario.label === 'unknown-side'
          ? null
          : REFLECT_ACTIVATIONS,
      })
      expect(targetCurrentHp(aided), scenario.label).toBe(targetCurrentHp(baseline))
      expect(aided.nextMap.encounterState?.effects.find(isReflectSideEffect)?.charges).toBe(
        REFLECT_ACTIVATIONS,
      )
      expect(aided.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
        kind: 'predicate',
        outcome: false,
        reasonCode: scenario.reasonCode,
      }))
    }
  })

  it('expires the unused side effect at the authoritative scene boundary', () => {
    const fixture = reflectFixture({
      targetSideId: 'allies',
      effects: [reflectEffect()],
    })
    const scene = fixture.map.activeScene!
    const plan = planSceneLifecycle({
      map: fixture.map,
      previous: scene,
      current: null,
      operationId: 'op_reflect_scene_end',
      time: 5_000,
      loadSheets: () => ({
        pokemonSheets: fixture.pokemonSheets,
        trainerSheets: fixture.trainerSheets,
      }),
    })

    expect(plan.events.map(event => event.kind)).toEqual(['scene-end'])
    expect(plan.currentEncounterState.effects.some(isReflectSideEffect)).toBe(false)
    expect(plan.nextMap.encounterState?.effects.some(isReflectSideEffect)).toBe(false)
  })

  it('persists creation and one activation once across reconnect and duplicate delivery', async () => {
    const fixture = reflectFixture({
      targetSideId: 'allies',
      revision: 0,
      slug: 'integration-arena',
    })
    const map: TabletopMap = {
      ...fixture.map,
      revision: 0,
      updatedAt: 1_700_000_000_000,
      initiative: { activeId: 'reflector-token', round: 2 },
    }
    const harness = LivePlayIntegrationHarness.create({
      map,
      sheets: persistedSheets(fixture.pokemonSheets),
    })
    harnesses.push(harness)
    const client = await harness.loadClient('reflect-reconnect-client')

    const reflectCommand = harness.resolveMoveCommand({
      opId: 'op_reflect_duplicate_cast',
      baseRevision: 0,
      intent: reflectCastIntent(),
      candidateScopePlacementIds: [],
    })
    const firstReflect = await harness.resolveMove({ actor: gm, command: reflectCommand })
    const duplicateReflect = await harness.resolveMove({ actor: gm, command: reflectCommand })

    expect(assertAccepted(firstReflect.result)).toMatchObject({ previousRevision: 0, revision: 1 })
    expect(duplicateReflect.result).toEqual(firstReflect.result)
    expect(firstReflect.move).toBeDefined()
    expect(firstReflect.move).not.toHaveProperty('sideDamageResistance')
    expect(firstReflect.move!.transaction.conditionUpdates).toEqual([])
    expect((await harness.readMap())?.encounterState?.effects.find(isReflectSideEffect)?.charges).toBe(2)
    expect(harness.operationRecordCount()).toBe(1)

    client.disconnect()
    const attackCommand = harness.resolveMoveCommand({
      opId: 'op_reflect_duplicate_activation',
      baseRevision: 1,
      intent: attackIntent(),
      candidateScopePlacementIds: ['target-token'],
    })
    const firstAttack = await harness.resolveMove({ actor: gm, command: attackCommand })
    const duplicateAttack = await harness.resolveMove({ actor: gm, command: attackCommand })

    expect(assertAccepted(firstAttack.result)).toMatchObject({ previousRevision: 1, revision: 2 })
    expect(duplicateAttack.result).toEqual(firstAttack.result)
    expect(firstAttack.move?.trace).toBeDefined()
    expect(firstAttack.move).not.toHaveProperty('sideDamageResistance')
    expect(firstAttack.move!.trace!.events).toContainEqual(expect.objectContaining({
      kind: 'predicate',
      reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.activated,
      outcome: true,
    }))
    expect(firstAttack.move!.trace!.events).toContainEqual(expect.objectContaining({
      kind: 'predicate',
      reasonCode: SIDE_DAMAGE_RESISTANCE_REASON_CODES.chargeConsumed,
      outcome: true,
    }))
    expect((await harness.readMap())?.encounterState?.effects.find(isReflectSideEffect)?.charges).toBe(1)
    expect(harness.operationRecordCount()).toBe(2)

    await client.reconnect()
    expect(client.map?.encounterState?.effects.find(isReflectSideEffect)?.charges).toBe(1)
  })
})
