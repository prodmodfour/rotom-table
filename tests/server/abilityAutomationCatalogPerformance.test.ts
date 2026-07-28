import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/ability-automation/manifest.json'
import type { AbilityAutomationManifest } from '#shared/abilityAutomation/manifest'
import {
  ABILITY_AUTOMATION_CATALOG_PERFORMANCE_BUDGETS as BUDGETS,
} from '#shared/abilityAutomation/performanceBudgets'
import { aggregateAbilityPassiveProviders } from '#shared/abilityAutomation/passiveProviders'
import { LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION } from '#shared/livePlayMoveResolution'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  ABILITY_AUTOMATION_RUNTIME_REGISTRY,
  REVIEWED_ABILITY_SPEC_V1_REGISTRATIONS,
  createAbilityAutomationRuntimeRegistry,
  type AbilityAutomationRuntimeRegistry,
  type AbilitySpecV1Runtime,
} from '../../server/domain/abilityAutomation/registry'
import { routeAbilityEventSubscriptions } from '../../server/domain/abilityAutomation/subscriptionRouter'
import { resolveAuthoritativeMove } from '../../server/domain/resolveAuthoritativeMove'
import { transitionPendingAbilitySaga } from '../../server/domain/abilityAutomation/pendingSaga'
import { redBlueEncounterStateFixture } from '../fixtures/moveAutomation/encounterSides'
import { pendingAbilitySagaFixture } from '../fixtures/abilityAutomation/pendingSaga'

const actionEvent = () => ({
  schemaVersion: 1,
  eventId: 'event.catalog-performance',
  kind: 'action',
  sequence: 1,
  mapSlug: 'performance-arena',
  mapRevision: 9,
  sceneId: 'scene.performance',
  occurredAt: 1_000,
  actorPlacementId: 'placement.000',
  sourceResolutionId: 'resolution.performance',
  parentEventId: null,
  payload: {
    actionKind: 'move',
    actionId: 'move.pound',
    timing: 'completed',
    outcome: 'applied',
    targetPlacementIds: ['placement.001'],
    tags: ['damaging'],
  },
})

const effectiveAbility = (
  runtime: AbilitySpecV1Runtime,
  placementId: string,
  instanceIndex = 0,
) => ({
  instanceId: `base:${placementId}:${instanceIndex}`,
  canonicalId: runtime.canonicalId,
  sourceKind: 'base' as const,
  sourcePlacementId: placementId,
  definitionHash: runtime.definitionHash,
  effective: true,
  suppressionReasonCode: null,
  parameterStatus: 'not-parameterized' as const,
  parameterData: null,
})

const commonMoveMap = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'ability-performance-move',
  name: 'Ability Performance Move',
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [{
    id: 'actor-token', sheetKind: 'pokemon', sheetSlug: 'actor', sideId: 'red',
    position: { x: 0, y: 0, z: 0 },
  }, {
    id: 'target-token', sheetKind: 'pokemon', sheetSlug: 'target', sideId: 'blue',
    position: { x: 1, y: 0, z: 0 },
  }],
  lights: [],
  initiative: { activeId: 'actor-token', round: 1 },
  encounterState: redBlueEncounterStateFixture(),
})

const commonMoveSheets = (): ReadonlyMap<string, CharacterSheet> => new Map([
  ['actor', {
    slug: 'actor', nickname: 'actor', species: 'Pikachu', level: 20,
    movelist: [{ name: 'Pound' }],
    abilities: [{ name: 'Compound Eyes' }, { name: 'Technician' }],
  } as CharacterSheet],
  ['target', {
    slug: 'target', nickname: 'target', species: 'Snorlax', level: 30,
    movelist: [], combat: { currentHp: 80 },
    abilities: [{ name: 'Sturdy' }],
  } as CharacterSheet],
])

