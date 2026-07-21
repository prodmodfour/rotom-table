import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { isAuthoritativePendingMoveStatePlan, planAuthoritativeMoveState, planAuthoritativeMoveStateExecution } from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'

const sheet = (input: { slug: string; move?: string; ability?: string; types?: string[]; hp?: number }): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  types: input.types ?? ['Normal'], abilities: input.ability ? [{ name: input.ability }] : [], movelist: input.move ? [{ name: input.move }] : [],
  stats: { hp: { added: 25 }, atk: { added: 45 }, def: { added: 6 }, satk: { added: 25 }, sdef: { added: 6 }, spd: { added: 15 } },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.hp ?? 100, injuries: 0, conditions: [] },
})
const map = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
    { id: 'nearby-foe', sheetKind: 'pokemon', sheetSlug: 'nearby-foe', sideId: 'foes', position: { x: 1, y: 0, z: 3 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5, dimensions: { x: 10, y: 4, z: 6 }, groundLevelY: 0,
    playerVisible: true, voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' }, foes: { id: 'foes', label: 'Foes', status: 'active' } },
      history: { ...encounter.history, sceneId: `scene:${slug}` },
      turnResources: Object.fromEntries(placements.map(placement => [placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 })])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
const declare = (input: { slug: string; move: string; ability: string; targetHp?: number; actorTypes?: string[] }) => {
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move: input.move, ability: input.ability, types: input.actorTypes })],
    ['target', sheet({ slug: 'target', hp: input.targetHp })],
    ['nearby-foe', sheet({ slug: 'nearby-foe' })],
  ])
  const declaration = planAuthoritativeMoveStateExecution({
    map: map(input.slug), pokemonSheets, trainerSheets: new Map(),
    intent: { schemaVersion: 1, placementId: 'actor', moveName: input.move, selection: { kind: 'single-target', targetPlacementId: 'target' } },
    random: () => 0.5, now: () => 1_000, operationId: `op_${input.slug}`, pendingResolutionId: `resolution:${input.slug}`,
  })
  expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
  if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected AA-063 trigger response.')
  return { declaration, pokemonSheets }
}
const completeFirstWindow = (input: ReturnType<typeof declare>, optionId: string) => {
  const pending = input.declaration.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending), map: structuredClone(input.declaration.nextMap),
    pokemonSheets: input.pokemonSheets, trainerSheets: new Map(), response: { requestId: window.windowId, optionId },
    now: 2_000, random: () => 0.5,
  })
  const plan = planResumedMoveState({
    pendingResolution: pending, declarationPlan: input.declaration.suspension.preWindowPlan,
    responseOpId: `op_response_${optionId.replaceAll(/[^a-z0-9]/gi, '').toLowerCase()}`,
    responseWindowId: window.windowId, responseOptionId: optionId,
    chosenBy: { kind: 'actor', id: null }, map: input.declaration.nextMap,
    pokemonSheets: input.pokemonSheets, trainerSheets: new Map(), execution, plannedAt: 2_000,
  })
  return { pending, window, execution, plan }
}

