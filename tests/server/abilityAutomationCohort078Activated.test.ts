import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { aa066DazzlingDefinition } from '../../server/domain/abilityAutomation/mechanics/aa066StaticIntegration'

const slugId = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${slugId(canonicalId)}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (slug: string, abilities: readonly string[] = []): CharacterSheet => ({
  slug, nickname: slug, species: 'Eevee', level: 30, revision: 3, types: ['Normal'],
  abilities: abilities.map(ability),
  movelist: [{ name: 'Mega Kick' }, { name: 'Grass Whistle' }, { name: 'Water Gun' }],
  stats: {
    hp: { added: 100 }, atk: { added: 45 }, def: { added: 35 },
    satk: { added: 45 }, sdef: { added: 35 }, spd: { added: 40 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 300, injuries: 0, conditions: [] },
})
const map = (slug: string, dazzled = false): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5,
    dimensions: { x: 12, y: 4, z: 12 }, groundLevelY: 0,
    voxels: [], hazards: [], placements,
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      effects: dazzled ? [{
        id: `effect.${slug}.dazzling`,
        source: { operationId: `op_${slug}`, moveId: 'ability.dazzling', placementId: 'target' },
        affected: { placementIds: ['actor'], sideIds: [], cells: [] },
        createdRound: 1, createdTurn: 1,
        ...aa066DazzlingDefinition(),
      }] : [],
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
    activeScene: { name: 'Scene', startedAt: 100 },
  }
}

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (slug: string, canonicalId: string, dazzled = false) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(map(slug, dazzled))
  sheetRepository.saveSetupSheet('pokemon', 'actor', sheet('actor', [canonicalId]) as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'target', sheet('target') as unknown as Record<string, unknown>)
  return { mapRepository, sheetRepository, now: () => 1_000 }
}
type Dependencies = ReturnType<typeof setup>
const activate = (
  dependencies: Dependencies,
  slug: string,
  canonicalId: string,
  optionIndex?: number,
  suffix = 'activate',
) => {
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: `request:${slug}:${slugId(canonicalId)}:${suffix}`,
    mapSlug: slug, baseRevision: dependencies.mapRepository.getBySlug(slug)!.revision,
    actorPlacementId: 'actor', abilityInstanceId: `base:${slugId(canonicalId)}`,
    canonicalId, modeId: 'activate',
  } }, dependencies)
  const declaration = offer.declarations[0]
  const result = resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1, intentId: `intent:${slug}:${slugId(canonicalId)}:${suffix}`, offerId: offer.offerId,
    offerSha256: offer.offerSha256, mapSlug: slug, baseRevision: offer.mapRevision,
    actorPlacementId: 'actor', abilityInstanceId: `base:${slugId(canonicalId)}`,
    canonicalId, modeId: 'activate',
    selections: offer.declarations.map(candidate => ({
      declarationId: candidate.declarationId,
      kind: candidate.kind,
      optionIds: candidate === declaration && optionIndex !== undefined
        ? [candidate.options[optionIndex]!.optionId]
        : [],
    })),
  } }, dependencies)
  return { offer, result }
}
const sheets = (dependencies: Dependencies) => new Map<string, CharacterSheet>([
  ['actor', dependencies.sheetRepository.getByRef('pokemon', 'actor')!.sheet as unknown as CharacterSheet],
  ['target', dependencies.sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet],
])
const useMove = (dependencies: Dependencies, slug: string, moveName: string) => planAuthoritativeMoveState({
  map: dependencies.mapRepository.getBySlug(slug)!, pokemonSheets: sheets(dependencies), trainerSheets: new Map(),
  intent: {
    schemaVersion: 1, placementId: 'actor', moveName,
    selection: { kind: 'single-target', targetPlacementId: 'target' },
  },
  random: () => 0.75, now: () => 2_000, operationId: `op_${slug}_${slugId(moveName)}`,
})

describe('AA-078 activated integrations', () => {
  it('aa078.lightning-kicks.reviewed pays once, arms one Kick, grants central priority/accuracy, and consumes the mark', () => {
    const dependencies = setup('aa078-lightning-kicks', 'Lightning Kicks')
    activate(dependencies, 'aa078-lightning-kicks', 'Lightning Kicks')
    const armedMap = dependencies.mapRepository.getBySlug('aa078-lightning-kicks')!
    expect(armedMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(armedMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Lightning Kicks', spent: 1, limit: 1,
    }))
    expect(armedMap.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Lightning Kicks', payload: { kind: 'mark', markId: 'aa078.lightning-kicks.next-kick' },
    }))
    expect(() => activate(dependencies, 'aa078-lightning-kicks', 'Lightning Kicks', undefined, 'duplicate'))
      .toThrow(/unspent|exhausted/i)

    const plan = useMove(dependencies, 'aa078-lightning-kicks', 'Mega Kick')
    expect(plan.resolution.abilityPriorityOverride).toBe(true)
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('"sourceId":"ability.lightning-kicks"')
    expect(plan.nextMap.encounterState?.abilityOwnedState?.entries
      .some(entry => entry.canonicalId === 'Lightning Kicks')).toBe(false)
  })

  it('aa078.liquid-voice.reviewed issues only server-owned modes and applies the selected Sonic overlay once', () => {
    const dependencies = setup('aa078-liquid-voice', 'Liquid Voice')
    const offer = activate(dependencies, 'aa078-liquid-voice', 'Liquid Voice', 1).offer
    expect(offer.declarations[0]).toMatchObject({
      declarationId: 'activate.mode', kind: 'branch', minSelections: 1, maxSelections: 1,
    })
    expect(offer.declarations[0]?.options).toHaveLength(2)
    expect(new Set(offer.declarations[0]?.options.map(option => option.optionId)).size).toBe(2)
    const plan = useMove(dependencies, 'aa078-liquid-voice', 'Grass Whistle')
    const trace = JSON.stringify(plan.resolution.auditTrace)
    expect(trace).toContain('ability-liquid-voice')
    expect(trace).toContain('"damageBase":1,"moveType":"water"')
    expect(plan.nextMap.encounterState?.abilityOwnedState?.entries
      .some(entry => entry.canonicalId === 'Liquid Voice')).toBe(false)
  })

  it('aa078.maelstrom-pulse.reviewed applies priority and half Speed only to the next Water Move', () => {
    const dependencies = setup('aa078-maelstrom-pulse', 'Maelstrom Pulse')
    activate(dependencies, 'aa078-maelstrom-pulse', 'Maelstrom Pulse')
    const plan = useMove(dependencies, 'aa078-maelstrom-pulse', 'Water Gun')
    expect(plan.resolution.abilityPriorityOverride).toBe(true)
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('ability.maelstrom-pulse.half-speed-damage')
    expect(plan.nextMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Maelstrom Pulse', spent: 1, limit: 2,
    }))
    expect(plan.nextMap.encounterState?.abilityOwnedState?.entries
      .some(entry => entry.canonicalId === 'Maelstrom Pulse')).toBe(false)
  })

  it('aa078 priority declarations preserve central Dazzling enforcement', () => {
    const dependencies = setup('aa078-lightning-kicks-dazzling', 'Lightning Kicks', true)
    activate(dependencies, 'aa078-lightning-kicks-dazzling', 'Lightning Kicks')
    expect(() => useMove(dependencies, 'aa078-lightning-kicks-dazzling', 'Mega Kick')).toThrow(/Dazzling|priority/i)
  })
})
