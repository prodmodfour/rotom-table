import { describe, expect, it } from 'vitest'
import type {
  AbilityAutomationManifest,
  AbilityAutomationManifestRecord,
} from '#shared/abilityAutomation/manifest'
import {
  AbilityAutomationManifestValidationError,
} from '#shared/abilityAutomation/manifest'
import {
  createAbilitySpecExtensionRegistry,
} from '../../server/domain/abilityAutomation/extensionRegistry'
import {
  ABILITY_AUTOMATION_RUNTIME_REGISTRY,
  AbilityAutomationRuntimeRegistryValidationError,
  createAbilityAutomationRuntimeRegistry,
  registeredAbilityAutomationRuntimeFor,
  type AbilitySpecV1Registration,
} from '../../server/domain/abilityAutomation/registry'
import {
  DEFAULT_ABILITY_SPEC_RULESET_VERSION,
  validateAbilitySpec,
} from '../../server/domain/abilityAutomation/validateSpec'

const SOURCE_MODULE = 'server/domain/abilityAutomation/specs/healer.ts'

const extensionRegistry = createAbilitySpecExtensionRegistry([{
  family: 'operation',
  kind: 'marker',
  version: 1,
  parse: (value) => {
    if (Object.keys(value).sort().join(',') !== 'id,kind') throw new Error('invalid marker')
    return value
  },
}])

const spec = (canonicalId = 'Healer') => ({
  schemaVersion: 1,
  canonicalId,
  version: 1,
  modes: [{ id: 'mode-activated', kind: 'activated' }],
  subscriptions: [],
  targeting: [{
    id: 'target-self',
    modeId: 'mode-activated',
    kind: 'self',
    minSelections: 0,
    maxSelections: 0,
    selector: null,
    predicate: null,
  }],
  preconditions: [],
  costs: [],
  phases: [{
    modeId: 'mode-activated',
    phase: 'effect',
    operations: [{ kind: 'marker', id: 'operation-heal' }],
  }],
  registeredHandlerId: null,
  presentation: {
    displayName: canonicalId,
    summaryKey: `ability.${canonicalId.toLowerCase()}.summary`,
    vfxKey: null,
    tags: ['activated'],
  },
})

const baseRecord = (canonicalId: string): AbilityAutomationManifestRecord => ({
  canonicalId,
  displayName: canonicalId,
  baseStatus: 'blocked',
  interactionStatus: 'unassessed',
  runtime: {
    kind: 'unimplemented',
    version: null,
    definitionHash: null,
    sourceModule: null,
  },
  rulesProvenance: DEFAULT_ABILITY_SPEC_RULESET_VERSION,
  capabilityTags: [],
  suggestedCapabilityTags: [],
  blockerCodes: ['runtime.abilityspec-v1'],
  limitations: [],
  manualSteps: [],
  scenarioIds: [],
  conformanceEvidence: {
    requirementTags: [],
    scenarios: [],
    notApplicable: [],
  },
  reviewedAt: null,
  unsupportedInteractionIds: [],
  rolloutCohortId: 'aa-063',
})

const completeRecord = (
  canonicalId = 'Healer',
  overrides: Partial<AbilityAutomationManifestRecord['runtime']> = {},
): AbilityAutomationManifestRecord => {
  const definition = validateAbilitySpec(spec(canonicalId), { extensionRegistry })
  return {
    ...baseRecord(canonicalId),
    baseStatus: 'complete',
    runtime: {
      kind: 'abilityspec-v1',
      version: definition.spec.version,
      definitionHash: definition.definitionHash,
      sourceModule: SOURCE_MODULE,
      ...overrides,
    },
    blockerCodes: [],
    reviewedAt: '2026-07-09',
  }
}

const manifest = (...abilities: AbilityAutomationManifestRecord[]): AbilityAutomationManifest => ({
  schemaVersion: 1,
  abilities,
})

const registration = (
  canonicalId = 'Healer',
  registeredSpec: unknown = spec(canonicalId),
): AbilitySpecV1Registration => ({
  canonicalId,
  sourceModule: SOURCE_MODULE,
  spec: registeredSpec,
})

