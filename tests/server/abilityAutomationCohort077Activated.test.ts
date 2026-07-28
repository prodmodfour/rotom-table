import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { computeTickValue } from '~/utils/ptuHp'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'
import { aa066DazzlingDefinition } from '../../server/domain/abilityAutomation/mechanics/aa066StaticIntegration'

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
const abilitySuppression = (placementId: string) => ({
  ...creatureRuleOverlayEncounterEffectFixture({
    domain: 'ability', action: 'suppress', values: [],
    referencePlacementId: null, suppressionScope: 'all',
  }),
  id: `effect.aa077.suppression.${placementId}`,
  affected: { placementIds: [placementId], sideIds: [], cells: [] },
})
const sheet = (input: {
  slug: string
  abilities?: readonly string[]
  currentHp?: number
  conditions?: readonly string[]
  held?: string
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: 'Eevee',
  level: 25,
  revision: 3,
  types: ['Normal'],
  abilities: (input.abilities ?? []).map(ability),
  movelist: [{ name: 'Vine Whip' }, { name: 'Tackle' }],
  ...(input.held ? { items: { held: input.held } } : {}),
  stats: {
    hp: { added: 90 }, atk: { added: 40 }, def: { added: 30 },
    satk: { added: 40 }, sdef: { added: 30 }, spd: { added: 30 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: {
    currentHp: input.currentHp ?? 250,
    injuries: 0,
    conditions: [...(input.conditions ?? [])],
  },
})
const battleMap = (input: {
  slug: string
  sunny?: boolean
  designer?: boolean
  healingBlocked?: boolean
  dazzled?: boolean
  suppressActor?: boolean
}): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 3, y: 0, z: 2 } },
  ]
  const designerEffect = input.designer
    ? [{
        ...creatureRuleOverlayEncounterEffectFixture({
          domain: 'ability', action: 'add', values: [],
          referencePlacementId: null, suppressionScope: null,
        }),
        id: 'effect.aa077.designer-suit',
        kind: 'capability' as const,
        affected: { placementIds: ['actor'], sideIds: [], cells: [] },
        tags: ['ability', 'aa067', 'designer'],
        payload: { capabilityId: 'aa067.designer.resistance.fire', action: 'grant' as const, value: 1 },
      }]
    : []
  const suppressionEffects = input.suppressActor ? [abilitySuppression('actor')] : []
  const dazzlingEffect = input.dazzled
    ? [{
        id: 'effect.aa077.dazzled',
        source: { operationId: 'op_aa077_dazzled', moveId: 'ability.dazzling', placementId: 'target' },
        affected: { placementIds: ['actor'], sideIds: [], cells: [] },
        createdRound: 1, createdTurn: 1,
        ...aa066DazzlingDefinition(),
      }]
    : []
  const healingBlockEffect = input.healingBlocked
    ? [{
        ...creatureRuleOverlayEncounterEffectFixture({
          domain: 'ability', action: 'add', values: [],
          referencePlacementId: null, suppressionScope: null,
        }),
        id: 'effect.aa077.healing-block',
        kind: 'capability' as const,
        affected: { placementIds: ['actor'], sideIds: [], cells: [] },
        tags: ['ability', 'aa065', 'cruelty', 'healing-blocked'],
        payload: { capabilityId: 'aa065.cruelty.healing-blocked', action: 'grant' as const },
      }]
    : []
  return {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 12, y: 4, z: 12 }, groundLevelY: 0,
    voxels: [], hazards: [], placements,
    fieldEffects: {
      weather: input.sunny ? [{ kind: 'sunny' }] : [],
      terrains: [], rooms: [],
    },
    encounterState: {
      ...encounter,
      effects: [...designerEffect, ...suppressionEffects, ...dazzlingEffect, ...healingBlockEffect],
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
}

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (input: {
  slug: string
  abilities: readonly string[]
  currentHp?: number
  conditions?: readonly string[]
  held?: string
  sunny?: boolean
  designer?: boolean
  healingBlocked?: boolean
  dazzled?: boolean
  suppressActor?: boolean
  targetAbilities?: readonly string[]
}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(input))
  sheetRepository.saveSetupSheet('pokemon', 'actor', sheet({
    slug: 'actor', abilities: input.abilities, currentHp: input.currentHp,
    conditions: input.conditions, held: input.held,
  }) as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'target', sheet({
    slug: 'target', abilities: input.targetAbilities,
  }) as unknown as Record<string, unknown>)
  return { mapRepository, sheetRepository, now: () => 1_000 }
}
type Dependencies = ReturnType<typeof setup>
const begin = (input: {
  dependencies: Dependencies
  slug: string
  canonicalId: string
  modeId?: string
  suffix?: string
}) => beginAbilityDeclarationUseCase({ role: 'gm', command: {
  schemaVersion: 1,
  requestId: `request:${input.slug}:${input.suffix ?? input.modeId ?? 'activate'}`,
  mapSlug: input.slug,
  baseRevision: input.dependencies.mapRepository.getBySlug(input.slug)!.revision,
  actorPlacementId: 'actor',
  abilityInstanceId: `base:${id(input.canonicalId)}`,
  canonicalId: input.canonicalId,
  modeId: input.modeId ?? 'activate',
} }, input.dependencies)
const resolveOffer = (input: {
  dependencies: Dependencies
  slug: string
  canonicalId: string
  modeId?: string
  suffix?: string
  optionIndexes?: readonly number[]
}) => {
  const offer = begin(input)
  const indexes = input.optionIndexes ?? []
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1,
    intentId: `intent:${input.slug}:${input.suffix ?? input.modeId ?? 'activate'}`,
    offerId: offer.offerId,
    offerSha256: offer.offerSha256,
    mapSlug: input.slug,
    baseRevision: offer.mapRevision,
    actorPlacementId: 'actor',
    abilityInstanceId: `base:${id(input.canonicalId)}`,
    canonicalId: input.canonicalId,
    modeId: input.modeId ?? 'activate',
    selections: offer.declarations.map(declaration => ({
      declarationId: declaration.declarationId,
      kind: declaration.kind,
      optionIds: indexes.flatMap(index => declaration.options[index]?.optionId ?? []),
    })),
  } }, input.dependencies)
}
const savedSheet = (dependencies: Dependencies): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', 'actor')!.sheet as unknown as CharacterSheet
)

