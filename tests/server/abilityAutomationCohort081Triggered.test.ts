import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { applyAa081NaturalCureForBreather } from '../../server/domain/abilityAutomation/mechanics/aa081LifecycleIntegration'
import { aa081NeutralizingGasBlocksTriggeredAbility } from '../../server/domain/abilityAutomation/mechanics/aa081NeutralizingGasIntegration'

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
  conditions?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 30, revision: 3,
  types: ['Normal'], abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 300, injuries: 0, conditions: [...(input.conditions ?? [])] },
})
const fixture = (input: {
  slug: string
  move: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  targetDistance?: number
  targetConditions?: readonly string[]
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2 + (input.targetDistance ?? 1), y: 0, z: 2 } },
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 14, y: 4, z: 14 }, groundLevelY: 0,
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
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move: input.move, abilities: input.actorAbilities })],
    ['target', sheet({
      slug: 'target', abilities: input.targetAbilities, conditions: input.targetConditions,
    })],
  ])
  return { map, sheets, move: input.move }
}
type State = ReturnType<typeof fixture>
const declare = (state: State) => planAuthoritativeMoveStateExecution({
  map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
  intent: {
    schemaVersion: 1, placementId: 'actor', moveName: state.move,
    selection: { kind: 'single-target', targetPlacementId: 'target' },
  },
  random: () => 0.75, now: () => 1_000,
  operationId: `op_${id(state.map.slug)}`,
  pendingResolutionId: `resolution:${state.map.slug}`,
})
const targetHp = (state: State, plan = declare(state)): number => {
  if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Unexpected pending move.')
  return ((plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet
    ?? state.sheets.get('target')!) as CharacterSheet).combat?.currentHp ?? 0
}

