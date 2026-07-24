import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import {
  parseMoveEffectOperation,
  type MoveCheckEffectOperation,
  type MoveConditionEffectOperation,
} from '#shared/moveAutomation/effects'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA075_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa075'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { resolveAuthoritativeMoveUserAccuracy } from '../../server/domain/moveAutomation/accuracy'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { executeMoveCheckOperation } from '../../server/domain/moveAutomation/checks'
import { createStandardMoveCoreTokenEffectImmunityQueries } from '../../server/domain/moveAutomation/reducers/immunities'
import { resolveMoveCoreTokenRecipient } from '../../server/domain/moveAutomation/reducers/coreTokenRecipients'
import { resolveWeatherResidualImmunity } from '../../server/domain/moveAutomation/weatherLifecycle'
import {
  creatureRuleOverlayEncounterEffectFixture,
  capabilityEncounterEffectFixture,
  numericEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'
import { SUBSTITUTE_COAT_CAPABILITY_ID } from '#shared/moveAutomation/substitute'

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
  move?: string
  abilities?: readonly string[]
  currentHp?: number
  capabilities?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: ['Normal'],
  abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  ...(input.capabilities ? { capabilities: { other: [...input.capabilities] } } : {}),
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 150, injuries: 0, conditions: [] },
})

const fixture = (input: {
  slug: string
  move: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  actorCapabilities?: readonly string[]
  effects?: readonly EncounterEffect[]
  targetTemporaryHp?: number
  activeId?: string
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
    dimensions: { x: 12, y: 4, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [], hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
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
        currentTurn: { round: 1, turn: 1, placementId: input.activeId ?? 'actor' },
      },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: input.activeId ?? 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
    ...(input.targetTemporaryHp === undefined ? {} : {
      temporaryHitPoints: {
        scene: { name: 'Scene', startedAt: 100 },
        byPlacementId: { target: input.targetTemporaryHp },
      },
    }),
  }
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor', move: input.move, abilities: input.actorAbilities,
      capabilities: input.actorCapabilities,
    })],
    ['target', sheet({ slug: 'target', abilities: input.targetAbilities })],
  ])
  return { map, sheets, moveName: input.move }
}

const context = (state: ReturnType<typeof fixture>) => buildAuthoritativeMoveRulesContext({
  map: state.map,
  pokemonSheets: state.sheets,
  trainerSheets: new Map(),
  intent: {
    schemaVersion: 1,
    placementId: 'actor',
    moveName: state.moveName,
    selection: { kind: 'single-target', targetPlacementId: 'target' },
  },
  random: () => 0,
  time: 1_000,
})

const resolve = (state: ReturnType<typeof fixture>, random = () => 0.75) => planAuthoritativeMoveState({
  map: state.map,
  pokemonSheets: state.sheets,
  trainerSheets: new Map(),
  intent: {
    schemaVersion: 1,
    placementId: 'actor',
    moveName: state.moveName,
    selection: { kind: 'single-target', targetPlacementId: 'target' },
  },
  random,
  now: () => 1_000,
  operationId: `op_${inputId(state.map.slug)}`,
})
const inputId = (value: string): string => value.replace(/[^a-zA-Z0-9_]+/g, '_')
const nextSheet = (plan: ReturnType<typeof resolve>, slug: string, original: ReadonlyMap<string, CharacterSheet>): CharacterSheet => (
  plan.sheetWrites.find(write => write.slug === slug)?.nextSheet ?? original.get(slug)!
) as CharacterSheet

const suppression = (placementId: string): EncounterEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'ability', action: 'suppress', values: [],
    referencePlacementId: null, suppressionScope: 'all',
  }),
  id: `effect.aa075.suppress.${placementId}`,
  affected: { placementIds: [placementId], sideIds: [], cells: [] },
})

