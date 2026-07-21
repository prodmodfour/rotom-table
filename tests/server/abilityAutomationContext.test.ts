import { describe, expect, it } from 'vitest'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createDefaultGroupInventoryDocument } from '~/types/groupInventory'
import {
  AuthoritativeAbilityContextError,
  abilityHandlerContextFromAuthoritativeContext,
  buildAuthoritativeAbilityContext,
  deduplicateAuthoritativeAbilityReads,
  type AuthoritativeEffectiveAbility,
} from '../../server/domain/abilityAutomation/context'
import { createAbilitySpecExtensionRegistry } from '../../server/domain/abilityAutomation/extensionRegistry'
import type { AbilitySpecV1Runtime } from '../../server/domain/abilityAutomation/registry'
import { validateAbilitySpec } from '../../server/domain/abilityAutomation/validateSpec'
import { createAbilityResolutionTraceForContext } from '../../server/domain/abilityAutomation/trace'
import { emptyAuthoritativeMoveItemResources } from '../../server/domain/moveAutomation/itemResources'
import { redBlueEncounterStateFixture } from '../fixtures/moveAutomation/encounterSides'

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
  sideId: string,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 0 },
  sideId,
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'ability-context-arena',
  name: 'Ability Context Arena',
  revision: 9,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', 0, 'red'),
    placement('target-token', 'target', 1, 'blue'),
    placement('ally-token', 'ally', 2, 'red'),
  ],
  lights: [],
  initiative: { activeId: 'actor-token', round: 2 },
  encounterState: redBlueEncounterStateFixture(),
})

const sheet = (
  slug: string,
  revision: number,
  abilityName: string,
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: slug === 'target' ? 'Snorlax' : 'Audino',
  level: 20,
  revision,
  movelist: [],
  abilities: [{ name: abilityName }],
  combat: { currentHp: 80 },
})

const sheets = (): ReadonlyMap<string, CharacterSheet> => new Map([
  ['actor', sheet('actor', 3, 'Healer')],
  ['target', sheet('target', 5, 'Immunity')],
  ['ally', sheet('ally', 4, 'Celebrate')],
])

const extensionRegistry = createAbilitySpecExtensionRegistry([{
  family: 'operation',
  kind: 'marker',
  version: 1,
  parse: value => value,
}])

const runtimeFixture = (): AbilitySpecV1Runtime => {
  const definition = validateAbilitySpec({
    schemaVersion: 1,
    canonicalId: 'Healer',
    version: 1,
    modes: [{ id: 'mode-activated', kind: 'activated' }],
    subscriptions: [],
    targeting: [{
      id: 'target-token',
      modeId: 'mode-activated',
      kind: 'token',
      minSelections: 1,
      maxSelections: 1,
      selector: null,
      predicate: null,
    }],
    preconditions: [],
    costs: [],
    phases: [{
      modeId: 'mode-activated',
      phase: 'effect',
      operations: [{ kind: 'marker', id: 'heal' }],
    }],
    registeredHandlerId: null,
    presentation: {
      displayName: 'Healer',
      summaryKey: 'ability.healer.summary',
      vfxKey: null,
      tags: ['activated'],
    },
  }, {
    capabilityIds: ['runtime.abilityspec-v1'],
    extensionRegistry,
  })
  return {
    canonicalId: 'Healer',
    kind: 'abilityspec-v1',
    version: 1,
    definitionHash: definition.definitionHash,
    sourceModule: 'server/domain/abilityAutomation/specs/healer.ts',
    definition,
  }
}

const buildContext = (overrides: Partial<Parameters<typeof buildAuthoritativeAbilityContext>[0]> = {}) => (
  buildAuthoritativeAbilityContext({
    map: mapFixture(),
    pokemonSheets: sheets(),
    trainerSheets: new Map<string, TrainerSheet>(),
    request: {
      canonicalId: 'Healer',
      modeId: 'mode-activated',
      actorPlacementId: 'actor-token',
      targetPlacementIds: ['target-token'],
      triggeringEvent: null,
    },
    runtime: runtimeFixture(),
    resolutionId: 'resolution.context',
    random: () => 0.5,
    time: 1_000,
    ...overrides,
  })
)

