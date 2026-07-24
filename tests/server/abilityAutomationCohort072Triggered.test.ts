import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
  type AuthoritativeMoveStatePlan,
  type AuthoritativePendingMoveStatePlan,
} from '../../server/domain/planAuthoritativeMoveState'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import {
  AA072_GORILLA_LOCK_CAPABILITY,
} from '#shared/abilityAutomation/aa072'
import type { PendingMoveResponseOwner } from '#shared/moveAutomation/pendingResolution'
import { projectEncounterMoveList } from '#shared/moveAutomation/moveListOverlays'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { aa072GorillaTacticsMoveAllowed } from '../../server/domain/abilityAutomation/mechanics/aa072StaticIntegration'

const slugify = (value: string): string => value.toLowerCase().replaceAll(' ', '-')
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
const sheet = (input: {
  slug: string
  moves?: readonly string[]
  ability?: string
  abilities?: readonly string[]
  types?: readonly string[]
  digestionFoods?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: [...(input.types ?? ['Normal'])],
  abilities: (input.abilities ?? (input.ability ? [input.ability] : [])).map(ability),
  movelist: (input.moves ?? []).map(name => ({ name })),
  stats: {
    hp: { added: 45 }, atk: { added: 25, stage: 0 }, def: { added: 25, stage: 0 },
    satk: { added: 25, stage: 0 }, sdef: { added: 25, stage: 0 }, spd: { added: 25, stage: 0 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [] },
  ...(input.digestionFoods ? { items: { digestionFoods: [...input.digestionFoods] } } : {}),
})
const battleMap = (input: { slug: string; actorAbility?: string; targetAbility?: string }): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2,
    slug: input.slug,
    name: input.slug,
    revision: 5,
    dimensions: { x: 12, y: 4, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [], hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements,
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
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
}
const declare = (input: {
  slug: string
  move: string
  actorAbility?: string
  actorAbilities?: readonly string[]
  targetAbility?: string
  actorTypes?: readonly string[]
  digestionFoods?: readonly string[]
  includeAuthoredMove?: boolean
  random?: () => number
}) => {
  const map = battleMap(input)
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor', moves: input.includeAuthoredMove === false ? [] : [input.move], ability: input.actorAbility,
      abilities: input.actorAbilities,
      types: input.actorTypes, digestionFoods: input.digestionFoods,
    })],
    ['target', sheet({ slug: 'target', ability: input.targetAbility })],
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
    random: input.random ?? (() => 0.99),
    now: () => 1_000,
    operationId: `op_${input.slug}`,
    pendingResolutionId: `resolution:${input.slug}`,
  })
  return { result, pokemonSheets }
}
const respond = (input: {
  plan: AuthoritativePendingMoveStatePlan
  pokemonSheets: ReadonlyMap<string, CharacterSheet>
  optionId: string | null
  chosenBy: PendingMoveResponseOwner
  index?: number
}): AuthoritativeMoveStatePlan | AuthoritativePendingMoveStatePlan => {
  const pending = input.plan.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending),
    map: structuredClone(input.plan.nextMap),
    pokemonSheets: input.pokemonSheets,
    trainerSheets: new Map(),
    response: { requestId: window.windowId, optionId: input.optionId },
    now: 2_000 + (input.index ?? 0),
    random: () => 0.99,
  })
  return planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: input.plan.suspension.preWindowPlan,
    responseOpId: `op_response_${input.plan.nextMap.slug}_${input.index ?? 0}`,
    responseWindowId: window.windowId,
    responseOptionId: input.optionId,
    chosenBy: input.chosenBy,
    map: input.plan.nextMap,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: new Map(),
    execution,
    plannedAt: 2_000 + (input.index ?? 0),
  })
}
const finishFirst = (input: {
  declaration: ReturnType<typeof declare>
  optionId: string | null
  chosenBy?: PendingMoveResponseOwner
}): AuthoritativeMoveStatePlan => {
  if (!isAuthoritativePendingMoveStatePlan(input.declaration.result)) throw new Error('Expected pending Move.')
  let plan = respond({
    plan: input.declaration.result,
    pokemonSheets: input.declaration.pokemonSheets,
    optionId: input.optionId,
    chosenBy: input.chosenBy ?? { kind: 'placement', id: 'actor' },
  })
  let index = 1
  while (isAuthoritativePendingMoveStatePlan(plan)) {
    const window = plan.suspension.pendingResolution.outstandingWindows[0]!
    const optionId = window.options[0]?.id ?? null
    plan = respond({
      plan,
      pokemonSheets: input.declaration.pokemonSheets,
      optionId,
      chosenBy: { kind: 'placement', id: 'actor' },
      index,
    })
    index += 1
    if (index > 8) throw new Error('Too many AA-072 response windows.')
  }
  return plan
}
const nextSheet = (plan: AuthoritativeMoveStatePlan, slug: string, initial: ReadonlyMap<string, CharacterSheet>): CharacterSheet => (
  (plan.sheetWrites.find(write => write.slug === slug)?.nextSheet ?? initial.get(slug)) as CharacterSheet
)


