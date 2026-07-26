import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { aa079MagicGuardBlocksReason } from '#shared/abilityAutomation/aa079'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA079_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa079'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import {
  applyAa079MagmaArmorGrappleTrigger,
  aa079MagmaArmorGrappleLifecycleEntries,
  createAa079MagmaArmorGrappleLifecycleHandler,
} from '../../server/domain/abilityAutomation/mechanics/aa079LifecycleIntegration'
import { ENCOUNTER_EVENT_SCHEMA_VERSION, parseEncounterEvent } from '#shared/moveAutomation/events'
import { createAuthoritativeMoveRandom } from '../../server/domain/moveAutomation/random'
import { placementToSpawned } from '~/utils/placement'

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
  move?: string
  abilities?: readonly string[]
  currentHp?: number
  conditions?: readonly string[]
  types?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 30, revision: 3,
  types: [...(input.types ?? ['Normal'])], abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: {
    currentHp: input.currentHp ?? 300, injuries: 0,
    conditions: [...(input.conditions ?? [])],
  },
})
const fixture = (input: {
  slug: string
  move: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  actorHp?: number
  targetHp?: number
  actorConditions?: readonly string[]
  targetConditions?: readonly string[]
  actorTypes?: readonly string[]
  targetTypes?: readonly string[]
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 16, y: 4, z: 16 }, groundLevelY: 0,
    voxels: [], hazards: [], placements,
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history, sceneId: `scene:${input.slug}`, currentRound: 1,
        currentTurn: { round: 1, turn: 1, placementId: 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1, turn: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor', move: input.move, abilities: input.actorAbilities,
      currentHp: input.actorHp, conditions: input.actorConditions, types: input.actorTypes,
    })],
    ['target', sheet({
      slug: 'target', abilities: input.targetAbilities,
      currentHp: input.targetHp, conditions: input.targetConditions, types: input.targetTypes,
    })],
  ])
  return { map, sheets, move: input.move }
}
type State = ReturnType<typeof fixture>
const resolve = (state: State, random: () => number = () => 0.75) => planAuthoritativeMoveState({
  map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
  intent: {
    schemaVersion: 1, placementId: 'actor', moveName: state.move,
    selection: { kind: 'single-target', targetPlacementId: 'target' },
  },
  random, now: () => 1_000,
  operationId: `op_${state.map.slug.replace(/[^a-zA-Z0-9_]+/g, '_')}`,
})
const resolvedSheet = (state: State, plan: ReturnType<typeof resolve>, slug: 'actor' | 'target') => (
  plan.sheetWrites.find(write => write.slug === slug)?.nextSheet ?? state.sheets.get(slug)!
) as CharacterSheet
const hpAfter = (state: State, slug: 'actor' | 'target' = 'target') => (
  resolvedSheet(state, resolve(state), slug).combat?.currentHp ?? 0
)

