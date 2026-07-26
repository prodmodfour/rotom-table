import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { PendingMoveResolution } from '#shared/moveAutomation/pendingResolution'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import {
  AA078_LIGHTNING_ROD_OPTION_ID,
  AA078_MAGIC_BOUNCE_HAZARD_OPTION_ID,
  AA078_MAGIC_BOUNCE_OPTION_ID,
  aa078LullabyTargetOptionId,
} from '../../server/domain/abilityAutomation/mechanics/aa078MoveIntegration'

const id = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${id(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  move?: string
  abilities?: readonly string[]
  digestionFoods?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 30, revision: 3,
  types: ['Normal'], abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  ...(input.digestionFoods ? { items: { digestionFoods: [...input.digestionFoods] } } : {}),
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 300, injuries: 0, conditions: [] },
})
const fixture = (input: {
  slug: string
  move: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  reactorAbilities?: readonly string[]
  includeReactor?: boolean
  omitActorMove?: boolean
  actorDigestionFoods?: readonly string[]
  temporaryHp?: number
  targetPosition?: { x: number; y: number; z: number }
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: input.targetPosition ?? { x: 3, y: 0, z: 1 } },
    ...(input.includeReactor ? [{
      id: 'reactor', sheetKind: 'pokemon' as const, sheetSlug: 'reactor',
      sideId: 'foes', position: { x: 2, y: 0, z: 2 },
    }] : []),
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 20, y: 4, z: 20 }, groundLevelY: 0,
    voxels: [], hazards: [], placements,
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history, sceneId: `scene:${input.slug}`, currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1, turn: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
    ...(input.temporaryHp === undefined ? {} : {
      temporaryHitPoints: {
        scene: { name: 'Scene', startedAt: 100 },
        byPlacementId: { actor: input.temporaryHp },
      },
    }),
  }
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor', ...(input.omitActorMove ? {} : { move: input.move }),
      abilities: input.actorAbilities, digestionFoods: input.actorDigestionFoods,
    })],
    ['target', sheet({ slug: 'target', abilities: input.targetAbilities })],
    ...(input.includeReactor
      ? [['reactor', sheet({ slug: 'reactor', abilities: input.reactorAbilities })] as const]
      : []),
  ])
  return { map, pokemonSheets, move: input.move }
}
type State = ReturnType<typeof fixture>
const declare = (state: State, random: () => number = () => 0.75) => {
  const area = state.move === 'Sing'
  const result = planAuthoritativeMoveStateExecution({
    map: state.map, pokemonSheets: state.pokemonSheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName: state.move,
      selection: area
        ? { kind: 'area', areaTemplateId: moveAutomationAreaTemplateId({ kind: 'burst', size: 2 }) }
        : state.move === 'Teatime' || state.move === 'Stealth Rock'
          ? { kind: 'self' }
          : { kind: 'single-target', targetPlacementId: 'target' },
    },
    random, now: () => 1_000,
    operationId: `op_${state.map.slug.replace(/[^a-zA-Z0-9_]+/g, '_')}`,
    pendingResolutionId: `resolution:${state.map.slug}`,
  })
  return { state, result }
}
const resume = (input: {
  pending: PendingMoveResolution
  map: TabletopMap
  state: State
  optionId: string | null
  random?: () => number
}) => resumeMoveSpec({
  pendingResolution: structuredClone(input.pending), map: structuredClone(input.map),
  pokemonSheets: input.state.pokemonSheets, trainerSheets: new Map(),
  response: { requestId: input.pending.outstandingWindows[0]!.windowId, optionId: input.optionId },
  now: 2_000, random: input.random ?? (() => 0.75),
})
const finish = (input: {
  declaration: ReturnType<typeof declare>
  optionId: string | null
  chosenBy: 'actor' | 'target' | 'reactor'
  random?: () => number
}) => {
  if (!isAuthoritativePendingMoveStatePlan(input.declaration.result)) throw new Error('Expected pending Move.')
  const pending = input.declaration.result.suspension.pendingResolution
  const execution = resume({
    pending, map: input.declaration.result.nextMap, state: input.declaration.state,
    optionId: input.optionId, random: input.random,
  })
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected completed resumed Move.')
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: input.declaration.result.suspension.preWindowPlan,
    responseOpId: `op_response_${input.declaration.state.map.slug}`,
    responseWindowId: pending.outstandingWindows[0]!.windowId,
    responseOptionId: input.optionId,
    chosenBy: { kind: 'placement', id: input.chosenBy },
    map: input.declaration.result.nextMap,
    pokemonSheets: input.declaration.state.pokemonSheets, trainerSheets: new Map(),
    execution, plannedAt: 2_000,
  })
  return { pending, execution, plan }
}
const finishAll = (input: {
  declaration: ReturnType<typeof declare>
  choose: (window: PendingMoveResolution['outstandingWindows'][number], ownerId: string) => string | null
}) => {
  if (!isAuthoritativePendingMoveStatePlan(input.declaration.result)) throw new Error('Expected pending Move.')
  let pending = input.declaration.result.suspension.pendingResolution
  let preWindowPlan = input.declaration.result.suspension.preWindowPlan
  let currentMap = input.declaration.result.nextMap
  for (let index = 0; index < 16; index += 1) {
    const window = pending.outstandingWindows[0]
    if (!window) throw new Error('Pending Move has no outstanding window.')
    const ownerId = window.ownership[0]?.id ?? 'actor'
    const optionId = input.choose(window, ownerId)
    const execution = resume({
      pending, map: currentMap, state: input.declaration.state, optionId,
    })
    const planned = planResumedMoveState({
      pendingResolution: pending, declarationPlan: preWindowPlan,
      responseOpId: `op_response_${input.declaration.state.map.slug}_${index}`,
      responseWindowId: window.windowId, responseOptionId: optionId,
      chosenBy: { kind: 'placement', id: ownerId },
      map: currentMap, pokemonSheets: input.declaration.state.pokemonSheets,
      trainerSheets: new Map(), execution, plannedAt: 2_000 + index,
    })
    if (!isAuthoritativePendingMoveStatePlan(planned)) return planned
    pending = planned.suspension.pendingResolution
    preWindowPlan = planned.suspension.preWindowPlan
    currentMap = planned.nextMap
  }
  throw new Error('Pending Move exceeded the bounded test response sequence.')
}

