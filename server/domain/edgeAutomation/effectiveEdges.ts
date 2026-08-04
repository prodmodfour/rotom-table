import {
  CANONICAL_POKE_EDGE_REFERENCE,
  canonicalEdgeKey,
  type EdgeFamily,
} from '#shared/edgeAutomation/catalog'
import type {
  EdgeSuppressionInput,
  EffectiveEdgeInstance,
  EffectiveEdgeSet,
  EffectiveEdgeSource,
  UnresolvedEffectiveEdge,
} from '#shared/edgeAutomation/effective'
import {
  EDGE_INSTANCE_LIMIT_PER_SHEET,
  edgeChoiceValues,
  parseEdgeInstanceData,
  resolveEdgeInstance,
  type EdgeInstanceData,
  type LegacyEdgeEntrySource,
} from '#shared/edgeAutomation/instances'
import { EDGE_AUTOMATION_RUNTIME_REGISTRY } from './registry'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { resolvedSheetFeatureClosure } from '#shared/featureAutomation/sheetFeatures'
import { resolveFeatureGrants } from '#shared/featureAutomation/grants'
import { isCanonicalEdgeId } from '#shared/edgeAutomation/catalog'

export interface GrantedEdgeInput {
  readonly family: EdgeFamily
  readonly instance: EdgeInstanceData
  readonly source: EffectiveEdgeSource
}

const sourceForInstance = (instance: EdgeInstanceData): EffectiveEdgeSource => Object.freeze({
  kind: instance.acquisition.kind === 'feature-grant' ? 'feature-grant'
    : instance.acquisition.kind === 'edge-grant' ? 'edge-grant'
      : instance.acquisition.kind === 'gm' ? 'gm' : 'sheet',
  sourceId: instance.acquisition.sourceId,
  precedence: instance.acquisition.kind === 'gm' ? 500
    : instance.acquisition.kind === 'feature-grant' || instance.acquisition.kind === 'edge-grant' ? 300 : 200,
})

const normalized = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')

const selectedKey = (instance: EdgeInstanceData): string => instance.choices
  .flatMap(choice => choice.values.map(value => `${choice.choiceId}:${normalized(value)}`))
  .sort()
  .join('|')

const enforcePokeRepeatability = (instances: EffectiveEdgeInstance[]): void => {
  const byId = new Map<string, EffectiveEdgeInstance[]>()
  for (const instance of instances) {
    if (instance.family !== 'poke' || !instance.effective) continue
    const rows = byId.get(instance.canonicalId) ?? []
    rows.push(instance)
    byId.set(instance.canonicalId, rows)
  }
  for (const [canonicalId, rows] of byId) {
    const policy = CANONICAL_POKE_EDGE_REFERENCE[canonicalId]?.repeatability
    if (!policy) continue
    const seenChoices = new Set<string>()
    let acceptedRanks = 0
    for (const row of rows) {
      const choices = selectedKey(row.instance)
      const rankCost = policy.kind === 'ranked' ? row.instance.rank : 1
      const duplicateChoice = policy.kind === 'different-choice' && seenChoices.has(choices)
      const exceeds = policy.maximum !== null && acceptedRanks + rankCost > policy.maximum
      const repeatedOnce = policy.kind === 'once' && acceptedRanks > 0
      if (duplicateChoice || exceeds || repeatedOnce) {
        ;(row as { effective: boolean }).effective = false
        ;(row as { suppressionReasonCode: string | null }).suppressionReasonCode = duplicateChoice
          ? 'edge.repeatability.duplicate-choice' : 'edge.repeatability.maximum'
        continue
      }
      seenChoices.add(choices)
      acceptedRanks += rankCost
    }
  }
}

/**
 * Resolve sheet ownership, typed instances, grants, repetition, and explicit
 * suppression into one deterministic Edge projection. Unknown legacy rows stay
 * visible to diagnostics but cannot execute.
 */
