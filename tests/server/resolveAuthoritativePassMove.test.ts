import { describe, expect, it } from 'vitest'
import { LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION, type ResolveMoveIntent } from '#shared/livePlayMoveResolution'
import {
  AuthoritativeMoveResolutionError,
  resolveAuthoritativeMove,
} from '../../server/domain/resolveAuthoritativeMove'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '~/utils/moveAutomation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import { passDestinationLogLine } from '~/utils/moveAutomationPass'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationAreaTemplate, MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'

const passTemplate: MoveAutomationAreaTemplate = { kind: 'pass', size: 4, label: 'Pass 4' }
const passTemplateId = moveAutomationAreaTemplateId(passTemplate)

const moveIntent = (overrides: Omit<ResolveMoveIntent, 'schemaVersion'>): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  ...overrides,
})

const placement = (id: string, sheetSlug = id, position = { x: 0, y: 0, z: 0 }): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position,
})

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'pass-resolution-test',
  name: 'Pass Resolution Test',
  dimensions: { x: 8, y: 3, z: 4 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
    placement('target-b', 'target-b', { x: 3, y: 0, z: 1 }),
    placement('target-a', 'target-a', { x: 2, y: 0, z: 1 }),
    placement('occupied-end', 'occupied-end', { x: 5, y: 0, z: 1 }),
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
  actorMoves: CharacterSheetMove[] = [{ name: 'Aqua Tail' }],
  slugs: readonly string[] = ['actor', 'target-a', 'target-b', 'occupied-end', 'far-target'],
  overrides: Record<string, CharacterSheet> = {},
): Map<string, CharacterSheet> => new Map<string, CharacterSheet>([
  ...slugs.map((slug) => [slug, pokemonSheet(slug)] as const),
  ['actor', pokemonSheet('actor', actorMoves, { nickname: 'Scratcher', species: 'Meowth' })],
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

const passScript = (overrides: Partial<MoveAutomationScript> = {}): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Aqua Tail',
  version: 1,
  targetMode: 'multi-target',
  targetCount: null,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass: 'Physical',
  type: 'Normal',
  ac: 2,
  range: 'Melee, Pass',
  effect: 'Authoritative Pass-resolution test script.',
  keywords: ['Pass 4'],
  criticalRange: null,
  areaTemplates: [passTemplate],
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
  ...overrides,
})

