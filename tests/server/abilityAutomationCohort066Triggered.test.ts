import { describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { isAuthoritativePendingMoveResolution } from '../../server/domain/resolveAuthoritativeMove'
import { resumeMoveSpec } from '../../server/domain/moveAutomation/resumeSpec'
import { planResumedMoveState } from '../../server/domain/moveAutomation/planResumedMoveState'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const,
    instanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId,
    definitionVersion: null,
    selections: [],
  },
})
const sheet = (input: { slug: string; move?: string; ability?: string }): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  gender: 'Male',
  types: ['Normal'],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [] },
})
const battleMap = (slug: string, dancerDistance = 1): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
    { id: 'nearby', sheetKind: 'pokemon', sheetSlug: 'nearby', sideId: 'foes', position: { x: 2, y: 0, z: 2 } },
    { id: 'dancer', sheetKind: 'pokemon', sheetSlug: 'dancer', sideId: 'heroes', position: { x: 1 + dancerDistance, y: 0, z: 2 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5,
    dimensions: { x: 20, y: 4, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: { ...encounter.history, sceneId: `scene:${slug}` },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
}

const dancerDeclaration = (input: { slug: string; distance?: number; spent?: number }) => {
  const map = battleMap(input.slug, input.distance ?? 1)
  if (input.spent !== undefined) {
    map.encounterState = {
      ...map.encounterState!,
      abilityUsage: {
        schemaVersion: 1,
        sceneId: `scene:${input.slug}`,
        entries: [{
          ownerId: 'dancer', abilityInstanceId: 'base:dancer', canonicalId: 'Dancer',
          clauseId: 'base', limit: 2, spent: input.spent,
          operationIds: Array.from({ length: input.spent }, (_, index) => `op_prior_${index}`),
        }],
      },
    }
  }
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move: 'Swords Dance' })],
    ['target', sheet({ slug: 'target' })],
    ['nearby', sheet({ slug: 'nearby' })],
    ['dancer', sheet({ slug: 'dancer', ability: 'Dancer' })],
  ])
  const declaration = planAuthoritativeMoveStateExecution({
    map, pokemonSheets, trainerSheets: new Map(),
    intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Swords Dance', selection: { kind: 'self' } },
    random: () => 0.5, now: () => 1_000,
    operationId: `op_${input.slug}`, pendingResolutionId: `resolution:${input.slug}`,
  })
  return { declaration, pokemonSheets }
}

const dangerDeclaration = (input: { slug: string; random?: number; move?: string }) => {
  const move = input.move ?? 'Ember'
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', move })],
    ['target', sheet({ slug: 'target', ability: 'Danger Syrup' })],
    ['nearby', sheet({ slug: 'nearby' })],
    ['dancer', sheet({ slug: 'dancer' })],
  ])
  const declaration = planAuthoritativeMoveStateExecution({
    map: battleMap(input.slug), pokemonSheets, trainerSheets: new Map(),
    intent: {
      schemaVersion: 1, placementId: 'actor', moveName: move,
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: () => input.random ?? 0.5, now: () => 1_000,
    operationId: `op_${input.slug}`, pendingResolutionId: `resolution:${input.slug}`,
  })
  return { declaration, pokemonSheets, random: input.random ?? 0.5 }
}

const respond = (input: {
  declaration: Extract<ReturnType<typeof planAuthoritativeMoveStateExecution>, { kind: 'pending' }>
  pokemonSheets: Map<string, CharacterSheet>
  random: number
  optionId: string | null
  chosenBy: { kind: 'actor'; id: null } | { kind: 'placement'; id: string }
  suffix: string
}) => {
  const pending = input.declaration.suspension.pendingResolution
  const window = pending.outstandingWindows[0]!
  const execution = resumeMoveSpec({
    pendingResolution: structuredClone(pending),
    map: structuredClone(input.declaration.nextMap),
    pokemonSheets: input.pokemonSheets,
    trainerSheets: new Map(),
    response: { requestId: window.windowId, optionId: input.optionId },
    now: 2_000,
    random: () => input.random,
  })
  const plan = planResumedMoveState({
    pendingResolution: pending,
    declarationPlan: input.declaration.suspension.preWindowPlan,
    responseOpId: `op_response_${input.suffix}`,
    responseWindowId: window.windowId,
    responseOptionId: input.optionId,
    chosenBy: input.chosenBy,
    map: input.declaration.nextMap,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: new Map(),
    execution,
    plannedAt: 2_000,
  })
  return { execution, plan, window }
}

