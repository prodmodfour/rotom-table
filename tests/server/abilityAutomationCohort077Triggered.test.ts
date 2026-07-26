import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { PendingMoveResolution } from '#shared/moveAutomation/pendingResolution'
import type { ResolveMoveIntent } from '#shared/livePlayMoveResolution'
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
  resolveAuthoritativeMoveItemResources,
  type AuthoritativeMoveItemResources,
} from '../../server/domain/moveAutomation/itemResources'
import { AA077_KLUTZ_ITEM_REQUIREMENT_ID } from '#shared/abilityAutomation/aa077'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { aa077IsProtectedRareLeek } from '../../server/domain/abilityAutomation/mechanics/aa077StaticIntegration'
import { loadMoveItemResources } from '../../server/useCases/loadMoveItemResources'
import { validateResolveMoveItemResourceScopes } from '../../server/useCases/resolveMoveCommandScopes'

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
  abilities?: readonly string[]
  held?: string
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 25,
  revision: 3,
  types: ['Normal'],
  abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  ...(input.held ? { items: { held: input.held } } : {}),
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 35 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 300, injuries: 0, conditions: [] },
})
const fixture = (input: {
  slug: string
  move?: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  targetHeld?: string
  suppressActor?: boolean
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  const effects = input.suppressActor
    ? [{
        ...creatureRuleOverlayEncounterEffectFixture({
          domain: 'ability', action: 'suppress', values: [],
          referencePlacementId: null, suppressionScope: 'all',
        }),
        id: 'effect.aa077.klutz-suppressed',
        affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      }]
    : []
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 12, y: 4, z: 12 }, groundLevelY: 0,
    voxels: [], hazards: [], placements,
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter, effects,
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
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
  const move = input.move ?? 'Tackle'
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move, abilities: input.actorAbilities })],
    ['target', sheet({ slug: 'target', abilities: input.targetAbilities, held: input.targetHeld })],
  ])
  return { map, pokemonSheets, move }
}
const resources = (state: ReturnType<typeof fixture>): AuthoritativeMoveItemResources => (
  resolveAuthoritativeMoveItemResources({
    map: state.map,
    actorPlacementId: 'actor',
    selectedTargetPlacementIds: ['target'],
    pokemonSheets: state.pokemonSheets,
    trainerSheets: new Map(),
    groupInventories: new Map(),
    requirements: [{
      id: AA077_KLUTZ_ITEM_REQUIREMENT_ID,
      source: { kind: 'selected-target-equipped' },
    }],
  })
)
const declare = (
  state: ReturnType<typeof fixture>,
  itemResources = resources(state),
  random: () => number = () => 0.75,
) => {
  const result = planAuthoritativeMoveStateExecution({
    map: state.map,
    pokemonSheets: state.pokemonSheets,
    trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName: state.move,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random,
    now: () => 1_000,
    operationId: `op_${state.map.slug.replace(/[^a-zA-Z0-9_]+/g, '_')}`,
    pendingResolutionId: `resolution:${state.map.slug}`,
    itemResources,
  })
  return { state, result, itemResources }
}
const complete = (input: {
  declaration: ReturnType<typeof declare>
  optionId: string | null
  currentState?: ReturnType<typeof fixture>
  itemResources?: AuthoritativeMoveItemResources
}) => {
  if (!isAuthoritativePendingMoveStatePlan(input.declaration.result)) {
    throw new Error('Expected pending Klutz response.')
  }
  const current = input.currentState ?? input.declaration.state
  const itemResources = input.itemResources ?? input.declaration.itemResources
  const pending = input.declaration.result.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending),
    map: structuredClone(input.declaration.result.nextMap),
    pokemonSheets: current.pokemonSheets,
    trainerSheets: new Map(),
    response: { requestId: window.windowId, optionId: input.optionId },
    now: 2_000,
    random: () => 0.75,
    itemResources,
  })
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected completed Move.')
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: input.declaration.result.suspension.preWindowPlan,
    responseOpId: `op_response_${input.declaration.state.map.slug}`,
    responseWindowId: window.windowId,
    responseOptionId: input.optionId,
    chosenBy: { kind: 'actor', id: 'actor' },
    map: input.declaration.result.nextMap,
    pokemonSheets: current.pokemonSheets,
    trainerSheets: new Map(),
    execution,
    plannedAt: 2_000,
    itemResources,
  })
  return { pending, execution, plan }
}
const itemOption = (pending: PendingMoveResolution) => pending.outstandingWindows[0]?.options.find(option => (
  option.itemChoice?.canonicalItemId === 'quick-claw'
))
const noneOption = (pending: PendingMoveResolution) => pending.outstandingWindows[0]?.options.find(option => (
  option.itemChoice?.canonicalItemId === null
))

