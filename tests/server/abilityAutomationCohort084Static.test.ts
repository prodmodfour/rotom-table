import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { planAuthoritativeMoveState, isAuthoritativePendingMoveStatePlan } from '../../server/domain/planAuthoritativeMoveState'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA084_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa084'
import { aa084PowerConstructBlocksTemporaryHp } from '../../server/domain/abilityAutomation/mechanics/aa084StaticIntegration'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const id = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${id(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: {
  slug: string
  abilities?: readonly string[]
  move?: string
  types?: readonly string[]
  conditions?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 30, revision: 3,
  types: [...(input.types ?? ['Normal'])],
  abilities: (input.abilities ?? []).map(ability),
  movelist: [{ name: input.move ?? 'Tackle' }],
  stats: {
    hp: { added: 100 }, atk: { added: 50 }, def: { added: 35 },
    satk: { added: 50 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 500, injuries: 0, conditions: [...(input.conditions ?? [])] },
})
const fixture = (input: {
  slug: string
  actorAbility?: string
  providerAbility?: string
  targetAbility?: string
  move?: string
  actorConditions?: readonly string[]
  targetTypes?: readonly string[]
  suppressPlacementId?: string
}) => {
  const actor = sheet({
    slug: 'actor', abilities: input.actorAbility ? [input.actorAbility] : [],
    move: input.move, conditions: input.actorConditions,
  })
  const provider = sheet({ slug: 'provider', abilities: input.providerAbility ? [input.providerAbility] : [] })
  const target = sheet({
    slug: 'target', abilities: input.targetAbility ? [input.targetAbility] : [],
    types: input.targetTypes,
  })
  const encounter = createEmptyEncounterState()
  const suppression: EncounterEffect[] = input.suppressPlacementId ? [{
    ...creatureRuleOverlayEncounterEffectFixture({
      domain: 'ability', action: 'suppress', values: [],
      referencePlacementId: null, suppressionScope: 'all',
    }),
    id: `effect.aa084.suppress.${input.suppressPlacementId}`,
    affected: { placementIds: [input.suppressPlacementId], sideIds: [], cells: [] },
  }] : []
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 12, y: 4, z: 12 }, groundLevelY: 0,
    voxels: [], hazards: [],
    placements: [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
      { id: 'provider', sheetKind: 'pokemon', sheetSlug: 'provider', sideId: 'heroes', position: { x: 4, y: 0, z: 2 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 3, y: 0, z: 2 } },
    ],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter, effects: suppression,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: { ...encounter.history, sceneId: `scene:${input.slug}`, currentRound: 1 },
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 }, metadata: {},
  }
  return {
    map,
    sheets: new Map([['actor', actor], ['provider', provider], ['target', target]]),
    move: input.move ?? 'Tackle',
  }
}
const resolve = (state: ReturnType<typeof fixture>) => {
  const plan = planAuthoritativeMoveState({
    map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName: state.move,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: () => 0.75, now: () => 1_000, operationId: `op_${id(state.map.slug)}`,
  })
  if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Static AA-084 move unexpectedly suspended.')
  return plan
}
const targetHp = (state: ReturnType<typeof fixture>, plan: ReturnType<typeof resolve>): number => (
  ((plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet
    ?? state.sheets.get('target')!) as CharacterSheet).combat!.currentHp ?? 0
)

describe('AA-084 static integrations', () => {
  it('selects the twelve exact reviewed AA-084 runtimes', () => {
    expect(AA084_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Power Construct', 'Power Spot', 'Power of Alchemy', 'Prankster', 'Pressure', 'Pride',
      'Prime Fury', 'Prism Armor', 'Probability Control', 'Propeller Tail', 'Protean', 'Psionic Screech',
    ])
    for (const spec of AA084_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId, kind: 'abilityspec-v1', version: 1,
      })
    }
  })

  it('Power Spot gives one +5 damage bonus to another ally within 2m and suppression removes it', () => {
    const ordinary = fixture({ slug: 'aa084-power-spot-ordinary' })
    const boosted = fixture({ slug: 'aa084-power-spot', providerAbility: 'Power Spot' })
    const suppressed = fixture({
      slug: 'aa084-power-spot-suppressed', providerAbility: 'Power Spot', suppressPlacementId: 'provider',
    })
    const ordinaryHp = targetHp(ordinary, resolve(ordinary))
    expect(targetHp(boosted, resolve(boosted))).toBe(ordinaryHp - 5)
    expect(targetHp(suppressed, resolve(suppressed))).toBe(ordinaryHp)
  }, 30_000)

  it('Prism Armor subtracts 5 only from super-effective damage and is suppression-aware', () => {
    const ordinary = fixture({ slug: 'aa084-prism-ordinary', move: 'Ember', targetTypes: ['Grass'] })
    const protectedState = fixture({
      slug: 'aa084-prism', move: 'Ember', targetTypes: ['Grass'], targetAbility: 'Prism Armor',
    })
    const suppressed = fixture({
      slug: 'aa084-prism-suppressed', move: 'Ember', targetTypes: ['Grass'],
      targetAbility: 'Prism Armor', suppressPlacementId: 'target',
    })
    const ordinaryHp = targetHp(ordinary, resolve(ordinary))
    expect(targetHp(protectedState, resolve(protectedState))).toBe(ordinaryHp + 5)
    expect(targetHp(suppressed, resolve(suppressed))).toBe(ordinaryHp)
  }, 30_000)

  it('Pride virtually raises Special Attack two stages only while a listed condition and effective Ability remain', () => {
    const ordinary = fixture({ slug: 'aa084-pride-ordinary', move: 'Ember', actorConditions: ['Burned'] })
    const proud = fixture({
      slug: 'aa084-pride', move: 'Ember', actorAbility: 'Pride', actorConditions: ['Burned'],
    })
    const cured = fixture({ slug: 'aa084-pride-cured', move: 'Ember', actorAbility: 'Pride' })
    const suppressed = fixture({
      slug: 'aa084-pride-suppressed', move: 'Ember', actorAbility: 'Pride',
      actorConditions: ['Burned'], suppressPlacementId: 'actor',
    })
    const ordinaryLoss = 500 - targetHp(ordinary, resolve(ordinary))
    expect(500 - targetHp(proud, resolve(proud))).toBeGreaterThan(ordinaryLoss)
    expect(targetHp(cured, resolve(cured))).toBe(targetHp(fixture({ slug: 'aa084-pride-baseline', move: 'Ember' }), resolve(fixture({ slug: 'aa084-pride-baseline-2', move: 'Ember' }))))
    expect(targetHp(suppressed, resolve(suppressed))).toBe(targetHp(ordinary, resolve(ordinary)))
  }, 30_000)

  it('recognizes only an active Power Construct Complete Forme marker as a Temporary HP lock', () => {
    const state = fixture({ slug: 'aa084-power-construct-lock' })
    const marker = {
      ...creatureRuleOverlayEncounterEffectFixture({
        domain: 'form', action: 'replace', value: 'zygarde-complete-forme',
        referencePlacementId: null,
      }),
      id: 'ability.power-construct.form.test',
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      tags: ['ability', 'aa084', 'power-construct'],
    }
    expect(aa084PowerConstructBlocksTemporaryHp({
      context: { map: { ...state.map, encounterState: { ...state.map.encounterState!, effects: [marker] } } },
      placementId: 'actor',
    })).toBe(true)
    expect(aa084PowerConstructBlocksTemporaryHp({
      context: { map: state.map }, placementId: 'actor',
    })).toBe(false)
  })
})
