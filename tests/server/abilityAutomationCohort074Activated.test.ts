import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { resolveAuthoritativeMoveUserAccuracy } from '../../server/domain/moveAutomation/accuracy'
import { aa074HungerModeForPlacement } from '#shared/abilityAutomation/aa074'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { conditionEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

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
  ability: string
  conditions?: readonly string[]
  held?: string
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 20,
  revision: 3,
  types: ['Normal'],
  abilities: [ability(input.ability)],
  movelist: [{ name: 'Tackle' }],
  ...(input.held ? { items: { held: input.held } } : {}),
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [...(input.conditions ?? [])] },
})

const battleMap = (input: {
  slug: string
  weather?: 'rainy'
  conditionEffect?: boolean
}): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
  ]
  const applied = conditionEncounterEffectFixture()
  return {
    schemaVersion: 2,
    slug: input.slug,
    name: input.slug,
    revision: 5,
    dimensions: { x: 12, y: 4, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [], hazards: [],
    fieldEffects: {
      weather: input.weather ? [{ kind: input.weather, rounds: 2 }] : [],
      terrains: [], rooms: [],
    },
    placements,
    encounterState: {
      ...encounter,
      effects: input.conditionEffect ? [{
        ...applied,
        id: 'effect.aa074.hydration.burned',
        source: { ...applied.source, placementId: 'target' },
        affected: { placementIds: ['actor'], sideIds: [], cells: [] },
        payload: { ...applied.payload, conditionId: 'burned', action: 'apply' },
      }] : [],
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
}

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

const setup = (input: {
  slug: string
  ability: string
  conditions?: readonly string[]
  weather?: 'rainy'
  conditionEffect?: boolean
  held?: string
}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(input))
  sheetRepository.saveSetupSheet('pokemon', 'actor', sheet({
    slug: 'actor', ability: input.ability, conditions: input.conditions, held: input.held,
  }) as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'target', sheet({
    slug: 'target', ability: 'Overgrow',
  }) as unknown as Record<string, unknown>)
  return { mapRepository, sheetRepository, now: () => 1_000 }
}

const begin = (dependencies: ReturnType<typeof setup>, slug: string, canonicalId: string, modeId: string) => (
  beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1,
    requestId: `request:${slug}`,
    mapSlug: slug,
    baseRevision: dependencies.mapRepository.getBySlug(slug)!.revision,
    actorPlacementId: 'actor',
    abilityInstanceId: `base:${id(canonicalId)}`,
    canonicalId,
    modeId,
  } }, dependencies)
)

const executeBranch = (input: {
  dependencies: ReturnType<typeof setup>
  slug: string
  canonicalId: string
  modeId: string
  valueId: string
}) => {
  const offer = begin(input.dependencies, input.slug, input.canonicalId, input.modeId)
  const declaration = offer.declarations[0]!
  const selected = declaration.options.find(option => (
    option.hint.kind === 'branch' && option.hint.valueId === input.valueId
  ))
  if (!selected) throw new Error(`Missing ${input.valueId} option.`)
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1,
    intentId: `intent:${input.slug}`,
    offerId: offer.offerId,
    offerSha256: offer.offerSha256,
    mapSlug: input.slug,
    baseRevision: offer.mapRevision,
    actorPlacementId: 'actor',
    abilityInstanceId: `base:${id(input.canonicalId)}`,
    canonicalId: input.canonicalId,
    modeId: input.modeId,
    selections: [{
      declarationId: declaration.declarationId,
      kind: 'branch',
      optionIds: [selected.optionId],
    }],
  } }, input.dependencies)
}

const savedSheet = (dependencies: ReturnType<typeof setup>): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', 'actor')!.sheet as unknown as CharacterSheet
)

const contextFor = (dependencies: ReturnType<typeof setup>, slug: string) => {
  const actor = savedSheet(dependencies)
  const target = dependencies.sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet
  return buildAuthoritativeMoveRulesContext({
    map: dependencies.mapRepository.getBySlug(slug)!,
    pokemonSheets: new Map([['actor', actor], ['target', target]]),
    trainerSheets: new Map(),
    intent: {
      schemaVersion: 1,
      placementId: 'actor',
      moveName: 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: 'target' },
    },
    random: () => 0.5,
    time: 2_000,
  })
}

