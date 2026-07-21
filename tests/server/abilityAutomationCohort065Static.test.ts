import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { aa060TriggeredMoveOverlayOperations } from '../../server/domain/abilityAutomation/mechanics/aa060TriggeredMoveIntegration'
import {
  aa065CovertEvasionBonus,
  aa065DampCancelsMove,
  cleanupAa065CrueltyHealingBlockForBreather,
} from '../../server/domain/abilityAutomation/mechanics/aa065StaticIntegration'
import { planAuthoritativeMoveSwitch } from '../../server/domain/moveAutomation/planMoveSwitch'
import {
  capabilityEncounterEffectFixture,
  creatureRuleOverlayEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: { slug: string; move?: string; ability?: string; hp?: number }): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  types: ['Normal'], abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: { hp: { added: 25 }, atk: { added: 35 }, def: { added: 15 }, satk: { added: 20 }, sdef: { added: 15 }, spd: { added: 20 } },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.hp ?? 100, injuries: 0, conditions: [] },
})
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
    { id: 'provider', sheetKind: 'pokemon', sheetSlug: 'provider', sideId: 'foes', position: { x: 3, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5, dimensions: { x: 20, y: 4, z: 8 }, groundLevelY: 0,
    playerVisible: true, voxels: [{ x: 2, y: 0, z: 1, materialId: 'meadow_grass' }],
    hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' }, foes: { id: 'foes', label: 'Foes', status: 'active' } },
      history: { ...encounter.history, sceneId: `scene:${slug}` },
      turnResources: Object.fromEntries(placements.map(placement => [placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 })])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 1 },
  }
}
const context = (input: { slug: string; actorAbility?: string; targetAbility?: string; providerAbility?: string; targetHp?: number; map?: TabletopMap }) => {
  const map = input.map ?? battleMap(input.slug)
  return buildAuthoritativeMoveRulesContext({
    map,
    pokemonSheets: new Map([
      ['actor', sheet({ slug: 'actor', move: 'Ember', ability: input.actorAbility, hp: 10 })],
      ['target', sheet({ slug: 'target', ability: input.targetAbility, hp: input.targetHp ?? 10 })],
      ['provider', sheet({ slug: 'provider', ability: input.providerAbility })],
    ]),
    trainerSheets: new Map(),
    intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Ember', selection: { kind: 'single-target', targetPlacementId: 'target' } },
    selectedPlacementIds: ['target'], random: () => 0.5, time: 1_000,
  })
}
const targetHpAfterTackle = (input: { slug: string; actorAbility?: string; targetAbility?: string }): number => {
  const map = battleMap(input.slug)
  map.placements = map.placements.filter(placement => placement.id !== 'provider')
  const result = planAuthoritativeMoveState({
    map,
    pokemonSheets: new Map([
      ['actor', sheet({ slug: 'actor', move: 'Ember', ability: input.actorAbility, hp: 10 })],
      ['target', sheet({ slug: 'target', ability: input.targetAbility, hp: 10 })],
    ]),
    trainerSheets: new Map(),
    intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Ember', selection: { kind: 'single-target', targetPlacementId: 'target' } },
    random: () => 0.5, now: () => 1_000, operationId: `op_${input.slug}`,
  })
  const write = result.sheetWrites.find(entry => entry.slug === 'target')?.nextSheet as CharacterSheet | undefined
  return write?.combat?.currentHp ?? 10
}

