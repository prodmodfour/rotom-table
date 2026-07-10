import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION, type ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import {
  AuthoritativeMoveResolutionError,
  resolveAuthoritativeMove,
} from '../../server/domain/resolveAuthoritativeMove'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '~/utils/moveAutomation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import { redBlueEncounterStateFixture } from '../fixtures/moveAutomation/encounterSides'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
} from '~~/server/domain/moveAutomation/handlers/registry'
import type {
  MoveAutomationRuntimeRegistry,
  MoveSpecV2Runtime,
} from '~~/server/domain/moveAutomation/registry'
import type {
  MoveAutomationTargetPredicateDeclaration,
} from '~~/server/domain/moveAutomation/predicates/target'
import {
  validateMoveSpec,
} from '~~/server/domain/moveAutomation/validateSpec'
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

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'area-resolution-test',
  name: 'Area Resolution Test',
  dimensions: { x: 12, y: 4, z: 12 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', { x: 5, y: 0, z: 5 }),
    placement('target-a', 'target-a', { x: 6, y: 0, z: 5 }),
    placement('target-b', 'target-b', { x: 5, y: 0, z: 4 }),
    placement('target-c', 'target-c', { x: 7, y: 0, z: 5 }),
    placement('far-target', 'far-target', { x: 11, y: 0, z: 11 }),
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  ...overrides,
})

const pokemonSheet = (slug: string, moves: CharacterSheetMove[] = [], overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Pikachu',
  level: 20,
  movelist: moves,
  ...overrides,
})

