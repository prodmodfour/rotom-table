import manifestJson from '../../../data/ability-automation/manifest.json'
import {
  validateAbilityAutomationRuntimeRegistrations,
  type AbilityAutomationManifest,
  type AbilityAutomationRuntimeRegistrationReference,
} from '#shared/abilityAutomation/manifest'
import {
  EMPTY_ABILITY_SPEC_EXTENSION_REGISTRY,
  type AbilitySpecExtensionRegistry,
} from './extensionRegistry'
import {
  selectNativeAbilityRuntime,
  type NativeAbilityRuntimeRegistration,
} from './runtimeSelection'
import {
  validateAbilitySpec,
  type AbilitySpecHandlerReferenceRegistry,
  type ValidatedAbilitySpecDefinition,
} from './validateSpec'

export interface AbilitySpecV1Registration {
  readonly canonicalId: string
  readonly sourceModule: string
  readonly spec: unknown
}

export interface AbilitySpecV1Runtime
  extends NativeAbilityRuntimeRegistration<ValidatedAbilitySpecDefinition>,
    AbilityAutomationRuntimeRegistrationReference {
  readonly kind: 'abilityspec-v1'
}

export interface AbilityAutomationRuntimeRegistry {
  readonly size: number
  readonly extensionRegistry: AbilitySpecExtensionRegistry
  /** Resolve only an exact manifest-selected native runtime. */
  readonly resolve: (canonicalId: string) => AbilitySpecV1Runtime | null
  readonly entries: () => readonly AbilitySpecV1Runtime[]
}

export type AbilityAutomationRuntimeRegistryValidationCode =
  | 'duplicate-id'
  | 'canonical-id-mismatch'
  | 'unknown-canonical-id'
  | 'manifest-selection-inconsistent'

export class AbilityAutomationRuntimeRegistryValidationError extends Error {
  readonly code: AbilityAutomationRuntimeRegistryValidationCode
  readonly canonicalId: string

  constructor(
    code: AbilityAutomationRuntimeRegistryValidationCode,
    canonicalId: string,
    detail: string,
  ) {
    super(detail)
    this.name = 'AbilityAutomationRuntimeRegistryValidationError'
    this.code = code
    this.canonicalId = canonicalId
  }
}

export interface CreateAbilityAutomationRuntimeRegistryOptions {
  readonly manifest: AbilityAutomationManifest
  readonly abilitySpecs?: readonly AbilitySpecV1Registration[]
  readonly extensionRegistry?: AbilitySpecExtensionRegistry
  readonly handlerRegistry?: AbilitySpecHandlerReferenceRegistry
}

const fail = (
  code: AbilityAutomationRuntimeRegistryValidationCode,
  canonicalId: string,
  detail: string,
): never => {
  throw new AbilityAutomationRuntimeRegistryValidationError(code, canonicalId, detail)
}

const registrationReference = (
  runtime: AbilitySpecV1Runtime,
): AbilityAutomationRuntimeRegistrationReference => ({
  canonicalId: runtime.canonicalId,
  kind: runtime.kind,
  version: runtime.version,
  definitionHash: runtime.definitionHash,
  sourceModule: runtime.sourceModule,
})

const validateManifestSelectionModes = (manifest: AbilityAutomationManifest): void => {
  for (const record of manifest.abilities) {
    const selected = record.runtime.kind === 'abilityspec-v1'
    if (selected !== (record.baseStatus === 'complete')) {
      fail(
        'manifest-selection-inconsistent',
        record.canonicalId,
        `${record.canonicalId} must select AbilitySpec v1 exactly when base status is complete.`,
      )
    }
  }
}

/** Build a duplicate-safe registry and expose only exact manifest selections. */
export const createAbilityAutomationRuntimeRegistry = (
  options: CreateAbilityAutomationRuntimeRegistryOptions,
): AbilityAutomationRuntimeRegistry => {
  validateManifestSelectionModes(options.manifest)
  const extensionRegistry = options.extensionRegistry ?? EMPTY_ABILITY_SPEC_EXTENSION_REGISTRY
  const manifestByCanonicalId = new Map(
    options.manifest.abilities.map(record => [record.canonicalId, record]),
  )
  const seen = new Set<string>()
  const runtimes = (options.abilitySpecs ?? []).map((registration): AbilitySpecV1Runtime => {
    if (seen.has(registration.canonicalId)) {
      return fail(
        'duplicate-id',
        registration.canonicalId,
        `AbilitySpec v1 is registered more than once for ${registration.canonicalId}.`,
      )
    }
    seen.add(registration.canonicalId)
    const manifestRecord = manifestByCanonicalId.get(registration.canonicalId)
    if (!manifestRecord) {
      return fail(
        'unknown-canonical-id',
        registration.canonicalId,
        `${registration.canonicalId} has no semantic manifest row.`,
      )
    }
    const definition = validateAbilitySpec(registration.spec, {
      capabilityIds: manifestRecord.capabilityTags,
      rulesetVersion: manifestRecord.rulesProvenance,
      extensionRegistry,
      ...(options.handlerRegistry ? { handlerRegistry: options.handlerRegistry } : {}),
    })
    if (definition.spec.canonicalId !== registration.canonicalId) {
      return fail(
        'canonical-id-mismatch',
        registration.canonicalId,
        `Registration ${registration.canonicalId} does not match spec ${definition.spec.canonicalId}.`,
      )
    }
    return Object.freeze({
      canonicalId: registration.canonicalId,
      kind: 'abilityspec-v1',
      version: definition.spec.version,
      definitionHash: definition.definitionHash,
      sourceModule: registration.sourceModule,
      definition,
    })
  })

  validateAbilityAutomationRuntimeRegistrations(
    options.manifest,
    runtimes.map(registrationReference),
  )

  const runtimeByCanonicalId = new Map(runtimes.map(runtime => [runtime.canonicalId, runtime]))
  const selected = new Map<string, AbilitySpecV1Runtime>()
  for (const record of options.manifest.abilities) {
    const selection = selectNativeAbilityRuntime(
      record,
      runtimeByCanonicalId.get(record.canonicalId),
    )
    if (selection.kind === 'native') selected.set(record.canonicalId, selection.registration)
  }

  return Object.freeze({
    size: selected.size,
    extensionRegistry,
    resolve: (canonicalId: string) => selected.get(canonicalId) ?? null,
    entries: () => Object.freeze([...selected.values()]),
  })
}

/** Native definitions are added only with reviewed matching manifest metadata. */
export const REVIEWED_ABILITY_SPEC_V1_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze([])

export const ABILITY_AUTOMATION_RUNTIME_REGISTRY = createAbilityAutomationRuntimeRegistry({
  manifest: manifestJson as unknown as AbilityAutomationManifest,
  abilitySpecs: REVIEWED_ABILITY_SPEC_V1_REGISTRATIONS,
})

/** Clients identify only a canonical ability; runtime metadata remains server-owned. */
export const registeredAbilityAutomationRuntimeFor = (
  canonicalId: string,
): AbilitySpecV1Runtime | null => ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(canonicalId)