describe('AA-072 Move-triggered abilities', () => {
  it('projects every AA-072 Connection Move as authoritative even when absent from the authored movelist', () => {
    for (const [slug, move, actorAbility] of [
      ['gale-wings', 'Quick Attack', 'Gale Wings'],
      ['giver', 'Present', 'Giver'],
      ['gore', 'Horn Attack', 'Gore'],
    ] as const) {
      const declaration = declare({
        slug: `aa072-connection-${slug}`, move, actorAbility, includeAuthoredMove: false,
      })
      expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    }
  }, 30_000)

  it('aa072.gale-wings.reviewed durably changes Quick Attack to Flying without a resource payment', () => {
    const declaration = declare({
      slug: 'aa072-gale-wings', move: 'Quick Attack', actorAbility: 'Gale Wings', actorTypes: ['Flying'],
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    expect(declaration.result.suspension.pendingResolution.outstandingWindows[0]?.options).toEqual([
      { id: 'ability.gale-wings.flying', labelKey: 'ability.gale-wings.flying' },
    ])
    const plan = finishFirst({ declaration, optionId: 'ability.gale-wings.flying' })
    const trace = JSON.stringify(plan.resolution.auditTrace)
    expect(trace).toContain('"moveType":"Flying"')
    expect(trace).toContain('ability.gale-wings.optional-flying-type')
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(0)
  }, 30_000)

  it('aa072.galvanize.reviewed changes a damaging Normal Move to Electric and pays Free/At-Will', () => {
    const declaration = declare({ slug: 'aa072-galvanize', move: 'Tackle', actorAbility: 'Galvanize' })
    const plan = finishFirst({ declaration, optionId: 'ability.galvanize.electric' })
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('"moveType":"Electric"')
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalId: 'Galvanize' }),
    ]))
  }, 30_000)

  it('aa072.galvanize.reviewed does not open for a non-damaging Normal Move', () => {
    const declaration = declare({ slug: 'aa072-galvanize-status', move: 'Attract', actorAbility: 'Galvanize' })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(false)
  }, 30_000)

  it('aa072.gale-wings-and-galvanize.reviewed serializes mutually exclusive type choices', () => {
    const flying = declare({
      slug: 'aa072-gale-galvanize-flying', move: 'Quick Attack',
      actorAbilities: ['Gale Wings', 'Galvanize'], actorTypes: ['Flying'],
    })
    const flyingPlan = finishFirst({ declaration: flying, optionId: 'ability.gale-wings.flying' })
    expect(JSON.stringify(flyingPlan.resolution.auditTrace)).toContain('"moveType":"Flying"')
    expect(flyingPlan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(0)

    const electric = declare({
      slug: 'aa072-gale-galvanize-electric', move: 'Quick Attack',
      actorAbilities: ['Gale Wings', 'Galvanize'], actorTypes: ['Flying'],
    })
    if (!isAuthoritativePendingMoveStatePlan(electric.result)) throw new Error('Expected Gale Wings choice.')
    const afterPass = respond({
      plan: electric.result, pokemonSheets: electric.pokemonSheets, optionId: null,
      chosenBy: { kind: 'placement', id: 'actor' },
    })
    expect(isAuthoritativePendingMoveStatePlan(afterPass)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(afterPass)) return
    expect(afterPass.suspension.pendingResolution.outstandingWindows[0]?.options).toEqual([
      { id: 'ability.galvanize.electric', labelKey: 'ability.galvanize.electric' },
    ])
    const electricPlan = respond({
      plan: afterPass, pokemonSheets: electric.pokemonSheets,
      optionId: 'ability.galvanize.electric', chosenBy: { kind: 'placement', id: 'actor' }, index: 1,
    })
    expect(isAuthoritativePendingMoveStatePlan(electricPlan)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(electricPlan)) return
    expect(JSON.stringify(electricPlan.resolution.auditTrace)).toContain('"moveType":"Electric"')
    expect(electricPlan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
  }, 30_000)

  it('aa072.giver.reviewed keeps the natural Present roll but authoritatively selects 1 or 5 and pays Swift/Scene x2', () => {
    const declaration = declare({ slug: 'aa072-giver', move: 'Present', actorAbility: 'Giver', random: () => 0.4 })
    const plan = finishFirst({ declaration, optionId: 'ability.giver.force-5' })
    const trace = JSON.stringify(plan.resolution.auditTrace)
    expect(trace).toContain('"selectedId":"outcome-5"')
    expect(trace).toContain('"naturalSelectedId":"outcome-3"')
    expect(trace).toContain('"forcedByGiver":true')
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Giver', spent: 1, limit: 2,
    }))
  }, 30_000)

  it('aa072.gluttony.reviewed requires a durable private choice when a Move can trade multiple Food Buffs', () => {
    const declaration = declare({
      slug: 'aa072-gluttony-choice', move: 'Bug Bite', actorAbility: 'Gluttony',
      digestionFoods: ['Candy Bar', 'Oran Berry', 'Cheri Berry'],
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    expect(JSON.stringify(declaration.result.suspension.publicSummary)).not.toContain('candy-bar')
    expect(JSON.stringify(declaration.result.suspension.publicSummary)).not.toContain('oran-berry')
    expect(declaration.result.suspension.pendingResolution.outstandingWindows[0]?.options).toEqual([
      { id: 'ability.gluttony.digest.1.candy-bar', labelKey: 'item.candy-bar' },
      { id: 'ability.gluttony.digest.2.oran-berry', labelKey: 'item.oran-berry' },
      { id: 'ability.gluttony.digest.3.cheri-berry', labelKey: 'item.cheri-berry' },
    ])
    const plan = finishFirst({ declaration, optionId: 'ability.gluttony.digest.2.oran-berry' })
    expect(nextSheet(plan, 'actor', declaration.pokemonSheets).items?.digestionFoods).toEqual([
      'Candy Bar', 'Cheri Berry',
    ])
    expect(plan.nextMap.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'capability', stacks: 1,
        payload: { capabilityId: 'digestion-buff-traded-this-scene', action: 'grant' },
      }),
    ]))
    const exactRetry = finishFirst({
      declaration, optionId: 'ability.gluttony.digest.2.oran-berry',
    })
    expect(exactRetry.nextMap.encounterState?.effects).toEqual(plan.nextMap.encounterState?.effects)
    expect(nextSheet(exactRetry, 'actor', declaration.pokemonSheets).items?.digestionFoods).toEqual([
      'Candy Bar', 'Cheri Berry',
    ])
  }, 30_000)

  it('aa072.gluttony.reviewed consumes the selected occurrence when canonical Food Buff IDs repeat', () => {
    const declaration = declare({
      slug: 'aa072-gluttony-duplicate-choice', move: 'Bug Bite', actorAbility: 'Gluttony',
      digestionFoods: ['Oran', 'Oran Berry', 'Candy Bar'],
    })
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) {
      throw new Error('Expected a duplicate-safe Gluttony choice.')
    }
    expect(declaration.result.suspension.pendingResolution.outstandingWindows[0]?.options).toEqual([
      { id: 'ability.gluttony.digest.1.oran-berry', labelKey: 'item.oran-berry' },
      { id: 'ability.gluttony.digest.2.oran-berry', labelKey: 'item.oran-berry' },
      { id: 'ability.gluttony.digest.3.candy-bar', labelKey: 'item.candy-bar' },
    ])
    const plan = finishFirst({ declaration, optionId: 'ability.gluttony.digest.2.oran-berry' })
    expect(nextSheet(plan, 'actor', declaration.pokemonSheets).items?.digestionFoods).toEqual([
      'Oran', 'Candy Bar',
    ])
    const exactRetry = finishFirst({
      declaration, optionId: 'ability.gluttony.digest.2.oran-berry',
    })
    expect(nextSheet(exactRetry, 'actor', declaration.pokemonSheets).items?.digestionFoods).toEqual([
      'Oran', 'Candy Bar',
    ])
  }, 30_000)

  it('aa072.gooey.reviewed lowers the melee attacker Speed after an actual hit and pays the target Free Action', () => {
    const declaration = declare({ slug: 'aa072-gooey', move: 'Tackle', targetAbility: 'Gooey' })
    const plan = finishFirst({
      declaration,
      optionId: 'ability.gooey.use',
      chosenBy: { kind: 'placement', id: 'target' },
    })
    expect(nextSheet(plan, 'actor', declaration.pokemonSheets).stats?.spd?.stage).toBe(-1)
    expect(plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
  }, 30_000)

  it('aa072.gooey.reviewed observes a successful Melee multi-hit sequence', () => {
    const declaration = declare({
      slug: 'aa072-gooey-multi-hit', move: 'Fury Swipes', targetAbility: 'Gooey',
    })
    const plan = finishFirst({
      declaration,
      optionId: 'ability.gooey.use',
      chosenBy: { kind: 'placement', id: 'target' },
    })
    expect(nextSheet(plan, 'actor', declaration.pokemonSheets).stats?.spd?.stage).toBe(-1)
    expect(plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
  }, 30_000)

  it('aa072.gooey.reviewed attributes the stage loss to its responder for defensive immunity', () => {
    const declaration = declare({
      slug: 'aa072-gooey-full-metal-body', move: 'Tackle',
      actorAbilities: ['Full Metal Body'], targetAbility: 'Gooey',
    })
    const plan = finishFirst({
      declaration,
      optionId: 'ability.gooey.use',
      chosenBy: { kind: 'placement', id: 'target' },
    })
    expect(nextSheet(plan, 'actor', declaration.pokemonSheets).stats?.spd?.stage).toBe(0)
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('Full Metal Body')
    expect(plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
  }, 30_000)

  it('aa072.gooey.reviewed does not react when the triggering Melee Attack misses', () => {
    const declaration = declare({
      slug: 'aa072-gooey-miss', move: 'Tackle', targetAbility: 'Gooey', random: () => 0,
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(false)
  }, 30_000)

  it('aa072.gore.reviewed replaces Horn Attack with Double Strike and pushes a damaged target two meters', () => {
    const declaration = declare({ slug: 'aa072-gore', move: 'Horn Attack', actorAbility: 'Gore' })
    const plan = finishFirst({ declaration, optionId: 'ability.gore.use' })
    const trace = JSON.stringify(plan.resolution.auditTrace)
    expect(trace).toContain('ability.gore.double-strike')
    expect(trace).toContain('ability.gore.push-two-meters')
    expect(nextSheet(plan, 'target', declaration.pokemonSheets).combat?.currentHp).toBeLessThan(150)
    expect(plan.nextMap.placements.find(placement => placement.id === 'target')?.position.x).toBeGreaterThan(2)
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Gore', spent: 1, limit: 2,
    }))
  }, 30_000)

  it('aa072.gore-and-gorilla-tactics.reviewed never spends the same Swift Action twice', () => {
    const declaration = declare({
      slug: 'aa072-gore-gorilla-conflict', move: 'Horn Attack',
      actorAbilities: ['Gore', 'Gorilla Tactics'],
    })
    const plan = finishFirst({ declaration, optionId: 'ability.gore.use' })
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Gore', spent: 1,
    }))
    expect(plan.nextMap.encounterState?.abilityUsage?.entries ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalId: 'Gorilla Tactics' }),
    ]))
    expect(plan.nextMap.encounterState?.effects ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'capability',
        payload: { capabilityId: AA072_GORILLA_LOCK_CAPABILITY, action: 'grant' },
      }),
    ]))
  }, 30_000)

  it('aa072.giver-and-gorilla-tactics.reviewed prioritizes the selected Scene lock over Giver', () => {
    const declaration = declare({
      slug: 'aa072-giver-gorilla-conflict', move: 'Present',
      actorAbilities: ['Giver', 'Gorilla Tactics'], random: () => 0.4,
    })
    const plan = finishFirst({ declaration, optionId: 'ability.gorilla-tactics.use' })
    const trace = JSON.stringify(plan.resolution.auditTrace)
    expect(trace).toContain('ability.gorilla-tactics.optional-lock')
    expect(trace).toContain('"naturalSelectedId":')
    expect(trace).toContain('"forcedByGiver":false')
    expect(plan.nextMap.encounterState?.abilityUsage?.entries ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalId: 'Giver' }),
    ]))
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
  }, 30_000)

  it('aa072.gorilla-tactics.reviewed applies its triggering bonus to each multi-hit damage roll', () => {
    const declaration = declare({
      slug: 'aa072-gorilla-multi', move: 'Fury Swipes', actorAbility: 'Gorilla Tactics',
    })
    const plan = finishFirst({ declaration, optionId: 'ability.gorilla-tactics.use' })
    const trace = JSON.stringify(plan.resolution.auditTrace)
    expect(trace.match(/"damagePipelineHpLoss":35/g)?.length).toBeGreaterThanOrEqual(2)
  }, 30_000)

  it('aa072.gorilla-tactics.reviewed boosts the triggering Move and creates a Scene move allow-list', () => {
    const declaration = declare({ slug: 'aa072-gorilla', move: 'Tackle', actorAbility: 'Gorilla Tactics' })
    const plan = finishFirst({ declaration, optionId: 'ability.gorilla-tactics.use' })
    const effects = plan.nextMap.encounterState?.effects ?? []
    expect(effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'capability',
        payload: { capabilityId: AA072_GORILLA_LOCK_CAPABILITY, action: 'grant' },
      }),
      expect.objectContaining({
        kind: 'numeric-modifier',
        payload: expect.objectContaining({ attribute: 'damage', operation: 'add', value: 10 }),
      }),
      expect.objectContaining({
        kind: 'move-list-overlay',
        payload: { action: 'restrict', canonicalMoveIds: ['Tackle'] },
      }),
    ]))
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('ability.gorilla-tactics.triggering-damage')
    expect(projectEncounterMoveList({
      placementId: 'actor', sideId: 'heroes',
      baseCanonicalMoveIds: ['Tackle', 'Water Gun'],
      effects,
    })).toMatchObject([
      { canonicalMoveId: 'Tackle', available: true },
      { canonicalMoveId: 'Water Gun', available: false },
    ])
    const lockedContext = buildAuthoritativeMoveRulesContext({
      map: plan.nextMap,
      pokemonSheets: declaration.pokemonSheets,
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Water Gun',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.99,
      time: 3_000,
    })
    expect(aa072GorillaTacticsMoveAllowed({
      context: lockedContext, placementId: 'actor', canonicalMoveId: 'Tackle',
    })).toBe(true)
    expect(aa072GorillaTacticsMoveAllowed({
      context: lockedContext, placementId: 'actor', canonicalMoveId: 'Water Gun',
    })).toBe(false)
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Gorilla Tactics', spent: 1, limit: 1,
    }))
  }, 30_000)
})