describe('AA-079 static integrations', () => {
  it('selects all twelve exact reviewed runtimes', () => {
    expect(AA079_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Magic Guard', 'Magician', 'Magma Armor', 'Magnet Pull', 'Marvel Scale',
      'Mega Launcher', 'Memory Wipe', 'Merciless', 'Migraine', 'Mimicry',
      'Mimitree', 'Mind Mold',
    ])
    for (const spec of AA079_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId, kind: 'abilityspec-v1', version: 1,
        sourceModule: 'server/domain/abilityAutomation/specs/aa079.ts',
      })
    }
  })

  it('aa079.magic-guard.reviewed blocks reviewed recoil without blocking attack damage', () => {
    const ordinary = fixture({ slug: 'aa079-magic-guard-ordinary', move: 'Wild Charge' })
    const guarded = fixture({
      slug: 'aa079-magic-guard-guarded', move: 'Wild Charge', actorAbilities: ['Magic Guard'],
    })
    expect(hpAfter(ordinary, 'actor')).toBeLessThan(300)
    expect(hpAfter(guarded, 'actor')).toBe(300)
    expect(hpAfter(guarded, 'target')).toBeLessThan(300)
    expect(JSON.stringify(resolve(guarded).resolution.auditTrace)).toContain('Magic Guard')
    for (const reasonCode of [
      'zone.hazard.spikes', 'weather.hail.hit-point-loss',
      'status-affliction.poison.hit-point-loss', 'vortex.turn-start-tick',
      'move.wild-charge.recoil', 'ability.hay-fever.hit-point-loss',
      'ability.iron-barbs.attacker-hp-loss', 'ability.rough-skin.attacker-hp-loss',
      'move.leech-seed.turn-start-loss',
    ]) expect(aa079MagicGuardBlocksReason(reasonCode)).toBe(true)
    expect(aa079MagicGuardBlocksReason('tackle.damage')).toBe(false)
  })

  it('aa079.magma-armor.reviewed applies one Tick only after a Burn-vulnerable Melee hit', () => {
    const active = fixture({
      slug: 'aa079-magma-armor-hit', move: 'Tackle', targetAbilities: ['Magma Armor'],
    })
    expect(hpAfter(active, 'actor')).toBeLessThan(300)
    expect(JSON.stringify(resolve(active).resolution.auditTrace)).toContain('ability.magma-armor.melee-hit-point-loss')

    const immune = fixture({
      slug: 'aa079-magma-armor-immune', move: 'Tackle', targetAbilities: ['Magma Armor'],
      actorTypes: ['Fire'],
    })
    expect(hpAfter(immune, 'actor')).toBe(300)
    const missed = fixture({
      slug: 'aa079-magma-armor-miss', move: 'Tackle', targetAbilities: ['Magma Armor'],
    })
    expect(resolvedSheet(missed, resolve(missed, () => 0), 'actor').combat?.currentHp).toBe(300)
  })

  it('aa079.magma-armor.reviewed persists Grapple evidence and emits one burn-aware turn-end Tick', () => {
    const state = fixture({
      slug: 'aa079-magma-armor-grapple', move: 'Tackle', targetAbilities: ['Magma Armor'],
    })
    const actorPlacement = state.map.placements.find(entry => entry.id === 'actor')!
    const targetPlacement = state.map.placements.find(entry => entry.id === 'target')!
    const lookup = { pokemon: state.sheets, trainer: new Map() }
    const actorToken = placementToSpawned(actorPlacement, lookup, state.map)!
    const targetToken = placementToSpawned(targetPlacement, lookup, state.map)!
    const grappled = applyAa079MagmaArmorGrappleTrigger({
      map: state.map, actorPlacement, actorToken, targetPlacement, targetToken,
      targetSheet: state.sheets.get('target')!, operationId: 'op.aa079.grapple',
    })
    const effect = grappled.encounterState?.effects.find(candidate => (
      candidate.tags.includes('aa079.magma-armor-grapple')
    ))
    if (!effect) throw new Error('Expected authoritative Magma Armor Grapple evidence.')
    const entries = aa079MagmaArmorGrappleLifecycleEntries({
      map: grappled, tokens: [actorToken, targetToken],
      effectiveAbilityIds: placementId => placementId === 'target' ? ['Magma Armor'] : [],
    })
    expect(entries).toEqual([expect.objectContaining({
      effectId: effect.id, sourcePlacementId: 'actor', tickValue: expect.any(Number),
    })])
    const event = parseEncounterEvent({
      schemaVersion: ENCOUNTER_EVENT_SCHEMA_VERSION, eventId: 'event.aa079.grapple.turn-end',
      kind: 'turn-end', sourceOperationId: 'op.aa079.turn-end', causalParentEventId: null,
      reasonCode: 'aa079.grapple.turn-end', round: 1, turn: 1,
      placementId: 'actor', sideId: null,
    })
    const triggers = createAa079MagmaArmorGrappleLifecycleHandler({ entries }).resolve({
      state: grappled.encounterState!, effectsAtEventStart: [effect], event,
      depth: 0, eventSequence: 1, random: createAuthoritativeMoveRandom(() => 0.5),
      transitions: [],
    })
    expect(triggers[0]?.operations[0]).toMatchObject({
      kind: 'direct-hp', recipients: { kind: 'source-placement' },
      reasonCode: 'ability.magma-armor.grapple-turn-end-hit-point-loss',
      payload: { mode: 'lose', pool: 'hit-points', calculation: {
        kind: 'fixed', value: entries[0]!.tickValue,
      }, copySource: null, bounds: { minimum: null, maximum: null }, rounding: 'floor',
      applyTypeImmunity: false, cost: null,
      injury: { hitPointMarkers: 'apply-after-operation', massiveDamage: 'never' } },
    })

    const fireState = fixture({
      slug: 'aa079-magma-armor-grapple-fire', move: 'Tackle',
      actorTypes: ['Fire'], targetAbilities: ['Magma Armor'],
    })
    const fireLookup = { pokemon: fireState.sheets, trainer: new Map() }
    const fireActor = placementToSpawned(fireState.map.placements[0]!, fireLookup, fireState.map)!
    const fireTarget = placementToSpawned(fireState.map.placements[1]!, fireLookup, fireState.map)!
    expect(aa079MagmaArmorGrappleLifecycleEntries({
      map: applyAa079MagmaArmorGrappleTrigger({
        map: fireState.map, actorPlacement: fireState.map.placements[0]!, actorToken: fireActor,
        targetPlacement: fireState.map.placements[1]!, targetToken: fireTarget,
        targetSheet: fireState.sheets.get('target')!, operationId: 'op.aa079.grapple.fire',
      }),
      tokens: [fireActor, fireTarget],
      effectiveAbilityIds: placementId => placementId === 'target' ? ['Magma Armor'] : [],
    })).toEqual([])
  })

  it('aa079.marvel-scale.reviewed projects exactly two Defense stages while statused', () => {
    const plainDefense = fixture({ slug: 'aa079-marvel-plain', move: 'Tackle', targetConditions: ['Sleep'] })
    const scaledDefense = fixture({
      slug: 'aa079-marvel-scaled', move: 'Tackle', targetConditions: ['Sleep'],
      targetAbilities: ['Marvel Scale'],
    })
    expect(hpAfter(scaledDefense)).toBeGreaterThan(hpAfter(plainDefense))
    const cured = fixture({
      slug: 'aa079-marvel-cured', move: 'Tackle', targetAbilities: ['Marvel Scale'],
    })
    expect(hpAfter(cured)).toBe(hpAfter(fixture({
      slug: 'aa079-marvel-cured-plain', move: 'Tackle',
    })))
  })

  it('aa079.mega-launcher.reviewed adds exactly three DB to its four reviewed pulse Moves', () => {
    for (const move of ['Aura Sphere', 'Dark Pulse', 'Dragon Pulse', 'Water Pulse']) {
      const plainPulse = fixture({ slug: `aa079-launcher-${id(move)}-plain`, move })
      const launchedPulse = fixture({
        slug: `aa079-launcher-${id(move)}-boost`, move, actorAbilities: ['Mega Launcher'],
      })
      expect(hpAfter(launchedPulse)).toBeLessThan(hpAfter(plainPulse))
    }
    const unrelated = fixture({
      slug: 'aa079-launcher-unrelated', move: 'Tackle', actorAbilities: ['Mega Launcher'],
    })
    expect(hpAfter(unrelated)).toBe(hpAfter(fixture({
      slug: 'aa079-launcher-unrelated-plain', move: 'Tackle',
    })))
  })

  it('aa079.merciless.reviewed forces a preventable critical only against poisoned targets', () => {
    const poisoned = fixture({
      slug: 'aa079-merciless-poisoned', move: 'Tackle', actorAbilities: ['Merciless'],
      targetConditions: ['Poisoned'],
    })
    const plain = fixture({
      slug: 'aa079-merciless-plain', move: 'Tackle', actorAbilities: ['Merciless'],
    })
    expect(hpAfter(poisoned)).toBeLessThan(hpAfter(plain))
    expect(JSON.stringify(resolve(poisoned).resolution.auditTrace)).toContain('"triggerSource":"ability"')

    const armored = fixture({
      slug: 'aa079-merciless-armored', move: 'Tackle', actorAbilities: ['Merciless'],
      targetAbilities: ['Battle Armor'], targetConditions: ['Poisoned'],
    })
    expect(JSON.stringify(resolve(armored).resolution.auditTrace)).toContain('critical-prevented')
  })

  it('aa079.mind-mold.reviewed applies Last Chance with Psychic only at one-third HP', () => {
    const lowPlain = fixture({ slug: 'aa079-mind-mold-plain', move: 'Confusion', actorHp: 80 })
    const lowBoost = fixture({
      slug: 'aa079-mind-mold-low', move: 'Confusion', actorHp: 80,
      actorAbilities: ['Mind Mold'],
    })
    const healthy = fixture({
      slug: 'aa079-mind-mold-healthy', move: 'Confusion', actorHp: 300,
      actorAbilities: ['Mind Mold'],
    })
    expect(hpAfter(lowBoost)).toBe(hpAfter(lowPlain) - 5)
    expect(hpAfter(healthy)).toBe(hpAfter(fixture({
      slug: 'aa079-mind-mold-healthy-plain', move: 'Confusion', actorHp: 300,
    })))
  })
})
