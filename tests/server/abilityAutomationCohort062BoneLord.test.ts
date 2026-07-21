import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const actorSheet = (): CharacterSheet => ({
  slug: 'bone-lord', nickname: 'Bone Lord', species: 'Marowak', level: 30, revision: 3,
  types: ['Ground'], abilities: [{
    name: 'Bone Lord', automation: {
      schemaVersion: 1, instanceId: 'base:bone-lord', canonicalId: 'Bone Lord',
      definitionVersion: null, selections: [],
    },
  }],
  movelist: [{ name: 'Bone Club' }, { name: 'Bone Rush' }],
  stats: { hp: { added: 30 }, atk: { added: 30 }, def: { added: 20 }, satk: { added: 10 }, sdef: { added: 20 } },
  combat: { currentHp: 100, conditions: [] },
})
const targetSheet = (): CharacterSheet => ({
  slug: 'target', nickname: 'Target', species: 'Snorlax', level: 30, revision: 3,
  types: ['Normal'], abilities: [], movelist: [],
  stats: { hp: { added: 50 }, atk: { added: 10 }, def: { added: 20, stage: 0 }, satk: { added: 10, stage: 0 }, sdef: { added: 20 } },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, conditions: [] },
})
const map = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'aa062-bone-lord', name: 'Bone Lord', revision: 5,
    dimensions: { x: 10, y: 4, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'bone-lord', position: { x: 1, y: 0, z: 1 } },
      { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 2, y: 0, z: 1 } },
    ],
    encounterState: {
      ...encounter, history: { ...encounter.history, sceneId: 'scene:bone-lord' },
      turnResources: { actor: createEncounterTurnResourceLedger({ placementId: 'actor', round: 1 }) },
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const arm = (moveName: string) => {
  const moveSlug = moveName.toLowerCase().replace(/ /g, '-')
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  const actor = actorSheet(), target = targetSheet()
  mapRepository.saveSetupMap(map())
  sheetRepository.saveSetupSheet('pokemon', actor.slug, actor as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', target.slug, target as unknown as Record<string, unknown>)
  const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: `request:bone-lord:${moveSlug}`, mapSlug: map().slug, baseRevision: 5,
    actorPlacementId: 'actor', abilityInstanceId: 'base:bone-lord', canonicalId: 'Bone Lord', modeId: 'empower',
  } }, dependencies)
  const option = offer.declarations[0]!.options.find(entry => entry.hint.kind === 'move'
    && entry.hint.valueId === entry.optionId
    && entry.presentationKey === 'ability.option.move'
    && offer.declarations[0]!.options.indexOf(entry) === ['Bone Club', 'Bone Rush', 'Bonemerang'].indexOf(moveName))!
  resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1, intentId: `intent:bone-lord:${moveSlug}`, offerId: offer.offerId, offerSha256: offer.offerSha256,
    mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
    abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
    selections: [{ declarationId: 'empower.move', kind: 'move', optionIds: [option.optionId] }],
  } }, dependencies)
  return { actor, target, map: mapRepository.getBySlug('aa062-bone-lord')! }
}

describe('AA-062 Bone Lord', () => {
  it('aa062.bone-lord.empowered-moves applies Bone Club stage losses and consumes only the ready mark', () => {
    const setup = arm('Bone Club')
    const plan = planAuthoritativeMoveState({
      map: setup.map, pokemonSheets: new Map([[setup.actor.slug, setup.actor], [setup.target.slug, setup.target]]), trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Bone Club', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.5, now: () => 2_000, operationId: 'op_bone_lord_club',
    })
    const write = plan.sheetWrites.find(entry => entry.slug === setup.target.slug)!
    const next = write.nextSheet as CharacterSheet
    expect(next.stats?.def?.stage).toBe(-1)
    expect(next.stats?.satk?.stage).toBe(-1)
    const marks = plan.nextMap.encounterState?.abilityOwnedState?.entries.filter(entry => entry.canonicalId === 'Bone Lord') ?? []
    expect(marks.some(entry => entry.payload.kind === 'mark' && entry.payload.markId.startsWith('aa062.bone-lord.ready:'))).toBe(false)
    expect(marks.some(entry => entry.payload.kind === 'mark' && entry.payload.markId.startsWith('aa062.bone-lord.used:'))).toBe(true)
  }, 20_000)

  it('forces Bone Rush to exactly four hits without a hit-count draw', () => {
    const setup = arm('Bone Rush')
    const plan = planAuthoritativeMoveState({
      map: setup.map, pokemonSheets: new Map([[setup.actor.slug, setup.actor], [setup.target.slug, setup.target]]), trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Bone Rush', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.5, now: () => 2_000, operationId: 'op_bone_lord_rush',
    })
    expect(plan.resolution.rollLedger.filter(roll => roll.rollId.includes('critical-roll')).length).toBe(4)
    expect(plan.resolution.rollLedger.some(roll => roll.rollId.includes('hit-count-roll'))).toBe(false)
  }, 20_000)

  it('turns the Bonemerang Connection into Line 6 and removes Double Strike', () => {
    const setup = arm('Bonemerang')
    const context = buildAuthoritativeMoveRulesContext({
      map: setup.map, pokemonSheets: new Map([[setup.actor.slug, setup.actor], [setup.target.slug, setup.target]]), trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Bonemerang',
        selection: { kind: 'area', areaTemplateId: moveAutomationAreaTemplateId({ kind: 'line', size: 6 }), direction: 'east' },
      },
      selectedPlacementIds: ['target'], random: () => 0.5, time: 2_000,
    })
    const entry = context.queries.resolveActorMoveEntry('Bonemerang')
    expect(entry).toMatchObject({ ok: true, entry: { script: {
      targetMode: 'multi-target', range: 'Line 6', keywords: [],
      areaTemplates: [{ kind: 'line', size: 6, label: 'Line 6' }],
    } } })
    const plan = planAuthoritativeMoveState({
      map: setup.map, pokemonSheets: new Map([[setup.actor.slug, setup.actor], [setup.target.slug, setup.target]]), trainerSheets: new Map(),
      intent: context.intent, random: () => 0.5, now: () => 2_000, operationId: 'op_bone_lord_bonemerang',
    })
    expect(plan.resolution.selectedTargetIds).toContain('target')
    expect(plan.resolution.rollLedger.filter(roll => roll.rollId.includes('accuracy-roll')).length).toBe(1)
  }, 20_000)
})
