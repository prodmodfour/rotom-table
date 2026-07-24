import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { AA075_ILLUSION_ACTIVE_CAPABILITY_PREFIX } from '#shared/abilityAutomation/aa075'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import type { PendingMoveResolution } from '#shared/moveAutomation/pendingResolution'
import {
  capabilityEncounterEffectFixture,
  creatureRuleOverlayEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

const id = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${id(canonicalId)}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const sheet = (input: {
  slug: string
  move?: string
  ability?: string
  currentHp?: number
  hpAdded?: number
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 30,
  revision: 3,
  types: ['Normal'],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: input.hpAdded ?? 90 }, atk: { added: 35 }, def: { added: 25 },
    satk: { added: 35 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 250, injuries: 0, conditions: [] },
})

const suppression = (placementId: string): EncounterEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'ability', action: 'suppress', values: [],
    referencePlacementId: null, suppressionScope: 'all',
  }),
  id: `effect.aa075.suppress.${placementId}`,
  affected: { placementIds: [placementId], sideIds: [], cells: [] },
})

const illusionEffect = (): EncounterEffect => ({
  ...capabilityEncounterEffectFixture(),
  id: 'effect.aa075.illusion.active.target',
  source: {
    operationId: 'op_aa075_illusion_assume',
    moveId: 'ability.illusion',
    placementId: 'target',
  },
  affected: { placementIds: ['target'], sideIds: [], cells: [] },
  tags: ['ability', 'aa075', 'illusion', 'appearance'],
  payload: {
    capabilityId: `${AA075_ILLUSION_ACTIVE_CAPABILITY_PREFIX}state:test`,
    action: 'grant',
  },
})

const battleMap = (input: {
  slug: string
  boosterX?: number
  effects?: readonly EncounterEffect[]
  targetTemporaryHp?: number
  boosterFreeSpent?: number
  secondBoosterAbility?: string
}): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'booster', sheetKind: 'pokemon', sheetSlug: 'booster', sideId: 'heroes', position: { x: input.boosterX ?? 2, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 2 } },
    ...(input.secondBoosterAbility ? [{
      id: 'booster2', sheetKind: 'pokemon' as const, sheetSlug: 'booster2', sideId: 'heroes',
      position: { x: 0, y: 0, z: 1 },
    }] : []),
  ]
  const resources = Object.fromEntries(placements.map(placement => [
    placement.id,
    createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
  ]))
  if (input.boosterFreeSpent) {
    resources.booster = {
      ...resources.booster!,
      actions: {
        ...resources.booster!.actions,
        free: { ...resources.booster!.actions.free, spent: input.boosterFreeSpent },
      },
    }
  }
  return {
    schemaVersion: 2,
    slug: input.slug,
    name: input.slug,
    revision: 5,
    dimensions: { x: 16, y: 4, z: 16 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [], hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements,
    encounterState: {
      ...encounter,
      effects: [...(input.effects ?? [])],
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
      turnResources: resources,
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
    ...(input.targetTemporaryHp === undefined ? {} : {
      temporaryHitPoints: {
        scene: { name: 'Scene', startedAt: 100 },
        byPlacementId: { target: input.targetTemporaryHp },
      },
    }),
  }
}

const declare = (input: {
  slug: string
  move: string
  actorAbility?: string
  boosterAbility?: string
  targetAbility?: string
  boosterX?: number
  effects?: readonly EncounterEffect[]
  targetTemporaryHp?: number
  boosterFreeSpent?: number
  secondBoosterAbility?: string
  random?: () => number
}) => {
  const map = battleMap(input)
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move: input.move, ability: input.actorAbility, currentHp: 400, hpAdded: 250 })],
    ['booster', sheet({ slug: 'booster', ability: input.boosterAbility })],
    ['target', sheet({ slug: 'target', ability: input.targetAbility })],
    ...(input.secondBoosterAbility
      ? [['booster2', sheet({ slug: 'booster2', ability: input.secondBoosterAbility })] as const]
      : []),
  ])
  const result = planAuthoritativeMoveStateExecution({
    map,
    pokemonSheets,
    trainerSheets: new Map(),
    intent: {
      schemaVersion: 1,
      placementId: 'actor',
      moveName: input.move,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: input.random ?? (() => 0.75),
    now: () => 1_000,
    operationId: `op_${input.slug.replace(/[^a-zA-Z0-9_]+/g, '_')}`,
    pendingResolutionId: `resolution:${input.slug}`,
  })
  return { result, pokemonSheets, initialMap: map }
}

const resume = (input: {
  pending: PendingMoveResolution
  map: TabletopMap
  pokemonSheets: ReadonlyMap<string, CharacterSheet>
  optionId: string | null
}) => resumeMoveSpec({
  pendingResolution: structuredClone(input.pending),
  map: structuredClone(input.map),
  pokemonSheets: input.pokemonSheets,
  trainerSheets: new Map(),
  response: {
    requestId: input.pending.outstandingWindows[0]!.windowId,
    optionId: input.optionId,
  },
  now: 2_000,
  random: () => 0.75,
})

