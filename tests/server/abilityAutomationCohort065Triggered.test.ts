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
import { planInitiativeLifecycle } from '../../server/domain/moveAutomation/planInitiativeLifecycle'

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string; move?: string; ability?: string; hp?: number; injuries?: number; gender?: string; stages?: Partial<NonNullable<CharacterSheet['combatStages']>>
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  gender: input.gender ?? 'Male', types: ['Normal'], abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: { hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 }, satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 } },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0, ...input.stages },
  combat: { currentHp: input.hp ?? 150, injuries: input.injuries ?? 0, conditions: [] },
})
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
    { id: 'nearby', sheetKind: 'pokemon', sheetSlug: 'nearby', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5, dimensions: { x: 12, y: 4, z: 8 }, groundLevelY: 0,
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
  slug: string; move: string; actorAbility?: string; targetAbility?: string
  actorGender?: string; targetGender?: string; targetHp?: number; targetInjuries?: number
  random?: number
}) => {
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move: input.move, ability: input.actorAbility, gender: input.actorGender })],
    ['target', sheet({ slug: 'target', ability: input.targetAbility, hp: input.targetHp, injuries: input.targetInjuries, gender: input.targetGender })],
    ['nearby', sheet({ slug: 'nearby', stages: { spd: 2 } })],
  ])
  const declaration = planAuthoritativeMoveStateExecution({
    map: battleMap(input.slug), pokemonSheets, trainerSheets: new Map(),
    intent: { schemaVersion: 1, placementId: 'actor', moveName: input.move, selection: { kind: 'single-target', targetPlacementId: 'target' } },
    random: () => input.random ?? 0.5, now: () => 1_000,
    operationId: `op_${input.slug}`, pendingResolutionId: `resolution:${input.slug}`,
  })
  expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
  if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected an AA-065 response window.')
  return { declaration, pokemonSheets, random: input.random ?? 0.5 }
}
const respond = (input: {
  declared: ReturnType<typeof declare>
  optionId: string | null
  chosenBy: { kind: 'actor'; id: null } | { kind: 'placement'; id: string }
}) => {
  const pending = input.declared.declaration.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending), map: structuredClone(input.declared.declaration.nextMap),
    pokemonSheets: input.declared.pokemonSheets, trainerSheets: new Map(),
    response: { requestId: window.windowId, optionId: input.optionId },
    now: 2_000, random: () => input.declared.random,
  })
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: input.declared.declaration.suspension.preWindowPlan,
    responseOpId: 'op_response_aa065', responseWindowId: window.windowId,
    responseOptionId: input.optionId, chosenBy: input.chosenBy,
    map: input.declared.declaration.nextMap,
    pokemonSheets: input.declared.pokemonSheets, trainerSheets: new Map(), execution, plannedAt: 2_000,
  })
  return { window, execution, plan }
}
const persisted = (result: ReturnType<typeof respond>, slug: string): CharacterSheet | undefined => (
  result.plan.sheetWrites.find(write => write.slug === slug)?.nextSheet as CharacterSheet | undefined
)
const stage = (value: CharacterSheet | undefined, key: 'atk' | 'satk' | 'spd'): number => (
  value?.stats?.[key]?.stage ?? value?.combatStages?.[key] ?? 0
)

