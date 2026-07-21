import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { resolveAuthoritativeMoveUserAccuracy } from '../../server/domain/moveAutomation/accuracy'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const sheet = (input: {
  slug: string; move?: string; ability?: string; types?: string[]; hp?: number; automation?: NonNullable<CharacterSheet['abilities']>[number]['automation']
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  types: input.types ?? ['Normal'],
  abilities: input.ability ? [{ name: input.ability, ...(input.automation ? { automation: input.automation } : {}) }] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: { hp: { added: 20 }, atk: { added: 20 }, def: { added: 20 }, satk: { added: 20 }, sdef: { added: 20 }, spd: { added: 20 } },
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
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 1 },
  }
}
const plan = (input: { slug: string; move: string; actorAbility?: string; targetAbility?: string; targetTypes?: string[]; random?: number }) => {
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move: input.move, ability: input.actorAbility })],
    ['target', sheet({ slug: 'target', ability: input.targetAbility, types: input.targetTypes, hp: 200 })],
  ])
  return planAuthoritativeMoveState({
    map: map(input.slug), pokemonSheets, trainerSheets: new Map(),
    intent: { schemaVersion: 1, placementId: 'actor', moveName: input.move, selection: { kind: 'single-target', targetPlacementId: 'target' } },
    random: () => input.random ?? 0.5, now: () => 1_000, operationId: `op_${input.slug}`,
  })
}
const written = (result: ReturnType<typeof plan>, slug: string): CharacterSheet => (
  result.sheetWrites.find(write => write.slug === slug)?.nextSheet as CharacterSheet
)
const stage = (value: CharacterSheet, key: 'atk' | 'satk' | 'def' | 'sdef' | 'spd'): number => (
  value.stats?.[key]?.stage ?? value.combatStages?.[key] ?? 0
)

const colorData = (optionId: string): NonNullable<NonNullable<CharacterSheet['abilities']>[number]['automation']> => ({
  schemaVersion: 1, instanceId: `color:${optionId}`, canonicalId: 'Color Theory', definitionVersion: 1,
  selections: [{ parameterId: 'color', optionIds: [optionId] }],
})

describe('AA-064 static abilities', () => {
  it('aa064.compound-eyes.reviewed contributes exactly +3 to authoritative Accuracy', () => {
    const actor = sheet({ slug: 'actor', move: 'Tackle', ability: 'Compound Eyes' })
    const target = sheet({ slug: 'target' })
    const context = buildAuthoritativeMoveRulesContext({
      map: map('compound-eyes'), pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      selectedPlacementIds: ['target'], random: () => 0.5, time: 1_000,
    })
    const accuracy = resolveAuthoritativeMoveUserAccuracy(context, { targetPlacementId: 'target' })
    expect(accuracy.modifiers).toContainEqual(expect.objectContaining({ sourceId: 'ability.compound-eyes', value: 3 }))

    const suppressedMap = map('compound-eyes-suppressed')
    suppressedMap.encounterState = {
      ...suppressedMap.encounterState!,
      effects: [{
        ...creatureRuleOverlayEncounterEffectFixture({
          domain: 'ability', action: 'suppress', values: ['Compound Eyes'],
          referencePlacementId: null, suppressionScope: 'listed',
        }),
        affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      }],
    }
    const suppressed = buildAuthoritativeMoveRulesContext({
      map: suppressedMap, pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      selectedPlacementIds: ['target'], random: () => 0.5, time: 1_000,
    })
    expect(resolveAuthoritativeMoveUserAccuracy(suppressed).modifiers)
      .not.toContainEqual(expect.objectContaining({ sourceId: 'ability.compound-eyes' }))
  })

  it('aa064.color-theory.reviewed projects pure and mixed lasting Base Stat bonuses', () => {
    const project = (optionId: string) => {
      const pokemon = sheet({ slug: 'actor', ability: 'Color Theory', automation: colorData(optionId) })
      const lookup: SheetLookup = { pokemon: new Map([['actor', pokemon]]), trainer: new Map() }
      return placementToSpawned(map(`color-${optionId}`).placements[0]!, lookup, map(`color-${optionId}`))!
    }
    const red = project('red')
    const redOrange = project('red-orange')
    const violet = project('violet')
    expect(red.atk).toBe(redOrange.atk! + 3)
    expect(redOrange.def).toBeGreaterThan(red.def!)
    expect(violet.fullMaxHp! - red.fullMaxHp!).toBe(18)
  })

  it('aa064.competitive.reviewed reacts to external lowering while aa064.contrary.reviewed inverts changes', () => {
    const competitive = plan({ slug: 'competitive', move: 'Charm', targetAbility: 'Competitive' })
    expect(stage(written(competitive, 'target'), 'satk')).toBe(2)

    const contrary = plan({ slug: 'contrary', move: 'Charm', targetAbility: 'Contrary' })
    expect(stage(written(contrary, 'target'), 'atk')).toBeGreaterThan(0)

    const ownCompetitive = plan({ slug: 'competitive-own', move: 'Close Combat', actorAbility: 'Competitive' })
    expect(stage(written(ownCompetitive, 'actor'), 'satk')).toBe(0)
    const ownContrary = plan({ slug: 'contrary-own', move: 'Close Combat', actorAbility: 'Contrary' })
    expect(stage(written(ownContrary, 'actor'), 'def')).toBeGreaterThan(0)
  }, 20_000)

  it('aa064.corrosion.reviewed treats Poison immunity as x0.25 and bypasses only Poison/Steel condition immunity', () => {
    const base = plan({ slug: 'corrosion-base', move: 'Poison Sting', targetTypes: ['Steel'], random: 0.99 })
    const corrosion = plan({ slug: 'corrosion-active', move: 'Poison Sting', actorAbility: 'Corrosion', targetTypes: ['Steel'], random: 0.99 })
    expect(written(base, 'target')).toBeUndefined()
    const target = written(corrosion, 'target')
    expect(target.combat?.currentHp).toBeLessThan(200)
    expect(target.combat?.conditions).toContain('Poisoned')

    const abilityImmune = plan({
      slug: 'corrosion-preserves-immunity', move: 'Poison Sting', actorAbility: 'Corrosion',
      targetAbility: 'Immunity', targetTypes: ['Steel'], random: 0.99,
    })
    const protectedTarget = written(abilityImmune, 'target')
    expect(protectedTarget.combat?.currentHp).toBeLessThan(200)
    expect(protectedTarget.combat?.conditions).not.toContain('Poisoned')
  }, 20_000)
})
