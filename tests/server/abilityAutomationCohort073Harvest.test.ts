import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import {
  AA073_HARVEST_TAILS_CAPABILITY,
  AA073_HARVEST_TRADE_CAPABILITY,
} from '#shared/abilityAutomation/aa073'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const ability = {
  name: 'Harvest',
  automation: {
    schemaVersion: 1 as const,
    instanceId: 'base:harvest',
    canonicalId: 'Harvest',
    definitionVersion: null,
    selections: [],
  },
}
const sheet = (input: {
  slug: string
  harvest?: boolean
  digestionFood?: string
  move?: string
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: ['Bug'],
  abilities: input.harvest ? [ability] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  ...(input.digestionFood ? { items: { digestionFood: input.digestionFood } } : {}),
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [] },
})
const suppression = (): EncounterEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'ability', action: 'suppress', values: [],
    referencePlacementId: null, suppressionScope: 'all',
  }),
  id: 'effect.aa073.suppress-harvest',
  affected: { placementIds: ['actor'], sideIds: [], cells: [] },
})
const fixture = (input: {
  slug: string
  harvest?: boolean
  sunny?: boolean
  effects?: readonly EncounterEffect[]
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: input.slug,
    name: input.slug,
    revision: 5,
    dimensions: { x: 8, y: 4, z: 8 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [], hazards: [],
    fieldEffects: {
      weather: input.sunny ? [{ kind: 'sunny', rounds: 2 }] : [],
      terrains: [], rooms: [],
    },
    placements,
    encounterState: {
      ...encounter,
      effects: [...(input.effects ?? [])],
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history,
        sceneId: `scene:${input.slug}`,
        currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
  return {
    map,
    sheets: new Map<string, CharacterSheet>([
      ['actor', sheet({
        slug: 'actor', harvest: input.harvest,
        digestionFood: 'Oran Berry', move: 'Bug Bite',
      })],
      ['target', sheet({ slug: 'target' })],
    ]),
  }
}

const resolve = (input: Parameters<typeof fixture>[0] & { coin?: 'heads' | 'tails' }) => {
  const state = fixture(input)
  let draw = 0
  const random = () => {
    draw += 1
    if (draw === 1) return 0.5 // Bug Bite accuracy.
    if (draw === 2) return input.coin === 'heads' ? 0 : 0.99 // Harvest d2.
    return 0.5
  }
  const plan = planAuthoritativeMoveState({
    map: state.map,
    pokemonSheets: state.sheets,
    trainerSheets: new Map(),
    intent: {
      schemaVersion: 1,
      placementId: 'actor',
      moveName: 'Bug Bite',
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random,
    now: () => 1_000,
    operationId: `op_${input.slug}`,
  })
  const actor = (plan.sheetWrites.find(write => write.slug === 'actor')?.nextSheet
    ?? state.sheets.get('actor')) as CharacterSheet
  return { plan, actor, draw, state }
}

describe('AA-073 Harvest item integration', () => {
  it('aa073.harvest.reviewed retains a Berry Digestion Buff on authoritative heads', () => {
    const { plan, actor } = resolve({
      slug: 'aa073-harvest-heads', harvest: true, coin: 'heads',
    })
    expect(actor.items?.digestionFood ?? actor.items?.digestionFoods?.[0]).toBe('Oran Berry')
    expect(plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability',
      payload: { capabilityId: AA073_HARVEST_TRADE_CAPABILITY, action: 'grant' },
      createdRound: 1,
      createdTurn: 1,
    }))
    expect(plan.nextMap.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId === AA073_HARVEST_TAILS_CAPABILITY
    ))).toBe(false)
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('ability.harvest.retention-roll')
  }, 30_000)

  it('aa073.harvest.reviewed consumes on tails and records the scene stop marker', () => {
    const { plan, actor } = resolve({
      slug: 'aa073-harvest-tails', harvest: true, coin: 'tails',
    })
    expect(actor.items?.digestionFood).toBeUndefined()
    expect(actor.items?.digestionFoods).toBeUndefined()
    expect(plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability',
      payload: { capabilityId: AA073_HARVEST_TAILS_CAPABILITY, action: 'grant' },
    }))
  }, 30_000)

  it('aa073.harvest.reviewed always retains in Sunny Weather without drawing a coin', () => {
    const { plan, actor, draw } = resolve({
      slug: 'aa073-harvest-sunny', harvest: true, sunny: true,
    })
    expect(actor.items?.digestionFood ?? actor.items?.digestionFoods?.[0]).toBe('Oran Berry')
    expect(plan.nextMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      payload: { capabilityId: AA073_HARVEST_TRADE_CAPABILITY, action: 'grant' },
    }))
    expect(JSON.stringify(plan.resolution.auditTrace)).not.toContain('ability.harvest.retention-roll')
    expect(draw).toBeGreaterThan(0)
  }, 30_000)

  it('enforces one Harvest Digestion trade per authoritative turn and reopens next turn after heads', () => {
    const first = resolve({ slug: 'aa073-harvest-turn-gate', harvest: true, coin: 'heads' })
    const sheets = new Map(first.state.sheets)
    sheets.set('actor', first.actor)
    const useAgain = (turn: number, operationId: string) => {
      const map: TabletopMap = {
        ...first.plan.nextMap,
        encounterState: {
          ...first.plan.nextMap.encounterState!,
          history: {
            ...first.plan.nextMap.encounterState!.history,
            currentTurn: { round: 1, turn, placementId: 'actor' },
          },
          turnResources: {
            ...first.plan.nextMap.encounterState!.turnResources,
            actor: createEncounterTurnResourceLedger({ placementId: 'actor', round: 1 }),
          },
        },
      }
      return planAuthoritativeMoveState({
        map,
        pokemonSheets: sheets,
        trainerSheets: new Map(),
        intent: {
          schemaVersion: 1, placementId: 'actor', moveName: 'Bug Bite',
          selection: { kind: 'single-target', targetPlacementId: 'target' },
        },
        random: () => 0.5,
        now: () => 2_000 + turn,
        operationId,
      })
    }
    const sameTurn = useAgain(1, 'op_aa073_harvest_same_turn')
    expect(JSON.stringify(sameTurn.resolution.auditTrace)).not.toContain('ability.harvest.retention-roll')
    expect(sameTurn.nextMap.encounterState?.effects.filter(effect => (
      effect.kind === 'capability'
      && effect.payload.capabilityId === AA073_HARVEST_TRADE_CAPABILITY
    ))).toHaveLength(1)

    const nextTurn = useAgain(2, 'op_aa073_harvest_next_turn')
    expect(JSON.stringify(nextTurn.resolution.auditTrace)).toContain('ability.harvest.retention-roll')
  }, 30_000)

  it('suppressed Harvest fails closed to ordinary one-use Digestion consumption', () => {
    const { plan, actor } = resolve({
      slug: 'aa073-harvest-suppressed', harvest: true, coin: 'heads', effects: [suppression()],
    })
    expect(actor.items?.digestionFood).toBeUndefined()
    expect(plan.nextMap.encounterState?.effects.some(effect => (
      effect.kind === 'capability'
      && [AA073_HARVEST_TRADE_CAPABILITY, AA073_HARVEST_TAILS_CAPABILITY]
        .includes(effect.payload.capabilityId as typeof AA073_HARVEST_TRADE_CAPABILITY)
    ))).toBe(false)
    expect(JSON.stringify(plan.resolution.auditTrace)).not.toContain('ability.harvest.retention-roll')
  }, 30_000)
})