describe('AA-065 triggered abilities', () => {
  it('aa065.corrosive-toxins.reviewed spends Scene/Free and applies Toxic through condition immunity', () => {
    const declared = declare({ slug: 'aa065-corrosive', move: 'Toxic', actorAbility: 'Corrosive Toxins', targetAbility: 'Immunity' })
    const selected = respond({ declared, optionId: 'ability.corrosive-toxins.use', chosenBy: { kind: 'actor', id: null } })
    expect(isAuthoritativePendingMoveResolution(selected.execution)).toBe(false)
    expect(persisted(selected, 'target')?.combat?.conditions).toContain('Badly Poisoned')
    expect(selected.plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability', affected: expect.objectContaining({ placementIds: ['target'] }),
      payload: { capabilityId: 'aa065.corrosive-toxins.bad-poison-hp-loss-bypass', action: 'grant' },
    }))
    expect(selected.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(selected.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({ canonicalId: 'Corrosive Toxins', spent: 1 }))

    const declined = declare({ slug: 'aa065-corrosive-pass', move: 'Toxic', actorAbility: 'Corrosive Toxins', targetAbility: 'Immunity' })
    const passed = respond({ declared: declined, optionId: null, chosenBy: { kind: 'actor', id: null } })
    expect(persisted(passed, 'target')?.combat?.conditions ?? []).not.toContain('Badly Poisoned')
    expect(passed.plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(0)

    const protectedTarget = declare({
      slug: 'aa065-corrosive-residual', move: 'Toxic',
      actorAbility: 'Corrosive Toxins', targetAbility: 'Magic Guard',
    })
    const poisoned = respond({
      declared: protectedTarget,
      optionId: 'ability.corrosive-toxins.use',
      chosenBy: { kind: 'actor', id: null },
    })
    const lifecycleSheets = new Map(protectedTarget.pokemonSheets)
    for (const write of poisoned.plan.sheetWrites) {
      if (write.kind === 'pokemon') lifecycleSheets.set(write.slug, write.nextSheet as CharacterSheet)
    }
    const lifecycle = planInitiativeLifecycle({
      map: poisoned.plan.nextMap,
      previous: { activeId: 'target', round: 1 },
      current: { activeId: 'nearby', round: 1 },
      orderIds: ['actor', 'target', 'nearby'],
      operationId: 'op_aa065_corrosive_turn_end', time: 3_000,
      loadSheets: () => ({ pokemonSheets: lifecycleSheets, trainerSheets: new Map() }),
    })
    expect((lifecycle.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet)
      .combat?.currentHp).toBe(145)
    expect(lifecycle.currentEncounterState.effects).toContainEqual(expect.objectContaining({
      payload: { capabilityId: 'aa065.corrosive-toxins.bad-poison-hp-loss-bypass', action: 'grant' },
      stacks: 2,
    }))
  }, 20_000)

  it('aa065.cotton-down.reviewed lowers Speed and Slows every Pokémon in authoritative Burst 1', () => {
    const declared = declare({ slug: 'aa065-cotton-down', move: 'Ember', targetAbility: 'Cotton Down' })
    const selected = respond({ declared, optionId: 'ability.cotton-down.use', chosenBy: { kind: 'placement', id: 'target' } })
    expect(stage(persisted(selected, 'actor'), 'spd')).toBe(-1)
    expect(stage(persisted(selected, 'target'), 'spd')).toBe(-1)
    expect(stage(persisted(selected, 'nearby'), 'spd')).toBe(-1)
    const slowed = selected.plan.nextMap.encounterState?.effects.filter(effect => (
      effect.kind === 'condition' && effect.payload.conditionId === 'slowed'
    )) ?? []
    expect(slowed).toHaveLength(3)
    expect(slowed.every(effect => effect.source.placementId === 'target')).toBe(true)
    expect(selected.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
  }, 20_000)

  it('aa065.cruelty.reviewed exposes only injury-budgeted choices and applies the selected purchases atomically', () => {
    const declared = declare({ slug: 'aa065-cruelty', move: 'Ember', actorAbility: 'Cruelty', targetHp: 150, targetInjuries: 4 })
    const window = declared.declaration.suspension.pendingResolution.outstandingWindows[0]!
    expect(window.options).toContainEqual(expect.objectContaining({ id: 'ability.cruelty.hp-1.slow-1.block-1' }))
    expect(window.options).not.toContainEqual(expect.objectContaining({ id: 'ability.cruelty.hp-10.slow-1.block-1' }))
    const beforeHp = declared.pokemonSheets.get('target')!.combat!.currentHp ?? 0
    const selected = respond({
      declared, optionId: 'ability.cruelty.hp-1.slow-1.block-1', chosenBy: { kind: 'actor', id: null },
    })
    const target = persisted(selected, 'target')!
    expect(target.combat?.injuries).toBeGreaterThanOrEqual(5)
    expect(target.combat?.currentHp).toBeLessThan(beforeHp - 2)
    expect(target.combat?.conditions).toContain('Slowed')
    expect(selected.plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability', payload: { capabilityId: 'aa065.cruelty.healing-blocked', action: 'grant' },
    }))
    expect(selected.plan.nextMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
  }, 20_000)


  it('aa065.cursed-body.reviewed disables the triggering Move and aa065.cute-tears.reviewed lowers its attack stat', () => {
    const cursed = declare({ slug: 'aa065-cursed-body', move: 'Ember', targetAbility: 'Cursed Body' })
    const disabled = respond({ declared: cursed, optionId: 'ability.cursed-body.use', chosenBy: { kind: 'placement', id: 'target' } })
    expect(persisted(disabled, 'actor')?.combat?.conditions).toContain('Disabled: Ember')

    const tears = declare({ slug: 'aa065-cute-tears', move: 'Ember', targetAbility: 'Cute Tears' })
    const lowered = respond({ declared: tears, optionId: 'ability.cute-tears.use', chosenBy: { kind: 'placement', id: 'target' } })
    expect(stage(persisted(lowered, 'actor'), 'satk')).toBe(-2)
  }, 30_000)

  it('aa065.cute-charm.reviewed triggers on an opposite-gender foe melee attack even when it misses', () => {
    const declared = declare({
      slug: 'aa065-cute-charm', move: 'Pound', targetAbility: 'Cute Charm',
      actorGender: 'Male', targetGender: 'Female', random: 0,
    })
    const selected = respond({ declared, optionId: 'ability.cute-charm.use', chosenBy: { kind: 'placement', id: 'target' } })
    expect(persisted(selected, 'actor')?.combat?.conditions).toContain('Infatuation: target')
  }, 20_000)
})
