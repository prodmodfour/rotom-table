import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { PendingMoveResolution } from '#shared/moveAutomation/pendingResolution'
import type { MoveResolutionTraceAncestryEntry } from '#shared/moveAutomation/trace'
import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { executeMoveSpec } from '../../server/domain/moveAutomation/executeSpec'
import { REGISTERED_MOVE_HANDLER_REGISTRY } from '../../server/domain/moveAutomation/handlers/registry'
import {
  registeredMoveAutomationRuntimeFor,
  type MoveAutomationRuntimeRegistry,
  type MoveSpecV2Runtime,
} from '../../server/domain/moveAutomation/registry'
import { validateMoveSpec } from '../../server/domain/moveAutomation/validateSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { computeTickValue } from '~/utils/ptuHp'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

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
  currentHp?: number
  hpAdded?: number
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 30,
  revision: 3,
  types: ['Normal'],
  abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: input.hpAdded ?? 120 }, atk: { added: 45 }, def: { added: 30 },
    satk: { added: 45 }, sdef: { added: 30 }, spd: { added: 30 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 320, injuries: 0, conditions: [] },
})

const suppression = (placementId: string): EncounterEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'ability', action: 'suppress', values: [],
    referencePlacementId: null, suppressionScope: 'all',
  }),
  id: `effect.aa076.suppress.${placementId}`,
  affected: { placementIds: [placementId], sideIds: [], cells: [] },
})

const grantAbility = (placementId: string, canonicalId: string): EncounterEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'ability', action: 'add', values: [canonicalId],
    referencePlacementId: null, suppressionScope: null,
  }),
  id: `effect.aa076.grant.${placementId}.${id(canonicalId)}`,
  affected: { placementIds: [placementId], sideIds: [], cells: [] },
})

const battleMap = (input: {
  slug: string
  effects?: readonly EncounterEffect[]
}): TabletopMap => {
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
    dimensions: { x: 14, y: 4, z: 14 },
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
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
}

const ATTACK_OF_OPPORTUNITY_ANCESTRY: readonly MoveResolutionTraceAncestryEntry[] = Object.freeze([{
  depth: 0,
  resolutionId: 'resolution:aa076:attack-of-opportunity',
  canonicalId: 'Attack of Opportunity',
  definitionHash: 'a'.repeat(64),
  parentOperationId: 'maneuver.attack-of-opportunity.response',
}])

