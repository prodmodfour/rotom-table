import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import { planResumedMoveState } from '~~/server/domain/moveAutomation/planResumedMoveState'
import { resumeMoveSpec } from '~~/server/domain/moveAutomation/resumeSpec'
import { enumerateAuthoritativeMovementChoices } from '~~/server/domain/movement/resolveMovementChoices'
import { planMoveUsageTransition } from '~~/server/domain/planMoveUsageTransition'
import {
  activelyCommandingTrainerPlacementId,
  recordActivelyCommandedPokemon,
} from '~~/server/domain/moveAutomation/activePokemonCommands'
import {
  AA085_QUEENLY_MAJESTY_REASON,
  AA085_QUICK_DRAW_REASON,
  AA085_RKS_SYSTEM_REASON,
  AA086_RATTLED_REASON,
  AA089_SHELL_CANNON_REASON,
  AA090_SOUL_HEART_REASON,
  AA092_STEADFAST_REASON,
  AA093_SWAY_REASON,
  AA094_SYNCHRONIZE_REASON,
  AA096_TRINITY_PHYSICAL_OPTION_ID,
  AA096_TRINITY_REASON,
  AA097_VICIOUS_REASON,
  AA098_WALLMASTER_REASON,
  AA098_WANDERING_SPIRIT_REASON,
  AA098_WEAPONIZE_REASON,
  AA098_WEEBLE_REASON,
  AA099_WISHMASTER_REASON,
  AA099_WOBBLE_REASON,
} from '~~/server/domain/abilityAutomation/mechanics/aa085to100MoveIntegration'
import {
  AA084_PRANKSTER_REASON,
} from '~~/server/domain/abilityAutomation/mechanics/aa084MoveIntegration'
import { recordAa085to100MovementEvidence } from '~~/server/domain/abilityAutomation/mechanics/aa085to100MovementIntegration'
import {
  AA085_RADIANT_BEAM_TARGET_BRANCH_ID,
  AA090_SONIC_COURTSHIP_TARGET_BRANCH_ID,
  AA091_SPIKE_SHOT_TARGET_BRANCH_ID,
  AA096_TRINITY_TARGET_BRANCH_ID,
} from '~~/server/domain/abilityAutomation/mechanics/aa085to100StaticIntegration'
import { REMAINING_ABILITY_TEST_REGISTRY } from '../fixtures/abilityAutomation/remainingRegistry'

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${slug(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  readonly slug: string
  readonly abilities?: readonly string[]
  readonly moves?: readonly string[]
  readonly types?: readonly string[]
  readonly species?: string
  readonly currentHp?: number
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: input.species ?? 'Eevee', level: 30, revision: 4,
  types: [...(input.types ?? ['Normal'])],
  abilities: (input.abilities ?? []).map(ability),
  movelist: (input.moves ?? ['Tackle']).map(name => ({ name })),
  stats: {
    hp: { added: 50 }, atk: { added: 20 }, def: { added: 20 },
    satk: { added: 20 }, sdef: { added: 20 }, spd: { added: 20 },
  },
  capabilities: { overland: 5, sky: 0, swim: 2, levitate: 0, burrow: 0 },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 150, injuries: 0, conditions: [] },
})

