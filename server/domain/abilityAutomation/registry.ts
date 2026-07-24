import manifestJson from '../../../data/ability-automation/manifest.json'
import {
  validateAbilityAutomationRuntimeRegistrations,
  type AbilityAutomationManifest,
  type AbilityAutomationRuntimeRegistrationReference,
} from '#shared/abilityAutomation/manifest'
import type { AbilitySpecExtensionRegistry } from './extensionRegistry'
import { ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY } from './sharedKernelExtensions'
import { REGISTERED_ABILITY_HANDLER_REGISTRY } from './handlers/registry'
import {
  selectNativeAbilityRuntime,
  type NativeAbilityRuntimeRegistration,
} from './runtimeSelection'
import {
  validateAbilitySpec,
  type AbilitySpecHandlerReferenceRegistry,
  type ValidatedAbilitySpecDefinition,
} from './validateSpec'
import { AA060_ABILITY_SPEC_REGISTRATIONS } from './specs/aa060'
import { AA061_ABILITY_SPEC_REGISTRATIONS } from './specs/aa061'
import { AA062_ABILITY_SPEC_REGISTRATIONS } from './specs/aa062'
import { AA063_ABILITY_SPEC_REGISTRATIONS } from './specs/aa063'
import { AA064_ABILITY_SPEC_REGISTRATIONS } from './specs/aa064'
import { AA065_ABILITY_SPEC_REGISTRATIONS } from './specs/aa065'
import { AA066_ABILITY_SPEC_REGISTRATIONS } from './specs/aa066'
import { AA067_ABILITY_SPEC_REGISTRATIONS } from './specs/aa067'
import { AA068_ABILITY_SPEC_REGISTRATIONS } from './specs/aa068'
import { AA069_ABILITY_SPEC_REGISTRATIONS } from './specs/aa069'
import { AA070_ABILITY_SPEC_REGISTRATIONS } from './specs/aa070'
import { AA071_ABILITY_SPEC_REGISTRATIONS } from './specs/aa071'
import { AA072_ABILITY_SPEC_REGISTRATIONS } from './specs/aa072'

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
  readonly handlerRegistry: AbilitySpecHandlerReferenceRegistry
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
  const extensionRegistry = options.extensionRegistry ?? ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY
  const handlerRegistry = options.handlerRegistry ?? REGISTERED_ABILITY_HANDLER_REGISTRY
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
      handlerRegistry,
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
    handlerRegistry,
    resolve: (canonicalId: string) => selected.get(canonicalId) ?? null,
    entries: () => Object.freeze([...selected.values()]),
  })
}

/** Native definitions are added only with reviewed matching manifest metadata. */
export const REVIEWED_ABILITY_SPEC_V1_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze([
  ...AA060_ABILITY_SPEC_REGISTRATIONS,
  ...AA061_ABILITY_SPEC_REGISTRATIONS,
  ...AA062_ABILITY_SPEC_REGISTRATIONS,
  ...AA063_ABILITY_SPEC_REGISTRATIONS,
  ...AA064_ABILITY_SPEC_REGISTRATIONS,
  ...AA065_ABILITY_SPEC_REGISTRATIONS,
  ...AA066_ABILITY_SPEC_REGISTRATIONS,
  ...AA067_ABILITY_SPEC_REGISTRATIONS,
  ...AA068_ABILITY_SPEC_REGISTRATIONS,
  ...AA069_ABILITY_SPEC_REGISTRATIONS,
  ...AA070_ABILITY_SPEC_REGISTRATIONS,
  ...AA071_ABILITY_SPEC_REGISTRATIONS,
  ...AA072_ABILITY_SPEC_REGISTRATIONS,
])

export const ABILITY_AUTOMATION_RUNTIME_REGISTRY = createAbilityAutomationRuntimeRegistry({
  manifest: manifestJson as unknown as AbilityAutomationManifest,
  abilitySpecs: REVIEWED_ABILITY_SPEC_V1_REGISTRATIONS,
})

/** Clients identify only a canonical ability; runtime metadata remains server-owned. */
export const registeredAbilityAutomationRuntimeFor = (
  canonicalId: string,
): AbilitySpecV1Runtime | null => ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(canonicalId)
