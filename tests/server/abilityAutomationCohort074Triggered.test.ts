import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { MoveTemporaryEffectOperation } from '#shared/moveAutomation/effects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveState,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import type { PendingMoveResolution } from '#shared/moveAutomation/pendingResolution'
import { createMoveAutomationWeatherResolver } from '../../server/domain/moveAutomation/weather'
import { applyEncounterNumericModifiers } from '../../server/domain/moveAutomation/encounterNumericModifiers'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { executeMoveSpec } from '../../server/domain/moveAutomation/executeSpec'
import { MOVE_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/moveAutomation/registry'
import {
  capabilityEncounterEffectFixture,
  creatureRuleOverlayEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'
import { createDigestionBuffTradeEffect } from '../../server/domain/moveAutomation/digestionBuffTrade'

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
  digestionFood?: string
  actorDigestionFood?: string
  conditions?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: ['Normal'],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  ...((input.digestionFood ?? input.actorDigestionFood) ? {
    items: { digestionFood: input.digestionFood ?? input.actorDigestionFood },
  } : {}),
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: {
    currentHp: input.currentHp ?? 150,
    injuries: 0,
    conditions: [...(input.conditions ?? [])],
  },
})

const battleMap = (input: {
  slug: string
  targetSide?: 'heroes' | 'foes'
  effects?: readonly EncounterEffect[]
  temporaryHp?: number
}): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: input.targetSide ?? 'foes', position: { x: 2, y: 0, z: 1 } },
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
    ...(input.temporaryHp === undefined ? {} : {
      temporaryHitPoints: {
        scene: { name: 'Scene', startedAt: 100 },
        byPlacementId: { actor: input.temporaryHp },
      },
    }),
  }
}

const declare = (input: {
  slug: string
  move: string
  actorAbility: string
  targetSide?: 'heroes' | 'foes'
  targetHp?: number
  targetDigestionFood?: string
  actorDigestionFood?: string
  random?: () => number
  targetAlreadyTraded?: boolean
  temporaryHp?: number
  temporaryHpBlocked?: boolean
}) => {
  const effects: EncounterEffect[] = input.temporaryHpBlocked ? [{
    ...capabilityEncounterEffectFixture(),
    id: 'ability.cruelty.healing-block.actor',
    affected: { placementIds: ['actor'], sideIds: [], cells: [] },
    duration: { kind: 'scene', remaining: null },
    payload: { capabilityId: 'aa065.cruelty.healing-blocked', action: 'grant' },
    tags: ['ability', 'aa065', 'cruelty', 'healing-blocked'],
  }] : []
  let map = battleMap({
    slug: input.slug, targetSide: input.targetSide,
    effects, temporaryHp: input.temporaryHp,
  })
  if (input.targetAlreadyTraded) {
    const placement = map.placements.find(candidate => candidate.id === 'target')!
    map = {
      ...map,
      encounterState: {
        ...map.encounterState!,
        effects: [...effects, createDigestionBuffTradeEffect({
          map, placement, operationId: 'op_target_prior_trade', moveId: 'prior.trade',
        })],
      },
    }
  }
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor',
      move: input.move,
      ability: input.actorAbility,
      actorDigestionFood: input.actorDigestionFood,
    })],
    ['target', sheet({
      slug: 'target',
      currentHp: input.targetHp,
      digestionFood: input.targetDigestionFood,
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
  random: () => 0.75,
})

const finish = (input: {
  declaration: ReturnType<typeof declare>
  optionId: string | null
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
    chosenBy: { kind: 'placement', id: 'actor' },
    map: input.declaration.result.nextMap,
    pokemonSheets: input.declaration.pokemonSheets,
    trainerSheets: new Map(),
    execution,
    plannedAt: 2_000,
  })
  return { execution, plan }
}

const nextSheet = (
  plan: ReturnType<typeof planAuthoritativeMoveState>,
  slug: string,
  original: ReadonlyMap<string, CharacterSheet>,
): CharacterSheet => (plan.sheetWrites.find(write => write.slug === slug)?.nextSheet
  ?? original.get(slug)) as CharacterSheet

