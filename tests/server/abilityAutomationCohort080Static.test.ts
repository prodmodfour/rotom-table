import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { parseMoveEffectOperation } from '#shared/moveAutomation/effects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { MoveAutomationAreaTemplate } from '~/types/moveAutomation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { AA080_ABILITY_SPECS } from '../../server/domain/abilityAutomation/specs/aa080'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveState,
  planAuthoritativeMoveStateExecution,
  type AuthoritativeMoveStatePlan,
  type AuthoritativePendingMoveStatePlan,
} from '../../server/domain/planAuthoritativeMoveState'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { createStandardMoveCoreTokenEffectImmunityQueries } from '../../server/domain/moveAutomation/reducers/immunities'
import { resolveMoveCoreTokenRecipient } from '../../server/domain/moveAutomation/reducers/coreTokenRecipients'

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
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 30, revision: 3,
  types: [...(input.types ?? ['Normal'])], abilities: (input.abilities ?? []).map(ability),
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 300, injuries: 0, conditions: [] },
})
const fixture = (input: {
  slug: string
  move: string
  actorAbilities?: readonly string[]
  targetAbilities?: readonly string[]
  actorHp?: number
  actorTypes?: readonly string[]
  targetTypes?: readonly string[]
  includeOther?: boolean
}) => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 3, y: 0, z: 3 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 4, y: 0, z: 3 } },
    ...(input.includeOther ? [{
      id: 'other', sheetKind: 'pokemon' as const, sheetSlug: 'other', sideId: 'foes', position: { x: 3, y: 0, z: 4 },
    }] : []),
  ]
  const map: TabletopMap = {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 12, y: 4, z: 12 }, groundLevelY: 0,
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
      currentHp: input.actorHp, types: input.actorTypes,
    })],
    ['target', sheet({ slug: 'target', abilities: input.targetAbilities, types: input.targetTypes })],
    ...(input.includeOther ? [['other', sheet({ slug: 'other' })] as const] : []),
  ])
  return { map, sheets, move: input.move }
}
type State = ReturnType<typeof fixture>
const resolve = (state: State, selection: Parameters<typeof planAuthoritativeMoveState>[0]['intent']['selection'] = {
  kind: 'single-target', targetPlacementId: 'target',
}) => planAuthoritativeMoveState({
  map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
  intent: { schemaVersion: 1, placementId: 'actor', moveName: state.move, selection },
  random: () => 0.75, now: () => 1_000, operationId: `op_${id(state.map.slug)}`,
})
const nextSheet = (state: State, slug: string, plan = resolve(state)): CharacterSheet => (
  plan.sheetWrites.find(write => write.slug === slug)?.nextSheet ?? state.sheets.get(slug)!
) as CharacterSheet
const resolveGalvanized = (state: State): AuthoritativeMoveStatePlan => {
  let plan: AuthoritativeMoveStatePlan | AuthoritativePendingMoveStatePlan = planAuthoritativeMoveStateExecution({
    map: state.map, pokemonSheets: state.sheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName: state.move,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: () => 0.75, now: () => 1_000,
    operationId: `op_${id(state.map.slug)}`,
    pendingResolutionId: `resolution:${state.map.slug}`,
  })
  let index = 0
  while (isAuthoritativePendingMoveStatePlan(plan)) {
    const pending = plan.suspension.pendingResolution
    const window = pending.outstandingWindows[0]!
    const optionId = window.options.some(option => option.id === 'ability.galvanize.electric')
      ? 'ability.galvanize.electric'
      : window.options[0]?.id ?? null
    const execution = resumeMoveSpec({
      pendingResolution: structuredClone(pending), map: structuredClone(plan.nextMap),
      pokemonSheets: state.sheets, trainerSheets: new Map(),
      response: { requestId: window.windowId, optionId },
      now: 2_000 + index, random: () => 0.75,
    })
    plan = planResumedMoveState({
      pendingResolution: pending, declarationPlan: plan.suspension.preWindowPlan,
      responseOpId: `op_response_${id(state.map.slug)}_${index}`,
      responseWindowId: window.windowId, responseOptionId: optionId,
      chosenBy: { kind: 'placement', id: 'actor' }, map: plan.nextMap,
      pokemonSheets: state.sheets, trainerSheets: new Map(), execution, plannedAt: 2_000 + index,
    })
    index += 1
    if (index > 8) throw new Error('Too many AA-080 Motor Drive response windows.')
  }
  return plan
}
const hp = (state: State, slug = 'target'): number => nextSheet(state, slug).combat?.currentHp ?? 0