const sheetMap = (
  actorMoves: CharacterSheetMove[],
  overrides: Record<string, CharacterSheet> = {},
): Map<string, CharacterSheet> => new Map<string, CharacterSheet>([
  ['actor', pokemonSheet('actor', actorMoves)],
  ['target-a', pokemonSheet('target-a')],
  ['target-b', pokemonSheet('target-b')],
  ['target-c', pokemonSheet('target-c')],
  ['far-target', pokemonSheet('far-target')],
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

const areaScript = (
  moveName: string,
  areaTemplates: MoveAutomationAreaTemplate[],
  overrides: Partial<MoveAutomationScript> = {},
): MoveAutomationScript => ({
  kind: 'explicit',
  moveName,
  version: 1,
  targetMode: 'multi-target',
  targetCount: null,
  damaging: false,
  requiresAccuracy: false,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: null,
  range: areaTemplates.map((template) => template.label).join(' or '),
  effect: 'Authoritative area-resolution test script.',
  keywords: areaTemplates.map((template) => template.label),
  criticalRange: null,
  areaTemplates,
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

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

const nativeAreaRuntimeRegistry = (options: {
  readonly canonicalId: string
  readonly predicate: MoveAutomationTargetPredicateDeclaration
  readonly passDistance?: number
}): MoveAutomationRuntimeRegistry => {
  const movementOperations = options.passDistance === undefined
    ? []
    : [{
        id: 'area-test.pass-movement',
        kind: 'movement-request',
        source: { kind: 'move', id: 'move.area-test' },
        recipients: { kind: 'actor' },
        phase: 'movement',
        reasonCode: 'area-test.pass-movement',
        payload: {
          requestId: 'area-test.pass-destination',
          mode: 'voluntary',
          distance: options.passDistance,
          destinationSetId: 'area-test.pass-destinations',
        },
      }]
  const definition = validateMoveSpec({
    schemaVersion: 2,
    canonicalId: options.canonicalId,
    version: 1,
    targeting: {
      kind: 'area',
      minTargets: 0,
      maxTargets: 32,
      selector: { kind: 'area-targets' },
      predicate: options.predicate,
    },
    preconditions: [],
    costs: [],
    phases: [
      ...(movementOperations.length
        ? [{ phase: 'movement', operations: movementOperations }]
        : []),
      {
        phase: 'cleanup',
        operations: [{
          id: 'area-test.completed',
          kind: 'log',
          source: { kind: 'move', id: 'move.area-test' },
          recipients: { kind: 'none' },
          phase: 'cleanup',
          reasonCode: 'area-test.completed',
          payload: { messageKey: 'move.area-test.completed', arguments: [] },
        }],
      },
    ],
    registeredHandlerId: null,
    presentation: {
      displayName: options.canonicalId,
      vfxKey: null,
      tags: ['area-test'],
    },
  })
  const runtime: MoveSpecV2Runtime = Object.freeze({
    canonicalId: options.canonicalId,
    kind: 'movespec-v2',
    version: definition.spec.version,
    definitionHash: definition.definitionHash,
    sourceModule: 'tests/server/resolveAuthoritativeAreaMove.test.ts',
    definition,
  })
  return Object.freeze({
    size: 1,
    handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
    resolve: (canonicalId: string) => canonicalId === options.canonicalId ? runtime : null,
    entries: () => Object.freeze([runtime]),
  })
}

const LEGACY_ONLY_RUNTIME_REGISTRY: MoveAutomationRuntimeRegistry = Object.freeze({
  size: 0,
  handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
  resolve: () => null,
  entries: () => Object.freeze([]),
})

const templateId = (template: MoveAutomationAreaTemplate): string => moveAutomationAreaTemplateId(template)

const burstTemplate: MoveAutomationAreaTemplate = { kind: 'burst', size: 1, label: 'Burst 1' }
const cardinalTemplate: MoveAutomationAreaTemplate = { kind: 'cardinally-adjacent', size: 1, label: 'Cardinally Adjacent Targets' }
const coneTemplate: MoveAutomationAreaTemplate = { kind: 'cone', size: 2, label: 'Cone 2' }
const lineTemplate: MoveAutomationAreaTemplate = { kind: 'line', size: 3, label: 'Line 3' }
const closeBlastTemplate: MoveAutomationAreaTemplate = { kind: 'close-blast', size: 2, label: 'Close Blast 2' }
const rangedBlastTemplate: MoveAutomationAreaTemplate = { kind: 'ranged-blast', range: 4, size: 1, label: 'Ranged 4 Blast 1' }

const nativeAreaCases = [
  {
    label: 'Burst',
    moveName: 'Disarming Voice',
    template: burstTemplate,
    placement: {},
  },
  {
    label: 'Cardinally Adjacent',
    moveName: 'Discharge',
    template: cardinalTemplate,
    placement: {},
  },
  {
    label: 'Cone',
    moveName: 'Snarl',
    template: coneTemplate,
    placement: { direction: 'north' as const },
  },
  {
    label: 'Line',
    moveName: 'Dragon Hammer',
    template: lineTemplate,
    placement: { direction: 'east' as const },
  },
  {
    label: 'Close Blast',
    moveName: 'Heat Wave',
    template: { kind: 'close-blast' as const, size: 3, label: 'Close Blast 3' },
    placement: { aimCell: { x: 6, y: 0, z: 5 } },
  },
  {
    label: 'Ranged Blast',
    moveName: 'Swift',
    template: { kind: 'ranged-blast' as const, range: 8, size: 2, label: 'Ranged 8 Blast 2' },
    placement: { aimCell: { x: 6, y: 0, z: 5 } },
  },
  {
    label: 'Pass',
    moveName: 'Scratch',
    template: { kind: 'pass' as const, size: 4, label: 'Pass 4' },
    placement: { direction: 'east' as const },
    passDistance: 4,
  },
] as const

describe('resolveAuthoritativeMove area selections', () => {
  it('resolves Burst and Cardinally Adjacent cells and deterministic authoritative targets', async () => {
    await withRegisteredMoveAutomationScript(areaScript('Disarming Voice', [burstTemplate]), () => {
      const resolution = resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Disarming Voice' }]),
        trainerSheets: new Map(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Disarming Voice',
          selection: { kind: 'area', areaTemplateId: templateId(burstTemplate) },
        }),
      })

      expect(resolution.area?.cells).toContainEqual({ x: 6, y: 0, z: 5 })
      expect(resolution.area?.candidateTargetIds).toEqual(['target-a', 'target-b'])
      expect(resolution.selectedTargetIds).toEqual(['target-a', 'target-b'])
      expect(resolution.desiredFacing).toBe('north-east')
      expect(resolution.movement).toBeUndefined()
    })

    await withRegisteredMoveAutomationScript(areaScript('Disarming Voice', [cardinalTemplate]), () => {
      const resolution = resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Disarming Voice' }]),
        trainerSheets: new Map(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Disarming Voice',
          selection: { kind: 'area', areaTemplateId: templateId(cardinalTemplate) },
        }),
      })

      expect(resolution.area?.cells).toEqual(expect.arrayContaining([
        { x: 6, y: 0, z: 5 },
        { x: 5, y: 0, z: 4 },
      ]))
      expect(resolution.area?.candidateTargetIds).toEqual(['target-a', 'target-b'])
    })
  })

  it('enforces template-specific direction and aim placement shapes', async () => {
    await withRegisteredMoveAutomationScript(areaScript('Snarl', [coneTemplate]), () => {
      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Snarl' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Snarl', selection: { kind: 'area', areaTemplateId: templateId(coneTemplate) } }),
      }), 'area-placement-missing')

      const resolution = resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Snarl' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Snarl', selection: { kind: 'area', areaTemplateId: templateId(coneTemplate), direction: 'north' } }),
      })
      expect(resolution.area?.candidateTargetIds).toEqual(['target-b'])
      expect(resolution.desiredFacing).toBe('north-west')
    })

    await withRegisteredMoveAutomationScript(areaScript('Razor Leaf', [lineTemplate]), () => {
      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Razor Leaf' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Razor Leaf', selection: { kind: 'area', areaTemplateId: templateId(lineTemplate) } }),
      }), 'area-placement-missing')

      const resolution = resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Razor Leaf' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Razor Leaf', selection: { kind: 'area', areaTemplateId: templateId(lineTemplate), direction: 'east' } }),
      })
      expect(resolution.area?.candidateTargetIds).toEqual(['target-a', 'target-c'])
      expect(resolution.desiredFacing).toBe('north-east')
    })
  })

  it.each(nativeAreaCases)('applies native enemy predicates after $label geometry', ({
    moveName,
    template,
    placement: areaPlacement,
    ...areaCase
  }) => {
    const map = mapFixture({
      placements: [
        placement('actor-token', 'actor', { x: 5, y: 0, z: 5 }, 'red'),
        placement('target-a', 'target-a', { x: 6, y: 0, z: 5 }, 'blue'),
        placement('target-b', 'target-b', { x: 5, y: 0, z: 4 }, 'red'),
        placement('target-c', 'target-c', { x: 7, y: 0, z: 5 }, 'blue'),
        placement('far-target', 'far-target', { x: 11, y: 0, z: 11 }, 'blue'),
      ],
      encounterState: redBlueEncounterStateFixture(),
    })
    const runtimeRegistry = nativeAreaRuntimeRegistry({
      canonicalId: moveName,
      predicate: { relationship: 'enemy', willingness: 'any', excludeActor: true },
      ...('passDistance' in areaCase ? { passDistance: areaCase.passDistance } : {}),
    })
    const resolution = resolveAuthoritativeMove({
      map,
      pokemonSheets: sheetMap([{ name: moveName }]),
      trainerSheets: new Map(),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName,
        selection: {
          kind: 'area',
          areaTemplateId: templateId(template),
          ...areaPlacement,
        },
      }),
      runtimeRegistry,
    })

    const geometricIds = resolution.area?.candidateTargetIds ?? []
    const expectedEnemyIds = geometricIds.filter(targetId => targetId !== 'target-b')
    expect(geometricIds.length).toBeGreaterThan(0)
    expect(resolution.nativeV2).toBeDefined()
    expect(resolution.selectedTargetIds).toEqual(expectedEnemyIds)
    expect(resolution.transaction.attackedTargetIds).toEqual(expectedEnemyIds)
    expect(resolution.area?.targetEvaluations).toHaveLength(geometricIds.length)
    if (geometricIds.includes('target-b')) {
      expect(resolution.area?.targetEvaluations).toContainEqual(expect.objectContaining({
        targetPlacementId: 'target-b',
        outcome: 'excluded',
        reasonCode: 'target-excluded-not-enemy',
      }))
    }
    for (const targetId of expectedEnemyIds) {
      expect(resolution.area?.targetEvaluations).toContainEqual(expect.objectContaining({
        targetPlacementId: targetId,
        outcome: 'included',
        reasonCode: 'target-included',
      }))
    }
    expect(resolution.auditTrace.events.filter(event => event.kind === 'target'))
      .toEqual(resolution.area?.targetEvaluations.map(evaluation => expect.objectContaining({
        targetId: evaluation.targetPlacementId,
        outcome: evaluation.outcome,
        reasonCode: evaluation.reasonCode,
      })))
  })

  it.each(nativeAreaCases)('keeps legacy and native ally filtering in parity after $label geometry', ({
    moveName,
    template,
    placement: areaPlacement,
    ...areaCase
  }) => {
    const map = mapFixture({
      placements: [
        placement('actor-token', 'actor', { x: 5, y: 0, z: 5 }, 'red'),
        placement('target-a', 'target-a', { x: 6, y: 0, z: 5 }, 'red'),
        placement('target-b', 'target-b', { x: 5, y: 0, z: 4 }, 'blue'),
        placement('target-c', 'target-c', { x: 7, y: 0, z: 5 }),
        placement('far-target', 'far-target', { x: 11, y: 0, z: 11 }, 'blue'),
      ],
      encounterState: redBlueEncounterStateFixture(),
    })
    const script = areaScript(moveName, [template], {
      areaTargetRelationship: 'ally',
    })
    const legacyScripts = new Map([[moveName, script]])
    const selection = {
      kind: 'area' as const,
      areaTemplateId: templateId(template),
      ...areaPlacement,
    }
    const common = {
      map,
      pokemonSheets: sheetMap([{ name: moveName }]),
      trainerSheets: new Map<string, TrainerSheet>(),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName,
        selection,
      }),
      legacyScripts,
    }
    const legacy = resolveAuthoritativeMove({
      ...common,
      runtimeRegistry: LEGACY_ONLY_RUNTIME_REGISTRY,
    })
    const native = resolveAuthoritativeMove({
      ...common,
      runtimeRegistry: nativeAreaRuntimeRegistry({
        canonicalId: moveName,
        predicate: { relationship: 'ally', willingness: 'any', excludeActor: true },
        ...('passDistance' in areaCase ? { passDistance: areaCase.passDistance } : {}),
      }),
    })

    expect(legacy.area?.candidateTargetIds.length).toBeGreaterThan(0)
    expect(native.area?.candidateTargetIds).toEqual(legacy.area?.candidateTargetIds)
    expect(native.selectedTargetIds).toEqual(legacy.selectedTargetIds)
    expect(native.area?.targetEvaluations).toEqual(legacy.area?.targetEvaluations)
    expect(native.transaction.attackedTargetIds).toEqual(legacy.transaction.attackedTargetIds)
    expect(legacy.selectedTargetIds.every(targetId => targetId === 'target-a')).toBe(true)
  })

  it('includes every mixed-side geometric candidate for a reviewed all-target area', () => {
    const map = mapFixture({
      placements: [
        placement('actor-token', 'actor', { x: 5, y: 0, z: 5 }, 'red'),
        placement('target-a', 'target-a', { x: 6, y: 0, z: 5 }, 'red'),
        placement('target-b', 'target-b', { x: 5, y: 0, z: 4 }, 'blue'),
        placement('target-c', 'target-c', { x: 4, y: 0, z: 5 }),
      ],
      encounterState: redBlueEncounterStateFixture(),
    })
    const script = areaScript('Disarming Voice', [burstTemplate])
    const resolution = resolveAuthoritativeMove({
      map,
      pokemonSheets: sheetMap([{ name: 'Disarming Voice' }]),
      trainerSheets: new Map(),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Disarming Voice',
        selection: { kind: 'area', areaTemplateId: templateId(burstTemplate) },
      }),
      legacyScripts: new Map([['Disarming Voice', script]]),
      runtimeRegistry: nativeAreaRuntimeRegistry({
        canonicalId: 'Disarming Voice',
        predicate: { relationship: 'any', willingness: 'any', excludeActor: true },
      }),
    })

    expect(resolution.area?.candidateTargetIds).toEqual(['target-a', 'target-b', 'target-c'])
    expect(resolution.selectedTargetIds).toEqual(['target-a', 'target-b', 'target-c'])
    expect(resolution.area?.targetEvaluations).toEqual([
      expect.objectContaining({ targetPlacementId: 'target-a', outcome: 'included' }),
      expect.objectContaining({ targetPlacementId: 'target-b', outcome: 'included' }),
      expect.objectContaining({ targetPlacementId: 'target-c', outcome: 'included' }),
    ])
  })

  it('applies native area state predicates before rolls and effects', () => {
    const map = mapFixture({
      placements: [
        placement('actor-token', 'actor', { x: 5, y: 0, z: 5 }, 'red'),
        placement('target-a', 'target-a', { x: 6, y: 0, z: 5 }, 'blue'),
        placement('target-b', 'target-b', { x: 5, y: 0, z: 4 }, 'red'),
      ],
      encounterState: redBlueEncounterStateFixture(),
    })
    const runtimeRegistry = nativeAreaRuntimeRegistry({
      canonicalId: 'Disarming Voice',
      predicate: {
        relationship: 'any',
        willingness: 'any',
        excludeActor: true,
        statePredicates: [{ kind: 'vitality', value: 'conscious' }],
      },
    })
    const resolution = resolveAuthoritativeMove({
      map,
      pokemonSheets: sheetMap([{ name: 'Disarming Voice' }], {
        'target-a': pokemonSheet('target-a', [], { combat: { currentHp: 0 } }),
      }),
      trainerSheets: new Map(),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName: 'Disarming Voice',
        selection: { kind: 'area', areaTemplateId: templateId(burstTemplate) },
      }),
      runtimeRegistry,
      random: () => { throw new Error('area state filtering must happen before RNG') },
    })

    expect(resolution.selectedTargetIds).toEqual(['target-b'])
    expect(resolution.area?.targetEvaluations).toContainEqual(expect.objectContaining({
      targetPlacementId: 'target-a',
      outcome: 'excluded',
      reasonCode: 'target-excluded-not-conscious',
    }))
    expect(resolution.sheetReads).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: 'target-a' }),
      expect.objectContaining({ slug: 'target-b' }),
    ]))
  })

  it('requires legal Close Blast and Ranged Blast aim cells and rejects blocked, out-of-range, and out-of-bounds aim', async () => {
    await withRegisteredMoveAutomationScript(areaScript('Heat Wave', [closeBlastTemplate]), () => {
      const closeBlast = resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Heat Wave' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Heat Wave', selection: { kind: 'area', areaTemplateId: templateId(closeBlastTemplate), aimCell: { x: 6, y: 0, z: 5 } } }),
      })
      expect(closeBlast.area?.aimCell).toEqual({ x: 6, y: 0, z: 5 })
      expect(closeBlast.area?.candidateTargetIds).toContain('target-a')

      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Heat Wave' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Heat Wave', selection: { kind: 'area', areaTemplateId: templateId(closeBlastTemplate) } }),
      }), 'area-placement-missing')
    })

    await withRegisteredMoveAutomationScript(areaScript('Swift', [rangedBlastTemplate], { keywords: ['Ranged 4 Blast 1', 'Friendly'] }), () => {
      const rangedBlast = resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Swift' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Swift', selection: { kind: 'area', areaTemplateId: templateId(rangedBlastTemplate), aimCell: { x: 6, y: 0, z: 5 } } }),
      })
      expect(rangedBlast.area?.aimCell).toEqual({ x: 6, y: 0, z: 5 })
      expect(rangedBlast.area?.candidateTargetIds).toEqual(['target-a'])

      for (const aimCell of [{ x: 11, y: 0, z: 11 }, { x: -1, y: 0, z: 5 }]) {
        expectFailure(() => resolveAuthoritativeMove({
          map: mapFixture(),
          pokemonSheets: sheetMap([{ name: 'Swift' }]),
          trainerSheets: new Map(),
          intent: moveIntent({ placementId: 'actor-token', moveName: 'Swift', selection: { kind: 'area', areaTemplateId: templateId(rangedBlastTemplate), aimCell } }),
        }), 'area-aim-cell-illegal')
      }

      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture({ voxels: [{ x: 6, y: 0, z: 5, materialId: 'cave_stone' }] }),
        pokemonSheets: sheetMap([{ name: 'Swift' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Swift', selection: { kind: 'area', areaTemplateId: templateId(rangedBlastTemplate), aimCell: { x: 6, y: 0, z: 5 } } }),
      }), 'area-aim-cell-illegal')
    })
  })

  it('rejects stale or unsupported authoritative geometry and template choices', async () => {
    await withRegisteredMoveAutomationScript(areaScript('Razor Leaf', [lineTemplate]), () => {
      const clear = resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Razor Leaf' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Razor Leaf', selection: { kind: 'area', areaTemplateId: templateId(lineTemplate), direction: 'east' } }),
      })
      expect(clear.area?.candidateTargetIds).toEqual(['target-a', 'target-c'])

      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture({ voxels: [{ x: 6, y: 0, z: 5, materialId: 'cave_stone' }] }),
        pokemonSheets: sheetMap([{ name: 'Razor Leaf' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Razor Leaf', selection: { kind: 'area', areaTemplateId: templateId(lineTemplate), direction: 'east' } }),
      }), 'area-geometry-empty')

      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Razor Leaf' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Razor Leaf', selection: { kind: 'area', areaTemplateId: 'burst:any:99', direction: 'east' } }),
      }), 'area-template-invalid')

      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Razor Leaf' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Razor Leaf', selection: { kind: 'area', areaTemplateId: templateId(lineTemplate), direction: 'sideways' as never } }),
      }), 'area-direction-illegal')
    })

    expectFailure(() => resolveAuthoritativeMove({
      map: mapFixture(),
      pokemonSheets: sheetMap([{ name: 'Scratch' }]),
      trainerSheets: new Map(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Scratch', selection: { kind: 'area', areaTemplateId: 'pass:any:4' } }),
    }), 'pass-direction-required')
  })

  it('applies Friendly exclusions only to authoritative area candidates', async () => {
    await withRegisteredMoveAutomationScript(areaScript('Swift', [burstTemplate], { keywords: ['Burst 1', 'Friendly'] }), () => {
      const excluded = ['target-a']
      const resolution = resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Swift' }]),
        trainerSheets: new Map(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Swift',
          selection: { kind: 'area', areaTemplateId: templateId(burstTemplate), excludedTargetPlacementIds: excluded },
        }),
      })

      expect(resolution.area?.candidateTargetIds).toEqual(['target-a', 'target-b'])
      expect(resolution.area?.excludedTargetIds).toEqual(['target-a'])
      expect(resolution.selectedTargetIds).toEqual(['target-b'])
      expect(resolution.transaction.attackedTargetIds).toEqual(['target-b'])
      expect(resolution.area?.excludedTargetIds).not.toBe(excluded)

      const allExcluded = resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Swift' }]),
        trainerSheets: new Map(),
        intent: moveIntent({
          placementId: 'actor-token',
          moveName: 'Swift',
          selection: { kind: 'area', areaTemplateId: templateId(burstTemplate), excludedTargetPlacementIds: ['target-a', 'target-b'] },
        }),
      })
      expect(allExcluded.selectedTargetIds).toEqual([])
      expect(allExcluded.transaction.attackedTargetIds).toEqual([])
      expect(allExcluded.desiredFacing).toBeUndefined()

      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Swift' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Swift', selection: { kind: 'area', areaTemplateId: templateId(burstTemplate), excludedTargetPlacementIds: ['far-target'] } }),
      }), 'area-friendly-exclusion-invalid')
    })

    await withRegisteredMoveAutomationScript(areaScript('Disarming Voice', [burstTemplate]), () => {
      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Disarming Voice' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Disarming Voice', selection: { kind: 'area', areaTemplateId: templateId(burstTemplate), excludedTargetPlacementIds: ['target-a'] } }),
      }), 'area-friendly-exclusion-invalid')
    })
  })

  it('excludes the actor from candidates, allows zero candidates, and resolves target branch area scripts', async () => {
    await withRegisteredMoveAutomationScript(areaScript('Swift', [rangedBlastTemplate], { keywords: ['Ranged 4 Blast 1', 'Friendly'] }), () => {
      const resolution = resolveAuthoritativeMove({
        map: mapFixture({ placements: [placement('actor-token', 'actor', { x: 5, y: 0, z: 5 })] }),
        pokemonSheets: sheetMap([{ name: 'Swift' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Swift', selection: { kind: 'area', areaTemplateId: templateId(rangedBlastTemplate), aimCell: { x: 5, y: 0, z: 5 } } }),
      })

      expect(resolution.area?.candidateTargetIds).toEqual([])
      expect(resolution.selectedTargetIds).toEqual([])
      expect(resolution.desiredFacing).toBeUndefined()
    })

    const branchResolution = resolveAuthoritativeMove({
      map: mapFixture(),
      pokemonSheets: sheetMap([{ name: 'Dragon Hammer' }]),
      trainerSheets: new Map(),
      intent: moveIntent({ placementId: 'actor-token', moveName: 'Dragon Hammer', targetBranchId: 'line-3', selection: { kind: 'area', areaTemplateId: templateId(lineTemplate), direction: 'east' } }),
    })
    expect(branchResolution.targetBranchId).toBe('line-3')
    expect(branchResolution.area?.candidateTargetIds).toEqual(['target-a', 'target-c'])
  })

  it.each([
    {
      moveName: 'Howl',
      expectedUpdates: [
        { id: 'actor-token', stages: { atk: 1, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 } },
        { id: 'target-a', stages: { atk: 1, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 } },
      ],
    },
    {
      moveName: 'Aromatic Mist',
      expectedUpdates: [
        { id: 'target-a', stages: { atk: 0, def: 0, satk: 0, sdef: 1, spd: 0, acc: 0 } },
      ],
    },
    {
      moveName: 'Coaching',
      expectedUpdates: [
        { id: 'actor-token', stages: { atk: 1, def: 1, satk: 0, sdef: 0, spd: 0, acc: 0 } },
        { id: 'target-a', stages: { atk: 1, def: 1, satk: 0, sdef: 0, spd: 0, acc: 0 } },
      ],
    },
  ])('filters $moveName Burst recipients by authoritative allegiance', ({ moveName, expectedUpdates }) => {
    const map = mapFixture({
      placements: [
        placement('actor-token', 'actor', { x: 5, y: 0, z: 5 }, 'red'),
        placement('target-a', 'target-a', { x: 6, y: 0, z: 5 }, 'red'),
        placement('target-b', 'target-b', { x: 5, y: 0, z: 4 }, 'blue'),
        placement('target-c', 'target-c', { x: 4, y: 0, z: 5 }),
      ],
      encounterState: redBlueEncounterStateFixture(),
    })
    const resolution = resolveAuthoritativeMove({
      map,
      pokemonSheets: sheetMap([{ name: moveName }], {
        'target-a': pokemonSheet('target-a', [], { species: 'Bulbasaur' }),
        'target-b': pokemonSheet('target-b', [], { species: 'Charmander' }),
        'target-c': pokemonSheet('target-c', [], { species: 'Squirtle' }),
      }),
      trainerSheets: new Map(),
      intent: moveIntent({
        placementId: 'actor-token',
        moveName,
        selection: { kind: 'area', areaTemplateId: templateId(burstTemplate) },
      }),
    })

    expect(resolution.script).toMatchObject({
      version: 2,
      areaTargetRelationship: 'ally',
    })
    expect(resolution.area?.candidateTargetIds).toEqual(['target-a', 'target-b', 'target-c'])
    expect(resolution.area?.excludedTargetIds).toEqual([])
    expect(resolution.area?.targetEvaluations).toEqual([
      expect.objectContaining({
        targetPlacementId: 'target-a',
        outcome: 'included',
        reasonCode: 'target-included',
      }),
      expect.objectContaining({
        targetPlacementId: 'target-b',
        outcome: 'excluded',
        reasonCode: 'target-excluded-not-ally',
        relationshipReasonCode: 'relationship-enemy',
      }),
      expect.objectContaining({
        targetPlacementId: 'target-c',
        outcome: 'excluded',
        reasonCode: 'target-excluded-unknown-side',
        relationshipReasonCode: 'relationship-unknown-side',
      }),
    ])
    expect(resolution.selectedTargetIds).toEqual(['target-a'])
    expect(resolution.transaction.attackedTargetIds).toEqual(['target-a'])
    expect(resolution.transaction.hitTargetIds).toEqual(['target-a'])
    expect(resolution.transaction.combatStageUpdates).toEqual(expectedUpdates)
    expect(resolution.transaction.combatStageUpdates.map(update => update.id)).not.toContain('target-b')
    expect(resolution.transaction.combatStageUpdates.map(update => update.id)).not.toContain('target-c')
    expect(resolution.transaction.logLines).toContainEqual(
      `Assisted ally targeting: ${moveName} checks explicit encounter sides; unknown allegiance is not eligible. Review side assignments in Prepare Map.`,
    )
    expect(resolution.transaction.logLines.join('\n')).not.toContain('target-b')
    expect(resolution.transaction.logLines.join('\n')).not.toContain('target-c')
    expect(resolution.transaction.logLines.join('\n')).not.toContain('relationship-enemy')
    expect(resolution.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'target',
        targetId: 'target-a',
        outcome: 'included',
        reasonCode: 'target-included',
      }),
      expect.objectContaining({
        kind: 'target',
        targetId: 'target-b',
        outcome: 'excluded',
        reasonCode: 'target-excluded-not-ally',
      }),
      expect.objectContaining({
        kind: 'target',
        targetId: 'target-c',
        outcome: 'excluded',
        reasonCode: 'target-excluded-unknown-side',
      }),
    ]))
  })

  it('resolves area transactions, field effects, unknown-side Sweet Veil, facing, and input immutability', async () => {
    const damaging = areaScript('Swift', [burstTemplate], {
      damaging: true,
      requiresAccuracy: true,
      damageBase: 6,
      damageClass: 'Special',
      type: 'Fire',
      ac: 2,
      keywords: ['Burst 1'],
    })
    await withRegisteredMoveAutomationScript(damaging, () => {
      const common = {
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Swift' }]),
        trainerSheets: new Map<string, TrainerSheet>(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Swift', selection: { kind: 'area', areaTemplateId: templateId(burstTemplate) } }),
      }
      const low = resolveAuthoritativeMove({ ...common, random: randomSequence([0.99, 0, 0.99, 0]) })
      const high = resolveAuthoritativeMove({ ...common, random: randomSequence([0.99, 0.99, 0.99, 0.99]) })
      const sunny = resolveAuthoritativeMove({
        ...common,
        map: mapFixture({ fieldEffects: { weather: [{ kind: 'sunny' }], terrains: [], rooms: [] } }),
        random: randomSequence([0.99, 0, 0.99, 0]),
      })

      expect(high.transaction.hpUpdates).not.toEqual(low.transaction.hpUpdates)
      expect(sunny.transaction.hpUpdates).not.toEqual(low.transaction.hpUpdates)
      expect(low.transaction.attackedTargetIds).toEqual(['target-a', 'target-b'])
      expect(low.transaction.hitTargetIds).toContain('target-a')
    })

    await withRegisteredMoveAutomationScript(areaScript('Tail Whip', [burstTemplate], {
      keywords: ['Burst 1'],
      stageSuggestions: [{ recipient: 'target', key: 'def', delta: -1, label: 'Defense down' }],
    }), () => {
      const resolution = resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap([{ name: 'Tail Whip' }]),
        trainerSheets: new Map(),
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Tail Whip', selection: { kind: 'area', areaTemplateId: templateId(burstTemplate) } }),
      })
      expect(resolution.transaction.combatStageUpdates.map((update) => update.id)).toEqual(['target-a', 'target-b'])
    })

    await withRegisteredMoveAutomationScript(areaScript('Poison Gas', [burstTemplate], {
      keywords: ['Burst 1'],
      conditionSuggestions: [{ recipient: 'target', condition: 'Sleep', action: 'add', label: 'Sleep', applyWhen: 'always' }],
    }), () => {
      const map = mapFixture()
      const pokemonSheets = sheetMap([{ name: 'Poison Gas' }], {
        actor: pokemonSheet('actor', [{ name: 'Poison Gas' }], { abilities: [{ name: 'Sweet Veil' }] }),
      })
      const trainerSheets = new Map<string, TrainerSheet>()
      const before = snapshotInput(map, pokemonSheets, trainerSheets)
      const resolution = resolveAuthoritativeMove({
        map,
        pokemonSheets,
        trainerSheets,
        intent: moveIntent({ placementId: 'actor-token', moveName: 'Poison Gas', selection: { kind: 'area', areaTemplateId: templateId(burstTemplate) } }),
      })

      expect(resolution.script.conditionSuggestions).toHaveLength(1)
      expect(resolution.transaction.conditionUpdates).toEqual([
        { id: 'target-a', conditions: ['Sleep'] },
        { id: 'target-b', conditions: ['Sleep'] },
      ])
      expect(snapshotInput(map, pokemonSheets, trainerSheets)).toBe(before)

      const templateBefore = resolution.area!.template
      const cellBefore = resolution.area!.cells[0]
      expect(templateBefore).toEqual(burstTemplate)
      expect(templateBefore).not.toBe(burstTemplate)
      expect(cellBefore).not.toBe(map.placements[0]!.position)
    })
  })
})
