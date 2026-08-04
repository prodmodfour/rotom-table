import type { EffectiveFeatureInstance, EffectiveFeatureSet, EffectiveFeatureSource, FeatureSuppressionInput, UnresolvedEffectiveFeature } from '#shared/featureAutomation/effective'
import { FEATURE_INSTANCE_LIMIT_PER_SHEET, resolveFeatureInstance, type FeatureAcquisitionSourceKind, type LegacyFeatureEntrySource } from '#shared/featureAutomation/instances'
import { FEATURE_AUTOMATION_RUNTIME_REGISTRY } from './registry'
import { resolveFeatureGrants } from '#shared/featureAutomation/grants'
import { FEATURE_AUTOMATION_MANIFEST_BY_ID } from '#shared/featureAutomation/manifest'
import type { TrainerSheet } from '~/types/trainerSheet'

interface ProjectionRow {
  readonly entry: LegacyFeatureEntrySource
  readonly collection: UnresolvedEffectiveFeature['ownerCollection']
  readonly acquisition: FeatureAcquisitionSourceKind
  readonly source: EffectiveFeatureSource
}
const source = (kind: EffectiveFeatureSource['kind'], sourceId: string, precedence: number): EffectiveFeatureSource => Object.freeze({ kind, sourceId, precedence })

const projectionRows = (sheet: TrainerSheet): ProjectionRow[] => {
  const rows: ProjectionRow[] = []
  for (const [index, entry] of (sheet.features ?? []).entries()) rows.push({ entry, collection: 'features', acquisition: 'sheet', source: source('sheet', `features:${index}`, 300) })
  for (const [index, entry] of (sheet.classes ?? []).entries()) rows.push({ entry, collection: 'classes', acquisition: 'class', source: source('class', `classes:${index}`, 400) })
  for (const [index, entry] of (sheet.orders ?? []).entries()) rows.push({ entry, collection: 'orders', acquisition: 'orders', source: source('orders', `orders:${index}`, 250) })
  if (sheet.trainingFeature) rows.push({ entry: { name: sheet.trainingFeature }, collection: 'training', acquisition: 'training', source: source('training', 'training:active', 250) })
  return rows
}
const choiceKey = (instance: EffectiveFeatureInstance['instance']): string => instance.choices.flatMap(choice => choice.values.map(value => `${choice.choiceId}:${value.normalize('NFKC').toLowerCase()}`)).sort().join('|')

