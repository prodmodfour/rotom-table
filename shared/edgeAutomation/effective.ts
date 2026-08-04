import type { EdgeFamily } from './catalog'
import type { EdgeInstanceData, EdgeInstanceParameterStatus } from './instances'
import type { EdgeMechanicDeclaration } from './spec'
import type { EdgeActionDefinition } from './manifest'

export interface EffectiveEdgeSource {
  readonly kind: 'sheet' | 'feature-grant' | 'edge-grant' | 'temporary' | 'gm'
  readonly sourceId: string
  readonly precedence: number
}

export interface EffectiveEdgeInstance {
  readonly family: EdgeFamily
  readonly canonicalId: string
  readonly instanceId: string
  readonly instance: EdgeInstanceData
  readonly parameterStatus: EdgeInstanceParameterStatus
  readonly definitionHash: string
  readonly effective: boolean
  readonly suppressionReasonCode: string | null
  readonly sources: readonly EffectiveEdgeSource[]
  readonly mechanics: readonly EdgeMechanicDeclaration[]
  readonly actions: readonly EdgeActionDefinition[]
  readonly diagnostics: readonly string[]
}

export interface UnresolvedEffectiveEdge {
  readonly family: EdgeFamily
  readonly rawName: string
  readonly reason: 'unresolved-identity' | 'malformed-instance' | 'projection-limit'
  readonly diagnostics: readonly string[]
}

export interface EffectiveEdgeSet {
  readonly schemaVersion: 1
  readonly ownerId: string
  readonly family: EdgeFamily
  readonly instances: readonly EffectiveEdgeInstance[]
  readonly unresolved: readonly UnresolvedEffectiveEdge[]
}

export interface EdgeSuppressionInput {
  readonly edgeInstanceId?: string
  readonly canonicalId?: string
  readonly sourceId: string
  readonly reasonCode: string
}
