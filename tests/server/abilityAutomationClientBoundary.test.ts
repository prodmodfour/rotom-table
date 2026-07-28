import { afterEach, describe, expect, it } from 'vitest'
import type { AbilityAutomationRuntimeRegistry, AbilitySpecV1Runtime } from '../../server/domain/abilityAutomation/registry'
import { ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY } from '../../server/domain/abilityAutomation/sharedKernelExtensions'
import { REGISTERED_ABILITY_HANDLER_REGISTRY } from '../../server/domain/abilityAutomation/handlers/registry'
import { validateAbilitySpec } from '../../server/domain/abilityAutomation/validateSpec'
import { buildAbilityClientCapabilityBundle } from '../../server/domain/abilityAutomation/clientCapabilities'
import { beginAbilityDeclarationUseCase } from '../../server/useCases/beginAbilityDeclaration'
import { resolveAbilityDeclarationUseCase } from '../../server/useCases/resolveAbilityDeclaration'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteRealtimeEventRepository } from '../../server/storage/realtimeEventRepository'
import { ABILITY_AUTOMATION_REALTIME_EVENT_TYPE } from '#shared/abilityAutomation/realtime'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'

const spec = {
  schemaVersion: 1,
  canonicalId: 'Abominable',
  version: 1,
  modes: [{ id: 'activate', kind: 'activated' }],
  subscriptions: [],
  targeting: [{
    id: 'no-target', modeId: 'activate', kind: 'none', minSelections: 0, maxSelections: 0,
    selector: null, predicate: null,
  }],
  preconditions: [], costs: [], phases: [{
    modeId: 'activate',
    phase: 'effect',
    operations: [{
      kind: 'shared-effect',
      operation: {
        id: 'operation.raise-attack',
        kind: 'combat-stage',
        source: { kind: 'ability', id: 'ability.abominable' },
        recipients: { kind: 'actor' },
        reasonCode: 'ability.abominable.raise-attack',
        payload: {
          action: 'modify', stage: 'atk', selectedStage: null, value: 1,
          stageSource: null, rounding: null,
        },
      },
    }],
  }], registeredHandlerId: null,
  presentation: { displayName: 'Abominable', summaryKey: 'ability.abominable.summary', vfxKey: null, tags: ['activated'] },
}
const definition = validateAbilitySpec(spec)
const runtime: AbilitySpecV1Runtime = {
  canonicalId: 'Abominable', kind: 'abilityspec-v1', version: 1,
  definitionHash: definition.definitionHash,
  sourceModule: 'server/domain/abilityAutomation/specs/abominable.ts', definition,
}
const registry: AbilityAutomationRuntimeRegistry = {
  size: 1,
  extensionRegistry: ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY,
  handlerRegistry: REGISTERED_ABILITY_HANDLER_REGISTRY,
  resolve: id => id === 'Abominable' ? runtime : null,
  entries: () => [runtime],
}
const map = (): TabletopMap => ({
  schemaVersion: 2, slug: 'arena-map', name: 'Arena', revision: 5,
  dimensions: { x: 6, y: 2, z: 6 }, voxels: [], playerVisible: true,
  placements: [{
    id: 'actor', sheetKind: 'pokemon', sheetSlug: 'actor-sheet',
    position: { x: 0, y: 0, z: 0 },
  }],
})
const sheet = (): CharacterSheet => ({
  slug: 'actor-sheet', nickname: 'Actor', species: 'Pikachu', level: 5,
  revision: 3, abilities: [{
    name: 'Abominable',
    automation: {
      schemaVersion: 1,
      instanceId: 'base:actor:0',
      canonicalId: 'Abominable',
      definitionVersion: null,
      selections: [],
    },
  }],
} as CharacterSheet)
const command = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  requestId: 'request:one',
  mapSlug: 'arena-map',
  baseRevision: 5,
  actorPlacementId: 'actor',
  abilityInstanceId: 'base:actor:0',
  canonicalId: 'Abominable',
  modeId: 'activate',
  ...overrides,
})
let databases: RotomDatabase[] = []
const setup = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const mapRepository = createSqliteMapRepository(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  mapRepository.saveSetupMap(map())
  sheetRepository.saveSetupSheet('pokemon', 'actor-sheet', sheet() as unknown as Record<string, unknown>)
  const dependencies = { database, mapRepository, sheetRepository, registry, now: () => 1_000 }
  return { database, mapRepository, sheetRepository, dependencies }
}
afterEach(() => databases.splice(0).forEach(database => database.close()))

