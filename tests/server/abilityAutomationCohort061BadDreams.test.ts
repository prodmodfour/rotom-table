import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteAbilityResolutionOperationRepository } from '../../server/storage/abilityResolutionOperationRepository'
import { resolveEffectiveCapabilities } from '../../server/domain/capabilityAutomation/effectiveCapabilities'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const sheet = (slug: string, species: string, conditions: string[], ability = false): CharacterSheet => ({
  slug, nickname: slug, species, level: 20, revision: 3, types: ['Normal'],
  abilities: ability ? [{
    name: 'Bad Dreams',
    automation: {
      schemaVersion: 1, instanceId: 'base:actor:bad-dreams', canonicalId: 'Bad Dreams',
      definitionVersion: null, selections: [],
    },
  }] : [],
  stats: { hp: { added: 20 }, def: { added: 10 }, sdef: { added: 10 } },
  combat: { currentHp: 60, conditions },
})
const battleMap = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  return {
    schemaVersion: 2, slug: 'aa061-bad-dreams', name: 'Bad Dreams', revision: 5,
    dimensions: { x: 12, y: 4, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet', position: { x: 1, y: 0, z: 1 } },
      { id: 'sleeping', sheetKind: 'pokemon', sheetSlug: 'sleeping-sheet', position: { x: 3, y: 0, z: 1 } },
      { id: 'awake', sheetKind: 'pokemon', sheetSlug: 'awake-sheet', position: { x: 4, y: 0, z: 1 } },
      { id: 'far', sheetKind: 'pokemon', sheetSlug: 'far-sheet', position: { x: 10, y: 0, z: 1 } },
    ],
    encounterState: {
      ...encounter,
      history: { ...encounter.history, sceneId: 'scene:bad-dreams' },
      turnResources: { actor: createEncounterTurnResourceLedger({ placementId: 'actor', round: 1 }) },
    },
    initiative: { activeId: 'actor', round: 1 },
    activeScene: { name: 'Dream Scene', startedAt: 100 },
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

const setup = (input: {
  readonly map?: TabletopMap
  readonly sheets?: readonly CharacterSheet[]
} = {}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(input.map ?? battleMap())
  const sheets = input.sheets ?? [
    sheet('actor-sheet', 'Darkrai', [], true),
    sheet('sleeping-sheet', 'Snorlax', ['Sleep']),
    sheet('awake-sheet', 'Pikachu', []),
    sheet('far-sheet', 'Snorlax', ['Sleep']),
  ]
  for (const current of sheets) {
    sheetRepository.saveSetupSheet('pokemon', current.slug, current as unknown as Record<string, unknown>)
  }
  return {
    database,
    mapRepository,
    sheetRepository,
    dependencies: { database, mapRepository, sheetRepository, now: () => 1_000 },
  }
}

const activate = (
  setupResult: ReturnType<typeof setup>,
  suffix = 'bad-dreams',
) => {
  const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: `request:${suffix}`, mapSlug: 'aa061-bad-dreams',
    baseRevision: setupResult.mapRepository.getBySlug('aa061-bad-dreams')!.revision,
    actorPlacementId: 'actor', abilityInstanceId: 'base:actor:bad-dreams', canonicalId: 'Bad Dreams', modeId: 'activate',
  } }, setupResult.dependencies)
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1, intentId: `intent:${suffix}`, offerId: offer.offerId, offerSha256: offer.offerSha256,
    mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
    abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
    selections: [{ declarationId: 'activate.none', kind: 'none', optionIds: [] }],
  } }, setupResult.dependencies)
}

