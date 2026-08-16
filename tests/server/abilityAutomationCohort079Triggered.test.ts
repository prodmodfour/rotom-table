import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEmptySheetEquipmentState } from '#shared/itemAutomation/equipment'
import { activeEquipmentState } from '../fixtures/equipment'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { PendingMoveResolution } from '#shared/moveAutomation/pendingResolution'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import { loadMoveItemResources } from '../../server/useCases/loadMoveItemResources'
import type { AuthoritativeMoveItemResources } from '../../server/domain/moveAutomation/itemResources'
import { AA079_MIMIC_MOVE_LIST_TAG, AA079_MIMITREE_REARM_TAG } from '#shared/abilityAutomation/aa079'

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
  held?: string
  currentHp?: number
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 25, revision: 3,
  types: ['Normal'], abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  equipmentState: input.held
    ? activeEquipmentState({ ownerKind: 'pokemon', ownerSlug: input.slug, slotId: 'held', canonicalItemId: input.held })
    : createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: input.slug }),
  ...(input.held ? { items: { held: input.held } } : {}),
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 35 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 300, injuries: 0, conditions: [] },
})
const completedTargetMove = {
  eventId: 'event.target.ember.completed', sourceOperationId: 'op.target.ember',
  resolutionId: 'resolution.target.ember', canonicalId: 'Ember', specVersion: 2,
  actorPlacementId: 'target', actionType: 'standard' as const,
  origin: { kind: 'direct' as const },
  moveListSource: { kind: 'placement' as const, placementId: 'target' },
  attackedTargetIds: ['actor'], hitTargetIds: ['actor'], outcome: 'hit' as const,
  succeeded: true, branches: [],
}
const fixture = (input: {
  slug: string
  move: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  actorHeld?: string
  targetHeld?: string
  actorHp?: number
  moveInList?: boolean
  targetHistory?: boolean
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 12, y: 4, z: 12 }, groundLevelY: 0,
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
        ...(input.targetHistory ? { lastCompletedMoves: [completedTargetMove] } : {}),
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1, turn: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor', move: input.moveInList === false ? undefined : input.move,
      abilities: input.actorAbilities, held: input.actorHeld, currentHp: input.actorHp,
    })],
    ['target', sheet({
      slug: 'target', move: 'Ember', abilities: input.targetAbilities, held: input.targetHeld,
    })],
  ])
  return { map, pokemonSheets, move: input.move }
}
type State = ReturnType<typeof fixture>
const itemResources = (state: State): AuthoritativeMoveItemResources => loadMoveItemResources({
  map: state.map,
  intent: {
    schemaVersion: 1, placementId: 'actor', moveName: state.move,
    selection: { kind: 'single-target', targetPlacementId: 'target' },
  },
  pokemonSheets: state.pokemonSheets, trainerSheets: new Map(),
  groupInventoryRepository: { get: () => null },
})
const declare = (
  state: State,
  random: () => number = () => 0.75,
  resources?: AuthoritativeMoveItemResources,
) => ({
  state,
  resources,
  result: planAuthoritativeMoveStateExecution({
    map: state.map, pokemonSheets: state.pokemonSheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName: state.move,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random, now: () => 1_000,
    operationId: `op_${state.map.slug.replace(/[^a-zA-Z0-9_]+/g, '_')}`,
    pendingResolutionId: `resolution:${state.map.slug}`,
    ...(resources ? { itemResources: resources } : {}),
  }),
})
const applyWrites = (
  sheets: ReadonlyMap<string, CharacterSheet>,
  writes: readonly { readonly slug: string; readonly nextSheet: unknown }[],
): Map<string, CharacterSheet> => {
  const next = new Map(sheets)
  for (const write of writes) next.set(write.slug, write.nextSheet as CharacterSheet)
  return next
}
const atFreshActorTurn = (map: TabletopMap, turn: number): TabletopMap => ({
  ...map,
  encounterState: map.encounterState ? {
    ...map.encounterState,
    history: {
      ...map.encounterState.history,
      currentTurn: { round: 1, turn, placementId: 'actor' },
    },
    turnResources: {
      ...map.encounterState.turnResources,
      actor: createEncounterTurnResourceLedger({ placementId: 'actor', round: 1, turn }),
    },
  } : map.encounterState,
})
const complete = (input: {
  declaration: ReturnType<typeof declare>
  optionId: string | null
  state?: State
  resources?: AuthoritativeMoveItemResources
}) => {
  if (!isAuthoritativePendingMoveStatePlan(input.declaration.result)) {
    throw new Error('Expected pending AA-079 response.')
  }
  const state = input.state ?? input.declaration.state
  const pending = input.declaration.result.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending),
    map: structuredClone(input.declaration.result.nextMap),
    pokemonSheets: state.pokemonSheets, trainerSheets: new Map(),
    response: { requestId: window.windowId, optionId: input.optionId },
    now: 2_000, random: () => 0.75,
    ...(input.resources ?? input.declaration.resources
      ? { itemResources: input.resources ?? input.declaration.resources }
      : {}),
  })
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected completed Move.')
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: input.declaration.result.suspension.preWindowPlan,
    responseOpId: `op_response_${state.map.slug}`,
    responseWindowId: window.windowId,
    responseOptionId: input.optionId,
    chosenBy: { kind: 'actor', id: 'actor' },
    map: input.declaration.result.nextMap,
    pokemonSheets: state.pokemonSheets, trainerSheets: new Map(),
    execution, plannedAt: 2_000,
    ...(input.resources ?? input.declaration.resources
      ? { itemResources: input.resources ?? input.declaration.resources }
      : {}),
  })
  return { pending, execution, plan }
}
const optionFor = (pending: PendingMoveResolution, optionId: string) => (
  pending.outstandingWindows[0]?.options.find(option => option.id === optionId)
)