describe('AA-075 static integrations', () => {
  it('selects all twelve reviewed AA-075 runtimes', () => {
    expect(AA075_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Hypnotic', 'Ice Body', 'Ice Face', 'Ice Scales', 'Ice Shield',
      'Ignition Boost', 'Illuminate', 'Illusion', 'Immunity', 'Imposter',
      'Infiltrator', 'Innards Out',
    ])
    for (const spec of AA075_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId,
        kind: 'abilityspec-v1',
        version: 1,
        sourceModule: 'server/domain/abilityAutomation/specs/aa075.ts',
      })
    }
  })

  it('aa075.hypnotic.reviewed supplies Hypnosis and seals an automatic hit', () => {
    const state = fixture({ slug: 'aa075-hypnotic', move: 'Hypnosis', actorAbilities: ['Hypnotic'] })
    state.sheets.get('actor')!.movelist = []
    const plan = resolve(state, () => 0)
    expect(nextSheet(plan, 'target', state.sheets).combat?.conditions).toContain('Sleep')
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('ability.hypnotic.automatic-hit')

    const suppressed = fixture({
      slug: 'aa075-hypnotic-suppressed', move: 'Hypnosis', actorAbilities: ['Hypnotic'],
      effects: [suppression('actor')],
    })
    suppressed.sheets.get('actor')!.movelist = []
    expect(() => resolve(suppressed, () => 0)).toThrow(/not available|move/i)
  }, 30_000)

  it('aa075.illuminate.reviewed applies -2 except against authoritative Blindsense', () => {
    const base = context(fixture({ slug: 'aa075-illuminate-base', move: 'Tackle' }))
    const active = context(fixture({
      slug: 'aa075-illuminate-active', move: 'Tackle', targetAbilities: ['Illuminate'],
    }))
    const script = active.queries.rules.reviewedScriptFor('Tackle')!
    expect(resolveAuthoritativeMoveUserAccuracy(active, { targetPlacementId: 'target', script }).value)
      .toBe(resolveAuthoritativeMoveUserAccuracy(base, { targetPlacementId: 'target', script }).value - 2)

    const bypass = context(fixture({
      slug: 'aa075-illuminate-blindsense', move: 'Tackle', targetAbilities: ['Illuminate'],
      actorCapabilities: ['Blindsense 4'],
    }))
    expect(resolveAuthoritativeMoveUserAccuracy(bypass, { targetPlacementId: 'target', script }).value)
      .toBe(resolveAuthoritativeMoveUserAccuracy(base, { targetPlacementId: 'target', script }).value)
  })

  it('aa075.ice-face.reviewed grants effective Hail damage immunity only', () => {
    const activeState = fixture({
      slug: 'aa075-ice-face-hail-immunity', move: 'Tackle', targetAbilities: ['Ice Face'],
    })
    const suppressedState = fixture({
      slug: 'aa075-ice-face-hail-suppressed', move: 'Tackle', targetAbilities: ['Ice Face'],
      effects: [suppression('target')],
    })
    const active = context(activeState)
    const suppressed = context(suppressedState)
    expect(resolveWeatherResidualImmunity({
      weatherKind: 'hail', context: active,
      recipient: resolveMoveCoreTokenRecipient(active, 'target'),
    }).blockedBy).toBe('Ice Face')
    expect(resolveWeatherResidualImmunity({
      weatherKind: 'hail', context: suppressed,
      recipient: resolveMoveCoreTokenRecipient(suppressed, 'target'),
    }).blockedBy).toBeNull()
  })

  it('aa075.ice-scales.reviewed resists ordinary and multi-hit Special damage only while effective', () => {
    const ordinaryState = fixture({ slug: 'aa075-ice-scales-plain', move: 'Water Gun' })
    const activeState = fixture({
      slug: 'aa075-ice-scales-active', move: 'Water Gun', targetAbilities: ['Ice Scales'],
    })
    const suppressedState = fixture({
      slug: 'aa075-ice-scales-suppressed', move: 'Water Gun', targetAbilities: ['Ice Scales'],
      effects: [suppression('target')],
    })
    const ordinary = resolve(ordinaryState)
    const active = resolve(activeState)
    const suppressed = resolve(suppressedState)
    expect(nextSheet(active, 'target', activeState.sheets).combat!.currentHp ?? 0)
      .toBeGreaterThan(nextSheet(ordinary, 'target', ordinaryState.sheets).combat!.currentHp ?? 0)
    expect(nextSheet(suppressed, 'target', suppressedState.sheets).combat!.currentHp)
      .toBe(nextSheet(ordinary, 'target', ordinaryState.sheets).combat!.currentHp)

    const multiPlainState = fixture({ slug: 'aa075-ice-scales-multi-plain', move: 'Water Shuriken' })
    const multiActiveState = fixture({
      slug: 'aa075-ice-scales-multi-active', move: 'Water Shuriken', targetAbilities: ['Ice Scales'],
    })
    const multiPlain = resolve(multiPlainState)
    const multiActive = resolve(multiActiveState)
    expect(nextSheet(multiActive, 'target', multiActiveState.sheets).combat!.currentHp ?? 0)
      .toBeGreaterThan(nextSheet(multiPlain, 'target', multiPlainState.sheets).combat!.currentHp ?? 0)
  }, 30_000)

  it('aa075.immunity.reviewed blocks both poison conditions and fails closed under suppression', () => {
    const activeState = fixture({ slug: 'aa075-immunity', move: 'Toxic', targetAbilities: ['Immunity'] })
    const suppressedState = fixture({
      slug: 'aa075-immunity-suppressed', move: 'Toxic', targetAbilities: ['Immunity'],
      effects: [suppression('target')],
    })
    expect(nextSheet(resolve(activeState), 'target', activeState.sheets).combat?.conditions).toEqual([])
    expect(nextSheet(resolve(suppressedState), 'target', suppressedState.sheets).combat?.conditions)
      .toContain('Badly Poisoned')

    const immunityContext = context(activeState)
    const baseOperation: MoveConditionEffectOperation = {
      id: 'aa075.immunity.condition', kind: 'condition',
      source: { kind: 'move', id: 'move.test-immunity' },
      recipients: { kind: 'selected-targets' }, phase: 'hit',
      reasonCode: 'aa075.immunity.condition',
      payload: {
        action: 'apply', conditionId: 'poisoned', conditionSource: null,
        filter: null, randomChoice: null, duration: null, saveTiming: 'canonical',
        stackPolicy: { kind: 'refresh', maxStacks: null },
      },
    }
    const recipient = resolveMoveCoreTokenRecipient(immunityContext, 'target')
    const immunity = createStandardMoveCoreTokenEffectImmunityQueries({
      moveType: null, context: immunityContext,
    })
    expect(immunity.condition({ operation: baseOperation, condition: 'Poisoned', recipient }).blockedBy)
      .toBe('Immunity')
    expect(immunity.condition({
      operation: {
        ...baseOperation,
        payload: { ...baseOperation.payload, action: 'remove' },
      },
      condition: 'Poisoned',
      recipient,
    }).blockedBy).toBeNull()
  }, 30_000)

  it('aa075.infiltrator.reviewed adds exactly +2 to authoritative Stealth Checks', () => {
    const ordinary = context(fixture({ slug: 'aa075-infiltrator-stealth-plain', move: 'Tackle' }))
    const active = context(fixture({
      slug: 'aa075-infiltrator-stealth', move: 'Tackle', actorAbilities: ['Infiltrator'],
    }))
    const operation = parseMoveEffectOperation({
      id: 'aa075.infiltrator.stealth-check',
      kind: 'check',
      source: { kind: 'move', id: 'move.stealth-test' },
      recipients: { kind: 'attacked-targets' },
      phase: 'hit',
      reasonCode: 'aa075.infiltrator.stealth-check',
      payload: {
        kind: 'opposed', checkId: 'aa075.infiltrator.stealth',
        actorRoll: {
          rollId: 'aa075.infiltrator.actor-roll',
          source: { kind: 'skill', skill: 'stealth' }, modifiers: [],
          reroll: { count: 0, keep: 'latest' }, resourceReroll: null,
        },
        targetRoll: {
          rollId: 'aa075.infiltrator.target-roll',
          source: { kind: 'skill', skill: 'perception' }, modifiers: [],
          reroll: { count: 0, keep: 'latest' }, resourceReroll: null,
        },
        tie: { kind: 'failure' },
        branches: { success: 'stealth.success', failure: 'stealth.failure' },
      },
    }) as MoveCheckEffectOperation
    const execute = (moveContext: typeof ordinary) => executeMoveCheckOperation({
      context: moveContext,
      operation,
      recipientIds: ['target'],
      selectorState: {
        targetIds: ['target'], hitTargetIds: ['target'], missedTargetIds: [],
        damagedTargetIds: [], faintedTargetIds: [],
      },
      canonicalMoveId: 'Stealth Test',
    })
    const ordinaryResult = execute(ordinary)
    const activeResult = execute(active)
    expect(activeResult.kind).toBe('complete')
    expect(activeResult.resolutions[0]?.actor?.finalValue)
      .toBe((ordinaryResult.resolutions[0]?.actor?.finalValue ?? 0) + 2)
    expect(activeResult.resolutions[0]?.actor?.modifiers).toContainEqual(expect.objectContaining({
      sourceId: 'ability.infiltrator', value: 2,
    }))
  })

  it('aa075.infiltrator.reviewed prevents responsive Blessing activation and charge consumption', () => {
    const base = numericEncounterEffectFixture()
    const blessing: EncounterEffect = {
      ...base,
      id: 'effect.aa075.reflect-blessing',
      affected: { placementIds: [], sideIds: ['foes'], cells: [] },
      duration: { kind: 'scene', remaining: null },
      charges: 2,
      tags: ['blessing', 'damage-resistance'],
      payload: {
        attribute: 'damage-reduction', operation: 'resist-step', value: 1,
        rounding: 'none', damageClass: 'physical',
      },
    }
    const plainState = fixture({
      slug: 'aa075-infiltrator-blessing-plain', move: 'Tackle', effects: [blessing],
    })
    const activeState = fixture({
      slug: 'aa075-infiltrator-blessing', move: 'Tackle', actorAbilities: ['Infiltrator'],
      effects: [blessing],
    })
    const plain = resolve(plainState)
    const active = resolve(activeState)
    expect(nextSheet(active, 'target', activeState.sheets).combat!.currentHp ?? 0)
      .toBeLessThan(nextSheet(plain, 'target', plainState.sheets).combat!.currentHp ?? 0)
    expect(plain.nextMap.encounterState?.effects.find(effect => effect.id === blessing.id)?.charges).toBe(1)
    expect(active.nextMap.encounterState?.effects.find(effect => effect.id === blessing.id)?.charges).toBe(2)
    expect(active.resolution.sideDamageResistance?.evaluations).toContainEqual(expect.objectContaining({
      reasonCode: 'side-damage-resistance.responsive-activation-blocked',
    }))
  }, 30_000)

  it('aa075.infiltrator.reviewed bypasses Substitute Temporary HP without consuming it', () => {
    const coat = capabilityEncounterEffectFixture()
    const effects: EncounterEffect[] = [{
      ...coat,
      id: 'substitute.coat',
      affected: { placementIds: ['target'], sideIds: [], cells: [] },
      tags: ['substitute', 'coat'],
      payload: { capabilityId: SUBSTITUTE_COAT_CAPABILITY_ID, action: 'grant' },
    }]
    const plainState = fixture({
      slug: 'aa075-infiltrator-plain', move: 'Tackle', effects, targetTemporaryHp: 40,
    })
    const activeState = fixture({
      slug: 'aa075-infiltrator-active', move: 'Tackle', actorAbilities: ['Infiltrator'],
      effects, targetTemporaryHp: 40,
    })
    const plain = resolve(plainState)
    const active = resolve(activeState)
    expect(nextSheet(plain, 'target', plainState.sheets).combat?.currentHp).toBe(150)
    expect(plain.nextMap.temporaryHitPoints?.byPlacementId.target).toBeLessThan(40)
    expect(nextSheet(active, 'target', activeState.sheets).combat!.currentHp).toBeLessThan(150)
    expect(active.nextMap.temporaryHitPoints?.byPlacementId.target).toBe(40)

    const unrelatedState = fixture({
      slug: 'aa075-infiltrator-unrelated-thp', move: 'Tackle',
      actorAbilities: ['Infiltrator'], targetTemporaryHp: 40,
    })
    const unrelated = resolve(unrelatedState)
    expect(nextSheet(unrelated, 'target', unrelatedState.sheets).combat?.currentHp).toBe(150)
    expect(unrelated.nextMap.temporaryHitPoints?.byPlacementId.target).toBeLessThan(40)
  }, 30_000)

  it('aa075.imposter.reviewed uses Transform as an out-of-turn Free-Action Interrupt', () => {
    const state = fixture({
      slug: 'aa075-imposter', move: 'Transform', actorAbilities: ['Imposter'], activeId: 'target',
    })
    state.sheets.get('actor')!.movelist = []
    const plan = resolve(state)
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.standard.spent).toBe(0)
    expect(plan.resolution.abilityFreeInterruptOverride).toBe(true)
  }, 30_000)
})
