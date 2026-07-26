import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA081_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa081'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { resolveAuthoritativeMoveUserAccuracy } from '../../server/domain/moveAutomation/accuracy'
import { aa081MudShieldTerrainApplies } from '../../server/domain/abilityAutomation/mechanics/aa081StaticIntegration'
import { resolveMoveAutomationTargetEvasion } from '~/utils/moveAutomationAccuracy'

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
  types?: readonly string[]
  speed?: number
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 30, revision: 3,
  types: [...(input.types ?? ['Normal'])], abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: input.speed ?? 40 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 300, injuries: 0, conditions: [] },
})
const fixture = (input: {
  slug: string
  move: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  actorTypes?: readonly string[]
  targetTypes?: readonly string[]
  targetHp?: number
  actorSpeed?: number
  distance?: number
  voxels?: TabletopMap['voxels']
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 1, z: 2 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2 + (input.distance ?? 1), y: 1, z: 2 } },
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 14, y: 5, z: 14 }, groundLevelY: 0,
    voxels: input.voxels ?? [], hazards: [], placements,
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
    activeScene: { name: 'Scene', startedAt: 100 }, metadata: {},
  }
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor', move: input.move, abilities: input.actorAbilities,
      types: input.actorTypes, speed: input.actorSpeed,
    })],
    ['target', sheet({
      slug: 'target', abilities: input.targetAbilities,
      types: input.targetTypes, currentHp: input.targetHp,
    })],
  ])
  return { map, sheets, move: input.move }
}
type State = ReturnType<typeof fixture>
const resolve = (state: State) => planAuthoritativeMoveState({
  map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
  intent: {
    schemaVersion: 1, placementId: 'actor', moveName: state.move,
    selection: { kind: 'single-target', targetPlacementId: 'target' },
  },
  random: () => 0.75, now: () => 1_000, operationId: `op_${id(state.map.slug)}`,
})
const hp = (state: State): number => {
  const plan = resolve(state)
  return ((plan.sheetWrites.find(write => write.slug === 'target')?.nextSheet
    ?? state.sheets.get('target')!) as CharacterSheet).combat?.currentHp ?? 0
}

const accuracy = (state: State, actor = 'actor', target = 'target') => {
  const context = buildAuthoritativeMoveRulesContext({
    map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: actor, moveName: state.move,
      selection: { kind: 'single-target', targetPlacementId: target },
    },
    candidatePlacementIds: [target], selectedPlacementIds: [target],
    random: () => 0.75, time: 1_000,
  })
  return resolveAuthoritativeMoveUserAccuracy(context, {
    targetPlacementId: target,
    script: context.queries.rules.reviewedScriptFor(state.move) ?? undefined,
  })
}