describe('AA-074 activated and configuration abilities', () => {
  it('aa074.honey-paws.reviewed requires explicit no-cost preparation for the next held Honey', () => {
    const dependencies = setup({
      slug: 'aa074-honey-paws-prepare', ability: 'Honey Paws', held: 'Honey',
    })
    const offer = begin(
      dependencies, 'aa074-honey-paws-prepare', 'Honey Paws', 'prepare-leftovers',
    )
    expect(offer.declarations).toEqual([])
    resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
      schemaVersion: 1,
      intentId: 'intent:aa074-honey-paws-prepare',
      offerId: offer.offerId,
      offerSha256: offer.offerSha256,
      mapSlug: 'aa074-honey-paws-prepare',
      baseRevision: offer.mapRevision,
      actorPlacementId: 'actor',
      abilityInstanceId: 'base:honey-paws',
      canonicalId: 'Honey Paws',
      modeId: 'prepare-leftovers',
      selections: [],
    } }, dependencies)
    const map = dependencies.mapRepository.getBySlug('aa074-honey-paws-prepare')!
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability',
      payload: {
        capabilityId: 'aa074.honey-paws.prepared:base:honey-paws',
        action: 'grant',
      },
      duration: { kind: 'scene', remaining: null },
    }))
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(0)
    expect(() => begin(
      dependencies, 'aa074-honey-paws-prepare', 'Honey Paws', 'prepare-leftovers',
    )).toThrow()
  })

  it('aa074.hunger-switch.reviewed requires one turn-scoped mode and projects Full Belly Accuracy', () => {
    const dependencies = setup({ slug: 'aa074-hunger-full', ability: 'Hunger Switch' })
    const unconfiguredMap = dependencies.mapRepository.getBySlug('aa074-hunger-full')!
    const unconfiguredActor = savedSheet(dependencies)
    const unconfiguredTarget = dependencies.sheetRepository
      .getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet
    expect(() => planAuthoritativeMoveState({
      map: unconfiguredMap,
      pokemonSheets: new Map([['actor', unconfiguredActor], ['target', unconfiguredTarget]]),
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.75,
      now: () => 1_500,
      operationId: 'op_aa074_hunger_unconfigured',
    })).toThrow(/requires a Full Belly or Hangry choice/i)

    const offer = begin(dependencies, 'aa074-hunger-full', 'Hunger Switch', 'choose-mode')
    expect(offer.declarations[0]?.options.map(option => (
      option.hint.kind === 'branch' ? option.hint.valueId : null
    ))).toEqual(['full-belly', 'hangry'])
    executeBranch({
      dependencies, slug: 'aa074-hunger-full', canonicalId: 'Hunger Switch',
      modeId: 'choose-mode', valueId: 'full-belly',
    })
    const map = dependencies.mapRepository.getBySlug('aa074-hunger-full')!
    expect(aa074HungerModeForPlacement(map.encounterState?.effects, 'actor')).toBe('full-belly')
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'creature-rule-overlay',
      payload: expect.objectContaining({ domain: 'form', value: 'full-belly-mode' }),
      duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
    }))
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(0)
    const configured = contextFor(dependencies, 'aa074-hunger-full')
    const accuracy = resolveAuthoritativeMoveUserAccuracy(configured, {
      script: configured.queries.rules.reviewedScriptFor('Tackle')!,
    })
    expect(accuracy.modifiers).toContainEqual(expect.objectContaining({
      sourceId: 'ability.hunger-switch', value: 2,
    }))
    expect(() => begin(dependencies, 'aa074-hunger-full', 'Hunger Switch', 'choose-mode'))
      .toThrow()
  })

  it('aa074.hunger-switch.reviewed projects Hangry form and the reviewed +5 Damage Roll bonus', () => {
    const dependencies = setup({ slug: 'aa074-hunger-hangry', ability: 'Hunger Switch' })
    executeBranch({
      dependencies, slug: 'aa074-hunger-hangry', canonicalId: 'Hunger Switch',
      modeId: 'choose-mode', valueId: 'hangry',
    })
    const map = dependencies.mapRepository.getBySlug('aa074-hunger-hangry')!
    expect(aa074HungerModeForPlacement(map.encounterState?.effects, 'actor')).toBe('hangry')
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'creature-rule-overlay',
      payload: expect.objectContaining({ domain: 'form', value: 'hangry-mode' }),
    }))
    const configured = contextFor(dependencies, 'aa074-hunger-hangry')
    expect(configured.actor.token.creatureRules?.formId).toBe('hangry-mode')
    const actor = savedSheet(dependencies)
    const target = dependencies.sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet
    const plan = planAuthoritativeMoveState({
      map,
      pokemonSheets: new Map([['actor', actor], ['target', target]]),
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.75,
      now: () => 2_000,
      operationId: 'op_aa074_hunger_hangry_move',
    })
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('ability.hunger-switch.damage-roll-bonus')
  })

  it('aa074.hydration.reviewed cures exactly one issued condition and atomically pays Swift/Scene', () => {
    const dependencies = setup({
      slug: 'aa074-hydration', ability: 'Hydration',
      conditions: ['Burned', 'Confused'], conditionEffect: true,
    })
    executeBranch({
      dependencies, slug: 'aa074-hydration', canonicalId: 'Hydration',
      modeId: 'activate', valueId: 'condition.burned',
    })
    expect(savedSheet(dependencies).combat?.conditions).toEqual(['Confused'])
    const map = dependencies.mapRepository.getBySlug('aa074-hydration')!
    expect(map.encounterState?.effects.some(effect => effect.id === 'effect.aa074.hydration.burned')).toBe(false)
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Hydration', spent: 1, limit: 1,
    }))
  })

  it('aa074.hydration.reviewed ignores only its frequency during Rainy Weather', () => {
    const dependencies = setup({
      slug: 'aa074-hydration-rain', ability: 'Hydration',
      conditions: ['Burned'], weather: 'rainy',
    })
    executeBranch({
      dependencies, slug: 'aa074-hydration-rain', canonicalId: 'Hydration',
      modeId: 'activate', valueId: 'condition.burned',
    })
    const map = dependencies.mapRepository.getBySlug('aa074-hydration-rain')!
    expect(savedSheet(dependencies).combat?.conditions).toEqual([])
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries ?? []).not.toContainEqual(expect.objectContaining({
      canonicalId: 'Hydration',
    }))
  })
})