/** Resolve every legacy ownership collection into one fail-closed Feature view. */
export const resolveEffectiveFeatures = (input: {
  readonly ownerId: string
  readonly sheet: TrainerSheet
  readonly suppressions?: readonly FeatureSuppressionInput[]
}): EffectiveFeatureSet => {
  const rows = projectionRows(input.sheet)
  const unresolved: UnresolvedEffectiveFeature[] = []
  const projected: EffectiveFeatureInstance[] = []
  const byIdentity = new Map<string, number>()
  for (const [index, row] of rows.slice(0, FEATURE_INSTANCE_LIMIT_PER_SHEET).entries()) {
    const resolved = resolveFeatureInstance({ entry: row.entry, ownerId: input.ownerId, index, acquisitionKind: row.acquisition })
    if (!resolved.data) {
      unresolved.push(Object.freeze({ rawName: typeof row.entry.name === 'string' ? row.entry.name.slice(0, 240) : '', ownerCollection: row.collection, reason: resolved.status === 'malformed' ? 'malformed-instance' : 'unresolved-identity', diagnostics: resolved.diagnostics }))
      continue
    }
    const definition = FEATURE_AUTOMATION_RUNTIME_REGISTRY.require(resolved.data.canonicalId)
    const key = `${resolved.data.canonicalId}\0${choiceKey(resolved.data)}`
    const priorIndex = byIdentity.get(key)
    if (priorIndex !== undefined) {
      const prior = projected[priorIndex]!
      ;(prior as { sources: readonly EffectiveFeatureSource[] }).sources = Object.freeze([...prior.sources, row.source].sort((a, b) => b.precedence - a.precedence || a.sourceId.localeCompare(b.sourceId)))
      continue
    }
    const suppression = (input.suppressions ?? []).find(candidate => candidate.featureInstanceId === resolved.data!.instanceId || (!candidate.featureInstanceId && candidate.canonicalId === resolved.data!.canonicalId))
    const effective = !suppression
    byIdentity.set(key, projected.length)
    projected.push({
      canonicalId: resolved.data.canonicalId, instanceId: resolved.data.instanceId, instance: resolved.data,
      parameterStatus: resolved.status, definitionHash: definition.definitionHash, effective,
      suppressionReasonCode: suppression?.reasonCode ?? null,
      sources: Object.freeze([row.source]), mechanics: definition.spec.mechanics, actions: definition.spec.actions, diagnostics: resolved.diagnostics,
    })
  }
  // Resolve provenance-bound Feature grants to a bounded fixed point. Grant
  // cycles collapse by canonical identity and selected-choice key.
  for (let cursor = 0; cursor < projected.length && projected.length < FEATURE_INSTANCE_LIMIT_PER_SHEET; cursor += 1) {
    const parent = projected[cursor]!
    if (!parent.effective) continue
    for (const [grantIndex, grant] of resolveFeatureGrants(parent.instance).entries()) {
      if (grant.kind !== 'feature' || grant.targetPolicy !== 'trainer' || grant.duration !== 'permanent') continue
      const manifest = FEATURE_AUTOMATION_MANIFEST_BY_ID.get(grant.canonicalId)
      if (!manifest) continue
      const prefix = grant.sourceChoiceId ? `${grant.sourceChoiceId}.` : null
      const nestedChoices = Object.fromEntries(parent.instance.choices.flatMap(choice => prefix && choice.choiceId.startsWith(prefix)
        ? [[choice.choiceId.slice(prefix.length), [...choice.values]]]
        : []))
      const granted = resolveFeatureInstance({ entry: { name: grant.canonicalId, choices: nestedChoices }, ownerId: parent.instanceId, index: grantIndex, acquisitionKind: 'feature-grant' })
      if (!granted.data) {
        unresolved.push(Object.freeze({ rawName: grant.canonicalId, ownerCollection: 'features', reason: granted.status === 'malformed' ? 'malformed-instance' : 'unresolved-identity', diagnostics: granted.diagnostics }))
        continue
      }
      const identity = `${grant.canonicalId}\0${choiceKey(granted.data)}`
      const existingIndex = byIdentity.get(identity)
      if (existingIndex !== undefined) {
        const existing = projected[existingIndex]!
        const grantSource = source('feature-grant', `${parent.instanceId}:grant:${grantIndex}`, 350)
        ;(existing as { sources: readonly EffectiveFeatureSource[] }).sources = Object.freeze([...existing.sources, grantSource].sort((a, b) => b.precedence - a.precedence || a.sourceId.localeCompare(b.sourceId)))
        continue
      }
      const definition = FEATURE_AUTOMATION_RUNTIME_REGISTRY.require(granted.data.canonicalId)
      byIdentity.set(identity, projected.length)
      projected.push({ canonicalId: granted.data.canonicalId, instanceId: granted.data.instanceId, instance: granted.data, parameterStatus: granted.status, definitionHash: definition.definitionHash, effective: true, suppressionReasonCode: null, sources: Object.freeze([source('feature-grant', `${parent.instanceId}:grant:${grantIndex}`, 350)]), mechanics: definition.spec.mechanics, actions: definition.spec.actions, diagnostics: granted.diagnostics })
    }
  }
  if (rows.length > FEATURE_INSTANCE_LIMIT_PER_SHEET || projected.length >= FEATURE_INSTANCE_LIMIT_PER_SHEET) unresolved.push(Object.freeze({ rawName: '', ownerCollection: 'features', reason: 'projection-limit', diagnostics: Object.freeze([`Only ${FEATURE_INSTANCE_LIMIT_PER_SHEET} Feature ownership rows may execute.`]) }))
  return Object.freeze({ schemaVersion: 1, ownerId: input.ownerId, instances: Object.freeze(projected.map(row => Object.freeze(row))), unresolved: Object.freeze(unresolved) })
}

export const effectiveFeatureInstances = (sheet: TrainerSheet): readonly EffectiveFeatureInstance[] => resolveEffectiveFeatures({ ownerId: sheet.slug, sheet }).instances.filter(instance => instance.effective)
export const hasEffectiveFeature = (sheet: TrainerSheet, canonicalId: string): boolean => effectiveFeatureInstances(sheet).some(instance => instance.canonicalId === canonicalId)
export const effectiveFeatureChoiceValues = (sheet: TrainerSheet, canonicalId: string, choiceId: string): readonly string[] => Object.freeze([...new Set(effectiveFeatureInstances(sheet).filter(instance => instance.canonicalId === canonicalId).flatMap(instance => instance.instance.choices.find(choice => choice.choiceId === choiceId)?.values ?? []))])
