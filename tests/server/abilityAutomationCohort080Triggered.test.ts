import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
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
import { planEncounterLifecycle } from '../../server/domain/moveAutomation/planInitiativeLifecycle'

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
  currentHp?: number
  atkStage?: number
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 25, revision: 3,
  types: ['Normal'], abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 80 }, atk: { added: 40, stage: input.atkStage ?? 0 }, def: { added: 30 },
    satk: { added: 40 }, sdef: { added: 30 }, spd: { added: 35 },
  },
  combatStages: { atk: input.atkStage ?? 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 250, injuries: 0, conditions: [] },
})
const fixture = (input: {
  slug: string
  move?: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  actorHp?: number
  targetHp?: number
  targetAtkStage?: number
  includeOther?: boolean
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 3, y: 0, z: 2 } },
    ...(input.includeOther ? [{
      id: 'other', sheetKind: 'pokemon' as const, sheetSlug: 'other', sideId: 'foes',
      position: { x: 2, y: 0, z: 3 },
    }] : []),
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 10, y: 4, z: 10 }, groundLevelY: 0,
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
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 }, metadata: {},
  }
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor', move: input.move ?? 'Play Nice', abilities: input.actorAbilities,
      currentHp: input.actorHp,
    })],
    ['target', sheet({
      slug: 'target', abilities: input.targetAbilities, currentHp: input.targetHp,
      atkStage: input.targetAtkStage,
    })],
    ...(input.includeOther ? [['other', sheet({ slug: 'other', currentHp: input.targetHp })] as const] : []),
  ])
  return { map, pokemonSheets, move: input.move ?? 'Play Nice' }
}
type State = ReturnType<typeof fixture>
const declare = (
  state: State,
  selection: Parameters<typeof planAuthoritativeMoveStateExecution>[0]['intent']['selection'] = {
    kind: 'single-target', targetPlacementId: 'target',
  },
) => ({
  state,
  result: planAuthoritativeMoveStateExecution({
    map: state.map, pokemonSheets: state.pokemonSheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName: state.move, selection,
    },
    random: () => 0.75, now: () => 1_000,
    operationId: `op_${id(state.map.slug)}`,
    pendingResolutionId: `resolution:${state.map.slug}`,
  }),
})
const complete = (declaration: ReturnType<typeof declare>, optionId: string | null) => {
  if (!isAuthoritativePendingMoveStatePlan(declaration.result)) throw new Error('Expected durable AA-080 reaction.')
  const pending = declaration.result.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending),
    map: structuredClone(declaration.result.nextMap),
    pokemonSheets: declaration.state.pokemonSheets, trainerSheets: new Map(),
    response: { requestId: window.windowId, optionId },
    now: 2_000, random: () => 0.75,
  })
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected one completed response.')
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: declaration.result.suspension.preWindowPlan,
    responseOpId: `op_response_${id(declaration.state.map.slug)}`,
    responseWindowId: window.windowId,
    responseOptionId: optionId,
    chosenBy: { kind: 'gm', id: null },
    map: declaration.result.nextMap,
    pokemonSheets: declaration.state.pokemonSheets, trainerSheets: new Map(),
    execution, plannedAt: 2_000,
  })
  return { pending, window, execution, plan }
}
const plannedSheet = (input: ReturnType<typeof complete>, state: State, slug: 'actor' | 'target') => (
  input.plan.sheetWrites.find(write => write.slug === slug)?.nextSheet ?? state.pokemonSheets.get(slug)!
) as CharacterSheet
const stage = (value: CharacterSheet, key: 'atk' | 'def' | 'satk') => value.stats?.[key]?.stage
  ?? value.combatStages?.[key] ?? 0