describe('AA-063 triggered abilities', () => {
  it('does not open AA-063 trigger windows when effectiveness, damage, or KO facts fail', () => {
    const immediate = (input: { slug: string; move: string; ability: string; targetHp?: number; targetTypes?: string[] }) => {
      const pokemonSheets = new Map<string, CharacterSheet>([
        ['actor', sheet({ slug: 'actor', move: input.move, ability: input.ability })],
        ['target', sheet({ slug: 'target', hp: input.targetHp, types: input.targetTypes })],
        ['nearby-foe', sheet({ slug: 'nearby-foe' })],
      ])
      return planAuthoritativeMoveStateExecution({
        map: map(input.slug), pokemonSheets, trainerSheets: new Map(),
        intent: { schemaVersion: 1, placementId: 'actor', moveName: input.move, selection: { kind: 'single-target', targetPlacementId: 'target' } },
        random: () => 0.5, now: () => 1_000, operationId: `op_${input.slug}`,
      })
    }
    expect(isAuthoritativePendingMoveStatePlan(immediate({
      slug: 'aa063-bully-ineligible', move: 'Karate Chop', ability: 'Bully', targetTypes: ['Fighting'],
    }))).toBe(false)
    expect(isAuthoritativePendingMoveStatePlan(immediate({
      slug: 'aa063-celebrate-ineligible', move: 'Charm', ability: 'Celebrate',
    }))).toBe(false)
    expect(isAuthoritativePendingMoveStatePlan(immediate({
      slug: 'aa063-chilling-neigh-ineligible', move: 'Tackle', ability: 'Chilling Neigh', targetHp: 100,
    }))).toBe(false)
  }, 20_000)
  it('aa063.bully.reviewed pushes, Trips, injures, and spends its Scene Free Action only on super-effective melee damage', () => {
    const declared = declare({ slug: 'aa063-bully', move: 'Karate Chop', ability: 'Bully', actorTypes: ['Fighting'], targetHp: 300 })
    const result = completeFirstWindow(declared, 'ability.bully.use')
    expect(isAuthoritativePendingMoveResolution(result.execution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(result.execution)) throw new Error('Bully unexpectedly remained pending.')
    const target = result.plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(target.combat?.conditions).toContain('Tripped')
    const baselineSheets = new Map<string, CharacterSheet>([
      ['actor', sheet({ slug: 'actor', move: 'Karate Chop', types: ['Fighting'] })],
      ['target', sheet({ slug: 'target', hp: 300 })],
      ['nearby-foe', sheet({ slug: 'nearby-foe' })],
    ])
    const baseline = planAuthoritativeMoveState({
      map: map('aa063-bully-baseline'), pokemonSheets: baselineSheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Karate Chop', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.5, now: () => 1_000, operationId: 'op_aa063_bully_baseline',
    })
    const baselineTarget = baseline.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(target.combat?.injuries).toBe((baselineTarget.combat?.injuries ?? 0) + 1)
    expect(result.plan.nextMap.placements.find(placement => placement.id === 'target')?.position.x).toBeGreaterThan(2)
    expect(result.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(result.plan.nextMap.encounterState?.abilityUsage?.entries[0]).toMatchObject({ canonicalId: 'Bully', spent: 1 })
  }, 20_000)

  it('aa063.chilling-neigh.reviewed raises Attack and applies a one-round -2 Evasion effect to nearby foes after a KO', () => {
    const declared = declare({ slug: 'aa063-chilling-neigh', move: 'Tackle', ability: 'Chilling Neigh', targetHp: 1 })
    const result = completeFirstWindow(declared, 'ability.chilling-neigh.use')
    expect(isAuthoritativePendingMoveResolution(result.execution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(result.execution)) throw new Error('Chilling Neigh unexpectedly remained pending.')
    const actor = result.plan.sheetWrites.find(write => write.slug === 'actor')?.nextSheet as CharacterSheet
    expect(Math.max(actor.combatStages?.atk ?? 0, actor.stats?.atk?.stage ?? 0)).toBe(1)
    expect(result.plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'numeric-modifier', affected: expect.objectContaining({ placementIds: expect.arrayContaining(['target', 'nearby-foe']) }),
      duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      payload: expect.objectContaining({ attribute: 'evasion', value: -2 }),
    }))
    expect(result.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
  }, 20_000)

  it('aa063.celebrate.reviewed opens a durable one-meter Disengage choice and prepays Swift plus Free', () => {
    const declared = declare({ slug: 'aa063-celebrate', move: 'Water Gun', ability: 'Celebrate' })
    const result = completeFirstWindow(declared, 'ability.celebrate.use')
    expect(isAuthoritativePendingMoveResolution(result.execution)).toBe(true)
    expect(isAuthoritativePendingMoveStatePlan(result.plan)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(result.plan)) throw new Error('Expected durable Disengage choice.')
    expect(result.plan.suspension.pendingResolution.outstandingWindows[0]).toMatchObject({
      kind: 'choice', ownership: [{ kind: 'actor', id: null }],
    })
    const secondPending = result.plan.suspension.pendingResolution
    const secondWindow = secondPending.outstandingWindows[0]!
    const destination = secondWindow.options.find(option => option.id !== null)!
    const secondExecution = resumeMoveSpec({
      pendingResolution: structuredClone(secondPending), map: structuredClone(result.plan.nextMap),
      pokemonSheets: declared.pokemonSheets, trainerSheets: new Map(),
      response: { requestId: secondWindow.windowId, optionId: destination.id }, now: 3_000, random: () => 0.5,
    })
    expect(isAuthoritativePendingMoveResolution(secondExecution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(secondExecution)) throw new Error('Celebrate movement remained pending.')
    const completed = planResumedMoveState({
      pendingResolution: secondPending, declarationPlan: result.plan.suspension.preWindowPlan,
      responseOpId: 'op_response_celebrate_destination', responseWindowId: secondWindow.windowId,
      responseOptionId: destination.id, chosenBy: { kind: 'actor', id: null },
      map: result.plan.nextMap, pokemonSheets: declared.pokemonSheets, trainerSheets: new Map(),
      execution: secondExecution, plannedAt: 3_000,
    })
    expect(isAuthoritativePendingMoveStatePlan(completed)).toBe(false)
    expect(completed.nextMap.encounterState?.turnResources.actor?.actions).toMatchObject({
      swift: { spent: 1 }, free: { spent: 1 },
    })
  }, 20_000)
})
