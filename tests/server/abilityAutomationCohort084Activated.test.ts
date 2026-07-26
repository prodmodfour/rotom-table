import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { computeFullMaxHp, resolveStats } from '~/utils/sheets/pokemonDerived'
import { placementToSpawned } from '~/utils/placement'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { creatureRuleOverlayEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

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
  ability?: string
  species?: string
  currentHp?: number
  conditions?: string[]
}): CharacterSheet => ({
  slug: input.slug,
  nickname: input.slug,
  species: input.species ?? 'Eevee',
  level: 30,
  revision: 3,
  types: ['Normal'],
  abilities: input.ability ? [ability(input.ability)] : [],
  movelist: [{ name: 'Tackle' }],
  stats: {
    hp: { added: 20 }, atk: { added: 15 }, def: { added: 15 },
    satk: { added: 15 }, sdef: { added: 15 }, spd: { added: 15 },
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 100, injuries: 0, conditions: input.conditions ?? [] },
})
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 2, y: 0, z: 2 } },
    { id: 'ally', sheetKind: 'pokemon', sheetSlug: 'ally', sideId: 'heroes', position: { x: 3, y: 0, z: 2 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: { x: 4, y: 0, z: 2 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5,
    dimensions: { x: 14, y: 4, z: 14 }, groundLevelY: 0,
    voxels: [], hazards: [], placements,
    fieldEffects: { weather: [], terrains: [], rooms: [] },
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
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1, turn: 1 }),
      ])),
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Scene', startedAt: 100 },
    metadata: {},
  }
}

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (input: {
  slug: string
  actorAbility: string
  actorSpecies?: string
  actorHp?: number
  targetAbility?: string
  powerConstructMarker?: boolean
}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  const initialMap = battleMap(input.slug)
  const powerConstructEffects: readonly EncounterEffect[] = input.powerConstructMarker
    ? [{
        ...creatureRuleOverlayEncounterEffectFixture({
          domain: 'form', action: 'replace', value: 'zygarde-complete-forme',
          referencePlacementId: null,
        }),
        id: 'ability.power-construct.form.test',
        affected: { placementIds: ['actor'], sideIds: [], cells: [] },
        tags: ['ability', 'aa084', 'power-construct', 'complete-forme', 'blocks-temporary-hp'],
      }]
    : []
  mapRepository.saveSetupMap({
    ...initialMap,
    encounterState: {
      ...initialMap.encounterState!,
      effects: [...initialMap.encounterState!.effects, ...powerConstructEffects],
    },
  })
  const sheets = [
    sheet({ slug: 'actor', ability: input.actorAbility, species: input.actorSpecies, currentHp: input.actorHp }),
    sheet({ slug: 'ally' }),
    sheet({ slug: 'target', ability: input.targetAbility }),
  ]
  for (const value of sheets) {
    sheetRepository.saveSetupSheet('pokemon', value.slug, value as unknown as Record<string, unknown>)
  }
  return { mapRepository, sheetRepository, now: () => 1_000 }
}
type Dependencies = ReturnType<typeof setup>
const savedSheet = (dependencies: Dependencies, slug: string): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', slug)!.sheet as unknown as CharacterSheet
)
const useAbility = (input: {
  dependencies: Dependencies
  slug: string
  canonicalId: string
  targetId?: string
  copiedAbilityId?: string
}) => {
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1,
    requestId: `request:${input.slug}`,
    mapSlug: input.slug,
    baseRevision: input.dependencies.mapRepository.getBySlug(input.slug)!.revision,
    actorPlacementId: 'actor',
    abilityInstanceId: `base:${id(input.canonicalId)}`,
    canonicalId: input.canonicalId,
    modeId: 'activate',
  } }, input.dependencies)
  const selections = offer.declarations.map(declaration => ({
    declarationId: declaration.declarationId,
    kind: declaration.kind,
    optionIds: declaration.kind === 'token'
      ? declaration.options.filter(option => option.hint.kind === 'placement'
        && option.hint.placementId === input.targetId).map(option => option.optionId)
      : declaration.kind === 'ability'
        ? declaration.options.filter(option => option.hint.kind === 'ability'
          && option.hint.valueId === `ability:${id(input.copiedAbilityId ?? '')}`).map(option => option.optionId)
        : [],
  }))
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
    modeId: 'activate',
    selections,
  } }, input.dependencies)
}

const spent = (map: TabletopMap, resource: 'free' | 'swift' | 'standard'): number => (
  map.encounterState?.turnResources.actor?.actions[resource].spent ?? 0
)