describe('AA-081 static integrations', () => {
  it('selects all twelve exact reviewed runtimes', () => {
    expect(AA081_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Mud Dweller', 'Mud Shield', 'Multiscale', 'Multitype', 'Mummy', 'Natural Cure',
      'Needles', 'Neuroforce', 'Neutralizing Gas', 'Nimble Strikes', 'No Guard', 'Normalize',
    ])
    for (const spec of AA081_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId, kind: 'abilityspec-v1', version: 1,
        sourceModule: 'server/domain/abilityAutomation/specs/aa081.ts',
      })
    }
  })

  it('applies Mud Dweller and full-HP Multiscale as one exact resistance step', () => {
    const plainWater = fixture({ slug: 'aa081-mud-plain', move: 'Water Gun', targetTypes: ['Fire'] })
    const mud = fixture({
      slug: 'aa081-mud-active', move: 'Water Gun', targetTypes: ['Fire'], targetAbilities: ['Mud Dweller'],
    })
    expect(hp(mud)).toBeGreaterThan(hp(plainWater))
    const full = fixture({
      slug: 'aa081-multiscale-full', move: 'Tackle', targetAbilities: ['Multiscale'], targetHp: 358,
    })
    const damaged = fixture({
      slug: 'aa081-multiscale-damaged', move: 'Tackle', targetAbilities: ['Multiscale'], targetHp: 357,
    })
    const plain = fixture({ slug: 'aa081-multiscale-plain', move: 'Tackle', targetHp: 358 })
    expect(358 - hp(full)).toBeLessThan(358 - hp(plain))
    expect(357 - hp(damaged)).toBe(358 - hp(plain))
  })

  it('adds Neuroforce before effectiveness and half Speed only to physical Normal damage', () => {
    const neuroPlain = fixture({ slug: 'aa081-neuro-plain', move: 'Water Gun', targetTypes: ['Fire'] })
    const neuro = fixture({
      slug: 'aa081-neuro', move: 'Water Gun', targetTypes: ['Fire'], actorAbilities: ['Neuroforce'],
    })
    expect(hp(neuroPlain) - hp(neuro)).toBe(15)

    const nimblePlain = fixture({ slug: 'aa081-nimble-plain', move: 'Tackle', actorSpeed: 40 })
    const nimble = fixture({
      slug: 'aa081-nimble', move: 'Tackle', actorSpeed: 40, actorAbilities: ['Nimble Strikes'],
    })
    // Eevee's authoritative resolved Speed is 46 in this fixture.
    expect(hp(nimblePlain) - hp(nimble)).toBe(23)
    const special = fixture({
      slug: 'aa081-nimble-special', move: 'Echoed Voice', actorSpeed: 40, actorAbilities: ['Nimble Strikes'],
    })
    expect(hp(special)).toBe(hp(fixture({ slug: 'aa081-nimble-special-plain', move: 'Echoed Voice', actorSpeed: 40 })))
  })

  it('Normalize neutralizes non-immune outgoing and incoming relations but preserves immunity', () => {
    const outgoing = fixture({
      slug: 'aa081-normalize-out', move: 'Water Gun', actorAbilities: ['Normalize'], targetTypes: ['Fire'],
    })
    const neutral = fixture({ slug: 'aa081-normalize-neutral', move: 'Water Gun', targetTypes: ['Normal'] })
    expect(300 - hp(outgoing)).toBe(300 - hp(neutral))

    const incoming = fixture({
      slug: 'aa081-normalize-in', move: 'Water Gun', targetAbilities: ['Normalize'], targetTypes: ['Fire'],
    })
    expect(300 - hp(incoming)).toBe(300 - hp(neutral))
    const immune = fixture({
      slug: 'aa081-normalize-immune', move: 'Tackle', actorAbilities: ['Normalize'], targetTypes: ['Ghost'],
    })
    expect(hp(immune)).toBe(300)
  })

  it('No Guard grants +3 outgoing Accuracy and +3 against its user from effective projections', () => {
    const plain = fixture({ slug: 'aa081-no-guard-plain', move: 'Tackle' })
    const outgoing = fixture({ slug: 'aa081-no-guard-out', move: 'Tackle', actorAbilities: ['No Guard'] })
    expect(accuracy(outgoing).value - accuracy(plain).value).toBe(3)

    const incoming = fixture({ slug: 'aa081-no-guard-in', move: 'Tackle', targetAbilities: ['No Guard'] })
    const incomingContext = buildAuthoritativeMoveRulesContext({
      map: incoming.map, pokemonSheets: incoming.sheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      candidatePlacementIds: ['target'], selectedPlacementIds: ['target'], random: () => 0.75, time: 1_000,
    })
    const evasion = resolveMoveAutomationTargetEvasion(
      incomingContext.queries.rules.reviewedScriptFor('Tackle'),
      incomingContext.queries.tokens.get('target')!,
      { attacker: incomingContext.actor.token },
    )
    expect(evasion.abilityModifier).toBe(-3)
  })

  it('Mud Shield reads only supporting structured muddy and Slow/Rough terrain', () => {
    const active = fixture({
      slug: 'aa081-mud-shield-terrain', move: 'Tackle', targetAbilities: ['Mud Shield'],
      voxels: [{ x: 3, y: 0, z: 2, materialId: 'mud', tags: ['slow'] }],
    })
    const context = buildAuthoritativeMoveRulesContext({
      map: active.map, pokemonSheets: active.sheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      candidatePlacementIds: ['target'], selectedPlacementIds: ['target'], random: () => 0.75, time: 1_000,
    })
    expect(aa081MudShieldTerrainApplies({ context, recipient: context.queries.tokens.get('target')! })).toBe(true)
    expect(hp(active)).toBe(hp(fixture({ slug: 'aa081-mud-shield-plain', move: 'Tackle' })) + 5)
  })
})
