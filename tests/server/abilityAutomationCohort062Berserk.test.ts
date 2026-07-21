import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createMoveAutomationCombatStageUpdateAccumulator } from '~/utils/moveAutomationStatusUpdates'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { applyAa062BerserkCoreTriggers } from '../../server/domain/abilityAutomation/mechanics/aa062TriggeredIntegration'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const actor = (): CharacterSheet => ({
  slug: 'attacker', nickname: 'Attacker', species: 'Charizard', level: 30, revision: 3,
  types: ['Fire'], abilities: [], movelist: [{ name: 'Dragon Rage' }],
  stats: { hp: { added: 30 }, satk: { added: 30 }, def: { added: 20 }, sdef: { added: 20 } },
  combat: { currentHp: 100, conditions: [] },
})
const target = (withAbility = true): CharacterSheet => ({
  slug: withAbility ? 'berserk' : 'plain', nickname: 'Target', species: 'Drampa', level: 30, revision: 3,
  types: ['Normal', 'Dragon'], abilities: withAbility ? [{
    name: 'Berserk', automation: {
      schemaVersion: 1, instanceId: 'base:berserk', canonicalId: 'Berserk', definitionVersion: null, selections: [],
    },
  }] : [], movelist: [],
  stats: { hp: { added: 40 }, satk: { added: 25, stage: 0 }, def: { added: 20 }, sdef: { added: 20 } },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 60, conditions: [] },
})
const map = (targetSlug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'aa062-berserk', name: 'Berserk', revision: 5,
    dimensions: { x: 8, y: 4, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'attacker', position: { x: 1, y: 0, z: 1 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: targetSlug, position: { x: 3, y: 0, z: 1 } },
    ],
    encounterState: { ...encounter, history: { ...encounter.history, sceneId: 'scene:berserk' } },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
const context = (targetSheet: CharacterSheet) => buildAuthoritativeMoveRulesContext({
  map: map(targetSheet.slug), pokemonSheets: new Map([['attacker', actor()], [targetSheet.slug, targetSheet]]), trainerSheets: new Map(),
  intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Dragon Rage', selection: { kind: 'single-target', targetPlacementId: 'target' } },
  selectedPlacementIds: ['target'], random: () => 0.5, time: 1_000,
})

describe('AA-062 Berserk', () => {
  it('aa062.berserk.threshold-or-enraged raises Special Attack and records the first half-HP crossing', () => {
    const targetSheet = target()
    const probe = context(targetSheet)
    const maximumHp = probe.queries.tokens.get('target')!.maxHp
    targetSheet.combat!.currentHp = Math.floor(maximumHp * 0.51)
    const plan = planAuthoritativeMoveState({
      map: map(targetSheet.slug), pokemonSheets: new Map([['attacker', actor()], [targetSheet.slug, targetSheet]]), trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Dragon Rage', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.5, now: () => 1_000, operationId: 'op_berserk_half',
    })
    const write = plan.sheetWrites.find(entry => entry.slug === targetSheet.slug)!
    expect((write.nextSheet as CharacterSheet).stats?.satk?.stage).toBe(1)
    expect(plan.nextMap.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Berserk', payload: { kind: 'mark', markId: 'aa062.berserk.half-triggered' },
    }))
  }, 20_000)

  it('raises Special Attack when Enraged becomes present and ignores an already-present condition', () => {
    const targetSheet = target()
    const moveContext = context(targetSheet)
    const accumulator = createMoveAutomationCombatStageUpdateAccumulator()
    const applied = applyAa062BerserkCoreTriggers({
      context: moveContext, hpUpdates: [],
      conditionUpdates: [{ id: 'target', conditions: ['Rage'] }],
      stageAccumulator: accumulator,
      encounterState: moveContext.map.encounterState!,
    })
    expect(applied.triggeredPlacementIds).toEqual(['target'])
    expect(accumulator.toUpdates()).toContainEqual(expect.objectContaining({ id: 'target', stages: expect.objectContaining({ satk: 1 }) }))
    const already = target()
    already.combat!.conditions = ['Rage']
    const alreadyContext = context(already)
    const noOp = createMoveAutomationCombatStageUpdateAccumulator()
    expect(applyAa062BerserkCoreTriggers({
      context: alreadyContext, hpUpdates: [], conditionUpdates: [{ id: 'target', conditions: ['Rage'] }],
      stageAccumulator: noOp, encounterState: alreadyContext.map.encounterState!,
    }).triggeredPlacementIds).toEqual([])
  })
})