describe('AA-080 static integrations', () => {
  it('selects all twelve exact reviewed runtimes', () => {
    expect(AA080_ABILITY_SPECS.map(spec => spec.canonicalId)).toEqual([
      'Mini-Noses', 'Minus', 'Miracle Mile', 'Mirror Armor', 'Missile Launch',
      'Misty Surge', 'Mojo', 'Mold Breaker', 'Moody', 'Motor Drive',
      'Mountain Peak', 'Moxie',
    ])
    for (const spec of AA080_ABILITY_SPECS) {
      expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(spec.canonicalId)).toMatchObject({
        canonicalId: spec.canonicalId, kind: 'abilityspec-v1', version: 1,
        sourceModule: 'server/domain/abilityAutomation/specs/aa080.ts',
      })
    }
  })

  it('applies Miracle Mile and Mountain Peak only for their exact Last Chance type and threshold', () => {
    const fairyPlain = fixture({ slug: 'aa080-miracle-plain', move: 'Fairy Wind', actorHp: 80 })
    const fairyBoost = fixture({
      slug: 'aa080-miracle-boost', move: 'Fairy Wind', actorHp: 80,
      actorAbilities: ['Miracle Mile'],
    })
    expect(hp(fairyBoost)).toBe(hp(fairyPlain) - 5)
    const healthy = fixture({
      slug: 'aa080-miracle-healthy', move: 'Fairy Wind', actorHp: 300,
      actorAbilities: ['Miracle Mile'],
    })
    expect(hp(healthy)).toBe(hp(fixture({ slug: 'aa080-miracle-healthy-plain', move: 'Fairy Wind' })))

    const rockPlain = fixture({ slug: 'aa080-mountain-plain', move: 'Rock Throw', actorHp: 80 })
    const rockBoost = fixture({
      slug: 'aa080-mountain-boost', move: 'Rock Throw', actorHp: 80,
      actorAbilities: ['Mountain Peak'],
    })
    expect(hp(rockBoost)).toBe(hp(rockPlain) - 5)
    expect(hp(fixture({
      slug: 'aa080-mountain-wrong-type', move: 'Fairy Wind', actorHp: 80,
      actorAbilities: ['Mountain Peak'],
    }))).toBe(hp(fairyPlain))
  })

  it('lets exact effective Mojo bypass only Normal immunity to Ghost Moves', () => {
    const blocked = fixture({ slug: 'aa080-mojo-blocked', move: 'Shadow Punch', targetTypes: ['Normal'] })
    const mojo = fixture({
      slug: 'aa080-mojo-active', move: 'Shadow Punch', targetTypes: ['Normal'], actorAbilities: ['Mojo'],
    })
    expect(hp(blocked)).toBe(300)
    expect(hp(mojo)).toBeLessThan(300)
  })

  it('makes Mold Breaker ignore enemy Defensive ability mechanics without changing the type chart', () => {
    const filtered = fixture({
      slug: 'aa080-mold-filtered', move: 'Brick Break', targetAbilities: ['Filter'], targetTypes: ['Normal'],
    })
    const broken = fixture({
      slug: 'aa080-mold-broken', move: 'Brick Break', actorAbilities: ['Mold Breaker'],
      targetAbilities: ['Filter'], targetTypes: ['Normal'],
    })
    const plain = fixture({ slug: 'aa080-mold-plain', move: 'Brick Break', targetTypes: ['Normal'] })
    expect(hp(filtered)).toBeGreaterThan(hp(plain))
    expect(hp(broken)).toBe(hp(plain))
  })

  it('binds Motor Drive immunity and +1 Speed to only the actual Electric operation recipient', () => {
    const state = fixture({
      slug: 'aa080-motor-area', move: 'Discharge', targetAbilities: ['Motor Drive'], includeOther: true,
    })
    const template: MoveAutomationAreaTemplate = { kind: 'cardinally-adjacent', size: 1, label: 'Cardinally Adjacent Targets' }
    const plan = resolve(state, { kind: 'area', areaTemplateId: moveAutomationAreaTemplateId(template) })
    expect(nextSheet(state, 'target', plan).combat?.currentHp).toBe(300)
    const target = nextSheet(state, 'target', plan)
    expect(target.combat?.conditions).not.toContain('Paralysis')
    expect(target.stats?.spd?.stage ?? target.combatStages?.spd).toBe(1)
    expect(nextSheet(state, 'other', plan).combat?.currentHp).toBeLessThan(300)
    const other = nextSheet(state, 'other', plan)
    expect(other.stats?.spd?.stage ?? other.combatStages?.spd ?? 0).toBe(0)
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('Motor Drive')

    const statusState = fixture({
      slug: 'aa080-motor-status', move: 'Thunder Wave', targetAbilities: ['Motor Drive'],
    })
    const statusPlan = resolve(statusState)
    const statusTarget = nextSheet(statusState, 'target', statusPlan)
    expect(statusTarget.combat?.conditions).not.toContain('Paralysis')
    expect(statusTarget.stats?.spd?.stage ?? statusTarget.combatStages?.spd).toBe(1)

    const multiHitState = fixture({
      slug: 'aa080-motor-multi-hit', move: 'Double Hit', actorAbilities: ['Galvanize'],
      targetAbilities: ['Motor Drive'],
    })
    const multiHitTarget = nextSheet(multiHitState, 'target', resolveGalvanized(multiHitState))
    expect(multiHitTarget.combat?.currentHp).toBe(300)
    expect(multiHitTarget.stats?.spd?.stage ?? multiHitTarget.combatStages?.spd).toBe(1)

    const directHpState = fixture({
      slug: 'aa080-motor-direct-hp', move: 'Sonic Boom', targetAbilities: ['Motor Drive'],
    })
    const directHpContext = buildAuthoritativeMoveRulesContext({
      map: directHpState.map, pokemonSheets: directHpState.sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: directHpState.move,
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      selectedPlacementIds: ['target'], candidatePlacementIds: ['target'],
      random: () => 0.75, time: 1_000, resolutionId: 'resolution:aa080-motor-direct-hp',
    })
    const directHpOperation = parseMoveEffectOperation({
      id: 'aa080.motor-drive.direct-hp', kind: 'direct-hp',
      source: { kind: 'move', id: 'move.electric-direct-hp' },
      recipients: { kind: 'selected-targets' }, phase: 'damage',
      reasonCode: 'aa080.motor-drive.direct-hp',
      payload: {
        mode: 'lose', pool: 'hit-points', calculation: { kind: 'fixed', value: 15 },
        copySource: null, bounds: { minimum: null, maximum: null }, rounding: 'floor',
        applyTypeImmunity: true, cost: null,
        injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
      },
    })
    if (directHpOperation.kind !== 'direct-hp') throw new Error('Expected direct HP operation.')
    expect(createStandardMoveCoreTokenEffectImmunityQueries({
      moveType: 'Electric', context: directHpContext,
    }).directHp({
      operation: directHpOperation,
      recipient: resolveMoveCoreTokenRecipient(directHpContext, 'target'),
    }).blockedBy).toBe('Motor Drive')

    const recoilState = fixture({
      slug: 'aa080-motor-self-recoil', move: 'Wild Charge', actorAbilities: ['Motor Drive'],
    })
    expect(nextSheet(recoilState, 'actor').combat?.currentHp).toBeLessThan(300)
  })
})