const finish = (input: {
  declaration: ReturnType<typeof declare>
  optionId: string | null
  ownerId: string
}) => {
  if (!isAuthoritativePendingMoveStatePlan(input.declaration.result)) throw new Error('Expected pending Move.')
  const pending = input.declaration.result.suspension.pendingResolution
  const execution = resume({
    pending,
    map: input.declaration.result.nextMap,
    pokemonSheets: input.declaration.pokemonSheets,
    optionId: input.optionId,
  })
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected completed resumed Move.')
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: input.declaration.result.suspension.preWindowPlan,
    responseOpId: `op_response_${input.declaration.initialMap.slug}`,
    responseWindowId: pending.outstandingWindows[0]!.windowId,
    responseOptionId: input.optionId,
    chosenBy: { kind: 'target', id: input.ownerId },
    map: input.declaration.result.nextMap,
    pokemonSheets: input.declaration.pokemonSheets,
    trainerSheets: new Map(),
    execution,
    plannedAt: 2_000,
  })
  return { pending, execution, plan }
}

const nextSheet = (
  plan: ReturnType<typeof finish>['plan'],
  slug: string,
  originals: ReadonlyMap<string, CharacterSheet>,
): CharacterSheet => (plan.sheetWrites.find(write => write.slug === slug)?.nextSheet
  ?? originals.get(slug)) as CharacterSheet

const completedPlan = (declaration: ReturnType<typeof declare>) => {
  if (isAuthoritativePendingMoveStatePlan(declaration.result)) throw new Error('Expected immediate Move.')
  return declaration.result
}

