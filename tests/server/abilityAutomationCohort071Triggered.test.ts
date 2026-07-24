import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { AA071_FOX_FIRE_WISP_CAPABILITY } from '#shared/abilityAutomation/aa071'
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

const slugify = (value: string): string => value.toLowerCase().replaceAll(' ', '-').replaceAll('’', '')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${slugify(canonicalId)}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const sheet = (input: { slug: string; move?: string; ability?: string }): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: ['Normal'],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [] },
})

const foxWisp = (index: number) => parseEncounterEffect({
  id: `ability.fox-fire.wisp.test.${index}`,
  kind: 'capability',
  tags: ['ability', 'aa071', 'fox-fire', 'fire-wisp'],
  source: { operationId: 'operation:fox-fire', moveId: 'ability.fox-fire', placementId: 'target' },
  affected: { placementIds: ['target'], sideIds: [], cells: [] },
  createdRound: 1,
  createdTurn: 1,
  duration: { kind: 'scene', remaining: null },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  payload: { capabilityId: AA071_FOX_FIRE_WISP_CAPABILITY, action: 'grant', value: 1 },
  dispel: { policy: 'matching-tags', tags: ['fox-fire'] },
  transferPolicy: 'expire',
  suppression: { sources: [] },
}, `foxWisp[${index}]`)

const battleMap = (input: {
  slug: string
  providerAbility?: string
  targetAbility?: string
  foxWisps?: number
  temporaryHp?: number
}): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'foes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'heroes', position: { x: 2, y: 0, z: 1 } },
    { id: 'provider', sheetKind: 'pokemon', sheetSlug: 'provider', sideId: 'heroes', position: { x: 3, y: 0, z: 1 } },
  ]
  const activeScene = { name: 'Scene', startedAt: 100 }
  return {
    schemaVersion: 2,
    slug: input.slug,
    name: input.slug,
    revision: 5,
    dimensions: { x: 10, y: 4, z: 10 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [], hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements,
    encounterState: {
      ...encounter,
      effects: Array.from({ length: input.foxWisps ?? 0 }, (_, index) => foxWisp(index + 1)),
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
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene,
    ...(input.temporaryHp
      ? { temporaryHitPoints: { scene: activeScene, byPlacementId: { target: input.temporaryHp } } }
      : {}),
  }
}

const declare = (input: {
  slug: string
  move?: string
  providerAbility?: string
  targetAbility?: string
  foxWisps?: number
  temporaryHp?: number
  random?: () => number
}) => {
  const move = input.move ?? 'Tackle'
  const map = battleMap(input)
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move })],
    ['target', sheet({ slug: 'target', ability: input.targetAbility })],
    ['provider', sheet({ slug: 'provider', ability: input.providerAbility })],
  ])
  const result = planAuthoritativeMoveStateExecution({
    map,
    pokemonSheets,
    trainerSheets: new Map(),
    intent: {
      schemaVersion: 1,
      placementId: 'actor',
      moveName: move,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: input.random ?? (() => 0.5),
    now: () => 1_000,
    operationId: `op_${input.slug}`,
    pendingResolutionId: `resolution:${input.slug}`,
  })
  return { result, pokemonSheets }
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
  response: { requestId: input.pending.outstandingWindows[0]!.windowId, optionId: input.optionId },
  now: 2_000,
  random: () => 0.5,
})

const finish = (input: {
  declaration: ReturnType<typeof declare>
  optionId: string | null
  chosenBy: string
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
    responseOpId: `op_response_${input.declaration.result.nextMap.slug}`,
    responseWindowId: pending.outstandingWindows[0]!.windowId,
    responseOptionId: input.optionId,
    chosenBy: { kind: 'placement', id: input.chosenBy },
    map: input.declaration.result.nextMap,
    pokemonSheets: input.declaration.pokemonSheets,
    trainerSheets: new Map(),
    execution,
    plannedAt: 2_000,
  })
  return { pending, execution, plan }
}

const nextSheet = (plan: ReturnType<typeof finish>['plan'], slug: string): CharacterSheet => (
  (plan.sheetWrites.find(write => write.slug === slug)?.nextSheet
    ?? plan.sheetWrites.find(write => write.slug === slug)?.previousSheet) as CharacterSheet
)