describe('AA-079 triggered integrations', () => {
  it('aa079.magician.reviewed steals one revalidated foe Held Item and spends Free/Scene only on acceptance', () => {
    const state = fixture({
      slug: 'aa079-magician', move: 'Tackle', actorAbilities: ['Magician'],
      targetHeld: 'Quick Claw',
    })
    const resources = itemResources(state)
    const declaration = declare(state, () => 0.75, resources)
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    const pending = declaration.result.suspension.pendingResolution
    const selected = pending.outstandingWindows[0]?.options.find(option => (
      option.itemChoice?.canonicalItemId === 'quick-claw'
    ))
    if (!selected) throw new Error('Expected server-issued Quick Claw choice.')
    const completed = complete({ declaration, optionId: selected.id, resources })
    const actor = (completed.plan.sheetWrites.find(write => write.slug === 'actor')?.nextSheet
      ?? state.pokemonSheets.get('actor')) as CharacterSheet
    const target = (completed.plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet
      ?? state.pokemonSheets.get('target')) as CharacterSheet
    expect(actor.items?.held).toBe('Quick Claw')
    expect(target.items?.held).toBeUndefined()
    expect(completed.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(completed.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Magician', limit: 1, spent: 1,
    }))

    const passState = fixture({
      slug: 'aa079-magician-pass', move: 'Tackle', actorAbilities: ['Magician'],
      targetHeld: 'Quick Claw',
    })
    const passResources = itemResources(passState)
    const passed = complete({
      declaration: declare(passState, () => 0.75, passResources), optionId: null,
      resources: passResources,
    })
    expect(passed.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(0)
    expect(passed.plan.nextMap.encounterState?.abilityUsage?.entries
      .some(entry => entry.canonicalId === 'Magician')).toBe(false)
  }, 30_000)

  it('aa079.magician.reviewed requires a hit, empty actor slot, direct single target, and current item', () => {
    const missed = fixture({
      slug: 'aa079-magician-miss', move: 'Tackle', actorAbilities: ['Magician'],
      targetHeld: 'Quick Claw',
    })
    expect(isAuthoritativePendingMoveStatePlan(declare(
      missed, () => 0, itemResources(missed),
    ).result)).toBe(false)

    const occupied = fixture({
      slug: 'aa079-magician-occupied', move: 'Tackle', actorAbilities: ['Magician'],
      actorHeld: 'Potion', targetHeld: 'Quick Claw',
    })
    expect(isAuthoritativePendingMoveStatePlan(declare(
      occupied, () => 0.75, itemResources(occupied),
    ).result)).toBe(false)

    const declarationState = fixture({
      slug: 'aa079-magician-stale', move: 'Tackle', actorAbilities: ['Magician'],
      targetHeld: 'Quick Claw',
    })
    const resources = itemResources(declarationState)
    const declaration = declare(declarationState, () => 0.75, resources)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) throw new Error('Expected Magician response.')
    const selected = declaration.result.suspension.pendingResolution.outstandingWindows[0]?.options
      .find(option => option.itemChoice?.canonicalItemId === 'quick-claw')
    if (!selected) throw new Error('Expected item choice.')
    const changedTarget: CharacterSheet = {
      ...declarationState.pokemonSheets.get('target')!, revision: 4, items: {},
      equipmentState: createEmptySheetEquipmentState({ ownerKind: 'pokemon', ownerSlug: 'target' }),
    }
    const changedState = {
      ...declarationState,
      pokemonSheets: new Map(declarationState.pokemonSheets).set('target', changedTarget),
    }
    expect(() => complete({
      declaration, optionId: selected.id, state: changedState,
      resources: itemResources(changedState),
    })).toThrow(/revalidate|available|revision|selected/i)
  }, 30_000)

  it('aa079.migraine.reviewed offers a durable low-HP Confusion reaction and makes its accepted hit critical', () => {
    const state = fixture({
      slug: 'aa079-migraine', move: 'Confusion', actorAbilities: ['Migraine'],
      actorHp: 100, moveInList: false,
    })
    const declaration = declare(state)
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    const pending = declaration.result.suspension.pendingResolution
    const selected = optionFor(pending, 'ability.migraine.use')
    if (!selected) throw new Error('Expected Migraine response option.')
    const completed = complete({ declaration, optionId: selected.id })
    const target = (completed.plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet
      ?? state.pokemonSheets.get('target')) as CharacterSheet
    expect(target.combat?.conditions).toEqual(expect.arrayContaining(['Confused']))
    expect(JSON.stringify(completed.execution.auditTrace)).toContain('"trigger":{"kind":"always"}')
    expect(JSON.stringify(completed.execution.auditTrace)).toContain('"critical":true')
    expect(completed.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(completed.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Migraine', limit: 2, spent: 1,
    }))

    const highHp = fixture({
      slug: 'aa079-migraine-high', move: 'Confusion', actorAbilities: ['Migraine'],
      actorHp: 300, moveInList: false,
    })
    expect(isAuthoritativePendingMoveStatePlan(declare(highHp).result)).toBe(false)
  }, 30_000)

  it('aa079.mimitree.reviewed copies from authoritative history, rearms after acceptance, and bypasses Mimic frequency', () => {
    const initial = fixture({
      slug: 'aa079-mimitree', move: 'Mimic', actorAbilities: ['Mimitree'],
      moveInList: false, targetHistory: true,
    })
    const copied = declare(initial)
    if (isAuthoritativePendingMoveStatePlan(copied.result)) throw new Error('Initial Mimic should resolve immediately.')
    expect(copied.result.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'move-list-overlay', tags: expect.arrayContaining([AA079_MIMIC_MOVE_LIST_TAG]),
      payload: expect.objectContaining({
        action: 'replace', replacedCanonicalMoveId: 'Mimic', canonicalMoveId: 'Ember',
      }),
    }))
    const copiedState: State = {
      map: atFreshActorTurn(copied.result.nextMap, 2),
      pokemonSheets: applyWrites(initial.pokemonSheets, copied.result.sheetWrites),
      move: 'Ember',
    }
    const rearmDeclaration = declare(copiedState)
    expect(isAuthoritativePendingMoveStatePlan(rearmDeclaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(rearmDeclaration.result)) return
    const pending = rearmDeclaration.result.suspension.pendingResolution
    const selected = optionFor(pending, 'ability.mimitree.rearm')
    if (!selected) throw new Error('Expected Mimitree rearm option.')
    const rearmed = complete({ declaration: rearmDeclaration, optionId: selected.id })
    expect(rearmed.plan.nextMap.encounterState?.effects.some(effect => (
      effect.tags.includes(AA079_MIMIC_MOVE_LIST_TAG)
    ))).toBe(false)
    expect(rearmed.plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability', tags: expect.arrayContaining([AA079_MIMITREE_REARM_TAG]),
    }))

    const rearmedState: State = {
      map: atFreshActorTurn(rearmed.plan.nextMap, 3),
      pokemonSheets: applyWrites(copiedState.pokemonSheets, rearmed.plan.sheetWrites),
      move: 'Mimic',
    }
    const secondMimic = declare(rearmedState)
    expect(isAuthoritativePendingMoveStatePlan(secondMimic.result)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(secondMimic.result)) return
    expect(secondMimic.result.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'move-list-overlay', tags: expect.arrayContaining([AA079_MIMIC_MOVE_LIST_TAG]),
    }))
    expect(secondMimic.result.nextMap.encounterState?.effects.some(effect => (
      effect.tags.includes(AA079_MIMITREE_REARM_TAG)
    ))).toBe(false)
  }, 30_000)
})
