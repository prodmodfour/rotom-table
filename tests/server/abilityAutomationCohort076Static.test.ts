import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { parseEncounterZone, type EncounterZone } from '#shared/moveAutomation/encounterZones'
import {
  parseMoveEffectOperation,
  type MoveCheckEffectOperation,
  type MoveConditionEffectOperation,
} from '#shared/moveAutomation/effects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA076_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa076'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { resolveAuthoritativeMoveUserAccuracy } from '../../server/domain/moveAutomation/accuracy'
import { executeMoveSpec } from '../../server/domain/moveAutomation/executeSpec'
import { registeredMoveAutomationRuntimeFor } from '../../server/domain/moveAutomation/registry'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { createStandardMoveCoreTokenEffectImmunityQueries } from '../../server/domain/moveAutomation/reducers/immunities'
import { resolveMoveCoreTokenRecipient } from '../../server/domain/moveAutomation/reducers/coreTokenRecipients'
import { executeMoveCheckOperation } from '../../server/domain/moveAutomation/checks'
import {
  aa076InnerFocusProtectsInitiative,
  aa076InstinctEvasionBonus,
} from '../../server/domain/abilityAutomation/mechanics/aa076StaticIntegration'
import { conditionAdjustedInitiative } from '~/utils/sheetConditionEffects'
import {
  creatureRuleOverlayEncounterEffectFixture,
  numericEncounterEffectFixture,
} from '../fixtures/moveAutomation/encounterEffects'

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
  conditions?: readonly string[]
  types?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: [...(input.types ?? ['Normal'])],
  abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 80 }, atk: { added: 35 }, def: { added: 25 },
    satk: { added: 35 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 220, injuries: 0, conditions: [...(input.conditions ?? [])] },
})

const suppression = (placementId: string): EncounterEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'ability', action: 'suppress', values: [],
    referencePlacementId: null, suppressionScope: 'all',
  }),
  id: `effect.aa076.suppress.${placementId}`,
  affected: { placementIds: [placementId], sideIds: [], cells: [] },
})

const grantAbility = (placementId: string, canonicalId: string): EncounterEffect => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'ability', action: 'add', values: [canonicalId],
    referencePlacementId: null, suppressionScope: null,
  }),
  id: `effect.aa076.grant.${placementId}.${id(canonicalId)}`,
  affected: { placementIds: [placementId], sideIds: [], cells: [] },
})

const smokeZone = (zoneId: string): EncounterZone => parseEncounterZone({
  id: zoneId,
  kind: 'smoke',
  source: {
    kind: 'operation', operationId: `operation.${zoneId}`,
    moveId: 'smokescreen', placementId: 'target',
  },
  sideId: 'foes',
  geometry: { kind: 'cells', cells: [{ x: 1, y: 0, z: 1 }] },
  layer: 1,
  duration: { kind: 'scene', remaining: null },
  stacking: { kind: 'refresh', maxLayers: null },
  hooks: { entry: [], exit: [] },
  modifiers: { targeting: [], damage: [], movement: [] },
  tags: ['smoke', 'smokescreen'],
  payload: { smokeId: 'smokescreen' },
})

const fixture = (input: {
  slug: string
  move?: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  actorConditions?: readonly string[]
  targetConditions?: readonly string[]
  effects?: readonly EncounterEffect[]
  zones?: readonly EncounterZone[]
  targetPosition?: { readonly x: number; readonly y: number; readonly z: number }
  voxels?: TabletopMap['voxels']
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    {
      id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes',
      position: input.targetPosition ?? { x: 2, y: 0, z: 1 },
    },
  ]
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: input.slug,
    name: input.slug,
    revision: 5,
    dimensions: { x: 12, y: 4, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [...(input.voxels ?? [])], hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements,
    encounterState: {
      ...encounter,
      effects: [...(input.effects ?? [])],
      zones: [...(input.zones ?? [])],
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
  const move = input.move ?? 'Tackle'
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({
      slug: 'actor', move, abilities: input.actorAbilities,
      conditions: input.actorConditions,
    })],
    ['target', sheet({
      slug: 'target', abilities: input.targetAbilities, conditions: input.targetConditions,
    })],
  ])
  return { map, sheets, move }
}

