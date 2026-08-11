import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseExecuteCapabilityActionCommand } from '../../shared/capabilityAutomation/clientCommands'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import {
  BREEDING_LEGACY_AUTHORITY_RETIREMENT_DEFINITION_SHA256,
  BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1,
} from '../../scripts/breedingLegacyAuthorityRetirement'
import {
  CAPABILITY_CAMPAIGN_AGGREGATE_DELEGATION_MESSAGE,
  CAPABILITY_CAMPAIGN_AGGREGATE_DELEGATIONS,
} from '../../server/domain/capabilityAutomation/campaignAggregateDelegation'
import { buildCapabilityClientCapabilityBundle } from '../../server/domain/capabilityAutomation/clientCapabilities'
import { executeCapabilityMechanic } from '../../server/domain/capabilityAutomation/executeMechanic'
import { openRotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { executeCapabilityActionUseCase } from '../../server/useCases/executeCapabilityAction'
import { CAPABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/capabilityAutomation/registry'
import {
  CapabilitySelectionValidationError,
  validateCapabilityActionSelections,
} from '../../server/domain/capabilityAutomation/validateSelections'
import type { CharacterSheet } from '../../src/types/characterSheet'
import type { TabletopMap } from '../../src/types/map'

const ROOT = resolve(import.meta.dirname, '../..')
const source = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8')
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')

const warmer: CharacterSheet = {
  slug: 'pokemon-warmer',
  nickname: 'Warmer',
  species: 'Ponyta',
  level: 20,
  capabilities: { other: ['Egg Warmer'] },
}
const placement = {
  id: 'warmer-placement',
  sheetKind: 'pokemon' as const,
  sheetSlug: warmer.slug,
  position: { x: 1, y: 0, z: 1 },
}
const legacyMap = (): TabletopMap => ({
  schemaVersion: 2,
  id: 'legacy-egg-map',
  slug: 'legacy-egg-map',
  name: 'Legacy Egg Map',
  revision: 4,
  updatedAt: 100,
  dimensions: { x: 4, y: 3, z: 4 },
  groundLevelY: 0,
  voxels: [],
  placements: [placement],
  metadata: {
    capabilityEggs: [{ id: 'legacy-egg', hatchHours: 12 }],
    hatchHours: 12,
  },
} as TabletopMap)

const action = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require('Egg Warmer').spec.actions
  .find(candidate => candidate.actionId === 'warm-egg')!
const command = parseExecuteCapabilityActionCommand({
  schemaVersion: 1,
  operationId: 'operation-retired-warm-egg',
  mapSlug: 'legacy-egg-map',
  baseRevision: 4,
  offerId: 'forged-retired-offer',
  actorPlacementId: placement.id,
  capabilityInstanceId: 'capability:pokemon-warmer:Egg_Warmer:base',
  canonicalId: 'Egg Warmer',
  actionId: 'warm-egg',
  selections: {
    targetPlacementIds: [],
    cells: [],
    optionId: null,
    recipientTrainerSlug: null,
    canonicalItemId: 'legacy-egg',
    description: null,
    gmConfirmed: false,
  },
})

describe('BR-089 legacy Breeding authority retirement', () => {
  it('pins the closed retirement policy and all owning evidence paths', () => {
    expect(hash(BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1))
      .toBe(BREEDING_LEGACY_AUTHORITY_RETIREMENT_DEFINITION_SHA256)
    expect(BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1).toMatchObject({
      schemaVersion: 1,
      ticket: 'BR-089',
      mapEggAuthority: {
        status: 'retired',
        replacementOperation: 'apply-egg-warmer-capability',
        productContext: 'breeding-workshop',
      },
      sheetCompatibility: {
        status: 'read-only-projection',
        fields: ['eggMoves', 'inheritedMoves', 'inheritedRemaining'],
      },
      incompleteWizardSelection: {
        status: 'ephemeral-parent-preview-padding',
        persistenceAuthority: 'none',
        childCreationAuthority: 'none',
      },
      childCreation: {
        status: 'single-complete-atomic-writer',
        placeholderWrite: 'forbidden',
      },
    })
    for (const path of [
      ...BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.mapEggAuthority.scannedRuntimePaths,
      BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.mapEggAuthority.quarantineOnlyPath,
      BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.mapEggAuthority.replacementOwner,
      BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.sheetCompatibility.saveAdapter,
      BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.sheetCompatibility.setupSaveOwner,
      ...BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.sheetCompatibility.dedicatedWriters,
      ...BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.sheetCompatibility.uiPaths,
      BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.incompleteWizardSelection.owner,
      BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.childCreation.hatchOwner,
      BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.childCreation.completeDocumentBuilder,
      BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.childCreation.initializedRepository,
      BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.verification.acceptanceTest,
      BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.verification.saveAndConcurrencyTest,
      BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.verification.adapterTest,
      BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.verification.componentTest,
    ]) expect(() => source(path), path).not.toThrow()
  })

  it('keeps legacy map Egg keys quarantine-only with no production reader or writer', () => {
    for (const path of BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.mapEggAuthority.scannedRuntimePaths) {
      const runtime = source(path)
      for (const key of BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.mapEggAuthority.forbiddenRuntimeKeys) {
        expect(runtime, `${path} must not mention ${key}`).not.toContain(key)
      }
    }
    const quarantine = source(BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.mapEggAuthority.quarantineOnlyPath)
    expect(quarantine).toContain('$.metadata.capabilityEggs')
    expect(quarantine).toContain('$.metadata.hatchHours')
    expect(quarantine).toContain('legacy-map-quarantine')
  })

  it('projects Egg Warmer as a fact but never as a map-scoped action, even with legacy metadata', () => {
    expect(CAPABILITY_CAMPAIGN_AGGREGATE_DELEGATIONS).toEqual([
      expect.objectContaining({ canonicalId: 'Egg Warmer', actionId: 'warm-egg', owner: 'breeding.v1' }),
    ])
    const bundle = buildCapabilityClientCapabilityBundle({
      role: 'gm',
      map: legacyMap(),
      mapRevision: 4,
      pokemonSheets: [warmer],
      trainerSheets: [],
      now: 100,
    })
    expect(bundle.placements[0]?.facts.some(fact => fact.canonicalId === 'Egg Warmer')).toBe(true)
    expect(bundle.placements[0]?.offers.some(offer => offer.actionId === 'warm-egg')).toBe(false)
  })

  it('rejects direct selection and mechanic calls before reading metadata or drawing a roll', () => {
    const map = legacyMap()
    expect(() => validateCapabilityActionSelections({
      map,
      actor: placement,
      actorSheet: warmer,
      pokemonSheets: new Map([[warmer.slug, warmer]]),
      trainerSheets: new Map(),
      command,
      action,
      now: 100,
    })).toThrow(CapabilitySelectionValidationError)
    expect(() => validateCapabilityActionSelections({
      map,
      actor: placement,
      actorSheet: warmer,
      pokemonSheets: new Map([[warmer.slug, warmer]]),
      trainerSheets: new Map(),
      command,
      action,
      now: 100,
    })).toThrow(CAPABILITY_CAMPAIGN_AGGREGATE_DELEGATION_MESSAGE)

    let rollCalls = 0
    expect(() => executeCapabilityMechanic({
      map,
      actorPlacement: placement,
      actorSheet: warmer,
      pokemonSheets: new Map([[warmer.slug, warmer]]),
      trainerSheets: new Map(),
      linkedTrainerSlugs: new Set(),
      command,
      action,
      now: 100,
      rollDie: () => {
        rollCalls += 1
        throw new Error('retired map action attempted to roll')
      },
    })).toThrow(CAPABILITY_CAMPAIGN_AGGREGATE_DELEGATION_MESSAGE)
    expect(rollCalls).toBe(0)
    expect(map).toEqual(legacyMap())
  })

  it('rejects the retired action at the use-case boundary before operation replay', () => {
    const database = openRotomDatabase({ path: ':memory:' })
    try {
      const mapRepository = createSqliteMapRepository<TabletopMap>(database)
      mapRepository.saveSetupMap(legacyMap())
      const persistedBefore = mapRepository.getBySlug('legacy-egg-map')
      let operationLookups = 0
      expect(() => executeCapabilityActionUseCase({ role: 'gm', command }, {
        database,
        mapRepository,
        operationRepository: {
          find: () => {
            operationLookups += 1
            throw new Error('retired operation replay was consulted')
          },
          insert: () => { throw new Error('retired operation was inserted') },
        },
        randomInt: () => { throw new Error('retired use case attempted to roll') },
        publishPersistedRealtimeEvent: () => {},
      })).toThrow(CAPABILITY_CAMPAIGN_AGGREGATE_DELEGATION_MESSAGE)
      expect(operationLookups).toBe(0)
      expect(mapRepository.getBySlug('legacy-egg-map')).toEqual(persistedBefore)
    }
    finally {
      database.close()
    }
  })

  it('keeps incomplete wizard padding ephemeral and outside child or persistence authority', () => {
    const wizard = source(BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.incompleteWizardSelection.owner)
    for (const identifier of BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.incompleteWizardSelection.identifiers) {
      expect(wizard).toContain(identifier)
    }
    expect(wizard).toContain('const actorParentRefs = (')
    expect(wizard).toContain('selection-incomplete')
    expect(wizard).not.toContain('initializedPokemonSheets.create')
    expect(wizard).not.toContain('createSqliteInitializedPokemonSheetRepository')
    expect(wizard).not.toContain('createSheetUseCase')
    expect(wizard).not.toContain('saveSheetUseCase')
  })

  it('keeps hatch child creation on one complete insert with no blank-create/follow-up-save import', () => {
    const hatch = source(BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.childCreation.hatchOwner)
    const builder = source(BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.childCreation.completeDocumentBuilder)
    const initializedRepository = source(BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.childCreation.initializedRepository)

    expect(hatch).toContain('context.repositories.initializedPokemonSheets.create')
    expect(hatch).not.toContain("from './createSheet'")
    expect(hatch).not.toContain("from './saveSheet'")
    expect(hatch).not.toContain('createSheetUseCase')
    expect(hatch).not.toContain('saveSheetUseCase')
    expect(builder).toContain("placeholderWrite: 'forbidden'")
    expect(initializedRepository).toContain('placeholder/default supplementation is forbidden')
    expect(initializedRepository).toContain('revision: 0')
  })

  it('contains no client-side Egg/inheritance mutation action after retirement', () => {
    const editor = BREEDING_LEGACY_AUTHORITY_RETIREMENT_V1.sheetCompatibility.uiPaths
      .map(path => source(path)).join('\n')
    for (const retiredWriter of [
      'addEggMove',
      'removeEggMove',
      'setInheritedMove',
      "v-model=\"sheet.inheritedRemaining\"",
      "@update:model-value=\"(v) => emit('setInheritedMove'",
    ]) expect(editor).not.toContain(retiredWriter)
    expect(editor).toContain('Egg Move Compatibility')
    expect(editor).toContain('Inheritance Checkpoints')
    expect(editor).toContain("'100'")
  })
})