const writtenSheet = (plan: ReturnType<typeof planResumedMoveState>, slug: string): CharacterSheet | undefined => (
  plan.sheetWrites.find(write => write.slug === slug)?.nextSheet as CharacterSheet | undefined
)
const attackStage = (value: CharacterSheet | undefined): number => (
  value?.stats?.atk?.stage ?? value?.combatStages?.atk ?? 0
)

describe('AA-066 triggered abilities', () => {
  it('aa066.dancer.reviewed durably copies a nearby Status Dance, pays Scene/Free, and terminates the nested chain', () => {
    const declared = dancerDeclaration({ slug: 'aa066-dancer' })
    expect(isAuthoritativePendingMoveStatePlan(declared.declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declared.declaration)) throw new Error('Expected Dancer response.')
    const selected = respond({
      declaration: declared.declaration,
      pokemonSheets: declared.pokemonSheets,
      random: 0.5,
      optionId: 'ability.dancer.use',
      chosenBy: { kind: 'placement', id: 'dancer' },
      suffix: 'dancer',
    })
    expect(isAuthoritativePendingMoveResolution(selected.execution)).toBe(false)
    expect(attackStage(writtenSheet(selected.plan, 'dancer'))).toBe(2)
    expect(selected.plan.nextMap.encounterState?.turnResources.dancer?.actions.free.spent).toBe(1)
    expect(selected.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      ownerId: 'dancer', canonicalId: 'Dancer', limit: 2, spent: 1,
    }))
  }, 30_000)

  it('aa066.dancer.reviewed namespaces and resolves a repeated area Dance independently', () => {
    const map = battleMap('aa066-dancer-area')
    const pokemonSheets = new Map<string, CharacterSheet>([
      ['actor', sheet({ slug: 'actor', move: 'Feather Dance' })],
      ['target', sheet({ slug: 'target' })],
      ['nearby', sheet({ slug: 'nearby' })],
      ['dancer', sheet({ slug: 'dancer', ability: 'Dancer' })],
    ])
    const declaration = planAuthoritativeMoveStateExecution({
      map, pokemonSheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Feather Dance',
        selection: {
          kind: 'area',
          areaTemplateId: moveAutomationAreaTemplateId({ kind: 'burst', size: 1 }),
        },
      },
      random: () => 0.5, now: () => 1_000,
      operationId: 'op_aa066_dancer_area', pendingResolutionId: 'resolution:aa066-dancer-area',
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected area Dancer response.')
    const selected = respond({
      declaration, pokemonSheets, random: 0.5,
      optionId: 'ability.dancer.use', chosenBy: { kind: 'placement', id: 'dancer' },
      suffix: 'dancer_area',
    })
    expect(isAuthoritativePendingMoveResolution(selected.execution)).toBe(false)
    expect(attackStage(writtenSheet(selected.plan, 'actor'))).toBe(-2)
  }, 30_000)

  it('aa066.dancer.reviewed supports pass and omits out-of-range or exhausted triggers', () => {
    const passDeclaration = dancerDeclaration({ slug: 'aa066-dancer-pass' })
    expect(isAuthoritativePendingMoveStatePlan(passDeclaration.declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(passDeclaration.declaration)) throw new Error('Expected Dancer response.')
    const passed = respond({
      declaration: passDeclaration.declaration,
      pokemonSheets: passDeclaration.pokemonSheets,
      random: 0.5,
      optionId: null,
      chosenBy: { kind: 'placement', id: 'dancer' },
      suffix: 'dancer_pass',
    })
    expect(attackStage(writtenSheet(passed.plan, 'dancer'))).toBe(0)
    expect(passed.plan.nextMap.encounterState?.turnResources.dancer?.actions.free.spent).toBe(0)

    expect(isAuthoritativePendingMoveStatePlan(
      dancerDeclaration({ slug: 'aa066-dancer-far', distance: 12 }).declaration,
    )).toBe(false)
    expect(isAuthoritativePendingMoveStatePlan(
      dancerDeclaration({ slug: 'aa066-dancer-exhausted', spent: 2 }).declaration,
    )).toBe(false)
  }, 30_000)

  it('aa066.danger-syrup.reviewed uses Sweet Scent on hit, ignores its frequency, and Blinds only foes', () => {
    const declared = dangerDeclaration({ slug: 'aa066-danger-syrup' })
    expect(isAuthoritativePendingMoveStatePlan(declared.declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declared.declaration)) throw new Error('Expected Danger Syrup response.')
    const selected = respond({
      declaration: declared.declaration,
      pokemonSheets: declared.pokemonSheets,
      random: declared.random,
      optionId: 'ability.danger-syrup.use',
      chosenBy: { kind: 'placement', id: 'target' },
      suffix: 'danger_syrup',
    })
    expect(isAuthoritativePendingMoveResolution(selected.execution)).toBe(false)
    const blindEffects = selected.plan.nextMap.encounterState?.effects.filter(effect => (
      effect.kind === 'condition' && effect.payload.conditionId === 'blindness'
    )) ?? []
    expect(blindEffects).toContainEqual(expect.objectContaining({
      affected: expect.objectContaining({ placementIds: ['actor'] }),
    }))
    expect(blindEffects.some(effect => effect.affected.placementIds.includes('nearby'))).toBe(false)
    expect(selected.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(1)
    expect(selected.plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      ownerId: 'target', canonicalId: 'Danger Syrup', spent: 1,
    }))
    expect(JSON.stringify(writtenSheet(selected.plan, 'target')?.moveUsage ?? {}))
      .not.toContain('Sweet Scent')
  }, 30_000)

  it('aa066.danger-syrup.reviewed bounds a Sweet Scent response to Sweet Scent without identity reuse', () => {
    const map = battleMap('aa066-danger-syrup-repeat')
    const pokemonSheets = new Map<string, CharacterSheet>([
      ['actor', sheet({ slug: 'actor', move: 'Sweet Scent' })],
      ['target', sheet({ slug: 'target', ability: 'Danger Syrup' })],
      ['nearby', sheet({ slug: 'nearby' })],
      ['dancer', sheet({ slug: 'dancer' })],
    ])
    const declaration = planAuthoritativeMoveStateExecution({
      map, pokemonSheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Sweet Scent',
        selection: {
          kind: 'area',
          areaTemplateId: moveAutomationAreaTemplateId({ kind: 'burst', size: 2 }),
        },
      },
      random: () => 0.5, now: () => 1_000,
      operationId: 'op_aa066_danger_repeat',
      pendingResolutionId: 'resolution:aa066-danger-repeat',
    })
    expect(isAuthoritativePendingMoveStatePlan(declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(declaration)) throw new Error('Expected Danger Syrup response.')
    const selected = respond({
      declaration, pokemonSheets, random: 0.5,
      optionId: 'ability.danger-syrup.use', chosenBy: { kind: 'placement', id: 'target' },
      suffix: 'danger_repeat',
    })
    expect(isAuthoritativePendingMoveResolution(selected.execution)).toBe(false)
    expect(selected.plan.nextMap.encounterState?.abilityUsage?.entries.filter(entry => (
      entry.canonicalId === 'Danger Syrup'
    ))).toHaveLength(1)
  }, 30_000)

  it('aa066.danger-syrup.reviewed opens no trigger on a miss and spends nothing on pass', () => {
    const missed = dangerDeclaration({ slug: 'aa066-danger-syrup-miss', random: 0 })
    expect(isAuthoritativePendingMoveStatePlan(missed.declaration)).toBe(false)
    const automatic = dangerDeclaration({
      slug: 'aa066-danger-syrup-automatic-hit', move: 'Aerial Ace',
    })
    expect(isAuthoritativePendingMoveStatePlan(automatic.declaration)).toBe(true)

    const passDeclaration = dangerDeclaration({ slug: 'aa066-danger-syrup-pass' })
    expect(isAuthoritativePendingMoveStatePlan(passDeclaration.declaration)).toBe(true)
    if (!isAuthoritativePendingMoveStatePlan(passDeclaration.declaration)) throw new Error('Expected Danger Syrup response.')
    const passed = respond({
      declaration: passDeclaration.declaration,
      pokemonSheets: passDeclaration.pokemonSheets,
      random: passDeclaration.random,
      optionId: null,
      chosenBy: { kind: 'placement', id: 'target' },
      suffix: 'danger_syrup_pass',
    })
    expect(passed.plan.nextMap.encounterState?.turnResources.target?.actions.free.spent).toBe(0)
    expect(passed.plan.nextMap.encounterState?.abilityUsage?.entries.some(entry => (
      entry.canonicalId === 'Danger Syrup'
    ))).toBe(false)
  }, 30_000)
})