const context = (state: ReturnType<typeof fixture>) => buildAuthoritativeMoveRulesContext({
  map: state.map,
  pokemonSheets: state.sheets,
  trainerSheets: new Map(),
  intent: {
    schemaVersion: 1,
    placementId: 'actor',
    moveName: state.move,
    selection: state.move === 'Rest'
      ? { kind: 'self' }
      : { kind: 'single-target', targetPlacementId: 'target' },
  },
  random: () => 0.75,
  time: 1_000,
})

const resolve = (state: ReturnType<typeof fixture>, random = () => 0.75) => planAuthoritativeMoveState({
  map: state.map,
  pokemonSheets: state.sheets,
  trainerSheets: new Map(),
  intent: {
    schemaVersion: 1,
    placementId: 'actor',
    moveName: state.move,
    selection: state.move === 'Rest'
      ? { kind: 'self' }
      : { kind: 'single-target', targetPlacementId: 'target' },
  },
  random,
  now: () => 1_000,
  operationId: `op_${inputId(state.map.slug)}`,
})
const inputId = (value: string): string => value.replace(/[^a-zA-Z0-9_]+/g, '_')
const nextSheet = (
  plan: ReturnType<typeof resolve>,
  slug: string,
  original: ReadonlyMap<string, CharacterSheet>,
): CharacterSheet => (plan.sheetWrites.find(write => write.slug === slug)?.nextSheet
  ?? original.get(slug)) as CharacterSheet