const resolvedSheet = (
  declaration: ReturnType<typeof declare>,
  plan: ReturnType<typeof finish>['plan'],
  slug: 'actor' | 'target' | 'reactor',
): CharacterSheet => (plan.sheetWrites.find(write => write.slug === slug)?.nextSheet
  ?? declaration.state.pokemonSheets.get(slug)) as CharacterSheet

describe('AA-078 triggered integrations', () => {
  it('aa078.lightning-rod.reviewed redirects server-side, automatically hits, grants immunity/stage, and durably pays', () => {
    const declaration = declare(fixture({
      slug: 'aa078-lightning-rod', move: 'Thunder Shock', includeReactor: true,
      reactorAbilities: ['Lightning Rod'],
    }), () => 0)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) throw new Error('Expected Lightning Rod response.')
    const window = declaration.result.suspension.pendingResolution.outstandingWindows[0]!
    expect(window).toMatchObject({
      ownership: [{ kind: 'target', id: 'reactor' }],
      options: [{ id: AA078_LIGHTNING_ROD_OPTION_ID }], allowPass: true,
    })
    const completed = finish({
      declaration, optionId: AA078_LIGHTNING_ROD_OPTION_ID, chosenBy: 'reactor', random: () => 0,
    })
    expect(resolvedSheet(declaration, completed.plan, 'target').combat?.currentHp).toBe(300)
    const reactor = resolvedSheet(declaration, completed.plan, 'reactor')
    expect(reactor.combat?.currentHp).toBe(300)
    expect(reactor.stats?.satk?.stage ?? reactor.combatStages?.satk).toBe(1)
    expect(completed.plan.nextMap.encounterState?.turnResources.reactor?.actions.free.spent).toBe(1)
    expect(completed.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Lightning Rod', ownerId: 'reactor', spent: 1,
    }))

    const replay = resume({
      pending: completed.pending, map: declaration.result.nextMap,
      state: declaration.state, optionId: AA078_LIGHTNING_ROD_OPTION_ID, random: () => 0,
    })
    expect(replay).toEqual(completed.execution)
  }, 30_000)

  it('aa078.lightning-rod.reviewed pass preserves the original target and spends nothing', () => {
    const declaration = declare(fixture({
      slug: 'aa078-lightning-rod-pass', move: 'Thunder Shock', includeReactor: true,
      reactorAbilities: ['Lightning Rod'],
    }))
    const completed = finish({ declaration, optionId: null, chosenBy: 'reactor' })
    expect(resolvedSheet(declaration, completed.plan, 'target').combat?.currentHp).toBeLessThan(300)
    expect(completed.plan.nextMap.encounterState?.turnResources.reactor?.actions.free.spent).toBe(0)
    expect(completed.plan.nextMap.encounterState?.abilityUsage?.entries
      .some(entry => entry.canonicalId === 'Lightning Rod')).toBe(false)
  })

  it('aa078.lullaby.reviewed supplies Sing by Connection and automatically hits only the server-selected target', () => {
    const declaration = declare(fixture({
      slug: 'aa078-lullaby', move: 'Sing', actorAbilities: ['Lullaby'],
      includeReactor: true, omitActorMove: true,
    }), () => 0)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) throw new Error('Expected Lullaby response.')
    const pending = declaration.result.suspension.pendingResolution
    const targetOption = aa078LullabyTargetOptionId('target')
    expect(pending.outstandingWindows[0]?.options.map(option => option.id)).toEqual([
      aa078LullabyTargetOptionId('reactor'), targetOption,
    ])
    const completed = finish({ declaration, optionId: targetOption, chosenBy: 'actor', random: () => 0 })
    expect(resolvedSheet(declaration, completed.plan, 'target').combat?.conditions).toContain('Sleep')
    expect(resolvedSheet(declaration, completed.plan, 'reactor').combat?.conditions).not.toContain('Sleep')
    expect(completed.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Lullaby', ownerId: 'actor', spent: 1,
    }))
  }, 30_000)

  it('aa078.lunchbox.reviewed triggers only after a successful stored-food trade and stacks its reviewed Tick', () => {
    const declaration = declare(fixture({
      slug: 'aa078-lunchbox', move: 'Teatime', actorAbilities: ['Lunchbox'],
      actorDigestionFoods: ['Oran Berry'], temporaryHp: 20,
    }))
    const plan = finishAll({
      declaration,
      choose: (window, ownerId) => {
        if (window.options.some(option => option.id === 'ability.lunchbox.use')) {
          return 'ability.lunchbox.use'
        }
        return ownerId === 'actor' ? window.options[0]?.id ?? null : null
      },
    })
    const actor = resolvedSheet(declaration, plan, 'actor')
    expect(actor.items?.digestionFoods ?? []).not.toContain('Oran Berry')
    expect(plan.nextMap.temporaryHitPoints?.byPlacementId.actor).toBeGreaterThan(20)
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Lunchbox', ownerId: 'actor', spent: 1,
    }))
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('ability.lunchbox.stacking-temporary-hp')

    const unavailable = declare(fixture({
      slug: 'aa078-lunchbox-unavailable', move: 'Teatime', actorAbilities: ['Lunchbox'],
    }))
    if (!isAuthoritativePendingMoveStatePlan(unavailable.result)) throw new Error('Expected Teatime choice.')
    expect(unavailable.result.suspension.pendingResolution.outstandingWindows
      .some(window => window.options.some(option => option.id === 'ability.lunchbox.use'))).toBe(false)
  }, 30_000)

  it('aa078.magic-bounce.reviewed reflects an exact hit to the attacker once and never trusts a reflected target', () => {
    const declaration = declare(fixture({
      slug: 'aa078-magic-bounce', move: 'Thunder Wave',
      actorAbilities: ['Magic Bounce'], targetAbilities: ['Magic Bounce'],
    }))
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) throw new Error('Expected Magic Bounce response.')
    const pending = declaration.result.suspension.pendingResolution
    expect(pending.outstandingWindows).toHaveLength(1)
    expect(pending.outstandingWindows[0]).toMatchObject({
      ownership: [{ kind: 'target', id: 'target' }],
      options: [{ id: AA078_MAGIC_BOUNCE_OPTION_ID }],
    })
    const completed = finish({
      declaration, optionId: AA078_MAGIC_BOUNCE_OPTION_ID, chosenBy: 'target',
    })
    expect(resolvedSheet(declaration, completed.plan, 'target').combat?.conditions).not.toContain('Paralysis')
    expect(resolvedSheet(declaration, completed.plan, 'actor').combat?.conditions).toContain('Paralysis')
    expect(completed.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Magic Bounce', ownerId: 'target', spent: 1,
    }))
  }, 30_000)

  it('aa078.magic-bounce.reviewed derives reflected hazard cells from the reflector and seals recipient-side ownership', () => {
    const declaration = declare(fixture({
      slug: 'aa078-magic-bounce-hazard', move: 'Stealth Rock',
      targetAbilities: ['Magic Bounce'], targetPosition: { x: 10, y: 0, z: 1 },
    }))
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) throw new Error('Expected Magic Bounce hazard response.')
    const first = declaration.result.suspension.pendingResolution
    expect(first.outstandingWindows[0]?.options).toEqual([{
      id: AA078_MAGIC_BOUNCE_HAZARD_OPTION_ID,
      labelKey: 'ability.magic-bounce.hazard.use',
    }])
    const hazardExecution = resume({
      pending: first, map: declaration.result.nextMap, state: declaration.state,
      optionId: AA078_MAGIC_BOUNCE_HAZARD_OPTION_ID,
    })
    if (!isAuthoritativePendingMoveResolution(hazardExecution)) throw new Error('Expected reflected hazard-cell choice.')
    const hazardPlan = planResumedMoveState({
      pendingResolution: first,
      declarationPlan: declaration.result.suspension.preWindowPlan,
      responseOpId: 'op_response_aa078_magic_bounce_hazard',
      responseWindowId: first.outstandingWindows[0]!.windowId,
      responseOptionId: AA078_MAGIC_BOUNCE_HAZARD_OPTION_ID,
      chosenBy: { kind: 'placement', id: 'target' },
      map: declaration.result.nextMap,
      pokemonSheets: declaration.state.pokemonSheets, trainerSheets: new Map(),
      execution: hazardExecution, plannedAt: 2_000,
    })
    if (!isAuthoritativePendingMoveStatePlan(hazardPlan)) throw new Error('Expected materialized hazard-cell choice.')
    const hazardPending = hazardPlan.suspension.pendingResolution
    const hazardWindow = hazardPending.outstandingWindows[0]
    if (hazardWindow?.kind !== 'choice' || !hazardWindow.hazardCellSelection) {
      throw new Error('Expected server-owned reflected hazard cells.')
    }
    const cells = hazardWindow.hazardCellSelection.options.map(option => option.cell)
    expect(cells.some(cell => (
      Math.max(Math.abs(cell.x - 10), Math.abs(cell.z - 1)) <= 6
      && Math.max(Math.abs(cell.x - 1), Math.abs(cell.z - 1)) > 6
    ))).toBe(true)
    const desired = [
      { x: 10, y: 0, z: 2 }, { x: 11, y: 0, z: 2 },
      { x: 12, y: 0, z: 2 }, { x: 13, y: 0, z: 2 },
    ]
    const optionIds = desired.map(cell => hazardWindow.hazardCellSelection!.options.find(option => (
      option.cell.x === cell.x && option.cell.y === cell.y && option.cell.z === cell.z
    ))?.id ?? (() => { throw new Error(`Missing reflected hazard cell ${JSON.stringify(cell)}.`) })())
    const completed = resumeMoveSpec({
      pendingResolution: structuredClone(hazardPending),
      map: structuredClone(hazardPlan.nextMap),
      pokemonSheets: declaration.state.pokemonSheets, trainerSheets: new Map(),
      hazardCellResponse: {
        window: hazardWindow.hazardCellSelection,
        selectedOptionIds: optionIds,
      },
      now: 3_000, random: () => 0.75,
    })
    if (isAuthoritativePendingMoveResolution(completed)) throw new Error('Expected reflected hazard completion.')
    const hazard = completed.nativeV2?.operations.find(({ operation }) => operation.kind === 'hazard')?.operation
    expect(hazard).toMatchObject({
      kind: 'hazard', reasonCode: 'ability.magic-bounce.reflected-hazard',
      payload: { ownership: 'recipient-side' },
    })
    expect(completed.nativeV2?.resolvedHazardCells[0]?.cells).toEqual(desired)
  }, 30_000)
})
