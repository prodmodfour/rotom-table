import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { AbilityMechanicOperation } from '#shared/abilityAutomation/mechanics'
import type { AbilityDeclarationOptionValue } from '#shared/abilityAutomation/declarationIntent'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { buildAuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/abilityAutomation/registry'
import { executeAa066ActivatedMechanic } from '../../server/domain/abilityAutomation/mechanics/aa066Activated'
import {
  aa066DazzlingInitiativePenalty,
  aa066DecoyEvasionBonus,
} from '../../server/domain/abilityAutomation/mechanics/aa066StaticIntegration'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { planInitiativeLifecycle } from '../../server/domain/moveAutomation/planInitiativeLifecycle'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'

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
const sheet = (input: {
  slug: string
  canonicalId?: string
  move?: string
  hp?: number
  conditions?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  gender: 'Male', types: ['Normal'],
  abilities: input.canonicalId ? [ability(input.canonicalId)] : [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: {
    currentHp: input.hp ?? 150, injuries: 0, conditions: [...(input.conditions ?? [])],
  },
})
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'ally', sheetKind: 'pokemon', sheetSlug: 'ally', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'enemy', sheetKind: 'pokemon', sheetSlug: 'enemy', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
    { id: 'far-enemy', sheetKind: 'pokemon', sheetSlug: 'far-enemy', sideId: 'foes', position: { x: 9, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5,
    dimensions: { x: 12, y: 4, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history,
        sceneId: `scene:${slug}`,
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
}

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (input: {
  slug: string
  canonicalId: string
  actorMove?: string
  enemyAbility?: string
  map?: TabletopMap
}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', canonicalId: input.canonicalId, move: input.actorMove })],
    ['ally', sheet({ slug: 'ally' })],
    ['enemy', sheet({ slug: 'enemy', canonicalId: input.enemyAbility, move: 'Quick Attack' })],
    ['far-enemy', sheet({ slug: 'far-enemy' })],
  ])
  mapRepository.saveSetupMap(input.map ?? battleMap(input.slug))
  for (const entry of sheets.values()) {
    sheetRepository.saveSetupSheet('pokemon', entry.slug, entry as unknown as Record<string, unknown>)
  }
  return { database, mapRepository, sheetRepository, sheets, now: () => 1_000 }
}
const begin = (
  dependencies: ReturnType<typeof setup>,
  slug: string,
  canonicalId: string,
  modeId = 'activate',
) => beginAbilityDeclarationUseCase({
  role: 'gm',
  command: {
    schemaVersion: 1, requestId: `request:${slug}:${modeId}`, mapSlug: slug,
    baseRevision: dependencies.mapRepository.getBySlug(slug)!.revision,
    actorPlacementId: 'actor',
    abilityInstanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, modeId,
  },
}, dependencies)
const resolve = (
  dependencies: ReturnType<typeof setup>,
  offer: ReturnType<typeof begin>,
  canonicalId: string,
  modeId: string,
  selections: unknown[],
) => resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
  schemaVersion: 1,
  intentId: `intent:${offer.mapSlug}:${modeId}:${offer.offerId}`,
  offerId: offer.offerId,
  offerSha256: offer.offerSha256,
  mapSlug: offer.mapSlug,
  baseRevision: offer.mapRevision,
  actorPlacementId: 'actor',
  abilityInstanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
  canonicalId, modeId, selections,
} }, dependencies)
const persisted = (dependencies: ReturnType<typeof setup>, slug: string): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', slug)!.sheet as unknown as CharacterSheet
)

const directDaze = (input: {
  slug: string
  random: number
  targetAbility?: string
  targetConditions?: readonly string[]
}): ReturnType<typeof executeAa066ActivatedMechanic> => {
  const runtime = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve('Daze')!
  const map = battleMap(input.slug)
  const pokemonSheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', canonicalId: 'Daze' })],
    ['ally', sheet({ slug: 'ally' })],
    ['enemy', sheet({
      slug: 'enemy', canonicalId: input.targetAbility, conditions: input.targetConditions,
    })],
    ['far-enemy', sheet({ slug: 'far-enemy' })],
  ])
  const context = buildAuthoritativeAbilityContext({
    map, pokemonSheets, trainerSheets: new Map(), runtime,
    request: {
      canonicalId: 'Daze', modeId: 'activate', actorPlacementId: 'actor',
      targetPlacementIds: ['enemy'], triggeringEvent: null,
    },
    resolutionId: `resolution:${input.slug}`, random: () => input.random, time: 1_000,
  })
  const operation = runtime.definition.spec.phases
    .flatMap(phase => phase.operations)
    .find(candidate => candidate.kind === 'ability-mechanic') as AbilityMechanicOperation
  const targetValue: AbilityDeclarationOptionValue = { kind: 'token', placementId: 'enemy' }
  return executeAa066ActivatedMechanic({
    context, operation, operationId: `op_${input.slug}`,
    abilityInstanceId: 'base:daze',
    choices: [{ declarationId: 'activate.target', options: [{ value: targetValue }] }],
  })
}

