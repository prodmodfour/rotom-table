import type { CapabilityParameters } from './catalog'

export const CAPABILITY_ACQUISITION_SOURCE_KINDS = [
  'species-default',
  'sheet-override',
  'trainer-formula',
  'move-grant',
  'ability-grant',
  'feature-grant',
  'edge-grant',
  'item-grant',
  'encounter-grant',
  'form-projection',
] as const
export type CapabilityAcquisitionSourceKind = typeof CAPABILITY_ACQUISITION_SOURCE_KINDS[number]

export interface CapabilityAcquisitionSource {
  readonly kind: CapabilityAcquisitionSourceKind
  /** Stable source identity; never a user-facing label used as authority. */
  readonly sourceId: string
  /** Later/higher precedence wins for replacement semantics. */
  readonly precedence: number
  readonly label: string
  readonly value: number | null
}

export interface EffectiveCapabilityInstance {
  readonly instanceId: string
  readonly canonicalId: string
  readonly parameters: CapabilityParameters
  readonly value: number | null
  readonly effective: boolean
  readonly suppressionReasons: readonly string[]
  readonly sources: readonly CapabilityAcquisitionSource[]
  readonly primarySource: CapabilityAcquisitionSource
  readonly sourceEffectSha256: string
}

export interface UnresolvedEffectiveCapabilityLabel {
  readonly normalizedLabel: string
  readonly source: CapabilityAcquisitionSource
  readonly reason: 'unknown-canonical-identity' | 'invalid-parameters'
}

export interface EffectiveCapabilitySet {
  readonly actorPlacementId: string
  readonly instances: readonly EffectiveCapabilityInstance[]
  readonly unresolved: readonly UnresolvedEffectiveCapabilityLabel[]
}

export const effectiveCapabilityById = (
  set: EffectiveCapabilitySet,
  canonicalId: string,
): EffectiveCapabilityInstance | null => set.instances.find(instance => (
  instance.canonicalId === canonicalId && instance.effective
)) ?? null

export const hasEffectiveCapability = (
  set: EffectiveCapabilitySet,
  canonicalId: string,
): boolean => effectiveCapabilityById(set, canonicalId) !== null
