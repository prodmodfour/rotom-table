import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveState,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'

const slugId = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${slugId(canonicalId)}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const sheet = (input: {
  slug: string
  abilities?: readonly string[]
  move?: string
  types?: readonly string[]
  held?: string
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 30,
  revision: 3,
  types: [...(input.types ?? ['Normal'])],
  abilities: (input.abilities ?? []).map(ability),
  movelist: [{ name: input.move ?? 'Tackle' }],
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 300, injuries: 0, conditions: [] },
  ...(input.held ? { items: { held: input.held } } : {}),
})

const fixture = (input: {
  slug: string
  actorAbility?: string
  targetAbility?: string
  allyAbility?: string
  move?: string
  actorHeld?: string
  targetTypes?: readonly string[]
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 3, y: 0, z: 2 } },
    ...(input.allyAbility ? [{
      id: 'ally', sheetKind: 'pokemon' as const, sheetSlug: 'ally', sideId: 'heroes',
      position: { x: 2, y: 0, z: 3 },
    }] : []),
  ]
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: input.slug,
    name: input.slug,
    revision: 5,
    dimensions: { x: 10, y: 4, z: 10 },
    groundLevelY: 0,
    voxels: [], hazards: [], placements,
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history,
        sceneId: `scene:${input.slug}`,
        currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1, turn: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
    metadata: {},
  }
  const move = input.move ?? 'Tackle'
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', abilities: input.actorAbility ? [input.actorAbility] : [], move, held: input.actorHeld })],
    ['target', sheet({ slug: 'target', abilities: input.targetAbility ? [input.targetAbility] : [], types: input.targetTypes })],
    ...(input.allyAbility ? [['ally', sheet({ slug: 'ally', abilities: [input.allyAbility] })] as const] : []),
  ])
  return { map, sheets, move }
}

type Fixture = ReturnType<typeof fixture>
const intentFor = (state: Fixture, self = false) => ({
  schemaVersion: 1 as const,
  placementId: 'actor',
  moveName: state.move,
  selection: self
    ? ({ kind: 'self' as const })
    : ({ kind: 'single-target' as const, targetPlacementId: 'target' }),
})
const declare = (state: Fixture, self = false, random: () => number = () => 0.75) => (
  planAuthoritativeMoveStateExecution({
    map: state.map,
    pokemonSheets: state.sheets,
    trainerSheets: new Map(),
    intent: intentFor(state, self),
    random,
    now: () => 1000,
    operationId: `op_${slugId(state.map.slug)}`,
    pendingResolutionId: `resolution:${state.map.slug}`,
  })
)
const complete = (
  state: Fixture,
  optionId: string | null,
  self = false,
  values: readonly number[] = [0.75, 0.75, 0.75],
) => {
  let index = 0
  const random = () => values[Math.min(index++, values.length - 1)] ?? 0.75
  const declaration = declare(state, self, random)
  if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected a pending AA-083 response.')
  const pending = declaration.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending),
    map: structuredClone(declaration.nextMap),
    pokemonSheets: state.sheets,
    trainerSheets: new Map(),
    response: { requestId: window.windowId, optionId },
    now: 2000,
    random,
  })
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected one response to complete the move.')
  return planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: declaration.suspension.preWindowPlan,
    responseOpId: `op_response_${slugId(state.map.slug)}`,
    responseWindowId: window.windowId,
    responseOptionId: optionId,
    chosenBy: window.ownership[0]!,
    map: declaration.nextMap,
    pokemonSheets: state.sheets,
    trainerSheets: new Map(),
    execution,
    plannedAt: 2000,
  })
}
const nextSheet = (
  state: Fixture,
  plan: Exclude<ReturnType<typeof complete>, { kind: 'pending-request' }>,
  slug: string,
): CharacterSheet => (plan.sheetWrites.find(write => write.slug === slug)?.nextSheet
  ?? state.sheets.get(slug)!) as CharacterSheet

