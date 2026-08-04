import type { FeatureActionDefinition, FeatureAutomationRole, FeatureFrequencyDefinition } from './manifest'

export type FeatureMechanicKind =
  | 'passive-provider' | 'permanent-grant' | 'event-subscription' | 'permission-provider'
  | 'class-progression' | 'campaign-operation' | 'action-provider'

export interface FeatureMechanicDeclaration {
  readonly mechanicId: string
  readonly kind: FeatureMechanicKind
  readonly propertyId: string
  readonly operation: 'add' | 'set' | 'grant' | 'subscribe' | 'permit' | 'classify'
  readonly contextId: string
  readonly parameters: Readonly<Record<string, string | number | boolean | readonly string[] | null>>
}

export interface FeatureRuntimeSpec {
  readonly schemaVersion: 1
  readonly canonicalId: string
  readonly sourceEffectSha256: string
  readonly roles: readonly FeatureAutomationRole[]
  readonly frequency: FeatureFrequencyDefinition
  readonly mechanics: readonly FeatureMechanicDeclaration[]
  readonly actions: readonly FeatureActionDefinition[]
  readonly registeredHandlerId: 'feature.native.v1'
}

export interface FeatureRuntimeDefinition {
  readonly canonicalId: string
  readonly definitionHash: string
  readonly spec: FeatureRuntimeSpec
}
export interface FeatureRuntimeRegistry {
  readonly definitions: readonly FeatureRuntimeDefinition[]
  readonly resolve: (canonicalId: string) => FeatureRuntimeDefinition | null
  readonly require: (canonicalId: string) => FeatureRuntimeDefinition
}
