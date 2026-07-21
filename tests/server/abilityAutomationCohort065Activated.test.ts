import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { planAuthoritativeMoveState } from '../../server/domain/planAuthoritativeMoveState'
import {
  resolveAuthoritativeMoveItemResources,
  reviewedMoveItemResourceRequirementsFor,
} from '../../server/domain/moveAutomation/itemResources'
import { applyAa065CuriousMedicineSendOutTrigger } from '../../server/domain/abilityAutomation/mechanics/aa065PresenceIntegration'
import { applyAa065CrushTrapGrappleTrigger } from '../../server/domain/abilityAutomation/mechanics/aa065ManeuverIntegration'
import { reduceAbilityOwnedStateCommand } from '../../server/domain/abilityAutomation/ownedState'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { placementToSpawned, type SheetLookup } from '~/utils/placement'
import { capabilityEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'

const ability = (canonicalId: string) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, definitionVersion: null, selections: [],
  },
})
const sheet = (input: { slug: string; canonicalId?: string; hp?: number; stage?: number }): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: 'Eevee', level: 20, revision: 3,
  gender: 'Male', types: ['Normal'], abilities: input.canonicalId ? [ability(input.canonicalId)] : [], movelist: [],
  stats: {
    hp: { added: 45 }, atk: { added: 25, stage: input.stage ?? 0 }, def: { added: 25, stage: input.stage ?? 0 },
    satk: { added: 25, stage: input.stage ?? 0 }, sdef: { added: 25, stage: input.stage ?? 0 }, spd: { added: 25, stage: input.stage ?? 0 },
  },
  combatStages: { atk: input.stage ?? 0, def: input.stage ?? 0, satk: input.stage ?? 0, sdef: input.stage ?? 0, spd: input.stage ?? 0, acc: 0 },
  combat: { currentHp: input.hp ?? 150, injuries: 0, conditions: [] },
})
const battleMap = (slug: string): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 1, y: 0, z: 1 } },
    { id: 'ally', sheetKind: 'pokemon', sheetSlug: 'ally', sideId: 'heroes', position: { x: 3, y: 0, z: 1 } },
    { id: 'enemy', sheetKind: 'pokemon', sheetSlug: 'enemy', sideId: 'foes', position: { x: 2, y: 0, z: 1 } },
    { id: 'far-ally', sheetKind: 'pokemon', sheetSlug: 'far-ally', sideId: 'heroes', position: { x: 8, y: 0, z: 1 } },
  ]
  return {
    schemaVersion: 2, slug, name: slug, revision: 5, dimensions: { x: 12, y: 4, z: 8 }, groundLevelY: 0,
    playerVisible: true, voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements,
    encounterState: {
      ...encounter,
      sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' }, foes: { id: 'foes', label: 'Foes', status: 'active' } },
      history: { ...encounter.history, sceneId: `scene:${slug}` },
      turnResources: Object.fromEntries(placements.map(placement => [placement.id,
        createEncounterTurnResourceLedger({ placementId: placement.id, round: 1 })])),
    },
    initiative: { activeId: 'actor', round: 1 }, activeScene: { name: 'Scene', startedAt: 100 },
  }
}
let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))
const setup = (input: { slug: string; canonicalId: string; mapTransform?: (map: TabletopMap, sheets: Map<string, CharacterSheet>) => TabletopMap }) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  const sheets = new Map<string, CharacterSheet>([
    ['actor', sheet({ slug: 'actor', canonicalId: input.canonicalId })],
    ['ally', sheet({ slug: 'ally', stage: 2 })],
    ['enemy', sheet({ slug: 'enemy', hp: 150, stage: 2 })],
    ['far-ally', sheet({ slug: 'far-ally', stage: 2 })],
  ])
  mapRepository.saveSetupMap(input.mapTransform?.(battleMap(input.slug), sheets) ?? battleMap(input.slug))
  for (const entry of sheets.values()) {
    sheetRepository.saveSetupSheet('pokemon', entry.slug, entry as unknown as Record<string, unknown>)
  }
  return { database, mapRepository, sheetRepository, now: () => 1_000 }
}
const begin = (dependencies: ReturnType<typeof setup>, slug: string, canonicalId: string, modeId = 'activate') => beginAbilityDeclarationUseCase({
  role: 'gm', command: {
    schemaVersion: 1, requestId: `request:${slug}:${modeId}`, mapSlug: slug, baseRevision: 5,
    actorPlacementId: 'actor', abilityInstanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
    canonicalId, modeId,
  },
}, dependencies)
const resolve = (
  dependencies: ReturnType<typeof setup>, offer: ReturnType<typeof begin>, canonicalId: string, modeId: string, selections: unknown[],
) => resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
  schemaVersion: 1, intentId: `intent:${offer.mapSlug}:${modeId}`, offerId: offer.offerId, offerSha256: offer.offerSha256,
  mapSlug: offer.mapSlug, baseRevision: offer.mapRevision, actorPlacementId: 'actor',
  abilityInstanceId: `base:${canonicalId.toLowerCase().replaceAll(' ', '-')}`,
  canonicalId, modeId, selections,
} }, dependencies)
const persisted = (dependencies: ReturnType<typeof setup>, slug: string): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', slug)!.sheet as unknown as CharacterSheet
)
const stage = (value: CharacterSheet, key: 'atk' | 'def' | 'satk' | 'sdef' | 'spd'): number => (
  value.stats?.[key]?.stage ?? value.combatStages?.[key] ?? 0
)