describe('ability automation production runtime registry', () => {
  it('selects only the exact version, hash, and source named by a complete manifest row', () => {
    const registry = createAbilityAutomationRuntimeRegistry({
      manifest: manifest(completeRecord()),
      abilitySpecs: [registration()],
      extensionRegistry,
    })
    const runtime = registry.resolve('Healer')

    expect(registry.size).toBe(1)
    expect(runtime).toMatchObject({
      canonicalId: 'Healer',
      kind: 'abilityspec-v1',
      version: 1,
      sourceModule: SOURCE_MODULE,
    })
    expect(runtime?.definitionHash).toBe(runtime?.definition.definitionHash)
    expect(registry.entries()).toEqual([runtime])
    expect(registry.resolve('Moxie')).toBeNull()
  })

  it('does not promote an unimplemented row merely because code is registered', () => {
    const registry = createAbilityAutomationRuntimeRegistry({
      manifest: manifest(baseRecord('Healer')),
      abilitySpecs: [registration()],
      extensionRegistry,
    })

    expect(registry.size).toBe(0)
    expect(registry.resolve('Healer')).toBeNull()
    expect(registry.entries()).toEqual([])
  })

  it('rejects duplicate, unknown, and canonical-ID-mismatched registrations', () => {
    expect(() => createAbilityAutomationRuntimeRegistry({
      manifest: manifest(baseRecord('Healer')),
      abilitySpecs: [registration(), registration()],
      extensionRegistry,
    })).toThrowError(expect.objectContaining({
      name: 'AbilityAutomationRuntimeRegistryValidationError',
      code: 'duplicate-id',
      canonicalId: 'Healer',
    }))

    expect(() => createAbilityAutomationRuntimeRegistry({
      manifest: manifest(baseRecord('Moxie')),
      abilitySpecs: [registration()],
      extensionRegistry,
    })).toThrowError(expect.objectContaining({
      code: 'unknown-canonical-id',
      canonicalId: 'Healer',
    }))

    expect(() => createAbilityAutomationRuntimeRegistry({
      manifest: manifest(baseRecord('Healer')),
      abilitySpecs: [registration('Healer', spec('Moxie'))],
      extensionRegistry,
    })).toThrowError(expect.objectContaining({
      code: 'canonical-id-mismatch',
      canonicalId: 'Healer',
    }))
  })

  it('rejects missing or mismatched manifest-selected registrations', () => {
    expect(() => createAbilityAutomationRuntimeRegistry({
      manifest: manifest(completeRecord()),
      abilitySpecs: [],
      extensionRegistry,
    })).toThrowError(expect.objectContaining({
      name: 'AbilityAutomationManifestValidationError',
      code: 'missing-runtime-registration',
    }))

    expect(() => createAbilityAutomationRuntimeRegistry({
      manifest: manifest(completeRecord('Healer', { definitionHash: 'a'.repeat(64) })),
      abilitySpecs: [registration()],
      extensionRegistry,
    })).toThrowError(expect.objectContaining({
      code: 'runtime-registration-mismatch',
    }))

    expect(() => createAbilityAutomationRuntimeRegistry({
      manifest: manifest(completeRecord('Healer', { sourceModule: 'server/wrong.ts' })),
      abilitySpecs: [registration()],
      extensionRegistry,
    })).toThrowError(AbilityAutomationManifestValidationError)
  })

  it('rejects inconsistent status/runtime combinations even for typed migration inputs', () => {
    const inconsistent = {
      ...baseRecord('Healer'),
      runtime: completeRecord().runtime,
    }
    expect(() => createAbilityAutomationRuntimeRegistry({
      manifest: manifest(inconsistent),
      abilitySpecs: [registration()],
      extensionRegistry,
    })).toThrowError(expect.objectContaining({
      name: 'AbilityAutomationRuntimeRegistryValidationError',
      code: 'manifest-selection-inconsistent',
    }))
  })

  it('ships only exact evidence-backed production selections', () => {
    expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.size).toBe(156)
    expect(ABILITY_AUTOMATION_RUNTIME_REGISTRY.entries().map(runtime => runtime.canonicalId))
      .toEqual([
        'Abominable', 'Absorb Force', 'Accelerate', 'Adaptability', 'Aerilate', 'Aftermath',
        'Air Lock', 'Ambush', 'Analytic', 'Anchored', 'Anger Point', 'Anticipation',
        'Aqua Boost', 'Aqua Bullet', 'Arena Trap', 'Aroma Veil', 'Aura Break', 'Aura Storm',
        'Bad Dreams', 'Ball Fetch', 'Battery', 'Battle Armor', 'Beam Cannon', 'Beast Boost',
        'Beautiful', 'Berry Storage', 'Berserk', 'Big Pecks', 'Big Swallow', 'Blaze',
        'Blessed Touch', 'Blow Away', 'Blur', 'Bodyguard', 'Bone Lord', 'Bone Wielder',
        'Brimstone', 'Bulletproof', 'Bully', 'Cave Crasher', 'Celebrate', 'Chemical Romance',
        'Cherry Power', 'Chilling Neigh', 'Chlorophyll', 'Clay Cannons', 'Clear Body', 'Cloud Nine',
        'Cluster Mind', 'Color Change', 'Color Theory', 'Comatose', 'Combo Striker', 'Competitive',
        'Compound Eyes', 'Confidence', 'Conqueror', 'Contrary', 'Copy Master', 'Corrosion',
        'Corrosive Toxins', 'Cotton Down', 'Courage', 'Covert', 'Cruelty', 'Crush Trap',
        'Cud Chew', 'Curious Medicine', 'Cursed Body', 'Cute Charm', 'Cute Tears', 'Damp',
        'Dancer', 'Danger Syrup', 'Dark Art', 'Dark Aura', 'Dauntless Shield', 'Daze',
        'Dazzling', 'Deadly Poison', 'Decoy', 'Deep Sleep', 'Defeatist', 'Defiant',
        'Defy Death', 'Delayed Reaction', 'Delivery Bird', 'Desert Weather', 'Designer',
        'Diamond Defense', 'Dig Away', 'Dire Spore', 'Discipline', 'Disguise', 'Dodge',
        'Download', 'Dragon’s Maw', 'Dream Smoke', 'Dreamspinner', 'Drizzle', 'Drought',
        'Drown Out', 'Dry Skin', 'Dust Cloud', 'Early Bird', 'Effect Spore', 'Eggscellence',
        'Electric Surge', 'Electrodash', 'Emergency Exit', 'Empower', 'Enduring Rage',
        'Enfeebling Lips', 'Exploit', 'Fabulous Trim', 'Fade Away', 'Fairy Aura',
        'Fashion Designer', 'Fiery Crash', 'Filter', 'Flame Body', 'Flame Tongue',
        'Flare Boost', 'Flash Fire', 'Flavorful Aroma', 'Flower Gift', 'Flower Power',
        'Flower Veil', 'Fluffy', 'Fluffy Charge', 'Flutter', 'Flying Fly Trap',
        'Focus', 'Forecast', 'Forest Lord', 'Forewarn', 'Fox Fire', 'Freezing Point',
        'Friend Guard', 'Frighten', 'Frisk', 'Frostbite', 'Full Guard', 'Full Metal Body',
        'Fur Coat', 'Gale Wings', 'Galvanize', 'Gardener', 'Gentle Vibe', 'Giver',
        'Glisten', 'Gluttony', 'Gooey', 'Gore', 'Gorilla Tactics', 'Grass Pelt',
      ])
    expect(registeredAbilityAutomationRuntimeFor('Adaptability')).toMatchObject({
      kind: 'abilityspec-v1', version: 1,
    })
    expect(registeredAbilityAutomationRuntimeFor('Healer')).toBeNull()
    expect(registeredAbilityAutomationRuntimeFor('Unknown')).toBeNull()
  })

  it('uses typed registry validation errors', () => {
    try {
      createAbilityAutomationRuntimeRegistry({
        manifest: manifest(baseRecord('Healer')),
        abilitySpecs: [registration(), registration()],
        extensionRegistry,
      })
      expect.unreachable('Expected duplicate registration')
    }
    catch (error) {
      expect(error).toBeInstanceOf(AbilityAutomationRuntimeRegistryValidationError)
    }
  })
})
