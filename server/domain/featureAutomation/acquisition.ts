import { createHash } from 'node:crypto'
import { canonicalFeatureReference, isCanonicalFeatureId } from '#shared/featureAutomation/catalog'
import { FEATURE_AUTOMATION_MANIFEST_BY_ID } from '#shared/featureAutomation/manifest'
import { parseFeatureInstanceData, resolveFeatureInstance, type FeatureChoiceSelection, type FeatureInstanceData, type FeaturePrerequisiteOverride } from '#shared/featureAutomation/instances'
import { evaluateFeaturePrerequisite, FEATURE_PREREQUISITE_BY_ID, type FeaturePrerequisiteExpression } from '#shared/featureAutomation/prerequisites'
import { buildFeaturePrerequisiteContext } from './prerequisiteContext'
import type { TrainerClassEntry, TrainerFeatureEntry, TrainerSheet } from '~/types/trainerSheet'
import { reconcileFeatureSourceLoss } from './recovery'

export interface FeatureAcquisitionRequest {
  readonly operation: 'add' | 'replace' | 'remove' | 'rank'
  readonly canonicalId?: string
  readonly targetInstanceId?: string
  readonly choices?: readonly FeatureChoiceSelection[]
  readonly collection?: 'features' | 'classes'
  readonly cascade?: boolean
  readonly gmAuthorized?: boolean
  readonly override?: { readonly overrideId: string, readonly reason: string, readonly authorizedBy: string, readonly createdAt: number, readonly prerequisiteHash: string }
}
export interface FeatureAcquisitionFailure { readonly code: string, readonly message: string, readonly canonicalId?: string }
export interface FeatureAcquisitionResult {
  readonly accepted: boolean
  readonly sheet: TrainerSheet
  readonly failures: readonly FeatureAcquisitionFailure[]
  readonly prerequisiteEvidence: ReturnType<typeof evaluateFeaturePrerequisite> | null
  readonly affectedInstanceIds: readonly string[]
}

const clone = (sheet: TrainerSheet): TrainerSheet => structuredClone(sheet)
const safe = (value: string): string => value.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'feature'
const containsFeature = (expression: FeaturePrerequisiteExpression, canonicalId: string): boolean => expression.kind === 'feature'
  ? expression.canonicalId === canonicalId : (expression.kind === 'all' || expression.kind === 'any') && expression.requirements.some(requirement => containsFeature(requirement, canonicalId))
const overrideEvidence = (request: FeatureAcquisitionRequest, expressionHash: string): FeaturePrerequisiteOverride | null => {
  if (!request.gmAuthorized || !request.override || request.override.prerequisiteHash !== expressionHash || !request.override.reason.trim()) return null
  return Object.freeze({ ...request.override })
}
const result = (accepted: boolean, sheet: TrainerSheet, failures: FeatureAcquisitionFailure[], prerequisiteEvidence: ReturnType<typeof evaluateFeaturePrerequisite> | null, affectedInstanceIds: string[] = []): FeatureAcquisitionResult => Object.freeze({ accepted, sheet, failures: Object.freeze(failures), prerequisiteEvidence, affectedInstanceIds: Object.freeze(affectedInstanceIds) })

const allRows = (sheet: TrainerSheet): { collection: 'features' | 'classes', index: number, entry: TrainerFeatureEntry | TrainerClassEntry, resolved: ReturnType<typeof resolveFeatureInstance> }[] => [
  ...(sheet.features ?? []).map((entry, index) => ({ collection: 'features' as const, index, entry, resolved: resolveFeatureInstance({ entry, ownerId: sheet.slug, index, acquisitionKind: 'sheet' }) })),
  ...(sheet.classes ?? []).map((entry, index) => ({ collection: 'classes' as const, index, entry, resolved: resolveFeatureInstance({ entry, ownerId: sheet.slug, index: 10_000 + index, acquisitionKind: 'class' }) })),
]
const maxRank = (canonicalId: string): number => {
  const reference = canonicalFeatureReference(canonicalId)
  const tag = reference?.tags.find(value => /^Ranked \d+$/.test(value))
  return tag ? Number(tag.split(' ')[1]) : 1
}
const asEntry = (instance: FeatureInstanceData): TrainerFeatureEntry => {
  const reference = canonicalFeatureReference(instance.canonicalId)!
  return { name: instance.canonicalId, choices: Object.fromEntries(instance.choices.flatMap(choice => choice.values.length === 1 ? [[choice.choiceId, choice.values[0]!]] : choice.values.map((value, index) => [`${choice.choiceId}${index ? index + 1 : ''}`, value]))), frequency: reference.frequency ?? undefined, tags: [...reference.tags], automation: instance }
}