const withRegisteredScratchScript = async <T>(script: MoveAutomationScript, run: () => T | Promise<T>): Promise<T> => {
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

const passIntent = (selection: ResolveMoveIntent['selection'] = {
  kind: 'area',
  areaTemplateId: passTemplateId,
  direction: 'east',
}): ResolveMoveIntent => moveIntent({
  placementId: 'actor-token',
  moveName: 'Aqua Tail',
  selection,
})

describe('resolveAuthoritativeMove Pass area selections', () => {
  it('resolves Pass geometry, targets, movement, facing, transaction, log line, and clones', async () => {
    const alternativeLineTemplate: MoveAutomationAreaTemplate = { kind: 'line', size: 3, label: 'Line 3' }
    const registeredScript = passScript({
      range: 'Pass 4 or Line 3, Dash',
      keywords: ['Pass 4', 'Line 3', 'Dash'],
      areaTemplates: [passTemplate, alternativeLineTemplate],
    })
    await withRegisteredScratchScript(registeredScript, () => {
      const map = mapFixture()
      const pokemonSheets = sheetMap()
      const trainerSheets = new Map<string, TrainerSheet>()
      const before = snapshotInput(map, pokemonSheets, trainerSheets)

      const resolution = resolveAuthoritativeMove({
        map,
        pokemonSheets,
        trainerSheets,
        intent: passIntent(),
        random: randomSequence([0.99, 0, 0.99, 0]),
      })

      expect(resolution.area).toMatchObject({
        areaTemplateId: passTemplateId,
        template: passTemplate,
        direction: 'east',
        candidateTargetIds: ['target-b', 'target-a'],
        excludedTargetIds: [],
      })
      expect(resolution.area?.cells).toEqual([
        { x: 2, y: 0, z: 1 },
        { x: 3, y: 0, z: 1 },
        { x: 4, y: 0, z: 1 },
      ])
      expect(resolution.selectedTargetIds).toEqual(['target-b', 'target-a'])
      expect(resolution.transaction.attackedTargetIds).toEqual(['target-b', 'target-a'])
      expect(resolution.transaction.hpUpdates.map((update) => update.id)).toContain('target-b')
      expect(resolution.desiredFacing).toBe('north-east')
      expect(resolution.movement).toEqual({
        kind: 'pass',
        from: { x: 1, y: 0, z: 1 },
        destination: { x: 4, y: 0, z: 1 },
        direction: 'east',
        pathCells: [
          { x: 2, y: 0, z: 1 },
          { x: 3, y: 0, z: 1 },
          { x: 4, y: 0, z: 1 },
        ],
      })
      expect(resolution.script.areaTemplates).toEqual([passTemplate])
      expect(resolution.script.keywords).toEqual(['Pass 4', 'Dash'])
      expect(registeredScript.areaTemplates).toEqual([passTemplate, alternativeLineTemplate])
      expect(resolution.script.areaTemplates).not.toBe(registeredScript.areaTemplates)
      expect(resolution.area?.cells).not.toBe(resolution.movement?.pathCells)
      const mutableMovementCells = resolution.movement?.pathCells as Array<{ x: number; y: number; z: number }>
      mutableMovementCells[0]!.x = 99
      expect(resolution.area?.cells[0]).toEqual({ x: 2, y: 0, z: 1 })

      const destinationLine = passDestinationLogLine({ species: 'Scratcher' }, { x: 4, y: 0, z: 1 })
      expect(resolution.transaction.logLines.filter((line) => line === destinationLine)).toHaveLength(1)
      expect(snapshotInput(map, pokemonSheets, trainerSheets)).toBe(before)
    })
  })

  it('uses oracle capability limits and records every occupancy sheet read', async () => {
    await withRegisteredScratchScript(passScript(), () => {
      const resolution = resolveAuthoritativeMove({
        map: mapFixture({
          placements: [
            placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
            placement('target-a', 'target-a', { x: 2, y: 0, z: 1 }),
            placement('far-target', 'far-target', { x: 7, y: 0, z: 1 }),
          ],
        }),
        pokemonSheets: sheetMap([{ name: 'Aqua Tail' }], ['actor', 'target-a', 'far-target'], {
          actor: pokemonSheet('actor', [{ name: 'Aqua Tail' }], {
            nickname: 'Scratcher',
            species: 'Meowth',
            revision: 3,
            capabilities: { overland: 2, swim: 0, sky: 0, levitate: 0, burrow: 0 },
          }),
          'target-a': pokemonSheet('target-a', [], { revision: 4 }),
          'far-target': pokemonSheet('far-target', [], { revision: 5 }),
        }),
        trainerSheets: new Map(),
        intent: passIntent(),
        random: randomSequence([0.99, 0]),
      })

      expect(resolution.movement).toMatchObject({
        destination: { x: 3, y: 0, z: 1 },
        pathCells: [
          { x: 2, y: 0, z: 1 },
          { x: 3, y: 0, z: 1 },
        ],
      })
      expect(resolution.area?.candidateTargetIds).toEqual(['target-a'])
      expect(resolution.sheetReads).toEqual([
        { kind: 'pokemon', slug: 'actor', revision: 3 },
        { kind: 'pokemon', slug: 'target-a', revision: 4 },
        { kind: 'pokemon', slug: 'far-target', revision: 5 },
      ])
    })
  })

  it('rejects missing direction, aim cells, invalid directions, and unavailable destinations without mutating inputs', async () => {
    await withRegisteredScratchScript(passScript(), () => {
      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap(),
        trainerSheets: new Map(),
        intent: passIntent({ kind: 'area', areaTemplateId: passTemplateId }),
      }), 'pass-direction-required')

      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap(),
        trainerSheets: new Map(),
        intent: passIntent({ kind: 'area', areaTemplateId: passTemplateId, direction: 'east', aimCell: { x: 2, y: 0, z: 1 } }),
      }), 'pass-aim-cell-unexpected')

      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap(),
        trainerSheets: new Map(),
        intent: passIntent({ kind: 'area', areaTemplateId: passTemplateId, direction: 'sideways' as never }),
      }), 'area-direction-illegal')

      const blockedMap = mapFixture({
        placements: [
          placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
          ...[2, 3, 4, 5].map((x) => placement(`blocker-${x}`, `blocker-${x}`, { x, y: 0, z: 1 })),
        ],
      })
      const pokemonSheets = sheetMap([{ name: 'Aqua Tail' }], ['actor', 'blocker-2', 'blocker-3', 'blocker-4', 'blocker-5'])
      const trainerSheets = new Map<string, TrainerSheet>()
      const before = snapshotInput(blockedMap, pokemonSheets, trainerSheets)
      expectFailure(() => resolveAuthoritativeMove({
        map: blockedMap,
        pokemonSheets,
        trainerSheets,
        intent: passIntent(),
      }), 'pass-destination-unavailable')
      expect(snapshotInput(blockedMap, pokemonSheets, trainerSheets)).toBe(before)
    })
  })

  it('uses current voxels and token positions rather than stale client preview movement fields', async () => {
    await withRegisteredScratchScript(passScript(), () => {
      const resolution = resolveAuthoritativeMove({
        map: mapFixture({
          voxels: [{ x: 4, y: 0, z: 1, materialId: 'cave_stone' }],
          placements: [
            placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
            placement('target-a', 'target-a', { x: 2, y: 0, z: 1 }),
          ],
        }),
        pokemonSheets: sheetMap([{ name: 'Aqua Tail' }], ['actor', 'target-a']),
        trainerSheets: new Map(),
        intent: passIntent({
          kind: 'area',
          areaTemplateId: passTemplateId,
          direction: 'east',
          destination: { x: 5, y: 0, z: 1 },
          pathCells: [{ x: 5, y: 0, z: 1 }],
        } as never),
        random: randomSequence([0.99, 0]),
      })

      expect(resolution.movement?.destination).toEqual({ x: 3, y: 0, z: 1 })
      expect(resolution.area?.cells).toEqual([{ x: 2, y: 0, z: 1 }, { x: 3, y: 0, z: 1 }])
      expect(resolution.area?.candidateTargetIds).toEqual(['target-a'])
    })
  })

  it('returns Pass facing and movement even when no targets are crossed', async () => {
    await withRegisteredScratchScript(passScript({ damaging: false, requiresAccuracy: false, damageBase: null, damageClass: 'Status', ac: null }), () => {
      const resolution = resolveAuthoritativeMove({
        map: mapFixture({ placements: [placement('actor-token', 'actor', { x: 1, y: 0, z: 1 })] }),
        pokemonSheets: sheetMap([{ name: 'Aqua Tail' }], ['actor']),
        trainerSheets: new Map(),
        intent: passIntent(),
      })

      expect(resolution.area?.candidateTargetIds).toEqual([])
      expect(resolution.selectedTargetIds).toEqual([])
      expect(resolution.movement?.destination).toEqual({ x: 5, y: 0, z: 1 })
      expect(resolution.desiredFacing).toBe('north-east')
      expect(resolution.transaction.attackedTargetIds).toEqual([])
    })
  })

  it('applies Friendly exclusions only to authoritative crossed Pass candidates without changing movement', async () => {
    const friendlyScript = passScript({
      damaging: false,
      requiresAccuracy: false,
      damageBase: null,
      damageClass: 'Status',
      ac: null,
      keywords: ['Pass 4', 'Friendly'],
      stageSuggestions: [{ recipient: 'target', key: 'def', delta: -1, label: 'Defense down' }],
      conditionSuggestions: [{ recipient: 'target', condition: 'Sleep', action: 'add', label: 'Sleep', applyWhen: 'always' }],
    })

    await withRegisteredScratchScript(friendlyScript, () => {
      const excluded = ['target-a']
      const resolution = resolveAuthoritativeMove({
        map: mapFixture({
          placements: [
            placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
            placement('target-a', 'target-a', { x: 2, y: 0, z: 1 }),
            placement('target-b', 'target-b', { x: 3, y: 0, z: 1 }),
          ],
        }),
        pokemonSheets: sheetMap([{ name: 'Aqua Tail' }], ['actor', 'target-a', 'target-b']),
        trainerSheets: new Map(),
        intent: passIntent({ kind: 'area', areaTemplateId: passTemplateId, direction: 'east', excludedTargetPlacementIds: excluded }),
      })

      expect(resolution.area?.candidateTargetIds).toEqual(['target-a', 'target-b'])
      expect(resolution.area?.excludedTargetIds).toEqual(['target-a'])
      expect(resolution.area?.excludedTargetIds).not.toBe(excluded)
      expect(resolution.selectedTargetIds).toEqual(['target-b'])
      expect(resolution.transaction.combatStageUpdates.map((update) => update.id)).toEqual(['target-b'])
      expect(resolution.transaction.conditionUpdates.map((update) => update.id)).toEqual(['target-b'])
      expect(resolution.movement?.destination).toEqual({ x: 5, y: 0, z: 1 })

      const allExcluded = resolveAuthoritativeMove({
        map: mapFixture({
          placements: [
            placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
            placement('target-a', 'target-a', { x: 2, y: 0, z: 1 }),
            placement('target-b', 'target-b', { x: 3, y: 0, z: 1 }),
          ],
        }),
        pokemonSheets: sheetMap([{ name: 'Aqua Tail' }], ['actor', 'target-a', 'target-b']),
        trainerSheets: new Map(),
        intent: passIntent({ kind: 'area', areaTemplateId: passTemplateId, direction: 'east', excludedTargetPlacementIds: ['target-a', 'target-b'] }),
      })
      expect(allExcluded.selectedTargetIds).toEqual([])
      expect(allExcluded.transaction.attackedTargetIds).toEqual([])
      expect(allExcluded.transaction.combatStageUpdates).toEqual([])
      expect(allExcluded.movement?.destination).toEqual({ x: 5, y: 0, z: 1 })

      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture({
          placements: [
            placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
            placement('target-a', 'target-a', { x: 2, y: 0, z: 1 }),
            placement('far-target', 'far-target', { x: 6, y: 0, z: 1 }),
          ],
        }),
        pokemonSheets: sheetMap([{ name: 'Aqua Tail' }], ['actor', 'target-a', 'far-target']),
        trainerSheets: new Map(),
        intent: passIntent({ kind: 'area', areaTemplateId: passTemplateId, direction: 'east', excludedTargetPlacementIds: ['far-target'] }),
      }), 'area-friendly-exclusion-invalid')

      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap(),
        trainerSheets: new Map(),
        intent: passIntent({ kind: 'area', areaTemplateId: passTemplateId, direction: 'east', excludedTargetPlacementIds: ['target-a', 'target-a'] }),
      }), 'area-friendly-exclusion-invalid')
    })

    await withRegisteredScratchScript(passScript(), () => {
      expectFailure(() => resolveAuthoritativeMove({
        map: mapFixture(),
        pokemonSheets: sheetMap(),
        trainerSheets: new Map(),
        intent: passIntent({ kind: 'area', areaTemplateId: passTemplateId, direction: 'east', excludedTargetPlacementIds: ['target-a'] }),
      }), 'area-friendly-exclusion-invalid')
    })
  })

  it('uses injected randomness and field effects while failing unknown-side Sweet Veil providers closed', async () => {
    await withRegisteredScratchScript(passScript({ type: 'Fire' }), () => {
      const common = {
        map: mapFixture(),
        pokemonSheets: sheetMap(),
        trainerSheets: new Map<string, TrainerSheet>(),
        intent: passIntent(),
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
    })

    await withRegisteredScratchScript(passScript({
      damaging: false,
      requiresAccuracy: false,
      damageBase: null,
      damageClass: 'Status',
      ac: null,
      conditionSuggestions: [{ recipient: 'target', condition: 'Sleep', action: 'add', label: 'Sleep', applyWhen: 'always' }],
    }), () => {
      const resolution = resolveAuthoritativeMove({
        map: mapFixture({
          placements: [
            placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
            placement('target-a', 'target-a', { x: 2, y: 0, z: 1 }),
          ],
        }),
        pokemonSheets: sheetMap([{ name: 'Aqua Tail' }], ['actor', 'target-a'], {
          actor: pokemonSheet('actor', [{ name: 'Aqua Tail' }], { nickname: 'Scratcher', abilities: [{ name: 'Sweet Veil' }] }),
        }),
        trainerSheets: new Map(),
        intent: passIntent(),
      })

      expect(resolution.selectedTargetIds).toEqual(['target-a'])
      expect(resolution.transaction.conditionUpdates).toEqual([{ id: 'target-a', conditions: ['Sleep'] }])
    })
  })
})
