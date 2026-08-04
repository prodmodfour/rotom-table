import { FEATURE_INSTANCE_LIMIT_PER_SHEET, resolveFeatureInstance, type FeatureInstanceData, type FeatureInstanceParameterStatus, type LegacyFeatureEntrySource } from './instances'
import { resolveFeatureGrants } from './grants'

export interface FeatureSheetLike {
  readonly slug?: string
  readonly features?: readonly LegacyFeatureEntrySource[]
  readonly classes?: readonly LegacyFeatureEntrySource[]
  readonly orders?: readonly LegacyFeatureEntrySource[]
  readonly trainingFeature?: unknown
}
export interface ResolvedSheetFeatureInstance {
  readonly collection: 'features' | 'classes' | 'orders' | 'training'
  readonly index: number
  readonly status: FeatureInstanceParameterStatus
  readonly data: FeatureInstanceData | null
  readonly diagnostics: readonly string[]
}

export const resolvedSheetFeatureInstances = (sheet: FeatureSheetLike | null | undefined): readonly ResolvedSheetFeatureInstance[] => {
  if (!sheet) return Object.freeze([])
  const ownerId = typeof sheet.slug === 'string' && sheet.slug ? sheet.slug : 'unknown'
  const rows: { collection: ResolvedSheetFeatureInstance['collection'], index: number, entry: LegacyFeatureEntrySource, kind: Parameters<typeof resolveFeatureInstance>[0]['acquisitionKind'] }[] = [
    ...(sheet.features ?? []).map((entry, index) => ({ collection: 'features' as const, index, entry, kind: 'sheet' as const })),
    ...(sheet.classes ?? []).map((entry, index) => ({ collection: 'classes' as const, index, entry, kind: 'class' as const })),
    ...(sheet.orders ?? []).map((entry, index) => ({ collection: 'orders' as const, index, entry, kind: 'orders' as const })),
    ...(typeof sheet.trainingFeature === 'string' && sheet.trainingFeature.trim() ? [{ collection: 'training' as const, index: 0, entry: { name: sheet.trainingFeature }, kind: 'training' as const }] : []),
  ]
  return Object.freeze(rows.map((row, sequence) => {
    const resolved = resolveFeatureInstance({ entry: row.entry, ownerId, index: sequence, acquisitionKind: row.kind })
    return Object.freeze({ collection: row.collection, index: row.index, ...resolved })
  }))
}
const instanceIdentity = (instance: FeatureInstanceData): string => `${instance.canonicalId}\0${instance.choices.flatMap(choice => choice.values.map(value => `${choice.choiceId}:${value}`)).sort().join('|')}`

/** Environment-neutral permanent self-grant closure used by sheet derivations. */
export const resolvedSheetFeatureClosure = (sheet: FeatureSheetLike | null | undefined): readonly FeatureInstanceData[] => {
  const ownerId = typeof sheet?.slug === 'string' && sheet.slug ? sheet.slug : 'unknown'
  const instances = resolvedSheetFeatureInstances(sheet).flatMap(row => row.data && (row.status === 'ready' || row.status === 'missing-required-data') ? [row.data] : [])
  const seen = new Set(instances.map(instanceIdentity))
  for (let cursor = 0; cursor < instances.length && instances.length < FEATURE_INSTANCE_LIMIT_PER_SHEET; cursor += 1) {
    const parent = instances[cursor]!
    for (const [grantIndex, grant] of resolveFeatureGrants(parent).entries()) {
      if (grant.kind !== 'feature' || grant.targetPolicy !== 'trainer' || grant.duration !== 'permanent') continue
      const prefix = grant.sourceChoiceId ? `${grant.sourceChoiceId}.` : null
      const choices = Object.fromEntries(parent.choices.flatMap(choice => prefix && choice.choiceId.startsWith(prefix)
        ? [[choice.choiceId.slice(prefix.length), [...choice.values]]]
        : []))
      const child = resolveFeatureInstance({ entry: { name: grant.canonicalId, choices }, ownerId, index: instances.length + grantIndex, acquisitionKind: 'feature-grant' })
      if (!child.data) continue
      const identity = instanceIdentity(child.data)
      if (seen.has(identity)) continue
      seen.add(identity)
      instances.push(child.data)
    }
  }
  return Object.freeze(instances.slice(0, FEATURE_INSTANCE_LIMIT_PER_SHEET))
}

export const sheetHasCanonicalFeature = (sheet: FeatureSheetLike | null | undefined, canonicalId: string): boolean => resolvedSheetFeatureClosure(sheet).some(instance => instance.canonicalId === canonicalId)
