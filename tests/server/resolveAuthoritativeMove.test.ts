import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION, type ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import {
  AuthoritativeMoveResolutionError,
  deduplicateAuthoritativeMoveSheetReads,
  resolveAuthoritativeMove,
} from '../../server/domain/resolveAuthoritativeMove'
import {
  AuthoritativeMoveRandomError,
  createFiniteAuthoritativeMoveRandomStream,
} from '../../server/domain/moveAutomation/random'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '~/utils/moveAutomation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import { redBlueEncounterStateFixture } from '../fixtures/moveAutomation/encounterSides'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationAreaTemplate, MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'

const moveIntent = (overrides: Omit<ResolveMoveIntent, 'schemaVersion'>): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  ...overrides,
})

const placement = (
  id: string,
  sheetSlug = id,
  position = { x: 0, y: 0, z: 0 },
  sideId?: string,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position,
  ...(sideId ? { sideId } : {}),
})

const mapFixture = (placements: SheetPlacement[] = [
  placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }),
  placement('target-a', 'target-a', { x: 1, y: 0, z: 0 }),
  placement('target-b', 'target-b', { x: 2, y: 0, z: 0 }),
  placement('target-c', 'target-c', { x: 3, y: 0, z: 0 }),
  placement('far-target', 'far-target', { x: 9, y: 0, z: 0 }),
]): TabletopMap => ({
  schemaVersion: 2,
  slug: 'move-resolution-test',
  name: 'Move Resolution Test',
  dimensions: { x: 12, y: 3, z: 12 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements,
  lights: [],
  initiative: { activeId: null, round: 1 },
  encounterState: redBlueEncounterStateFixture(),
})

const pokemonSheet = (slug: string, moves: CharacterSheetMove[] = [], overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Pikachu',
  level: 20,
  movelist: moves,
  ...overrides,
})

const targetSheet = (slug: string): CharacterSheet => pokemonSheet(slug, [], {
  species: 'Snorlax',
  level: 30,
  combat: { currentHp: 80 },
})

const sheetMap = (
  actorMoves: CharacterSheetMove[],
  overrides: Record<string, CharacterSheet> = {},
): Map<string, CharacterSheet> => new Map<string, CharacterSheet>([
  ['actor', pokemonSheet('actor', actorMoves)],
  ['target-a', targetSheet('target-a')],
  ['target-b', targetSheet('target-b')],
  ['target-c', targetSheet('target-c')],
  ['far-target', targetSheet('far-target')],
  ...Object.entries(overrides),
])

const randomSequence = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => values[index++] ?? values[values.length - 1] ?? 0
}

const snapshotInput = (map: TabletopMap, pokemonSheets: ReadonlyMap<string, CharacterSheet>, trainerSheets: ReadonlyMap<string, TrainerSheet>): string => JSON.stringify({
  map,
  pokemonSheets: [...pokemonSheets.entries()],
  trainerSheets: [...trainerSheets.entries()],
})

const expectFailure = (
  run: () => unknown,
  code: AuthoritativeMoveResolutionError['code'],
): AuthoritativeMoveResolutionError => {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(AuthoritativeMoveResolutionError)
    const resolutionError = error as AuthoritativeMoveResolutionError
    expect(resolutionError.code).toBe(code)
    return resolutionError
  }
  throw new Error(`Expected ${code} failure`)
}

const fakeTargetCountScript = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Fake 6, 2 Targets',
  version: 1,
  targetMode: 'multi-target',
  targetCount: 2,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass: 'Physical',
  type: 'Normal',
  ac: 2,
  range: '6, 2 Targets',
  effect: 'Fake explicit target-count test script.',
  keywords: ['6', '2 Targets'],
  criticalRange: null,
  areaTemplates: [],
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

const priorityScript = (): MoveAutomationScript => ({
  ...fakeTargetCountScript(),
  moveName: 'Tackle',
  targetMode: 'one-target',
  targetCount: 1,
  damaging: false,
  requiresAccuracy: false,
  damageBase: null,
  damageClass: 'Status',
  range: 'Melee, 1 Target, Priority',
  keywords: ['Melee', '1 Target', 'Priority'],
})

const lineTemplate: MoveAutomationAreaTemplate = { kind: 'line', size: 3, label: 'Line 3' }

const mixedOutcomeAreaScript = (): MoveAutomationScript => ({
  ...fakeTargetCountScript(),
  moveName: 'Swift',
  targetCount: null,
  damaging: false,
  damageBase: null,
  damageClass: 'Status',
  range: lineTemplate.label,
  keywords: [lineTemplate.label, 'Sonic'],
  areaTemplates: [lineTemplate],
  stageSuggestions: [{ recipient: 'target', key: 'def', delta: -1, label: 'Defense down' }],
})