describe('AA-077 triggered integrations', () => {
  it('aa077.klutz.reviewed enumerates/revalidates one target item and pays only the selected response', () => {
    const selectedDeclaration = declare(fixture({
      slug: 'aa077-klutz-selected', actorAbilities: ['Klutz'], targetHeld: 'Quick Claw',
    }))
    expect(isAuthoritativePendingMoveStatePlan(selectedDeclaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(selectedDeclaration.result)) return
    const pending = selectedDeclaration.result.suspension.pendingResolution
    const selected = itemOption(pending)
    if (!selected) throw new Error('Expected server-issued Quick Claw option.')
    expect(pending.outstandingWindows[0]).toMatchObject({
      ownership: [{ kind: 'actor', id: null }],
      allowPass: true,
    })
    const completed = complete({ declaration: selectedDeclaration, optionId: selected.id })
    const target = (completed.plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet
      ?? selectedDeclaration.state.pokemonSheets.get('target')) as CharacterSheet
    expect(target.items?.held).toBeUndefined()
    expect(completed.plan.nextMap.encounterState?.groundItems).toHaveLength(1)
    expect(completed.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(completed.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Klutz', spent: 1, limit: 1,
    }))

    const passedDeclaration = declare(fixture({
      slug: 'aa077-klutz-pass', actorAbilities: ['Klutz'], targetHeld: 'Quick Claw',
    }))
    const passed = complete({ declaration: passedDeclaration, optionId: null })
    expect(passed.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(0)
    expect(passed.plan.nextMap.encounterState?.abilityUsage?.entries
      .some(entry => entry.canonicalId === 'Klutz')).toBe(false)

    const noneDeclaration = declare(fixture({
      slug: 'aa077-klutz-none', actorAbilities: ['Klutz'], targetHeld: 'Quick Claw',
    }))
    if (!isAuthoritativePendingMoveStatePlan(noneDeclaration.result)) throw new Error('Expected pending Move.')
    const explicitNone = noneOption(noneDeclaration.result.suspension.pendingResolution)
    if (!explicitNone) throw new Error('Expected explicit-none item option.')
    const none = complete({ declaration: noneDeclaration, optionId: explicitNone.id })
    expect(none.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect((none.plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet | undefined)?.items?.held
      ?? noneDeclaration.state.pokemonSheets.get('target')?.items?.held).toBe('Quick Claw')

    const multiDeclaration = declare(fixture({
      slug: 'aa077-klutz-multi-hit', move: 'Fury Swipes',
      actorAbilities: ['Klutz'], targetHeld: 'Quick Claw',
    }))
    if (!isAuthoritativePendingMoveStatePlan(multiDeclaration.result)) throw new Error('Expected multi-hit Klutz response.')
    expect(multiDeclaration.result.suspension.pendingResolution.outstandingWindows).toHaveLength(1)
    const multiOption = itemOption(multiDeclaration.result.suspension.pendingResolution)
    if (!multiOption) throw new Error('Expected multi-hit item option.')
    const multi = complete({ declaration: multiDeclaration, optionId: multiOption.id })
    expect(multi.plan.nextMap.encounterState?.abilityUsage?.entries
      .find(entry => entry.canonicalId === 'Klutz')?.spent).toBe(1)
  }, 30_000)

  it('aa077.klutz.reviewed fails closed when the selected item changes across resume', () => {
    const declaration = declare(fixture({
      slug: 'aa077-klutz-stale', actorAbilities: ['Klutz'], targetHeld: 'Quick Claw',
    }))
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) throw new Error('Expected pending Move.')
    const selected = itemOption(declaration.result.suspension.pendingResolution)
    if (!selected) throw new Error('Expected Quick Claw option.')
    const target = declaration.state.pokemonSheets.get('target')!
    const changedTarget: CharacterSheet = {
      ...target,
      revision: (target.revision ?? 0) + 1,
      items: {},
    }
    const currentState = {
      ...declaration.state,
      pokemonSheets: new Map(declaration.state.pokemonSheets).set('target', changedTarget),
    }
    const changedResources = resources(currentState)
    expect(() => complete({
      declaration,
      optionId: selected.id,
      currentState,
      itemResources: changedResources,
    })).toThrow(/revalidate|available|revision|selected/i)
  }, 30_000)

  it('aa077.klutz.reviewed requires an effective damaging Melee hit and honors Leek Mastery protection', () => {
    const loadedState = fixture({
      slug: 'aa077-klutz-loaded-resources', actorAbilities: ['Klutz'], targetHeld: 'Quick Claw',
    })
    const loaded = loadMoveItemResources({
      map: loadedState.map,
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      pokemonSheets: loadedState.pokemonSheets,
      trainerSheets: new Map(),
      groupInventoryRepository: { get: () => null },
    })
    expect(loaded.requirements).toContainEqual({
      id: AA077_KLUTZ_ITEM_REQUIREMENT_ID,
      source: { kind: 'selected-target-equipped' },
    })
    expect(loaded.candidates).toContainEqual(expect.objectContaining({
      requirementId: AA077_KLUTZ_ITEM_REQUIREMENT_ID,
      reference: expect.objectContaining({ canonicalItemId: 'quick-claw' }),
    }))

    const areaBase = fixture({
      slug: 'aa077-klutz-area-resources', move: 'Dragon Hammer',
      actorAbilities: ['Klutz'], targetHeld: 'Quick Claw',
    })
    const areaState = {
      ...areaBase,
      map: {
        ...areaBase.map,
        placements: [...areaBase.map.placements, {
          id: 'decoy', sheetKind: 'pokemon' as const, sheetSlug: 'decoy',
          sideId: 'foes', position: { x: 1, y: 0, z: 3 },
        }],
      },
      pokemonSheets: new Map(areaBase.pokemonSheets).set('decoy', sheet({
        slug: 'decoy', held: 'Rare Candy',
      })),
    }
    const areaIntent: ResolveMoveIntent = {
      schemaVersion: 1, placementId: 'actor', moveName: 'Dragon Hammer',
      targetBranchId: 'line-3',
      selection: {
        kind: 'area',
        areaTemplateId: moveAutomationAreaTemplateId({ kind: 'line', size: 3 }),
        direction: 'east',
      },
    }
    const areaResources = loadMoveItemResources({
      map: areaState.map, intent: areaIntent,
      pokemonSheets: areaState.pokemonSheets, trainerSheets: new Map(),
      groupInventoryRepository: { get: () => null },
    })
    expect(areaResources.requirements.some(requirement => (
      requirement.id === AA077_KLUTZ_ITEM_REQUIREMENT_ID
    ))).toBe(false)
    expect(areaResources.candidates).toEqual([])
    expect(() => validateResolveMoveItemResourceScopes({
      map: areaState.map, intent: areaIntent, requirements: areaResources.requirements,
    })).not.toThrow()
    const areaResult = planAuthoritativeMoveStateExecution({
      map: areaState.map, pokemonSheets: areaState.pokemonSheets, trainerSheets: new Map(),
      intent: areaIntent, random: () => 0.75, now: () => 1_000,
      operationId: 'op_aa077_klutz_area', pendingResolutionId: 'resolution:aa077-klutz-area',
      itemResources: areaResources,
    })
    expect(isAuthoritativePendingMoveStatePlan(areaResult)).toBe(false)

    const suppressedLoadState = fixture({
      slug: 'aa077-klutz-suppressed-load', actorAbilities: ['Klutz'],
      targetHeld: 'Quick Claw', suppressActor: true,
    })
    expect(loadMoveItemResources({
      map: suppressedLoadState.map,
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      pokemonSheets: suppressedLoadState.pokemonSheets,
      trainerSheets: new Map(),
      groupInventoryRepository: { get: () => null },
    }).requirements.some(requirement => requirement.id === AA077_KLUTZ_ITEM_REQUIREMENT_ID)).toBe(false)

    const ranged = declare(fixture({
      slug: 'aa077-klutz-ranged', move: 'Water Gun',
      actorAbilities: ['Klutz'], targetHeld: 'Quick Claw',
    }))
    expect(isAuthoritativePendingMoveStatePlan(ranged.result)).toBe(false)

    const missedState = fixture({
      slug: 'aa077-klutz-missed', actorAbilities: ['Klutz'], targetHeld: 'Quick Claw',
    })
    const missed = declare(missedState, resources(missedState), () => 0)
    expect(isAuthoritativePendingMoveStatePlan(missed.result)).toBe(false)

    const suppressed = declare(fixture({
      slug: 'aa077-klutz-suppressed', actorAbilities: ['Klutz'],
      targetHeld: 'Quick Claw', suppressActor: true,
    }))
    expect(isAuthoritativePendingMoveStatePlan(suppressed.result)).toBe(false)

    const protectedState = fixture({
      slug: 'aa077-klutz-protected-leek', actorAbilities: ['Klutz'],
      targetAbilities: ['Leek Mastery'], targetHeld: 'Rare Leek',
    })
    const protectedContext = buildAuthoritativeMoveRulesContext({
      map: protectedState.map, pokemonSheets: protectedState.pokemonSheets,
      trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.75, time: 1_000,
    })
    expect(aa077IsProtectedRareLeek({
      context: protectedContext, ownerPlacementId: 'target', canonicalItemId: 'rare-leek',
      voluntaryActorPlacementId: 'actor',
    })).toBe(true)
    const protectedDeclaration = declare(protectedState)
    if (!isAuthoritativePendingMoveStatePlan(protectedDeclaration.result)) throw new Error('Expected pending Move.')
    const protectedWindow = protectedDeclaration.result.suspension.pendingResolution.outstandingWindows[0]
    expect(protectedWindow?.options.some(option => option.itemChoice?.canonicalItemId === 'rare-leek'))
      .toBe(false)
    const protectedNone = protectedWindow?.options.find(option => option.itemChoice?.canonicalItemId === null)
    if (!protectedNone) throw new Error('Expected protected-item explicit-none option.')
    const protectedResult = complete({ declaration: protectedDeclaration, optionId: protectedNone.id })
    const protectedTarget = (protectedResult.plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet
      ?? protectedDeclaration.state.pokemonSheets.get('target')) as CharacterSheet
    expect(protectedTarget.items?.held).toBe('Rare Leek')
    expect(protectedResult.plan.nextMap.encounterState?.groundItems).toHaveLength(0)
  }, 30_000)
})