describe('AA-066 activated abilities', () => {
  it('aa066.daze.reviewed uses a private AC4 roll, applies Sleep on hit, and retains costs on miss/immunity', () => {
    const hit = directDaze({ slug: 'aa066-daze-hit', random: 0.5 })!
    const hitTarget = hit.plan.changes.find(change => (
      change.kind === 'sheet-state' && change.scope.sheetSlug === 'enemy'
    ))
    expect(hitTarget?.kind === 'sheet-state'
      ? (hitTarget.current as CharacterSheet).combat?.conditions
      : []).toContain('Sleep')
    const hitEncounter = hit.plan.changes.find(change => change.kind === 'encounter-state')
    expect(hitEncounter?.kind === 'encounter-state'
      ? (hitEncounter.current as NonNullable<TabletopMap['encounterState']>)
          .turnResources.actor?.actions.standard.spent
      : 0).toBe(1)

    const miss = directDaze({ slug: 'aa066-daze-miss', random: 0 })!
    expect(miss.presentationKey).toBe('ability.aa066.daze.miss')
    expect(miss.plan.changes.some(change => change.kind === 'sheet-state')).toBe(false)
    const missEncounter = miss.plan.changes.find(change => change.kind === 'encounter-state')
    expect(missEncounter?.kind === 'encounter-state'
      ? (missEncounter.current as NonNullable<TabletopMap['encounterState']>)
          .turnResources.actor?.actions.standard.spent
      : 0).toBe(1)

    const alreadyAsleep = directDaze({
      slug: 'aa066-daze-condition-noop', random: 0.5, targetConditions: ['Sleep'],
    })!
    expect(alreadyAsleep.plan.changes.some(change => change.kind === 'sheet-state')).toBe(false)
  })

  it('aa066.dazzling.reviewed targets only an adjacent foe, spends Swift/Scene x2, and blocks Priority', () => {
    const dependencies = setup({ slug: 'aa066-dazzling', canonicalId: 'Dazzling' })
    const offer = begin(dependencies, 'aa066-dazzling', 'Dazzling')
    const declaration = offer.declarations.find(entry => entry.declarationId === 'activate.target')!
    expect(declaration.options).toHaveLength(1)
    resolve(dependencies, offer, 'Dazzling', 'activate', [{
      declarationId: 'activate.target', kind: 'token', optionIds: [declaration.options[0]!.optionId],
    }])
    const map = dependencies.mapRepository.getBySlug('aa066-dazzling')!
    expect(aa066DazzlingInitiativePenalty({ map, placementId: 'enemy' })).toBe(-10)
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Dazzling', limit: 2, spent: 1,
    }))

    const sheets = new Map<string, CharacterSheet>([
      ['actor', persisted(dependencies, 'actor')], ['ally', persisted(dependencies, 'ally')],
      ['enemy', persisted(dependencies, 'enemy')], ['far-enemy', persisted(dependencies, 'far-enemy')],
    ])
    expect(() => planAuthoritativeMoveState({
      map, pokemonSheets: sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'enemy', moveName: 'Quick Attack',
        selection: { kind: 'single-target', targetPlacementId: 'actor' },
      },
      random: () => 0.5, now: () => 2_000, operationId: 'op_aa066_dazzling_priority',
    })).toThrow('blocked from using Priority by Dazzling')
  }, 20_000)

  it('aa066.decoy.reviewed materializes Follow Me and +2 Evasion through the end of the next turn', () => {
    const dependencies = setup({ slug: 'aa066-decoy', canonicalId: 'Decoy' })
    const offer = begin(dependencies, 'aa066-decoy', 'Decoy')
    resolve(dependencies, offer, 'Decoy', 'activate', [{
      declarationId: 'activate.none', kind: 'none', optionIds: [],
    }])
    let map = dependencies.mapRepository.getBySlug('aa066-decoy')!
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability', tags: expect.arrayContaining(['follow-me', 'redirection']),
      affected: expect.objectContaining({ placementIds: ['actor'] }),
    }))
    expect(aa066DecoyEvasionBonus({ map, placementId: 'actor' })).toBe(2)
    expect(map.encounterState?.turnResources.actor?.actions.full.spent).toBe(1)

    const pokemonSheets = new Map<string, CharacterSheet>([
      ['actor', persisted(dependencies, 'actor')], ['ally', persisted(dependencies, 'ally')],
      ['enemy', persisted(dependencies, 'enemy')], ['far-enemy', persisted(dependencies, 'far-enemy')],
    ])
    const firstEnd = planInitiativeLifecycle({
      map, previous: { activeId: 'actor', round: 1 }, current: { activeId: 'enemy', round: 1 },
      orderIds: ['actor', 'enemy'], operationId: 'op_aa066_decoy_current_end', time: 2_000,
      loadSheets: () => ({ pokemonSheets, trainerSheets: new Map() }),
    })
    map = { ...map, encounterState: firstEnd.currentEncounterState }
    expect(aa066DecoyEvasionBonus({ map, placementId: 'actor' })).toBe(2)
    const nextStart = planInitiativeLifecycle({
      map, previous: { activeId: 'enemy', round: 1 }, current: { activeId: 'actor', round: 2 },
      orderIds: ['actor', 'enemy'], operationId: 'op_aa066_decoy_next_start', time: 3_000,
      loadSheets: () => ({ pokemonSheets, trainerSheets: new Map() }),
    })
    map = { ...map, encounterState: nextStart.currentEncounterState }
    const nextEnd = planInitiativeLifecycle({
      map, previous: { activeId: 'actor', round: 2 }, current: { activeId: 'enemy', round: 2 },
      orderIds: ['actor', 'enemy'], operationId: 'op_aa066_decoy_next_end', time: 4_000,
      loadSheets: () => ({ pokemonSheets, trainerSheets: new Map() }),
    })
    map = { ...map, encounterState: nextEnd.currentEncounterState }
    expect(aa066DecoyEvasionBonus({ map, placementId: 'actor' })).toBe(0)
  }, 20_000)

  it('aa066.deadly-poison.reviewed creates no entitlement when Poison is prevented', () => {
    const dependencies = setup({
      slug: 'aa066-deadly-poison-prevented', canonicalId: 'Deadly Poison',
      actorMove: 'Poison Powder', enemyAbility: 'Immunity',
    })
    const plan = planAuthoritativeMoveState({
      map: dependencies.mapRepository.getBySlug('aa066-deadly-poison-prevented')!,
      pokemonSheets: dependencies.sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Poison Powder',
        selection: { kind: 'single-target', targetPlacementId: 'enemy' },
      },
      random: () => 0.99, now: () => 1_500,
      operationId: 'op_aa066_deadly_poison_prevented',
    })
    expect(plan.nextMap.encounterState?.abilityOwnedState?.entries.some(entry => (
      entry.canonicalId === 'Deadly Poison'
    ))).toBe(false)
    expect(plan.sheetWrites.find(write => write.slug === 'enemy')).toBeUndefined()
  })

  it('aa066.deadly-poison.reviewed exposes only an actual Poison trigger and upgrades it with Daily/Free payment', () => {
    const dependencies = setup({
      slug: 'aa066-deadly-poison', canonicalId: 'Deadly Poison', actorMove: 'Poison Powder',
    })
    expect(() => begin(dependencies, 'aa066-deadly-poison', 'Deadly Poison', 'upgrade'))
      .toThrow('too few currently legal options')

    const initialMap = dependencies.mapRepository.getBySlug('aa066-deadly-poison')!
    const movePlan = planAuthoritativeMoveState({
      map: initialMap,
      pokemonSheets: dependencies.sheets,
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Poison Powder',
        selection: { kind: 'single-target', targetPlacementId: 'enemy' },
      },
      random: () => 0.99, now: () => 1_500, operationId: 'op_aa066_deadly_poison_trigger',
    })
    expect(movePlan.nextMap.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      ownerPlacementId: 'actor', canonicalId: 'Deadly Poison', targetPlacementIds: ['enemy'],
    }))
    dependencies.mapRepository.saveSetupMap(movePlan.nextMap)
    for (const write of movePlan.sheetWrites) {
      dependencies.sheetRepository.saveSetupSheet(
        write.kind,
        write.slug,
        write.nextSheet as unknown as Record<string, unknown>,
      )
    }

    const offer = begin(dependencies, 'aa066-deadly-poison', 'Deadly Poison', 'upgrade')
    const declaration = offer.declarations.find(entry => entry.declarationId === 'upgrade.target')!
    expect(declaration.options).toHaveLength(1)
    resolve(dependencies, offer, 'Deadly Poison', 'upgrade', [{
      declarationId: 'upgrade.target', kind: 'token', optionIds: [declaration.options[0]!.optionId],
    }])
    expect(persisted(dependencies, 'enemy').combat?.conditions).toContain('Badly Poisoned')
    expect(persisted(dependencies, 'enemy').combat?.conditions).not.toContain('Poisoned')
    const map = dependencies.mapRepository.getBySlug('aa066-deadly-poison')!
    expect(map.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(map.encounterState?.abilityOwnedState?.entries.some(entry => (
      entry.canonicalId === 'Deadly Poison'
    ))).toBe(false)
    expect(persisted(dependencies, 'actor').abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Deadly Poison', spent: 1, limit: 1,
    }))
  }, 30_000)
})