const branchSelectionScript = (): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Tackle',
  version: 1,
  targetMode: 'one-target',
  targetCount: 1,
  damaging: false,
  requiresAccuracy: false,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: null,
  range: 'Melee, 1 Target or 6, 2 Targets',
  effect: 'Test branch selection.',
  keywords: ['Melee', '1 Target', '6', '2 Targets'],
  criticalRange: null,
  areaTemplates: [],
  targetBranches: [
    { id: 'single', label: 'Melee — 1 Target', targetMode: 'one-target', targetCount: 1, range: 'Melee, 1 Target' },
    { id: 'two-targets', label: '6m — 2 Targets', targetMode: 'multi-target', targetCount: 2, range: '6, 2 Targets' },
  ],
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

const priorityBranchSelectionScript = (): MoveAutomationScript => {
  const script = branchSelectionScript()
  return {
    ...script,
    targetBranches: script.targetBranches?.map(branch => branch.id === 'two-targets'
      ? {
          ...branch,
          label: '6m — 2 Targets — Priority',
          range: '6, 2 Targets, Priority',
        }
      : branch),
  }
}

const withRegisteredMoveAutomationScript = async <T>(script: MoveAutomationScript, run: () => T | Promise<T>): Promise<T> => {
  const scripts = EXPLICIT_MOVE_AUTOMATION_SCRIPTS as Map<string, MoveAutomationScript>
  const previous = scripts.get(script.moveName)
  scripts.set(script.moveName, script)
  try {
    return await run()
  } finally {
    if (previous) scripts.set(script.moveName, previous)
    else scripts.delete(script.moveName)
  }
}

