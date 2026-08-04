import type { FeatureActionDefinition } from './manifest'
import type { FeatureInstanceData, FeatureInstanceParameterStatus } from './instances'
import type { FeatureMechanicDeclaration } from './spec'

export interface EffectiveFeatureSource {
  readonly kind: 'sheet' | 'class' | 'feature-grant' | 'edge-grant' | 'training' | 'orders' | 'temporary' | 'gm'
  readonly sourceId: string
  readonly precedence: number
}
export interface EffectiveFeatureInstance {
  readonly canonicalId: string
  readonly instanceId: string
  readonly instance: FeatureInstanceData
  readonly parameterStatus: FeatureInstanceParameterStatus
  readonly definitionHash: string
  readonly effective: boolean
  readonly suppressionReasonCode: string | null
  readonly sources: readonly EffectiveFeatureSource[]
  readonly mechanics: readonly FeatureMechanicDeclaration[]
  readonly actions: readonly FeatureActionDefinition[]
  readonly diagnostics: readonly string[]
}
export interface UnresolvedEffectiveFeature {
  readonly rawName: string
  readonly ownerCollection: 'features' | 'classes' | 'orders' | 'training'
  readonly reason: 'unresolved-identity' | 'malformed-instance' | 'projection-limit'
  readonly diagnostics: readonly string[]
}
export interface EffectiveFeatureSet {
  readonly schemaVersion: 1
  readonly ownerId: string
  readonly instances: readonly EffectiveFeatureInstance[]
  readonly unresolved: readonly UnresolvedEffectiveFeature[]
}
export interface FeatureSuppressionInput {
  readonly featureInstanceId?: string
  readonly canonicalId?: string
  readonly sourceId: string
  readonly reasonCode: string
}
