import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect, type EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { ENCOUNTER_EVENT_SCHEMA_VERSION, parseEncounterEvent } from '#shared/moveAutomation/events'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { pokemonHpSnapshot } from '~/utils/sheetSpawn'
import {
  planEncounterLifecycle,
  planInitiativeLifecycle,
} from '../../server/domain/moveAutomation/planInitiativeLifecycle'
import {
  aa083PoisonHealActive,
  clearAa083PerishCountForBreather,
} from '../../server/domain/abilityAutomation/mechanics/aa083LifecycleIntegration'
import { capabilityEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${canonicalId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const sheet = (input: {
  slug: string
  ability?: string
  currentHp?: number
  conditions?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 30,
  revision: 3,
  types: ['Normal'],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: [{ name: 'Tackle' }],
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combat: {
    currentHp: input.currentHp ?? 300,
    injuries: 0,
    conditions: [...(input.conditions ?? [])],
  },
})
const taggedConditionEffect = (input: {
  id: string
  tag: string
  capabilityId: string
  duration: EncounterEffect['duration']
}): EncounterEffect => parseEncounterEffect({
  ...capabilityEncounterEffectFixture(),
  id: input.id,
  source: {
    operationId: `op_${input.id.replace(/[^a-z0-9]+/g, '_')}`,
    moveId: 'ability.aa083',
    placementId: 'target',
  },
  affected: { placementIds: ['target'], sideIds: [], cells: [] },
  createdRound: 1,
  createdTurn: 1,
  duration: input.duration,
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['ability', 'aa083', input.tag],
  payload: { capabilityId: input.capabilityId, action: 'grant' },
  dispel: { policy: 'matching-tags', tags: [input.tag] },
  suppression: { sources: [] },
})
const mapFixture = (effects: readonly EncounterEffect[]): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2,
    slug: 'aa083-lifecycle',
    name: 'AA083 lifecycle',
    revision: 5,
    dimensions: { x: 8, y: 3, z: 8 },
    groundLevelY: 0,
    voxels: [], hazards: [],
    placements: [
      { id: 'other', sheetKind: 'pokemon', sheetSlug: 'other', sideId: 'foes', position: { x: 1, y: 0, z: 1 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'heroes', position: { x: 2, y: 0, z: 1 } },
    ],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      effects: [...effects],
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history,
        sceneId: 'scene:aa083-lifecycle',
        currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'other' },
      },
    },
    initiative: { activeId: 'other', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
    metadata: {},
  }
}
const sheets = (target: CharacterSheet) => new Map<string, CharacterSheet>([
  ['other', sheet({ slug: 'other' })],
  ['target', target],
])
const load = (pokemonSheets: ReadonlyMap<string, CharacterSheet>) => () => ({
  pokemonSheets,
  trainerSheets: new Map<string, TrainerSheet>(),
})

