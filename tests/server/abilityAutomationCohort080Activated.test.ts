import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { aa080EntityIsActive, aa080IsDreepyEntity, aa080IsMiniNoseEntity } from '#shared/abilityAutomation/aa080'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { resolveAuthoritativeMove } from '../../server/domain/resolveAuthoritativeMove'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '../../server/domain/planAuthoritativeMoveState'
import { planEncounterLifecycle } from '../../server/domain/moveAutomation/planInitiativeLifecycle'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'

const id = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${id(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: { slug: string; ability?: string; currentHp?: number }): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: input.slug === 'actor' ? 'Probopass' : 'Eevee',
  level: 25, revision: 3, types: ['Normal'],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: [{ name: 'Ember' }],
  stats: {
    hp: { added: 80 }, atk: { added: 60 }, def: { added: 30 },
    satk: { added: 60 }, sdef: { added: 30 }, spd: { added: 35 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 250, injuries: 0, conditions: [] },
})
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 7, y: 0, z: 2 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5,
    dimensions: { x: 14, y: 4, z: 14 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], placements,
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...encounter.history, sceneId: `scene:${slug}`, currentRound: 1,
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
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (input: { slug: string; ability: string }) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(input.slug))
  for (const value of [sheet({ slug: 'actor', ability: input.ability }), sheet({ slug: 'target' })]) {
    sheetRepository.saveSetupSheet('pokemon', value.slug, value as unknown as Record<string, unknown>)
  }
  return { mapRepository, sheetRepository, now: () => 1_000 }
}
type Dependencies = ReturnType<typeof setup>
const savedSheet = (dependencies: Dependencies, slug: string): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', slug)!.sheet as unknown as CharacterSheet
)
const begin = (input: {
  dependencies: Dependencies
  slug: string
  canonicalId: string
  modeId: string
  suffix?: string
}) => beginAbilityDeclarationUseCase({ role: 'gm', command: {
  schemaVersion: 1, requestId: `request:${input.slug}:${input.suffix ?? input.modeId}`,
  mapSlug: input.slug, baseRevision: input.dependencies.mapRepository.getBySlug(input.slug)!.revision,
  actorPlacementId: 'actor', abilityInstanceId: `base:${id(input.canonicalId)}`,
  canonicalId: input.canonicalId, modeId: input.modeId,
} }, input.dependencies)
const resolve = (input: {
  dependencies: Dependencies
  slug: string
  canonicalId: string
  modeId: string
  suffix?: string
  cells?: readonly { readonly x: number; readonly y: number; readonly z: number }[]
  targetId?: string
}) => {
  const offer = begin(input)
  const cells = input.cells ?? []
  const selections = offer.declarations.map(declaration => ({
    declarationId: declaration.declarationId,
    kind: declaration.kind,
    optionIds: declaration.kind === 'cell'
      ? declaration.options.filter((option) => {
          const hint = option.hint
          return hint.kind === 'cell' && cells.some(cell => hint.x === cell.x
            && hint.y === cell.y && hint.z === cell.z)
        }).map(option => option.optionId)
      : declaration.kind === 'token'
        ? declaration.options.filter(option => option.hint.kind === 'placement'
          && option.hint.placementId === input.targetId).map(option => option.optionId)
        : [],
  }))
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1, intentId: `intent:${input.slug}:${input.suffix ?? input.modeId}`,
    offerId: offer.offerId, offerSha256: offer.offerSha256,
    mapSlug: input.slug, baseRevision: offer.mapRevision, actorPlacementId: 'actor',
    abilityInstanceId: `base:${id(input.canonicalId)}`,
    canonicalId: input.canonicalId, modeId: input.modeId, selections,
  } }, input.dependencies)
}
const resetTurn = (dependencies: Dependencies, slug: string, round: number) => {
  const map = dependencies.mapRepository.getBySlug(slug)!
  dependencies.mapRepository.saveSetupMap({
    ...map,
    initiative: { ...map.initiative, activeId: 'actor', round },
    encounterState: {
      ...map.encounterState!,
      history: {
        ...map.encounterState!.history, currentRound: round,
        currentTurn: { round, turn: round, placementId: 'actor' },
      },
      turnResources: {
        ...map.encounterState!.turnResources,
        actor: createEncounterTurnResourceLedger({ placementId: 'actor', round, turn: round }),
      },
    },
  })
}