describe('immutable authoritative ability context', () => {
  it('resolves and freezes actor, source, targets, map, sheets, sides, history, and capabilities', () => {
    const sourceMap = mapFixture()
    const sourceSheets = sheets()
    const sourceRuntime = runtimeFixture()
    const context = buildContext({ map: sourceMap, pokemonSheets: sourceSheets, runtime: sourceRuntime })
    sourceMap.name = 'Changed'
    ;(sourceSheets.get('actor') as CharacterSheet).nickname = 'Changed'
    ;(sourceRuntime as { sourceModule: string }).sourceModule = 'changed.ts'

    expect(context.actor).toMatchObject({
      placement: { id: 'actor-token', sideId: 'red' },
      sheet: { kind: 'pokemon', slug: 'actor', revision: 3 },
    })
    expect(context.source).toBe(context.actor)
    expect(context.targets.map(target => target.placement.id)).toEqual(['target-token'])
    expect(context.map.name).toBe('Ability Context Arena')
    expect((context.actor.sheet.sheet as CharacterSheet).nickname).toBe('actor')
    expect(context.runtime.sourceModule).toBe('server/domain/abilityAutomation/specs/healer.ts')
    expect(context.sides).toHaveProperty('red')
    expect(context.encounterHistory).toEqual(context.map.encounterState?.history)
    expect(context.queries.capabilities.all()).toEqual(['runtime.abilityspec-v1'])
    expect(context.queries.capabilities.has('runtime.abilityspec-v1')).toBe(true)
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.map)).toBe(true)
    expect(Object.isFrozen(context.actor.sheet.sheet)).toBe(true)
    expect(Object.isFrozen(context.runtime.definition)).toBe(true)
  })

  it('binds server-owned randomness and trace ancestry to the selected runtime context', () => {
    const context = buildContext()
    context.random.roll({
      rollId: 'roll.context',
      parentEffectId: 'operation.context',
      reason: 'Context roll',
      formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
    })
    const trace = createAbilityResolutionTraceForContext({ context })

    expect(context.resolutionId).toBe('resolution.context')
    expect(context.random.snapshot()[0]).toMatchObject({
      rollId: 'roll.context',
      naturalResult: 11,
    })
    expect(context.budget.snapshot()).toMatchObject({ rolls: 1 })
    expect(trace).toMatchObject({
      resolutionId: 'resolution.context',
      program: {
        canonicalId: 'Healer',
        modeId: 'mode-activated',
        runtimeKind: 'abilityspec-v1',
        definitionHash: context.runtime.definitionHash,
      },
    })
  })

  it('derives base effective abilities and records every consulted private sheet revision', () => {
    const context = buildContext()

    expect(context.actor.effectiveAbilities).toEqual([expect.objectContaining({
      canonicalId: 'Healer',
      sourceKind: 'base',
      effective: true,
    })])
    expect(context.queries.effectiveAbilities.has('target-token', 'Immunity')).toBe(true)
    expect(context.queries.effectiveAbilities.activeForPlacement('ally-token')).toEqual([
      expect.objectContaining({ canonicalId: 'Celebrate' }),
    ])
    expect(context.reads.snapshot()).toEqual([
      { kind: 'map', slug: 'ability-context-arena', revision: 9 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'target', revision: 5 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'ally', revision: 4 },
    ])
  })

  it('honors a server-derived suppressed projection without treating it as active', () => {
    const projected: readonly AuthoritativeEffectiveAbility[] = [{
      instanceId: 'base:actor-token:0',
      canonicalId: 'Healer',
      sourceKind: 'base',
      sourcePlacementId: 'actor-token',
      definitionHash: null,
      effective: false,
      suppressionReasonCode: 'ability-suppressed',
      parameterStatus: 'not-parameterized',
      parameterData: null,
    }]
    const context = buildContext({
      effectiveAbilities: new Map([
        ['actor-token', projected],
        ['target-token', []],
        ['ally-token', []],
      ]),
    })

    expect(context.queries.effectiveAbilities.allForPlacement('actor-token')).toEqual(projected)
    expect(context.queries.effectiveAbilities.activeForPlacement('actor-token')).toEqual([])
    expect(context.queries.effectiveAbilities.has('actor-token', 'Healer')).toBe(false)
  })

  it('exposes authoritative side relationships, encounter effects, history, and selected placements', () => {
    const context = buildContext()

    expect(context.queries.relationships.relation('actor-token', 'actor-token')).toBe('self')
    expect(context.queries.relationships.relation('actor-token', 'ally-token')).toBe('ally')
    expect(context.queries.relationships.relation('actor-token', 'target-token')).toBe('enemy')
    expect(context.queries.placements.selected().map(entry => entry.id)).toEqual(['target-token'])
    expect(context.queries.encounterEffects.all()).toBe(context.encounterEffects)
    expect(context.queries.entities.all()).toBe(context.abilityEntities.entries)
    expect(context.queries.entities.get('unknown-entity')).toBeNull()
    expect(context.queries.entities.targetable('unknown-entity')).toBeNull()
    expect(context.queries.transformations.all()).toBe(context.abilityTransformations.entries)
    expect(context.queries.transformations.get('unknown-snapshot')).toBeNull()
    expect(context.queries.history.completedMovesThisScene()).toEqual([])
    expect(Object.isFrozen(context.queries)).toBe(true)
  })

  it('projects only the closed handler snapshot and read-recording query port', () => {
    const context = buildContext()
    const handlerContext = abilityHandlerContextFromAuthoritativeContext(context)

    expect(Object.keys(handlerContext)).toEqual(['snapshot', 'queries'])
    expect(handlerContext.snapshot).toMatchObject({
      canonicalId: 'Healer',
      modeId: 'mode-activated',
      actorPlacementId: 'actor-token',
      sourcePlacementId: 'actor-token',
      selectedPlacementIds: ['target-token'],
    })
    expect(handlerContext.queries.distanceMeters('actor-token', 'target-token')).toBe(1)
    expect(handlerContext.queries.relation('actor-token', 'target-token')).toBe('enemy')
    expect(handlerContext.queries.effectiveAbilityIds('actor-token')).toEqual(['Healer'])
    expect(handlerContext.queries.historyCount('actor-token', 'unknown')).toBe(0)
    expect(handlerContext.queries.placementById('target-token')).toMatchObject({ id: 'target-token' })
    expect(Object.isFrozen(handlerContext)).toBe(true)
    expect(Object.isFrozen(handlerContext.queries)).toBe(true)
  })

  it('keeps item documents private behind bounded queries and joins their revisions to reads', () => {
    const inventory = createDefaultGroupInventoryDocument({ slug: 'main', now: 1 })
    inventory.revision = 6
    const itemResources = {
      ...emptyAuthoritativeMoveItemResources(),
      groupInventoryReads: [{ slug: 'main', revision: 6 }],
      groupInventories: new Map([['main', inventory]]),
    }
    const context = buildContext({ itemResources })
    inventory.money = 999

    expect(context.queries.items.groupInventory('main')).toMatchObject({
      slug: 'main',
      revision: 6,
      money: 0,
    })
    expect(context.queries.items.groupInventory('missing')).toBeNull()
    expect(context.reads.snapshot()).toContainEqual({
      kind: 'group-inventory',
      slug: 'main',
      revision: 6,
    })
  })

  it('deduplicates reads and fails on conflicting revisions', () => {
    expect(deduplicateAuthoritativeAbilityReads([
      { kind: 'map', slug: 'arena', revision: 1 },
      { kind: 'map', slug: 'arena', revision: 1 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'actor', revision: 2 },
    ])).toEqual([
      { kind: 'map', slug: 'arena', revision: 1 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'actor', revision: 2 },
    ])

    expect(() => deduplicateAuthoritativeAbilityReads([
      { kind: 'map', slug: 'arena', revision: 1 },
      { kind: 'map', slug: 'arena', revision: 2 },
    ])).toThrowError(expect.objectContaining({
      name: 'AuthoritativeAbilityContextError',
      code: 'read-revision-conflict',
    }))
  })

  it('fails closed on identity, placement, target, and projection conflicts', () => {
    const wrongRuntime = runtimeFixture()
    ;(wrongRuntime as { canonicalId: string }).canonicalId = 'Moxie'
    expect(() => buildContext({ runtime: wrongRuntime })).toThrowError(expect.objectContaining({
      code: 'runtime-identity-mismatch',
    }))

    expect(() => buildContext({
      request: {
        canonicalId: 'Healer',
        modeId: 'mode-activated',
        actorPlacementId: 'missing',
        targetPlacementIds: ['target-token'],
        triggeringEvent: null,
      },
    })).toThrowError(expect.objectContaining({ code: 'actor-placement-missing' }))

    expect(() => buildContext({
      request: {
        canonicalId: 'Healer',
        modeId: 'mode-activated',
        actorPlacementId: 'actor-token',
        targetPlacementIds: ['target-token', 'target-token'],
        triggeringEvent: null,
      },
    })).toThrowError(expect.objectContaining({ code: 'duplicate-target-id' }))

    expect(() => buildContext({
      effectiveAbilities: new Map([['actor-token', [{
        instanceId: 'invalid',
        canonicalId: 'Homebrew Ability',
        sourceKind: 'base',
        sourcePlacementId: 'actor-token',
        definitionHash: null,
        effective: true,
        suppressionReasonCode: null,
        parameterStatus: 'not-parameterized',
        parameterData: null,
      }]]]),
    })).toThrowError(expect.objectContaining({ code: 'invalid-effective-ability' }))

    expect(() => buildContext({
      effectiveAbilities: new Map([['actor-token', [
        {
          instanceId: 'duplicate',
          canonicalId: 'Healer',
          sourceKind: 'base',
          sourcePlacementId: 'actor-token',
          definitionHash: null,
          effective: true,
          suppressionReasonCode: null,
          parameterStatus: 'not-parameterized',
          parameterData: null,
        },
        {
          instanceId: 'duplicate',
          canonicalId: 'Celebrate',
          sourceKind: 'granted',
          sourcePlacementId: 'ally-token',
          definitionHash: null,
          effective: true,
          suppressionReasonCode: null,
          parameterStatus: 'not-parameterized',
          parameterData: null,
        },
      ]]]),
    })).toThrowError(AuthoritativeAbilityContextError)
  })
})