const fixture = (input: {
  readonly actorAbilities?: readonly string[]
  readonly targetAbilities?: readonly string[]
  readonly actorMoves?: readonly string[]
  readonly targetMoves?: readonly string[]
  readonly actorSpecies?: string
  readonly targetSpecies?: string
  readonly actorCurrentHp?: number
  readonly targetCurrentHp?: number
  readonly actorTypes?: readonly string[]
  readonly targetTypes?: readonly string[]
  readonly actorAllyAbilities?: readonly string[]
  readonly actorAllyPosition?: { readonly x: number; readonly y: number; readonly z: number }
  readonly targetAllyAbilities?: readonly string[]
  readonly targetAllySpecies?: string
  readonly targetAllyTypes?: readonly string[]
  readonly targetAllyCurrentHp?: number
  readonly actorPosition?: { readonly x: number; readonly y: number; readonly z: number }
  readonly targetPosition?: { readonly x: number; readonly y: number; readonly z: number }
  readonly targetSideId?: 'heroes' | 'foes'
}) => {
  const placements: TabletopMap['placements'] = [
    {
      id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes',
      position: input.actorPosition ?? { x: 4, y: 0, z: 4 }, initiative: 20,
    },
    {
      id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: input.targetSideId ?? 'foes',
      position: input.targetPosition ?? { x: 5, y: 0, z: 4 }, initiative: 10,
    },
    ...(input.actorAllyAbilities ? [{
      id: 'actor-ally', sheetKind: 'pokemon' as const, sheetSlug: 'actor-ally', sideId: 'heroes',
      position: input.actorAllyPosition ?? { x: 4, y: 0, z: 5 }, initiative: 9,
    }] : []),
    ...(input.targetAllyAbilities ? [{
      id: 'target-ally', sheetKind: 'pokemon' as const, sheetSlug: 'target-ally', sideId: 'foes',
      position: { x: 4, y: 0, z: 5 }, initiative: 8,
    }] : []),
  ]
  const encounter = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2, slug: 'remaining-move-conformance', name: 'Remaining move conformance', revision: 5,
    dimensions: { x: 14, y: 8, z: 14 }, groundLevelY: 0,
    voxels: [], hazards: [], placements,
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 1 },
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history, sceneId: 'scene:remaining-move', currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1, turn: 1 }),
      ])),
    },
  }
  return {
    map,
    pokemonSheets: new Map<string, CharacterSheet>([
      ['actor', sheet({
        slug: 'actor', abilities: input.actorAbilities, moves: input.actorMoves,
        species: input.actorSpecies, currentHp: input.actorCurrentHp,
        types: input.actorTypes,
      })],
      ['target', sheet({
        slug: 'target', abilities: input.targetAbilities, moves: input.targetMoves,
        species: input.targetSpecies, currentHp: input.targetCurrentHp,
        types: input.targetTypes,
      })],
      ...(input.actorAllyAbilities ? [[
        'actor-ally', sheet({ slug: 'actor-ally', abilities: input.actorAllyAbilities }),
      ] as const] : []),
      ...(input.targetAllyAbilities ? [[
        'target-ally', sheet({
          slug: 'target-ally', abilities: input.targetAllyAbilities,
          species: input.targetAllySpecies, types: input.targetAllyTypes,
          currentHp: input.targetAllyCurrentHp,
        }),
      ] as const] : []),
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
  }
}

const weaponizeFixture = (activelyCommanded: boolean): ReturnType<typeof fixture> => {
  const state = fixture({ actorMoves: ['Tackle'], targetPosition: { x: 11, y: 0, z: 4 } })
  const weaponPlacement: TabletopMap['placements'][number] = {
    id: 'living-weapon', sheetKind: 'pokemon', sheetSlug: 'living-weapon', sideId: 'foes',
    position: { x: 9, y: 0, z: 4 }, initiative: 8,
  }
  const wielderPlacement: TabletopMap['placements'][number] = {
    id: 'wielder', sheetKind: 'trainer', sheetSlug: 'wielder', sideId: 'foes',
    position: { x: 5, y: 0, z: 4 }, initiative: 9,
  }
  const placements = [...state.map.placements, wielderPlacement, weaponPlacement]
  const livingWeaponSheet = sheet({
    slug: 'living-weapon', species: 'Honedge', abilities: ['Weaponize'],
  })
  state.pokemonSheets.set('living-weapon', {
    ...livingWeaponSheet,
    capabilities: { ...livingWeaponSheet.capabilities!, other: ['Living Weapon'] },
  })
  state.trainerSheets.set('wielder', {
    slug: 'wielder', name: 'Wielder', level: 30, revision: 4,
    maxHp: 150, currentHp: 150,
    currentTeam: ['living-weapon'],
    equipmentSlots: { mainHand: 'living-weapon' },
  })
  const encounterState = state.map.encounterState!
  state.map = {
    ...state.map,
    placements,
    encounterState: {
      ...encounterState,
      turnResources: {
        ...encounterState.turnResources,
        wielder: createEncounterTurnResourceLedger({ placementId: 'wielder', round: 1, turn: 1 }),
        'living-weapon': createEncounterTurnResourceLedger({
          placementId: 'living-weapon', round: 1, turn: 1,
        }),
      },
    },
  }
  if (activelyCommanded) {
    state.map = recordActivelyCommandedPokemon({
      map: state.map,
      trainerPlacementId: 'wielder',
      pokemonPlacementId: 'living-weapon',
      operationId: 'test.weaponize.command',
    })
  }
  return state
}

type Choice = (input: {
  readonly reasonCode: string
  readonly ownerId: string
  readonly options: readonly { readonly id: string; readonly selection?: {
    readonly kind: string
    readonly placementId?: string
    readonly destination?: { readonly x: number; readonly y: number; readonly z: number }
    readonly cell?: { readonly x: number; readonly y: number; readonly z: number }
  } }[]
}) => string | readonly string[] | null

const complete = (input: {
  readonly state: ReturnType<typeof fixture>
  readonly moveName: string
  readonly choose: Choice
  readonly random?: () => number
  readonly targetBranchId?: string
  readonly selection?: { readonly kind: 'self' } | {
    readonly kind: 'single-target'
    readonly targetPlacementId: string
  } | {
    readonly kind: 'target-count'
    readonly targetPlacementIds: readonly string[]
  } | {
    readonly kind: 'area'
    readonly areaTemplateId: string
    readonly direction?: 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west' | 'north-west' | 'up' | 'down'
    readonly aimCell?: { readonly x: number; readonly y: number; readonly z: number }
  }
}) => {
  const random = input.random ?? (() => 0.95)
  const selection = input.selection
    ?? { kind: 'single-target' as const, targetPlacementId: 'target' }
  let plan = planAuthoritativeMoveStateExecution({
    ...input.state,
    intent: {
      schemaVersion: 1 as const, placementId: 'actor', moveName: input.moveName,
      ...(input.targetBranchId ? { targetBranchId: input.targetBranchId } : {}),
      selection,
    },
    random, now: () => 1_000,
    operationId: `op_remaining_${slug(input.moveName)}`,
    pendingResolutionId: `resolution:remaining:${slug(input.moveName)}`,
    abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
  })
  const seen: Array<{
    reasonCode: string
    optionIds: readonly string[]
    destinations: readonly { readonly x: number; readonly y: number; readonly z: number }[]
  }> = []
  let index = 0
  while (isAuthoritativePendingMoveStatePlan(plan)) {
    const pending = plan.suspension.pendingResolution
    const window = pending.outstandingWindows[0]!
    const hazardOptions = window.kind === 'choice' && window.hazardCellSelection
      ? window.hazardCellSelection.options.map(option => ({
          id: option.id,
          selection: { kind: 'hazard-cell', cell: option.cell },
        }))
      : null
    const options = hazardOptions ?? window.options
    seen.push({
      reasonCode: window.reasonCode,
      optionIds: options.map(option => option.id),
      destinations: window.options.flatMap(option => (
        option.selection?.kind === 'movement-destination' ? [option.selection.destination] : []
      )),
    })
    const selected = input.choose({
      reasonCode: window.reasonCode,
      ownerId: window.ownership[0]?.id ?? '',
      options,
    })
    const selectedOptionIds = typeof selected === 'string'
      ? [selected]
      : selected ? [...selected] : []
    const optionId = typeof selected === 'string' ? selected : null
    const execution = resumeMoveSpec({
      pendingResolution: structuredClone(pending), ...input.state,
      map: structuredClone(plan.nextMap),
      ...(window.kind === 'choice' && window.hazardCellSelection
        ? { hazardCellResponse: {
            window: window.hazardCellSelection,
            selectedOptionIds,
          } }
        : { response: { requestId: window.windowId, optionId } }),
      now: 2_000 + index, random,
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    })
    plan = planResumedMoveState({
      pendingResolution: pending,
      declarationPlan: plan.suspension.preWindowPlan,
      responseOpId: `op_remaining_response_${index}`,
      responseWindowId: window.windowId,
      responseOptionId: optionId,
      ...(window.kind === 'choice' && window.hazardCellSelection
        ? { responseOptionIds: selectedOptionIds }
        : {}),
      chosenBy: window.ownership[0]!,
      ...input.state, map: plan.nextMap, execution, plannedAt: 2_000 + index,
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    })
    if (++index > 15) throw new Error('Too many remaining-catalog response windows.')
  }
  return { plan, seen }
}

const nextSheet = (result: ReturnType<typeof complete>, slugValue: string): CharacterSheet => {
  const write = result.plan.sheetWrites.find(candidate => candidate.slug === slugValue)
  if (!write) throw new Error(`Expected a committed sheet write for ${slugValue}.`)
  return write.nextSheet as CharacterSheet
}

describe('AA-085 through AA-100 move conformance', () => {
  it('Refrigerate projects the selected Ice type through defensive immunity and healing', () => {
    const result = complete({
      state: fixture({
        actorAbilities: ['Refrigerate'], actorMoves: ['Tackle'],
        targetAbilities: ['Winter’s Kiss'], targetCurrentHp: 100,
      }),
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === 'ability.refrigerate.optional-ice-type'
        ? options[0]?.id ?? null : null,
    })
    expect(nextSheet(result, 'target').combat?.currentHp).toBeGreaterThan(100)
    expect(nextSheet(result, 'target').combat?.currentHp).toBeLessThanOrEqual(150)
  })

  it('retains optional base targeting while authorizing reviewed Radiant Beam and Trinity branches', () => {
    const baseTrinity = complete({
      state: fixture({ actorAbilities: ['Trinity'], actorMoves: ['Tri Attack'] }),
      moveName: 'Tri Attack',
      selection: { kind: 'single-target', targetPlacementId: 'target' },
      choose: ({ reasonCode }) => reasonCode === AA096_TRINITY_REASON
        ? AA096_TRINITY_PHYSICAL_OPTION_ID : null,
    })
    expect(nextSheet(baseTrinity, 'target').combat?.currentHp).toBeLessThan(150)

    const radiant = complete({
      state: fixture({ actorAbilities: ['Radiant Beam'], actorMoves: ['Razor Leaf'] }),
      moveName: 'Razor Leaf',
      targetBranchId: AA085_RADIANT_BEAM_TARGET_BRANCH_ID,
      selection: { kind: 'area', areaTemplateId: 'line:any:4', direction: 'east' },
      choose: () => null,
    })
    expect(nextSheet(radiant, 'target').combat?.currentHp).toBeLessThan(150)
  })

  it('retains Ability target branches through suspension and rejects stale branch authority', () => {
    const radiant = complete({
      state: fixture({
        actorAbilities: ['Radiant Beam'], actorMoves: ['Razor Leaf'],
        targetAbilities: ['RKS System'],
      }),
      moveName: 'Razor Leaf',
      targetBranchId: AA085_RADIANT_BEAM_TARGET_BRANCH_ID,
      selection: { kind: 'area', areaTemplateId: 'line:any:4', direction: 'east' },
      choose: ({ reasonCode, options }) => reasonCode === AA085_RKS_SYSTEM_REASON
        ? options[0]?.id ?? null : null,
    })
    expect(radiant.seen.map(window => window.reasonCode)).toContain(AA085_RKS_SYSTEM_REASON)
    expect(nextSheet(radiant, 'target').combat?.currentHp).toBeLessThan(150)

    const state = fixture({
      actorAbilities: ['Spike Shot'], actorMoves: ['Pound'], targetAbilities: ['RKS System'],
    })
    const pending = planAuthoritativeMoveStateExecution({
      ...state,
      intent: {
        schemaVersion: 1 as const,
        placementId: 'actor', moveName: 'Pound',
        targetBranchId: AA091_SPIKE_SHOT_TARGET_BRANCH_ID,
        selection: { kind: 'single-target' as const, targetPlacementId: 'target' },
      },
      random: () => 0.95, now: () => 1_000,
      operationId: 'op_spike_shot_pending',
      pendingResolutionId: 'resolution:spike-shot-pending',
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    })
    expect(isAuthoritativePendingMoveStatePlan(pending)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(pending)) throw new Error('Expected Spike Shot to suspend.')
    const window = pending.suspension.pendingResolution.outstandingWindows[0]!
    const actor = state.pokemonSheets.get('actor')!
    const withoutSpikeShot = new Map(state.pokemonSheets)
    withoutSpikeShot.set('actor', { ...actor, abilities: [] })
    expect(() => resumeMoveSpec({
      pendingResolution: structuredClone(pending.suspension.pendingResolution),
      ...state,
      pokemonSheets: withoutSpikeShot,
      map: structuredClone(pending.nextMap),
      response: { requestId: window.windowId, optionId: window.options[0]?.id ?? null },
      now: 2_000, random: () => 0.95,
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    })).toThrow(/branch|unavailable|revalidate/i)

    const trinityState = fixture({
      actorAbilities: ['Trinity'], actorMoves: ['Tri Attack'], targetAbilities: ['RKS System'],
    })
    const trinityPending = planAuthoritativeMoveStateExecution({
      ...trinityState,
      intent: {
        schemaVersion: 1 as const,
        placementId: 'actor', moveName: 'Tri Attack',
        targetBranchId: AA096_TRINITY_TARGET_BRANCH_ID,
        selection: { kind: 'target-count' as const, targetPlacementIds: ['target'] },
      },
      random: () => 0.95, now: () => 1_000,
      operationId: 'op_trinity_pending',
      pendingResolutionId: 'resolution:trinity-pending',
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    })
    expect(isAuthoritativePendingMoveStatePlan(trinityPending)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(trinityPending)) throw new Error('Expected Trinity to suspend.')
    const trinityWindow = trinityPending.suspension.pendingResolution.outstandingWindows[0]!
    const trinityActor = trinityState.pokemonSheets.get('actor')!
    const withoutTrinity = new Map(trinityState.pokemonSheets)
    withoutTrinity.set('actor', { ...trinityActor, abilities: [] })
    expect(() => resumeMoveSpec({
      pendingResolution: structuredClone(trinityPending.suspension.pendingResolution),
      ...trinityState,
      pokemonSheets: withoutTrinity,
      map: structuredClone(trinityPending.nextMap),
      response: {
        requestId: trinityWindow.windowId,
        optionId: trinityWindow.options[0]?.id ?? null,
      },
      now: 2_000, random: () => 0.95,
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    })).toThrow(/branch|unavailable|revalidate/i)

    expect(() => planAuthoritativeMoveStateExecution({
      ...state,
      intent: {
        schemaVersion: 1 as const,
        placementId: 'actor', moveName: 'Pound',
        targetBranchId: AA090_SONIC_COURTSHIP_TARGET_BRANCH_ID,
        selection: { kind: 'single-target' as const, targetPlacementId: 'target' },
      },
      random: () => 0.95, now: () => 1_000,
      operationId: 'op_invalid_ability_branch',
      pendingResolutionId: 'resolution:invalid-ability-branch',
      abilityRuntimeRegistry: REMAINING_ABILITY_TEST_REGISTRY,
    })).toThrow(/branch|target/i)
  })

  it('resolves one accepted same-owner condition reaction when multiple exact sources apply', () => {
    const result = complete({
      state: fixture({
        actorAbilities: ['Stench'], actorMoves: ['Astonish'],
        targetAbilities: ['Steadfast'], targetTypes: ['Fire'],
      }),
      moveName: 'Astonish',
      choose: ({ reasonCode, options }) => (
        reasonCode === AA092_STEADFAST_REASON || reasonCode === 'astonish.confirm-target-awareness'
          ? options[0]?.id ?? null : null
      ),
    })
    expect(result.seen.filter(window => window.reasonCode === AA092_STEADFAST_REASON)).toHaveLength(1)
    const target = nextSheet(result, 'target')
    expect(target.stats?.spd?.stage).toBe(1)
    expect(target.combat?.conditions?.filter(condition => condition === 'Flinch')).toHaveLength(1)
  })

  it('attributes Tangling Hair Slowed duration to the exact reacting owner', () => {
    const result = complete({
      state: fixture({ targetAbilities: ['Tangling Hair'] }),
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === 'ability.tangling-hair.optional-slow'
        ? options[0]?.id ?? null : null,
    })
    expect(result.plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'condition',
      source: expect.objectContaining({ placementId: 'target' }),
      affected: expect.objectContaining({ placementIds: ['actor'] }),
      duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
      payload: expect.objectContaining({ conditionId: 'slowed' }),
    }))
  })

  it('projects a selected type into reviewed multi-hit damage templates', () => {
    const result = complete({
      state: fixture({
        actorAbilities: ['Refrigerate'], actorMoves: ['Fury Swipes'],
        targetAbilities: ['Winter’s Kiss'], targetCurrentHp: 100,
      }),
      moveName: 'Fury Swipes',
      choose: ({ reasonCode, options }) => reasonCode === 'ability.refrigerate.optional-ice-type'
        ? options[0]?.id ?? null : null,
    })
    expect(nextSheet(result, 'target').combat?.currentHp).toBeGreaterThan(100)
    expect(nextSheet(result, 'target').combat?.currentHp).toBeLessThanOrEqual(150)
  })

  it('reflects a reviewed multi-hit Melee attack through Sway without damaging its owner', () => {
    const run = (accept: boolean) => complete({
      state: fixture({
        actorAbilities: ['Defeatist'], actorMoves: ['Fury Swipes'], targetAbilities: ['Sway'],
      }),
      moveName: 'Fury Swipes', random: () => 0.95,
      choose: ({ reasonCode, options }) => accept && reasonCode === AA093_SWAY_REASON
        ? options[0]?.id ?? null : null,
    })
    const result = run(true)
    const passed = run(false)
    expect(result.seen.map(window => window.reasonCode)).toContain(AA093_SWAY_REASON)
    expect(result.plan.sheetWrites.some(write => write.slug === 'target')).toBe(false)
    expect(nextSheet(result, 'actor').combat?.currentHp).toBeLessThan(150)
    expect(result.plan.resolution.rollLedger.map(roll => ({
      rollId: roll.rollId,
      naturalResults: roll.naturalResults,
    }))).toEqual(passed.plan.resolution.rollLedger.map(roll => ({
      rollId: roll.rollId,
      naturalResults: roll.naturalResults,
    })))
  })

  it('does not expose Sway when every reviewed multi-hit strike misses', () => {
    const result = complete({
      state: fixture({ actorMoves: ['Fury Swipes'], targetAbilities: ['Sway'] }),
      moveName: 'Fury Swipes', random: () => 0,
      choose: ({ reasonCode, options }) => reasonCode === AA093_SWAY_REASON
        ? options[0]?.id ?? null : null,
    })
    expect(result.seen.map(window => window.reasonCode)).not.toContain(AA093_SWAY_REASON)
    expect(result.plan.sheetWrites.some(write => ['actor', 'target'].includes(write.slug))).toBe(false)
    expect(result.plan.nextMap.encounterState?.turnResources.target?.actions.standard.spent ?? 0).toBe(0)
    expect(result.plan.nextMap.encounterState?.abilityUsage?.entries.some(entry => (
      entry.ownerId === 'target' && entry.canonicalId === 'Sway'
    ))).toBe(false)
  })

  it('rejects provisional multi-hit Sway for Unseen Fist, ranged attacks, and non-enemies', () => {
    const cases = [
      fixture({ actorAbilities: ['Unseen Fist'], actorMoves: ['Fury Swipes'], targetAbilities: ['Sway'] }),
      fixture({ actorMoves: ['Bullet Seed'], targetAbilities: ['Sway'] }),
      fixture({ actorMoves: ['Fury Swipes'], targetAbilities: ['Sway'], targetSideId: 'heroes' }),
    ]
    const moves = ['Fury Swipes', 'Bullet Seed', 'Fury Swipes']
    for (const [index, state] of cases.entries()) {
      const result = complete({ state: state!, moveName: moves[index]!, choose: () => null })
      expect(result.seen.map(window => window.reasonCode)).not.toContain(AA093_SWAY_REASON)
      expect(result.plan.nextMap.encounterState?.turnResources.target?.actions.standard.spent ?? 0).toBe(0)
    }
  }, 30_000)

  it('replays accepted per-target defenses through pre-reduced multi-hit damage', () => {
    const run = (accept: boolean) => complete({
      state: fixture({ actorMoves: ['Fury Swipes'], targetAbilities: ['RKS System'] }),
      moveName: 'Fury Swipes',
      random: () => 0.95,
      choose: ({ reasonCode, options }) => accept && reasonCode === AA085_RKS_SYSTEM_REASON
        ? options[0]?.id ?? null : null,
    })
    const accepted = run(true)
    const declined = run(false)
    expect(accepted.seen.map(window => window.reasonCode)).toContain(AA085_RKS_SYSTEM_REASON)
    expect(nextSheet(accepted, 'target').combat?.currentHp ?? 0)
      .toBeGreaterThan(nextSheet(declined, 'target').combat?.currentHp ?? 0)
  })

  it('Trinity binds later Wobble behavior to its same-resolution damage-class choice', () => {
    const result = complete({
      state: fixture({
        actorAbilities: ['Trinity'], actorMoves: ['Tri Attack'],
        targetAbilities: ['Wobble'],
      }),
      moveName: 'Tri Attack', targetBranchId: AA096_TRINITY_TARGET_BRANCH_ID,
      selection: {
        kind: 'target-count', targetPlacementIds: ['target'],
      },
      choose: ({ reasonCode, options }) => reasonCode === AA096_TRINITY_REASON
        ? AA096_TRINITY_PHYSICAL_OPTION_ID
        : reasonCode === AA099_WOBBLE_REASON
          ? options[0]?.id ?? null
          : null,
    })
    expect(result.seen).toContainEqual(expect.objectContaining({
      reasonCode: AA099_WOBBLE_REASON,
      optionIds: ['ability.wobble.counter'],
    }))
    expect(nextSheet(result, 'actor').combat?.currentHp).toBeLessThan(150)
  })

  it('Trinity binds its distinct conditions to authoritative reviewed target order', () => {
    const result = complete({
      state: fixture({
        actorAbilities: ['Trinity'], actorMoves: ['Tri Attack'], targetAllyAbilities: [],
      }),
      moveName: 'Tri Attack', targetBranchId: AA096_TRINITY_TARGET_BRANCH_ID,
      selection: {
        kind: 'target-count', targetPlacementIds: ['target-ally', 'target'],
      },
      random: () => 0.95,
      choose: ({ reasonCode }) => reasonCode === AA096_TRINITY_REASON
        ? AA096_TRINITY_PHYSICAL_OPTION_ID : null,
    })
    expect(nextSheet(result, 'target-ally').combat?.conditions).toContain('Frozen')
    expect(nextSheet(result, 'target').combat?.conditions).toContain('Burned')
  })

  it('RKS System changes only each accepting owner in one multi-target resolution', () => {
    const result = complete({
      state: fixture({
        actorAbilities: ['Trinity'], actorMoves: ['Tri Attack'],
        targetAbilities: ['RKS System'], targetTypes: ['Ghost'],
        targetAllyAbilities: ['RKS System'], targetAllyTypes: ['Ghost'],
      }),
      moveName: 'Tri Attack', targetBranchId: AA096_TRINITY_TARGET_BRANCH_ID,
      selection: {
        kind: 'target-count', targetPlacementIds: ['target', 'target-ally'],
      },
      random: () => 0.5,
      choose: ({ reasonCode, ownerId, options }) => reasonCode === AA085_RKS_SYSTEM_REASON
        ? ownerId === 'target' ? options[0]?.id ?? null : null
        : reasonCode === AA096_TRINITY_REASON ? AA096_TRINITY_PHYSICAL_OPTION_ID : null,
    })
    expect(nextSheet(result, 'target').combat?.currentHp).toBeLessThan(150)
    expect(result.plan.sheetWrites.some(write => write.slug === 'target-ally')).toBe(false)
  })

  it('Thrust augments a handler-backed Attack-stat Move with its reviewed Push', () => {
    const result = complete({
      state: fixture({ actorAbilities: ['Thrust'], actorMoves: ['High Jump Kick'] }),
      moveName: 'High Jump Kick', random: () => 0.5, choose: () => null,
    })
    expect(result.plan.nextMap.placements.find(placement => placement.id === 'target')?.position)
      .toEqual({ x: 6, y: 0, z: 4 })
  })

  it('Defense Curl directly applies its complete reviewed state and action payment', () => {
    const result = complete({
      state: fixture({ actorMoves: ['Defense Curl'] }),
      moveName: 'Defense Curl', selection: { kind: 'self' }, choose: () => null,
    })
    expect(nextSheet(result, 'actor').stats?.def?.stage).toBe(1)
    expect(result.plan.nextMap.encounterState?.turnResources.actor?.actions.standard.spent).toBe(1)
    expect(result.plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability',
      affected: expect.objectContaining({ placementIds: ['actor'] }),
      tags: expect.arrayContaining(['defense-curl', 'curled-up']),
      duration: { kind: 'scene', remaining: null },
      transferPolicy: 'expire',
    }))
  })

  it('Wallmaster expands the authoritative Barrier cell selection by exactly two connected segments', () => {
    const desired = new Set([
      '4,0,5', '5,0,5', '6,0,5', '7,0,5', '8,0,5', '9,0,5',
    ])
    const result = complete({
      state: fixture({ actorAbilities: ['Wallmaster'], actorMoves: ['Barrier'] }),
      moveName: 'Barrier',
      selection: { kind: 'self' },
      choose: ({ reasonCode, options }) => {
        if (reasonCode === AA098_WALLMASTER_REASON) return 'ability.wallmaster.segments'
        const cells = options.filter(option => {
          const cell = option.selection?.cell
          return cell ? desired.has(`${cell.x},${cell.y},${cell.z}`) : false
        }).map(option => option.id)
        return cells.length > 0 ? cells : null
      },
    })
    const barrierCells = result.plan.nextMap.encounterState?.zones.flatMap(zone => (
      zone.kind === 'barrier' && zone.geometry.kind === 'cells' ? zone.geometry.cells : []
    )) ?? []
    expect(barrierCells).toHaveLength(6)
    expect(result.seen.map(window => window.reasonCode)).toContain(AA098_WALLMASTER_REASON)
  }, 30_000)

  it('Wishmaster binds its instant and delayed choices to the complete reviewed Wish', () => {
    const instant = complete({
      state: fixture({
        actorAbilities: ['Wishmaster'], actorMoves: ['Wish'], targetCurrentHp: 90,
      }),
      moveName: 'Wish',
      choose: ({ reasonCode }) => reasonCode === AA099_WISHMASTER_REASON
        ? 'ability.wishmaster.instant' : null,
    })
    expect(nextSheet(instant, 'target').combat?.currentHp).toBeGreaterThan(90)
    expect(instant.plan.nextMap.encounterState?.effects.some(effect => (
      effect.tags.includes('wish') && effect.tags.includes('delayed-heal')
    ))).toBe(false)

    const delayed = complete({
      state: fixture({
        actorAbilities: ['Wishmaster'], actorMoves: ['Wish'], targetCurrentHp: 90,
      }),
      moveName: 'Wish',
      choose: ({ reasonCode }) => reasonCode === AA099_WISHMASTER_REASON
        ? 'ability.wishmaster.stage.def' : null,
    })
    expect(delayed.plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      affected: expect.objectContaining({ placementIds: ['target'] }),
      tags: expect.arrayContaining(['wish', 'delayed-heal', 'aa099-wishmaster-stage-def']),
      duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 2 },
      transferPolicy: 'retain',
    }))
  }, 30_000)

  it('Queenly Majesty interrupts effective Priority with complete Stomp behavior and atomic Scene/Free payment', () => {
    const result = complete({
      state: fixture({ actorMoves: ['Quick Attack'], targetAbilities: ['Queenly Majesty'], targetMoves: ['Stomp'] }),
      moveName: 'Quick Attack',
      choose: ({ reasonCode, options }) => reasonCode === AA085_QUEENLY_MAJESTY_REASON
        ? options[0]?.id ?? null : null,
    })
    expect(result.seen.map(window => window.reasonCode)).toContain(AA085_QUEENLY_MAJESTY_REASON)
    expect(nextSheet(result, 'actor').combat?.currentHp).toBeLessThan(150)
    expect(result.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(JSON.stringify(result.plan.nextMap.moveUsage)).toContain('stomp')
    expect(result.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      ownerId: 'target', canonicalId: 'Queenly Majesty', spent: 1, limit: 2,
    }))
    expect(result.plan.resolution.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'operation', reasonCode: 'ability.queenly-majesty.stomp', outcome: 'applied' }),
    ]))
  }, 30_000)

  it('Steam Engine ignores only Smokescreen frequency while retaining its reviewed Swift/Scene payment', () => {
    const result = complete({
      state: fixture({ actorMoves: ['Water Gun'], targetAbilities: ['Steam Engine'] }),
      moveName: 'Water Gun',
      choose: ({ reasonCode, options }) => reasonCode === 'ability.steam-engine.optional-smokescreen'
        ? options[0]?.id ?? null : null,
    })
    expect(result.seen.map(window => window.reasonCode))
      .toContain('ability.steam-engine.optional-smokescreen')
    expect(JSON.stringify(result.plan.nextMap.moveUsage ?? {})).not.toContain('smokescreen')
    expect(result.plan.nextMap.encounterState?.turnResources.target?.actions.swift.spent).toBe(1)
    expect(result.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      ownerId: 'target', canonicalId: 'Steam Engine', spent: 1, limit: 2,
    }))
  }, 30_000)

  it('Spiteful Intervention pays Spite’s Free Action and ordinary Scene frequency', () => {
    const result = complete({
      state: fixture({
        actorMoves: ['Tackle'], targetAllyAbilities: ['Spiteful Intervention'],
      }),
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === 'ability.spiteful-intervention.optional-spite'
        ? options[0]?.id ?? null : null,
    })
    expect(result.seen.map(window => window.reasonCode))
      .toContain('ability.spiteful-intervention.optional-spite')
    expect(result.plan.nextMap.encounterState?.turnResources['target-ally']?.actions.free.spent).toBe(1)
    expect(result.plan.nextMap.encounterState?.turnResources['target-ally']?.actions.standard.spent).toBe(0)
    expect(JSON.stringify(result.plan.nextMap.moveUsage ?? {})).toContain('spite')
  }, 30_000)

  it('Quick Draw executes only its selected reviewed Move and applies the hit-bound attack penalty', () => {
    const result = complete({
      state: fixture({ actorMoves: ['Tackle'], targetAbilities: ['Quick Draw'], targetMoves: ['Tackle', 'Growl'] }),
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === AA085_QUICK_DRAW_REASON
        ? options.find(option => option.id.includes('.tackle.'))?.id ?? null
        : null,
    })
    expect(result.seen.map(window => window.reasonCode)).toContain(AA085_QUICK_DRAW_REASON)
    expect(nextSheet(result, 'actor').combat?.currentHp).toBeLessThan(150)
    expect(result.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(result.plan.nextMap.encounterState?.turnResources.target?.actions.standard.spent).toBe(1)
    const rootAccuracyRoll = result.plan.resolution.auditTrace.events.find(event => (
      event.kind === 'roll' && event.roll.parentEffectId === 'tackle.accuracy'
    ))
    expect(rootAccuracyRoll).toMatchObject({
      kind: 'roll',
      roll: { modifiers: expect.arrayContaining([
        expect.objectContaining({
          sourceId: 'ability.quick-draw.interrupt-hit', value: -2,
        }),
      ]) },
    })
    const childMoves = result.plan.resolution.auditTrace.events.filter(event => (
      event.kind === 'operation'
      && event.operationKind === 'nested-move'
      && event.reasonCode.startsWith('ability.quick-draw.move.')
      && event.outcome === 'applied'
    ))
    expect(childMoves).toHaveLength(1)
    expect(childMoves[0]).toMatchObject({ reasonCode: expect.stringContaining('.tackle.') })
    expect(result.plan.nextMap.placements.find(placement => placement.id === 'actor')?.position.x).toBe(2)
    expect(result.plan.nextMap.placements.find(placement => placement.id === 'target')?.position.x).toBe(7)
  }, 30_000)

  it('Quick Draw offers only reviewed Moves whose ordinary frequency remains available', () => {
    const state = fixture({
      actorMoves: ['Tackle'], targetAbilities: ['Quick Draw'], targetMoves: ['Stomp', 'Tackle'],
    })
    const spentStomp = planMoveUsageTransition({
      map: state.map,
      sheetMoveUsage: state.pokemonSheets.get('target')?.moveUsage,
      placementId: 'target',
      move: { moveName: 'Stomp', moveKey: 'stomp', frequency: 'EOT' },
      usedAt: 500,
    })
    state.map = { ...state.map, moveUsage: spentStomp.nextMapMoveUsage }
    if (spentStomp.sheetUsageChanged) {
      const target = state.pokemonSheets.get('target')!
      state.pokemonSheets.set('target', { ...target, moveUsage: spentStomp.nextSheetMoveUsage })
    }
    const result = complete({
      state, moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === AA085_QUICK_DRAW_REASON
        ? options.find(option => option.id.includes('.tackle.'))?.id ?? null
        : null,
    })
    const window = result.seen.find(candidate => candidate.reasonCode === AA085_QUICK_DRAW_REASON)
    expect(window?.optionIds.some(optionId => optionId.includes('.stomp.'))).toBe(false)
    expect(window?.optionIds.some(optionId => optionId.includes('.tackle.'))).toBe(true)
  }, 30_000)

  it('Quick Draw exposes only child Moves that can legally reach the exact triggering attacker', () => {
    const result = complete({
      state: fixture({
        actorMoves: ['Water Gun'],
        targetAbilities: ['Quick Draw'],
        targetMoves: ['Tackle', 'Water Gun'],
        targetPosition: { x: 7, y: 0, z: 4 },
      }),
      moveName: 'Water Gun',
      choose: ({ reasonCode, options }) => reasonCode === AA085_QUICK_DRAW_REASON
        ? options.find(option => option.id.includes('.water-gun.'))?.id ?? null
        : null,
    })
    const window = result.seen.find(candidate => candidate.reasonCode === AA085_QUICK_DRAW_REASON)
    expect(window?.optionIds.some(optionId => optionId.includes('.tackle.'))).toBe(false)
    expect(window?.optionIds.some(optionId => optionId.includes('.water-gun.'))).toBe(true)
  }, 30_000)

  it('Quick Draw accepts reviewed area geometry only when it affects the exact triggering attacker', () => {
    const adjacent = complete({
      state: fixture({
        actorMoves: ['Tackle'], targetAbilities: ['Quick Draw'], targetMoves: ['Bulldoze'],
      }),
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === AA085_QUICK_DRAW_REASON
        ? options[0]?.id ?? null
        : null,
    })
    expect(adjacent.seen.map(window => window.reasonCode)).toContain(AA085_QUICK_DRAW_REASON)
    expect(nextSheet(adjacent, 'actor').combat?.currentHp).toBeLessThan(150)

    const outOfArea = complete({
      state: fixture({
        actorMoves: ['Water Gun'],
        targetAbilities: ['Quick Draw'],
        targetMoves: ['Bulldoze'],
        targetPosition: { x: 7, y: 0, z: 4 },
      }),
      moveName: 'Water Gun',
      choose: () => null,
    })
    expect(outOfArea.seen.map(window => window.reasonCode)).not.toContain(AA085_QUICK_DRAW_REASON)
  }, 30_000)

  it('Queenly Majesty observes selected Prankster priority but not a passed optional choice', () => {
    const selected = complete({
      state: fixture({
        actorAbilities: ['Prankster'], actorMoves: ['Fake Tears'],
        targetAbilities: ['Queenly Majesty'], targetMoves: ['Stomp'],
      }),
      moveName: 'Fake Tears',
      choose: ({ reasonCode, options }) => (
        reasonCode === AA084_PRANKSTER_REASON || reasonCode === AA085_QUEENLY_MAJESTY_REASON
      ) ? options[0]?.id ?? null : null,
    })
    expect(selected.seen.map(window => window.reasonCode)).toEqual(expect.arrayContaining([
      AA084_PRANKSTER_REASON, AA085_QUEENLY_MAJESTY_REASON,
    ]))

    const passed = complete({
      state: fixture({
        actorAbilities: ['Prankster'], actorMoves: ['Fake Tears'],
        targetAbilities: ['Queenly Majesty'], targetMoves: ['Stomp'],
      }),
      moveName: 'Fake Tears', choose: () => null,
    })
    expect(passed.seen.map(window => window.reasonCode)).toContain(AA084_PRANKSTER_REASON)
    expect(passed.seen.map(window => window.reasonCode)).not.toContain(AA085_QUEENLY_MAJESTY_REASON)
  }, 30_000)

  it('RKS System changes only the exact selected hit to Normal defensive typing and pays once', () => {
    const selected = complete({
      state: fixture({ actorMoves: ['Thunder Shock'], targetAbilities: ['RKS System'] }),
      moveName: 'Thunder Shock',
      choose: ({ reasonCode, options }) => reasonCode === AA085_RKS_SYSTEM_REASON
        ? options[0]?.id ?? null : null,
    })
    const passed = complete({
      state: fixture({ actorMoves: ['Thunder Shock'], targetAbilities: ['RKS System'] }),
      moveName: 'Thunder Shock', choose: () => null,
    })
    const selectedLoss = 150 - (nextSheet(selected, 'target').combat?.currentHp ?? 150)
    const ordinaryLoss = 150 - (nextSheet(passed, 'target').combat?.currentHp ?? 150)
    expect(selectedLoss).toBeGreaterThan(0)
    expect(selectedLoss).toBeLessThan(ordinaryLoss)
    expect(selected.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(selected.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      ownerId: 'target', canonicalId: 'RKS System', spent: 1, limit: 1,
    }))
    expect(passed.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(0)
  }, 30_000)

  it('enforces Wonder Guard only while the owner has a weakness and permits Super-Effective attacks', () => {
    const neutral = complete({
      state: fixture({
        actorMoves: ['Tackle'], targetAbilities: ['Wonder Guard'], targetTypes: ['Normal'],
      }),
      moveName: 'Tackle', choose: () => null,
    })
    expect(neutral.plan.sheetWrites.some(write => write.slug === 'target')).toBe(false)

    const superEffective = complete({
      state: fixture({
        actorMoves: ['Brick Break'], targetAbilities: ['Wonder Guard'], targetTypes: ['Normal'],
      }),
      moveName: 'Brick Break', choose: () => null,
    })
    expect(nextSheet(superEffective, 'target').combat?.currentHp).toBeLessThan(150)

    const weaknessless = complete({
      state: fixture({
        actorMoves: ['Tackle'], targetAbilities: ['Wonder Guard'], targetTypes: [],
      }),
      moveName: 'Tackle', choose: () => null,
    })
    expect(nextSheet(weaknessless, 'target').combat?.currentHp).toBeLessThan(150)
  }, 30_000)

  it('Weeble uses the reacting owner, an AC 4 roll, and one third of actual triggering loss', () => {
    const result = complete({
      state: fixture({ actorMoves: ['Tackle'], targetAbilities: ['Weeble'] }),
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === AA098_WEEBLE_REASON
        ? options.find(option => option.id === 'ability.weeble.target.actor')?.id ?? null
        : null,
    })
    expect(result.seen.map(window => window.reasonCode)).toContain(AA098_WEEBLE_REASON)
    expect(nextSheet(result, 'target').combat?.currentHp).toBe(117)
    expect(nextSheet(result, 'actor').combat?.currentHp).toBe(139)
    expect(result.plan.nextMap.encounterState?.turnResources.target?.actions.standard.spent).toBe(1)
    const accuracy = result.plan.resolution.auditTrace.events.find(event => (
      event.kind === 'roll' && event.reasonCode === 'ability.weeble.accuracy.actor'
    ))
    expect(accuracy).toMatchObject({ kind: 'roll', roll: { naturalResult: 20 } })
  }, 30_000)

  it('Wobble resists the exact triggering hit and retaliates by class for twice actual loss', () => {
    const selected = complete({
      state: fixture({ actorMoves: ['Tackle'], targetAbilities: ['Wobble'] }),
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === AA099_WOBBLE_REASON
        ? options.find(option => option.id === 'ability.wobble.counter')?.id ?? null
        : null,
    })
    const passed = complete({
      state: fixture({ actorMoves: ['Tackle'], targetAbilities: ['Wobble'] }),
      moveName: 'Tackle', choose: () => null,
    })
    const selectedLoss = 150 - (nextSheet(selected, 'target').combat?.currentHp ?? 150)
    const ordinaryLoss = 150 - (nextSheet(passed, 'target').combat?.currentHp ?? 150)
    expect(selectedLoss).toBeGreaterThan(0)
    expect(selectedLoss).toBeLessThan(ordinaryLoss)
    expect(nextSheet(selected, 'actor').combat?.currentHp).toBe(150 - selectedLoss * 2)
    expect(selected.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(selected.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      ownerId: 'target', canonicalId: 'Wobble', spent: 1, limit: 1,
    }))
  }, 30_000)

  it('Sand Spit invokes complete Sand Attack behavior only for its exact enemy damage trigger', () => {
    const result = complete({
      state: fixture({ actorMoves: ['Tackle'], targetAbilities: ['Sand Spit'] }),
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === 'ability.sand-spit.optional-sand-attack'
        ? options[0]?.id ?? null : null,
    })
    expect(result.seen.map(window => window.reasonCode))
      .toContain('ability.sand-spit.optional-sand-attack')
    expect(result.plan.nextMap.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'condition',
        affected: expect.objectContaining({ placementIds: ['actor'] }),
        payload: expect.objectContaining({ conditionId: 'blindness' }),
      }),
    ]))
    expect(result.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(result.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      ownerId: 'target', canonicalId: 'Sand Spit', spent: 1,
    }))
    expect(result.plan.resolution.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'child-move', canonicalId: 'Sand Attack', outcome: 'completed' }),
    ]))
  }, 30_000)

  it('Shell Cannon requires exact straight-line charge evidence for its reviewed charge Moves', () => {
    const state = fixture({
      actorSpecies: 'Blastoise', actorAbilities: ['Shell Cannon'], actorMoves: ['Tackle'],
    })
    state.map = {
      ...state.map,
      encounterState: recordAa085to100MovementEvidence({
        encounterState: state.map.encounterState!,
        placementId: 'actor', operationId: 'movement:shell-cannon', mode: 'voluntary',
        path: [2, 3, 4].map(x => ({ x, y: 0, z: 4 })),
      }),
    }
    const result = complete({
      state,
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === AA089_SHELL_CANNON_REASON
        ? options[0]?.id ?? null : null,
    })
    expect(result.seen.map(window => window.reasonCode)).toContain(AA089_SHELL_CANNON_REASON)
    expect(result.plan.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'operation', reasonCode: AA089_SHELL_CANNON_REASON, outcome: 'applied',
    }))

    const bent = fixture({
      actorSpecies: 'Blastoise', actorAbilities: ['Shell Cannon'], actorMoves: ['Tackle'],
    })
    bent.map = {
      ...bent.map,
      encounterState: recordAa085to100MovementEvidence({
        encounterState: bent.map.encounterState!,
        placementId: 'actor', operationId: 'movement:shell-cannon-bent', mode: 'voluntary',
        path: [{ x: 2, y: 0, z: 3 }, { x: 3, y: 0, z: 3 }, { x: 4, y: 0, z: 4 }],
      }),
    }
    expect(complete({
      state: bent, moveName: 'Tackle', choose: () => null,
    }).seen.map(window => window.reasonCode)).not.toContain(AA089_SHELL_CANNON_REASON)
  }, 30_000)

  it('Vicious grants one real additional Standard budget or the persistent critical branch', () => {
    const result = complete({
      state: fixture({ actorAbilities: ['Vicious'], actorMoves: ['Hone Claws'] }),
      moveName: 'Hone Claws', selection: { kind: 'self' },
      choose: ({ reasonCode }) => reasonCode === AA097_VICIOUS_REASON
        ? 'ability.vicious.extra-standard' : null,
    })
    expect(result.plan.nextMap.encounterState?.turnResources.actor?.actions.standard)
      .toMatchObject({ spent: 1, budget: 2 })
    expect(result.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      ownerId: 'actor', canonicalId: 'Vicious', spent: 1, limit: 1,
    }))
    expect(result.plan.nextMap.encounterState?.effects.some(effect => (
      effect.tags.includes('aa097-vicious-critical')
      || effect.tags.includes('aa097-vicious-extra-standard')
    ))).toBe(false)
  }, 30_000)

  it('Shields Down enters Core only for the exact owner reduced to half HP by this hit', () => {
    const result = complete({
      state: fixture({
        actorMoves: ['Tackle'], targetAbilities: ['Shields Down'],
        targetSpecies: 'Minior Meteor', targetCurrentHp: 75,
      }),
      moveName: 'Tackle', choose: () => null,
    })
    expect(result.plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      tags: expect.arrayContaining(['aa089-shields-down-core']),
      affected: expect.objectContaining({ placementIds: ['target'] }),
      payload: expect.objectContaining({ domain: 'form', action: 'replace', value: 'minior-core' }),
    }))
    expect(result.plan.nextMap.encounterState?.effects.some(effect => (
      effect.tags.includes('aa089-shields-down-core')
      && effect.affected.placementIds.includes('actor')
    ))).toBe(false)
  }, 30_000)

  it('Sway reflects only an enemy damaging Melee hit and may pass its reviewed displacement', () => {
    const state = fixture({ actorMoves: ['Bite'], targetAbilities: ['Sway'] })
    const choices = enumerateAuthoritativeMovementChoices({
      map: state.map,
      sheets: { pokemon: state.pokemonSheets, trainer: state.trainerSheets },
      placementId: 'actor', setId: 'sway:test', maximumDistance: 2, kind: 'destination',
      candidateDestinations: [3, 4, 5].flatMap(z => [4, 5, 6].map(x => ({ x, y: 0, z }))),
    })
    expect(choices.choices.map(choice => choice.option.selection)).toContainEqual({
      kind: 'movement-destination', setId: 'sway:test',
      destination: { x: 6, y: 0, z: 3 },
    })
    const result = complete({
      state,
      moveName: 'Bite',
      choose: ({ reasonCode, options }) => reasonCode === AA093_SWAY_REASON
        ? options[0]?.id ?? null
        : reasonCode.startsWith('ability.sway.push-attacker:')
          ? options.find(option => (
              option.selection?.kind === 'movement-destination'
              && option.selection.destination?.x === 6
              && option.selection.destination.y === 0
              && option.selection.destination.z === 3
            ))?.id ?? null
          : null,
    })
    expect(result.seen.map(window => window.reasonCode)).toContain(AA093_SWAY_REASON)
    const swayMovementEvent = result.plan.resolution.auditTrace.events.find(event => (
      event.kind === 'operation' && event.reasonCode.startsWith('ability.sway.push-attacker:')
    ))
    expect(swayMovementEvent).toMatchObject({ outcome: 'applied' })
    expect(result.seen.find(window => window.reasonCode.startsWith('ability.sway.push-attacker:'))?.destinations)
      .toContainEqual({ x: 6, y: 0, z: 3 })
    expect(result.plan.sheetWrites.some(write => write.slug === 'target')).toBe(false)
    expect(nextSheet(result, 'actor').combat?.currentHp).toBeLessThan(150)
    expect(result.plan.nextMap.placements.find(placement => placement.id === 'actor')?.position)
      .toEqual({ x: 6, y: 0, z: 3 })
    expect(result.plan.nextMap.encounterState?.turnResources.target?.actions.standard.spent).toBe(1)
  }, 30_000)

  it('Receiver binds both faint clauses to the exact owner, ally, and reviewed Ability', () => {
    const copy = complete({
      state: fixture({
        actorMoves: ['Tackle'], targetCurrentHp: 1,
        targetAbilities: ['Run Away'], targetSpecies: 'Eevee',
        targetAllyAbilities: ['Receiver'], targetAllySpecies: 'Eevee',
      }),
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === 'ability.receiver.optional-copy'
        ? options.find(option => option.id.includes('.run-away.'))?.id ?? null
        : null,
    })
    expect(copy.plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'creature-rule-overlay',
      affected: expect.objectContaining({ placementIds: ['target-ally'] }),
      payload: expect.objectContaining({ domain: 'ability', action: 'add', values: ['Run Away'] }),
    }))
    expect(copy.plan.nextMap.encounterState?.turnResources['target-ally']?.actions.free.spent).toBe(1)
    expect(copy.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      ownerId: 'target-ally', canonicalId: 'Receiver', clauseId: 'copy-on-ally-faint', spent: 1,
    }))

    const grant = complete({
      state: fixture({
        actorMoves: ['Tackle'], targetCurrentHp: 1,
        targetAbilities: ['Receiver', 'Run Away'], targetSpecies: 'Eevee',
        targetAllyAbilities: ['Punk Rock'], targetAllySpecies: 'Eevee',
      }),
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === 'ability.receiver.optional-grant'
        ? options.find(option => option.id.includes('target-ally') && option.id.includes('.run-away.'))?.id ?? null
        : null,
    })
    expect(grant.plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'creature-rule-overlay',
      affected: expect.objectContaining({ placementIds: ['target-ally'] }),
      payload: expect.objectContaining({ domain: 'ability', action: 'add', values: ['Run Away'] }),
    }))
    expect(grant.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(grant.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      ownerId: 'target', canonicalId: 'Receiver', clauseId: 'grant-on-faint', spent: 1,
    }))
  }, 30_000)

  it('Weaponize protects only the exact Wielder while explicitly Commanded and pays a Free Action', () => {
    const activeState = weaponizeFixture(true)
    expect(activelyCommandingTrainerPlacementId({
      map: activeState.map, pokemonPlacementId: 'living-weapon',
    })).toBe('wielder')
    const active = complete({
      state: activeState,
      moveName: 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: 'wielder' },
      choose: ({ reasonCode, options }) => reasonCode === AA098_WEAPONIZE_REASON
        ? options[0]?.id ?? null
        : null,
    })
    expect(active.seen.map(window => window.reasonCode)).toContain(AA098_WEAPONIZE_REASON)
    expect(nextSheet(active, 'living-weapon').combat?.currentHp).toBeLessThan(150)
    expect(active.plan.sheetWrites.some(write => write.slug === 'wielder')).toBe(false)
    expect(active.plan.nextMap.encounterState?.turnResources['living-weapon']?.actions.free.spent).toBe(1)

    const merelyWielded = complete({
      state: weaponizeFixture(false),
      moveName: 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: 'wielder' },
      choose: () => null,
    })
    expect(merelyWielded.seen.map(window => window.reasonCode)).not.toContain(AA098_WEAPONIZE_REASON)
    expect(merelyWielded.plan.sheetWrites.some(write => write.slug === 'living-weapon')).toBe(false)
    expect(merelyWielded.plan.sheetWrites.some(write => write.slug === 'wielder')).toBe(true)
  }, 30_000)

  it('Wandering Spirit rolls its random exchanged Ability only for an opposing Pokémon after acceptance', () => {
    const alliedState = fixture({
      actorAbilities: ['Punk Rock'], actorMoves: ['Tackle'],
      targetAbilities: ['Wandering Spirit'],
    })
    alliedState.map = {
      ...alliedState.map,
      placements: alliedState.map.placements.map(placement => placement.id === 'target'
        ? { ...placement, sideId: 'heroes' }
        : placement),
    }
    const allied = complete({ state: alliedState, moveName: 'Tackle', choose: () => null })
    expect(allied.seen.map(window => window.reasonCode)).not.toContain(AA098_WANDERING_SPIRIT_REASON)

    const declined = complete({
      state: fixture({
        actorAbilities: ['Punk Rock', 'Pure Power'], actorMoves: ['Tackle'],
        targetAbilities: ['Wandering Spirit'],
      }),
      moveName: 'Tackle', choose: () => null,
    })
    expect(declined.seen.map(window => window.reasonCode)).toContain(AA098_WANDERING_SPIRIT_REASON)
    expect(declined.plan.resolution.auditTrace.events.some(event => (
      event.kind === 'roll' && event.roll.rollId.startsWith('ability.wandering-spirit.random.')
    ))).toBe(false)

    const accepted = complete({
      state: fixture({
        actorAbilities: ['Punk Rock', 'Pure Power'], actorMoves: ['Tackle'],
        targetAbilities: ['Wandering Spirit'],
      }),
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === AA098_WANDERING_SPIRIT_REASON
        ? options[0]?.id ?? null : null,
    })
    expect(accepted.plan.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'roll',
      roll: expect.objectContaining({ rollId: expect.stringMatching(/^ability\.wandering-spirit\.random\./) }),
    }))
    expect(accepted.plan.nextMap.encounterState?.effects.filter(effect => (
      effect.tags.includes('aa098-wandering-spirit-swap')
    ))).toHaveLength(4)
  }, 30_000)

  it('Unseen Fist blocks Melee Reaction abilities that would invoke a reaction Move or swap', () => {
    for (const targetAbilities of [
      ['Wandering Spirit'],
      ['Steam Engine'],
    ] as const) {
      const result = complete({
        state: fixture({
          actorAbilities: ['Unseen Fist', 'Punk Rock'],
          actorMoves: [targetAbilities[0] === 'Steam Engine' ? 'Fire Punch' : 'Tackle'],
          targetAbilities,
        }),
        moveName: targetAbilities[0] === 'Steam Engine' ? 'Fire Punch' : 'Tackle',
        choose: () => null,
      })
      expect(result.seen.map(window => window.reasonCode)).not.toContain(
        targetAbilities[0] === 'Steam Engine'
          ? 'ability.steam-engine.optional-smokescreen'
          : AA098_WANDERING_SPIRIT_REASON,
      )
    }
  })

  it('Steadfast and Synchronize require the exact applied source operation', () => {
    const steadfast = complete({
      state: fixture({
        actorAbilities: ['Stench'], actorMoves: ['Tackle'], targetAbilities: ['Steadfast'],
      }),
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === AA092_STEADFAST_REASON
        ? options[0]?.id ?? null : null,
    })
    expect(steadfast.seen.map(window => window.reasonCode)).toContain(AA092_STEADFAST_REASON)
    expect(nextSheet(steadfast, 'target').stats?.spd?.stage).toBe(1)

    const synchronized = complete({
      state: fixture({ actorMoves: ['Ember'], targetAbilities: ['Synchronize'] }),
      moveName: 'Ember',
      choose: ({ reasonCode, options }) => reasonCode === AA094_SYNCHRONIZE_REASON
        ? options[0]?.id ?? null : null,
    })
    expect(synchronized.seen.map(window => window.reasonCode)).toContain(AA094_SYNCHRONIZE_REASON)
    expect(nextSheet(synchronized, 'target').combat?.conditions).toContain('Burned')
    expect(nextSheet(synchronized, 'actor').combat?.conditions).toContain('Burned')

    const prevented = complete({
      state: fixture({ actorMoves: ['Ember'], targetAbilities: ['Synchronize', 'Water Veil'] }),
      moveName: 'Ember', choose: () => null,
    })
    expect(prevented.seen.map(window => window.reasonCode)).not.toContain(AA094_SYNCHRONIZE_REASON)
  }, 30_000)

  it('Rattled resolves its optional Disengage in the same response chain', () => {
    const result = complete({
      state: fixture({ actorMoves: ['Bite'], targetAbilities: ['Rattled'] }),
      moveName: 'Bite',
      choose: ({ reasonCode, options }) => (
        reasonCode === AA086_RATTLED_REASON || reasonCode === 'ability.rattled.disengage'
          ? options[0]?.id ?? null
          : null
      ),
    })
    expect(result.seen.map(window => window.reasonCode)).toEqual(expect.arrayContaining([
      AA086_RATTLED_REASON,
      'ability.rattled.disengage',
    ]))
    expect(nextSheet(result, 'target').stats?.spd?.stage).toBe(1)
    expect(result.plan.nextMap.placements.find(placement => placement.id === 'target')?.position)
      .not.toEqual({ x: 5, y: 0, z: 4 })
    expect(result.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(result.plan.nextMap.encounterState?.turnResources.target?.actions.shift.spent).toBe(0)
    expect(result.plan.nextMap.encounterState?.effects.some(effect => (
      effect.tags.includes('aa086-rattled-disengage')
    ))).toBe(false)
  }, 30_000)

  it('Telepathy pays a Shift and exposes only full-Shift destinations outside the exact attack area', () => {
    const origin = { x: 4, y: 0, z: 5 }
    const result = complete({
      state: fixture({
        actorMoves: ['Bulldoze'],
        actorAllyAbilities: ['Telepathy'],
        actorAllyPosition: origin,
      }),
      moveName: 'Bulldoze',
      selection: { kind: 'area', areaTemplateId: 'burst:any:1' },
      choose: ({ reasonCode, options }) => {
        if (reasonCode === 'ability.telepathy.optional-disengage') return options[0]?.id ?? null
        if (reasonCode === 'ability.telepathy.disengage-movement') {
          return options.find(option => option.selection?.kind === 'movement-destination'
            && Math.max(
              Math.abs((option.selection.destination?.x ?? 4) - origin.x),
              Math.abs((option.selection.destination?.z ?? 5) - origin.z),
            ) > 1)?.id ?? options[0]?.id ?? null
        }
        return null
      },
    })
    const movementWindow = result.seen.find(window => (
      window.reasonCode === 'ability.telepathy.disengage-movement'
    ))
    expect(movementWindow?.destinations.length).toBeGreaterThan(0)
    expect(movementWindow?.destinations.every(destination => (
      Math.max(Math.abs(destination.x - 4), Math.abs(destination.z - 4)) > 1
    ))).toBe(true)
    expect(movementWindow?.destinations.some(destination => (
      Math.max(Math.abs(destination.x - origin.x), Math.abs(destination.z - origin.z)) > 1
    ))).toBe(true)
    const moved = result.plan.nextMap.placements.find(placement => placement.id === 'actor-ally')!
    expect(Math.max(Math.abs(moved.position.x - 4), Math.abs(moved.position.z - 4))).toBeGreaterThan(1)
    expect(result.plan.nextMap.encounterState?.turnResources['actor-ally']?.actions.shift.spent).toBe(1)
    expect(result.plan.nextMap.encounterState?.turnResources['actor-ally']?.actions.free.spent).toBe(0)
  }, 30_000)

  it('Wobble chooses Mirror Coat for Special damage and preserves Psychic immunity', () => {
    const state = fixture({ actorMoves: ['Ember'], targetAbilities: ['Wobble'] })
    const actor = state.pokemonSheets.get('actor')!
    state.pokemonSheets.set('actor', { ...actor, types: ['Dark'] })
    const result = complete({
      state, moveName: 'Ember',
      choose: ({ reasonCode, options }) => reasonCode === AA099_WOBBLE_REASON
        ? options.find(option => option.id === 'ability.wobble.mirror-coat')?.id ?? null
        : null,
    })
    expect(result.seen.find(window => window.reasonCode === AA099_WOBBLE_REASON)?.optionIds)
      .toEqual(['ability.wobble.mirror-coat'])
    expect(result.plan.sheetWrites.some(write => write.slug === 'actor')).toBe(false)
    expect(result.plan.resolution.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'operation', reasonCode: 'ability.wobble.mirror-coat', outcome: 'no-op',
      }),
    ]))
  }, 30_000)

  it('does not offer Counter through Wobble when the triggering attacker is outside Melee range', () => {
    const result = complete({
      state: fixture({
        actorMoves: ['Rock Throw'], targetAbilities: ['Wobble'],
        targetPosition: { x: 7, y: 0, z: 4 },
      }),
      moveName: 'Rock Throw',
      choose: () => null,
    })
    expect(result.seen.map(window => window.reasonCode)).not.toContain(AA099_WOBBLE_REASON)
  }, 30_000)

  it('does not offer Weeble or Wobble after the exact reacting owner faints', () => {
    for (const canonicalId of ['Weeble', 'Wobble']) {
      const state = fixture({ actorMoves: ['Tackle'], targetAbilities: [canonicalId] })
      const target = state.pokemonSheets.get('target')!
      state.pokemonSheets.set('target', {
        ...target, combat: { ...target.combat!, currentHp: 1 },
      })
      const result = complete({ state, moveName: 'Tackle', choose: () => null })
      expect(result.seen.map(window => window.reasonCode)).not.toContain(
        canonicalId === 'Weeble' ? AA098_WEEBLE_REASON : AA099_WOBBLE_REASON,
      )
    }
  }, 30_000)

  it('suppresses Soul Heart when its exact owner also Faints in the triggering resolution', () => {
    const result = complete({
      state: fixture({
        actorMoves: ['Bulldoze'],
        targetAbilities: ['Soul Heart'],
        targetCurrentHp: 1,
        targetAllyAbilities: [],
        targetAllyCurrentHp: 1,
      }),
      moveName: 'Bulldoze',
      selection: { kind: 'area', areaTemplateId: 'burst:any:1' },
      choose: () => null,
    })
    expect(result.seen.map(window => window.reasonCode)).not.toContain(AA090_SOUL_HEART_REASON)
    expect(nextSheet(result, 'target').stats?.satk?.stage ?? 0).toBe(0)
    expect(result.plan.nextMap.temporaryHitPoints?.byPlacementId.target ?? 0).toBe(0)
  }, 30_000)

  it('still permits Receiver’s explicit own-Faint grant while preserving the copied snapshot', () => {
    const result = complete({
      state: fixture({
        actorMoves: ['Tackle'],
        targetAbilities: ['Receiver', 'Teamwork'],
        targetSpecies: 'Passimian',
        targetCurrentHp: 1,
        targetAllyAbilities: [],
      }),
      moveName: 'Tackle',
      choose: ({ reasonCode, options }) => reasonCode === 'ability.receiver.optional-grant'
        ? options.find(option => option.id.includes('.target-ally.ability.teamwork.'))?.id ?? null
        : null,
    })
    expect(result.seen.map(window => window.reasonCode)).toContain('ability.receiver.optional-grant')
    expect(result.plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'creature-rule-overlay',
      affected: { placementIds: ['target-ally'], sideIds: [], cells: [] },
      payload: expect.objectContaining({
        domain: 'ability',
        action: 'add',
        values: ['Teamwork'],
        abilitySnapshots: [expect.objectContaining({
          canonicalId: 'Teamwork',
          sourcePlacementId: 'target',
        })],
      }),
    }))
  }, 30_000)

  it('Sturdy rejects Execute Moves and caps one damaging source before Temporary HP and real HP loss', () => {
    const execute = complete({
      state: fixture({ actorMoves: ['Fissure'], targetAbilities: ['Sturdy'] }),
      moveName: 'Fissure', choose: () => null, random: () => 0.01,
    })
    expect(execute.plan.resolution.auditTrace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'operation', operationKind: 'direct-hp', outcome: 'prevented',
      }),
    ]))

    const state = fixture({ actorMoves: ['Tackle'], targetAbilities: ['Sturdy'] })
    const actor = state.pokemonSheets.get('actor')!
    state.pokemonSheets.set('actor', {
      ...actor,
      stats: { ...actor.stats, atk: { added: 500 } },
    })
    state.map = {
      ...state.map,
      temporaryHitPoints: {
        scene: { name: 'Scene', startedAt: 1 },
        byPlacementId: { target: 50 },
      },
    }
    const capped = complete({ state, moveName: 'Tackle', choose: () => null })
    const damage = capped.plan.resolution.auditTrace.events.find(event => (
      event.kind === 'operation'
      && event.operationKind === 'damage'
      && event.operationId === 'tackle.damage'
    ))
    expect(damage).toMatchObject({
      kind: 'operation', outcome: 'applied',
      result: {
        recipients: [expect.objectContaining({
          details: expect.objectContaining({
            requestedHpLoss: 104,
            absorbedByTemporaryHp: 50,
            realHpLost: 54,
          }),
        })],
      },
    })
    expect(nextSheet(capped, 'target').combat?.currentHp).toBe(96)
  }, 30_000)
})