describe('AA-080 activated and entity integrations', () => {
  it('Mini-Noses deploys one through three level-HP entities, pays Daily/Standard, shifts once per round, and authorizes an exact ranged origin', () => {
    const slug = 'aa080-mini-noses'
    const dependencies = setup({ slug, ability: 'Mini-Noses' })
    resolve({
      dependencies, slug, canonicalId: 'Mini-Noses', modeId: 'deploy',
      cells: [{ x: 2, y: 0, z: 1 }, { x: 1, y: 0, z: 2 }, { x: 3, y: 0, z: 2 }],
    })
    let map = dependencies.mapRepository.getBySlug(slug)!
    const noses = map.encounterState?.abilityEntities?.entries.filter(aa080IsMiniNoseEntity) ?? []
    expect(noses).toHaveLength(3)
    expect(noses.every(entity => entity.currentHp === 25 && entity.maximumHp === 25
      && entity.movementSpeed === 4 && aa080EntityIsActive(entity))).toBe(true)
    expect(map.encounterState?.turnResources.actor?.actions.standard.spent).toBe(1)
    expect(savedSheet(dependencies, 'actor').abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Mini-Noses', spent: 1, limit: 1,
    }))

    const actor = savedSheet(dependencies, 'actor')
    const target = savedSheet(dependencies, 'target')
    expect(() => resolveAuthoritativeMove({
      map, pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Ember',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.95, now: () => 2_000,
    })).toThrow(/range/i)
    expect(resolveAuthoritativeMove({
      map, pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Ember', originCell: { x: 3, y: 0, z: 2 },
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.95, now: () => 2_000,
    }).selectedTargetIds).toEqual(['target'])
    const ownOriginMap = {
      ...map,
      placements: map.placements.map(placement => placement.id === 'target'
        ? { ...placement, position: { x: 6, y: 0, z: 2 } }
        : placement),
    }
    expect(resolveAuthoritativeMove({
      map: ownOriginMap, pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Ember', originCell: { ...map.placements[0]!.position },
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.95, now: () => 2_000,
    }).selectedTargetIds).toEqual(['target'])
    expect(() => resolveAuthoritativeMove({
      map,
      pokemonSheets: new Map([['actor', { ...actor, abilities: [], revision: 4 }], ['target', target]]),
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Ember', originCell: { x: 3, y: 0, z: 2 },
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.95, now: () => 2_000,
    })).toThrow(/origin|ability/i)

    const noseTargetId = noses.find(entity => entity.position.x === 3)?.entityId
    if (!noseTargetId) throw new Error('Expected ranged-origin Mini-Nose target fixture.')
    const damagePlan = planAuthoritativeMoveStateExecution({
      map, pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'target', moveName: 'Ember',
        selection: { kind: 'single-target', targetPlacementId: noseTargetId },
      },
      random: () => 0.95, now: () => 2_500,
      operationId: 'op_aa080_mini_nose_damage',
      pendingResolutionId: 'resolution:aa080:mini-nose-damage',
    })
    expect(isAuthoritativePendingMoveStatePlan(damagePlan)).toBe(false)
    expect(damagePlan.nextMap.encounterState?.abilityEntities?.entries.find(entity => (
      entity.entityId === noseTargetId
    ))?.currentHp).toBe(0)
    expect(damagePlan.sheetWrites.some(write => write.slug === 'actor')).toBe(false)

    dependencies.mapRepository.saveSetupMap(damagePlan.nextMap)
    const nextDayActor = savedSheet(dependencies, 'actor')
    dependencies.sheetRepository.saveSetupSheet('pokemon', 'actor', {
      ...nextDayActor,
      abilityUsage: { schemaVersion: 1, dayKey: 'campaign-day:next', entries: [] },
      revision: (nextDayActor.revision ?? 0) + 1,
    } as unknown as Record<string, unknown>)
    resetTurn(dependencies, slug, 2)
    resolve({
      dependencies, slug, canonicalId: 'Mini-Noses', modeId: 'deploy', suffix: 'regrow-one',
      cells: [{ x: 2, y: 0, z: 3 }],
    })
    map = dependencies.mapRepository.getBySlug(slug)!
    expect(map.encounterState?.abilityEntities?.entries.filter(entity => (
      aa080IsMiniNoseEntity(entity) && aa080EntityIsActive(entity)
    ))).toHaveLength(3)

    resolve({
      dependencies, slug, canonicalId: 'Mini-Noses', modeId: 'shift', suffix: 'shift-one',
      cells: [{ x: 2, y: 0, z: 4 }, { x: 1, y: 0, z: 3 }, { x: 3, y: 0, z: 3 }],
    })
    map = dependencies.mapRepository.getBySlug(slug)!
    expect(map.encounterState?.abilityTiming?.round.uses).toContainEqual(expect.objectContaining({
      canonicalId: 'Mini-Noses', constraintId: 'mini-noses-shift', spent: 1, limit: 1,
    }))
    expect(() => resolve({
      dependencies, slug, canonicalId: 'Mini-Noses', modeId: 'shift', suffix: 'shift-two',
      cells: [{ x: 2, y: 0, z: 1 }, { x: 1, y: 0, z: 2 }, { x: 3, y: 0, z: 2 }],
    })).toThrow(/limit is exhausted/i)
  }, 30_000)

  it('Mini-Noses deterministically auto-shifts out-of-tether entities toward a conscious effective owner at turn start', () => {
    const slug = 'aa080-mini-tether'
    const dependencies = setup({ slug, ability: 'Mini-Noses' })
    resolve({
      dependencies, slug, canonicalId: 'Mini-Noses', modeId: 'deploy',
      cells: [{ x: 3, y: 0, z: 2 }],
    })
    const map = dependencies.mapRepository.getBySlug(slug)!
    const entry = map.encounterState!.abilityEntities!.entries.find(aa080IsMiniNoseEntity)!
    const forcedMap: TabletopMap = {
      ...map,
      encounterState: {
        ...map.encounterState!,
        abilityEntities: {
          ...map.encounterState!.abilityEntities!,
          entries: map.encounterState!.abilityEntities!.entries.map(candidate => (
            candidate.entityId === entry.entityId ? { ...candidate, position: { x: 11, y: 0, z: 2 } } : candidate
          )),
        },
      },
    }
    const actor = savedSheet(dependencies, 'actor')
    const target = savedSheet(dependencies, 'target')
    const forcedEntry = { ...entry, position: { x: 11, y: 0, z: 2 } }
    const lifecycle = planEncounterLifecycle({
      map: forcedMap,
      events: [{
        schemaVersion: 2, eventId: 'event.aa080.mini.turn-start', kind: 'turn-start',
        sourceOperationId: 'op.aa080.mini.turn-start', causalParentEventId: null,
        reasonCode: 'test.aa080.mini.turn-start', round: 1, turn: 1,
        placementId: 'actor', sideId: 'heroes',
      }],
      time: 2_000, random: () => 0.5,
      loadSheets: () => ({ pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map() }),
    })
    const shifted = lifecycle.nextMap.encounterState!.abilityEntities!.entries.find(candidate => candidate.entityId === entry.entityId)!
    const owner = { position: lifecycle.nextMap.placements[0]!.position, base: 1, clearance: 1 }
    expect(ptuGridDistanceBetweenFootprints(forcedEntry, shifted)).toBeLessThanOrEqual(4)
    expect(ptuGridDistanceBetweenFootprints(shifted, owner))
      .toBeLessThan(ptuGridDistanceBetweenFootprints(forcedEntry, owner))
  })

  it('Missile Launch deploys exactly two Dreepy, shifts all with Swift 4, and consumes one colliding token for authoritative DB 5 Dragon damage', () => {
    const slug = 'aa080-missile-launch'
    const dependencies = setup({ slug, ability: 'Missile Launch' })
    resolve({
      dependencies, slug, canonicalId: 'Missile Launch', modeId: 'deploy',
      cells: [{ x: 3, y: 0, z: 2 }, { x: 4, y: 0, z: 2 }],
    })
    let map = dependencies.mapRepository.getBySlug(slug)!
    expect(map.encounterState?.abilityEntities?.entries.filter(aa080IsDreepyEntity)).toHaveLength(2)
    expect(map.encounterState?.turnResources.actor?.actions.standard.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Missile Launch', spent: 1, limit: 2,
    }))

    const actor = savedSheet(dependencies, 'actor')
    const target = savedSheet(dependencies, 'target')
    const connectionContext = buildAuthoritativeMoveRulesContext({
      map, pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Ember', selection: { kind: 'self' },
      },
      selectedPlacementIds: [], random: () => 0.75, time: 1_250,
    })
    const connectionEntry = connectionContext.queries.resolveActorMoveEntry('Dragon Darts')
    expect(connectionEntry.ok).toBe(true)
    if (!connectionEntry.ok) throw new Error(connectionEntry.message)
    expect(connectionEntry.entry).toMatchObject({ canonicalMoveName: 'Dragon Darts', automatic: true })

    resetTurn(dependencies, slug, 2)
    map = dependencies.mapRepository.getBySlug(slug)!
    const dragonDartsPlan = planAuthoritativeMoveStateExecution({
      map, pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Dragon Darts',
        selection: { kind: 'target-count', targetPlacementIds: ['target'] },
      },
      random: () => 0.95, now: () => 1_400,
      operationId: 'op_aa080_dragon_darts',
      pendingResolutionId: 'resolution:aa080:dragon-darts',
    })
    expect(isAuthoritativePendingMoveStatePlan(dragonDartsPlan)).toBe(false)
    if (isAuthoritativePendingMoveStatePlan(dragonDartsPlan)) throw new Error('Dragon Darts unexpectedly suspended.')
    const dragonDartsTarget = dragonDartsPlan.sheetWrites.find(write => (
      write.kind === 'pokemon' && write.slug === 'target'
    ))?.nextSheet as CharacterSheet | undefined
    expect(dragonDartsTarget?.combat?.currentHp).toBeLessThan(target.combat?.currentHp ?? 0)
    expect(JSON.stringify(dragonDartsPlan.resolution.auditTrace)).toContain('dragon-darts.multi-hit')

    const dreepyId = map.encounterState!.abilityEntities!.entries
      .filter(aa080IsDreepyEntity)
      .find(entity => entity.position.x === 4)?.entityId
    if (!dreepyId) throw new Error('Expected targetable Dreepy fixture.')
    const damagePlan = planAuthoritativeMoveStateExecution({
      map, pokemonSheets: new Map([['actor', actor], ['target', target]]), trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'target', moveName: 'Ember',
        selection: { kind: 'single-target', targetPlacementId: dreepyId },
      },
      random: () => 0.95, now: () => 1_500,
      operationId: 'op_aa080_dreepy_damage',
      pendingResolutionId: 'resolution:aa080:dreepy-damage',
    })
    expect(damagePlan.nextMap.encounterState?.abilityEntities?.entries.some(entity => (
      entity.entityId === dreepyId
    ))).toBe(false)
    expect(damagePlan.sheetWrites.some(write => write.slug === 'actor')).toBe(false)

    resolve({
      dependencies, slug, canonicalId: 'Missile Launch', modeId: 'shift', suffix: 'shift',
      cells: [{ x: 3, y: 0, z: 3 }, { x: 4, y: 0, z: 3 }],
    })
    map = dependencies.mapRepository.getBySlug(slug)!
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityEntities?.entries.filter(aa080IsDreepyEntity)
      .map(entity => entity.position)).toEqual([
      { x: 3, y: 0, z: 3 }, { x: 4, y: 0, z: 3 },
    ])

    resetTurn(dependencies, slug, 3)
    const beforeHp = savedSheet(dependencies, 'target').combat?.currentHp ?? 0
    const result = resolve({
      dependencies, slug, canonicalId: 'Missile Launch', modeId: 'collision', suffix: 'collision-hit-a',
      cells: [{ x: 7, y: 0, z: 2 }], targetId: 'target',
    })
    map = dependencies.mapRepository.getBySlug(slug)!
    expect(map.encounterState?.abilityEntities?.entries.filter(aa080IsDreepyEntity)).toHaveLength(1)
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(result.kind).toBe('accepted')
    expect(savedSheet(dependencies, 'target').combat?.currentHp).toBeLessThan(beforeHp)

    dependencies.mapRepository.saveSetupMap({
      ...map,
      placements: map.placements.map(placement => placement.id === 'target'
        ? { ...placement, sideId: 'heroes' }
        : placement),
    })
    resetTurn(dependencies, slug, 3)
    const alliedBeforeHp = savedSheet(dependencies, 'target').combat?.currentHp ?? 0
    resolve({
      dependencies, slug, canonicalId: 'Missile Launch', modeId: 'collision', suffix: 'collision-ally',
      cells: [{ x: 7, y: 0, z: 2 }], targetId: 'target',
    })
    expect(savedSheet(dependencies, 'target').combat?.currentHp).toBeLessThan(alliedBeforeHp)
    expect(dependencies.mapRepository.getBySlug(slug)?.encounterState?.abilityEntities?.entries
      .filter(aa080IsDreepyEntity)).toHaveLength(0)
  }, 30_000)

  it('Misty Surge atomically pays Swift and Scene x3 while replacing the terrain for one round', () => {
    const slug = 'aa080-misty-surge'
    const dependencies = setup({ slug, ability: 'Misty Surge' })
    resolve({ dependencies, slug, canonicalId: 'Misty Surge', modeId: 'activate' })
    const map = dependencies.mapRepository.getBySlug(slug)!
    expect(map.fieldEffects?.terrains).toContainEqual(expect.objectContaining({ kind: 'misty' }))
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Misty Surge', spent: 1, limit: 3,
    }))
  })
})