const conditionOperation = (conditionId: string): MoveConditionEffectOperation => ({
  id: `aa076.condition.${conditionId}`,
  kind: 'condition',
  source: { kind: 'move', id: 'move.aa076-condition-test' },
  recipients: { kind: 'selected-targets' },
  phase: 'hit',
  reasonCode: 'aa076.condition-test',
  payload: {
    action: 'apply', conditionId, conditionSource: null,
    filter: null, randomChoice: null, duration: null, saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
})

describe('AA-076 static integrations', () => {
  it('selects all twelve reviewed AA-076 runtimes', () => {
    expect(AA076_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Inner Focus', 'Insomnia', 'Instinct', 'Interference', 'Intimidate',
      'Intrepid Sword', 'Iron Barbs', 'Iron Fist', 'Juicy Energy', 'Justified',
      'Kampfgeist', 'Keen Eye',
    ])
    for (const spec of AA076_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId,
        kind: 'abilityspec-v1',
        version: 1,
        sourceModule: 'server/domain/abilityAutomation/specs/aa076.ts',
      })
    }
  })

  it('aa076.inner-focus.reviewed blocks Flinch and every unwilling Initiative reduction only while effective', () => {
    const activeState = fixture({ slug: 'aa076-inner-focus', targetAbilities: ['Inner Focus'] })
    const active = context(activeState)
    const recipient = resolveMoveCoreTokenRecipient(active, 'target')
    const immunity = createStandardMoveCoreTokenEffectImmunityQueries({ moveType: null, context: active })
    expect(immunity.condition({
      operation: conditionOperation('flinch'), condition: 'Flinch', recipient,
    }).blockedBy).toBe('Inner Focus')

    const suppressedState = fixture({
      slug: 'aa076-inner-focus-suppressed', targetAbilities: ['Inner Focus'],
      effects: [suppression('target')],
    })
    const suppressed = context(suppressedState)
    expect(createStandardMoveCoreTokenEffectImmunityQueries({ moveType: null, context: suppressed }).condition({
      operation: conditionOperation('flinch'), condition: 'Flinch',
      recipient: resolveMoveCoreTokenRecipient(suppressed, 'target'),
    }).blockedBy).toBeNull()

    const initiativeState = fixture({
      slug: 'aa076-inner-focus-initiative', actorAbilities: ['Inner Focus'],
      actorConditions: ['Paralysis', 'Flinch'],
    })
    expect(aa076InnerFocusProtectsInitiative({
      map: initiativeState.map,
      placement: initiativeState.map.placements[0]!,
      sheet: initiativeState.sheets.get('actor')!,
    })).toBe(true)
    expect(conditionAdjustedInitiative(20, ['Paralysis', 'Flinch'], {
      abilities: ['Inner Focus'],
    })).toBe(20)
    expect(conditionAdjustedInitiative(20, ['Paralysis', 'Flinch'])).toBeLessThan(20)
  })

  it('aa076.insomnia.reviewed blocks Sleep and rejects Rest before any Move effects or payment', () => {
    const activeState = fixture({ slug: 'aa076-insomnia-sleep', targetAbilities: ['Insomnia'] })
    const active = context(activeState)
    expect(createStandardMoveCoreTokenEffectImmunityQueries({ moveType: null, context: active }).condition({
      operation: conditionOperation('sleep'), condition: 'Sleep',
      recipient: resolveMoveCoreTokenRecipient(active, 'target'),
    }).blockedBy).toBe('Insomnia')

    const rest = fixture({ slug: 'aa076-insomnia-rest', move: 'Rest', actorAbilities: ['Insomnia'] })
    rest.sheets.get('actor')!.combat!.currentHp = 40
    expect(() => resolve(rest)).toThrow(/Rest cannot be declared.*Insomnia/i)
    const restRuntime = registeredMoveAutomationRuntimeFor('Rest')
    if (!restRuntime || restRuntime.kind !== 'movespec-v2') throw new Error('Rest runtime missing.')
    expect(() => executeMoveSpec({
      definition: restRuntime.definition,
      context: context(rest),
      resolutionId: 'resolution:aa076:insomnia-rest-direct',
    })).toThrow(/Rest cannot be executed.*Insomnia/i)
    expect(rest.map.encounterState?.turnResources.actor?.actions.standard.spent).toBe(0)
    expect(rest.sheets.get('actor')!.combat?.currentHp).toBe(40)

    const granted = fixture({
      slug: 'aa076-insomnia-rest-granted', move: 'Rest',
      effects: [grantAbility('actor', 'Insomnia')],
    })
    expect(() => resolve(granted)).toThrow(/Insomnia/i)

    const suppressed = fixture({
      slug: 'aa076-insomnia-rest-suppressed', move: 'Rest', actorAbilities: ['Insomnia'],
      effects: [suppression('actor')],
    })
    expect(() => resolve(suppressed)).not.toThrow()
  }, 30_000)

  it('aa076.instinct.reviewed adds exactly +2 default Evasion and effective Keen Eye ignores it', () => {
    const active = context(fixture({ slug: 'aa076-instinct', targetAbilities: ['Instinct'] }))
    const suppressed = context(fixture({
      slug: 'aa076-instinct-suppressed', targetAbilities: ['Instinct'],
      effects: [suppression('target')],
    }))
    expect(aa076InstinctEvasionBonus({ context: active, recipientId: 'target' })).toBe(2)
    expect(aa076InstinctEvasionBonus({ context: suppressed, recipientId: 'target' })).toBe(0)

    const rolls = [0.15, 0.2, 0.25, 0.3, 0.35]
    const outcomes = (
      actorAbilities: readonly string[],
      targetAbilities: readonly string[],
      label: string,
    ) => rolls.map((roll, index) => {
      const state = fixture({
        slug: `aa076-instinct-roll-${label}-${index}`,
        actorAbilities,
        targetAbilities,
      })
      return nextSheet(resolve(state, () => roll), 'target', state.sheets).combat?.currentHp
    })
    const keenAgainstInstinct = outcomes(['Keen Eye'], ['Instinct'], 'keen-instinct')
    const keenAgainstPlain = outcomes(['Keen Eye'], [], 'keen-plain')
    const plainAgainstInstinct = outcomes([], ['Instinct'], 'plain-instinct')
    expect(keenAgainstInstinct).toEqual(keenAgainstPlain)
    expect(keenAgainstInstinct.some((hp, index) => hp! < (plainAgainstInstinct[index] ?? 0))).toBe(true)
  }, 30_000)

  it('aa076.intrepid-sword.reviewed raises the effective default Attack stage without mutating authored state', () => {
    const active = context(fixture({ slug: 'aa076-intrepid', actorAbilities: ['Intrepid Sword'] }))
    const suppressed = context(fixture({
      slug: 'aa076-intrepid-suppressed', actorAbilities: ['Intrepid Sword'],
      effects: [suppression('actor')],
    }))
    expect(active.queries.stats.combatStage('actor', {
      stage: 'atk', stageModifierPolicy: 'honor',
    })?.value).toBe(1)
    expect(suppressed.queries.stats.combatStage('actor', {
      stage: 'atk', stageModifierPolicy: 'honor',
    })?.value).toBe(0)
    expect(active.actor.token.combatStages.atk).toBe(0)
  })

  it('aa076.iron-fist.reviewed adds DB +2 only to the reviewed punch list', () => {
    const plainPunch = fixture({ slug: 'aa076-iron-fist-plain', move: 'Mach Punch' })
    const activePunch = fixture({
      slug: 'aa076-iron-fist-active', move: 'Mach Punch', actorAbilities: ['Iron Fist'],
    })
    const suppressedPunch = fixture({
      slug: 'aa076-iron-fist-suppressed', move: 'Mach Punch', actorAbilities: ['Iron Fist'],
      effects: [suppression('actor')],
    })
    const plainHp = nextSheet(resolve(plainPunch), 'target', plainPunch.sheets).combat?.currentHp ?? 0
    const activePlan = resolve(activePunch)
    const activeHp = nextSheet(activePlan, 'target', activePunch.sheets).combat?.currentHp ?? 0
    const suppressedHp = nextSheet(resolve(suppressedPunch), 'target', suppressedPunch.sheets).combat?.currentHp ?? 0
    expect(activeHp).toBeLessThan(plainHp)
    expect(suppressedHp).toBe(plainHp)

    const plainTackle = fixture({ slug: 'aa076-iron-fist-tackle-plain', move: 'Tackle' })
    const activeTackle = fixture({
      slug: 'aa076-iron-fist-tackle', move: 'Tackle', actorAbilities: ['Iron Fist'],
    })
    expect(nextSheet(resolve(activeTackle), 'target', activeTackle.sheets).combat?.currentHp)
      .toBe(nextSheet(resolve(plainTackle), 'target', plainTackle.sheets).combat?.currentHp)
  }, 30_000)

  it('aa076.justified.reviewed adds exactly +4 to authoritative Intercept checks while effective', () => {
    const plain = context(fixture({ slug: 'aa076-justified-intercept-plain' }))
    const active = context(fixture({
      slug: 'aa076-justified-intercept', actorAbilities: ['Justified'],
    }))
    const targetOnly = context(fixture({
      slug: 'aa076-justified-intercept-target', targetAbilities: ['Justified'],
    }))
    const operation = parseMoveEffectOperation({
      id: 'aa076.justified.intercept-check',
      kind: 'check',
      source: { kind: 'move', id: 'maneuver.intercept' },
      recipients: { kind: 'attacked-targets' },
      phase: 'hit',
      reasonCode: 'aa076.justified.intercept-check',
      payload: {
        kind: 'opposed', checkId: 'aa076.justified.intercept',
        actorRoll: {
          rollId: 'aa076.justified.actor-roll',
          source: { kind: 'skill', skill: 'athletics' }, modifiers: [],
          reroll: { count: 0, keep: 'latest' }, resourceReroll: null,
        },
        targetRoll: {
          rollId: 'aa076.justified.target-roll',
          source: { kind: 'skill', skill: 'athletics' }, modifiers: [],
          reroll: { count: 0, keep: 'latest' }, resourceReroll: null,
        },
        tie: { kind: 'failure' },
        branches: { success: 'intercept.success', failure: 'intercept.failure' },
      },
    }) as MoveCheckEffectOperation
    const execute = (moveContext: typeof plain) => executeMoveCheckOperation({
      context: moveContext,
      operation,
      recipientIds: ['target'],
      selectorState: {
        targetIds: ['target'], hitTargetIds: ['target'], missedTargetIds: [],
        damagedTargetIds: [], faintedTargetIds: [],
      },
      canonicalMoveId: 'Intercept',
    })
    const plainResult = execute(plain)
    const activeResult = execute(active)
    const targetOnlyResult = execute(targetOnly)
    expect(activeResult.resolutions[0]?.actor?.finalValue)
      .toBe((plainResult.resolutions[0]?.actor?.finalValue ?? 0) + 4)
    expect(activeResult.resolutions[0]?.actor?.modifiers).toContainEqual(expect.objectContaining({
      sourceId: 'ability.justified', value: 4,
    }))
    expect(targetOnlyResult.resolutions[0]?.target?.finalValue)
      .toBe(plainResult.resolutions[0]?.target?.finalValue)
    expect(targetOnlyResult.resolutions[0]?.target?.modifiers).not.toContainEqual(expect.objectContaining({
      sourceId: 'ability.justified',
    }))
  })

  it('aa076.kampfgeist.reviewed grants Fighting STAB only from its exact effective runtime', () => {
    const plain = fixture({ slug: 'aa076-kampfgeist-stab-plain', move: 'Mach Punch' })
    const active = fixture({
      slug: 'aa076-kampfgeist-stab', move: 'Mach Punch', actorAbilities: ['Kampfgeist'],
    })
    const suppressed = fixture({
      slug: 'aa076-kampfgeist-stab-suppressed', move: 'Mach Punch', actorAbilities: ['Kampfgeist'],
      effects: [suppression('actor')],
    })
    const plainPlan = resolve(plain)
    const activePlan = resolve(active)
    const suppressedPlan = resolve(suppressed)
    const plainHp = nextSheet(plainPlan, 'target', plain.sheets).combat?.currentHp ?? 0
    const activeHp = nextSheet(activePlan, 'target', active.sheets).combat?.currentHp ?? 0
    const suppressedHp = nextSheet(suppressedPlan, 'target', suppressed.sheets).combat?.currentHp ?? 0
    expect(activeHp).toBeLessThan(plainHp)
    expect(suppressedHp).toBe(plainHp)
    expect(JSON.stringify(activePlan.resolution.auditTrace)).toContain('Kampfgeist')
  }, 30_000)

  it('aa076.keen-eye.reviewed blocks only Blindness and Accuracy lowering while ignoring non-stat Evasion', () => {
    const targetState = fixture({ slug: 'aa076-keen-eye-condition', targetAbilities: ['Keen Eye'] })
    const targetContext = context(targetState)
    const immunity = createStandardMoveCoreTokenEffectImmunityQueries({ moveType: null, context: targetContext })
    const recipient = resolveMoveCoreTokenRecipient(targetContext, 'target')
    expect(immunity.condition({
      operation: conditionOperation('blindness'), condition: 'Blindness', recipient,
    }).blockedBy).toBe('Keen Eye')
    expect(immunity.condition({
      operation: conditionOperation('total-blindness'), condition: 'Total Blindness', recipient,
    }).blockedBy).toBeNull()

    const accuracyStage = (
      slug: string,
      targetAbilities: readonly string[],
      effects: readonly EncounterEffect[] = [],
    ) => {
      const state = fixture({ slug, targetAbilities, effects })
      state.sheets.get('target')!.combatStages!.acc = -2
      return context(state).queries.stats.combatStage('target', {
        stage: 'acc', stageModifierPolicy: 'honor',
      })?.value
    }
    expect(accuracyStage('aa076-keen-eye-effective-stage', ['Keen Eye'])).toBe(0)
    expect(accuracyStage(
      'aa076-keen-eye-suppressed-stage',
      ['Keen Eye'],
      [suppression('target')],
    )).toBe(-2)
    expect(accuracyStage(
      'aa076-keen-eye-granted-stage',
      [],
      [grantAbility('target', 'Keen Eye')],
    )).toBe(0)

    const blindRolls = [0.15, 0.2, 0.25, 0.3, 0.35]
    const blindnessOutcomes = (
      label: string,
      targetAbilities: readonly string[],
      effects: readonly EncounterEffect[] = [],
    ) => blindRolls.map((roll, index) => {
      const state = fixture({
        slug: `aa076-keen-eye-blind-${label}-${index}`,
        targetAbilities,
        targetConditions: ['Blindness'],
        effects,
      })
      return nextSheet(resolve(state, () => roll), 'target', state.sheets).combat?.currentHp
    })
    const plainBlindness = blindnessOutcomes('plain', [])
    const effectiveBlindness = blindnessOutcomes('effective', ['Keen Eye'])
    const suppressedBlindness = blindnessOutcomes(
      'suppressed',
      ['Keen Eye'],
      [suppression('target')],
    )
    const grantedBlindness = blindnessOutcomes(
      'granted',
      [],
      [grantAbility('target', 'Keen Eye')],
    )
    expect(effectiveBlindness).toEqual(grantedBlindness)
    expect(suppressedBlindness).toEqual(plainBlindness)
    expect(effectiveBlindness).not.toEqual(plainBlindness)

    const plainAccuracy = context(fixture({
      slug: 'aa076-keen-eye-illuminate-plain', targetAbilities: ['Illuminate'],
    }))
    const keenAccuracy = context(fixture({
      slug: 'aa076-keen-eye-illuminate', actorAbilities: ['Keen Eye'], targetAbilities: ['Illuminate'],
    }))
    const script = keenAccuracy.queries.rules.reviewedScriptFor('Tackle')!
    expect(resolveAuthoritativeMoveUserAccuracy(keenAccuracy, { targetPlacementId: 'target', script }).value)
      .toBe(resolveAuthoritativeMoveUserAccuracy(plainAccuracy, { targetPlacementId: 'target', script }).value + 2)

    const obscuredFixture = (slug: string, actorAbilities: readonly string[], effects: readonly EncounterEffect[] = []) => fixture({
      slug,
      actorAbilities,
      effects,
      targetPosition: { x: 4, y: 0, z: 1 },
      zones: [smokeZone(`zone.${slug}.smoke`)],
      voxels: [{
        x: 2, y: 0, z: 1, materialId: 'meadow_grass',
        blocksSight: false, tags: ['rough'],
      }],
    })
    const obscuredPlain = context(obscuredFixture('aa076-keen-eye-obscured-plain', []))
    const obscuredKeen = context(obscuredFixture('aa076-keen-eye-obscured', ['Keen Eye']))
    const obscuredSuppressed = context(obscuredFixture(
      'aa076-keen-eye-obscured-suppressed',
      ['Keen Eye'],
      [suppression('actor')],
    ))
    const sightScript = obscuredKeen.queries.rules.reviewedScriptFor('Tackle')!
    const plainSight = resolveAuthoritativeMoveUserAccuracy(obscuredPlain, {
      targetPlacementId: 'target', script: sightScript,
    })
    const keenSight = resolveAuthoritativeMoveUserAccuracy(obscuredKeen, {
      targetPlacementId: 'target', script: sightScript,
    })
    const suppressedSight = resolveAuthoritativeMoveUserAccuracy(obscuredSuppressed, {
      targetPlacementId: 'target', script: sightScript,
    })
    expect(keenSight.value).toBe(plainSight.value + 5)
    expect(suppressedSight.value).toBe(plainSight.value)
    expect(keenSight.sight).toMatchObject({
      modifierTotal: 0,
      modifiers: [],
      lineOfSight: { accuracyModifier: -2, reasonCode: 'line-of-sight-rough-cover' },
      smoke: { affectingZoneIds: [], modifiers: [], modifierTotal: 0 },
    })
    expect(keenSight.sight?.smoke.trace).toContainEqual(expect.objectContaining({
      outcome: 'superseded',
      reasonCode: 'ability.keen-eye.accuracy-penalty-ignored',
      value: null,
    }))

    const penalty = numericEncounterEffectFixture()
    const penaltyState = fixture({
      slug: 'aa076-keen-eye-penalties', actorAbilities: ['Keen Eye'],
      effects: [{
        ...penalty,
        id: 'effect.aa076.accuracy-penalty',
        affected: { placementIds: ['actor'], sideIds: [], cells: [] },
        payload: { attribute: 'accuracy', operation: 'add', value: -4, rounding: 'none' },
      }, {
        ...penalty,
        id: 'effect.aa076.accuracy-bonus',
        affected: { placementIds: ['actor'], sideIds: [], cells: [] },
        payload: { attribute: 'accuracy', operation: 'add', value: 3, rounding: 'none' },
      }],
    })
    const penaltyContext = context(penaltyState)
    expect(resolveAuthoritativeMoveUserAccuracy(penaltyContext, {
      targetPlacementId: 'target', script: penaltyContext.queries.rules.reviewedScriptFor('Tackle')!,
    }).value).toBe(3)

    const totalBlind = context(fixture({
      slug: 'aa076-keen-eye-total-blindness',
      actorAbilities: ['Keen Eye'], actorConditions: ['Total Blindness'],
    }))
    expect(resolveAuthoritativeMoveUserAccuracy(totalBlind, {
      targetPlacementId: 'target', script: totalBlind.queries.rules.reviewedScriptFor('Tackle')!,
    }).value).toBe(-10)

    const sand = fixture({ slug: 'aa076-keen-eye-stage', move: 'Sand Attack', targetAbilities: ['Keen Eye'] })
    expect(nextSheet(resolve(sand), 'target', sand.sheets).combatStages?.acc).toBe(0)
  }, 30_000)
})