describe('native ability UI/command boundary', () => {
  it('maps malformed declaration and resolution wire values to bounded client errors', () => {
    for (const [invoke, message] of [
      [() => beginAbilityDeclarationUseCase({ role: 'gm', command: undefined }), 'Invalid Ability declaration command.'],
      [() => resolveAbilityDeclarationUseCase({ role: 'gm', intent: undefined }), 'Invalid Ability declaration intent.'],
    ] as const) {
      let thrown: unknown
      try { invoke() }
      catch (error) { thrown = error }
      expect(thrown).toMatchObject({ statusCode: 400, statusMessage: message })
    }
  })

  it('projects only controlled manifest-selected capabilities into the live snapshot', () => {
    const manifest = {
      schemaVersion: 1,
      abilities: [{
        canonicalId: 'Abominable', displayName: 'Abominable', baseStatus: 'complete',
        interactionStatus: 'unassessed',
        runtime: { kind: 'abilityspec-v1', version: 1, definitionHash: definition.definitionHash, sourceModule: runtime.sourceModule },
        rulesProvenance: definition.rulesetVersion,
        capabilityTags: [], suggestedCapabilityTags: [], blockerCodes: [], limitations: [], manualSteps: [],
        scenarioIds: [], conformanceEvidence: { requirementTags: [], scenarios: [], notApplicable: [] },
        reviewedAt: '2026-07-09', unsupportedInteractionIds: [], rolloutCohortId: 'aa-060',
      }],
    } as const
    const gm = buildAbilityClientCapabilityBundle({
      role: 'gm', map: map(), mapRevision: 5,
      pokemonSheets: [sheet()], trainerSheets: [],
    }, { manifest, registry })
    expect(gm.placements).toEqual([{
      placementId: 'actor',
      abilities: [expect.objectContaining({
        instanceId: 'base:actor:0', canonicalId: 'Abominable', status: 'ready',
        modes: [expect.objectContaining({ modeId: 'activate', invocable: true })],
      })],
    }])
    const unauthorized = buildAbilityClientCapabilityBundle({
      role: 'player', playerProfile: null, map: map(), mapRevision: 5,
      pokemonSheets: [sheet()], trainerSheets: [],
    }, { manifest, registry })
    expect(unauthorized.placements).toEqual([])
  })

  it('issues a hash-bound private offer and replays an exact request', () => {
    const { dependencies } = setup()
    const first = beginAbilityDeclarationUseCase({ role: 'gm', command: command() }, dependencies)
    const retry = beginAbilityDeclarationUseCase({ role: 'gm', command: command() }, dependencies)
    expect(first).toEqual(retry)
    expect(first).toMatchObject({
      mapSlug: 'arena-map', mapRevision: 5, actorPlacementId: 'actor',
      abilityInstanceId: 'base:actor:0', canonicalId: 'Abominable', modeId: 'activate',
      declarations: [{ declarationId: 'no-target', kind: 'none', options: [] }],
    })
    expect(first.offerSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(() => beginAbilityDeclarationUseCase({
      role: 'gm', command: command({ canonicalId: 'Accelerate' }),
    }, dependencies)).toThrow(/reused with changed input/)
  })

  it('commits and durably replays the exact intent without a second revision', () => {
    const { dependencies, mapRepository, database } = setup()
    const published: unknown[] = []
    const realtimeDependencies = {
      ...dependencies,
      publishPersistedRealtimeEvent: (event: unknown) => { published.push(event) },
    }
    const offer = beginAbilityDeclarationUseCase({ role: 'gm', command: command() }, dependencies)
    const intent = {
      schemaVersion: 1,
      intentId: 'intent:one',
      offerId: offer.offerId,
      offerSha256: offer.offerSha256,
      mapSlug: offer.mapSlug,
      baseRevision: offer.mapRevision,
      actorPlacementId: offer.actorPlacementId,
      abilityInstanceId: offer.abilityInstanceId,
      canonicalId: offer.canonicalId,
      modeId: offer.modeId,
      selections: [{ declarationId: 'no-target', kind: 'none', optionIds: [] }],
    }
    const first = resolveAbilityDeclarationUseCase({ role: 'gm', intent }, realtimeDependencies)
    expect(first).toMatchObject({
      kind: 'accepted', operationId: 'intent:one', previousRevision: 5, revision: 6,
      presentation: { outcome: 'applied' },
    })
    expect(mapRepository.getBySlug('arena-map')?.revision).toBe(6)
    const retry = resolveAbilityDeclarationUseCase({ role: 'gm', intent }, realtimeDependencies)
    expect(retry).toEqual(first)
    expect(mapRepository.getBySlug('arena-map')?.revision).toBe(6)

    const realtime = createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0 })
    expect(realtime.events).toHaveLength(1)
    expect(realtime.events[0]).toMatchObject({
      access: { kind: 'map-access', mapSlug: 'arena-map' },
      event: {
        channel: 'map:arena-map',
        type: ABILITY_AUTOMATION_REALTIME_EVENT_TYPE,
        revision: 6,
        data: {
          schemaVersion: 1,
          mapSlug: 'arena-map',
          previousRevision: 5,
          revision: 6,
          status: 'committed',
        },
      },
    })
    expect(JSON.stringify(realtime.events[0])).not.toContain('Abominable')
    expect(published).toHaveLength(1)
  })

  it('rejects inactive identities, stale capabilities, and unauthorized players before offering mechanics', () => {
    const { dependencies } = setup()
    expect(() => beginAbilityDeclarationUseCase({
      role: 'gm', command: command({ abilityInstanceId: 'base:actor:99' }),
    }, dependencies)).toThrow(/not currently effective/)
    expect(() => beginAbilityDeclarationUseCase({
      role: 'gm', command: command({ requestId: 'request:stale', baseRevision: 4 }),
    }, dependencies)).toThrow(/stale/)
    expect(() => beginAbilityDeclarationUseCase({
      role: 'player', playerProfile: null, command: command({ requestId: 'request:player' }),
    }, dependencies)).toThrow(/not controlled/)
  })
})
