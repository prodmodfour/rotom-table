import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import type { MoveDamageEffectOperation } from '#shared/moveAutomation/effects'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { buildAuthoritativeMoveRulesContext } from '../../server/domain/moveAutomation/context'
import { aa061MoveDamageModifiers } from '../../server/domain/abilityAutomation/mechanics/aa061MoveIntegration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const ability = (canonicalId: string, instanceId: string) => ({
  name: canonicalId,
  automation: { schemaVersion: 1 as const, instanceId, canonicalId, definitionVersion: null, selections: [] },
})
const sheet = (input: { slug: string; abilities?: ReturnType<typeof ability>[]; injuries?: number; move?: string }): CharacterSheet => ({
  slug: input.slug, nickname: input.slug,
  species: input.slug === 'breaker' ? 'Squirtle' : input.slug === 'aura-user' ? 'Pikachu' : 'Snorlax',
  level: 20, revision: 3,
  types: ['Normal'], abilities: input.abilities ?? [],
  movelist: input.move ? [{ name: input.move }] : [],
  stats: { hp: { added: 20 }, atk: { added: 20 }, def: { added: 10 }, sdef: { added: 10 } },
  combat: { currentHp: 100, injuries: input.injuries ?? 0, conditions: [] },
})
const map = (): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'breaker', sheetKind: 'pokemon', sheetSlug: 'breaker', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'aura-user', sheetKind: 'pokemon', sheetSlug: 'aura-user', sideId: 'foes', position: { x: 4, y: 0, z: 1 } },
    { id: 'victim', sheetKind: 'pokemon', sheetSlug: 'victim', sideId: 'heroes', position: { x: 5, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug: 'aa061-aura-break', name: 'Aura Break', revision: 5,
    dimensions: { x: 10, y: 4, z: 5 }, groundLevelY: 0, playerVisible: true,
    voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: { ...encounter.history, sceneId: 'scene:aura-break' },
      turnResources: Object.fromEntries(placements.map(placement => [
        placement.id, createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 }),
      ])),
    },
    initiative: { activeId: 'breaker', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

describe('AA-061 Aura Break', () => {
  it('aa061.aura-break.private-inversion offers only foe Aura abilities and reverses their damage bonus', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    databases.push(database)
    const mapRepository = createSqliteMapRepository<TabletopMap>(database)
    const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
    const breaker = sheet({ slug: 'breaker', abilities: [ability('Aura Break', 'base:breaker:aura-break')] })
    const auraUser = sheet({
      slug: 'aura-user', injuries: 2, move: 'Tackle',
      abilities: [ability('Aura Storm', 'base:aura-user:aura-storm'), ability('Battle Armor', 'base:aura-user:battle-armor')],
    })
    const victim = sheet({ slug: 'victim' })
    mapRepository.saveSetupMap(map())
    for (const entry of [breaker, auraUser, victim]) {
      sheetRepository.saveSetupSheet('pokemon', entry.slug, entry as unknown as Record<string, unknown>)
    }
    const dependencies = { database, mapRepository, sheetRepository, now: () => 1_000 }
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: {
      schemaVersion: 1, requestId: 'request:aura-break', mapSlug: 'aa061-aura-break', baseRevision: 5,
      actorPlacementId: 'breaker', abilityInstanceId: 'base:breaker:aura-break', canonicalId: 'Aura Break', modeId: 'activate',
    } }, dependencies)
    const target = offer.declarations.find(entry => entry.declarationId === 'activate.target')!.options
      .find(option => option.hint.kind === 'placement' && option.hint.placementId === 'aura-user')!
    const abilityOption = offer.declarations.find(entry => entry.declarationId === 'activate.ability')!.options
    expect(abilityOption).toHaveLength(1)
    expect(abilityOption[0]?.hint).toEqual({ kind: 'ability', valueId: 'ability:aura-storm' })
    const result = resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
      schemaVersion: 1, intentId: 'intent:aura-break', offerId: offer.offerId, offerSha256: offer.offerSha256,
      mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: offer.actorPlacementId,
      abilityInstanceId: offer.abilityInstanceId, canonicalId: offer.canonicalId, modeId: offer.modeId,
      selections: [
        { declarationId: 'activate.target', kind: 'token', optionIds: [target.optionId] },
        { declarationId: 'activate.ability', kind: 'ability', optionIds: [abilityOption[0]!.optionId] },
      ],
    } }, dependencies)
    expect(JSON.stringify(result)).not.toContain('Aura Storm')
    const activated = mapRepository.getBySlug('aa061-aura-break')!
    expect(activated.encounterState?.turnResources.breaker?.actions.swift.spent).toBe(1)
    expect(activated.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Aura Break', targetPlacementIds: ['aura-user'],
    }))

    const context = buildAuthoritativeMoveRulesContext({
      map: activated,
      pokemonSheets: new Map([['breaker', breaker], ['aura-user', auraUser], ['victim', victim]]),
      trainerSheets: new Map(),
      intent: { schemaVersion: 1, placementId: 'aura-user', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'victim' } },
      selectedPlacementIds: ['victim'], random: () => 0, time: 2_000,
    })
    const entry = context.queries.resolveActorMoveEntry('Tackle')
    expect(entry.ok).toBe(true)
    if (!entry.ok) return
    const modifiers = aa061MoveDamageModifiers({
      context,
      operation: { id: 'damage', kind: 'damage' } as unknown as MoveDamageEffectOperation,
      script: entry.entry.script,
      actor: context.actor.token,
      recipient: context.queries.tokens.get('victim')!,
      moveTypeSources: [],
    })
    expect(modifiers.find(modifier => modifier.reasonCode === 'ability.aura-storm.injury-bonus'))
      .toMatchObject({ operation: 'add', value: -6 })
  }, 20_000)
})