describe('AA-083 triggered Move integrations', () => {
  it('Perish Body opens only on a Melee hit and creates two independent Perish Counts after Daily/Standard payment', () => {
    const state = fixture({ slug: 'aa083-perish-body', targetAbility: 'Perish Body' })
    const declaration = declare(state)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected Perish Body response.')
    expect(declaration.suspension.pendingResolution.outstandingWindows[0]?.reasonCode)
      .toBe('ability.perish-body.optional-count')
    const plan = complete(state, 'ability.perish-body.use')
    if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Perish Body must complete.')
    const counters = plan.nextMap.encounterState?.effects.filter(effect => effect.tags.includes('aa083-perish-count')) ?? []
    expect(counters).toHaveLength(2)
    expect(counters.flatMap(effect => effect.affected.placementIds).sort()).toEqual(['actor', 'target'])
    expect(plan.nextMap.encounterState?.turnResources.target?.actions.standard.spent).toBe(1)
    expect(nextSheet(state, plan, 'target').abilityUsage?.entries)
      .toContainEqual(expect.objectContaining({ canonicalId: 'Perish Body', spent: 1 }))
  }, 30_000)

  it('Pickpocket atomically transfers the attacker Held Item and pays its Scene Free Action', () => {
    const state = fixture({
      slug: 'aa083-pickpocket', targetAbility: 'Pickpocket', actorHeld: 'Shell Bell',
    })
    const plan = complete(state, 'ability.pickpocket.use')
    if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Pickpocket must complete.')
    expect(nextSheet(state, plan, 'actor').items?.held).toBeUndefined()
    expect(nextSheet(state, plan, 'target').items?.held).toBe('Shell Bell')
    expect(plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries)
      .toContainEqual(expect.objectContaining({ canonicalId: 'Pickpocket', spent: 1 }))
  }, 30_000)

  it('Poison Point poisons only the attacking foe after acceptance and records Scene usage', () => {
    const state = fixture({ slug: 'aa083-poison-point', targetAbility: 'Poison Point' })
    const plan = complete(state, 'ability.poison-point.use')
    if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Poison Point must complete.')
    expect(nextSheet(state, plan, 'actor').combat?.conditions).toContain('Poisoned')
    expect(plan.nextMap.encounterState?.abilityUsage?.entries)
      .toContainEqual(expect.objectContaining({ canonicalId: 'Poison Point', spent: 1 }))
  }, 30_000)

  it('Pixilate durably changes a Normal damaging Move to Fairy and pays one Free Action', () => {
    const state = fixture({
      slug: 'aa083-pixilate', actorAbility: 'Pixilate', targetTypes: ['Dark'],
    })
    const plan = complete(state, 'ability.pixilate.fairy')
    if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Pixilate must complete.')
    const ordinary = fixture({ slug: 'aa083-pixilate-ordinary', targetTypes: ['Dark'] })
    const ordinaryPlan = planAuthoritativeMoveState({
      map: ordinary.map, pokemonSheets: ordinary.sheets, trainerSheets: new Map(),
      intent: intentFor(ordinary), random: () => 0.75, now: () => 1000,
      operationId: 'op_aa083_pixilate_ordinary',
    })
    if (isAuthoritativePendingMoveStatePlan(ordinaryPlan)) throw new Error('Ordinary Tackle must complete.')
    const pixilateHp = nextSheet(state, plan, 'target').combat?.currentHp ?? 300
    const ordinaryHp = ((ordinaryPlan.sheetWrites.find(write => write.slug === 'target')?.nextSheet
      ?? ordinary.sheets.get('target')!) as CharacterSheet).combat?.currentHp ?? 300
    expect(pixilateHp).toBeLessThan(ordinaryHp)
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('Fairy')
  }, 30_000)

  it('Plus adds one stage in a stat raised on an ally and enforces Scene x2/Free payment', () => {
    const state = fixture({ slug: 'aa083-plus', move: 'Swords Dance', allyAbility: 'Plus' })
    const declaration = declare(state, true)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected Plus response.')
    expect(declaration.suspension.pendingResolution.outstandingWindows[0]?.reasonCode)
      .toBe('ability.plus.optional-additional-stage')
    const option = declaration.suspension.pendingResolution.outstandingWindows[0]?.options
      .find(candidate => candidate.id === 'ability.plus.atk')?.id
    expect(option).toBe('ability.plus.atk')
    const plan = complete(state, option ?? null, true)
    if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Plus must complete.')
    expect(nextSheet(state, plan, 'actor').stats?.atk?.stage).toBe(3)
    expect(plan.nextMap.encounterState?.turnResources.ally?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries)
      .toContainEqual(expect.objectContaining({ canonicalId: 'Plus', spent: 1, limit: 2 }))
  }, 30_000)

  it('Poison Heal activates after becoming Poisoned and stores its encounter marker with Daily/Free payment', () => {
    const state = fixture({ slug: 'aa083-poison-heal', move: 'Toxic', targetAbility: 'Poison Heal' })
    const declaration = declare(state)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected Poison Heal response.')
    expect(declaration.suspension.pendingResolution.outstandingWindows[0]?.reasonCode)
      .toBe('ability.poison-heal.optional-activate')
    const plan = complete(state, 'ability.poison-heal.use')
    if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Poison Heal must complete.')
    expect(nextSheet(state, plan, 'target').combat?.conditions)
      .toEqual(expect.arrayContaining(['Badly Poisoned']))
    expect(plan.nextMap.encounterState?.effects.some(effect => (
      effect.tags.includes('aa083-poison-heal-active')
      && effect.affected.placementIds.includes('target')
    ))).toBe(true)
    expect(nextSheet(state, plan, 'target').abilityUsage?.entries)
      .toContainEqual(expect.objectContaining({ canonicalId: 'Poison Heal', spent: 1 }))
    expect(plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
  }, 30_000)

  it('Polycephaly offers Swift Struggle and applies one additional resistance step', () => {
    const state = fixture({
      slug: 'aa083-polycephaly', actorAbility: 'Polycephaly', move: 'Struggle', targetTypes: ['Rock'],
    })
    const plan = complete(state, 'ability.polycephaly.swift')
    if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Polycephaly must complete.')
    const ordinary = fixture({ slug: 'aa083-polycephaly-ordinary', move: 'Struggle', targetTypes: ['Rock'] })
    const ordinaryPlan = planAuthoritativeMoveState({
      map: ordinary.map, pokemonSheets: ordinary.sheets, trainerSheets: new Map(),
      intent: intentFor(ordinary), random: () => 0.75, now: () => 1000,
      operationId: 'op_aa083_polycephaly_ordinary',
    })
    if (isAuthoritativePendingMoveStatePlan(ordinaryPlan)) throw new Error('Ordinary Struggle must complete.')
    const polyLoss = 300 - (nextSheet(state, plan, 'target').combat?.currentHp ?? 300)
    const ordinaryLoss = 300 - ((((ordinaryPlan.sheetWrites.find(write => write.slug === 'target')?.nextSheet
      ?? ordinary.sheets.get('target')!) as CharacterSheet).combat?.currentHp) ?? 300)
    expect(polyLoss).toBeLessThan(ordinaryLoss)
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.standard.spent).toBe(0)
  }, 30_000)
})