describe('AA-083 lifecycle integrations', () => {
  it('faints a target when Perish Count reaches zero without Massive Damage and expires the count', () => {
    const effect = taggedConditionEffect({
      id: 'effect.aa083.perish.target',
      tag: 'aa083-perish-count',
      capabilityId: 'aa083.perish-count',
      duration: { kind: 'turns', subject: 'target', boundary: 'start', remaining: 1 },
    })
    const map = mapFixture([effect])
    const target = sheet({ slug: 'target', currentHp: 300 })
    const plan = planInitiativeLifecycle({
      map,
      previous: { activeId: 'other', round: 1 },
      current: { activeId: 'target', round: 1 },
      orderIds: ['other', 'target'],
      operationId: 'op_aa083_perish_turn_start',
      time: 2000,
      loadSheets: load(sheets(target)),
    })
    const next = plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(next.combat?.currentHp).toBe(0)
    expect(next.combat?.injuries).toBe(0)
    expect(plan.currentEncounterState.effects.some(candidate => candidate.id === effect.id)).toBe(false)
    expect(plan.reduction.operations).toContainEqual(expect.objectContaining({
      kind: 'direct-hp', reasonCode: 'ability.perish-body.count-zero',
    }))
  })

  it('Poison Heal restores one Tick at turn start, suppresses while its Ability is ineffective, and cures Poison at scene end', () => {
    const effect = taggedConditionEffect({
      id: 'effect.aa083.poison-heal.target',
      tag: 'aa083-poison-heal-active',
      capabilityId: 'aa083.poison-heal-active',
      duration: { kind: 'scene', remaining: null },
    })
    const map = mapFixture([effect])
    const target = sheet({
      slug: 'target', ability: 'Poison Heal', currentHp: 200, conditions: ['Poisoned'],
    })
    const maximumHp = pokemonHpSnapshot(target).fullMaxHp
    const turn = planInitiativeLifecycle({
      map,
      previous: { activeId: 'other', round: 1 },
      current: { activeId: 'target', round: 1 },
      orderIds: ['other', 'target'],
      operationId: 'op_aa083_poison_heal_turn_start',
      time: 2000,
      loadSheets: load(sheets(target)),
    })
    const healed = turn.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(healed.combat?.currentHp).toBe(200 + Math.floor(maximumHp * 0.1))
    expect(aa083PoisonHealActive(map, 'target')).toBe(true)

    const suppressionSource = taggedConditionEffect({
      id: 'effect.test-suppression',
      tag: 'test-suppression',
      capabilityId: 'aa083.test-suppression',
      duration: { kind: 'scene', remaining: null },
    })
    const suppressedMap: TabletopMap = {
      ...structuredClone(map),
      encounterState: {
        ...structuredClone(map.encounterState!),
        effects: [
          {
            ...structuredClone(map.encounterState!.effects[0]!),
            suppression: { sources: [{ effectId: suppressionSource.id, reasonCode: 'test-suppression' }] },
          },
          suppressionSource,
        ],
      },
    }
    const suppressed = planInitiativeLifecycle({
      map: suppressedMap,
      previous: { activeId: 'other', round: 1 },
      current: { activeId: 'target', round: 1 },
      orderIds: ['other', 'target'],
      operationId: 'op_aa083_poison_heal_suppressed',
      time: 2000,
      loadSheets: load(sheets(target)),
    })
    expect(suppressed.sheetWrites).toHaveLength(0)

    const sceneEnd = parseEncounterEvent({
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION,
      eventId: 'event.aa083.scene-end',
      kind: 'scene-end',
      sourceOperationId: 'op_aa083_scene_end',
      causalParentEventId: null,
      reasonCode: 'scene-ended',
      sceneId: 'scene:aa083-lifecycle',
    })
    const ended = planEncounterLifecycle({
      map,
      events: [sceneEnd],
      time: 3000,
      loadSheets: load(sheets(target)),
    })
    const cured = ended.sheetWrites.find(write => write.slug === 'target')?.nextSheet as CharacterSheet
    expect(cured.combat?.conditions ?? []).not.toContain('Poisoned')
    expect(ended.currentEncounterState.effects.some(candidate => candidate.id === effect.id)).toBe(false)
  })

  it('clears Perish Count on Take a Breather without disturbing unrelated effects', () => {
    const perish = taggedConditionEffect({
      id: 'effect.aa083.perish.breather',
      tag: 'aa083-perish-count',
      capabilityId: 'aa083.perish-count',
      duration: { kind: 'turns', subject: 'target', boundary: 'start', remaining: 2 },
    })
    const unrelated = taggedConditionEffect({
      id: 'effect.aa083.unrelated',
      tag: 'unrelated',
      capabilityId: 'aa083.unrelated',
      duration: { kind: 'scene', remaining: null },
    })
    const cleared = clearAa083PerishCountForBreather(mapFixture([perish, unrelated]), 'target')
    expect(cleared.encounterState?.effects.map(effect => effect.id)).toEqual([unrelated.id])
  })
})
