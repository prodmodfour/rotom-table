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

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: { slug: string; move?: string; ability?: string; hp?: number; types?: string[] }): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  types: input.types ?? ['Normal'], abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: { hp: { added: 25 }, atk: { added: 45 }, def: { added: 8 }, satk: { added: 30 }, sdef: { added: 8 }, spd: { added: 20 } },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.hp ?? 100, injuries: 0, conditions: [] },
})
const map = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5, dimensions: { x: 10, y: 4, z: 6 }, groundLevelY: 0,
    playerVisible: true, voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' }, foes: { id: 'foes', label: 'Foes', status: 'active' } },
      history: { ...encounter.history, sceneId: `scene:${slug}` },
      turnResources: Object.fromEntries(placements.map(placement => [placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 })])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
const declare = (input: {
  slug: string; move: string; actorAbility?: string; targetAbility?: string; targetHp?: number; random?: number
}) => {
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move: input.move, ability: input.actorAbility })],
    ['target', sheet({ slug: 'target', ability: input.targetAbility, hp: input.targetHp, move: 'Tackle' })],
  ])
  const declaration = planAuthoritativeMoveStateExecution({
    map: map(input.slug), pokemonSheets, trainerSheets: new Map(),
    intent: { schemaVersion: 1, placementId: 'actor', moveName: input.move, selection: { kind: 'single-target', targetPlacementId: 'target' } },
    random: () => input.random ?? 0.5, now: () => 1_000,
    operationId: `op_${input.slug}`, pendingResolutionId: `resolution:${input.slug}`,
  })
  expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
  if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected an AA-064 response window.')
  return { declaration, pokemonSheets, random: input.random ?? 0.5 }
}
const respond = (input: {
  pending: ReturnType<typeof declare>['declaration']['suspension']['pendingResolution']
  declarationPlan: ReturnType<typeof declare>['declaration']['suspension']['preWindowPlan']
  map: TabletopMap
  pokemonSheets: ReadonlyMap<string, CharacterSheet>
  optionId: string | null
  chosenBy: { kind: 'actor'; id: null } | { kind: 'placement'; id: string }
  random: number
  sequence: number
}) => {
  const window = input.pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(input.pending), map: structuredClone(input.map),
    pokemonSheets: input.pokemonSheets, trainerSheets: new Map(),
    response: { requestId: window.windowId, optionId: input.optionId },
    now: 1_000 + input.sequence * 1_000, random: () => input.random,
  })
  const plan = planResumedMoveState({
    pendingResolution: input.pending, declarationPlan: input.declarationPlan,
    responseOpId: `op_response_${input.sequence}`, responseWindowId: window.windowId,
    responseOptionId: input.optionId, chosenBy: input.chosenBy,
    map: input.map, pokemonSheets: input.pokemonSheets, trainerSheets: new Map(), execution,
    plannedAt: 1_000 + input.sequence * 1_000,
  })
  return { window, execution, plan }
}
const stage = (value: CharacterSheet, key: 'atk' | 'satk' | 'spd' | 'def'): number => (
  value.stats?.[key]?.stage ?? value.combatStages?.[key] ?? 0
)