describe('AA-077 activated integrations', () => {
  it('aa077.leaf-gift.reviewed grants exactly one mutually exclusive durable suit and pays Daily', () => {
    const dependencies = setup({ slug: 'aa077-leaf-gift', abilities: ['Leaf Gift'] })
    const offer = begin({ dependencies, slug: 'aa077-leaf-gift', canonicalId: 'Leaf Gift' })
    expect(offer.declarations[0]?.options).toHaveLength(3)
    resolveOffer({
      dependencies, slug: 'aa077-leaf-gift', canonicalId: 'Leaf Gift', optionIndexes: [0],
    })
    const map = dependencies.mapRepository.getBySlug('aa077-leaf-gift')!
    const effect = map.encounterState?.effects.find(candidate => candidate.tags.includes('aa077-leaf-gift'))
    expect(effect).toMatchObject({
      kind: 'creature-rule-overlay',
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      payload: { domain: 'ability', action: 'add', values: ['Sun Blanket', 'Leaf Guard'] },
    })
    expect(savedSheet(dependencies).abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Leaf Gift', spent: 1, limit: 1,
    }))
    const context = buildAuthoritativeMoveRulesContext({
      map, pokemonSheets: new Map([
        ['actor', savedSheet(dependencies)],
        ['target', dependencies.sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet],
      ]),
      trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.75, time: 1_000,
    })
    // Full-catalog promotion makes both exact granted runtimes effective.
    expect(context.queries.abilities.has('actor', 'Sun Blanket')).toBe(true)
    expect(context.queries.abilities.has('actor', 'Leaf Guard')).toBe(true)
    expect(context.queries.abilities.has('actor', 'Sturdy')).toBe(false)

    const suppressed = setup({
      slug: 'aa077-leaf-gift-suppressed', abilities: ['Leaf Gift'], suppressActor: true,
    })
    expect(() => begin({
      dependencies: suppressed, slug: 'aa077-leaf-gift-suppressed', canonicalId: 'Leaf Gift',
    })).toThrow(/effective|active|suppressed|ability/i)
  })

  it('aa077.leaf-guard.reviewed cures one exact condition and skips only Scene frequency in Sunny Weather', () => {
    const normal = setup({
      slug: 'aa077-leaf-guard', abilities: ['Leaf Guard'], conditions: ['Burned'],
    })
    resolveOffer({
      dependencies: normal, slug: 'aa077-leaf-guard', canonicalId: 'Leaf Guard', optionIndexes: [0],
    })
    expect(savedSheet(normal).combat?.conditions).not.toContain('Burned')
    const normalMap = normal.mapRepository.getBySlug('aa077-leaf-guard')!
    expect(normalMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(normalMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Leaf Guard', spent: 1,
    }))

    const sunny = setup({
      slug: 'aa077-leaf-guard-sunny', abilities: ['Leaf Guard'], conditions: ['Burned'], sunny: true,
    })
    resolveOffer({
      dependencies: sunny, slug: 'aa077-leaf-guard-sunny', canonicalId: 'Leaf Guard', optionIndexes: [0],
    })
    expect(savedSheet(sunny).combat?.conditions).not.toContain('Burned')
    expect(sunny.mapRepository.getBySlug('aa077-leaf-guard-sunny')!
      .encounterState?.abilityUsage?.entries.some(entry => entry.canonicalId === 'Leaf Guard')).toBe(false)
  })

  it('aa077.leaf-rush.reviewed pays Scene x2, marks one Grass Move, applies priority/damage, and consumes once', () => {
    const dependencies = setup({ slug: 'aa077-leaf-rush', abilities: ['Leaf Rush'] })
    resolveOffer({ dependencies, slug: 'aa077-leaf-rush', canonicalId: 'Leaf Rush' })
    const map = dependencies.mapRepository.getBySlug('aa077-leaf-rush')!
    expect(map.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Leaf Rush', spent: 1, limit: 2,
    }))
    expect(map.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Leaf Rush', payload: { kind: 'mark', markId: 'aa077.leaf-rush.next-grass-move' },
    }))
    expect(() => resolveOffer({
      dependencies, slug: 'aa077-leaf-rush', canonicalId: 'Leaf Rush', suffix: 'duplicate',
    })).toThrow(/unspent Grass Move/i)

    const actor = savedSheet(dependencies)
    const target = dependencies.sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet
    const sheets = new Map([['actor', actor], ['target', target]])
    const ordinary = planAuthoritativeMoveState({
      map, pokemonSheets: sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Tackle',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.75, now: () => 1_500, operationId: 'op_aa077_leaf_rush_normal_move',
    })
    expect(ordinary.resolution.abilityPriorityOverride).not.toBe(true)
    expect(ordinary.nextMap.encounterState?.abilityOwnedState?.entries
      .some(entry => entry.canonicalId === 'Leaf Rush')).toBe(true)
    const suppressedMap = {
      ...map,
      encounterState: {
        ...map.encounterState!,
        effects: [...(map.encounterState?.effects ?? []), abilitySuppression('actor')],
      },
    }
    const suppressedPlan = planAuthoritativeMoveState({
      map: suppressedMap, pokemonSheets: sheets, trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Vine Whip',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.75, now: () => 1_750,
      operationId: 'op_aa077_leaf_rush_suppressed_move',
    })
    expect(suppressedPlan.resolution.abilityPriorityOverride).not.toBe(true)
    expect(suppressedPlan.nextMap.encounterState?.abilityOwnedState?.entries
      .some(entry => entry.canonicalId === 'Leaf Rush')).toBe(true)

    const plan = planAuthoritativeMoveState({
      map,
      pokemonSheets: sheets,
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Vine Whip',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.75, now: () => 2_000, operationId: 'op_aa077_leaf_rush_move',
    })
    expect(plan.resolution.abilityPriorityOverride).toBe(true)
    expect(JSON.stringify(plan.resolution.auditTrace)).toContain('ability.leaf-rush.half-speed-damage')
    expect(plan.nextMap.encounterState?.abilityOwnedState?.entries
      .some(entry => entry.canonicalId === 'Leaf Rush')).toBe(false)

    const dazzling = setup({
      slug: 'aa077-leaf-rush-dazzling', abilities: ['Leaf Rush'], dazzled: true,
    })
    resolveOffer({ dependencies: dazzling, slug: 'aa077-leaf-rush-dazzling', canonicalId: 'Leaf Rush' })
    expect(() => planAuthoritativeMoveState({
      map: dazzling.mapRepository.getBySlug('aa077-leaf-rush-dazzling')!,
      pokemonSheets: new Map([
        ['actor', savedSheet(dazzling)],
        ['target', dazzling.sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet],
      ]),
      trainerSheets: new Map(),
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Vine Whip',
        selection: { kind: 'single-target', targetPlacementId: 'target' },
      },
      random: () => 0.75, now: () => 2_000, operationId: 'op_aa077_leaf_rush_dazzling',
    })).toThrow(/Dazzling|priority/i)
  }, 30_000)

  it('aa077.leafy-cloak.reviewed requires Designer and grants exactly two abilities until Designer replacement', () => {
    const dependencies = setup({
      slug: 'aa077-leafy-cloak', abilities: ['Leafy Cloak', 'Designer'], designer: true,
    })
    const offer = begin({ dependencies, slug: 'aa077-leafy-cloak', canonicalId: 'Leafy Cloak' })
    expect(offer.declarations[0]?.options).toHaveLength(3)
    resolveOffer({
      dependencies, slug: 'aa077-leafy-cloak', canonicalId: 'Leafy Cloak', optionIndexes: [0, 2],
    })
    const effect = dependencies.mapRepository.getBySlug('aa077-leafy-cloak')!
      .encounterState?.effects.find(candidate => candidate.tags.includes('aa077-leafy-cloak'))
    expect(effect).toMatchObject({
      kind: 'creature-rule-overlay',
      payload: { domain: 'ability', action: 'add', values: ['Chlorophyll', 'Overcoat'] },
    })
    resolveOffer({
      dependencies, slug: 'aa077-leafy-cloak', canonicalId: 'Designer',
      suffix: 'designer-replacement', optionIndexes: [0, 1],
    })
    expect(dependencies.mapRepository.getBySlug('aa077-leafy-cloak')!
      .encounterState?.effects.some(candidate => candidate.tags.includes('aa077-leafy-cloak')))
      .toBe(false)

    const missing = setup({ slug: 'aa077-leafy-cloak-missing', abilities: ['Leafy Cloak'] })
    expect(() => resolveOffer({
      dependencies: missing, slug: 'aa077-leafy-cloak-missing',
      canonicalId: 'Leafy Cloak', optionIndexes: [0, 1],
    })).toThrow(/Designer/i)
  })

  it('aa077.life-force.reviewed heals exactly one Tick with Swift and Daily x5 payment', () => {
    const dependencies = setup({
      slug: 'aa077-life-force', abilities: ['Life Force'], currentHp: 100,
    })
    const before = savedSheet(dependencies)
    const mapBefore = dependencies.mapRepository.getBySlug('aa077-life-force')!
    const context = buildAuthoritativeMoveRulesContext({
      map: mapBefore,
      pokemonSheets: new Map([
        ['actor', before],
        ['target', dependencies.sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet],
      ]),
      trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target' } },
      random: () => 0.75, time: 1_000,
    })
    const tick = computeTickValue(context.actor.token.fullMaxHp ?? context.actor.token.maxHp)
    resolveOffer({ dependencies, slug: 'aa077-life-force', canonicalId: 'Life Force' })
    const after = savedSheet(dependencies)
    expect((after.combat?.currentHp ?? 0) - (before.combat?.currentHp ?? 0)).toBe(tick)
    expect(after.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Life Force', spent: 1, limit: 5,
    }))
    expect(dependencies.mapRepository.getBySlug('aa077-life-force')!
      .encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)

    const blocked = setup({
      slug: 'aa077-life-force-blocked', abilities: ['Life Force'],
      currentHp: 100, healingBlocked: true,
    })
    resolveOffer({ dependencies: blocked, slug: 'aa077-life-force-blocked', canonicalId: 'Life Force' })
    expect(savedSheet(blocked).combat?.currentHp).toBe(100)
    expect(savedSheet(blocked).abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Life Force', spent: 1, limit: 5,
    }))
  })

  it('aa077.klutz-and-leek-mastery.reviewed voluntarily drop only server-issued equipped choices', () => {
    const klutz = setup({
      slug: 'aa077-klutz-drop', abilities: ['Klutz'], held: 'Quick Claw', conditions: ['Sleep'],
    })
    resolveOffer({
      dependencies: klutz, slug: 'aa077-klutz-drop', canonicalId: 'Klutz',
      modeId: 'drop', optionIndexes: [0],
    })
    expect(savedSheet(klutz).items?.held).toBeUndefined()
    expect(klutz.mapRepository.getBySlug('aa077-klutz-drop')!.encounterState?.groundItems)
      .toHaveLength(1)

    const leek = setup({
      slug: 'aa077-leek-drop', abilities: ['Leek Mastery'], held: 'Rare Leek',
    })
    resolveOffer({
      dependencies: leek, slug: 'aa077-leek-drop', canonicalId: 'Leek Mastery',
      modeId: 'drop', optionIndexes: [0],
    })
    expect(savedSheet(leek).items?.held).toBeUndefined()
    expect(leek.mapRepository.getBySlug('aa077-leek-drop')!.encounterState?.groundItems)
      .toHaveLength(1)
  })
})
