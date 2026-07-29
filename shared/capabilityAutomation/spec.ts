import type {
  CapabilityActionEconomy,
  CapabilityAutomationCategory,
  CapabilityFrequency,
} from './manifest'

export const CAPABILITY_SPEC_SCHEMA_VERSION = 1 as const
export const CAPABILITY_ACTION_MECHANIC_KINDS = [
  'adjudication',
  'communication',
  'produce-item',
  'resolve-roll',
  'toggle-mode',
  'link-actors',
  'shape-terrain',
  'movement-request',
  'skill-challenge',
  'campaign-time',
] as const
export type CapabilityActionMechanicKind = typeof CAPABILITY_ACTION_MECHANIC_KINDS[number]

export interface CapabilityRuntimeActionSpec {
  readonly actionId: string
  readonly economy: CapabilityActionEconomy
  readonly frequency: CapabilityFrequency
  readonly contextPredicateId: string
  readonly mechanic: CapabilityActionMechanicKind
  readonly levelRequirement: number | null
  readonly itemOutputs: readonly string[]
  readonly requiresGmConfirmation: boolean
}

export interface CapabilityRuntimeSpec {
  readonly schemaVersion: typeof CAPABILITY_SPEC_SCHEMA_VERSION
  readonly canonicalId: string
  readonly category: CapabilityAutomationCategory
  readonly sourceEffectSha256: string
  readonly semanticTags: readonly string[]
  readonly actions: readonly CapabilityRuntimeActionSpec[]
  readonly passiveProjection: true
  readonly registeredHandlerId: string
}

export interface CapabilityRuntimeDefinition {
  readonly canonicalId: string
  readonly definitionHash: string
  readonly spec: CapabilityRuntimeSpec
  readonly source: {
    readonly file: string
    readonly effect: string
  }
}

export interface CapabilityRuntimeRegistry {
  readonly definitions: readonly CapabilityRuntimeDefinition[]
  resolve(canonicalId: string): CapabilityRuntimeDefinition | null
  require(canonicalId: string): CapabilityRuntimeDefinition
}
