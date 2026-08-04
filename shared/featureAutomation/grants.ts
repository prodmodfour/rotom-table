import grantsJson from '../../data/feature-automation/grants.json'
import type { FeatureInstanceData } from './instances'
import { featureChoiceValues } from './instances'

export type FeatureGrantKind = 'move' | 'ability' | 'capability' | 'edge' | 'feature'
export interface FeatureSelectedGrant { readonly choiceId: string, readonly kind: 'ability' | 'move' | 'edge' | 'feature' | 'feature-or-edge' | 'training-feature' }
export interface FeatureGrantDefinition {
  readonly canonicalId: string
  readonly sourceEffectSha256: string
  readonly targetPolicy: 'trainer' | 'target-pokemon'
  readonly duration: 'permanent' | 'temporary'
  readonly fixed: Readonly<Partial<Record<FeatureGrantKind, readonly string[]>>>
  readonly selected: readonly FeatureSelectedGrant[]
}
interface GrantCatalog { readonly schemaVersion: 1, readonly entryCount: number, readonly entries: readonly FeatureGrantDefinition[] }
const catalog = grantsJson as unknown as GrantCatalog
if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.entries) || catalog.entryCount !== catalog.entries.length) throw new Error('Feature grant catalog is malformed.')
export const FEATURE_GRANT_DEFINITIONS = Object.freeze(catalog.entries)
export const FEATURE_GRANT_BY_ID: ReadonlyMap<string, FeatureGrantDefinition> = new Map(catalog.entries.map(entry => [entry.canonicalId, Object.freeze(entry)]))

export interface ResolvedFeatureGrant {
  readonly kind: FeatureGrantKind
  readonly canonicalId: string
  readonly sourceCanonicalId: string
  readonly sourceInstanceId: string
  readonly targetPolicy: FeatureGrantDefinition['targetPolicy']
  readonly duration: FeatureGrantDefinition['duration']
  /** Choice whose selected identity produced this grant; null for fixed grants. */
  readonly sourceChoiceId: string | null
}
const choiceKind = (kind: FeatureSelectedGrant['kind'], value: string): FeatureGrantKind => kind === 'training-feature'
  ? 'feature' : kind === 'feature-or-edge' ? (value === 'Medic Training' ? 'edge' : 'feature') : kind

export const resolveFeatureGrants = (instance: FeatureInstanceData): readonly ResolvedFeatureGrant[] => {
  const definition = FEATURE_GRANT_BY_ID.get(instance.canonicalId)
  if (!definition) return Object.freeze([])
  const grants: ResolvedFeatureGrant[] = []
  for (const [kind, ids] of Object.entries(definition.fixed) as [FeatureGrantKind, readonly string[]][]) for (const canonicalId of ids) grants.push({ kind, canonicalId, sourceCanonicalId: instance.canonicalId, sourceInstanceId: instance.instanceId, targetPolicy: definition.targetPolicy, duration: definition.duration, sourceChoiceId: null })
  for (const selected of definition.selected) for (const value of featureChoiceValues(instance, selected.choiceId)) grants.push({ kind: choiceKind(selected.kind, value), canonicalId: value, sourceCanonicalId: instance.canonicalId, sourceInstanceId: instance.instanceId, targetPolicy: definition.targetPolicy, duration: definition.duration, sourceChoiceId: selected.choiceId })
  return Object.freeze(grants.map(grant => Object.freeze(grant)))
}