describe('AA-081 triggered and suppression integrations', () => {
  it('Needles causes one exact Tick of HP loss after a Physical Melee hit', () => {
    const plain = fixture({ slug: 'aa081-needles-plain', move: 'Tackle' })
    const needles = fixture({ slug: 'aa081-needles', move: 'Tackle', actorAbilities: ['Needles'] })
    // The authoritative target maximum is 358, so one Tick is 35.
    expect(targetHp(plain) - targetHp(needles)).toBe(35)
    const ranged = fixture({ slug: 'aa081-needles-ranged', move: 'Rock Throw', actorAbilities: ['Needles'] })
    const rangedPlain = fixture({ slug: 'aa081-needles-ranged-plain', move: 'Rock Throw' })
    expect(targetHp(ranged)).toBe(targetHp(rangedPlain))
  })

  it('Mummy opens one owner-authorized durable choice and suppresses only the selected disableable ability', () => {
    const state = fixture({
      slug: 'aa081-mummy', move: 'Tackle', actorAbilities: ['No Guard'], targetAbilities: ['Mummy'],
    })
    const declaration = declare(state)
    expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) return
    const pending = declaration.suspension.pendingResolution
    const window = pending.outstandingWindows[0]!
    expect(window).toMatchObject({
      reasonCode: 'ability.mummy.optional-disable',
      ownership: [{ kind: 'target', id: 'target' }],
    })
    const option = window.options.find(candidate => candidate.id.endsWith('base:no-guard'))
    expect(option).toBeDefined()
    const execution = resumeMoveSpec({
      pendingResolution: structuredClone(pending), map: structuredClone(declaration.nextMap),
      pokemonSheets: state.sheets, trainerSheets: new Map(),
      response: { requestId: window.windowId, optionId: option!.id },
      now: 2_000, random: () => 0.75,
    })
    expect(isAuthoritativePendingMoveResolution(execution)).toBe(false)
    if (isAuthoritativePendingMoveResolution(execution)) return
    const plan = planResumedMoveState({
      pendingResolution: pending, declarationPlan: declaration.suspension.preWindowPlan,
      responseOpId: 'op_aa081_mummy_response', responseWindowId: window.windowId,
      responseOptionId: option!.id, chosenBy: { kind: 'target', id: 'target' },
      map: declaration.nextMap, pokemonSheets: state.sheets, trainerSheets: new Map(),
      execution, plannedAt: 2_000,
    })
    expect(plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    const context = buildAuthoritativeMoveRulesContext({
      map: plan.nextMap, pokemonSheets: state.sheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      candidatePlacementIds: ['target'], selectedPlacementIds: ['target'], random: () => 0.75, time: 2_000,
    })
    expect(context.queries.abilities.has('actor', 'No Guard')).toBe(false)
    expect(context.map.encounterState?.effects.some(effect => effect.tags.includes('mummy'))).toBe(true)
  }, 30_000)

  it('does not trigger Mummy on ranged attacks or inside another user’s Neutralizing Gas', () => {
    const ranged = fixture({ slug: 'aa081-mummy-ranged', move: 'Rock Throw', targetAbilities: ['Mummy'] })
    expect(isAuthoritativePendingMoveStatePlan(declare(ranged))).toBe(false)
    const blocked = fixture({
      slug: 'aa081-mummy-gas', move: 'Tackle', actorAbilities: ['Neutralizing Gas'], targetAbilities: ['Mummy'],
    })
    expect(isAuthoritativePendingMoveStatePlan(declare(blocked))).toBe(false)
  })

  it('Neutralizing Gas suppresses nearby Defensive mechanics and its four Moves retain suppression for one round', () => {
    const filtered = fixture({ slug: 'aa081-gas-filter', move: 'Brick Break', targetAbilities: ['Filter'] })
    const gas = fixture({
      slug: 'aa081-gas-near', move: 'Brick Break', actorAbilities: ['Neutralizing Gas'], targetAbilities: ['Filter'],
    })
    const plain = fixture({ slug: 'aa081-gas-plain', move: 'Brick Break' })
    expect(targetHp(filtered)).toBeGreaterThan(targetHp(plain))
    expect(targetHp(gas)).toBe(targetHp(plain))

    const extended = fixture({
      slug: 'aa081-gas-extended', move: 'Clear Smog', actorAbilities: ['Neutralizing Gas'],
      targetAbilities: ['Mummy', 'Filter'], targetDistance: 4,
    })
    const plan = declare(extended)
    expect(isAuthoritativePendingMoveStatePlan(plan)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(plan)) return
    const effect = plan.nextMap.encounterState?.effects.find(candidate => (
      candidate.kind === 'capability'
      && candidate.payload.capabilityId === 'ability.neutralizing-gas.suppressed'
    ))
    expect(effect).toMatchObject({ duration: { kind: 'rounds', boundary: 'end', remaining: 1 } })
    const context = buildAuthoritativeMoveRulesContext({
      map: plan.nextMap, pokemonSheets: extended.sheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Clear Smog', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      candidatePlacementIds: ['target'], selectedPlacementIds: ['target'], random: () => 0.75, time: 2_000,
    })
    expect(context.queries.abilities.has('target', 'Filter')).toBe(false)
    const abilities = new Map(context.queries.placements.all().map(placement => [
      placement.id, context.queries.abilities.activeForPlacement(placement.id),
    ] as const))
    const tokens = new Map(context.queries.tokens.all().map(token => [token.id, token] as const))
    expect(aa081NeutralizingGasBlocksTriggeredAbility({
      abilitiesByPlacement: abilities, tokensById: tokens,
      effects: plan.nextMap.encounterState?.effects ?? [], ownerPlacementId: 'target',
    })).toBe(true)
  })

  it('Natural Cure treats Take a Breather as opt-in, pays Free/Scene, and cures only Persistent Statuses', () => {
    const state = fixture({
      slug: 'aa081-natural-cure', move: 'Tackle', targetAbilities: ['Natural Cure'],
      targetConditions: ['Burned', 'Poisoned', 'Confused'],
    })
    const result = applyAa081NaturalCureForBreather({
      map: state.map,
      placement: state.map.placements.find(placement => placement.id === 'target')!,
      sheet: state.sheets.get('target')!, operationId: 'op_aa081_breather',
    })
    expect(result.applied).toBe(true)
    expect((result.sheet as CharacterSheet).combat?.conditions).toEqual(['Confused'])
    expect(result.map.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(result.map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Natural Cure', spent: 1, limit: 1,
    }))
    const repeated = applyAa081NaturalCureForBreather({
      map: result.map,
      placement: state.map.placements.find(placement => placement.id === 'target')!,
      sheet: state.sheets.get('target')!, operationId: 'op_aa081_other_breather',
    })
    expect(repeated.applied).toBe(false)
  })
})