const declare = (input: {
  slug: string
  move: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  effects?: readonly EncounterEffect[]
  random?: () => number
  ancestry?: readonly MoveResolutionTraceAncestryEntry[]
}) => {
  const map = battleMap(input)
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor', move: input.move, abilities: input.actorAbilities,
      currentHp: 500, hpAdded: 280,
    })],
    ['target', sheet({
      slug: 'target', abilities: input.targetAbilities,
      currentHp: 420, hpAdded: 220,
    })],
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
    ...(input.ancestry ? { ancestry: input.ancestry } : {}),
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
  ownerId?: string
}) => {
  if (!isAuthoritativePendingMoveStatePlan(input.declaration.result)) {
    throw new Error('Expected pending Move.')
  }
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
    chosenBy: { kind: 'target', id: input.ownerId ?? 'target' },
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
const stage = (value: CharacterSheet, key: 'atk' | 'def' | 'satk' | 'sdef' | 'spd'): number => (
  value.stats?.[key]?.stage ?? value.combatStages?.[key] ?? 0
)

describe('AA-076 triggered integrations', () => {
  it('aa076.iron-barbs.reviewed reacts only to a damaging Melee hit and makes the attacker lose one Tick', () => {
    const selected = declare({
      slug: 'aa076-iron-barbs-selected', move: 'Tackle', targetAbilities: ['Iron Barbs'],
    })
    expect(isAuthoritativePendingMoveStatePlan(selected.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(selected.result)) return
    expect(selected.result.suspension.pendingResolution.outstandingWindows[0]).toMatchObject({
      options: [{ id: 'ability.iron-barbs.use' }],
      ownership: [{ kind: 'target', id: 'target' }],
    })
    const selectedResult = finish({ declaration: selected, optionId: 'ability.iron-barbs.use' })

    const passed = declare({
      slug: 'aa076-iron-barbs-passed', move: 'Tackle', targetAbilities: ['Iron Barbs'],
    })
    const passedResult = finish({ declaration: passed, optionId: null })
    const selectedActor = nextSheet(selectedResult.plan, 'actor', selected.pokemonSheets)
    const passedActor = nextSheet(passedResult.plan, 'actor', passed.pokemonSheets)
    const actorContext = buildAuthoritativeMoveRulesContext({
      map: selected.initialMap,
      pokemonSheets: selected.pokemonSheets,
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.75,
      time: 1_000,
    })
    expect((passedActor.combat?.currentHp ?? 0) - (selectedActor.combat?.currentHp ?? 0))
      .toBe(computeTickValue(actorContext.actor.token.fullMaxHp ?? actorContext.actor.token.maxHp))
    expect(selectedResult.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(passedResult.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(0)

    const multi = declare({
      slug: 'aa076-iron-barbs-multi', move: 'Fury Swipes', targetAbilities: ['Iron Barbs'],
    })
    const multiSelected = finish({ declaration: multi, optionId: 'ability.iron-barbs.use' })
    const multiPassed = declare({
      slug: 'aa076-iron-barbs-multi-pass', move: 'Fury Swipes', targetAbilities: ['Iron Barbs'],
    })
    const multiPassedResult = finish({ declaration: multiPassed, optionId: null })
    expect((nextSheet(multiPassedResult.plan, 'actor', multiPassed.pokemonSheets).combat?.currentHp ?? 0)
      - (nextSheet(multiSelected.plan, 'actor', multi.pokemonSheets).combat?.currentHp ?? 0))
      .toBe(computeTickValue(actorContext.actor.token.fullMaxHp ?? actorContext.actor.token.maxHp))
    expect(multiSelected.execution.auditTrace.events.filter(event => (
      event.kind === 'choice'
      && event.reasonCode === 'ability.iron-barbs.optional-hp-loss'
      && event.optionId === 'ability.iron-barbs.use'
    ))).toHaveLength(1)

    const ranged = completedPlan(declare({
      slug: 'aa076-iron-barbs-ranged', move: 'Water Gun', targetAbilities: ['Iron Barbs'],
    }))
    expect(JSON.stringify(ranged.resolution.auditTrace)).not.toContain('ability.iron-barbs.optional-hp-loss')
    const missed = completedPlan(declare({
      slug: 'aa076-iron-barbs-miss', move: 'Tackle', targetAbilities: ['Iron Barbs'],
      random: () => 0,
    }))
    expect(JSON.stringify(missed.resolution.auditTrace)).toContain('ability.iron-barbs.optional-hp-loss')
    expect(missed.resolution.auditTrace.events.some(event => (
      event.kind === 'operation'
      && event.reasonCode === 'ability.iron-barbs.optional-hp-loss'
      && event.outcome === 'applied'
    ))).toBe(false)
  }, 30_000)

  it('aa076.justified.reviewed reacts to Dark hits and Attack-of-Opportunity ancestry but not ordinary non-Dark hits', () => {
    const dark = declare({
      slug: 'aa076-justified-dark', move: 'Bite', targetAbilities: ['Justified'],
    })
    const darkResult = finish({ declaration: dark, optionId: 'ability.justified.use' })
    expect(stage(nextSheet(darkResult.plan, 'target', dark.pokemonSheets), 'atk')).toBe(1)
    expect(darkResult.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)

    const ordinary = completedPlan(declare({
      slug: 'aa076-justified-ordinary', move: 'Tackle', targetAbilities: ['Justified'],
    }))
    expect(ordinary.resolution.auditTrace.events.some(event => (
      event.kind === 'operation'
      && event.reasonCode === 'ability.justified.optional-attack-stage'
      && event.outcome === 'applied'
    ))).toBe(false)

    const opportunity = declare({
      slug: 'aa076-justified-opportunity', move: 'Tackle', targetAbilities: ['Justified'],
      ancestry: ATTACK_OF_OPPORTUNITY_ANCESTRY,
    })
    expect(isAuthoritativePendingMoveStatePlan(opportunity.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(opportunity.result)) return
    expect(opportunity.result.suspension.pendingResolution.outstandingWindows[0]?.options)
      .toContainEqual(expect.objectContaining({ id: 'ability.justified.use' }))
  }, 30_000)

  it('aa076.justified.reviewed survives multi-hit reduction and dynamically granted runtime projection', () => {
    const multi = declare({
      slug: 'aa076-justified-multi', move: 'Rock Blast', targetAbilities: ['Justified'],
      ancestry: ATTACK_OF_OPPORTUNITY_ANCESTRY,
    })
    const multiResult = finish({ declaration: multi, optionId: 'ability.justified.use' })
    expect(stage(nextSheet(multiResult.plan, 'target', multi.pokemonSheets), 'atk')).toBe(1)

    const granted = declare({
      slug: 'aa076-justified-granted', move: 'Bite',
      effects: [grantAbility('target', 'Justified')],
    })
    expect(isAuthoritativePendingMoveStatePlan(granted.result)).toBe(true)
    const grantedResult = finish({ declaration: granted, optionId: 'ability.justified.use' })
    expect(stage(nextSheet(grantedResult.plan, 'target', granted.pokemonSheets), 'atk')).toBe(1)
  }, 30_000)

  it('aa076.iron-barbs.reviewed is reconstructed for a nested damaging Move', () => {
    const tackle = registeredMoveAutomationRuntimeFor('Tackle')
    if (!tackle || tackle.kind !== 'movespec-v2') throw new Error('Tackle runtime missing.')
    const parentDefinition = validateMoveSpec({
      schemaVersion: 2,
      canonicalId: 'Instruct',
      version: 1,
      targeting: {
        kind: 'single-target', minTargets: 1, maxTargets: 1,
        selector: { kind: 'selected-targets' },
      },
      preconditions: [],
      costs: [],
      phases: [{
        phase: 'hit',
        operations: [{
          id: 'aa076.nested.invoke-tackle',
          kind: 'nested-move',
          source: { kind: 'move', id: 'move.instruct' },
          recipients: { kind: 'attacked-targets' },
          phase: 'hit',
          reasonCode: 'aa076.nested.invoke-tackle',
          payload: {
            canonicalId: 'Tackle',
            actor: { kind: 'parent-actor' },
            source: { kind: 'registered-spec' },
            targeting: { kind: 'operation-recipients' },
          },
        }],
      }],
      registeredHandlerId: null,
      presentation: { displayName: 'Instruct', vfxKey: null, tags: ['test-only'] },
    } as MoveSpec)
    const parent: MoveSpecV2Runtime = Object.freeze({
      canonicalId: 'Instruct',
      kind: 'movespec-v2',
      version: 1,
      definitionHash: parentDefinition.definitionHash,
      sourceModule: 'tests/server/abilityAutomationCohort076Triggered.test.ts',
      definition: parentDefinition,
    })
    const entries = Object.freeze([parent, tackle])
    const registry: MoveAutomationRuntimeRegistry = Object.freeze({
      size: entries.length,
      handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
      resolve: (canonicalId: string) => entries.find(entry => entry.canonicalId === canonicalId) ?? null,
      entries: () => entries,
    })
    const map = battleMap({ slug: 'aa076-iron-barbs-nested' })
    const pokemonSheets = new Map<string, CharacterSheet>([
      ['actor', sheet({ slug: 'actor', move: 'Instruct', currentHp: 500, hpAdded: 280 })],
      ['target', sheet({ slug: 'target', abilities: ['Iron Barbs'], currentHp: 420, hpAdded: 220 })],
    ])
    const nestedContext = () => buildAuthoritativeMoveRulesContext({
      map,
      pokemonSheets,
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1,
        placementId: 'actor',
        moveName: 'Instruct',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      candidatePlacementIds: ['target'],
      selectedPlacementIds: ['target'],
      random: () => 0.75,
      time: 1_000,
      resolutionId: 'resolution:aa076:nested',
      runtimeRegistry: registry,
    })
    const first = executeMoveSpec({
      definition: parentDefinition,
      context: nestedContext(),
      authoritativeTargetIds: ['target'],
      resolutionId: 'resolution:aa076:nested',
    })
    expect(first.kind).toBe('pending-request')
    if (first.kind !== 'pending-request') return
    expect(first.request).toMatchObject({
      kind: 'reaction',
      reasonCode: 'ability.iron-barbs.optional-hp-loss',
      options: [{ id: 'ability.iron-barbs.use' }],
    })
    expect(first.trace.ancestry).toEqual([])
    const completed = executeMoveSpec({
      definition: parentDefinition,
      context: nestedContext(),
      authoritativeTargetIds: ['target'],
      resolutionId: 'resolution:aa076:nested',
      responses: [{
        requestId: first.request.requestId,
        optionId: 'ability.iron-barbs.use',
      }],
    })
    expect(completed.kind).toBe('complete')
    expect(completed.childExecutions[0]).toMatchObject({
      canonicalId: 'Tackle',
      targetIds: ['target'],
      trace: { ancestry: [expect.objectContaining({ canonicalId: 'Instruct' })] },
    })
    expect(completed.operations).toContainEqual(expect.objectContaining({
      operation: expect.objectContaining({ reasonCode: 'ability.iron-barbs.attacker-hp-loss' }),
      childResolutionId: expect.any(String),
    }))
  }, 30_000)

  it('aa076.kampfgeist.reviewed resists matching damage one step, pays Scene plus Free, and replays deterministically', () => {
    const selected = declare({
      slug: 'aa076-kampfgeist-selected', move: 'Rock Throw', targetAbilities: ['Kampfgeist'],
    })
    if (!isAuthoritativePendingMoveStatePlan(selected.result)) throw new Error('Expected pending Kampfgeist.')
    const pending = selected.result.suspension.pendingResolution
    expect(pending.outstandingWindows[0]?.options).toContainEqual(expect.objectContaining({
      id: 'ability.kampfgeist.use',
    }))
    const first = resume({
      pending,
      map: selected.result.nextMap,
      pokemonSheets: selected.pokemonSheets,
      optionId: 'ability.kampfgeist.use',
    })
    const retry = resume({
      pending,
      map: selected.result.nextMap,
      pokemonSheets: selected.pokemonSheets,
      optionId: 'ability.kampfgeist.use',
    })
    expect(retry).toEqual(first)
    const selectedResult = finish({ declaration: selected, optionId: 'ability.kampfgeist.use' })

    const passed = declare({
      slug: 'aa076-kampfgeist-passed', move: 'Rock Throw', targetAbilities: ['Kampfgeist'],
    })
    const passedResult = finish({ declaration: passed, optionId: null })
    const selectedHp = nextSheet(selectedResult.plan, 'target', selected.pokemonSheets).combat?.currentHp ?? 0
    const passedHp = nextSheet(passedResult.plan, 'target', passed.pokemonSheets).combat?.currentHp ?? 0
    expect(selectedHp).toBeGreaterThan(passedHp)
    expect(selectedResult.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(selectedResult.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Kampfgeist', spent: 1, limit: 1,
    }))

    const fire = completedPlan(declare({
      slug: 'aa076-kampfgeist-fire', move: 'Ember', targetAbilities: ['Kampfgeist'],
    }))
    expect(fire.resolution.auditTrace.events.some(event => (
      event.kind === 'operation'
      && event.reasonCode === 'ability.kampfgeist.optional-resistance'
      && event.outcome === 'applied'
    ))).toBe(false)
  }, 30_000)

  it('aa076.kampfgeist.reviewed applies its selected resistance to every matching multi-hit strike', () => {
    const selected = declare({
      slug: 'aa076-kampfgeist-multi-selected', move: 'Rock Blast', targetAbilities: ['Kampfgeist'],
    })
    const selectedResult = finish({ declaration: selected, optionId: 'ability.kampfgeist.use' })
    const passed = declare({
      slug: 'aa076-kampfgeist-multi-passed', move: 'Rock Blast', targetAbilities: ['Kampfgeist'],
    })
    const passedResult = finish({ declaration: passed, optionId: null })
    const selectedHp = nextSheet(selectedResult.plan, 'target', selected.pokemonSheets).combat?.currentHp ?? 0
    const passedHp = nextSheet(passedResult.plan, 'target', passed.pokemonSheets).combat?.currentHp ?? 0
    expect(selectedHp).toBeGreaterThan(passedHp)
    expect(JSON.stringify(selectedResult.execution.auditTrace)).toContain('Kampfgeist')
  }, 30_000)

  it('AA-076 reactions fail closed under exact effective-ability suppression', () => {
    for (const [canonicalId, move] of [
      ['Iron Barbs', 'Tackle'],
      ['Justified', 'Bite'],
      ['Kampfgeist', 'Rock Throw'],
    ] as const) {
      const result = completedPlan(declare({
        slug: `aa076-suppressed-${id(canonicalId)}`,
        move,
        targetAbilities: [canonicalId],
        effects: [suppression('target')],
      }))
      expect(JSON.stringify(result.resolution.auditTrace)).not.toContain(`ability.${id(canonicalId)}.optional`)
    }
  }, 30_000)
})
