import prerequisiteJson from '../../data/feature-automation/prerequisites.json'
import { FEATURE_AUTOMATION_RULESET_ID } from './ruleset'

export type FeaturePrerequisiteExpression =
  | { readonly kind: 'true' }
  | { readonly kind: 'all', readonly requirements: readonly FeaturePrerequisiteExpression[] }
  | { readonly kind: 'level', readonly minimum: number }
  | { readonly kind: 'skill', readonly skillId: string, readonly minimumRank: number }
  | { readonly kind: 'skill-maximum', readonly skillId: string, readonly maximumRank: number }
  | { readonly kind: 'feature', readonly canonicalId: string }
  | { readonly kind: 'edge', readonly canonicalId: string }
  | { readonly kind: 'feature-class-count', readonly className: string, readonly minimum: number }
  | { readonly kind: 'any', readonly requirements: readonly FeaturePrerequisiteExpression[] }
  | { readonly kind: 'reviewed-build-clause', readonly clauseId: string }

export interface FeaturePrerequisiteRecord {
  readonly canonicalId: string
  readonly source: string
  readonly expression: FeaturePrerequisiteExpression
  readonly expressionSha256: string
}
interface PrerequisiteCatalog { readonly schemaVersion: 1, readonly rulesetId: typeof FEATURE_AUTOMATION_RULESET_ID, readonly entryCount: 444, readonly entries: readonly FeaturePrerequisiteRecord[] }
const catalog = prerequisiteJson as unknown as PrerequisiteCatalog
if (catalog.schemaVersion !== 1 || catalog.rulesetId !== FEATURE_AUTOMATION_RULESET_ID || catalog.entryCount !== 444 || catalog.entries.length !== 444) throw new Error('Feature prerequisite catalog is incomplete.')
export const FEATURE_PREREQUISITES = Object.freeze(catalog)
export const FEATURE_PREREQUISITE_BY_ID: ReadonlyMap<string, FeaturePrerequisiteRecord> = new Map(catalog.entries.map(entry => [entry.canonicalId, Object.freeze(entry)]))

export interface FeaturePrerequisiteContext {
  readonly level: number
  readonly skillRanks: Readonly<Record<string, number>>
  readonly featureIds: ReadonlySet<string>
  readonly edgeIds: ReadonlySet<string>
  readonly featureClassCounts: Readonly<Record<string, number>>
  readonly approvedClauseIds?: ReadonlySet<string>
}
export interface FeaturePrerequisiteEvidence {
  readonly kind: FeaturePrerequisiteExpression['kind']
  readonly satisfied: boolean
  readonly label: string
  readonly children?: readonly FeaturePrerequisiteEvidence[]
}

export const evaluateFeaturePrerequisite = (expression: FeaturePrerequisiteExpression, context: FeaturePrerequisiteContext): FeaturePrerequisiteEvidence => {
  if (expression.kind === 'true') return { kind: 'true', satisfied: true, label: 'No prerequisite' }
  if (expression.kind === 'all' || expression.kind === 'any') {
    const children = expression.requirements.map(requirement => evaluateFeaturePrerequisite(requirement, context))
    return { kind: expression.kind, satisfied: expression.kind === 'all' ? children.every(child => child.satisfied) : children.some(child => child.satisfied), label: expression.kind === 'all' ? 'All requirements' : 'Any requirement', children }
  }
  if (expression.kind === 'level') return { kind: 'level', satisfied: context.level >= expression.minimum, label: `Level ${expression.minimum}` }
  if (expression.kind === 'skill') return { kind: 'skill', satisfied: (context.skillRanks[expression.skillId] ?? 0) >= expression.minimumRank, label: `${expression.skillId} rank ${expression.minimumRank}` }
  if (expression.kind === 'skill-maximum') return { kind: 'skill-maximum', satisfied: (context.skillRanks[expression.skillId] ?? 0) <= expression.maximumRank, label: `${expression.skillId} rank at most ${expression.maximumRank}` }
  if (expression.kind === 'feature') return { kind: 'feature', satisfied: context.featureIds.has(expression.canonicalId), label: `Feature: ${expression.canonicalId}` }
  if (expression.kind === 'edge') return { kind: 'edge', satisfied: context.edgeIds.has(expression.canonicalId), label: `Edge: ${expression.canonicalId}` }
  if (expression.kind === 'feature-class-count') return { kind: 'feature-class-count', satisfied: (context.featureClassCounts[expression.className] ?? 0) >= expression.minimum, label: `${expression.minimum} ${expression.className} Features` }
  return { kind: 'reviewed-build-clause', satisfied: context.approvedClauseIds?.has(expression.clauseId) ?? false, label: `Reviewed build clause ${expression.clauseId}` }
}
