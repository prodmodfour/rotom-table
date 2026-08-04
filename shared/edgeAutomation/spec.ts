import type { EdgeActionDefinition, EdgeAutomationRole } from './manifest'
import type { EdgeFamily } from './catalog'

export const EDGE_SPEC_SCHEMA_VERSION = 1 as const
export const EDGE_MECHANIC_KINDS = [
  'numeric-provider', 'rank-provider', 'substitution-provider', 'permission-provider',
  'permanent-grant', 'trigger-subscription', 'action-modifier', 'lifecycle-rule',
  'mutual-exclusion', 'delegated-operation',
] as const
export type EdgeMechanicKind = typeof EDGE_MECHANIC_KINDS[number]

export type EdgeMechanicParameter = string | number | boolean | null | readonly string[]

export interface EdgeMechanicDeclaration {
  readonly mechanicId: string
  readonly kind: EdgeMechanicKind
  /** Stable mechanical query/property/grant identity. */
  readonly propertyId: string
  readonly operation: 'add' | 'set' | 'multiply' | 'substitute' | 'grant' | 'prevent' | 'permit' | 'subscribe'
  readonly value: number | string | boolean | null
  readonly valueSource: string | null
  readonly choiceId: string | null
  readonly contextId: string
  readonly parameters: Readonly<Record<string, EdgeMechanicParameter>>
}

export interface EdgeRuntimeSpec {
  readonly schemaVersion: typeof EDGE_SPEC_SCHEMA_VERSION
  readonly family: EdgeFamily
  readonly canonicalId: string
  readonly sourceEffectSha256: string
  readonly roles: readonly EdgeAutomationRole[]
  readonly mechanics: readonly EdgeMechanicDeclaration[]
  readonly actions: readonly EdgeActionDefinition[]
  readonly registeredHandlerId: 'edge.native.v1'
}

export interface EdgeRuntimeDefinition {
  readonly key: string
  readonly family: EdgeFamily
  readonly canonicalId: string
  readonly definitionHash: string
  readonly spec: EdgeRuntimeSpec
}

export interface EdgeRuntimeRegistry {
  readonly definitions: readonly EdgeRuntimeDefinition[]
  resolve(family: EdgeFamily, canonicalId: string): EdgeRuntimeDefinition | null
  require(family: EdgeFamily, canonicalId: string): EdgeRuntimeDefinition
}
