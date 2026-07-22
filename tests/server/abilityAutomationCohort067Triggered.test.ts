import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
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
import { aa067DelayedReactionSplit } from '../../server/domain/abilityAutomation/mechanics/aa067StaticIntegration'

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  move?: string
  ability?: string
  moves?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  gender: 'Male', types: ['Normal'], abilities: input.ability ? [ability(input.ability)] : [],
  movelist: (input.moves ?? (input.move ? [input.move] : [])).map(name => ({ name })),
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [] },
})
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5,
    dimensions: { x: 10, y: 4, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history, sceneId: `scene:${slug}`, currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id, createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
const planDeclaration = (input: {
  slug: string
  ability: string
  targetMoves?: readonly string[]
  spent?: number
  suppressed?: boolean
  stoneTerrain?: boolean
}) => {
  const target = sheet({ slug: 'target', ability: input.ability, moves: input.targetMoves })
  if (input.spent) target.abilityUsage = {
    schemaVersion: 1, dayKey: 'campaign-day:test', entries: [{
      ownerId: 'sheet:pokemon:target', abilityInstanceId: `base:${input.ability}`,
      canonicalId: input.ability, clauseId: 'base', limit: 1, spent: input.spent,
      operationIds: Array.from({ length: input.spent }, (_, index) => `op_prior_${index}`),
    }],
  }
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move: 'Tackle' })], ['target', target],
  ])
  const map = battleMap(input.slug)
  if (input.suppressed) map.encounterState = {
    ...map.encounterState!,
    effects: [parseEncounterEffect({
      id: `suppress.${input.ability.toLowerCase().replaceAll(' ', '-')}`,
      kind: 'creature-rule-overlay',
      source: { operationId: 'op_suppress', moveId: 'ability.suppression', placementId: 'actor' },
      affected: { placementIds: ['target'], sideIds: [], cells: [] },
      createdRound: 1, createdTurn: 1, duration: { kind: 'scene', remaining: null },
      stacks: 1, charges: null, stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null }, tags: ['test', 'suppression'],
      payload: {
        domain: 'ability', action: 'suppress', values: [input.ability],
        referencePlacementId: null, suppressionScope: 'listed',
      },
      dispel: { policy: 'matching-tags', tags: ['suppression'] },
      transferPolicy: 'retain', suppression: { sources: [] },
    })],
  }
  if (input.stoneTerrain) {
    map.placements = map.placements.map(placement => placement.id === 'target'
      ? { ...placement, position: { ...placement.position, y: 1 } }
      : placement)
    map.voxels = [{ x: 2, y: 0, z: 1, materialId: 'cave_stone' }]
  }
  const result = planAuthoritativeMoveStateExecution({
    map, pokemonSheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: () => 0.5, now: () => 1_000,
    operationId: `op_${input.slug}`, pendingResolutionId: `resolution:${input.slug}`,
  })
  return { result, pokemonSheets }
}
const declaration = (input: Parameters<typeof planDeclaration>[0]) => {
  const planned = planDeclaration(input)
  if (!isAuthoritativePendingMoveStatePlan(planned.result)) {
    throw new Error(`Expected ${input.ability} response window.`)
  }
  return { declaration: planned.result, pokemonSheets: planned.pokemonSheets }
}
const respond = (input: {
  declared: ReturnType<typeof declaration>
  optionId: string | null
  suffix: string
}) => {
  const pending = input.declared.declaration.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending),
    map: structuredClone(input.declared.declaration.nextMap),
    pokemonSheets: input.declared.pokemonSheets, trainerSheets: new Map(),
    response: { requestId: window.windowId, optionId: input.optionId },
    now: 2_000, random: () => 0.5,
  })
  if (isAuthoritativePendingMoveResolution(execution)) throw new Error('Expected one-window completion.')
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: input.declared.declaration.suspension.preWindowPlan,
    responseOpId: `op_response_${input.suffix}`,
    responseWindowId: window.windowId, responseOptionId: input.optionId,
    chosenBy: { kind: 'placement', id: 'target' },
    map: input.declared.declaration.nextMap,
    pokemonSheets: input.declared.pokemonSheets, trainerSheets: new Map(),
    execution, plannedAt: 2_000,
  })
  return { plan, execution, window }
}
const writtenSheet = (plan: ReturnType<typeof planResumedMoveState>, slug: string): CharacterSheet => (
  plan.sheetWrites.find(write => write.slug === slug)?.nextSheet as CharacterSheet
)
const native = (execution: ReturnType<typeof respond>['execution']) => {
  if (!execution.nativeV2) throw new Error('Expected a native v2 resolution.')
  return execution.nativeV2
}
const stage = (value: CharacterSheet, key: 'atk' | 'def' | 'satk' | 'sdef' | 'spd'): number => (
  value.stats?.[key]?.stage ?? value.combatStages?.[key] ?? 0
)