describe('AA-071 Move-triggered abilities', () => {
  it('aa071.friend-guard.reviewed lets an adjacent ally resist the triggering damage and pays Free/Scene', () => {
    const declaration = declare({ slug: 'aa071-friend-guard', providerAbility: 'Friend Guard' })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    expect(declaration.result.suspension.pendingResolution.outstandingWindows[0]?.options).toEqual([
      { id: 'ability.friend-guard.use', labelKey: 'ability.friend-guard.resist-damage' },
    ])
    const { execution, plan } = finish({
      declaration, optionId: 'ability.friend-guard.use', chosenBy: 'provider',
    })
    expect(JSON.stringify(execution.auditTrace)).toContain('Friend Guard')
    expect(JSON.stringify(execution.auditTrace)).toContain('"finalMultiplier":0.5')
    expect(plan.nextMap.encounterState?.turnResources.provider?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Friend Guard', ownerId: 'provider', spent: 1,
    }))
    expect(nextSheet(plan, 'target').combat?.currentHp).toBeLessThan(150)
  }, 30_000)

  it('aa071.friend-guard.reviewed applies only to the first successful strike of a multi-hit sequence', () => {
    const declaration = declare({
      slug: 'aa071-friend-guard-multi-hit', move: 'Fury Swipes', providerAbility: 'Friend Guard',
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    const { execution } = finish({
      declaration, optionId: 'ability.friend-guard.use', chosenBy: 'provider',
    })
    const trace = JSON.stringify(execution.auditTrace)
    expect(trace).toContain('"finalMultiplier":0.5')
    expect(trace).toContain('"finalMultiplier":1')
  }, 30_000)

  it('aa071.friend-guard.reviewed does not open its damage window when the triggering attack misses', () => {
    const declaration = declare({
      slug: 'aa071-friend-guard-miss', providerAbility: 'Friend Guard', random: () => 0,
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(false)
  }, 30_000)

  it('aa071.full-guard.reviewed requires current Temporary HP and pays Swift/Scene', () => {
    const declaration = declare({
      slug: 'aa071-full-guard', targetAbility: 'Full Guard', temporaryHp: 20,
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    const { execution, plan } = finish({
      declaration, optionId: 'ability.full-guard.use', chosenBy: 'target',
    })
    expect(JSON.stringify(execution.auditTrace)).toContain('Full Guard')
    expect(JSON.stringify(execution.auditTrace)).toContain('"finalMultiplier":0.5')
    expect(plan.nextMap.encounterState?.turnResources.target?.actions.swift.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Full Guard', ownerId: 'target', spent: 1,
    }))

    const unavailable = declare({ slug: 'aa071-full-guard-no-temp', targetAbility: 'Full Guard' })
    expect(isAuthoritativePendingMoveStatePlan(unavailable.result)).toBe(false)
  }, 30_000)

  it('aa071.fox-fire.reviewed spends one Wisp and Free Action before using authoritative Ember on the triggering foe', () => {
    const declaration = declare({
      slug: 'aa071-fox-fire-trigger', targetAbility: 'Fox Fire', foxWisps: 3,
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    expect(declaration.result.suspension.pendingResolution.outstandingWindows[0]?.options).toEqual([
      { id: 'ability.fox-fire.use', labelKey: 'ability.fox-fire.use-ember' },
    ])
    const { execution, plan } = finish({
      declaration, optionId: 'ability.fox-fire.use', chosenBy: 'target',
    })
    const wisps = (plan.nextMap.encounterState?.effects ?? []).filter(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId === AA071_FOX_FIRE_WISP_CAPABILITY
    ))
    expect(wisps).toHaveLength(2)
    expect(plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalId: 'Fox Fire' }),
    ]))
    expect(nextSheet(plan, 'actor').combat?.currentHp).toBeLessThan(150)
    expect(JSON.stringify(execution.auditTrace)).toContain('Ember')
    expect(JSON.stringify(execution.auditTrace)).toContain('ability.fox-fire.consume-wisp')
  }, 30_000)
})
