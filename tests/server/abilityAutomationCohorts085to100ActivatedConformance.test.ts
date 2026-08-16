import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { parseEncounterEffect, type EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { beginAbilityDeclarationUseCase } from '~~/server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '~~/server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { resolveEncounterEffectRecall } from '~~/server/domain/moveAutomation/effectTransfer'
import { planEncounterMoveResourceCosts } from '~~/server/domain/moveAutomation/planMoveResources'
import { cleanupAa085to100CurledUpForBreather } from '~~/server/domain/abilityAutomation/mechanics/aa085to100ActionIntegration'
import { REMAINING_ABILITY_TEST_REGISTRY } from '../fixtures/abilityAutomation/remainingRegistry'
import { activePokemonHeldEquipmentState } from '../fixtures/equipment'
import { splitSheetItemNames } from '~/utils/sheetItemNames'

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const ability = (
  canonicalId: string,
  selections: readonly { readonly parameterId: string; readonly optionIds: readonly string[] }[] = [],
) => ({
  name: canonicalId,
  automation: {
    schemaVersion: 1 as const, instanceId: `base:${slug(canonicalId)}`,
    canonicalId, definitionVersion: selections.length > 0 ? 1 : null, selections: [...selections],
  },
})

const sheet = (input: {
  readonly slug: string
  readonly ability?: string
  readonly additionalAbilities?: readonly string[]
  readonly species?: string
  readonly conditions?: readonly string[]
  readonly held?: string
  readonly abilitySelections?: readonly { readonly parameterId: string; readonly optionIds: readonly string[] }[]
  readonly currentHp?: number
  readonly capabilitiesOther?: readonly string[]
}): CharacterSheet => ({
  slug: input.slug, nickname: input.slug, species: input.species ?? 'Eevee',
  level: 30, revision: 3, types: ['Normal'],
  abilities: [
    ...(input.ability ? [ability(input.ability, input.abilitySelections)] : []),
    ...(input.additionalAbilities ?? []).map(canonicalId => ability(canonicalId)),
  ],
  movelist: [{ name: 'Tackle' }, { name: 'Rapid Spin' }, { name: 'Rollout' }],
  stats: {
    hp: { added: 20 }, atk: { added: 15 }, def: { added: 15 },
    satk: { added: 15 }, sdef: { added: 15 }, spd: { added: 15 },
  },
  capabilities: {
    overland: 5, sky: 0, swim: 2, levitate: 0, burrow: 0,
    ...(input.capabilitiesOther?.length ? { other: [...input.capabilitiesOther] } : {}),
  },
  combatStages: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
  combat: { currentHp: input.currentHp ?? 100, injuries: 0, conditions: [...(input.conditions ?? [])] },
  equipmentState: activePokemonHeldEquipmentState({
    ownerSlug: input.slug,
    canonicalItemIds: splitSheetItemNames(input.held),
  }),
  ...(input.held ? { items: { held: input.held } } : {}),
})

const battleMap = (input: {
  readonly slug: string
  readonly materialId?: string
  readonly rainy?: boolean
  readonly effects?: readonly EncounterEffect[]
  readonly willingAlly?: boolean
  readonly naturalLight?: 'sunlight' | 'moonlight'
  readonly allyPosition?: Readonly<{ x: number; y: number; z: number }>
  readonly targetPosition?: Readonly<{ x: number; y: number; z: number }>
}): TabletopMap => {
  const encounter = createEmptyEncounterState()
  const placements: TabletopMap['placements'] = [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'heroes', position: { x: 5, y: 0, z: 5 } },
    { id: 'ally', sheetKind: 'pokemon', sheetSlug: 'ally', sideId: 'heroes', position: input.allyPosition ?? { x: 6, y: 0, z: 5 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'foes', position: input.targetPosition ?? { x: 7, y: 0, z: 5 } },
  ]
  return {
    schemaVersion: 2, slug: input.slug, name: input.slug, revision: 5,
    dimensions: { x: 16, y: 10, z: 16 }, groundLevelY: 0,
    voxels: input.materialId
      ? [{ x: 5, y: -1, z: 5, materialId: input.materialId, tags: [] }]
      : [],
    hazards: [], placements,
    fieldEffects: { weather: input.rainy ? [{ kind: 'rainy' }] : [], terrains: [], rooms: [] },
    encounterState: {
      ...encounter,
      effects: [...(input.effects ?? [])],
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
    metadata: {
      ...(input.willingAlly ? {
        abilityTargetWillingness: [{
          actorPlacementId: 'actor', targetPlacementId: 'ally', willingness: 'willing',
        }],
      } : {}),
      ...(input.naturalLight ? { naturalLight: input.naturalLight } : {}),
    },
  }
}

let databases: RotomDatabase[] = []
afterEach(() => databases.splice(0).forEach(database => database.close()))

const setup = (input: {
  readonly slug: string
  readonly actorAbility: string
  readonly actorSpecies?: string
  readonly actorAdditionalAbilities?: readonly string[]
  readonly conditions?: readonly string[]
  readonly materialId?: string
  readonly rainy?: boolean
  readonly effects?: readonly EncounterEffect[]
  readonly willingAlly?: boolean
  readonly held?: string
  readonly allyHeld?: string
  readonly targetAbility?: string
  readonly targetAbilitySelections?: readonly { readonly parameterId: string; readonly optionIds: readonly string[] }[]
  readonly actorCurrentHp?: number
  readonly allyCurrentHp?: number
  readonly allyCapabilities?: readonly string[]
  readonly targetCurrentHp?: number
  readonly targetConditions?: readonly string[]
  readonly allyPosition?: Readonly<{ x: number; y: number; z: number }>
  readonly targetPosition?: Readonly<{ x: number; y: number; z: number }>
  readonly naturalLight?: 'sunlight' | 'moonlight'
}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(battleMap({
    slug: input.slug,
    materialId: input.materialId,
    rainy: input.rainy,
    effects: input.effects,
    willingAlly: input.willingAlly,
    naturalLight: input.naturalLight,
    allyPosition: input.allyPosition,
    targetPosition: input.targetPosition,
  }))
  for (const value of [
    sheet({
      slug: 'actor', ability: input.actorAbility,
      additionalAbilities: input.actorAdditionalAbilities,
      species: input.actorSpecies, conditions: input.conditions,
      held: input.held,
      currentHp: input.actorCurrentHp,
    }),
    sheet({
      slug: 'ally', held: input.allyHeld, currentHp: input.allyCurrentHp,
      capabilitiesOther: input.allyCapabilities,
    }),
    sheet({
      slug: 'target', ability: input.targetAbility,
      abilitySelections: input.targetAbilitySelections,
      conditions: input.targetConditions,
      currentHp: input.targetCurrentHp,
    }),
  ]) sheetRepository.saveSetupSheet('pokemon', value.slug, value as unknown as Record<string, unknown>)
  return {
    mapRepository, sheetRepository, registry: REMAINING_ABILITY_TEST_REGISTRY,
    now: () => 1_000,
  }
}

type Dependencies = ReturnType<typeof setup>
const savedSheet = (dependencies: Dependencies): CharacterSheet => (
  dependencies.sheetRepository.getByRef('pokemon', 'actor')!.sheet as unknown as CharacterSheet
)

const begin = (
  dependencies: Dependencies,
  mapSlug: string,
  canonicalId: string,
  invocationId = '0',
) => (
  beginAbilityDeclarationUseCase({ role: 'gm', command: {
    schemaVersion: 1, requestId: `request:${mapSlug}:${slug(canonicalId)}:${invocationId}`,
    mapSlug, baseRevision: dependencies.mapRepository.getBySlug(mapSlug)!.revision,
    actorPlacementId: 'actor', abilityInstanceId: `base:${slug(canonicalId)}`,
    canonicalId, modeId: 'activate',
  } }, dependencies)
)

const useAbility = (input: {
  readonly dependencies: Dependencies
  readonly mapSlug: string
  readonly canonicalId: string
  readonly selected?: Readonly<Record<string, string>>
  readonly invocationId?: string
}) => {
  const offer = begin(
    input.dependencies,
    input.mapSlug,
    input.canonicalId,
    input.invocationId,
  )
  const selections = offer.declarations.map(declaration => {
    const requested = input.selected?.[declaration.kind]
    const option = requested === undefined
      ? declaration.options[0]
      : declaration.options.find(candidate => (
          candidate.hint.kind === 'placement'
            ? candidate.hint.placementId === requested
            : candidate.hint.kind === declaration.kind
              && 'valueId' in candidate.hint && candidate.hint.valueId === requested
        ))
    return {
      declarationId: declaration.declarationId,
      kind: declaration.kind,
      optionIds: option ? [option.optionId] : [],
    }
  })
  return resolveAbilityDeclarationUseCase({ role: 'gm', intent: {
    schemaVersion: 1,
    intentId: `intent:${input.mapSlug}:${slug(input.canonicalId)}:${input.invocationId ?? '0'}`,
    offerId: offer.offerId, offerSha256: offer.offerSha256,
    mapSlug: input.mapSlug, baseRevision: offer.mapRevision,
    actorPlacementId: 'actor', abilityInstanceId: `base:${slug(input.canonicalId)}`,
    canonicalId: input.canonicalId, modeId: 'activate', selections,
  } }, input.dependencies)
}

const spent = (map: TabletopMap, resource: 'free' | 'swift' | 'shift' | 'standard' | 'full'): number => (
  map.encounterState?.turnResources.actor?.actions[resource].spent ?? 0
)

describe('AA-085 through AA-100 activated conformance', () => {
  it('does not expose an activated Ability for a Fainted owner', () => {
    const mapSlug = 'remaining-fainted-activation'
    const dependencies = setup({
      slug: mapSlug,
      actorAbility: 'Quick Curl',
      actorCurrentHp: 0,
      conditions: ['Fainted'],
    })
    expect(() => begin(dependencies, mapSlug, 'Quick Curl')).toThrow()
    expect(dependencies.mapRepository.getBySlug(mapSlug)?.revision).toBe(5)
  })

  it('Psychic Surge creates a five-round authoritative Weird field', () => {
    const mapSlug = 'remaining-psychic-surge'
    const dependencies = setup({ slug: mapSlug, actorAbility: 'Psychic Surge' })
    expect(useAbility({ dependencies, mapSlug, canonicalId: 'Psychic Surge' }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(mapSlug)!
    expect(map.fieldEffects?.terrains).toContainEqual(expect.objectContaining({
      kind: 'psychic',
      scope: 'field',
    }))
    expect(map.encounterState?.zones).toContainEqual(expect.objectContaining({
      kind: 'terrain',
      duration: { kind: 'rounds', boundary: 'end', remaining: 5 },
      payload: { terrainId: 'psychic' },
    }))
    expect(spent(map, 'swift')).toBe(1)
  })

  it('Quick Curl invokes Defense Curl state, adds its own DR, pays both actions, and cleans up curled-up exactly', () => {
    const mapSlug = 'remaining-quick-curl'
    const dependencies = setup({ slug: mapSlug, actorAbility: 'Quick Curl' })
    expect(useAbility({ dependencies, mapSlug, canonicalId: 'Quick Curl' }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(mapSlug)!
    const actor = savedSheet(dependencies)
    expect(actor.stats?.def?.stage).toBe(1)
    expect(spent(map, 'free')).toBe(1)
    expect(spent(map, 'standard')).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Quick Curl', spent: 1, limit: 1,
    }))
    const curled = map.encounterState?.effects.find(effect => effect.tags.includes('curled-up'))
    expect(curled).toMatchObject({
      duration: { kind: 'scene', remaining: null }, transferPolicy: 'expire',
      affected: { placementIds: ['actor'] },
    })
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'numeric-modifier',
      payload: expect.objectContaining({
        attribute: 'damage-reduction', operation: 'add', value: 10,
      }),
      duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
    }))

    const afterBreather = cleanupAa085to100CurledUpForBreather(map, 'actor')
    expect(afterBreather.encounterState?.effects.some(effect => effect.tags.includes('curled-up'))).toBe(false)
    expect(afterBreather.encounterState?.effects.some(effect => effect.tags.includes('quick-curl'))).toBe(true)

    const recall = resolveEncounterEffectRecall({
      effects: map.encounterState?.effects ?? [], recalledPlacementId: 'actor',
    })
    expect(recall.expiredEffectIds).toContain(curled!.id)
    expect(recall.effects.some(effect => effect.tags.includes('curled-up'))).toBe(false)
  })

  it('executes Pumpkingrab, Shackle, and Snuggle against exact authoritative recipients', () => {
    const pumpSlug = 'remaining-pumpkingrab'
    const pump = setup({
      slug: pumpSlug, actorAbility: 'Pumpkingrab',
      targetPosition: { x: 6, y: 0, z: 5 },
    })
    expect(useAbility({
      dependencies: pump, mapSlug: pumpSlug, canonicalId: 'Pumpkingrab',
      selected: { token: 'target' },
    }).kind).toBe('accepted')
    const pumpMap = pump.mapRepository.getBySlug(pumpSlug)!
    expect(spent(pumpMap, 'standard')).toBe(1)
    expect(pumpMap.encounterState?.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tags: expect.arrayContaining(['aa085-pumpkingrab', 'dominance']),
        affected: expect.objectContaining({ placementIds: ['actor', 'target'] }),
      }),
      expect.objectContaining({
        kind: 'condition', tags: expect.arrayContaining(['vulnerable']),
        affected: expect.objectContaining({ placementIds: ['actor', 'target'] }),
      }),
    ]))

    const shackleSlug = 'remaining-shackle'
    const shackle = setup({ slug: shackleSlug, actorAbility: 'Shackle' })
    expect(useAbility({ dependencies: shackle, mapSlug: shackleSlug, canonicalId: 'Shackle' }).kind)
      .toBe('accepted')
    const shackleMap = shackle.mapRepository.getBySlug(shackleSlug)!
    expect(shackleMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      tags: expect.arrayContaining(['aa088-shackle-half-movement']),
      affected: expect.objectContaining({ placementIds: ['target'] }),
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
    }))

    const snuggleSlug = 'remaining-snuggle'
    const snuggle = setup({ slug: snuggleSlug, actorAbility: 'Snuggle' })
    expect(useAbility({
      dependencies: snuggle, mapSlug: snuggleSlug, canonicalId: 'Snuggle',
      selected: { token: 'ally' },
    }).kind).toBe('accepted')
    const temporaryHp = snuggle.mapRepository.getBySlug(snuggleSlug)!.temporaryHitPoints?.byPlacementId
    expect(temporaryHp?.actor).toBeGreaterThan(0)
    expect(temporaryHp?.ally).toBeGreaterThan(0)
    expect(temporaryHp?.target).toBeUndefined()

    const soullessSlug = 'remaining-snuggle-soulless'
    const soulless = setup({
      slug: soullessSlug, actorAbility: 'Snuggle', allyCapabilities: ['Soulless'],
    })
    expect(() => useAbility({
      dependencies: soulless, mapSlug: soullessSlug, canonicalId: 'Snuggle',
      selected: { token: 'ally' },
    })).toThrow(/Soulless creatures cannot gain Temporary HP/)
    expect(soulless.mapRepository.getBySlug(soullessSlug)).toMatchObject({ revision: 5 })
    expect(soulless.mapRepository.getBySlug(soullessSlug)?.temporaryHitPoints).toBeUndefined()

    const suppressedSoullessSlug = 'remaining-snuggle-suppressed-soulless'
    const suppressedSoulless = setup({
      slug: suppressedSoullessSlug,
      actorAbility: 'Snuggle',
      allyCapabilities: ['Soulless'],
      effects: [parseEncounterEffect({
        id: 'test.suppressed-soulless',
        kind: 'capability',
        source: { operationId: 'test.suppress-soulless', moveId: 'test.suppress-soulless', placementId: 'actor' },
        affected: { placementIds: ['ally'], sideIds: [], cells: [] },
        createdRound: 1,
        createdTurn: 0,
        duration: { kind: 'scene', remaining: null },
        stacks: 1,
        charges: null,
        stackPolicy: { kind: 'replace', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null },
        tags: ['test', 'capability-suppression'],
        payload: { capabilityId: 'soulless', action: 'suppress' },
        dispel: { policy: 'none', tags: [] },
        transferPolicy: 'expire',
        suppression: { sources: [] },
      })],
    })
    expect(useAbility({
      dependencies: suppressedSoulless,
      mapSlug: suppressedSoullessSlug,
      canonicalId: 'Snuggle',
      selected: { token: 'ally' },
    }).kind).toBe('accepted')
    expect(suppressedSoulless.mapRepository.getBySlug(suppressedSoullessSlug)!
      .temporaryHitPoints?.byPlacementId.ally).toBeGreaterThan(0)
  })

  it('applies Rain Dish and Sand Stream with their exact weather, HP, and frequency rules', () => {
    const rainSlug = 'remaining-rain-dish'
    const rain = setup({ slug: rainSlug, actorAbility: 'Rain Dish', actorCurrentHp: 1 })
    expect(useAbility({ dependencies: rain, mapSlug: rainSlug, canonicalId: 'Rain Dish' }).kind)
      .toBe('accepted')
    expect(savedSheet(rain).combat?.currentHp).toBeGreaterThan(1)
    expect(savedSheet(rain).abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Rain Dish', spent: 1, limit: 5,
    }))

    const streamSlug = 'remaining-sand-stream'
    const stream = setup({ slug: streamSlug, actorAbility: 'Sand Stream' })
    expect(useAbility({ dependencies: stream, mapSlug: streamSlug, canonicalId: 'Sand Stream' }).kind)
      .toBe('accepted')
    const streamMap = stream.mapRepository.getBySlug(streamSlug)!
    expect(streamMap.encounterState?.zones).toContainEqual(expect.objectContaining({
      kind: 'weather', duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      payload: { weatherId: 'sandstorm' },
    }))
    expect(streamMap.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Sand Stream', spent: 1, limit: 3,
    }))
  })

  it('requires Ingrain for Root Down and pays exact Shell Shield and Suction Cups actions', () => {
    const rootSlug = 'remaining-root-down'
    const ingrain = parseEncounterEffect({
      id: 'move.ingrain.coat.actor', kind: 'capability',
      source: { operationId: 'ingrain.coat', moveId: 'move.ingrain', placementId: 'actor' },
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      createdRound: 1, createdTurn: 1,
      duration: { kind: 'scene', remaining: null }, stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ingrain', 'coat'], payload: { capabilityId: 'ingrain-coat', action: 'grant' },
      dispel: { policy: 'matching-tags', tags: ['ingrain'] }, transferPolicy: 'expire',
      suppression: { sources: [] },
    })
    const root = setup({ slug: rootSlug, actorAbility: 'Root Down', effects: [ingrain] })
    expect(useAbility({ dependencies: root, mapSlug: rootSlug, canonicalId: 'Root Down' }).kind)
      .toBe('accepted')
    const rootMap = root.mapRepository.getBySlug(rootSlug)!
    expect(spent(rootMap, 'shift')).toBe(1)
    expect(rootMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      tags: expect.arrayContaining(['aa087-root-down-dr']),
    }))

    const shellSlug = 'remaining-shell-shield'
    const shell = setup({ slug: shellSlug, actorAbility: 'Shell Shield' })
    expect(useAbility({ dependencies: shell, mapSlug: shellSlug, canonicalId: 'Shell Shield' }).kind)
      .toBe('accepted')
    const shellMap = shell.mapRepository.getBySlug(shellSlug)!
    expect(spent(shellMap, 'free')).toBe(1)
    expect(spent(shellMap, 'standard')).toBe(1)
    expect(savedSheet(shell).stats?.def?.stage).toBe(1)
    expect(shellMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      tags: expect.arrayContaining(['shell-shield']),
      payload: expect.objectContaining({ attribute: 'damage-reduction', value: 10 }),
    }))

    const cupsSlug = 'remaining-suction-cups'
    const cups = setup({ slug: cupsSlug, actorAbility: 'Suction Cups' })
    expect(useAbility({ dependencies: cups, mapSlug: cupsSlug, canonicalId: 'Suction Cups' }).kind)
      .toBe('accepted')
    const cupsMap = cups.mapRepository.getBySlug(cupsSlug)!
    expect(spent(cupsMap, 'shift')).toBe(1)
    expect(cupsMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      tags: expect.arrayContaining(['aa093-suction-cups-dr']),
    }))
  })

  it('pays Targeting System as Lock-On and binds only its exact target', () => {
    const mapSlug = 'remaining-targeting-system'
    const dependencies = setup({ slug: mapSlug, actorAbility: 'Targeting System' })
    expect(useAbility({
      dependencies, mapSlug, canonicalId: 'Targeting System', selected: { token: 'target' },
    }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(mapSlug)!
    expect(spent(map, 'free')).toBe(1)
    expect(spent(map, 'swift')).toBe(1)
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      tags: expect.arrayContaining(['aa094-targeting-system-lock-on']),
      affected: expect.objectContaining({ placementIds: ['actor', 'target'] }),
      duration: { kind: 'until-triggered', remaining: null },
    }))
  })

  it('Quick Cloak offers only server-observed nearby materials and retains its cloak until canonical breakage', () => {
    const mapSlug = 'remaining-quick-cloak'
    const dependencies = setup({
      slug: mapSlug, actorAbility: 'Quick Cloak', actorSpecies: 'Burmy',
      materialId: 'meadow_grass',
    })
    const offer = begin(dependencies, mapSlug, 'Quick Cloak')
    expect(offer.declarations.find(declaration => declaration.kind === 'type')?.options.map(option => option.hint))
      .toEqual([{ kind: 'type', valueId: 'grass' }])
    expect(useAbility({
      dependencies, mapSlug, canonicalId: 'Quick Cloak', selected: { type: 'grass' },
    }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(mapSlug)!
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      kind: 'creature-rule-overlay', transferPolicy: 'retain',
      tags: expect.arrayContaining(['aa085-quick-cloak', 'cloak-grass']),
      payload: expect.objectContaining({ domain: 'type', action: 'add', values: ['grass'] }),
    }))
    expect(spent(map, 'standard')).toBe(1)
  })

  it('Rally grants only its immediate source-turn Disengage window to the user and nearby allies', () => {
    const mapSlug = 'remaining-rally'
    const dependencies = setup({ slug: mapSlug, actorAbility: 'Rally' })
    expect(useAbility({ dependencies, mapSlug, canonicalId: 'Rally' }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(mapSlug)!
    expect(map.encounterState?.effects).toContainEqual(expect.objectContaining({
      tags: expect.arrayContaining(['aa086-rally-free-disengage']),
      affected: expect.objectContaining({ placementIds: ['actor', 'ally'] }),
      duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
    }))
    expect(spent(map, 'swift')).toBe(1)
  })

  it('uses canonical Regal Challenge and Shadow Tag target ranges and relationships', () => {
    const regalSlug = 'remaining-regal-challenge-range'
    const regal = setup({ slug: regalSlug, actorAbility: 'Regal Challenge' })
    const regalMap = regal.mapRepository.getBySlug(regalSlug)!
    regal.mapRepository.saveSetupMap({
      ...regalMap,
      placements: regalMap.placements.map(placement => placement.id === 'target'
        ? { ...placement, position: { x: 11, y: 0, z: 5 } }
        : placement),
    })
    const regalOffer = begin(regal, regalSlug, 'Regal Challenge')
    expect(regalOffer.declarations.find(declaration => declaration.kind === 'token')?.options
      .map(option => option.hint.kind === 'placement' ? option.hint.placementId : null))
      .toEqual(['ally'])

    const shadowSlug = 'remaining-shadow-tag-adjacent'
    const shadow = setup({ slug: shadowSlug, actorAbility: 'Shadow Tag' })
    const shadowOffer = begin(shadow, shadowSlug, 'Shadow Tag')
    expect(shadowOffer.declarations.find(declaration => declaration.kind === 'token')?.options
      .map(option => option.hint.kind === 'placement' ? option.hint.placementId : null))
      .toEqual(['ally'])
    expect(useAbility({
      dependencies: shadow,
      mapSlug: shadowSlug,
      canonicalId: 'Shadow Tag',
      selected: { token: 'ally' },
    }).kind).toBe('accepted')
    expect(shadow.mapRepository.getBySlug(shadowSlug)?.encounterState?.effects)
      .toContainEqual(expect.objectContaining({
        tags: expect.arrayContaining(['aa089-shadow-tag']),
        affected: { placementIds: ['ally'], sideIds: [], cells: [{ x: 6, y: 0, z: 5 }] },
        duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 5 },
      }))
  })

  it('Starlight and Sunglow pay Daily usage only when creating their light state and later expend it', () => {
    for (const reviewed of [
      {
        canonicalId: 'Starlight',
        naturalLight: 'moonlight',
        stateTag: 'aa092-luminous',
        boostTag: 'aa092-starlight-evasion',
        stage: 'sdef',
      },
      {
        canonicalId: 'Sunglow',
        naturalLight: 'sunlight',
        stateTag: 'aa093-radiant',
        boostTag: 'aa093-sunglow-accuracy',
        stage: 'atk',
      },
    ] as const) {
      const mapSlug = `remaining-${slug(reviewed.canonicalId)}-toggle`
      const dependencies = setup({
        slug: mapSlug,
        actorAbility: reviewed.canonicalId,
        naturalLight: reviewed.naturalLight,
      })
      expect(useAbility({
        dependencies,
        mapSlug,
        canonicalId: reviewed.canonicalId,
        invocationId: 'create',
      }).kind).toBe('accepted')
      const created = dependencies.mapRepository.getBySlug(mapSlug)!
      expect(created.encounterState?.effects.some(effect => (
        effect.tags.includes(reviewed.stateTag)
      ))).toBe(true)
      expect(savedSheet(dependencies).abilityUsage?.entries).toContainEqual(expect.objectContaining({
        canonicalId: reviewed.canonicalId,
        spent: 1,
        limit: 1,
      }))

      dependencies.mapRepository.saveSetupMap({
        ...created,
        encounterState: {
          ...created.encounterState!,
          history: {
            ...created.encounterState!.history,
            currentTurn: { round: 1, turn: 2, placementId: 'actor' },
          },
          turnResources: {
            ...created.encounterState!.turnResources,
            actor: createEncounterTurnResourceLedger({
              placementId: 'actor', round: 1, turn: 2,
            }),
          },
        },
      })
      expect(useAbility({
        dependencies,
        mapSlug,
        canonicalId: reviewed.canonicalId,
        invocationId: 'expend',
      }).kind).toBe('accepted')
      const expended = dependencies.mapRepository.getBySlug(mapSlug)!
      expect(expended.encounterState?.effects.some(effect => (
        effect.tags.includes(reviewed.stateTag)
      ))).toBe(false)
      expect(expended.encounterState?.effects.some(effect => (
        effect.tags.includes(reviewed.boostTag)
      ))).toBe(true)
      expect(savedSheet(dependencies).stats?.[reviewed.stage]?.stage).toBe(2)
      expect(savedSheet(dependencies).abilityUsage?.entries).toContainEqual(expect.objectContaining({
        canonicalId: reviewed.canonicalId,
        spent: 1,
        limit: 1,
      }))
      expect(spent(expended, 'swift')).toBe(1)
    }
  })

  it('Trace snapshots a parameterized target Ability with exact source provenance', () => {
    const mapSlug = 'remaining-trace-parameterized'
    const dependencies = setup({
      slug: mapSlug,
      actorAbility: 'Trace',
      targetAbility: 'Serpent’s Mark',
      targetAbilitySelections: [{ parameterId: 'pattern', optionIds: ['attack'] }],
    })
    expect(useAbility({
      dependencies,
      mapSlug,
      canonicalId: 'Trace',
      selected: { token: 'target', ability: 'ability:serpent-s-mark' },
    }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(mapSlug)!
    const copy = map.encounterState?.abilityTransformations?.entries[0]
    const copied = copy?.mechanics.abilities[0]
    expect(copy).toMatchObject({
      kind: 'copy', canonicalId: 'Trace',
      placementId: 'actor', ownerPlacementId: 'actor',
      copyBase: { sourcePlacementId: 'target', sourceRevision: 3 },
    })
    expect(copy?.copyBase?.sourceReadSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(copied).toMatchObject({
      canonicalId: 'Serpent’s Mark',
      sourcePlacementId: 'target',
      parameterStatus: 'ready',
      parameterData: {
        canonicalId: 'Serpent’s Mark',
        instanceId: copied?.instanceId,
        selections: [{ parameterId: 'pattern', optionIds: ['attack'] }],
      },
    })
    expect(spent(map, 'free')).toBe(1)
  })

  it('Symbiosis requires configured server-owned willingness and binds the exact Held Item', () => {
    const blockedSlug = 'remaining-symbiosis-unwilling'
    const blocked = setup({
      slug: blockedSlug, actorAbility: 'Symbiosis', held: 'Leftovers', willingAlly: false,
    })
    expect(() => begin(blocked, blockedSlug, 'Symbiosis')).toThrow(
      'Ability declaration activate.target has too few currently legal options.',
    )

    const mapSlug = 'remaining-symbiosis-willing'
    const dependencies = setup({
      slug: mapSlug, actorAbility: 'Symbiosis', held: 'Leftovers',
      allyHeld: 'Focus Band', willingAlly: true,
    })
    const offer = begin(dependencies, mapSlug, 'Symbiosis')
    expect(offer.declarations.find(declaration => declaration.kind === 'token')?.options).toHaveLength(1)
    expect(offer.declarations.find(declaration => declaration.kind === 'item')?.options).toHaveLength(1)
    expect(useAbility({ dependencies, mapSlug, canonicalId: 'Symbiosis' }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(mapSlug)!
    const shared = map.encounterState?.effects.find(effect => (
      effect.tags.includes('aa094-symbiosis-shared-item')
    ))
    expect(shared).toMatchObject({
      affected: expect.objectContaining({ placementIds: ['ally'] }),
      tags: expect.arrayContaining([
        'aa094-symbiosis-shared-item',
        'aa094-symbiosis-item:leftovers',
      ]),
      duration: { kind: 'scene', remaining: null },
    })
    expect(shared?.tags.find(tag => tag.startsWith('aa094-symbiosis-binding:')))
      .toMatch(/^aa094-symbiosis-binding:.+/)
    expect(spent(map, 'swift')).toBe(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Symbiosis', spent: 1, limit: 1,
    }))
  })

  it('enforces canonical target ranges for Symbiosis, Toxic Nourishment, and Unnerve', () => {
    const distantSymbiosisSlug = 'remaining-symbiosis-distant'
    const distantSymbiosis = setup({
      slug: distantSymbiosisSlug,
      actorAbility: 'Symbiosis',
      held: 'Leftovers',
      willingAlly: true,
      allyPosition: { x: 7, y: 0, z: 5 },
    })
    expect(() => begin(distantSymbiosis, distantSymbiosisSlug, 'Symbiosis')).toThrow(
      'Ability declaration activate.target has too few currently legal options.',
    )

    const nourishmentSlug = 'remaining-toxic-nourishment-range-five'
    const nourishment = setup({
      slug: nourishmentSlug,
      actorAbility: 'Toxic Nourishment',
      targetConditions: ['Poisoned'],
      targetPosition: { x: 10, y: 0, z: 5 },
    })
    expect(begin(nourishment, nourishmentSlug, 'Toxic Nourishment').declarations
      .find(declaration => declaration.kind === 'token')?.options).toHaveLength(1)
    expect(useAbility({
      dependencies: nourishment,
      mapSlug: nourishmentSlug,
      canonicalId: 'Toxic Nourishment',
      selected: { token: 'target' },
    }).kind).toBe('accepted')
    expect((nourishment.sheetRepository.getByRef('pokemon', 'target')!.sheet as unknown as CharacterSheet)
      .combat?.conditions).not.toContain('Poisoned')

    const distantNourishmentSlug = 'remaining-toxic-nourishment-distant'
    const distantNourishment = setup({
      slug: distantNourishmentSlug,
      actorAbility: 'Toxic Nourishment',
      targetConditions: ['Badly Poisoned'],
      targetPosition: { x: 11, y: 0, z: 5 },
    })
    expect(() => begin(distantNourishment, distantNourishmentSlug, 'Toxic Nourishment')).toThrow(
      'Ability declaration activate.target has too few currently legal options.',
    )

    const unnerveSlug = 'remaining-unnerve-range-six'
    const unnerve = setup({
      slug: unnerveSlug,
      actorAbility: 'Unnerve',
      targetPosition: { x: 11, y: 0, z: 5 },
    })
    expect(useAbility({
      dependencies: unnerve,
      mapSlug: unnerveSlug,
      canonicalId: 'Unnerve',
      selected: { token: 'target' },
    }).kind).toBe('accepted')

    const distantUnnerveSlug = 'remaining-unnerve-distant'
    const distantUnnerve = setup({
      slug: distantUnnerveSlug,
      actorAbility: 'Unnerve',
      targetPosition: { x: 12, y: 0, z: 5 },
    })
    expect(() => begin(distantUnnerve, distantUnnerveSlug, 'Unnerve')).toThrow(
      'Ability declaration activate.target has too few currently legal options.',
    )
  })

  it('excludes canonically ineligible conscious-state, condition, and copy targets', () => {
    const faintedSymbiosisSlug = 'remaining-symbiosis-fainted'
    const faintedSymbiosis = setup({
      slug: faintedSymbiosisSlug,
      actorAbility: 'Symbiosis',
      held: 'Leftovers',
      willingAlly: true,
      allyCurrentHp: 0,
    })
    expect(() => begin(faintedSymbiosis, faintedSymbiosisSlug, 'Symbiosis')).toThrow(
      'Ability declaration activate.target has too few currently legal options.',
    )

    for (const testCase of [
      { slug: 'remaining-toxic-nourishment-healthy', targetCurrentHp: 100, targetConditions: [] },
      { slug: 'remaining-toxic-nourishment-fainted', targetCurrentHp: 0, targetConditions: ['Poisoned'] },
    ] as const) {
      const dependencies = setup({
        slug: testCase.slug,
        actorAbility: 'Toxic Nourishment',
        targetCurrentHp: testCase.targetCurrentHp,
        targetConditions: testCase.targetConditions,
      })
      expect(() => begin(dependencies, testCase.slug, 'Toxic Nourishment')).toThrow(
        'Ability declaration activate.target has too few currently legal options.',
      )
    }

    for (const testCase of [
      { slug: 'remaining-trace-no-ability', targetAbility: undefined, targetCurrentHp: 100 },
      { slug: 'remaining-trace-noncopyable', targetAbility: 'Multitype', targetCurrentHp: 100 },
      { slug: 'remaining-trace-fainted', targetAbility: 'Stench', targetCurrentHp: 0 },
    ] as const) {
      const dependencies = setup({
        slug: testCase.slug,
        actorAbility: 'Trace',
        targetAbility: testCase.targetAbility,
        targetCurrentHp: testCase.targetCurrentHp,
      })
      expect(() => begin(dependencies, testCase.slug, 'Trace')).toThrow(
        'Ability declaration activate.target has too few currently legal options.',
      )
    }

    const faintedUnnerveSlug = 'remaining-unnerve-fainted'
    const faintedUnnerve = setup({
      slug: faintedUnnerveSlug,
      actorAbility: 'Unnerve',
      targetCurrentHp: 0,
    })
    expect(() => begin(faintedUnnerve, faintedUnnerveSlug, 'Unnerve')).toThrow(
      'Ability declaration activate.target has too few currently legal options.',
    )
  })

  it('Strange Tempo uses an authoritative Free bypass branch or a separate Standard cure branch', () => {
    const bypassSlug = 'remaining-strange-tempo-bypass'
    const bypass = setup({
      slug: bypassSlug, actorAbility: 'Strange Tempo', conditions: ['Confused'],
    })
    expect(useAbility({
      dependencies: bypass, mapSlug: bypassSlug, canonicalId: 'Strange Tempo',
      selected: { branch: 'act-normally' },
    }).kind).toBe('accepted')
    const bypassMap = bypass.mapRepository.getBySlug(bypassSlug)!
    expect(spent(bypassMap, 'free')).toBe(1)
    expect(spent(bypassMap, 'standard')).toBe(0)
    expect(savedSheet(bypass).combat?.conditions).toContain('Confused')
    expect(bypassMap.encounterState?.effects).toContainEqual(expect.objectContaining({
      tags: expect.arrayContaining(['aa093-strange-tempo-ignore-confusion-check']),
    }))

    const cureSlug = 'remaining-strange-tempo-cure'
    const cure = setup({ slug: cureSlug, actorAbility: 'Strange Tempo', conditions: ['Confused'] })
    expect(useAbility({
      dependencies: cure, mapSlug: cureSlug, canonicalId: 'Strange Tempo',
      selected: { branch: 'cure-confusion.speed' },
    }).kind).toBe('accepted')
    const cureMap = cure.mapRepository.getBySlug(cureSlug)!
    expect(spent(cureMap, 'standard')).toBe(1)
    expect(spent(cureMap, 'free')).toBe(0)
    expect(savedSheet(cure).combat?.conditions).not.toContain('Confused')
    expect(savedSheet(cure).stats?.spd?.stage).toBe(2)
  })

  it('routes direct Combat Stage gains through effective Simple and Contrary authority', () => {
    const simpleSlug = 'remaining-toxic-boost-simple'
    const simple = setup({
      slug: simpleSlug,
      actorAbility: 'Toxic Boost',
      actorAdditionalAbilities: ['Simple'],
      conditions: ['Poisoned'],
    })
    expect(useAbility({ dependencies: simple, mapSlug: simpleSlug, canonicalId: 'Toxic Boost' }).kind)
      .toBe('accepted')
    expect(savedSheet(simple).stats?.atk?.stage).toBe(6)
    expect(savedSheet(simple).stats?.satk?.stage).toBe(6)

    const contrarySlug = 'remaining-toxic-boost-contrary'
    const contrary = setup({
      slug: contrarySlug,
      actorAbility: 'Toxic Boost',
      actorAdditionalAbilities: ['Contrary'],
      conditions: ['Poisoned'],
    })
    expect(useAbility({
      dependencies: contrary, mapSlug: contrarySlug, canonicalId: 'Toxic Boost',
    }).kind).toBe('accepted')
    expect(savedSheet(contrary).stats?.atk?.stage).toBe(-3)
    expect(savedSheet(contrary).stats?.satk?.stage).toBe(-3)
  })

  it('Starswirl prepays Rapid Spin action cost while preserving ordinary move planning', () => {
    const mapSlug = 'remaining-starswirl'
    const dependencies = setup({ slug: mapSlug, actorAbility: 'Starswirl' })
    expect(useAbility({ dependencies, mapSlug, canonicalId: 'Starswirl' }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(mapSlug)!
    expect(spent(map, 'swift')).toBe(1)
    expect(spent(map, 'standard')).toBe(0)
    const planned = planEncounterMoveResourceCosts({
      map, placementId: 'actor', canonicalMoveId: 'Rapid Spin', moveKey: 'rapid-spin',
      range: 'Melee, 1 Target', resolutionId: 'resolution:rapid-spin',
      sourceOperationId: 'rapid-spin:resources', movement: null,
      allowLegacyFallback: true, minimumPhaseExclusive: null, maximumPhaseInclusive: 'pay',
      markActedSinceEntry: true,
    })
    expect(planned.costs.some(cost => cost.cost.kind === 'action-resource')).toBe(false)
    expect(planned.currentEncounterState.turnResources.actor?.actions.standard.spent ?? 0).toBe(0)
    expect(planned.currentEncounterState.turnResources.actor?.oncePerTurnFlags.some(flag => (
      flag.id === 'encounter.acted-since-entry'
    ))).toBe(true)
  })

  it('Steam Engine consumes an exact Rainy turn-start trigger and creates complete centered Smokescreen geometry', () => {
    const marker: EncounterEffect = {
      id: 'ability.steam-engine.rain-trigger.test', kind: 'capability',
      source: { operationId: 'lifecycle:steam-engine', moveId: 'ability.steam-engine', placementId: 'actor' },
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      createdRound: 1, createdTurn: 1,
      duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
      stacks: 1, charges: 1,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
      tags: ['ability', 'aa092-steam-engine-rain-trigger'],
      payload: { capabilityId: 'aa092.steam-engine.rain-trigger', action: 'grant' },
      dispel: { policy: 'matching-tags', tags: ['aa092-steam-engine-rain-trigger'] },
      transferPolicy: 'expire', suppression: { sources: [] },
    }
    const mapSlug = 'remaining-steam-engine-rain'
    const dependencies = setup({
      slug: mapSlug, actorAbility: 'Steam Engine', rainy: true, effects: [marker],
    })
    expect(useAbility({ dependencies, mapSlug, canonicalId: 'Steam Engine' }).kind).toBe('accepted')
    const map = dependencies.mapRepository.getBySlug(mapSlug)!
    expect(spent(map, 'swift')).toBe(1)
    expect(map.encounterState?.effects.some(effect => effect.id === marker.id)).toBe(false)
    expect(map.encounterState?.zones.filter(zone => (
      zone.kind === 'hazard' && zone.payload.familyId === 'hazard.smoke'
    )).length).toBeGreaterThan(1)
    expect(map.encounterState?.abilityUsage?.entries).toContainEqual(expect.objectContaining({
      canonicalId: 'Steam Engine', spent: 1, limit: 2,
    }))
  })

  it('Truant refusal blocks Standard and Full actions without blocking unrelated resources', () => {
    const base = battleMap({ slug: 'remaining-truant' })
    const marker: EncounterEffect = {
      id: 'ability.truant.refusal.test', kind: 'capability',
      source: { operationId: 'lifecycle:truant', moveId: 'ability.truant', placementId: 'actor' },
      affected: { placementIds: ['actor'], sideIds: [], cells: [] },
      createdRound: 1, createdTurn: 1,
      duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
      stacks: 1, charges: 1,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
      tags: ['ability', 'aa096-truant-refused-turn'],
      payload: { capabilityId: 'aa096.truant.condition-save-bonus-3', action: 'grant' },
      dispel: { policy: 'matching-tags', tags: ['aa096-truant-refused-turn'] },
      transferPolicy: 'expire', suppression: { sources: [] },
    }
    const map: TabletopMap = {
      ...base,
      encounterState: { ...base.encounterState!, effects: [marker] },
    }
    expect(() => planEncounterMoveResourceCosts({
      map, placementId: 'actor', canonicalMoveId: 'Tackle', moveKey: 'tackle',
      range: 'Melee, 1 Target', resolutionId: 'resolution:truant',
      sourceOperationId: 'truant:standard', movement: null,
      allowLegacyFallback: true, minimumPhaseExclusive: null, maximumPhaseInclusive: 'pay',
    })).toThrow(/Truant prevents/)
    expect(() => planEncounterMoveResourceCosts({
      map, placementId: 'actor', canonicalMoveId: 'ability:test', moveKey: 'ability:test',
      range: 'Swift Action', resolutionId: 'resolution:truant-swift',
      sourceOperationId: 'truant:swift', movement: null,
      allowLegacyFallback: true, minimumPhaseExclusive: null, maximumPhaseInclusive: 'pay',
    })).not.toThrow()
  })
})