export const applyFeatureAcquisition = (sheet: TrainerSheet, request: FeatureAcquisitionRequest): FeatureAcquisitionResult => {
  const original = clone(sheet); const next = clone(sheet); const rows = allRows(next)
  if (request.operation === 'remove') {
    const target = rows.find(row => row.resolved.data?.instanceId === request.targetInstanceId)
    if (!target?.resolved.data) return result(false, original, [{ code: 'feature.target.missing', message: 'The Feature instance no longer exists.' }], null)
    const removedCanonicalIds = new Set([target.resolved.data.canonicalId])
    const removeIds = new Set([target.resolved.data.instanceId])
    let changed = true
    while (changed) {
      changed = false
      for (const row of rows) {
        const data = row.resolved.data; const prereq = data ? FEATURE_PREREQUISITE_BY_ID.get(data.canonicalId) : null
        if (!data || removeIds.has(data.instanceId) || !prereq || ![...removedCanonicalIds].some(id => containsFeature(prereq.expression, id))) continue
        removedCanonicalIds.add(data.canonicalId); removeIds.add(data.instanceId); changed = true
      }
    }
    if (removeIds.size > 1 && !request.cascade) return result(false, original, [{ code: 'feature.dependencies.exist', message: `Dependent Features must be retrained first: ${[...removedCanonicalIds].filter(id => id !== target.resolved.data!.canonicalId).join(', ')}`, canonicalId: target.resolved.data.canonicalId }], null)
    if (!request.cascade) for (const id of [...removeIds]) if (id !== target.resolved.data.instanceId) removeIds.delete(id)
    next.features = (next.features ?? []).filter((entry, index) => !removeIds.has(resolveFeatureInstance({ entry, ownerId: next.slug, index, acquisitionKind: 'sheet' }).data?.instanceId ?? ''))
    next.classes = (next.classes ?? []).filter((entry, index) => !removeIds.has(resolveFeatureInstance({ entry, ownerId: next.slug, index: 10_000 + index, acquisitionKind: 'class' }).data?.instanceId ?? ''))
    return result(true, reconcileFeatureSourceLoss(next, 0), [], null, [...removeIds])
  }

  if (!isCanonicalFeatureId(request.canonicalId)) return result(false, original, [{ code: 'feature.identity.unknown', message: 'Feature identity is not canonical.' }], null)
  const canonicalId = request.canonicalId
  const manifest = FEATURE_AUTOMATION_MANIFEST_BY_ID.get(canonicalId)!
  const existing = rows.filter(row => row.resolved.data?.canonicalId === canonicalId)
  const maximum = maxRank(canonicalId)
  const target = request.operation === 'replace' || request.operation === 'rank' ? rows.find(row => row.resolved.data?.instanceId === request.targetInstanceId) : null
  if ((request.operation === 'replace' || request.operation === 'rank') && !target?.resolved.data) return result(false, original, [{ code: 'feature.target.missing', message: 'The Feature instance no longer exists.', canonicalId }], null)
  if (request.operation === 'add' && maximum === 1 && existing.length && !manifest.roles.includes('branch-anchor')) return result(false, original, [{ code: 'feature.repeat.maximum', message: 'This Feature cannot be taken again.', canonicalId }], null)

  const prereq = FEATURE_PREREQUISITE_BY_ID.get(canonicalId)!
  const approved = request.gmAuthorized && request.override?.prerequisiteHash === prereq.expressionSha256 ? new Set<string>([...extractClauseIds(prereq.expression)]) : new Set<string>()
  const evidence = evaluateFeaturePrerequisite(prereq.expression, buildFeaturePrerequisiteContext(next, approved))
  const override = overrideEvidence(request, prereq.expressionSha256)
  if (!evidence.satisfied && !override) return result(false, original, [{ code: 'feature.prerequisite.unmet', message: 'Feature prerequisites are not met and no valid GM override was supplied.', canonicalId }], evidence)

  if (request.operation === 'rank' && target!.resolved.data!.canonicalId !== canonicalId) return result(false, original, [{ code: 'feature.rank.identity-mismatch', message: 'A rank operation cannot replace the Feature identity.', canonicalId }], evidence)
  const rank = request.operation === 'rank' ? Math.min(maximum, (target!.resolved.data!.rank ?? 1) + 1) : 1
  if (request.operation === 'rank' && target!.resolved.data!.rank >= maximum) return result(false, original, [{ code: 'feature.rank.maximum', message: `Feature is already Rank ${maximum}.`, canonicalId }], evidence)
  const sequence = rows.length + 1
  let instance: FeatureInstanceData
  try {
    instance = parseFeatureInstanceData({ schemaVersion: 1, instanceId: request.operation === 'add' ? `feature:${safe(next.slug)}:${sequence}:${safe(canonicalId)}` : target!.resolved.data!.instanceId, canonicalId, definitionVersion: 1, rank, choices: request.choices ?? target?.resolved.data?.choices ?? [], acquisition: { kind: manifest.roles.includes('class-anchor') ? 'class' : 'sheet', sourceId: `sheet:${safe(next.slug)}:${sequence}` }, prerequisiteOverride: override })
  }
  catch (error) { return result(false, original, [{ code: 'feature.parameters.invalid', message: error instanceof Error ? error.message : 'Feature parameters are invalid.', canonicalId }], evidence) }
  const entry = asEntry(instance)
  const collection = request.collection ?? (manifest.roles.includes('class-anchor') ? 'classes' : 'features')
  if (collection === 'classes' && !manifest.roles.includes('class-anchor') && !manifest.roles.includes('branch-anchor')) return result(false, original, [{ code: 'feature.collection.invalid', message: 'Only class or branch Features belong in the class collection.', canonicalId }], evidence)
  if (request.operation === 'replace' || request.operation === 'rank') {
    if (target!.collection === 'features') next.features = (next.features ?? []).map((value, index) => index === target!.index ? entry : value)
    else next.classes = (next.classes ?? []).map((value, index) => index === target!.index ? { name: entry.name, specialisation: entry.choices?.stat ?? entry.choices?.type ?? entry.choices?.contestStat, automation: instance } : value)
  }
  else if (collection === 'classes') next.classes = [...(next.classes ?? []), { name: entry.name, specialisation: entry.choices?.stat ?? entry.choices?.type ?? entry.choices?.contestStat, automation: instance }]
  else next.features = [...(next.features ?? []), entry]
  return result(true, next, [], evidence, [instance.instanceId])
}

const extractClauseIds = (expression: FeaturePrerequisiteExpression): string[] => expression.kind === 'reviewed-build-clause' ? [expression.clauseId] : expression.kind === 'all' || expression.kind === 'any' ? expression.requirements.flatMap(extractClauseIds) : []
export const featurePrerequisiteOverrideHash = (canonicalId: string): string | null => FEATURE_PREREQUISITE_BY_ID.get(canonicalId)?.expressionSha256 ?? null
export const featureAcquisitionRequestHash = (request: FeatureAcquisitionRequest): string => createHash('sha256').update(JSON.stringify(request)).digest('hex')
