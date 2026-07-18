import { afterEach, describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  SAND_TOMB_V2_SEMANTIC_SCENARIOS,
  allSandTombV2SemanticScenarios,
  sandTombV2SemanticScenario,
} from '../fixtures/moveAutomation/sandTombV2'
import { runAndAssertMoveAutomationSemanticScenario } from '../fixtures/moveAutomation/scenario'
import { planAuthoritativeMoveState } from '~~/server/domain/planAuthoritativeMoveState'
import { planInitiativeLifecycle } from '~~/server/domain/moveAutomation/planInitiativeLifecycle'
import { planSceneLifecycle } from '~~/server/domain/moveAutomation/planSceneLifecycle'
import { planAuthoritativeMoveSwitch } from '~~/server/domain/moveAutomation/planMoveSwitch'
import { createFiniteAuthoritativeMoveRandomStream } from '~~/server/domain/moveAutomation/random'
import {
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
  registeredMoveAutomationRuntimeFor,
} from '~~/server/domain/moveAutomation/registry'
import { SAND_TOMB_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/sandTomb'
import {
  VORTEX_REASON_CODES,
  isSandTombVortexEffect,
  isVortexEffect,
} from '~~/server/domain/moveAutomation/vortex'
import type { PersistedSheet } from '~~/server/storage/sheetRepository'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import { projectEffectiveConditions } from '~/utils/encounterConditions'
import {
  LivePlayIntegrationHarness,
  assertAccepted,
} from './livePlayIntegrationHarness'

const row = manifestJson.moves.find(entry => entry.canonicalId === 'Sand Tomb')!
const harnesses: LivePlayIntegrationHarness[] = []
const gm = { role: 'gm' as const, clientId: 'gm-sand-tomb-client' }

const semanticFixture = () => sandTombV2SemanticScenario('sand-tomb.v2-hit')

const cloneSheetMap = <Sheet extends CharacterSheet | TrainerSheet>(
  values: ReadonlyMap<string, Sheet>,
): Map<string, Sheet> => new Map([...values].map(([slug, sheet]) => [
  slug,
  structuredClone(sheet),
]))

const persistedSheets = (
  pokemon: ReadonlyMap<string, CharacterSheet>,
  trainer: ReadonlyMap<string, TrainerSheet> = new Map(),
): readonly PersistedSheet[] => [
  ...[...pokemon].map(([slug, sheet]) => ({
    kind: 'pokemon' as const,
    slug,
    revision: sheet.revision ?? 0,
    updatedAt: 1_700_000_000_000,
    sheet: {
      ...structuredClone(sheet),
      slug,
      updatedAt: 1_700_000_000_000,
    },
  })),
  ...[...trainer].map(([slug, sheet]) => ({
    kind: 'trainer' as const,
    slug,
    revision: sheet.revision ?? 0,
    updatedAt: 1_700_000_000_000,
    sheet: {
      ...structuredClone(sheet),
      slug,
      updatedAt: 1_700_000_000_000,
    },
  })),
]

const planSandTomb = (options: {
  readonly map?: TabletopMap
  readonly pokemonSheets?: ReadonlyMap<string, CharacterSheet>
  readonly randomValues?: readonly number[]
  readonly operationId?: string
} = {}) => {
  const scenario = semanticFixture()
  return planAuthoritativeMoveState({
    map: structuredClone(options.map ?? scenario.initialState.map),
    pokemonSheets: cloneSheetMap(options.pokemonSheets ?? scenario.initialState.pokemonSheets),
    trainerSheets: cloneSheetMap(scenario.initialState.trainerSheets),
    intent: structuredClone(scenario.intent),
    random: createFiniteAuthoritativeMoveRandomStream(options.randomValues ?? [0.45, 0, 0]),
    now: () => 5_000,
    operationId: options.operationId ?? 'op_sandtomb_plan',
  })
}

const nextSheetMaps = (
  plan: ReturnType<typeof planSandTomb>,
  fallback: ReadonlyMap<string, CharacterSheet>,
): ReadonlyMap<string, CharacterSheet> => {
  const sheets = cloneSheetMap(fallback)
  for (const write of plan.sheetWrites) {
    if (write.kind === 'pokemon') sheets.set(write.slug, write.nextSheet as CharacterSheet)
  }
  return sheets
}

const trainerPlacement = (): SheetPlacement => ({
  id: 'trainer-token',
  sheetKind: 'trainer',
  sheetSlug: 'trainer',
  position: { x: 0, y: 0, z: 0 },
})

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()?.dispose()
})

