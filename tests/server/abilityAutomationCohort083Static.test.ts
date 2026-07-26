import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { pokemonMoveEntriesForSheet } from '~/utils/mapTokenMoves'
import { planAuthoritativeMoveState, isAuthoritativePendingMoveStatePlan } from '../../server/domain/planAuthoritativeMoveState'
import { projectAuthoritativeEffectiveAbilities } from '../../server/domain/abilityAutomation/effectiveAbilities'
import { resolveSheetAbilityInstances } from '../../server/domain/abilityAutomation/instanceParameters'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA083_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa083'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

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
  abilities?: readonly string[]
  move?: string
  species?: string
  level?: number
  types?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: input.species ?? 'Eevee',
  level: input.level ?? 30,
  revision: 3,
  types: [...(input.types ?? ['Normal'])],
  abilities: (input.abilities ?? []).map(ability),
  movelist: [{ name: input.move ?? 'Tackle' }],
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combat: { currentHp: 300, injuries: 0, conditions: [] },
})
const fixture = (input: {
  slug: string
  ability?: string
  move?: string
  suppression?: boolean
}) => {
  const actor = sheet({ slug: 'actor', abilities: input.ability ? [input.ability] : [], move: input.move })
  const target = sheet({ slug: 'target', types: ['Normal'] })
  const encounter = createEmptyEncounterState()
  const suppression: EncounterEffect[] = input.suppression ? [{
    ...creatureRuleOverlayEncounterEffectFixture({
      domain: 'ability', action: 'suppress', values: [],
      referencePlacementId: null, suppressionScope: 'all',
    }),
    id: 'effect.aa083.suppress.actor',
    affected: { placementIds: ['actor'], sideIds: [], cells: [] },
  }] : []
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: input.slug,
    name: input.slug,
    revision: 5,
    dimensions: { x: 10, y: 4, z: 10 },
    groundLevelY: 0,
    voxels: [], hazards: [],
    placements: [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 3, y: 0, z: 2 } },
    ],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      effects: suppression,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: { ...encounter.history, sceneId: `scene:${input.slug}`, currentRound: 1 },
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
    metadata: {},
  }
  return { map, sheets: new Map([['actor', actor], ['target', target]]), move: input.move ?? 'Tackle' }
}
const resolve = (state: ReturnType<typeof fixture>, random = () => 0.9) => {
  const plan = planAuthoritativeMoveState({
    map: state.map,
    pokemonSheets: state.sheets,
    trainerSheets: new Map(),
    intent: {
      schemaVersion: 1,
      placementId: 'actor',
      moveName: state.move,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random,
    now: () => 1000,
    operationId: `op_${id(state.map.slug)}`,
  })
  if (isAuthoritativePendingMoveStatePlan(plan)) throw new Error('Static AA-083 move unexpectedly suspended.')
  return plan
}
const nextSheet = (
  state: ReturnType<typeof fixture>,
  plan: ReturnType<typeof resolve>,
  slug: string,
): CharacterSheet => (plan.sheetWrites.find(write => write.slug === slug)?.nextSheet
  ?? state.sheets.get(slug)!) as CharacterSheet

describe('AA-083 static integrations', () => {
  it('selects the twelve exact reviewed AA-083 runtimes', () => {
    expect(AA083_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Perish Body', 'Permafrost', 'Photosynthesis', 'Pickpocket', 'Pickup', 'Pixilate',
      'Plus', 'Poison Heal', 'Poison Point', 'Poison Touch', 'Poltergeist', 'Polycephaly',
    ])
    for (const spec of AA083_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId,
        kind: 'abilityspec-v1',
        version: 1,
      })
    }
  })

  it('Permafrost blocks recoil through effective abilities and suppression restores recoil', () => {
    const protectedState = fixture({ slug: 'aa083-permafrost', ability: 'Permafrost', move: 'Double-Edge' })
    const protectedPlan = resolve(protectedState, () => 0.75)
    expect(nextSheet(protectedState, protectedPlan, 'actor').combat?.currentHp).toBe(300)

    const suppressedState = fixture({
      slug: 'aa083-permafrost-suppressed', ability: 'Permafrost', move: 'Double-Edge', suppression: true,
    })
    const suppressedPlan = resolve(suppressedState, () => 0.75)
    expect(nextSheet(suppressedState, suppressedPlan, 'actor').combat?.currentHp).toBeLessThan(300)
  }, 30_000)

  it('Poison Touch poisons damaging-Move legal targets on 19+ and suppression removes the added effect', () => {
    const state = fixture({ slug: 'aa083-poison-touch', ability: 'Poison Touch' })
    const plan = resolve(state, () => 0.9)
    expect(nextSheet(state, plan, 'target').combat?.conditions).toContain('Poisoned')

    const suppressed = fixture({ slug: 'aa083-poison-touch-suppressed', ability: 'Poison Touch', suppression: true })
    const suppressedPlan = resolve(suppressed, () => 0.9)
    expect(nextSheet(suppressed, suppressedPlan, 'target').combat?.conditions ?? []).not.toContain('Poisoned')
  }, 30_000)

  it('Poison Touch expands an existing Poison effect range by +2', () => {
    const state = fixture({ slug: 'aa083-poison-touch-expand', ability: 'Poison Touch', move: 'Poison Sting' })
    const plan = resolve(state, () => 0.7)
    expect(nextSheet(state, plan, 'target').combat?.conditions).toContain('Poisoned')

    const ordinary = fixture({ slug: 'aa083-poison-touch-expand-ordinary', move: 'Poison Sting' })
    const ordinaryPlan = resolve(ordinary, () => 0.7)
    expect(nextSheet(ordinary, ordinaryPlan, 'target').combat?.conditions ?? []).not.toContain('Poisoned')
  }, 30_000)

  it('Poltergeist grants the form Ability and level-40 form Move from authoritative species data', () => {
    const rotom = sheet({
      slug: 'rotom', species: 'Heat Rotom', level: 40,
      abilities: ['Poltergeist'], move: 'Thunder Shock',
    })
    const projected = projectAuthoritativeEffectiveAbilities({
      baseAbilities: resolveSheetAbilityInstances(rotom.abilities),
      species: rotom.species,
      target: { placementId: 'rotom', position: { x: 0, y: 0, z: 0 } },
    })
    expect(projected).toContainEqual(expect.objectContaining({
      canonicalId: 'Flash Fire', sourceKind: 'granted', effective: true,
    }))
    expect(pokemonMoveEntriesForSheet(rotom).map(entry => entry.move.name)).toContain('Overheat')
    expect(pokemonMoveEntriesForSheet({ ...rotom, level: 39 }).map(entry => entry.move.name)).not.toContain('Overheat')
  })
})