export const resolveEffectiveEdges = (input: {
  readonly ownerId: string
  readonly family: EdgeFamily
  readonly sheet: CharacterSheet | TrainerSheet
  readonly grants?: readonly GrantedEdgeInput[]
  readonly suppressions?: readonly EdgeSuppressionInput[]
}): EffectiveEdgeSet => {
  const rawEntries: readonly LegacyEdgeEntrySource[] = input.sheet.edges ?? []
  const unresolved: UnresolvedEffectiveEdge[] = []
  const projected: EffectiveEdgeInstance[] = []
  const boundedEntries = rawEntries.slice(0, EDGE_INSTANCE_LIMIT_PER_SHEET)
  for (const [index, entry] of boundedEntries.entries()) {
    const resolved = resolveEdgeInstance({ family: input.family, entry, ownerId: input.ownerId, index })
    if (!resolved.data) {
      unresolved.push(Object.freeze({
        family: input.family,
        rawName: typeof entry.name === 'string' ? entry.name.slice(0, 240) : '',
        reason: resolved.status === 'malformed' ? 'malformed-instance' : 'unresolved-identity',
        diagnostics: resolved.diagnostics,
      }))
      continue
    }
    const definition = EDGE_AUTOMATION_RUNTIME_REGISTRY.require(input.family, resolved.data.canonicalId)
    const suppression = (input.suppressions ?? []).find(candidate => (
      candidate.edgeInstanceId === resolved.data!.instanceId
      || (!candidate.edgeInstanceId && candidate.canonicalId === resolved.data!.canonicalId)
    ))
    const effective = resolved.status === 'ready' && !suppression
    projected.push({
      family: input.family,
      canonicalId: resolved.data.canonicalId,
      instanceId: resolved.data.instanceId,
      instance: resolved.data,
      parameterStatus: resolved.status,
      definitionHash: definition.definitionHash,
      effective,
      suppressionReasonCode: suppression?.reasonCode
        ?? (resolved.status === 'missing-required-data' ? 'edge.parameters.missing' : null),
      sources: Object.freeze([sourceForInstance(resolved.data)]),
      mechanics: definition.spec.mechanics,
      actions: definition.spec.actions,
      diagnostics: resolved.diagnostics,
    })
  }
  if (rawEntries.length > EDGE_INSTANCE_LIMIT_PER_SHEET) unresolved.push(Object.freeze({
    family: input.family,
    rawName: '',
    reason: 'projection-limit',
    diagnostics: Object.freeze([`Only the first ${EDGE_INSTANCE_LIMIT_PER_SHEET} Edge rows can enter mechanics.`]),
  }))

  const automaticFeatureGrants: GrantedEdgeInput[] = input.family === 'trainer'
    ? resolvedSheetFeatureClosure(input.sheet).flatMap(source => {
        return resolveFeatureGrants(source).flatMap((grant, index): GrantedEdgeInput[] => {
          if (grant.kind !== 'edge' || grant.targetPolicy !== 'trainer' || grant.duration !== 'permanent' || !isCanonicalEdgeId('trainer', grant.canonicalId)) return []
          try {
            const instance = parseEdgeInstanceData({ schemaVersion: 1, instanceId: `${source.instanceId}:edge-grant:${index}`, family: 'trainer', canonicalId: grant.canonicalId, definitionVersion: 1, rank: 1, choices: [], acquisition: { kind: 'feature-grant', sourceId: source.instanceId }, prerequisiteOverride: null }, 'trainer', grant.canonicalId)
            return [{ family: 'trainer', instance, source: Object.freeze({ kind: 'feature-grant', sourceId: source.instanceId, precedence: 350 }) }]
          }
          catch { return [] }
        })
      })
    : []

  for (const grant of [...automaticFeatureGrants, ...(input.grants ?? [])]) {
    if (grant.family !== input.family || projected.some(row => row.instanceId === grant.instance.instanceId)) continue
    const definition = EDGE_AUTOMATION_RUNTIME_REGISTRY.resolve(input.family, grant.instance.canonicalId)
    if (!definition || projected.length >= EDGE_INSTANCE_LIMIT_PER_SHEET) continue
    const suppression = (input.suppressions ?? []).find(candidate => candidate.edgeInstanceId === grant.instance.instanceId
      || (!candidate.edgeInstanceId && candidate.canonicalId === grant.instance.canonicalId))
    projected.push({
      family: input.family,
      canonicalId: grant.instance.canonicalId,
      instanceId: grant.instance.instanceId,
      instance: grant.instance,
      parameterStatus: 'ready',
      definitionHash: definition.definitionHash,
      effective: !suppression,
      suppressionReasonCode: suppression?.reasonCode ?? null,
      sources: Object.freeze([grant.source]),
      mechanics: definition.spec.mechanics,
      actions: definition.spec.actions,
      diagnostics: Object.freeze([]),
    })
  }
  enforcePokeRepeatability(projected)
  return Object.freeze({
    schemaVersion: 1,
    ownerId: input.ownerId,
    family: input.family,
    instances: Object.freeze(projected.map(row => Object.freeze(row))),
    unresolved: Object.freeze(unresolved),
  })
}

export const effectiveEdgeInstances = (input: Parameters<typeof resolveEffectiveEdges>[0]): readonly EffectiveEdgeInstance[] => (
  resolveEffectiveEdges(input).instances.filter(instance => instance.effective)
)

export const hasEffectiveEdge = (
  sheet: CharacterSheet | TrainerSheet,
  family: EdgeFamily,
  canonicalId: string,
): boolean => resolveEffectiveEdges({ ownerId: sheet.slug, family, sheet }).instances
  .some(instance => instance.effective && instance.canonicalId === canonicalId)

export const effectiveEdgeChoiceValues = (input: {
  readonly sheet: CharacterSheet | TrainerSheet
  readonly family: EdgeFamily
  readonly canonicalId: string
  readonly choiceId: string
}): readonly string[] => Object.freeze([
  ...new Set(resolveEffectiveEdges({ ownerId: input.sheet.slug, family: input.family, sheet: input.sheet }).instances
    .filter(instance => instance.effective && instance.canonicalId === input.canonicalId)
    .flatMap(instance => edgeChoiceValues(instance.instance, input.choiceId))),
])

export const effectiveEdgeKeySet = (
  set: EffectiveEdgeSet,
): ReadonlySet<string> => new Set(set.instances.filter(instance => instance.effective)
  .map(instance => canonicalEdgeKey(instance.family, instance.canonicalId)))