describe('ability automation catalog-scale performance budgets', () => {
  it('builds and resolves the exact 483-runtime registry within the startup budget', () => {
    const startedAt = performance.now()
    const registry = createAbilityAutomationRuntimeRegistry({
      manifest: manifestJson as unknown as AbilityAutomationManifest,
      abilitySpecs: REVIEWED_ABILITY_SPEC_V1_REGISTRATIONS,
    })
    for (const record of manifestJson.abilities) expect(registry.resolve(record.canonicalId)).not.toBeNull()
    const elapsedMs = performance.now() - startedAt

    expect(registry.size).toBe(483)
    expect(elapsedMs).toBeLessThan(BUDGETS.registryBuildMilliseconds)
  })

  it('routes one event across all 483 catalog runtimes within the routing budget', () => {
    const placements = ABILITY_AUTOMATION_RUNTIME_REGISTRY.entries().map((runtime, index) => {
      const placementId = `placement.${String(index).padStart(3, '0')}`
      return { placementId, effectiveAbilities: [effectiveAbility(runtime, placementId)] }
    })
    const startedAt = performance.now()
    const routed = routeAbilityEventSubscriptions({
      event: actionEvent(),
      checkpoint: 'after-commit',
      mapSlug: 'performance-arena',
      mapRevision: 9,
      placements,
      runtimeRegistry: ABILITY_AUTOMATION_RUNTIME_REGISTRY,
    })
    const elapsedMs = performance.now() - startedAt

    expect(routed.stats.effectiveInstances).toBe(483)
    expect(routed.stats.nativeRuntimes).toBe(483)
    expect(elapsedMs).toBeLessThan(BUDGETS.catalogRoutingMilliseconds)
  })

  it('aggregates the maximum passive-provider catalog within its budget', () => {
    const providers = Array.from({ length: 1_024 }, (_, index) => ({
      schemaVersion: 1,
      providerId: `provider.${index}`,
      abilityInstanceId: `base:source.${index}:0`,
      canonicalId: 'Synthetic Provider',
      sourcePlacementId: `source.${index}`,
      scopeKey: `target.${index % 128}`,
      domain: 'stat',
      attribute: 'stat.attack',
      operation: 'add',
      value: 1,
      priority: index % 100,
      stackingGroup: 'stat.base',
      stackingPolicy: 'stack',
      reasonCode: 'ability.performance.provider',
    }))
    const startedAt = performance.now()
    const groups = aggregateAbilityPassiveProviders(providers)
    const elapsedMs = performance.now() - startedAt

    expect(groups).toHaveLength(128)
    expect(groups.reduce((count, group) => count + group.providers.length, 0)).toBe(1_024)
    expect(elapsedMs).toBeLessThan(BUDGETS.passiveAggregationMilliseconds)
  })

  it('resolves a common damaging Move with active Abilities within the repeated budget', () => {
    const map = commonMoveMap()
    const pokemonSheets = commonMoveSheets()
    const trainerSheets = new Map<string, TrainerSheet>()
    const startedAt = performance.now()
    let hitCount = 0
    for (let index = 0; index < BUDGETS.commonMoveIterations; index += 1) {
      const result = resolveAuthoritativeMove({
        map,
        pokemonSheets,
        trainerSheets,
        intent: {
          schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
          placementId: 'actor-token',
          moveName: 'Pound',
          selection: { kind: 'single-target', targetPlacementId: 'target-token' },
        },
        random: () => 0.5,
      })
      hitCount += result.transaction.hitTargetIds.length
    }
    const elapsedMs = performance.now() - startedAt

    expect(hitCount).toBe(BUDGETS.commonMoveIterations)
    expect(elapsedMs).toBeLessThan(BUDGETS.commonMoveResolutionMilliseconds)
  })

  it('routes the exact maximum trigger fan-out and resumes pending sagas within budgets', () => {
    const productionTemplate = ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve('Moxie')!
    const fanOutRuntime = {
      ...productionTemplate,
      canonicalId: 'Synthetic Fan Out',
      definitionHash: 'f'.repeat(64),
      definition: {
        ...productionTemplate.definition,
        spec: {
          ...productionTemplate.definition.spec,
          canonicalId: 'Synthetic Fan Out',
          subscriptions: [{
            id: 'subscription.performance', modeId: 'mode-triggered',
            eventKind: 'action', checkpoint: 'after-commit', response: 'mandatory',
            priority: 0, oncePerCausalChain: false, predicate: null,
          }],
        },
        extensionReferences: [],
      },
    } as AbilitySpecV1Runtime
    const fanOutRegistry = {
      size: 1,
      extensionRegistry: ABILITY_AUTOMATION_RUNTIME_REGISTRY.extensionRegistry,
      handlerRegistry: ABILITY_AUTOMATION_RUNTIME_REGISTRY.handlerRegistry,
      resolve: (canonicalId: string) => canonicalId === fanOutRuntime.canonicalId ? fanOutRuntime : null,
      entries: () => [fanOutRuntime],
    } as AbilityAutomationRuntimeRegistry
    const routed = routeAbilityEventSubscriptions({
      event: actionEvent(), checkpoint: 'after-commit', mapSlug: 'performance-arena', mapRevision: 9,
      placements: [{
        placementId: 'placement.000',
        effectiveAbilities: Array.from({ length: BUDGETS.worstTriggerFanOut }, (_, index) => (
          effectiveAbility(fanOutRuntime, 'placement.000', index)
        )),
      }],
      runtimeRegistry: fanOutRegistry,
    })
    expect(routed.routes).toHaveLength(BUDGETS.worstTriggerFanOut)

    const startedAt = performance.now()
    let committed = 0
    for (let index = 0; index < BUDGETS.pendingResumeIterations; index += 1) {
      const selected = transitionPendingAbilitySaga({
        saga: pendingAbilitySagaFixture(),
        command: {
          schemaVersion: 1, commandId: 'command.select-performance',
          resolutionId: 'resolution.secret-one', windowId: 'window.secret',
          expectedSagaVersion: 0, action: 'select', optionId: 'option.opaque-one',
          requestSha256: 'd'.repeat(64), occurredAt: 2_000,
          reasonCode: 'ability.pending.select',
        },
        authorization: { kind: 'principal', id: 'eligible-player' },
      })
      const result = transitionPendingAbilitySaga({
        saga: selected.saga,
        command: {
          schemaVersion: 1, commandId: 'command.commit-performance',
          resolutionId: 'resolution.secret-one', windowId: 'window.secret',
          expectedSagaVersion: 1, action: 'commit', optionId: null,
          requestSha256: 'e'.repeat(64), occurredAt: 2_001,
          reasonCode: 'ability.pending.commit',
        },
        authorization: { kind: 'system', id: null },
      })
      if (result.saga.status === 'committed') committed += 1
    }
    const elapsedMs = performance.now() - startedAt

    expect(committed).toBe(BUDGETS.pendingResumeIterations)
    expect(elapsedMs).toBeLessThan(BUDGETS.pendingResumeMilliseconds)
  })
})