describe('Sand Tomb shared Vortex automation', () => {
  it('selects the complete reviewed runtime and links all semantic evidence', () => {
    expect(row).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: '46adb7117166314526e679ab9f8994063a09db12df3d6499a440ccb40348629f',
        sourceModule: 'server/domain/moveAutomation/specs/sandTomb.ts',
      },
      capabilityTags: ['hp.typed', 'lifecycle.effects', 'targeting.authoritative'],
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(row.scenarioIds).toEqual(
      SAND_TOMB_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId).sort(),
    )
    expect(row.conformanceEvidence.scenarios).toEqual(
      [...SAND_TOMB_V2_SEMANTIC_SCENARIOS].sort((left, right) => (
        left.scenarioId.localeCompare(right.scenarioId)
      )),
    )
    expect(registeredMoveAutomationRuntimeFor('Sand Tomb')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: SAND_TOMB_MOVE_SPEC },
      definitionHash: row.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Sand Tomb' }),
    )
  })

  it.each(allSandTombV2SemanticScenarios())(
    'proves $scenarioId through interpreter, planner, and accepted command',
    async (scenario) => {
      const result = await runAndAssertMoveAutomationSemanticScenario(scenario)
      expect([
        result.interpreter.status,
        result.plan.status,
        result.command.status,
      ]).toEqual(['completed', 'completed', 'completed'])
    },
  )

  it('applies one target-local Vortex and exposes Slowed and Trapped without sheet markers', () => {
    const scenario = semanticFixture()
    const plan = planSandTomb()
    const effect = plan.nextMap.encounterState?.effects.find(isSandTombVortexEffect)

    expect(effect).toMatchObject({
      source: {
        operationId: 'sand-tomb.vortex',
        moveId: 'move.sand-tomb',
        placementId: 'actor-token',
      },
      affected: { placementIds: ['target-token'] },
      charges: 4,
      payload: { sourceType: 'ground', escapeDcs: [20, 14, 8, 2] },
    })
    expect(plan.resolution.transaction.conditionUpdates).toEqual([])
    expect(projectEffectiveConditions({
      sheetConditions: [],
      encounterEffects: plan.nextMap.encounterState?.effects,
      target: { placementId: 'target-token' },
    }).conditions).toEqual(['Slowed', 'Trapped'])
    expect(scenario.initialState.map.encounterState).toBeUndefined()
  })

  it('does not create a Vortex on miss, Ghost trapping immunity, or immediate knockout', () => {
    const miss = sandTombV2SemanticScenario('sand-tomb.v2-miss')
    const missed = planAuthoritativeMoveState({
      map: structuredClone(miss.initialState.map),
      pokemonSheets: cloneSheetMap(miss.initialState.pokemonSheets),
      trainerSheets: cloneSheetMap(miss.initialState.trainerSheets),
      intent: structuredClone(miss.intent),
      random: createFiniteAuthoritativeMoveRandomStream(miss.seed.randomValues),
      now: () => 5_000,
      operationId: 'op_sandtomb_miss_cleanup',
    })
    const immune = sandTombV2SemanticScenario('sand-tomb.v2-immunity')
    const ghost = planAuthoritativeMoveState({
      map: structuredClone(immune.initialState.map),
      pokemonSheets: cloneSheetMap(immune.initialState.pokemonSheets),
      trainerSheets: cloneSheetMap(immune.initialState.trainerSheets),
      intent: structuredClone(immune.intent),
      random: createFiniteAuthoritativeMoveRandomStream(immune.seed.randomValues),
      now: () => 5_000,
      operationId: 'op_sandtomb_ghost_cleanup',
    })
    const base = semanticFixture()
    const lowHpSheets = cloneSheetMap(base.initialState.pokemonSheets)
    const target = lowHpSheets.get('target')!
    lowHpSheets.set('target', { ...target, combat: { ...target.combat, currentHp: 1 } })
    const knockout = planSandTomb({
      pokemonSheets: lowHpSheets,
      operationId: 'op_sandtomb_knockout_cleanup',
    })

    expect(missed.nextMap.encounterState?.effects.some(isVortexEffect) ?? false).toBe(false)
    expect(ghost.nextMap.encounterState?.effects.some(isVortexEffect) ?? false).toBe(false)
    expect(ghost.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'sand-tomb.vortex',
      outcome: 'no-op',
      result: expect.objectContaining({
        details: expect.objectContaining({ blockedBy: 'Ghost type' }),
      }),
    }))
    expect(knockout.resolution.transaction.hpUpdates.find(
      update => update.id === 'target-token',
    )?.currentHp).toBeLessThanOrEqual(0)
    expect(knockout.nextMap.encounterState?.effects.some(isVortexEffect) ?? false).toBe(false)
  })

  it('ticks HP, records the escape roll, and removes the effect at target turn end', () => {
    const scenario = semanticFixture()
    const movePlan = planSandTomb()
    const sheets = nextSheetMaps(movePlan, scenario.initialState.pokemonSheets)
    const targetBefore = sheets.get('target')!
    const map: TabletopMap = {
      ...movePlan.nextMap,
      initiative: { activeId: 'target-token', round: 1 },
    }
    const lifecycle = planInitiativeLifecycle({
      map,
      previous: { activeId: 'target-token', round: 1 },
      current: { activeId: 'actor-token', round: 2 },
      orderIds: ['actor-token', 'target-token'],
      operationId: 'op_sandtomb_escape_success',
      time: 6_000,
      random: createFiniteAuthoritativeMoveRandomStream([0.999]),
      loadSheets: () => ({
        pokemonSheets: sheets,
        trainerSheets: new Map(),
      }),
    })
    const targetWrite = lifecycle.sheetWrites.find(write => write.slug === 'target')!
    const previousHp = pokemonHpSnapshot(targetBefore).currentHp
    const currentHp = pokemonHpSnapshot(targetWrite.nextSheet as CharacterSheet).currentHp
    const tick = Math.floor(pokemonHpSnapshot(targetBefore).fullMaxHp * 0.1)

    expect(previousHp - currentHp).toBe(tick)
    expect(lifecycle.currentEncounterState.effects.some(isVortexEffect)).toBe(false)
    expect(lifecycle.rollLedger).toEqual([
      expect.objectContaining({
        naturalResult: 20,
        reason: 'Vortex escape check DC 20',
      }),
    ])
    expect(lifecycle.reduction.operations).toEqual([
      expect.objectContaining({ reasonCode: VORTEX_REASON_CODES.tick }),
    ])
  })

  it('cleans a Vortex after its own Tick knocks out the target', () => {
    const scenario = semanticFixture()
    const movePlan = planSandTomb()
    const sheets = nextSheetMaps(movePlan, scenario.initialState.pokemonSheets)
    const target = sheets.get('target')!
    const lowHpSheets = new Map(sheets)
    lowHpSheets.set('target', {
      ...target,
      combat: { ...target.combat, currentHp: 1 },
    })
    const lifecycle = planInitiativeLifecycle({
      map: {
        ...movePlan.nextMap,
        initiative: { activeId: 'target-token', round: 1 },
      },
      previous: { activeId: 'target-token', round: 1 },
      current: { activeId: 'actor-token', round: 2 },
      orderIds: ['actor-token', 'target-token'],
      operationId: 'op_sandtomb_tick_knockout',
      time: 6_000,
      random: createFiniteAuthoritativeMoveRandomStream([0]),
      loadSheets: () => ({ pokemonSheets: lowHpSheets, trainerSheets: new Map() }),
    })

    expect(lifecycle.sheetWrites.find(write => write.slug === 'target')).toMatchObject({
      nextSheet: { combat: { currentHp: expect.any(Number) } },
    })
    expect(lifecycle.currentEncounterState.effects.some(isVortexEffect)).toBe(false)
    expect(lifecycle.reductions).toHaveLength(2)
    expect(lifecycle.events.at(-1)).toMatchObject({
      kind: 'effect-removed',
      reasonCode: VORTEX_REASON_CODES.targetKnockedOut,
    })
  })

  it('honors Magic Guard for Tick HP loss without skipping the escape attempt', () => {
    const scenario = semanticFixture()
    const movePlan = planSandTomb()
    const sheets = nextSheetMaps(movePlan, scenario.initialState.pokemonSheets)
    const target = sheets.get('target')!
    const guardedSheets = new Map(sheets)
    guardedSheets.set('target', {
      ...target,
      abilities: [{ name: 'Magic Guard' }],
    })
    const lifecycle = planInitiativeLifecycle({
      map: {
        ...movePlan.nextMap,
        initiative: { activeId: 'target-token', round: 1 },
      },
      previous: { activeId: 'target-token', round: 1 },
      current: { activeId: 'actor-token', round: 2 },
      orderIds: ['actor-token', 'target-token'],
      operationId: 'op_sandtomb_magic_guard',
      time: 6_000,
      random: createFiniteAuthoritativeMoveRandomStream([0]),
      loadSheets: () => ({ pokemonSheets: guardedSheets, trainerSheets: new Map() }),
    })

    expect(lifecycle.rollLedger).toHaveLength(1)
    expect(lifecycle.sheetWrites).toEqual([])
    expect(lifecycle.currentEncounterState.effects.find(isVortexEffect)?.charges).toBe(3)
  })

  it('removes Vortex state when the affected target switches or the scene ends', () => {
    const plan = planSandTomb()
    const effect = plan.nextMap.encounterState!.effects.find(isVortexEffect)!
    const target = plan.nextMap.placements.find(entry => entry.id === 'target-token')!
    const replacement: SheetPlacement = {
      ...target,
      id: 'replacement-token',
      sheetSlug: 'replacement',
    }
    const switchMap: TabletopMap = {
      ...plan.nextMap,
      placements: [...plan.nextMap.placements, trainerPlacement()],
    }
    const switched = planAuthoritativeMoveSwitch({
      map: switchMap,
      transition: {
        kind: 'recall-and-send-out',
        operationId: 'operation.sand-tomb-target-switch',
        recalledPlacementId: target.id,
        sentOutPlacement: replacement,
        trainerPlacementId: 'trainer-token',
        trainerSheetSlug: 'trainer',
        positionPolicy: 'recalled-position',
        initiativePolicy: 'inherit-slot',
        stateTransferPolicy: 'none',
      },
    })
    const scene = plan.nextMap.activeScene!
    const ended = planSceneLifecycle({
      map: plan.nextMap,
      previous: scene,
      current: null,
      operationId: 'op_sandtomb_scene_cleanup',
      time: 6_000,
      loadSheets: () => ({ pokemonSheets: new Map(), trainerSheets: new Map() }),
    })

    expect(switched.nextMap.encounterState?.effects.some(isVortexEffect)).toBe(false)
    expect(switched.cleanupEventIds).toHaveLength(1)
    expect(ended.currentEncounterState.effects.some(isVortexEffect)).toBe(false)
    expect(effect).toBeDefined()
  })

  it('persists one application and one lifecycle terminal across reconnect and duplicate delivery', async () => {
    const scenario = semanticFixture()
    const values = [0.45, 0, 0, 0.999]
    let draw = 0
    const map: TabletopMap = {
      ...structuredClone(scenario.initialState.map),
      slug: 'integration-arena',
      revision: 0,
      updatedAt: 1_700_000_000_000,
    }
    const harness = LivePlayIntegrationHarness.create({
      map,
      sheets: persistedSheets(scenario.initialState.pokemonSheets),
      random: () => values[draw++] ?? 0.999,
    })
    harnesses.push(harness)
    const remote = await harness.loadClient('sand-tomb-reconnect-client')
    const resolveCommand = harness.resolveMoveCommand({
      opId: 'op_sandtomb_duplicate_resolve',
      baseRevision: 0,
      intent: scenario.intent,
      candidateScopePlacementIds: ['target-token'],
    })
    const resolved = await harness.resolveMove({ actor: gm, command: resolveCommand })
    const duplicateResolved = await harness.resolveMove({ actor: gm, command: resolveCommand })

    expect(assertAccepted(resolved.result)).toMatchObject({ previousRevision: 0, revision: 1 })
    expect(duplicateResolved.result).toEqual(resolved.result)
    expect((await harness.readMap())?.encounterState?.effects.some(isVortexEffect)).toBe(true)
    expect(remote.map?.encounterState?.effects.some(isVortexEffect)).toBe(true)

    const toTarget = await harness.nextInitiative({
      actor: gm,
      command: harness.nextInitiativeCommand({
        opId: 'op_sandtomb_to_target',
        baseRevision: 1,
        orderIds: ['actor-token', 'target-token'],
        activeId: 'actor-token',
        round: 1,
      }),
    })
    assertAccepted(toTarget.result)
    remote.disconnect()
    const terminalCommand = harness.nextInitiativeCommand({
      opId: 'op_sandtomb_escape_terminal',
      baseRevision: 2,
      orderIds: ['actor-token', 'target-token'],
      activeId: 'target-token',
      round: 1,
    })
    const terminal = await harness.nextInitiative({ actor: gm, command: terminalCommand })
    const duplicateTerminal = await harness.nextInitiative({ actor: gm, command: terminalCommand })
    const accepted = assertAccepted(terminal.result)
    const lifecycle = accepted.patches.find(patch => patch.type === 'map.initiative')?.payload as {
      lifecycle?: { rollLedger?: readonly { naturalResult: number }[] }
    } | undefined

    expect(duplicateTerminal.result).toEqual(terminal.result)
    expect(lifecycle?.lifecycle?.rollLedger).toEqual([
      expect.objectContaining({ naturalResult: 20 }),
    ])
    expect((await harness.readMap())?.encounterState?.effects.some(isVortexEffect)).toBe(false)
    expect(harness.operationRecordCount()).toBe(3)
    await remote.reconnect()
    expect(remote.map?.encounterState?.effects.some(isVortexEffect)).toBe(false)
  })
})