const setupAsOne = (sourceEffective = true, sharedAliasChain = false) => {
  const owner = {
    ...sheet('sleeping-sheet', 'Calyrex', ['Sleep']),
    capabilities: { other: ['As One'] },
    combat: { currentHp: 1, injuries: 0, conditions: ['Sleep'] },
  } satisfies CharacterSheet
  const partner = {
    ...sheet('partner-sheet', 'Glastrier', []),
    ...(sharedAliasChain ? { capabilities: { other: ['As One'] } } : {}),
  } satisfies CharacterSheet
  const terminal = sheet('terminal-sheet', 'Spectrier', [])
  const unlinked = battleMap()
  const ownerPlacement = unlinked.placements.find(placement => placement.id === 'sleeping')!
  const partnerPlacement = {
    id: 'partner', sheetKind: 'pokemon' as const, sheetSlug: partner.slug,
    position: { x: 5, y: 0, z: 1 },
  }
  const aliasPlacement = {
    id: 'partner-alias', sheetKind: 'pokemon' as const, sheetSlug: partner.slug,
    position: { x: 6, y: 0, z: 1 },
  }
  const terminalPlacement = {
    id: 'terminal', sheetKind: 'pokemon' as const, sheetSlug: terminal.slug,
    position: { x: 7, y: 0, z: 1 },
  }
  const placements = [
    ...unlinked.placements,
    partnerPlacement,
    ...(sharedAliasChain ? [aliasPlacement, terminalPlacement] : []),
  ]
  const asOne = resolveEffectiveCapabilities({
    map: unlinked,
    placement: ownerPlacement,
    sheet: owner,
  }).instances.find(instance => instance.canonicalId === 'As One' && instance.effective)!
  const partnerAsOne = sharedAliasChain
    ? resolveEffectiveCapabilities({
        map: { ...unlinked, placements },
        placement: aliasPlacement,
        sheet: partner,
      }).instances.find(instance => instance.canonicalId === 'As One' && instance.effective)!
    : null
  const encounter = unlinked.encounterState!
  const map: TabletopMap = {
    ...unlinked,
    placements,
    encounterState: {
      ...encounter,
      capabilityRuntime: {
        ...encounter.capabilityRuntime!,
        links: [{
          id: 'as-one-bad-dreams', kind: 'as-one-mount', ownerPlacementId: 'sleeping',
          participantPlacementIds: ['partner'],
          capabilityInstanceId: sourceEffective ? asOne.instanceId : `${asOne.instanceId}:stale`,
          canonicalId: 'As One', establishedAt: 100, configurationId: 'Chilling Neigh',
          sourceOperationId: 'as-one-setup',
        }, ...(partnerAsOne ? [{
          id: 'as-one-shared-alias', kind: 'as-one-mount' as const, ownerPlacementId: 'partner-alias',
          participantPlacementIds: ['terminal'], capabilityInstanceId: partnerAsOne.instanceId,
          canonicalId: 'As One', establishedAt: 100, configurationId: 'Grim Neigh',
          sourceOperationId: 'as-one-shared-alias-setup',
        }] : [])],
      },
    },
  }
  const setupResult = setup({
    map,
    sheets: [
      sheet('actor-sheet', 'Darkrai', [], true), owner,
      sheet('awake-sheet', 'Pikachu', []), sheet('far-sheet', 'Snorlax', ['Sleep']), partner,
      ...(sharedAliasChain ? [terminal] : []),
    ],
  })
  return { setupResult, owner, partner, terminal }
}

