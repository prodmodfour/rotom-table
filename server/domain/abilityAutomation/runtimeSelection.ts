import type { AbilityAutomationManifestRecord } from '#shared/abilityAutomation/manifest'

export interface NativeAbilityRuntimeRegistration<TDefinition = unknown> {
  readonly canonicalId: string
  readonly kind: 'abilityspec-v1'
  readonly version: number
  readonly definitionHash: string
  readonly sourceModule: string
  readonly definition: TDefinition
}

export type NativeAbilityRuntimeUnavailableReason =
  | 'manifest-base-status-not-complete'
  | 'manifest-runtime-not-native'
  | 'registration-missing'
  | 'registration-canonical-id-mismatch'
  | 'registration-metadata-mismatch'

export type NativeAbilityRuntimeSelection<TDefinition = unknown> =
  | {
      readonly kind: 'native'
      readonly registration: NativeAbilityRuntimeRegistration<TDefinition>
    }
  | {
      readonly kind: 'unavailable'
      readonly reason: NativeAbilityRuntimeUnavailableReason
    }

/**
 * Fail-closed migration selector. Legacy compatibility is deliberately not an
 * input and therefore can never become an implicit production fallback.
 */
export const selectNativeAbilityRuntime = <TDefinition>(
  manifestRow: Pick<AbilityAutomationManifestRecord, 'canonicalId' | 'baseStatus' | 'runtime'>,
  registration: NativeAbilityRuntimeRegistration<TDefinition> | null | undefined,
): NativeAbilityRuntimeSelection<TDefinition> => {
  if (manifestRow.baseStatus !== 'complete') {
    return { kind: 'unavailable', reason: 'manifest-base-status-not-complete' }
  }
  if (manifestRow.runtime.kind !== 'abilityspec-v1') {
    return { kind: 'unavailable', reason: 'manifest-runtime-not-native' }
  }
  if (!registration) {
    return { kind: 'unavailable', reason: 'registration-missing' }
  }
  if (registration.canonicalId !== manifestRow.canonicalId) {
    return { kind: 'unavailable', reason: 'registration-canonical-id-mismatch' }
  }
  if (
    registration.kind !== manifestRow.runtime.kind
    || registration.version !== manifestRow.runtime.version
    || registration.definitionHash !== manifestRow.runtime.definitionHash
    || registration.sourceModule !== manifestRow.runtime.sourceModule
  ) {
    return { kind: 'unavailable', reason: 'registration-metadata-mismatch' }
  }
  return { kind: 'native', registration }
}
