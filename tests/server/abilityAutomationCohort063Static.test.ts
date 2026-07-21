import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { createStandardMoveCoreTokenEffectImmunityQueries } from '../../server/domain/moveAutomation/reducers/immunities'
import { aa063ChlorophyllInitiativeMultiplier } from '../../server/domain/abilityAutomation/mechanics/aa063InitiativeIntegration'
import type { MoveCombatStageEffectOperation } from '#shared/moveAutomation/effects'

const sheet = (input: {
  slug: string; move?: string; ability?: string; gender?: string; types?: string[]; hp?: number
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  gender: input.gender, types: input.types ?? ['Normal'],
  abilities: input.ability ? [{ name: input.ability }] : [], movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 25 }, atk: { added: 30 }, def: { added: 8 },
    satk: { added: 40 }, sdef: { added: 8 }, spd: { added: 20 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.hp ?? 100, conditions: [] },
})
const map = (slug = 'aa063', weather: 'sunny' | null = null): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 3, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5, dimensions: { x: 10, y: 4, z: 6 }, groundLevelY: 0,
    playerVisible: true, voxels: [], hazards: [],
    fieldEffects: { weather: weather ? [{ kind: weather, source: 'test' }] : [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' }, foes: { id: 'foes', label: 'Foes', status: 'active' } },
      history: { ...encounter.history, sceneId: `scene:${slug.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}` },
      turnResources: Object.fromEntries(placements.map(placement => [placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 })])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 1 },
  }
}
const plan = (input: { move: string; actorAbility?: string; targetAbility?: string; targetGender?: string; targetTypes?: string[]; random?: number }) => {
  const actor = sheet({ slug: 'actor', move: input.move, ability: input.actorAbility, types: ['Fire'] })
  const target = sheet({ slug: 'target', ability: input.targetAbility, gender: input.targetGender, types: input.targetTypes })
  return planAuthoritativeMoveState({
    map: map(input.move), pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
    intent: { schemaVersion: 1, placementId: 'actor', moveName: input.move, selection: { kind: 'single-target', targetPlacementId: 'target' } },
    random: () => input.random ?? 0.5, now: () => 1_000,
    operationId: `op_${`${input.move}_${input.targetAbility ?? 'base'}`.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_')}`,
  })
}
const hpAfter = (result: ReturnType<typeof plan>): number => (
  (result.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet | undefined)?.combat?.currentHp ?? 100
)

describe('AA-063 static abilities', () => {
  it('aa063.bulletproof.reviewed and aa063.cave-crasher.reviewed resist only their reviewed attack classes', () => {
    const directBase = plan({ move: 'Water Gun' })
    const bulletproof = plan({ move: 'Water Gun', targetAbility: 'Bulletproof' })
    expect(hpAfter(bulletproof)).toBeGreaterThan(hpAfter(directBase))

    const rockBase = plan({ move: 'Rock Throw' })
    const caveCrasher = plan({ move: 'Rock Throw', targetAbility: 'Cave Crasher' })
    expect(hpAfter(caveCrasher)).toBeGreaterThan(hpAfter(rockBase))
  }, 20_000)

  it('aa063.brimstone.reviewed completes a newly inflicted Burn with Poison', () => {
    const result = plan({ move: 'Ember', actorAbility: 'Brimstone', random: 0.99 })
    const target = result.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(target.combat?.conditions).toEqual(expect.arrayContaining(['Burned', 'Poisoned']))
  }, 20_000)

  it('aa063.chemical-romance.reviewed grants Sweet Scent and source-binds Infatuation only to male hits', () => {
    const actor = sheet({ slug: 'actor', ability: 'Chemical Romance' })
    const target = sheet({ slug: 'target', gender: 'Male' })
    const context = buildAuthoritativeMoveRulesContext({
      map: map('chemical-connection'), pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Sweet Scent', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      selectedPlacementIds: ['target'], random: () => 0.5, time: 1_000,
    })
    expect(context.queries.resolveActorMoveEntry('Sweet Scent')).toMatchObject({ ok: true })
    const male = plan({ move: 'Toxic', actorAbility: 'Chemical Romance', targetGender: 'Male', random: 0.99 })
    const female = plan({ move: 'Toxic', actorAbility: 'Chemical Romance', targetGender: 'Female', random: 0.99 })
    const maleConditions = (male.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet).combat?.conditions ?? []
    const femaleConditions = (female.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet).combat?.conditions ?? []
    expect(maleConditions.some(condition => condition.startsWith('Infatuation'))).toBe(true)
    expect(femaleConditions.some(condition => condition.startsWith('Infatuation'))).toBe(false)
  }, 20_000)

  it('aa063.clear-body.reviewed blocks foe stage loss but not self-authored loss', () => {
    const actor = sheet({ slug: 'actor', move: 'Tail Whip' })
    const target = sheet({ slug: 'target', ability: 'Clear Body' })
    const context = buildAuthoritativeMoveRulesContext({
      map: map('clear-body'), pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tail Whip', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      selectedPlacementIds: ['target'], random: () => 0.5, time: 1_000,
    })
    const placement = context.queries.placements.get('target')!
    const recipient = { placement, token: context.queries.tokens.get('target')!, sheet: context.queries.sheets.forPlacement(placement)! }
    const operation = { id: 'tail-whip.defense', kind: 'combat-stage', recipients: { kind: 'hit-targets' }, payload: { applyTypeImmunity: false } } as unknown as MoveCombatStageEffectOperation
    expect(createStandardMoveCoreTokenEffectImmunityQueries({ moveType: 'Normal', context })
      .combatStage({ operation, stage: 'def', delta: -1, recipient }).blockedBy).toBe('Clear Body')
  })

  it('aa063.chlorophyll.reviewed doubles Initiative in sun or below half HP only while selected', () => {
    const placement = map('chlorophyll').placements[0]!
    const healthy = sheet({ slug: 'actor', ability: 'Chlorophyll', hp: 100 })
    expect(aa063ChlorophyllInitiativeMultiplier({ map: map('sun', 'sunny'), placement, sheet: healthy })).toBe(2)
    expect(aa063ChlorophyllInitiativeMultiplier({ map: map('normal'), placement, sheet: healthy })).toBe(1)
    const low = sheet({ slug: 'actor', ability: 'Chlorophyll', hp: 1 })
    expect(aa063ChlorophyllInitiativeMultiplier({ map: map('low'), placement, sheet: low })).toBe(2)
  })
})