describe('AA-061 Bad Dreams', () => {
  it('aa061.bad-dreams.sleeping-area loses one tick in range and grants one temporary tick on any loss', () => {
    const setupResult = setup()
    const { sheetRepository, mapRepository } = setupResult
    const result = activate(setupResult)
    expect(result).toMatchObject({ kind: 'accepted', status: 'committed' })
    const persistedSleeping = sheetRepository.get('pokemon', 'sleeping-sheet')!.document as unknown as CharacterSheet
    const persistedAwake = sheetRepository.get('pokemon', 'awake-sheet')!.document as unknown as CharacterSheet
    const persistedFar = sheetRepository.get('pokemon', 'far-sheet')!.document as unknown as CharacterSheet
    expect(persistedSleeping.combat?.currentHp).toBeLessThan(60)
    expect(persistedAwake.combat?.currentHp).toBe(60)
    expect(persistedFar.combat?.currentHp).toBe(60)
    const persistedMap = mapRepository.getBySlug('aa061-bad-dreams')!
    expect(persistedMap.temporaryHitPoints?.byPlacementId.actor).toBeGreaterThan(0)
    expect(persistedMap.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
  }, 20_000)

  it('atomically propagates Ability fainting through an exact source-effective As One link', () => {
    const { setupResult, owner, partner } = setupAsOne()

    activate(setupResult, 'as-one')

    expect((setupResult.sheetRepository.get('pokemon', owner.slug)!.document as unknown as CharacterSheet)
      .combat?.currentHp).toBe(0)
    expect((setupResult.sheetRepository.get('pokemon', partner.slug)!.document as unknown as CharacterSheet)
      .combat?.currentHp).toBe(0)
    const operation = createSqliteAbilityResolutionOperationRepository(setupResult.database)
      .find('intent:as-one')
    const reads = (operation?.audit as { reads?: unknown } | null)?.reads
    expect(reads).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'sheet', sheetKind: 'pokemon', slug: owner.slug, revision: 3 }),
      expect.objectContaining({ kind: 'sheet', sheetKind: 'pokemon', slug: partner.slug, revision: 3 }),
    ]))
  })

  it('propagates Ability fainting through shared-sheet aliases in an exact As One chain', () => {
    const { setupResult, owner, partner, terminal } = setupAsOne(true, true)

    activate(setupResult, 'as-one-shared-alias')

    for (const current of [owner, partner, terminal]) {
      expect((setupResult.sheetRepository.get('pokemon', current.slug)!.document as unknown as CharacterSheet)
        .combat?.currentHp).toBe(0)
    }
  })

  it('does not propagate Ability fainting through a stale As One source instance', () => {
    const { setupResult, owner, partner } = setupAsOne(false)

    activate(setupResult, 'as-one-stale')

    expect((setupResult.sheetRepository.get('pokemon', owner.slug)!.document as unknown as CharacterSheet)
      .combat?.currentHp).toBe(0)
    expect((setupResult.sheetRepository.get('pokemon', partner.slug)!.document as unknown as CharacterSheet)
      .combat?.currentHp).toBe(60)
  })

  it('rejects an As One Ability commit when a consulted counterpart revision is stale', () => {
    const { setupResult, owner, partner } = setupAsOne()
    const repository = setupResult.sheetRepository
    const staleRepository = new Proxy(repository, {
      get(target, property, receiver) {
        if (property === 'getByRef') {
          return (kind: 'pokemon' | 'trainer', slug: string) => {
            const persisted = target.getByRef(kind, slug)
            return slug === partner.slug && persisted
              ? { ...persisted, revision: persisted.revision + 1 }
              : persisted
          }
        }
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    setupResult.dependencies.sheetRepository = staleRepository

    expect(() => activate(setupResult, 'as-one-stale-revision')).toThrow(/state changed before commit/i)

    expect(setupResult.mapRepository.getBySlug('aa061-bad-dreams')?.revision).toBe(5)
    expect((repository.get('pokemon', owner.slug)!.document as unknown as CharacterSheet)
      .combat?.currentHp).toBe(1)
    expect((repository.get('pokemon', partner.slug)!.document as unknown as CharacterSheet)
      .combat?.currentHp).toBe(60)
  })

  it('removes Crowned mode when Ability damage faints its owner', () => {
    const zacian = {
      ...sheet('sleeping-sheet', 'Zacian Hero Of Many Battles Forme', ['Sleep']),
      capabilities: { other: ['Weapon Bond'] },
      combat: { currentHp: 1, injuries: 0, conditions: ['Sleep'] },
    } satisfies CharacterSheet
    const unlinked = battleMap()
    const placement = unlinked.placements.find(candidate => candidate.id === 'sleeping')!
    const weaponBond = resolveEffectiveCapabilities({
      map: unlinked,
      placement,
      sheet: zacian,
    }).instances.find(instance => instance.canonicalId === 'Weapon Bond' && instance.effective)!
    const encounter = unlinked.encounterState!
    const map: TabletopMap = {
      ...unlinked,
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'crowned-bad-dreams', actorPlacementId: 'sleeping',
            capabilityInstanceId: weaponBond.instanceId, canonicalId: 'Weapon Bond', mode: 'crowned',
            description: null, configurationId: null, activatedAt: 100, expiresAt: null,
            sourceOperationId: 'crowned-setup',
          }],
        },
      },
    }
    const setupResult = setup({
      map,
      sheets: [
        sheet('actor-sheet', 'Darkrai', [], true), zacian,
        sheet('awake-sheet', 'Pikachu', []), sheet('far-sheet', 'Snorlax', ['Sleep']),
      ],
    })

    activate(setupResult, 'crowned')

    expect((setupResult.sheetRepository.get('pokemon', zacian.slug)!.document as unknown as CharacterSheet)
      .combat?.currentHp).toBe(0)
    expect(setupResult.mapRepository.getBySlug(map.slug)?.encounterState?.capabilityRuntime?.modes).toEqual([])
  })
})
