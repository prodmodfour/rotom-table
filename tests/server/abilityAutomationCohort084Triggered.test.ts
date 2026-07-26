import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { ENCOUNTER_PRIORITY_ADVANCED_NEXT_TURN_FLAG_ID } from '../../server/domain/moveAutomation/reduceEncounterResources'
import { createMoveAutomationResourceResolver } from '../../server/domain/moveAutomation/resources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveState,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'

const slugId = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${slugId(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  ability?: string
  move?: string
  types?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 30, revision: 3,
  types: [...(input.types ?? ['Normal'])],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: [{ name: input.move ?? 'Tackle' }],
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 300, injuries: 0, conditions: [] },
})
const fixture = (input: {
  slug: string
  actorAbility?: string
  allyAbility?: string
  move?: string
  actorTypes?: readonly string[]
  targetTypes?: readonly string[]
  actedThisRound?: boolean
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'ally', sheetKind: 'pokemon', sheetSlug: 'ally', sideId: 'heroes', position: { x: 2, y: 0, z: 3 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 3, y: 0, z: 2 } },
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
        actedThisRoundPlacementIds: input.actedThisRound ? ['actor'] : [],
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1, turn: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 }, metadata: {},
  }
  const move = input.move ?? 'Tackle'
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', ability: input.actorAbility, move, types: input.actorTypes })],
    ['ally', sheet({ slug: 'ally', ability: input.allyAbility })],
    ['target', sheet({ slug: 'target', types: input.targetTypes })],
  ])
  return { map, sheets, move }
}
type Fixture = ReturnType<typeof fixture>
const intentFor = (state: Fixture) => ({
  schemaVersion: 1 as const, placementId: 'actor', moveName: state.move,
  selection: state.move === 'Agility'
    ? { kind: 'self' as const }
    : { kind: 'single-target' as const, targetPlacementId: 'target' },
})
const declare = (state: Fixture, random: () => number = () => 0.75) => planAuthoritativeMoveStateExecution({
  map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
  intent: intentFor(state), random, now: () => 1_000,
  operationId: `op_${slugId(state.map.slug)}`,
  pendingResolutionId: `resolution:${state.map.slug}`,
})
const complete = (input: {
  state: Fixture
  optionFor: (reasonCode: string, options: readonly { readonly id: string }[], index: number) => string | null
  values?: readonly number[]
}) => {
  let randomIndex = 0
  const values = input.values ?? [0.75]
  const random = () => values[Math.min(randomIndex++, values.length - 1)] ?? 0.75
  let plan: ReturnType<typeof planResumedMoveState> | ReturnType<typeof declare> = declare(input.state, random)
  let responseIndex = 0
  while (isAuthoritativePendingMoveStatePlan(plan)) {
    const pending = plan.suspension.pendingResolution
    const window = pending.outstandingWindows[0]!
    const optionId = input.optionFor(window.reasonCode, window.options, responseIndex)
    const execution = resumeMoveSpec({
      pendingResolution: structuredClone(pending), map: structuredClone(plan.nextMap),
      pokemonSheets: input.state.sheets, trainerSheets: new Map(),
      response: { requestId: window.windowId, optionId },
      now: 2_000 + responseIndex, random,
    })
    plan = planResumedMoveState({
      pendingResolution: pending, declarationPlan: plan.suspension.preWindowPlan,
      responseOpId: `op_response_${slugId(input.state.map.slug)}_${responseIndex}`,
      responseWindowId: window.windowId, responseOptionId: optionId,
      chosenBy: window.ownership[0]!, map: plan.nextMap,
      pokemonSheets: input.state.sheets, trainerSheets: new Map(), execution,
      plannedAt: 2_000 + responseIndex,
    })
    responseIndex += 1
    if (responseIndex > 12) throw new Error('Too many AA-084 response windows.')
  }
  return plan
}
const nextSheet = (state: Fixture, plan: ReturnType<typeof complete>, slug: string): CharacterSheet => (
  plan.sheetWrites.find(write => write.slug === slug)?.nextSheet ?? state.sheets.get(slug)!
) as CharacterSheet
const ordinary = (state: Fixture) => {
  const plan = planAuthoritativeMoveState({
    map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
    intent: intentFor(state), random: () => 0.75, now: () => 1_000,
    operationId: `op_ordinary_${slugId(state.map.slug)}`,
  })
  if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Ordinary move unexpectedly suspended.')
  return plan
}