describe('AA-065 static abilities', () => {
  it('aa065.courage.reviewed adds +5 outgoing damage and 5 incoming reduction only at one-third HP', () => {
    const baseline = targetHpAfterTackle({ slug: 'aa065-courage-base' })
    const outgoing = targetHpAfterTackle({ slug: 'aa065-courage-outgoing', actorAbility: 'Courage' })
    const reduced = targetHpAfterTackle({ slug: 'aa065-courage-reduced', targetAbility: 'Courage' })
    expect(outgoing).toBe(baseline - 5)
    expect(reduced).toBe(Math.min(10, baseline + 5))
  })

  it('aa065.covert.reviewed derives +2 Evasion from authoritative habitat material and honors suppression', () => {
    const active = context({ slug: 'aa065-covert', targetAbility: 'Covert' })
    expect(aa065CovertEvasionBonus({ context: active, placementId: 'target' })).toBe(2)

    const offTerrain = battleMap('aa065-covert-off-terrain')
    offTerrain.voxels = [{ x: 2, y: 0, z: 1, materialId: 'airship_floor_metal' }]
    expect(aa065CovertEvasionBonus({
      context: context({ slug: 'aa065-covert-off-terrain', targetAbility: 'Covert', map: offTerrain }),
      placementId: 'target',
    })).toBe(2) // Eevee's canonical Urban habitat includes constructed floors.

    const unmatched = battleMap('aa065-covert-unmatched')
    unmatched.voxels = [{ x: 2, y: 0, z: 1, materialId: 'deep_water' }]
    expect(aa065CovertEvasionBonus({
      context: context({ slug: 'aa065-covert-unmatched', targetAbility: 'Covert', map: unmatched }),
      placementId: 'target',
    })).toBe(0)

    const suppressed = battleMap('aa065-covert-suppressed')
    suppressed.encounterState = {
      ...suppressed.encounterState!,
      effects: [{
        ...creatureRuleOverlayEncounterEffectFixture({
          domain: 'ability', action: 'suppress', values: ['Covert'],
          referencePlacementId: null, suppressionScope: 'listed',
        }),
        affected: { placementIds: ['target'], sideIds: [], cells: [] },
      }],
    }
    expect(aa065CovertEvasionBonus({
      context: context({ slug: 'aa065-covert-suppressed', targetAbility: 'Covert', map: suppressed }),
      placementId: 'target',
    })).toBe(0)
  })

  it('aa065.cruelty.reviewed ends its healing block on Take a Breather or switch-out', () => {
    const map = battleMap('aa065-cruelty-lifecycle')
    map.encounterState = {
      ...map.encounterState!,
      effects: [{
        ...capabilityEncounterEffectFixture(),
        id: 'ability.cruelty.healing-block.target',
        affected: { placementIds: ['target'], sideIds: [], cells: [] },
        duration: { kind: 'scene', remaining: null },
        payload: { capabilityId: 'aa065.cruelty.healing-blocked', action: 'grant' },
        tags: ['ability', 'aa065', 'cruelty', 'healing-blocked'],
        transferPolicy: 'expire',
      }],
    }
    const afterBreather = cleanupAa065CrueltyHealingBlockForBreather({ map, placementId: 'target' })
    expect(afterBreather.encounterState?.effects).toEqual([])

    const afterSwitch = planAuthoritativeMoveSwitch({
      map,
      transition: {
        kind: 'recall-only', operationId: 'op_aa065_cruelty_switch',
        recalledPlacementId: 'target', stateTransferPolicy: 'none',
      },
    }).nextMap
    expect(afterSwitch.encounterState?.effects).toEqual([])
  })

  it('aa065.damp.reviewed cancels nearby Explosion/Self-Destruct and prevents an Aftermath window', () => {
    const active = context({ slug: 'aa065-damp', targetAbility: 'Aftermath', providerAbility: 'Damp' })
    expect(aa065DampCancelsMove({ context: active, script: { moveName: 'Explosion' } })).toBe(true)
    expect(aa065DampCancelsMove({ context: active, script: { moveName: 'Tackle' } })).toBe(false)
    const ember = active.queries.resolveActorMoveEntry('Ember')
    if (!ember.ok) throw new Error('Missing Ember')
    expect(aa060TriggeredMoveOverlayOperations({
      context: active,
      script: ember.entry.script,
      moveSourceId: 'move.ember', authoritativeTargetIds: ['target'],
    }).some(operation => operation.reasonCode === 'ability.aftermath.optional-hp-loss')).toBe(false)

    const map = battleMap('aa065-damp-explosion')
    map.placements = map.placements.filter(placement => placement.id !== 'provider')
    const result = planAuthoritativeMoveState({
      map,
      pokemonSheets: new Map([
        ['actor', sheet({ slug: 'actor', move: 'Explosion', hp: 100 })],
        ['target', sheet({ slug: 'target', ability: 'Damp', hp: 100 })],
      ]),
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Explosion',
        selection: { kind: 'area', areaTemplateId: moveAutomationAreaTemplateId({ kind: 'burst', size: 2 }) },
      },
      random: () => 0.5, now: () => 1_000, operationId: 'op_aa065_damp_explosion',
    })
    for (const write of result.sheetWrites.filter(write => ['actor', 'target'].includes(write.slug))) {
      expect((write.nextSheet as CharacterSheet).combat?.currentHp).toBe(100)
    }
    expect(result.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'predicate', reasonCode: 'ability.damp.effects-fail', outcome: true,
    }))
  })
})