describe('AA-064 triggered abilities', () => {
  it('does not open Color Change, Combo Striker, or Conqueror windows when their server facts fail', () => {
    const immediate = (input: { slug: string; move: string; actorAbility?: string; targetAbility?: string; targetHp?: number; random: number }) => {
      const pokemonSheets = new Map<string, CharacterSheet>([
        ['actor', sheet({ slug: 'actor', move: input.move, ability: input.actorAbility })],
        ['target', sheet({ slug: 'target', ability: input.targetAbility, hp: input.targetHp })],
      ])
      return planAuthoritativeMoveStateExecution({
        map: map(input.slug), pokemonSheets, trainerSheets: new Map(),
        intent: { schemaVersion: 1, placementId: 'actor', moveName: input.move, selection: { kind: 'single-target', targetPlacementId: 'target' } },
        random: () => input.random, now: () => 1_000, operationId: `op_${input.slug}`,
      })
    }
    expect(isAuthoritativePendingMoveStatePlan(immediate({
      slug: 'color-change-miss', move: 'Ember', targetAbility: 'Color Change', random: 0,
    }))).toBe(false)
    expect(isAuthoritativePendingMoveStatePlan(immediate({
      slug: 'combo-roll-fail', move: 'Tackle', actorAbility: 'Combo Striker', random: 0.1,
    }))).toBe(false)
    expect(isAuthoritativePendingMoveStatePlan(immediate({
      slug: 'conqueror-no-ko', move: 'Tackle', actorAbility: 'Conqueror', targetHp: 300, random: 0.5,
    }))).toBe(false)
  }, 20_000)
  it('aa064.color-change.reviewed lets the hit defender spend Free to replace its Type for the Scene', () => {
    const declared = declare({ slug: 'aa064-color-change', move: 'Ember', targetAbility: 'Color Change', random: 0.5 })
    const selected = respond({
      pending: declared.declaration.suspension.pendingResolution,
      declarationPlan: declared.declaration.suspension.preWindowPlan,
      map: declared.declaration.nextMap, pokemonSheets: declared.pokemonSheets,
      optionId: 'ability.color-change.use', chosenBy: { kind: 'placement', id: 'target' }, random: declared.random, sequence: 1,
    })
    expect(isAuthoritativePendingMoveResolution(selected.execution)).toBe(false)
    expect(selected.plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'creature-rule-overlay', affected: expect.objectContaining({ placementIds: ['target'] }),
      duration: { kind: 'scene', remaining: null },
      payload: expect.objectContaining({ domain: 'type', action: 'replace', values: ['fire'] }),
    }))
    expect(selected.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)

    const passed = declare({ slug: 'aa064-color-change-pass', move: 'Ember', targetAbility: 'Color Change', random: 0.5 })
    const pass = respond({
      pending: passed.declaration.suspension.pendingResolution,
      declarationPlan: passed.declaration.suspension.preWindowPlan,
      map: passed.declaration.nextMap, pokemonSheets: passed.pokemonSheets,
      optionId: null, chosenBy: { kind: 'placement', id: 'target' }, random: passed.random, sequence: 1,
    })
    expect(pass.plan.nextMap.encounterState?.effects.some(effect => effect.tags.includes('color-change'))).toBe(false)
    expect(pass.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(0)
  }, 20_000)

  it('aa064.conqueror.reviewed raises Attack, Special Attack, and Speed after a foe KO and spends Scene/Free', () => {
    const declared = declare({ slug: 'aa064-conqueror', move: 'Tackle', actorAbility: 'Conqueror', targetHp: 1, random: 0.5 })
    const selected = respond({
      pending: declared.declaration.suspension.pendingResolution,
      declarationPlan: declared.declaration.suspension.preWindowPlan,
      map: declared.declaration.nextMap, pokemonSheets: declared.pokemonSheets,
      optionId: 'ability.conqueror.use', chosenBy: { kind: 'actor', id: null }, random: declared.random, sequence: 1,
    })
    expect(isAuthoritativePendingMoveResolution(selected.execution)).toBe(false)
    const actor = selected.plan.sheetWrites.find(write => write.slug === 'actor')?.nextSheet as CharacterSheet
    expect([stage(actor, 'atk'), stage(actor, 'satk'), stage(actor, 'spd')]).toEqual([1, 1, 1])
    expect(selected.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(selected.plan.nextMap.encounterState?.abilityUsage?.entries[0]).toMatchObject({ canonicalId: 'Conqueror', spent: 1 })
  }, 20_000)

  it('aa064.copy-master.reviewed grants Copycat and requires a durable Stat choice after Mimic', () => {
    const actor = sheet({ slug: 'actor', move: 'Mimic', ability: 'Copy Master' })
    const target = sheet({ slug: 'target', move: 'Tackle' })
    const context = buildAuthoritativeMoveRulesContext({
      map: map('aa064-copy-master-connection'), pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Copycat', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      selectedPlacementIds: ['target'], random: () => 0.5, time: 1_000,
    })
    expect(context.queries.resolveActorMoveEntry('Copycat')).toMatchObject({ ok: true })

    const declared = declare({ slug: 'aa064-copy-master', move: 'Mimic', actorAbility: 'Copy Master', random: 0.5 })
    const window = declared.declaration.suspension.pendingResolution.outstandingWindows[0]!
    expect(window).toMatchObject({ kind: 'choice', allowPass: false })
    const selected = respond({
      pending: declared.declaration.suspension.pendingResolution,
      declarationPlan: declared.declaration.suspension.preWindowPlan,
      map: declared.declaration.nextMap, pokemonSheets: declared.pokemonSheets,
      optionId: 'ability.copy-master.defense', chosenBy: { kind: 'actor', id: null }, random: declared.random, sequence: 1,
    })
    expect(isAuthoritativePendingMoveResolution(selected.execution)).toBe(false)
    const next = selected.plan.sheetWrites.find(write => write.slug === 'actor')?.nextSheet as CharacterSheet
    expect(stage(next, 'def')).toBe(1)
  }, 20_000)

  it('aa064.combo-striker.reviewed uses the authoritative natural roll and allows Struggle to trigger recursively', () => {
    const declared = declare({ slug: 'aa064-combo-striker', move: 'Tackle', actorAbility: 'Combo Striker', random: 0.45 })
    const first = respond({
      pending: declared.declaration.suspension.pendingResolution,
      declarationPlan: declared.declaration.suspension.preWindowPlan,
      map: declared.declaration.nextMap, pokemonSheets: declared.pokemonSheets,
      optionId: 'ability.combo-striker.use', chosenBy: { kind: 'actor', id: null }, random: declared.random, sequence: 1,
    })
    expect(isAuthoritativePendingMoveStatePlan(first.plan)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(first.plan)) throw new Error('Expected nested Struggle target choice.')
    const targetWindow = first.plan.suspension.pendingResolution.outstandingWindows[0]!
    const targetOption = targetWindow.options[0]!.id
    const second = respond({
      pending: first.plan.suspension.pendingResolution,
      declarationPlan: first.plan.suspension.preWindowPlan,
      map: first.plan.nextMap, pokemonSheets: declared.pokemonSheets,
      optionId: targetOption, chosenBy: { kind: 'actor', id: null }, random: declared.random, sequence: 2,
    })
    expect(isAuthoritativePendingMoveStatePlan(second.plan)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(second.plan)) throw new Error('Expected recursive Combo Striker response.')
    expect(second.plan.suspension.pendingResolution.outstandingWindows[0]?.reasonCode)
      .toBe('ability.combo-striker.optional-struggle')
  }, 30_000)
})
