import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { isAuthoritativePendingMoveStatePlan, planAuthoritativeMoveStateExecution } from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'

const sheet = (input: {
  slug: string
  move?: string
  ability?: string
  hp?: number
  stats?: Partial<Record<'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd', number>>
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug,
  species: input.slug === 'actor' ? 'Squirtle' : input.slug === 'target' ? 'Snorlax' : 'Pikachu',
  level: 20, revision: 3,
  types: ['Normal'],
  abilities: input.ability ? [{ name: input.ability }] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: Object.fromEntries(Object.entries(input.stats ?? {}).map(([key, added]) => [key, { added }])) as CharacterSheet['stats'],
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.hp ?? 100, conditions: [] },
})

const map = (slug: string, placements: TabletopMap['placements']): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug, name: slug, revision: 7,
    dimensions: { x: 8, y: 4, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: { ...encounter.history, sceneId: `scene:${slug}` },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id, createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}

const completePending = (input: {
  map: TabletopMap
  pokemonSheets: ReadonlyMap<string, CharacterSheet>
  moveName: string
  operationId: string
  optionId: string | null
  randomValues: number[]
  owner: { kind: 'actor' | 'target'; id: string | null }
}) => {
  const declaration = planAuthoritativeMoveStateExecution({
    map: input.map, pokemonSheets: input.pokemonSheets, trainerSheets: new Map(),
    intent: { schemaVersion: 1, placementId: 'actor', moveName: input.moveName, selection: { kind: 'single-target', targetPlacementId: 'target' } },
    random: () => input.randomValues.shift() ?? 0,
    now: () => 1_000,
    operationId: input.operationId,
    pendingResolutionId: `resolution:${input.operationId}`,
  })
  expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
  if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected ability response.')
  const pending = declaration.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending), map: structuredClone(declaration.nextMap),
    pokemonSheets: input.pokemonSheets, trainerSheets: new Map(),
    response: { requestId: window.windowId, optionId: input.optionId },
    now: 2_000, random: () => 0,
  })
  expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected completed move.')
  const plan = planResumedMoveState({
    pendingResolution: pending, declarationPlan: declaration.suspension.preWindowPlan,
    responseOpId: `op_response_${input.operationId.replaceAll(/[^a-z0-9]/gi, '').slice(-24)}`,
    responseWindowId: window.windowId, responseOptionId: input.optionId,
    chosenBy: input.owner.kind === 'actor'
      ? { kind: 'actor', id: null }
      : { kind: 'target', id: input.owner.id },
    map: declaration.nextMap, pokemonSheets: input.pokemonSheets, trainerSheets: new Map(),
    execution, plannedAt: 2_000,
  })
  return { declaration, execution, plan, window }
}

describe('AA-061 durable move triggers', () => {
  it('aa061.aqua-boost.single-provider gives one adjacent allied response and +5 damage', () => {
    const placements: TabletopMap['placements'] = [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
      { id: 'provider', sheetKind: 'pokemon', sheetSlug: 'provider', sideId: 'heroes', position: { x: 2, y: 0, z: 1 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 3, y: 0, z: 1 } },
    ]
    const pokemonSheets = new Map<string, CharacterSheet>([
      ['actor', sheet({ slug: 'actor', move: 'Water Gun', stats: { satk: 20, def: 10, sdef: 10 } })],
      ['provider', sheet({ slug: 'provider', ability: 'Aqua Boost', stats: { def: 10, sdef: 10 } })],
      ['target', sheet({ slug: 'target', stats: { def: 10, sdef: 10 } })],
    ])
    const accepted = completePending({
      map: map('aqua-boost', placements), pokemonSheets, moveName: 'Water Gun',
      operationId: 'op_aqua_boost_use', optionId: 'ability.aqua-boost.use',
      randomValues: [0.5, 0, 0, 0], owner: { kind: 'target', id: 'provider' },
    })
    const passed = completePending({
      map: map('aqua-boost', placements), pokemonSheets, moveName: 'Water Gun',
      operationId: 'op_aqua_boost_pass', optionId: null,
      randomValues: [0.5, 0, 0, 0], owner: { kind: 'target', id: 'provider' },
    })
    const hp = (result: typeof accepted): number => result.execution.transaction.hpUpdates
      .find(update => update.id === 'target')?.currentHp ?? 100
    expect(hp(passed) - hp(accepted)).toBe(5)
    expect(accepted.window).toMatchObject({ ownership: [{ kind: 'target', id: 'provider' }] })
    expect(accepted.plan.nextMap.encounterState?.turnResources.provider?.actions.free.spent).toBe(1)
    expect(accepted.plan.nextMap.encounterState?.abilityUsage?.entries).toEqual([])
  }, 20_000)

  it('aa061.beast-boost.highest-stat offers only after an opponent faints and raises the highest stat', () => {
    const placements: TabletopMap['placements'] = [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
    ]
    const pokemonSheets = new Map<string, CharacterSheet>([
      ['actor', sheet({ slug: 'actor', move: 'Tackle', ability: 'Beast Boost', stats: { atk: 30, def: 10, satk: 5, sdef: 10, spd: 20 } })],
      ['target', sheet({ slug: 'target', hp: 1, stats: { def: 5, sdef: 5 } })],
    ])
    const accepted = completePending({
      map: map('beast-boost', placements), pokemonSheets, moveName: 'Tackle',
      operationId: 'op_beast_boost', optionId: 'ability.beast-boost.attack',
      randomValues: [0.5, 0, 0, 0], owner: { kind: 'actor', id: null },
    })
    expect(accepted.window.options).toEqual([expect.objectContaining({ id: 'ability.beast-boost.attack' })])
    expect(accepted.execution.transaction.combatStageUpdates).toContainEqual(expect.objectContaining({
      id: 'actor', stages: expect.objectContaining({ atk: 1 }),
    }))
    expect(accepted.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(accepted.plan.nextMap.encounterState?.abilityUsage?.entries).toEqual([])
  }, 20_000)
})