describe('AA-080 triggered and lifecycle integrations', () => {
  it('Minus offers a durable nearby-foe reaction, pays Free/Scene x2 only on acceptance, and adds exactly one stage loss', () => {
    const state = fixture({ slug: 'aa080-minus', actorAbilities: ['Minus'] })
    const declaration = declare(state)
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    expect(declaration.result.suspension.pendingResolution.outstandingWindows[0]).toMatchObject({
      reasonCode: 'ability.minus.optional-additional-stage-loss',
      ownership: [{ kind: 'actor', id: null }],
      options: [{ id: 'ability.minus.use' }],
    })
    const accepted = complete(declaration, 'ability.minus.use')
    expect(stage(plannedSheet(accepted, state, 'target'), 'atk')).toBe(-2)
    expect(accepted.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(accepted.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Minus', limit: 2, spent: 1,
    }))

    const passState = fixture({ slug: 'aa080-minus-pass', actorAbilities: ['Minus'] })
    const passed = complete(declare(passState), null)
    expect(stage(plannedSheet(passed, passState, 'target'), 'atk')).toBe(-1)
    expect(passed.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(0)
    expect(passed.plan.nextMap.encounterState?.abilityUsage?.entries.some(entry => entry.canonicalId === 'Minus')).toBe(false)
  }, 30_000)

  it('Mirror Armor prevents the exact direct loss, reflects its capped amount, and preserves pass behavior', () => {
    const state = fixture({ slug: 'aa080-mirror', targetAbilities: ['Mirror Armor'] })
    const accepted = complete(declare(state), 'ability.mirror-armor.use')
    expect(stage(plannedSheet(accepted, state, 'target'), 'atk')).toBe(0)
    expect(stage(plannedSheet(accepted, state, 'actor'), 'atk')).toBe(-1)
    expect(accepted.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(accepted.plan.nextMap.encounterState?.abilityUsage?.entries.some(entry => entry.canonicalId === 'Mirror Armor')).toBe(false)

    const passState = fixture({ slug: 'aa080-mirror-pass', targetAbilities: ['Mirror Armor'] })
    const passed = complete(declare(passState), null)
    expect(stage(plannedSheet(passed, passState, 'target'), 'atk')).toBe(-1)
    expect(stage(plannedSheet(passed, passState, 'actor'), 'atk')).toBe(0)
    expect(passed.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(0)

    const capped = fixture({
      slug: 'aa080-mirror-capped', targetAbilities: ['Mirror Armor'], targetAtkStage: -6,
    })
    expect(isAuthoritativePendingMoveStatePlan(declare(capped).result)).toBe(false)
  }, 30_000)

  it('groups multi-stat triggers into one Mirror Armor response and one-stat Minus choice', () => {
    const area = {
      kind: 'area' as const,
      areaTemplateId: moveAutomationAreaTemplateId({ kind: 'burst', size: 1 }),
    }
    const mirrorState = fixture({
      slug: 'aa080-mirror-multi-stat', move: 'Noble Roar', targetAbilities: ['Mirror Armor'],
    })
    const mirrorDeclaration = declare(mirrorState, area)
    expect(isAuthoritativePendingMoveStatePlan(mirrorDeclaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(mirrorDeclaration.result)) return
    expect(mirrorDeclaration.result.suspension.pendingResolution.outstandingWindows).toHaveLength(1)
    const reflected = complete(mirrorDeclaration, 'ability.mirror-armor.use')
    expect(stage(plannedSheet(reflected, mirrorState, 'target'), 'atk')).toBe(0)
    expect(stage(plannedSheet(reflected, mirrorState, 'target'), 'satk')).toBe(0)
    expect(stage(plannedSheet(reflected, mirrorState, 'actor'), 'atk')).toBe(-1)
    expect(stage(plannedSheet(reflected, mirrorState, 'actor'), 'satk')).toBe(-1)

    const minusState = fixture({
      slug: 'aa080-minus-multi-stat', move: 'Noble Roar', actorAbilities: ['Minus'],
    })
    const minusDeclaration = declare(minusState, area)
    expect(isAuthoritativePendingMoveStatePlan(minusDeclaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(minusDeclaration.result)) return
    const window = minusDeclaration.result.suspension.pendingResolution.outstandingWindows[0]!
    expect(window.options).toHaveLength(2)
    const lowered = complete(minusDeclaration, window.options[0]!.id)
    expect([
      stage(plannedSheet(lowered, minusState, 'target'), 'atk'),
      stage(plannedSheet(lowered, minusState, 'target'), 'satk'),
    ].sort((left, right) => left - right)).toEqual([-2, -1])
  }, 30_000)

  it('Moody uses two ledger-backed d6 draws, canonical stat order, distinct stats, and deterministic replay', () => {
    const state = fixture({ slug: 'aa080-moody', actorAbilities: ['Moody'] })
    const run = () => {
      const draws = [0.01, 0.01]
      return planEncounterLifecycle({
        map: structuredClone(state.map),
        events: [{
          schemaVersion: 2 as const, eventId: 'event.aa080.moody.turn-end', kind: 'turn-end' as const,
          sourceOperationId: 'op.aa080.moody.turn-end', causalParentEventId: null,
          reasonCode: 'test.aa080.moody', round: 1, turn: 1,
          placementId: 'actor', sideId: 'heroes',
        }],
        time: 2_000,
        random: () => draws.shift() ?? 0.5,
        loadSheets: () => ({ pokemonSheets: state.pokemonSheets, trainerSheets: new Map() }),
      })
    }
    const first = run()
    const actor = first.sheetWrites.find(write => write.slug === 'actor')?.nextSheet as CharacterSheet
    expect(stage(actor, 'atk')).toBe(2)
    expect(stage(actor, 'def')).toBe(-1)
    expect(first.rollLedger.map(roll => roll.naturalResult)).toEqual([1, 1])
    expect(run().rollLedger).toEqual(first.rollLedger)
    expect(JSON.stringify(first.reduction.trace)).toContain('ability.moody.turn-end-raise')
    expect(JSON.stringify(first.reduction.trace)).toContain('ability.moody.turn-end-lower')
  })

  it('Moxie uses the native MoveSpec response, revalidates its effective runtime, and triggers once per Move-fainted foe set', () => {
    const state = fixture({
      slug: 'aa080-moxie', move: 'Tackle', actorAbilities: ['Moxie'], targetHp: 1,
    })
    const declaration = declare(state)
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    expect(declaration.result.suspension.pendingResolution.outstandingWindows).toContainEqual(
      expect.objectContaining({
        reasonCode: 'ability.moxie.optional-attack-stage',
        ownership: [{ kind: 'actor', id: null }],
        options: [{ id: 'ability.moxie.use', labelKey: 'ability.moxie.raise-attack' }],
      }),
    )
    const accepted = complete(declaration, 'ability.moxie.use')
    expect(stage(plannedSheet(accepted, state, 'actor'), 'atk')).toBe(1)
    expect(accepted.plan.nextMap.encounterState?.turnResources.actor?.actions).toEqual(
      state.map.encounterState?.turnResources.actor?.actions,
    )
    expect(accepted.plan.nextMap.encounterState?.abilityUsage?.entries.some(entry => (
      entry.canonicalId === 'Moxie'
    )) ?? false).toBe(false)

    const pending = declaration.result.suspension.pendingResolution
    const window = pending.outstandingWindows[0]!
    const staleActor = { ...state.pokemonSheets.get('actor')!, abilities: [], revision: 4 }
    expect(() => resumeMoveSpec({
      pendingResolution: structuredClone(pending),
      map: structuredClone(declaration.result.nextMap),
      pokemonSheets: new Map([
        ['actor', staleActor],
        ['target', state.pokemonSheets.get('target')!],
      ]),
      trainerSheets: new Map(),
      response: { requestId: window.windowId, optionId: 'ability.moxie.use' },
      now: 2_000,
      random: () => 0.75,
    })).toThrow()

    const multiState = fixture({
      slug: 'aa080-moxie-multi', move: 'Discharge', actorAbilities: ['Moxie'],
      targetHp: 1, includeOther: true,
    })
    const multiDeclaration = declare(multiState, {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId({ kind: 'cardinally-adjacent', size: 1 }),
    })
    expect(isAuthoritativePendingMoveStatePlan(multiDeclaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(multiDeclaration.result)) return
    expect(multiDeclaration.result.suspension.pendingResolution.outstandingWindows.filter(window => (
      window.reasonCode === 'ability.moxie.optional-attack-stage'
    ))).toHaveLength(1)

    const absent = fixture({ slug: 'aa080-moxie-absent', move: 'Tackle', targetHp: 1 })
    expect(isAuthoritativePendingMoveStatePlan(declare(absent).result)).toBe(false)
  })
})