describe('AA-074 Move and lifecycle integrations', () => {
  it('aa074.heliovolt.reviewed triggers on Electric Move use even after a miss and durably pays Swift', () => {
    const declaration = declare({
      slug: 'aa074-heliovolt', move: 'Thunder Shock', actorAbility: 'Heliovolt', random: () => 0,
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration.result)) return
    expect(declaration.result.suspension.pendingResolution.outstandingWindows[0]?.options).toEqual([
      { id: 'ability.heliovolt.use', labelKey: 'ability.heliovolt.evasion-and-sun' },
    ])
    const { execution, plan } = finish({ declaration, optionId: 'ability.heliovolt.use' })
    expect(plan.nextMap.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'numeric-modifier',
        affected: expect.objectContaining({ placementIds: ['actor'] }),
        payload: expect.objectContaining({ attribute: 'evasion', value: 1 }),
      }),
      expect.objectContaining({
        kind: 'capability',
        payload: { capabilityId: 'aa074.heliovolt.considered-sunny', action: 'grant' },
      }),
    ]))
    expect(createMoveAutomationWeatherResolver(plan.nextMap, {
      subjectPlacementId: 'actor',
    }).active().some(weather => weather.kind === 'sunny')).toBe(true)
    expect(createMoveAutomationWeatherResolver(plan.nextMap, {
      subjectPlacementId: 'target',
    }).active().some(weather => weather.kind === 'sunny')).toBe(false)
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(JSON.stringify(execution.auditTrace)).toContain('ability.heliovolt.considered-sunny')
  }, 30_000)

  it('aa074.helper.reviewed grants a single Ally +1 Accuracy and Skill Checks through the user’s next turn', () => {
    const declaration = declare({
      slug: 'aa074-helper', move: 'Heal Pulse', actorAbility: 'Helper',
      targetSide: 'heroes', targetHp: 50,
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(declaration.result)) return
    const effects = declaration.result.nextMap.encounterState?.effects ?? []
    expect(effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'numeric-modifier',
        affected: expect.objectContaining({ placementIds: ['target'] }),
        duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 2 },
        payload: expect.objectContaining({ attribute: 'accuracy', value: 1 }),
      }),
      expect.objectContaining({
        kind: 'numeric-modifier',
        affected: expect.objectContaining({ placementIds: ['target'] }),
        payload: expect.objectContaining({ attribute: 'skill-check', value: 1 }),
      }),
    ]))
    expect(applyEncounterNumericModifiers({
      map: declaration.result.nextMap,
      placementId: 'target',
      attribute: 'skill-check',
      baseValue: 8,
    })).toMatchObject({ value: 9, steps: [expect.objectContaining({ delta: 1 })] })
  }, 30_000)

  it('aa074.honey-thief.reviewed steals the hit target buff, preserves the actor buff, and grants one Tick of Temporary HP', () => {
    const declaration = declare({
      slug: 'aa074-honey-thief', move: 'Bug Bite', actorAbility: 'Honey Thief',
      targetDigestionFood: 'Oran Berry', actorDigestionFood: 'Candy Bar',
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration.result)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(declaration.result)) return
    expect(nextSheet(declaration.result, 'target', declaration.pokemonSheets).items?.digestionFood).toBeUndefined()
    expect(nextSheet(declaration.result, 'actor', declaration.pokemonSheets).items?.digestionFood).toBe('Candy Bar')
    expect(declaration.result.nextMap.temporaryHitPoints?.byPlacementId.actor).toBeGreaterThan(0)
    expect(JSON.stringify(declaration.result.resolution.auditTrace)).toContain('ability.honey-thief.temporary-hp')

    const missed = declare({
      slug: 'aa074-honey-thief-miss', move: 'Bug Bite', actorAbility: 'Honey Thief',
      targetDigestionFood: 'Oran Berry', random: () => 0,
    })
    expect(isAuthoritativePendingMoveStatePlan(missed.result)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(missed.result)) return
    expect(nextSheet(missed.result, 'target', missed.pokemonSheets).items?.digestionFood).toBe('Oran Berry')
    expect(missed.result.nextMap.temporaryHitPoints?.byPlacementId.actor ?? 0).toBe(0)

    const unavailable = declare({
      slug: 'aa074-honey-thief-used', move: 'Bug Bite', actorAbility: 'Honey Thief',
      targetDigestionFood: 'Oran Berry', targetAlreadyTraded: true,
    })
    expect(isAuthoritativePendingMoveStatePlan(unavailable.result)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(unavailable.result)) return
    expect(nextSheet(unavailable.result, 'target', unavailable.pokemonSheets).items?.digestionFood).toBe('Oran Berry')
    expect(unavailable.result.nextMap.temporaryHitPoints?.byPlacementId.actor ?? 0).toBe(0)

    const higherPool = declare({
      slug: 'aa074-honey-thief-higher-pool', move: 'Bug Bite', actorAbility: 'Honey Thief',
      targetDigestionFood: 'Oran Berry', temporaryHp: 100,
    })
    expect(isAuthoritativePendingMoveStatePlan(higherPool.result)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(higherPool.result)) return
    expect(higherPool.result.nextMap.temporaryHitPoints?.byPlacementId.actor).toBe(100)
    expect(higherPool.result.stateChanges.changes.some(change => (
      change.kind === 'map-temporary-hit-points'
    ))).toBe(false)

    const blocked = declare({
      slug: 'aa074-honey-thief-blocked', move: 'Bug Bite', actorAbility: 'Honey Thief',
      targetDigestionFood: 'Oran Berry', temporaryHpBlocked: true,
    })
    expect(isAuthoritativePendingMoveStatePlan(blocked.result)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(blocked.result)) return
    expect(blocked.result.nextMap.temporaryHitPoints?.byPlacementId.actor ?? 0).toBe(0)
  }, 30_000)

  it('aa074.horde-break.reviewed emits an optional clear only for a sealed School Form to Solo Form transition', () => {
    const school = creatureRuleOverlayEncounterEffectFixture({
      domain: 'form', action: 'replace', value: 'school-form', referencePlacementId: null,
    })
    const map = battleMap({
      slug: 'aa074-horde-break',
      effects: [{
        ...school,
        id: 'effect.aa074.school-form',
        affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      }],
    })
    const sheets = new Map<string, CharacterSheet>([
      ['actor', sheet({ slug: 'actor', move: 'Tackle', ability: 'Horde Break', conditions: ['Burned'] })],
      ['target', sheet({ slug: 'target' })],
    ])
    const context = buildAuthoritativeMoveRulesContext({
      map,
      pokemonSheets: sheets,
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.75,
      time: 1_000,
      resolutionId: 'resolution:aa074-horde-break',
    })
    expect(context.actor.token.creatureRules?.formId).toBe('school-form')
    const formOperation: MoveTemporaryEffectOperation = {
      id: 'test.schooling.solo-form',
      kind: 'temporary-effect',
      source: { kind: 'move', id: 'move.tackle' },
      recipients: { kind: 'actor' },
      phase: 'schedule',
      reasonCode: 'test.schooling.solo-form',
      payload: {
        action: 'add', effectId: 'test.schooling.form', recipientScope: 'placements',
        definition: {
          kind: 'creature-rule-overlay',
          duration: { kind: 'scene', remaining: null },
          stacks: 1, charges: null,
          stackPolicy: { kind: 'replace', maxStacks: null },
          chargePolicy: { kind: 'none', amount: null },
          tags: ['schooling', 'form'],
          payload: {
            domain: 'form', action: 'replace', value: 'solo-form',
            referencePlacementId: null,
          },
          dispel: { policy: 'matching-tags', tags: ['schooling', 'form'] },
          transferPolicy: 'expire',
        },
      },
    }
    const runtime = MOVE_AUTOMATION_RUNTIME_REGISTRY.resolve('Tackle')
    if (!runtime || runtime.kind !== 'movespec-v2') throw new Error('Tackle runtime unavailable.')
    const pending = executeMoveSpec({
      definition: runtime.definition,
      context,
      authoritativeTargetIds: ['target'],
      resolutionId: 'resolution:aa074-horde-break',
      serverAbilityOverlayOperations: [formOperation],
    })
    expect(pending).toMatchObject({
      kind: 'pending-request',
      request: {
        options: [{ id: 'ability.horde-break.use', labelKey: 'ability.horde-break.clear-statuses' }],
      },
    })
    if (pending.kind !== 'pending-request') return
    const resumedContext = buildAuthoritativeMoveRulesContext({
      map,
      pokemonSheets: sheets,
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.75,
      time: 1_000,
      resolutionId: 'resolution:aa074-horde-break',
    })
    const completed = executeMoveSpec({
      definition: runtime.definition,
      context: resumedContext,
      authoritativeTargetIds: ['target'],
      resolutionId: 'resolution:aa074-horde-break',
      serverAbilityOverlayOperations: [formOperation],
      responses: [{ requestId: pending.request.requestId, optionId: 'ability.horde-break.use' }],
    })
    expect(completed.kind).toBe('complete')
    expect(completed.operations).toContainEqual(expect.objectContaining({
      operation: expect.objectContaining({
        kind: 'condition', reasonCode: 'ability.horde-break.clear-statuses',
        payload: expect.objectContaining({ action: 'clear' }),
      }),
      recipientIds: ['actor'],
    }))
  }, 30_000)
})