describe('AA-075 triggered integrations', () => {
  it('aa075.ignition-boost.reviewed durably adds exactly +5 and pays the adjacent Ally Free Action', () => {
    const selected = declare({
      slug: 'aa075-ignition-selected', move: 'Ember', boosterAbility: 'Ignition Boost',
    })
    expect(isAuthoritativePendingMoveStatePlan(selected.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(selected.result)) return
    expect(selected.result.suspension.pendingResolution.outstandingWindows[0]).toMatchObject({
      options: [{ id: 'ability.ignition-boost.use' }],
      ownership: [{ kind: 'target', id: 'booster' }],
    })
    const selectedResult = finish({
      declaration: selected, optionId: 'ability.ignition-boost.use', ownerId: 'booster',
    })

    const passed = declare({
      slug: 'aa075-ignition-passed', move: 'Ember', boosterAbility: 'Ignition Boost',
    })
    const passedResult = finish({ declaration: passed, optionId: null, ownerId: 'booster' })
    const selectedTarget = nextSheet(selectedResult.plan, 'target', selected.pokemonSheets)
    const passedTarget = nextSheet(passedResult.plan, 'target', passed.pokemonSheets)
    expect((passedTarget.combat?.currentHp ?? 0) - (selectedTarget.combat?.currentHp ?? 0)).toBe(5)
    expect(selectedResult.plan.nextMap.encounterState?.turnResources.booster?.actions.free.spent).toBe(1)
    expect(passedResult.plan.nextMap.encounterState?.turnResources.booster?.actions.free.spent).toBe(0)
    expect(JSON.stringify(selectedResult.execution.auditTrace)).toContain('ability.ignition-boost.triggering-damage')
  }, 30_000)

  it('aa075.ignition-boost.reviewed accepts at most one adjacent provider instance', () => {
    const declaration = declare({
      slug: 'aa075-ignition-multiple', move: 'Ember',
      boosterAbility: 'Ignition Boost', secondBoosterAbility: 'Ignition Boost',
    })
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) {
      throw new Error('Expected one bounded Ignition Boost window.')
    }
    expect(declaration.result.suspension.pendingResolution.outstandingWindows).toHaveLength(1)
    const ownerId = declaration.result.suspension.pendingResolution.outstandingWindows[0]
      ?.ownership[0]?.id
    if (ownerId !== 'booster' && ownerId !== 'booster2') throw new Error('Expected an Ignition Boost owner.')
    const otherOwnerId = ownerId === 'booster' ? 'booster2' : 'booster'
    const result = finish({
      declaration, optionId: 'ability.ignition-boost.use', ownerId,
    })
    expect(result.plan.nextMap.encounterState?.turnResources[ownerId]?.actions.free.spent).toBe(1)
    expect(result.plan.nextMap.encounterState?.turnResources[otherOwnerId]?.actions.free.spent).toBe(0)
    expect(result.execution.auditTrace.events.filter(event => (
      event.kind === 'operation'
      && event.reasonCode === 'ability.ignition-boost.optional-damage'
      && event.outcome === 'applied'
    ))).toHaveLength(1)
  }, 30_000)

  it('aa075.ignition-boost.reviewed rejects non-adjacent and suppressed owners', () => {
    const distant = completedPlan(declare({
      slug: 'aa075-ignition-distant', move: 'Ember', boosterAbility: 'Ignition Boost', boosterX: 12,
    }))
    expect(distant.resolution.auditTrace.events.some(event => (
      event.kind === 'operation' && event.reasonCode.includes('ignition-boost')
    ))).toBe(false)

    const suppressed = completedPlan(declare({
      slug: 'aa075-ignition-suppressed', move: 'Ember', boosterAbility: 'Ignition Boost',
      effects: [suppression('booster')],
    }))
    expect(suppressed.resolution.auditTrace.events.some(event => (
      event.kind === 'operation' && event.reasonCode.includes('ignition-boost')
    ))).toBe(false)

  }, 30_000)

  it('aa075.illusion.reviewed breaks only after an authoritative damaging hit', () => {
    const hit = completedPlan(declare({
      slug: 'aa075-illusion-hit', move: 'Tackle', targetAbility: 'Illusion',
      effects: [illusionEffect()],
    }))
    expect(hit.nextMap.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId.startsWith(AA075_ILLUSION_ACTIVE_CAPABILITY_PREFIX)
    ))).toBe(false)

    const miss = completedPlan(declare({
      slug: 'aa075-illusion-miss', move: 'Tackle', targetAbility: 'Illusion',
      effects: [illusionEffect()], random: () => 0,
    }))
    expect(miss.nextMap.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId.startsWith(AA075_ILLUSION_ACTIVE_CAPABILITY_PREFIX)
    ))).toBe(true)
  }, 30_000)

  it('aa075.innards-out.reviewed reflects twice actual real HP loss after resistance and Temporary HP', () => {
    const declaration = declare({
      slug: 'aa075-innards-out', move: 'Tackle', targetAbility: 'Innards Out',
      boosterX: 12, targetTemporaryHp: 10,
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    const option = declaration.result.suspension.pendingResolution.outstandingWindows[0]!.options
      .find(candidate => candidate.id === 'ability.innards-out.target:actor')
    expect(option).toBeDefined()
    const result = finish({ declaration, optionId: option!.id, ownerId: 'target' })
    const initialTargetHp = declaration.pokemonSheets.get('target')!.combat!.currentHp ?? 0
    const finalTargetHp = nextSheet(result.plan, 'target', declaration.pokemonSheets).combat!.currentHp ?? 0
    const initialActorHp = declaration.pokemonSheets.get('actor')!.combat!.currentHp ?? 0
    const finalActorHp = nextSheet(result.plan, 'actor', declaration.pokemonSheets).combat!.currentHp ?? 0
    const realHpLost = initialTargetHp - finalTargetHp
    expect(realHpLost).toBeGreaterThan(0)
    expect(initialActorHp - finalActorHp).toBe(realHpLost * 2)
    expect(result.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Innards Out', spent: 1, limit: 2,
    }))
    expect(result.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
  }, 30_000)

  it('aa075.innards-out.reviewed aggregates multi-hit real HP loss and replays the sealed response deterministically', () => {
    const declaration = declare({
      slug: 'aa075-innards-out-multi', move: 'Water Shuriken', targetAbility: 'Innards Out',
      boosterX: 12, targetTemporaryHp: 15,
    })
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) throw new Error('Expected pending Innards Out.')
    const pending = declaration.result.suspension.pendingResolution
    const optionId = pending.outstandingWindows[0]!.options
      .find(candidate => candidate.id === 'ability.innards-out.target:actor')!.id
    const first = resume({
      pending,
      map: declaration.result.nextMap,
      pokemonSheets: declaration.pokemonSheets,
      optionId,
    })
    const retry = resume({
      pending,
      map: declaration.result.nextMap,
      pokemonSheets: declaration.pokemonSheets,
      optionId,
    })
    expect(retry).toEqual(first)
    const result = finish({ declaration, optionId, ownerId: 'target' })
    const initialTargetHp = declaration.pokemonSheets.get('target')!.combat!.currentHp ?? 0
    const finalTargetHp = nextSheet(result.plan, 'target', declaration.pokemonSheets).combat!.currentHp ?? 0
    const initialActorHp = declaration.pokemonSheets.get('actor')!.combat!.currentHp ?? 0
    const finalActorHp = nextSheet(result.plan, 'actor', declaration.pokemonSheets).combat!.currentHp ?? 0
    expect(initialTargetHp - finalTargetHp).toBeGreaterThan(0)
    expect(initialActorHp - finalActorHp).toBe((initialTargetHp - finalTargetHp) * 2)
  }, 30_000)
})