describe('AA-065 activated and presence-backed abilities', () => {
  it('aa065.curious-medicine.reviewed resets nearby allies only and spends Scene/Swift', () => {
    const dependencies = setup({ slug: 'aa065-curious', canonicalId: 'Curious Medicine' })
    const offer = begin(dependencies, 'aa065-curious', 'Curious Medicine')
    resolve(dependencies, offer, 'Curious Medicine', 'activate', [{ declarationId: 'activate.none', kind: 'none', optionIds: [] }])
    expect(stage(persisted(dependencies, 'ally'), 'atk')).toBe(0)
    expect(stage(persisted(dependencies, 'enemy'), 'atk')).toBe(2)
    expect(stage(persisted(dependencies, 'far-ally'), 'atk')).toBe(2)
    const map = dependencies.mapRepository.getBySlug('aa065-curious')!
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({ canonicalId: 'Curious Medicine', spent: 1 }))
  })

  it('aa065.curious-medicine.reviewed rejects enter-field mode without a server-created presence mark', () => {
    const dependencies = setup({ slug: 'aa065-curious-entry-rejected', canonicalId: 'Curious Medicine' })
    const offer = begin(dependencies, 'aa065-curious-entry-rejected', 'Curious Medicine', 'enter-field')
    expect(() => resolve(dependencies, offer, 'Curious Medicine', 'enter-field', [{
      declarationId: 'enter-field.none', kind: 'none', optionIds: [],
    }])).toThrow('requires a current authoritative entry reaction mark')
    expect(dependencies.mapRepository.getBySlug('aa065-curious-entry-rejected')?.encounterState
      ?.turnResources.actor?.actions.free.spent).toBe(0)
  })

  it('aa065.curious-medicine.reviewed consumes a send-out mark and spends Free in enter-field mode', () => {
    const dependencies = setup({
      slug: 'aa065-curious-entry', canonicalId: 'Curious Medicine',
      mapTransform: (map, sheets) => applyAa065CuriousMedicineSendOutTrigger({
        mapAfter: map, releasedPlacementId: 'actor', operationId: 'op_send_out_curiosity',
        readPokemonSheet: slug => sheets.get(slug) ?? null,
      }),
    })
    const offer = begin(dependencies, 'aa065-curious-entry', 'Curious Medicine', 'enter-field')
    resolve(dependencies, offer, 'Curious Medicine', 'enter-field', [{ declarationId: 'enter-field.none', kind: 'none', optionIds: [] }])
    const map = dependencies.mapRepository.getBySlug('aa065-curious-entry')!
    expect(map.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(map.encounterState?.abilityOwnedState?.entries.some(entry => entry.canonicalId === 'Curious Medicine')).toBe(false)
  })

  it('aa065.crush-trap.reviewed consumes an accepted Grapple mark for automatic non-critical Struggle damage', () => {
    const dependencies = setup({
      slug: 'aa065-crush-trap', canonicalId: 'Crush Trap',
      mapTransform: (map, sheets) => {
        const lookup: SheetLookup = { pokemon: sheets, trainer: new Map() }
        const actorPlacement = map.placements.find(entry => entry.id === 'actor')!
        const targetPlacement = map.placements.find(entry => entry.id === 'enemy')!
        return applyAa065CrushTrapGrappleTrigger({
          map, actorPlacement,
          actorToken: placementToSpawned(actorPlacement, lookup, map)!,
          actorSheet: sheets.get('actor')!,
          targetToken: placementToSpawned(targetPlacement, lookup, map)!,
          operationId: 'op_grapple_success',
        })
      },
    })
    const offer = begin(dependencies, 'aa065-crush-trap', 'Crush Trap', 'crush')
    const declaration = offer.declarations.find(entry => entry.declarationId === 'crush.target')!
    const target = declaration.options[0]!
    resolve(dependencies, offer, 'Crush Trap', 'crush', [{
      declarationId: 'crush.target', kind: 'token', optionIds: [target.optionId],
    }])
    expect(persisted(dependencies, 'enemy').combat?.currentHp).toBeLessThan(150)
    const map = dependencies.mapRepository.getBySlug('aa065-crush-trap')!
    expect(map.encounterState?.turnResources.actor?.actions.free.spent).toBe(1)
    expect(map.encounterState?.abilityOwnedState?.entries.some(entry => entry.canonicalId === 'Crush Trap')).toBe(false)
  })

  it('aa065.cruelty.reviewed prevents later native HP and Temporary HP gains from other abilities', () => {
    const dependencies = setup({
      slug: 'aa065-cruelty-healing-block', canonicalId: 'Comatose',
      mapTransform: (map, sheets) => {
        sheets.get('actor')!.combat!.currentHp = 10
        return {
          ...map,
          encounterState: {
            ...map.encounterState!,
            effects: [{
              ...capabilityEncounterEffectFixture(),
              id: 'ability.cruelty.healing-block.actor',
              source: { operationId: 'op_cruelty', moveId: 'ability.cruelty', placementId: 'enemy' },
              affected: { placementIds: ['actor'], sideIds: [], cells: [] },
              duration: { kind: 'scene', remaining: null },
              payload: { capabilityId: 'aa065.cruelty.healing-blocked', action: 'grant' },
              tags: ['ability', 'aa065', 'cruelty', 'healing-blocked'],
              transferPolicy: 'expire',
            }],
          },
        }
      },
    })
    const offer = begin(dependencies, 'aa065-cruelty-healing-block', 'Comatose')
    resolve(dependencies, offer, 'Comatose', 'activate', [{ declarationId: 'activate.none', kind: 'none', optionIds: [] }])
    expect(persisted(dependencies, 'actor').combat?.currentHp).toBe(10)
    expect(persisted(dependencies, 'actor').combat?.conditions).toContain('Sleep')
  })

  it('aa065.cud-chew.reviewed records consumable destruction as private scene-owned replay evidence', () => {
    const map = battleMap('aa065-cud-chew-record')
    const actor = {
      ...sheet({ slug: 'actor', canonicalId: 'Cud Chew' }),
      movelist: [{ name: 'Natural Gift' }],
      items: { held: 'Cheri Berry' },
    } as CharacterSheet
    const pokemonSheets = new Map([
      ['actor', actor],
      ['ally', sheet({ slug: 'ally' })],
      ['enemy', sheet({ slug: 'enemy', hp: 150 })],
      ['far-ally', sheet({ slug: 'far-ally' })],
    ])
    const trainerSheets = new Map()
    const itemResources = resolveAuthoritativeMoveItemResources({
      map, actorPlacementId: 'actor', selectedTargetPlacementIds: ['enemy'],
      pokemonSheets, trainerSheets, groupInventories: new Map(),
      requirements: reviewedMoveItemResourceRequirementsFor('Natural Gift'),
    })
    const plan = planAuthoritativeMoveState({
      map,
      pokemonSheets,
      trainerSheets,
      itemResources,
      intent: {
        schemaVersion: 1, placementId: 'actor', moveName: 'Natural Gift',
        selection: { kind: 'single-target', targetPlacementId: 'enemy' },
      },
      random: () => 0.5, now: () => 1_000, operationId: 'op_aa065_cud_chew_record',
    })
    expect(plan.nextMap.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      ownerPlacementId: 'actor', canonicalId: 'Cud Chew',
      payload: expect.objectContaining({ kind: 'mark', markId: expect.stringMatching(/^aa065\.cud-chew\.consumed:[a-f0-9]{24}$/) }),
    }))
    expect(JSON.stringify(plan.nextMap.encounterState?.abilityOwnedState)).not.toContain('cheri-berry')
    const nextActor = plan.sheetWrites.find(write => write.slug === 'actor')?.nextSheet as CharacterSheet
    expect(nextActor.items?.held).toBeFalsy()
    expect(nextActor.serverPrivate?.abilityItemEvidence).toContainEqual(expect.objectContaining({
      canonicalItemId: 'cheri-berry', sceneName: 'Scene', sceneStartedAt: 100,
    }))
  }, 20_000)

  it('aa065.cud-chew.reviewed rejects activation when no durable consumption evidence exists', () => {
    const dependencies = setup({ slug: 'aa065-cud-chew-unavailable', canonicalId: 'Cud Chew' })
    expect(() => begin(dependencies, 'aa065-cud-chew-unavailable', 'Cud Chew')).toThrow('too few currently legal options')
  })

  it('aa065.cud-chew.reviewed offers only durable consumed evidence and reuses it without restoring the item', () => {
    const dependencies = setup({
      slug: 'aa065-cud-chew', canonicalId: 'Cud Chew',
      mapTransform: (map, sheets) => {
        const actor = sheets.get('actor')!
        actor.combat!.currentHp = 100
        actor.serverPrivate = {
          abilityItemEvidence: [{
            stateId: 'base:cud-chew:cud-chew:potion', canonicalItemId: 'potion',
            consumptionId: 'consumption_potion', sourceOperationId: 'op_record_consumed_potion',
            sceneName: 'Scene', sceneStartedAt: 100,
          }],
        }
        const encounter = parseEncounterState(map.encounterState)
        const reduced = reduceAbilityOwnedStateCommand(encounter.abilityOwnedState, {
          operationId: 'op_record_consumed_potion', kind: 'create',
          stateId: 'base:cud-chew:cud-chew:potion', expectedVersion: null,
          entry: {
            stateId: 'base:cud-chew:cud-chew:potion', ownerPlacementId: 'actor',
            sourceAbilityInstanceId: 'base:cud-chew', canonicalId: 'Cud Chew', targetPlacementIds: [],
            lifecycle: { kind: 'scene', targetPolicy: null },
            payload: { kind: 'mark', markId: 'aa065.cud-chew.consumed:0123456789abcdef01234567' },
          },
        })
        return { ...map, encounterState: parseEncounterState({ ...encounter, abilityOwnedState: reduced.state }) }
      },
    })
    const offer = begin(dependencies, 'aa065-cud-chew', 'Cud Chew')
    const declaration = offer.declarations.find(entry => entry.declarationId === 'activate.item')!
    expect(declaration.options).toHaveLength(1)
    resolve(dependencies, offer, 'Cud Chew', 'activate', [{
      declarationId: 'activate.item', kind: 'item', optionIds: [declaration.options[0]!.optionId],
    }])
    const map = dependencies.mapRepository.getBySlug('aa065-cud-chew')!
    expect(map.encounterState?.turnResources.actor?.actions.swift.spent).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({ canonicalId: 'Cud Chew', spent: 1 }))
    expect(map.encounterState?.abilityOwnedState?.entries).toContainEqual(expect.objectContaining({
      stateId: 'base:cud-chew:cud-chew:potion',
    }))
    expect(persisted(dependencies, 'actor').combat?.currentHp).toBe(120)
  })
})