describe('AA-084 triggered Move integrations', () => {
  it('Prankster offers an optional Status-Move branch and selected Priority (Advanced) creates its next-turn debt', () => {
    const state = fixture({
      slug: 'aa084-prankster', actorAbility: 'Prankster', move: 'Agility', actedThisRound: true,
    })
    const declaration = declare(state)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected Prankster response.')
    expect(declaration.suspension.pendingResolution.outstandingWindows[0]?.reasonCode)
      .toBe('ability.prankster.optional-priority-advanced')
    const plan = complete({
      state,
      optionFor: reason => reason === 'ability.prankster.optional-priority-advanced'
        ? 'ability.prankster.priority-advanced'
        : null,
    })
    const resources = createMoveAutomationResourceResolver(plan.nextMap.encounterState?.turnResources ?? {})
    expect(resources.hasOncePerTurnFlag('actor', ENCOUNTER_PRIORITY_ADVANCED_NEXT_TURN_FLAG_ID)).toBe(true)
    expect(plan.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'choice', reasonCode: 'ability.prankster.optional-priority-advanced',
      outcome: 'selected', optionId: 'ability.prankster.priority-advanced',
    }))
  }, 30_000)

  it('Protean changes Type before the Move, grants same-resolution STAB, persists the overlay, and spends Swift', () => {
    const state = fixture({
      slug: 'aa084-protean', actorAbility: 'Protean', move: 'Ember', actorTypes: ['Normal'],
    })
    const plan = complete({
      state,
      optionFor: reason => reason === 'ability.protean.optional-type-change'
        ? 'ability.protean.change-type'
        : null,
    })
    const baseState = fixture({ slug: 'aa084-protean-ordinary', move: 'Ember', actorTypes: ['Normal'] })
    const basePlan = ordinary(baseState)
    expect(nextSheet(state, plan, 'target').combat!.currentHp ?? 0)
      .toBeLessThan(nextSheet(baseState, basePlan, 'target').combat!.currentHp ?? 0)
    expect(plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'creature-rule-overlay',
      affected: expect.objectContaining({ placementIds: ['actor'] }),
      payload: expect.objectContaining({ domain: 'type', action: 'replace', values: ['fire'] }),
    }))
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.swift.spent ?? 0).toBe(1)
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('"hasStab":true')
  }, 30_000)

  it('Psionic Screech changes a Flying Move to Psychic, Flinches every hit, and pays Scene x2/Free', () => {
    const state = fixture({
      slug: 'aa084-psionic-screech', actorAbility: 'Psionic Screech',
      move: 'Peck', targetTypes: ['Poison'],
    })
    const plan = complete({
      state,
      optionFor: reason => reason === 'ability.psionic-screech.optional-psychic-type'
        ? 'ability.psionic-screech.psychic'
        : null,
    })
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('"moveType":"Psychic"')
    expect(nextSheet(state, plan, 'target').combat?.conditions).toContain('Flinch')
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Psionic Screech', spent: 1, limit: 2,
    }))
  }, 30_000)

  it('Probability Control durably replaces a selected damage roll rather than merely approximating an accuracy event', () => {
    const rerolledState = fixture({
      slug: 'aa084-probability-control-damage', allyAbility: 'Probability Control',
    })
    const rerolled = complete({
      state: rerolledState,
      values: [0.75, 0, 0, 0.99, 0.99],
      optionFor: (reason, options) => reason === 'ability.probability-control.optional-reroll'
        && options[0]?.id.includes(':tackle.damage:')
        ? options[0].id
        : null,
    })
    const ordinaryState = fixture({
      slug: 'aa084-probability-control-damage-pass', allyAbility: 'Probability Control',
    })
    const ordinaryPlan = complete({
      state: ordinaryState,
      values: [0.75, 0, 0, 0.99, 0.99],
      optionFor: () => null,
    })
    const attempts = rerolled.resolution.rollLedger.filter(roll => (
      roll.parentEffectId === 'tackle.damage'
      || roll.parentEffectId.startsWith('ability.probability-control.request.')
        && roll.reason.startsWith('Probability Control reroll')
    ))
    expect(attempts).toHaveLength(2)
    expect(attempts[1]!.finalValue).toBeGreaterThan(attempts[0]!.finalValue)
    expect(nextSheet(rerolledState, rerolled, 'target').combat!.currentHp ?? 0)
      .toBeLessThan(nextSheet(ordinaryState, ordinaryPlan, 'target').combat!.currentHp ?? 0)
    expect(rerolled.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'roll', reasonCode: 'ability.probability-control.optional-reroll', phase: 'after-damage',
    }))
  }, 30_000)

  it('Probability Control lets an ally replace an accuracy roll, retains both rolls, leaves residue, and pays Scene/Free once', () => {
    const state = fixture({ slug: 'aa084-probability-control', allyAbility: 'Probability Control' })
    let used = false
    const plan = complete({
      state,
      values: [0, 0.95, 0.5],
      optionFor: (reason, options) => {
        if (reason !== 'ability.probability-control.optional-reroll' || used) return null
        used = true
        return options[0]?.id ?? null
      },
    })
    expect(nextSheet(state, plan, 'target').combat!.currentHp).toBeLessThan(300)
    expect(plan.resolution.rollLedger.map(roll => roll.rollId)
      .filter(rollId => rollId.includes('accuracy'))).toHaveLength(2)
    expect(plan.resolution.rollLedger.some(roll => roll.rollId.includes('probability-control'))).toBe(true)
    expect(plan.nextMap.encounterState?.turnResources.ally?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      ownerId: 'ally', canonicalId: 'Probability Control', spent: 1, limit: 1,
    }))
    expect(plan.nextMap.encounterState?.effects.some(effect => (
      effect.tags.includes('psychic-residue') && effect.affected.placementIds.includes('ally')
    ))).toBe(true)
  }, 30_000)
})
