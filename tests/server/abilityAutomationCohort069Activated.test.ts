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
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import {
  AA069_EMPOWER_MOVE_MARK_PREFIX,
  AA069_FADE_AWAY_SHIFT_MARK,
} from '#shared/abilityAutomation/aa069'

const slugify = (value: string): string => value.toLowerCase().replaceAll(' ', '-').replaceAll('’', '')
const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${slugify(canonicalId)}`,
    canonicalId,
    definitionVersion: canonicalId === 'Fabulous Trim' ? 1 : null,
    selections: canonicalId === 'Fabulous Trim'
      ? [{ parameterId: 'trim', optionIds: [] }]
      : [],
  },
})
const sheet = (input: {
  slug: string
  ability?: string
  moves?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  types: ['Normal'], abilities: input.ability ? [ability(input.ability)] : [],
  movelist: (input.moves ?? []).map(name => ({ name })),
  stats: {
    hp: { added: 45 }, atk: { added: 25 }, def: { added: 25 },
    satk: { added: 25 }, sdef: { added: 25 }, spd: { added: 25 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: 150, injuries: 0, conditions: [] },
})
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 3, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5,
    dimensions: { x: 8, y: 4, z: 8 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
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
        placement.id, createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
  }
}

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (input: { slug: string; canonicalId: string; moves?: readonly string[] }) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap(input.slug))
  sheetRepository.saveSetupSheet('pokemon', 'actor', sheet({
    slug: 'actor', ability: input.canonicalId, moves: input.moves,
  }) as unknown as Record<string, unknown>)
  sheetRepository.saveSetupSheet('pokemon', 'target', sheet({ slug: 'target' }) as unknown as Record<string, unknown>)
  return { mapRepository, sheetRepository, now: () => 1_000 }
}
const activate = (input: {
  dependencies: ReturnType<typeof setup>
  slug: string
  canonicalId: string
  modeId?: string
  declarationId: string
  optionId?: string
}) => {
  const { dependencies } = input
  const modeId = input.modeId ?? 'activate'
  const revision = dependencies.mapRepository.getBySlug(input.slug)!.revision
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: `request:${input.slug}`, mapSlug: input.slug, baseRevision: revision,
    actorPlacementId: 'actor', abilityInstanceId: `base:${slugify(input.canonicalId)}`,
    canonicalId: input.canonicalId, modeId,
  } }, dependencies)
  const declaration = offer.declarations.find(entry => entry.declarationId === input.declarationId)!
  const optionId = input.optionId ?? declaration.options[0]?.optionId
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1, intentId: `intent:${input.slug}`, offerId: offer.offerId,
    offerSha256: offer.offerSha256, mapSlug: input.slug, baseRevision: offer.mapRevision,
    actorPlacementId: 'actor', abilityInstanceId: `base:${slugify(input.canonicalId)}`,
    canonicalId: input.canonicalId, modeId,
    selections: [{
      declarationId: input.declarationId,
      kind: declaration.kind,
      optionIds: optionId ? [optionId] : [],
    }],
  } }, dependencies)
}

const actorSheet = (dependencies: ReturnType<typeof setup>): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', 'actor')!.sheet as unknown as CharacterSheet
)

const actorContext = (dependencies: ReturnType<typeof setup>, slug: string, moveName = 'Tackle') => {
  const map = dependencies.mapRepository.getBySlug(slug)!
  return buildAuthoritativeMoveRulesContext({
    map,
    pokemonSheets: new Map([
      ['actor', actorSheet(dependencies)],
      ['target', dependencies.sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet],
    ]),
    trainerSheets: new Map(),
    intent: { schemaVersion: 1, placementId: 'actor', moveName, selection: { kind: 'self' } },
    candidatePlacementIds: ['actor'], selectedPlacementIds: ['actor'],
    random: () => 0.5, time: 1_000, resolutionId: `resolution:${slug}`,
  })
}

describe('AA-069 activated abilities', () => {
  it('aa069.electrodash.reviewed spends Swift/Scene x2 and creates the authoritative Sprint mark', () => {
    const dependencies = setup({ slug: 'aa069-electrodash', canonicalId: 'Electrodash' })
    activate({
      dependencies, slug: 'aa069-electrodash', canonicalId: 'Electrodash',
      declarationId: 'activate.none',
    })
    const map = dependencies.mapRepository.getBySlug('aa069-electrodash')!
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Electrodash', limit: 2, spent: 1,
    }))
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'numeric-modifier',
      affected: expect.objectContaining({ placementIds: ['actor'] }),
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
      payload: { attribute: 'movement', operation: 'multiply', value: 1.5, rounding: 'floor' },
    }))
  })

  it('aa069.empower.reviewed offers only self-target Status Moves and pays the selected Move with a Free Action', () => {
    const dependencies = setup({
      slug: 'aa069-empower', canonicalId: 'Empower', moves: ['Swords Dance', 'Tackle'],
    })
    const empoweredSheet = actorSheet(dependencies)
    dependencies.sheetRepository.saveSetupSheet('pokemon', 'actor', {
      ...empoweredSheet,
      abilities: [...(empoweredSheet.abilities ?? []), ability('Big Swallow')],
    } as unknown as Record<string, unknown>)
    const revision = dependencies.mapRepository.getBySlug('aa069-empower')!.revision
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
      schemaVersion: 1, requestId: 'request:aa069-empower', mapSlug: 'aa069-empower', baseRevision: revision,
      actorPlacementId: 'actor', abilityInstanceId: 'base:empower', canonicalId: 'Empower', modeId: 'activate',
    } }, dependencies)
    const moveOffer = offer.declarations.find(entry => entry.declarationId === 'activate.move')!
    expect(moveOffer.options).toHaveLength(2)
    expect(moveOffer.options[0]?.hint.kind).toBe('move')
    resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
      schemaVersion: 1, intentId: 'intent:aa069-empower', offerId: offer.offerId,
      offerSha256: offer.offerSha256, mapSlug: 'aa069-empower', baseRevision: offer.mapRevision,
      actorPlacementId: 'actor', abilityInstanceId: 'base:empower', canonicalId: 'Empower', modeId: 'activate',
      selections: [{ declarationId: 'activate.move', kind: 'move', optionIds: [moveOffer.options[0]!.optionId] }],
    } }, dependencies)
    const activatedMap = dependencies.mapRepository.getBySlug('aa069-empower')!
    expect(activatedMap.encounterState?.abilityOwnedState?.entries.some(entry => (
      entry.payload.kind === 'mark' && entry.payload.markId.startsWith(AA069_EMPOWER_MOVE_MARK_PREFIX)
    ))).toBe(true)

    const pokemonSheets = new Map<string, CharacterSheet>([
      ['actor', actorSheet(dependencies)],
      ['target', dependencies.sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet],
    ])
    const plan = planAuthoritativeMoveState({
      map: activatedMap, pokemonSheets, trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'actor', moveName: 'Swords Dance', selection: { kind: 'self' } },
      random: () => 0.5, now: () => 2_000, operationId: 'op_aa069_empowered_move',
    })
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(plan.nextMap.encounterState?.turnResources.actor?.actions.standard.spent).toBe(0)
    expect(plan.nextMap.encounterState?.abilityOwnedState?.entries.some(entry => (
      entry.payload.kind === 'mark' && entry.payload.markId.startsWith(AA069_EMPOWER_MOVE_MARK_PREFIX)
    ))).toBe(false)
  }, 30_000)

  it('aa069.fabulous-trim.reviewed persists one trim and projects its mapped replacement Ability', () => {
    const dependencies = setup({ slug: 'aa069-fabulous', canonicalId: 'Fabulous Trim' })
    const revision = dependencies.mapRepository.getBySlug('aa069-fabulous')!.revision
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
      schemaVersion: 1, requestId: 'request:aa069-fabulous', mapSlug: 'aa069-fabulous', baseRevision: revision,
      actorPlacementId: 'actor', abilityInstanceId: 'base:fabulous-trim', canonicalId: 'Fabulous Trim', modeId: 'style',
    } }, dependencies)
    const trim = offer.declarations[0]!.options.find(option => option.hint.kind === 'branch'
      && option.hint.valueId === 'diamond')!
    resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
      schemaVersion: 1, intentId: 'intent:aa069-fabulous', offerId: offer.offerId,
      offerSha256: offer.offerSha256, mapSlug: 'aa069-fabulous', baseRevision: offer.mapRevision,
      actorPlacementId: 'actor', abilityInstanceId: 'base:fabulous-trim', canonicalId: 'Fabulous Trim', modeId: 'style',
      selections: [{ declarationId: 'style.trim', kind: 'branch', optionIds: [trim.optionId] }],
    } }, dependencies)
    expect(actorSheet(dependencies).abilities?.[0]?.automation?.selections)
      .toEqual([{ parameterId: 'trim', optionIds: ['diamond'] }])
    expect(actorContext(dependencies, 'aa069-fabulous').queries.abilities.has('actor', 'Defiant')).toBe(true)
  })

  it('aa069.fashion-designer.reviewed crafts one durable item and spends its Daily use atomically', () => {
    const dependencies = setup({ slug: 'aa069-fashion', canonicalId: 'Fashion Designer' })
    const revision = dependencies.mapRepository.getBySlug('aa069-fashion')!.revision
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
      schemaVersion: 1, requestId: 'request:aa069-fashion', mapSlug: 'aa069-fashion', baseRevision: revision,
      actorPlacementId: 'actor', abilityInstanceId: 'base:fashion-designer', canonicalId: 'Fashion Designer', modeId: 'activate',
    } }, dependencies)
    const item = offer.declarations[0]!.options.find(option => option.hint.kind === 'branch'
      && option.hint.valueId === 'lucky-leaf')!
    resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
      schemaVersion: 1, intentId: 'intent:aa069-fashion', offerId: offer.offerId,
      offerSha256: offer.offerSha256, mapSlug: 'aa069-fashion', baseRevision: offer.mapRevision,
      actorPlacementId: 'actor', abilityInstanceId: 'base:fashion-designer', canonicalId: 'Fashion Designer', modeId: 'activate',
      selections: [{ declarationId: 'activate.item', kind: 'branch', optionIds: [item.optionId] }],
    } }, dependencies)
    const updated = actorSheet(dependencies)
    expect(updated.items?.extraItems).toContain('Lucky Leaf')
    expect(updated.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Fashion Designer', spent: 1, limit: 1,
    }))
  })

  it('aa069.fade-away.reviewed pays Standard/Scene and creates invisible plus one free-Shift authority', () => {
    const dependencies = setup({ slug: 'aa069-fade-active', canonicalId: 'Fade Away' })
    activate({
      dependencies, slug: 'aa069-fade-active', canonicalId: 'Fade Away',
      declarationId: 'activate.none',
    })
    const map = dependencies.mapRepository.getBySlug('aa069-fade-active')!
    expect(map.encounterState?.turnResources.actor?.actions.standard.spent).toBe(1)
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'capability', payload: expect.objectContaining({ capabilityId: 'aa069.fade-away.invisibility' }),
    }))
    expect(map.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      payload: { kind: 'mark', markId: AA069_FADE_AWAY_SHIFT_MARK },
    }))
  })
})