describe('resolveAuthoritativeMove', () => {
  it('resolves self moves without mutating authoritative inputs', () => {
    const map = mapFixture()
    const pokemonSheets = sheetMap([{ name: 'Swords Dance' }])
    const trainerSheets = new Map<string, TrainerSheet>()
    const before = snapshotInput(map, pokemonSheets, trainerSheets)

    const resolution = resolveAuthoritativeMove({
      map,
      pokemonSheets,
      trainerSheets,
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Swords Dance', selection: { kind: 'self' } }),
      random: randomSequence([0]),
    })

    expect(resolution.selectedTargetIds).toEqual([])
    expect(resolution.sheetReads).toEqual([{ kind: 'pokemon', slug: 'actor', revision: 0 }])
    expect(resolution.rollLedger).toEqual([])
    expect(resolution.transaction.attackedTargetIds).toEqual([])
    expect(resolution.transaction.hitTargetIds).toEqual([])
    expect(structuredClone(resolution.transaction)).toMatchObject({ attackedTargetIds: [], hitTargetIds: [] })
    expect(JSON.parse(JSON.stringify(resolution.transaction))).toMatchObject({ attackedTargetIds: [], hitTargetIds: [] })
    expect(resolution.moveKey).toBe('swords-dance')
    expect(resolution.desiredFacing).toBeUndefined()
    expect(resolution.transaction.combatStageUpdates).toEqual([{ id: 'actor-token', stages: { atk: 2, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 } }])
    expect(snapshotInput(map, pokemonSheets, trainerSheets)).toBe(before)
  })

  it('uses the same canonical move usage key for case-insensitive client aliases', () => {
    const resolution = resolveAuthoritativeMove({
      map: mapFixture(),
      pokemonSheets: sheetMap([{ name: 'Swords Dance' }]),
      trainerSheets: new Map(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'swords dance', selection: { kind: 'self' } }),
      random: randomSequence([0]),
    })

    expect(resolution.canonicalMoveName).toBe('Swords Dance')
    expect(resolution.moveKey).toBe('swords-dance')
  })

  it('rejects grounded off-turn Priority under Psychic Terrain before drawing randomness', async () => {
    await withRegisteredMoveAutomationScript(priorityScript(), () => {
      const map = mapFixture()
      map.fieldEffects = {
        weather: [],
        terrains: [{ kind: 'psychic', scope: 'field' }],
        rooms: [],
      }
      map.initiative = { activeId: 'target-a', round: 1 }
      let randomCalls = 0
      const error = expectFailure(() => resolveAuthoritativeMove({
        map,
        pokemonSheets: sheetMap([{ name: 'Tackle' }]),
        trainerSheets: new Map(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Tackle',
          selection: { kind: 'single-target', targetPlacementId: 'target-a' },
        }),
        random: () => {
          randomCalls += 1
          return 0.5
        },
      }), 'move-terrain-blocked')

      expect(error.reason).toBe('unauthorized-state')
      expect(error.message).toContain('Psychic Terrain (legacy.terrain.psychic)')
      expect(randomCalls).toBe(0)

      map.initiative = { activeId: 'actor-token', round: 1 }
      expect(resolveAuthoritativeMove({
        map,
        pokemonSheets: sheetMap([{ name: 'Tackle' }]),
        trainerSheets: new Map(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Tackle',
          selection: { kind: 'single-target', targetPlacementId: 'target-a' },
        }),
        random: randomSequence([]),
      }).transaction.attackedTargetIds).toEqual(['target-a'])
    })
  })

  it('derives legacy action timing from the selected reviewed target branch', async () => {
    await withRegisteredMoveAutomationScript(priorityBranchSelectionScript(), () => {
      const map = mapFixture()
      map.fieldEffects = {
        weather: [],
        terrains: [{ kind: 'psychic', scope: 'field' }],
        rooms: [],
      }
      map.initiative = { activeId: 'target-a', round: 1 }
      let randomCalls = 0

      expectFailure(() => resolveAuthoritativeMove({
        map,
        pokemonSheets: sheetMap([{ name: 'Tackle' }]),
        trainerSheets: new Map(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Tackle',
          targetBranchId: 'two-targets',
          selection: {
            kind: 'target-count',
            targetPlacementIds: ['target-a', 'target-b'],
          },
        }),
        random: () => {
          randomCalls += 1
          return 0.5
        },
      }), 'move-terrain-blocked')
      expect(randomCalls).toBe(0)
    })
  })

  it.each(['interrupt', 'reaction'] as const)(
    'uses a server-reviewed %s child cost for Psychic Terrain legality',
    (resource) => {
      const map = mapFixture()
      map.fieldEffects = {
        weather: [],
        terrains: [{ kind: 'psychic', scope: 'field' }],
        rooms: [],
      }
      map.initiative = { activeId: 'target-a', round: 1 }
      let randomCalls = 0

      expectFailure(() => resolveAuthoritativeMove({
        map,
        pokemonSheets: sheetMap([{ name: 'Tackle' }]),
        trainerSheets: new Map(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Tackle',
          selection: { kind: 'single-target', targetPlacementId: 'target-a' },
        }),
        resourceCostDeclarations: [{
          id: `reaction.cost.test-${resource}`,
          phase: 'pay',
          cost: { kind: 'action-resource', resource, amount: 1 },
        }],
        random: () => {
          randomCalls += 1
          return 0.5
        },
      }), 'move-terrain-blocked')
      expect(randomCalls).toBe(0)
    },
  )

  it('independently rejects a manifest-blocked move even if a legacy script is registered', async () => {
    const teleportScript = fakeTargetCountScript({
      moveName: 'Teleport',
      targetMode: 'one-target',
      targetCount: 1,
      range: 'Melee, 1 Target',
      keywords: ['Melee', '1 Target'],
    })

    await withRegisteredMoveAutomationScript(teleportScript, () => {
      const error = expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Teleport' }]),
        trainerSheets: new Map(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Teleport',
          selection: { kind: 'single-target', targetPlacementId: 'target-a' },
        }),
        random: randomSequence([0.5]),
      }), 'move-automation-blocked')

      expect(error.reason).toBe('unsupported')
      expect(error.message).toContain('Runtime · Unimplemented is planned for Phase 2')
    })
  })

  it('resolves in-range single-target moves with authoritative random accuracy, damage and feedback IDs', () => {
    const map = mapFixture()
    const pokemonSheets = sheetMap([{ name: 'Tackle' }])
    const baseIntent = moveIntent({
      placementId: 'actor-token',
      moveName: 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })

    const lowDamage = resolveAuthoritativeMove({
      map,
      pokemonSheets,
      trainerSheets: new Map(),
      intent: baseIntent,
      random: randomSequence([0.5, 0]),
      idFactory: () => 'feedback-id',
    })
    const highDamage = resolveAuthoritativeMove({
      map,
      pokemonSheets,
      trainerSheets: new Map(),
      intent: baseIntent,
      random: randomSequence([0.5, 0.99]),
      idFactory: () => 'feedback-id',
    })
    const miss = resolveAuthoritativeMove({
      map,
      pokemonSheets,
      trainerSheets: new Map(),
      intent: baseIntent,
      random: randomSequence([0]),
      idFactory: () => 'feedback-id',
    })

    expect(lowDamage.selectedTargetIds).toEqual(['target-a'])
    expect(lowDamage.transaction.attackedTargetIds).toEqual(['target-a'])
    expect(lowDamage.transaction.hitTargetIds).toEqual(['target-a'])
    expect(miss.transaction.attackedTargetIds).toEqual(['target-a'])
    expect(miss.transaction.hitTargetIds).toEqual([])
    expect(miss.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 0 },
      { kind: 'pokemon', slug: 'target-a', revision: 0 },
    ])
    expect(structuredClone(miss.transaction)).toMatchObject({ attackedTargetIds: ['target-a'], hitTargetIds: [] })
    expect(JSON.parse(JSON.stringify(miss.transaction))).toMatchObject({ attackedTargetIds: ['target-a'], hitTargetIds: [] })
    expect(lowDamage.feedback).toMatchObject({ id: 'feedback-id', naturalRoll: 11, targetId: 'target-a' })
    expect(lowDamage.rollLedger).toEqual([
      {
        rollId: 'legacy-v1.accuracy.1',
        parentEffectId: 'legacy-v1.accuracy',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        reason: 'Tackle accuracy against target-a',
        naturalResults: [11],
        naturalResult: 11,
        modifiers: [{ sourceId: 'user-accuracy', reason: 'User Accuracy', value: 0 }],
        finalValue: 11,
      },
      {
        rollId: 'legacy-v1.damage.1',
        parentEffectId: 'legacy-v1.damage',
        formula: { kind: 'dice', count: 1, sides: 8, modifier: 6 },
        reason: 'Tackle damage against target-a',
        naturalResults: [1],
        naturalResult: 1,
        modifiers: [],
        finalValue: 7,
      },
    ])
    expect(miss.rollLedger).toEqual([
      expect.objectContaining({
        rollId: 'legacy-v1.accuracy.1',
        parentEffectId: 'legacy-v1.accuracy',
        naturalResult: 1,
        finalValue: 1,
      }),
    ])
    expect(lowDamage.auditTrace).toMatchObject({
      schemaVersion: 1,
      program: {
        canonicalId: 'Tackle',
        runtimeKind: 'legacy-v1',
        runtimeVersion: 1,
        definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      ruleset: {
        rulesetId: 'rotom-table-reference-moves-v1',
        sourceDataSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    })
    expect(lowDamage.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'target', targetId: 'target-a', outcome: 'included' }),
      expect.objectContaining({ kind: 'predicate', predicateId: 'legacy-v1.accuracy.1', outcome: true }),
      expect.objectContaining({ kind: 'roll', roll: expect.objectContaining({ rollId: 'legacy-v1.accuracy.1' }) }),
      expect.objectContaining({
        kind: 'operation',
        operationKind: 'direct-hp',
        recipientIds: ['target-a'],
        outcome: 'applied',
        result: expect.objectContaining({ id: 'target-a' }),
      }),
    ]))
    expect(miss.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'predicate', predicateId: 'legacy-v1.accuracy.1', outcome: false }),
      expect.objectContaining({ kind: 'phase-transition', to: 'miss' }),
    ]))
    expect(lowDamage.desiredFacing).toBe('south-east')
    expect(highDamage.transaction.hpUpdates).not.toEqual(lowDamage.transaction.hpUpdates)
  })

  it('rejects missing and out-of-range single targets and preserves inputs after failure', () => {
    const map = mapFixture()
    const pokemonSheets = sheetMap([{ name: 'Tackle' }])
    const trainerSheets = new Map<string, TrainerSheet>()
    const before = snapshotInput(map, pokemonSheets, trainerSheets)

    expectFailure(() => resolveAuthoritativeMove({
      map,
      pokemonSheets,
      trainerSheets,
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'missing' } }),
    }), 'target-placement-missing')

    expectFailure(() => resolveAuthoritativeMove({
      map,
      pokemonSheets,
      trainerSheets,
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'far-target' } }),
    }), 'target-out-of-range')

    expect(snapshotInput(map, pokemonSheets, trainerSheets)).toBe(before)
  })

  it('resolves no-roll single-target moves through the no-roll transaction path', () => {
    const resolution = resolveAuthoritativeMove({
      map: mapFixture(),
      pokemonSheets: sheetMap([{ name: 'Helping Hand' }]),
      trainerSheets: new Map(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Helping Hand', selection: { kind: 'single-target', targetPlacementId: 'target-a' } }),
      random: randomSequence([0]),
      idFactory: () => 'unused',
    })

    expect(resolution.feedback).toBeUndefined()
    expect(resolution.transaction.conditionUpdates).toEqual([{ id: 'target-a', conditions: ['Helping Hand'] }])
  })

  it('accepts the acting token as a single target only for Self-inclusive range semantics', () => {
    const selfTarget = resolveAuthoritativeMove({
      map: mapFixture(),
      pokemonSheets: sheetMap([{ name: 'Acupressure' }]),
      trainerSheets: new Map(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Acupressure', selection: { kind: 'single-target', targetPlacementId: 'actor-token' } }),
      random: randomSequence([0.5, 0.2]),
      idFactory: () => 'acu-feedback',
    })
    expect(selfTarget.selectedTargetIds).toEqual(['actor-token'])
    expect(selfTarget.rollLedger.map((roll) => roll.formula)).toEqual([
      { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      { kind: 'table', tableId: 'legacy-v1.random-stage-suggestion' },
    ])

    expectFailure(() => resolveAuthoritativeMove({
      map: mapFixture(),
      pokemonSheets: sheetMap([{ name: 'Tackle' }]),
      trainerSheets: new Map(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'actor-token' } }),
    }), 'target-out-of-range')
  })

  it('handles target branch validation and applies valid branch scripts', async () => {
    await withRegisteredMoveAutomationScript(branchSelectionScript(), () => {
      const map = mapFixture()
      const pokemonSheets = sheetMap([{ name: 'Tackle' }])
      const trainerSheets = new Map<string, TrainerSheet>()

      expectFailure(() => resolveAuthoritativeMove({
        map,
        pokemonSheets,
        trainerSheets,
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target-a' } }),
      }), 'target-branch-required')

      expectFailure(() => resolveAuthoritativeMove({
        map,
        pokemonSheets,
        trainerSheets,
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Tackle', targetBranchId: 'bad', selection: { kind: 'single-target', targetPlacementId: 'target-a' } }),
      }), 'target-branch-invalid')

      const resolution = resolveAuthoritativeMove({
        map,
        pokemonSheets,
        trainerSheets,
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Tackle', targetBranchId: 'single', selection: { kind: 'single-target', targetPlacementId: 'target-a' } }),
      })
      expect(resolution.targetBranchId).toBe('single')
      expect(resolution.script.range).toBe('Melee, 1 Target')
    })

    expectFailure(() => resolveAuthoritativeMove({
      map: mapFixture(),
      pokemonSheets: sheetMap([{ name: 'Tackle' }]),
      trainerSheets: new Map(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Tackle', targetBranchId: 'unexpected', selection: { kind: 'single-target', targetPlacementId: 'target-a' } }),
    }), 'target-branch-unexpected')
  })

  it('rejects selection-kind and script-mode mismatches', async () => {
    expectFailure(() => resolveAuthoritativeMove({
      map: mapFixture(),
      pokemonSheets: sheetMap([{ name: 'Tackle' }]),
      trainerSheets: new Map(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Tackle', selection: { kind: 'self' } }),
    }), 'selection-kind-mismatch')

    await withRegisteredMoveAutomationScript(fakeTargetCountScript(), () => {
      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Fake 6, 2 Targets', db: 4, category: 'Physical', ac: 2, range: '6, 2 Targets' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Fake 6, 2 Targets', selection: { kind: 'single-target', targetPlacementId: 'target-a' } }),
      }), 'selection-kind-mismatch')
    })
  })

  it('resolves target-count selections using script maximum, authoritative range and deterministic target order', async () => {
    await withRegisteredMoveAutomationScript(fakeTargetCountScript(), () => {
      const map = mapFixture()
      const pokemonSheets = sheetMap([{ name: 'Fake 6, 2 Targets', db: 4, category: 'Physical', ac: 2, range: '6, 2 Targets' }])
      const trainerSheets = new Map<string, TrainerSheet>()

      const resolution = resolveAuthoritativeMove({
        map,
        pokemonSheets,
        trainerSheets,
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Fake 6, 2 Targets',
          selection: { kind: 'target-count', targetPlacementIds: ['target-b', 'target-a'] },
        }),
        random: randomSequence([0.5, 0, 0.5, 0.25]),
      })

      expect(resolution.selectedTargetIds).toEqual(['target-a', 'target-b'])
      expect(resolution.transaction.attackedTargetIds).toEqual(['target-a', 'target-b'])
      expect(resolution.desiredFacing).toBe('south-east')

      expectFailure(() => resolveAuthoritativeMove({
        map,
        pokemonSheets,
        trainerSheets,
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Fake 6, 2 Targets', selection: { kind: 'target-count', targetPlacementIds: ['target-a', 'target-b', 'target-c'] } }),
      }), 'too-many-targets')

      expectFailure(() => resolveAuthoritativeMove({
        map,
        pokemonSheets,
        trainerSheets,
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Fake 6, 2 Targets', selection: { kind: 'target-count', targetPlacementIds: ['target-a', 'far-target'] } }),
      }), 'target-out-of-range')
    })
  })

  it('preserves mixed area hit, miss, immunity, and no-target identities through wire clones', async () => {
    await withRegisteredMoveAutomationScript(mixedOutcomeAreaScript(), () => {
      const mixed = resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Swift' }], {
          'target-c': { ...targetSheet('target-c'), abilities: [{ name: 'Soundproof' }] },
        }),
        trainerSheets: new Map(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Swift',
          selection: { kind: 'area', areaTemplateId: moveAutomationAreaTemplateId(lineTemplate), direction: 'east' },
        }),
        random: randomSequence([0.5, 0, 0.5]),
      })

      expect(mixed.transaction.attackedTargetIds).toEqual(['target-a', 'target-b', 'target-c'])
      expect(mixed.transaction.hitTargetIds).toEqual(['target-a', 'target-c'])
      expect(mixed.transaction.combatStageUpdates.map((update) => update.id)).toEqual(['target-a'])
      expect(mixed.sheetReads).toEqual([
        { kind: 'pokemon', slug: 'actor', revision: 0 },
        { kind: 'pokemon', slug: 'target-a', revision: 0 },
        { kind: 'pokemon', slug: 'target-b', revision: 0 },
        { kind: 'pokemon', slug: 'target-c', revision: 0 },
      ])
      const expectedTargetIds = {
        attackedTargetIds: ['target-a', 'target-b', 'target-c'],
        hitTargetIds: ['target-a', 'target-c'],
      }
      expect(structuredClone(mixed.transaction)).toMatchObject(expectedTargetIds)
      expect(JSON.parse(JSON.stringify(mixed.transaction))).toMatchObject(expectedTargetIds)

      const noTarget = resolveAuthoritativeMove({
        map: mapFixture([placement('actor-token', 'actor', { x: 0, y: 0, z: 0 })]),
        pokemonSheets: sheetMap([{ name: 'Swift' }]),
        trainerSheets: new Map(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Swift',
          selection: { kind: 'area', areaTemplateId: moveAutomationAreaTemplateId(lineTemplate), direction: 'east' },
        }),
      })
      expect(noTarget.transaction.attackedTargetIds).toEqual([])
      expect(noTarget.transaction.hitTargetIds).toEqual([])
    })
  })

  it('applies legacy Electric damage only for a grounded terrain member', () => {
    const resolve = (terrain: boolean, airborne: boolean) => {
      const battlefield = mapFixture([
        placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }, 'red'),
        placement('target-token', 'target-a', { x: 1, y: 0, z: 0 }, 'blue'),
      ])
      battlefield.fieldEffects = {
        weather: [],
        terrains: terrain ? [{ kind: 'electric', scope: 'field' }] : [],
        rooms: [],
      }
      return resolveAuthoritativeMove({
        map: battlefield,
        pokemonSheets: sheetMap([{ name: 'Thunder Shock' }], {
          actor: pokemonSheet('actor', [{ name: 'Thunder Shock' }], {
            revision: 2,
            ...(airborne ? { capabilities: { sky: 6 } } : {}),
          }),
          'target-a': targetSheet('target-a'),
        }),
        trainerSheets: new Map(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Thunder Shock',
          selection: { kind: 'single-target', targetPlacementId: 'target-token' },
        }),
        random: randomSequence([0.5]),
      })
    }
    const hpLoss = (resolution: ReturnType<typeof resolveAuthoritativeMove>): number => (
      80 - (resolution.transaction.hpUpdates[0]?.currentHp ?? 80)
    )
    const baseline = resolve(false, false)
    const grounded = resolve(true, false)
    const airborne = resolve(true, true)

    expect(hpLoss(grounded) - hpLoss(baseline)).toBe(10)
    expect(hpLoss(airborne)).toBe(hpLoss(baseline))
  })

  it('applies legacy Psychic damage regardless of the terrain member grounding state', () => {
    const resolve = (terrain: boolean, airborne: boolean) => {
      const battlefield = mapFixture([
        placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }, 'red'),
        placement('target-token', 'target-a', { x: 1, y: 0, z: 0 }, 'blue'),
      ])
      battlefield.fieldEffects = {
        weather: [],
        terrains: terrain ? [{ kind: 'psychic', scope: 'field' }] : [],
        rooms: [],
      }
      return resolveAuthoritativeMove({
        map: battlefield,
        pokemonSheets: sheetMap([{ name: 'Confusion' }], {
          actor: pokemonSheet('actor', [{ name: 'Confusion' }], {
            revision: 2,
            ...(airborne ? { capabilities: { sky: 6 } } : {}),
          }),
          'target-a': targetSheet('target-a'),
        }),
        trainerSheets: new Map(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Confusion',
          selection: { kind: 'single-target', targetPlacementId: 'target-token' },
        }),
        random: randomSequence([0.5]),
      })
    }
    const hpLoss = (resolution: ReturnType<typeof resolveAuthoritativeMove>): number => (
      80 - (resolution.transaction.hpUpdates[0]?.currentHp ?? 80)
    )
    const baseline = resolve(false, false)
    const grounded = resolve(true, false)
    const airborne = resolve(true, true)

    expect(hpLoss(grounded) - hpLoss(baseline)).toBe(10)
    expect(hpLoss(airborne) - hpLoss(baseline)).toBe(10)
  })

  it('prevents legacy Sleep automation for a grounded Electric Terrain member', () => {
    const terrainMap = mapFixture([
      placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }, 'red'),
      placement('target-token', 'target-a', { x: 1, y: 0, z: 0 }, 'blue'),
    ])
    terrainMap.fieldEffects = {
      weather: [],
      terrains: [{ kind: 'electric', scope: 'field' }],
      rooms: [],
    }
    const resolution = resolveAuthoritativeMove({
      map: terrainMap,
      pokemonSheets: sheetMap([{ name: 'Spore' }], {
        actor: pokemonSheet('actor', [{ name: 'Spore' }], { revision: 2 }),
        'target-a': targetSheet('target-a'),
      }),
      trainerSheets: new Map(),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Spore',
        selection: { kind: 'single-target', targetPlacementId: 'target-token' },
      }),
      random: randomSequence([0.99]),
      idFactory: () => 'spore-terrain-feedback',
    })

    expect(resolution.feedback?.conditions).toContainEqual({
      condition: 'Sleep',
      applied: false,
      blockedBy: 'Electric Terrain (legacy.terrain.electric)',
    })
    expect(resolution.transaction.conditionUpdates).toEqual([])
    expect(resolution.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'operation',
        operationKind: 'condition',
        recipientIds: ['target-token'],
        outcome: 'prevented',
        result: {
          applied: false,
          blockedBy: 'Electric Terrain (legacy.terrain.electric)',
        },
      }),
    ]))
  })

  it('records indirect aura providers consulted for target immunity', () => {
    const resolution = resolveAuthoritativeMove({
      map: mapFixture([
        placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }, 'red'),
        placement('target-token', 'target-a', { x: 1, y: 0, z: 0 }, 'blue'),
        placement('aura-token', 'aura', { x: 2, y: 0, z: 0 }, 'blue'),
      ]),
      pokemonSheets: sheetMap([{ name: 'Spore' }], {
        actor: pokemonSheet('actor', [{ name: 'Spore' }], { revision: 2 }),
        'target-a': targetSheet('target-a'),
        aura: pokemonSheet('aura', [], { revision: 6, abilities: [{ name: 'Sweet Veil' }] }),
      }),
      trainerSheets: new Map(),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Spore',
        selection: { kind: 'single-target', targetPlacementId: 'target-token' },
      }),
      random: randomSequence([0.99]),
      idFactory: () => 'spore-feedback',
    })

    expect(resolution.feedback?.conditions).toContainEqual({
      condition: 'Sleep',
      applied: false,
      blockedBy: 'Sweet Veil (aura)',
    })
    expect(resolution.transaction.conditionUpdates).toEqual([])
    expect(resolution.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'operation',
        operationKind: 'condition',
        recipientIds: ['target-token'],
        outcome: 'prevented',
        reasonCode: 'condition-prevented',
        input: { condition: 'Sleep' },
        result: { applied: false, blockedBy: 'Sweet Veil (aura)' },
      }),
    ]))
    expect(resolution.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 2 },
      { kind: 'pokemon', slug: 'target-a', revision: 0 },
      { kind: 'pokemon', slug: 'aura', revision: 6 },
    ])
  })

  it('does not grant Sweet Veil immunity from an in-range enemy provider', () => {
    const resolution = resolveAuthoritativeMove({
      map: mapFixture([
        placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }, 'red'),
        placement('target-token', 'target-a', { x: 1, y: 0, z: 0 }, 'blue'),
        placement('enemy-aura-token', 'enemy-aura', { x: 2, y: 0, z: 0 }, 'red'),
      ]),
      pokemonSheets: sheetMap([{ name: 'Spore' }], {
        actor: pokemonSheet('actor', [{ name: 'Spore' }], { revision: 2 }),
        'target-a': targetSheet('target-a'),
        'enemy-aura': pokemonSheet('enemy-aura', [], {
          revision: 7,
          abilities: [{ name: 'Sweet Veil' }],
        }),
      }),
      trainerSheets: new Map(),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Spore',
        selection: { kind: 'single-target', targetPlacementId: 'target-token' },
      }),
      random: randomSequence([0.99]),
      idFactory: () => 'spore-feedback',
    })

    expect(resolution.feedback?.conditions).toContainEqual({
      condition: 'Sleep',
      applied: true,
    })
    expect(resolution.transaction.conditionUpdates).toEqual([
      { id: 'target-token', conditions: ['Sleep'] },
    ])
    expect(resolution.sheetReads).toEqual([
      { kind: 'pokemon', slug: 'actor', revision: 2 },
      { kind: 'pokemon', slug: 'target-a', revision: 0 },
    ])
  })

  it('deduplicates shared sheet references and rejects conflicting observed revisions', () => {
    expect(deduplicateAuthoritativeMoveSheetReads([
      { kind: 'pokemon', slug: 'shared', revision: 7 },
      { kind: 'pokemon', slug: 'shared', revision: 7 },
      { kind: 'trainer', slug: 'shared', revision: 3 },
    ])).toEqual([
      { kind: 'pokemon', slug: 'shared', revision: 7 },
      { kind: 'trainer', slug: 'shared', revision: 3 },
    ])

    expectFailure(() => deduplicateAuthoritativeMoveSheetReads([
      { kind: 'pokemon', slug: 'shared', revision: 7 },
      { kind: 'pokemon', slug: 'shared', revision: 8 },
    ]), 'sheet-read-revision-conflict')
  })

  it('accepts only the exact finite draw stream required by a successful resolution', () => {
    const common = {
      map: mapFixture(),
      pokemonSheets: sheetMap([{ name: 'Tackle' }]),
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target-a' } as const,
      }),
      idFactory: () => 'finite-feedback',
    }
    const exact = createFiniteAuthoritativeMoveRandomStream([0.5, 0])
    const resolution = resolveAuthoritativeMove({ ...common, random: exact })
    expect(resolution.rollLedger).toHaveLength(2)
    expect(exact).toMatchObject({ consumed: 2, remaining: 0 })

    expect(() => resolveAuthoritativeMove({
      ...common,
      random: createFiniteAuthoritativeMoveRandomStream([0.5]),
    })).toThrowError(expect.objectContaining({
      name: AuthoritativeMoveRandomError.name,
      code: 'missing-random-draw',
    }))
    expect(() => resolveAuthoritativeMove({
      ...common,
      random: createFiniteAuthoritativeMoveRandomStream([0.5, 0, 0.25]),
    })).toThrowError(expect.objectContaining({
      name: AuthoritativeMoveRandomError.name,
      code: 'excess-random-draws',
    }))
  })

  it('reproduces multi-target random rolls with injected randomness', async () => {
    await withRegisteredMoveAutomationScript(fakeTargetCountScript(), () => {
      const common = {
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Fake 6, 2 Targets', db: 4, category: 'Physical', ac: 2, range: '6, 2 Targets' }]),
        trainerSheets: new Map<string, TrainerSheet>(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Fake 6, 2 Targets', selection: { kind: 'target-count', targetPlacementIds: ['target-a', 'target-b'] } }),
      }
      const first = resolveAuthoritativeMove({ ...common, random: randomSequence([0.5, 0, 0.5, 0.25]) })
      const second = resolveAuthoritativeMove({ ...common, random: randomSequence([0.5, 0, 0.5, 0.25]) })
      const different = resolveAuthoritativeMove({ ...common, random: randomSequence([0.5, 0.99, 0.5, 0.99]) })

      expect(second.transaction).toEqual(first.transaction)
      expect(second.rollLedger).toEqual(first.rollLedger)
      expect(different.rollLedger).not.toEqual(first.rollLedger)
      expect(different.transaction.hpUpdates).not.toEqual(first.transaction.hpUpdates)
    })
  })

  it('rejects missing actor sheets and duplicate placement ids', () => {
    expectFailure(() => resolveAuthoritativeMove({
      map: mapFixture(),
      pokemonSheets: new Map(),
      trainerSheets: new Map(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target-a' } }),
    }), 'actor-sheet-missing')

    expectFailure(() => resolveAuthoritativeMove({
      map: mapFixture([
        placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }),
        placement('actor-token', 'actor-copy', { x: 1, y: 0, z: 0 }),
      ]),
      pokemonSheets: sheetMap([{ name: 'Tackle' }]),
      trainerSheets: new Map(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target-a' } }),
    }), 'duplicate-placement-id')
  })
})