describe('AA-084 activated integrations', () => {
  it('Power Construct requires sub-half HP, preserves original Max HP, projects Complete stats, grants exact THP, and pays Daily/Swift', () => {
    const slug = 'aa084-power-construct'
    const dependencies = setup({
      slug, actorAbility: 'Power Construct', actorSpecies: 'Zygarde 50% Forme', actorHp: 1,
    })
    expect(useAbility({ dependencies, slug, canonicalId: 'Power Construct' }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(slug)!
    const actor = savedSheet(dependencies, 'actor')
    const complete = { ...actor, species: 'Zygarde Complete Forme' }
    const completeHp = resolveStats(complete).find(stat => stat.key === 'hp')!.total
    expect(map.temporaryHitPoints?.byPlacementId.actor).toBe(
      Math.floor(computeFullMaxHp(complete, completeHp) / 2),
    )
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'creature-rule-overlay',
      payload: expect.objectContaining({ domain: 'form', value: 'zygarde-complete-forme' }),
    }))
    expect(spent(map, 'swift')).toBe(1)
    expect(actor.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Power Construct', spent: 1, limit: 1,
    }))
    const projected = placementToSpawned(map.placements[0]!, {
      pokemon: new Map([['actor', actor]]), trainer: new Map(),
    }, map)!
    const original = { ...actor, species: 'Zygarde 50% Forme' }
    const originalHp = resolveStats(original).find(stat => stat.key === 'hp')!.total
    expect(projected.fullMaxHp).toBe(computeFullMaxHp(original, originalHp))
    expect(projected.satk).toBeGreaterThan(resolveStats(original).find(stat => stat.key === 'satk')!.total)
  })

  it('Power Construct blocks later direct Temporary HP grants while still allowing their authoritative costs', () => {
    const slug = 'aa084-power-construct-thp-lock'
    const dependencies = setup({
      slug, actorAbility: 'Mud Shield', powerConstructMarker: true,
    })
    expect(useAbility({ dependencies, slug, canonicalId: 'Mud Shield' }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(slug)!
    expect(map.temporaryHitPoints?.byPlacementId.actor ?? 0).toBe(0)
    expect(spent(map, 'swift')).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Mud Shield', spent: 1,
    }))
  })

  it('Power of Alchemy snapshots one copyable target Ability with its provenance and pays Scene/Free', () => {
    const slug = 'aa084-power-of-alchemy'
    const dependencies = setup({ slug, actorAbility: 'Power of Alchemy', targetAbility: 'Prism Armor' })
    expect(useAbility({
      dependencies, slug, canonicalId: 'Power of Alchemy',
      targetId: 'target', copiedAbilityId: 'Prism Armor',
    }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(slug)!
    const copy = map.encounterState?.abilityTransformations?.entries[0]
    expect(copy).toMatchObject({
      kind: 'copy', canonicalId: 'Power of Alchemy',
      placementId: 'actor', ownerPlacementId: 'actor',
      copyBase: { sourcePlacementId: 'target', sourceRevision: 3 },
      mechanics: {
        abilityPolicy: 'add',
        abilities: [{ canonicalId: 'Prism Armor', sourcePlacementId: 'target' }],
      },
    })
    expect(copy?.copyBaseSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(spent(map, 'free')).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Power of Alchemy', spent: 1, limit: 1,
    }))
  })

  it('Pressure suppresses only foes in Burst 3 for one round and pays Scene/Swift', () => {
    const slug = 'aa084-pressure'
    const dependencies = setup({ slug, actorAbility: 'Pressure' })
    expect(useAbility({ dependencies, slug, canonicalId: 'Pressure' }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(slug)!
    const suppressed = map.encounterState?.effects.filter(effect => effect.tags.includes('suppressed')) ?? []
    expect(suppressed.map(effect => effect.affected.placementIds[0])).toEqual(['target'])
    expect(suppressed[0]).toMatchObject({
      kind: 'condition', duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      payload: { conditionId: 'suppressed', action: 'apply' },
    })
    expect(spent(map, 'swift')).toBe(1)
  })

  it('Prime Fury applies Rage and capped Attack/Special Attack stages with Scene/Swift payment', () => {
    const slug = 'aa084-prime-fury'
    const dependencies = setup({ slug, actorAbility: 'Prime Fury' })
    expect(useAbility({ dependencies, slug, canonicalId: 'Prime Fury' }).kind).toBe('accepted')
    const actor = savedSheet(dependencies, 'actor')
    expect(actor.combat?.conditions).toContain('Rage')
    expect(actor.stats?.atk?.stage).toBe(1)
    expect(actor.stats?.satk?.stage).toBe(1)
    expect(spent(dependencies.mapRepository.getBySlug(slug)!, 'swift')).toBe(1)
  })

  it('Propeller Tail atomically pays Scene/Swift plus the Free Action and records its immediate Sprint', () => {
    const slug = 'aa084-propeller-tail'
    const dependencies = setup({ slug, actorAbility: 'Propeller Tail' })
    expect(useAbility({ dependencies, slug, canonicalId: 'Propeller Tail' }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(slug)!
    expect(spent(map, 'swift')).toBe(1)
    expect(spent(map, 'free')).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Propeller Tail', spent: 1,
    }))
    expect(map.metadata?.maneuverLog).toContainEqual(expect.objectContaining({
      userId: 'actor', maneuverName: 'Sprint',
      lines: expect.arrayContaining(['Action: Free Action (Propeller Tail)']),
    }))
  })
})