describe('AA-067 triggered abilities', () => {
  it('aa067.delayed-reaction.reviewed floors the immediate half and loses the exact remainder at next turn end', () => {
    expect(aa067DelayedReactionSplit(11)).toEqual({ immediate: 5, deferred: 6 })
    const declared = declaration({ slug: 'aa067-delayed', ability: 'Delayed Reaction' })
    expect(declared.declaration.suspension.pendingResolution.outstandingWindows[0]?.options)
      .toContainEqual(expect.objectContaining({ id: 'ability.delayed-reaction.use' }))
    const selected = respond({
      declared, optionId: 'ability.delayed-reaction.use', suffix: 'aa067_delayed',
    })
    const afterHit = writtenSheet(selected.plan, 'target')
    expect(afterHit.combat!.currentHp).toBeLessThan(150)
    expect(150 - Number(afterHit.combat?.currentHp)).toBe(8)
    expect(selected.plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability',
      payload: expect.objectContaining({ capabilityId: 'aa067.delayed-reaction.hp-loss', value: 9 }),
      affected: expect.objectContaining({ placementIds: ['target'] }),
    }))
    expect(selected.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Delayed Reaction', spent: 1,
    }))

    const sheetsAfterHit = new Map(declared.pokemonSheets)
    sheetsAfterHit.set('target', afterHit)
    const targetStarts = planInitiativeLifecycle({
      map: selected.plan.nextMap,
      previous: { activeId: 'actor', round: 1 }, current: { activeId: 'target', round: 1 },
      orderIds: ['actor', 'target'], operationId: 'op_aa067_delayed_target_start', time: 3_000,
      loadSheets: () => ({ pokemonSheets: sheetsAfterHit, trainerSheets: new Map() }),
    })
    expect(targetStarts.currentEncounterState.effects.some(effect => (
      effect.kind === 'capability' && effect.payload.capabilityId === 'aa067.delayed-reaction.hp-loss'
    ))).toBe(true)
    const targetEnds = planInitiativeLifecycle({
      map: targetStarts.nextMap,
      previous: { activeId: 'target', round: 1 }, current: { activeId: 'actor', round: 2 },
      orderIds: ['actor', 'target'], operationId: 'op_aa067_delayed_target_end', time: 4_000,
      loadSheets: () => ({ pokemonSheets: sheetsAfterHit, trainerSheets: new Map() }),
    })
    const deferred = targetEnds.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(Number(deferred.combat?.currentHp)).toBe(Number(afterHit.combat?.currentHp) - 9)
    expect(targetEnds.currentEncounterState.effects.some(effect => (
      effect.kind === 'capability' && effect.payload.capabilityId === 'aa067.delayed-reaction.hp-loss'
    ))).toBe(false)
  }, 30_000)

  it('aa067.disguise.reviewed makes the damaging Move miss, spends Daily/Free, and raises only the chosen Stage', () => {
    const declared = declaration({ slug: 'aa067-disguise', ability: 'Disguise' })
    const selected = respond({
      declared, optionId: 'ability.disguise.attack', suffix: 'aa067_disguise',
    })
    const target = writtenSheet(selected.plan, 'target')
    expect(target.combat!.currentHp).toBe(150)
    expect(stage(target, 'atk')).toBe(1)
    expect(stage(target, 'def')).toBe(0)
    expect(target.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Disguise', spent: 1, limit: 1,
    }))
    expect(selected.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(native(selected.execution).dynamicRecipients.missedTargetIds).toContain('target')
    expect(native(selected.execution).dynamicRecipients.hitTargetIds).not.toContain('target')
  }, 30_000)

  it('aa067.dodge.reviewed makes the damaging Move miss with no added Stage and supports pass', () => {
    const declared = declaration({ slug: 'aa067-dodge', ability: 'Dodge' })
    const selected = respond({ declared, optionId: 'ability.dodge.use', suffix: 'aa067_dodge' })
    const target = writtenSheet(selected.plan, 'target')
    expect(target.combat!.currentHp).toBe(150)
    expect(target.abilityUsage?.entries).toContainEqual(expect.objectContaining({ canonicalId: 'Dodge', spent: 1 }))
    expect(native(selected.execution).dynamicRecipients.missedTargetIds).toContain('target')

    const passed = respond({
      declared: declaration({ slug: 'aa067-dodge-pass', ability: 'Dodge' }),
      optionId: null, suffix: 'aa067_dodge_pass',
    })
    expect(writtenSheet(passed.plan, 'target').combat!.currentHp).toBeLessThan(150)
    expect(writtenSheet(passed.plan, 'target').abilityUsage?.entries ?? []).toHaveLength(0)
    expect(isAuthoritativePendingMoveStatePlan(planDeclaration({
      slug: 'aa067-dodge-spent', ability: 'Dodge', spent: 1,
    }).result)).toBe(false)
    expect(isAuthoritativePendingMoveStatePlan(planDeclaration({
      slug: 'aa067-dodge-suppressed', ability: 'Dodge', suppressed: true,
    }).result)).toBe(false)
  }, 30_000)

  it('aa067.dig-away.reviewed interrupts any Move hit with frequency-legal Dig and spends Daily/Free', () => {
    const declared = declaration({ slug: 'aa067-dig-away', ability: 'Dig Away', targetMoves: ['Dig'] })
    const selected = respond({ declared, optionId: 'ability.dig-away.use', suffix: 'aa067_dig_away' })
    const target = writtenSheet(selected.plan, 'target')
    expect(target.combat!.currentHp).toBe(150)
    expect(target.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Dig Away', spent: 1,
    }))
    expect(selected.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(selected.plan.nextMap.encounterState?.turnResources.target?.actions.standard.spent).toBe(1)
    expect(selected.plan.nextMap.moveUsage?.byPlacementId.target?.dig?.uses).toBe(1)
    expect(native(selected.execution).dynamicRecipients.missedTargetIds).toContain('target')
    expect(native(selected.execution).childExecutions).toContainEqual(expect.objectContaining({
      canonicalId: 'Dig', actorPlacementId: 'target',
    }))
    expect(isAuthoritativePendingMoveStatePlan(planDeclaration({
      slug: 'aa067-dig-away-stone', ability: 'Dig Away', targetMoves: ['Dig'], stoneTerrain: true,
    }).result)).toBe(false)
  }, 30_000)
})
