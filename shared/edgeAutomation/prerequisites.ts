import prerequisitesJson from '../../data/edge-automation/prerequisites.json'
import { canonicalEdgeKey, isCanonicalEdgeId, type EdgeFamily } from './catalog'
import { EDGE_AUTOMATION_RULESET_ID } from './ruleset'

export type EdgePrerequisiteExpression =
  | { readonly kind: 'true' }
  | { readonly kind: 'all'; readonly requirements: readonly EdgePrerequisiteExpression[] }
  | { readonly kind: 'any'; readonly requirements: readonly EdgePrerequisiteExpression[] }
  | { readonly kind: 'level'; readonly minimum: number }
  | { readonly kind: 'skill'; readonly skillId: string; readonly minimumRank: number }
  | { readonly kind: 'any-skill'; readonly minimumRank: number }
  | { readonly kind: 'edge'; readonly family: EdgeFamily; readonly canonicalId: string }
  | { readonly kind: 'edge-choice'; readonly family: EdgeFamily; readonly canonicalId: string; readonly choiceId: string; readonly value: string }
  | { readonly kind: 'feature-tag'; readonly tag: string }
  | { readonly kind: 'capability'; readonly canonicalId: string }
  | { readonly kind: 'ability-keyword'; readonly keyword: string }
  | { readonly kind: 'stat-points'; readonly statId: string; readonly minimum: number }
  | { readonly kind: 'pokemon-classification'; readonly classificationId: string }
  | { readonly kind: 'owner-provider'; readonly providerId: string }

export interface EdgePrerequisiteCatalogEntry {
  readonly family: EdgeFamily
  readonly canonicalId: string
  readonly expression: EdgePrerequisiteExpression
  readonly expressionSha256: string
}

export interface EdgePrerequisiteContext {
  readonly level: number
  readonly skillRanks: Readonly<Record<string, number>>
  readonly effectiveEdgeKeys: ReadonlySet<string>
  readonly edgeChoices?: ReadonlyMap<string, ReadonlyMap<string, ReadonlySet<string>>>
  readonly featureTags?: ReadonlySet<string>
  readonly capabilityIds?: ReadonlySet<string>
  readonly abilityKeywords?: ReadonlySet<string>
  readonly statPoints?: Readonly<Record<string, number>>
  readonly pokemonClassifications?: ReadonlySet<string>
  readonly ownerProviderIds?: ReadonlySet<string>
}

export interface EdgePrerequisiteEvidence {
  readonly kind: EdgePrerequisiteExpression['kind']
  readonly satisfied: boolean
  readonly label: string
  readonly children: readonly EdgePrerequisiteEvidence[]
}

export interface EdgePrerequisiteEvaluation {
  readonly eligible: boolean
  readonly evidence: EdgePrerequisiteEvidence
  readonly unmet: readonly string[]
}

type UnknownRecord = Record<string, unknown>
const fail = (path: string, detail: string): never => { throw new Error(`${path}: ${detail}`) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object.')
  return value as UnknownRecord
}
const bounded = (value: unknown, path: string, minimum = 0, maximum = 10_000): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail(path, 'is out of bounds.')
  return value as number
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) fail(path, 'must be bounded text.')
  return value as string
}

const parseExpression = (value: unknown, path: string, depth = 0, budget = { count: 0 }): EdgePrerequisiteExpression => {
  if (depth > 8 || ++budget.count > 128) fail(path, 'exceeds expression limits.')
  const row = record(value, path)
  const kind = row.kind
  if (kind === 'true') return Object.freeze({ kind })
  if (kind === 'all' || kind === 'any') {
    const requirements: unknown[] = Array.isArray(row.requirements)
      ? row.requirements as unknown[]
      : fail(`${path}.requirements`, 'must be a list.')
    if (requirements.length < 1 || requirements.length > 16) fail(`${path}.requirements`, 'must be a non-empty bounded list.')
    return Object.freeze({ kind, requirements: Object.freeze(requirements.map((entry: unknown, index: number) => parseExpression(entry, `${path}.requirements[${index}]`, depth + 1, budget))) })
  }
  if (kind === 'level') return Object.freeze({ kind, minimum: bounded(row.minimum, `${path}.minimum`, 1, 100) })
  if (kind === 'skill') return Object.freeze({ kind, skillId: text(row.skillId, `${path}.skillId`), minimumRank: bounded(row.minimumRank, `${path}.minimumRank`, 1, 8) })
  if (kind === 'any-skill') return Object.freeze({ kind, minimumRank: bounded(row.minimumRank, `${path}.minimumRank`, 1, 8) })
  if (kind === 'edge' || kind === 'edge-choice') {
    const family = row.family === 'trainer' || row.family === 'poke' ? row.family : fail(`${path}.family`, 'is invalid.')
    const canonicalId = text(row.canonicalId, `${path}.canonicalId`)
    if (!isCanonicalEdgeId(family, canonicalId)) fail(`${path}.canonicalId`, 'is unknown.')
    if (kind === 'edge') return Object.freeze({ kind, family, canonicalId })
    return Object.freeze({ kind, family, canonicalId, choiceId: text(row.choiceId, `${path}.choiceId`), value: text(row.value, `${path}.value`) })
  }
  if (kind === 'feature-tag') return Object.freeze({ kind, tag: text(row.tag, `${path}.tag`) })
  if (kind === 'capability') return Object.freeze({ kind, canonicalId: text(row.canonicalId, `${path}.canonicalId`) })
  if (kind === 'ability-keyword') return Object.freeze({ kind, keyword: text(row.keyword, `${path}.keyword`) })
  if (kind === 'stat-points') return Object.freeze({ kind, statId: text(row.statId, `${path}.statId`), minimum: bounded(row.minimum, `${path}.minimum`, 0, 1_000) })
  if (kind === 'pokemon-classification') return Object.freeze({ kind, classificationId: text(row.classificationId, `${path}.classificationId`) })
  if (kind === 'owner-provider') return Object.freeze({ kind, providerId: text(row.providerId, `${path}.providerId`) })
  return fail(`${path}.kind`, 'is unsupported.')
}

const root = record(prerequisitesJson, 'prerequisites')
if (root.schemaVersion !== 1 || root.rulesetId !== EDGE_AUTOMATION_RULESET_ID || root.entryCount !== 81) fail('prerequisites', 'does not cover the frozen ruleset.')
if (!Array.isArray(root.entries) || root.entries.length !== 81) fail('prerequisites.entries', 'must contain all 81 entries.')
const prerequisiteEntries = root.entries as unknown[]

export const EDGE_PREREQUISITE_CATALOG: readonly EdgePrerequisiteCatalogEntry[] = Object.freeze(prerequisiteEntries.map((candidate: unknown, index: number) => {
  const path = `prerequisites.entries[${index}]`
  const row = record(candidate, path)
  const family = row.family === 'trainer' || row.family === 'poke' ? row.family : fail(`${path}.family`, 'is invalid.')
  const canonicalId = text(row.canonicalId, `${path}.canonicalId`)
  if (!isCanonicalEdgeId(family, canonicalId)) fail(`${path}.canonicalId`, 'is unknown.')
  const expressionSha256 = text(row.expressionSha256, `${path}.expressionSha256`)
  if (!/^[0-9a-f]{64}$/.test(expressionSha256)) fail(`${path}.expressionSha256`, 'must be SHA-256.')
  return Object.freeze({ family, canonicalId, expression: parseExpression(row.expression, `${path}.expression`), expressionSha256 })
}))

export const EDGE_PREREQUISITE_BY_KEY: ReadonlyMap<string, EdgePrerequisiteCatalogEntry> = new Map(
  EDGE_PREREQUISITE_CATALOG.map(entry => [canonicalEdgeKey(entry.family, entry.canonicalId), entry]),
)

const normalize = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')
const hasNormalized = (values: ReadonlySet<string> | undefined, expected: string): boolean => (
  [...(values ?? [])].some(value => normalize(value) === normalize(expected))
)

const evidence = (kind: EdgePrerequisiteExpression['kind'], satisfied: boolean, label: string, children: readonly EdgePrerequisiteEvidence[] = []): EdgePrerequisiteEvidence => Object.freeze({ kind, satisfied, label, children: Object.freeze(children) })

const evaluate = (expression: EdgePrerequisiteExpression, context: EdgePrerequisiteContext): EdgePrerequisiteEvidence => {
  if (expression.kind === 'true') return evidence('true', true, 'No prerequisite')
  if (expression.kind === 'all' || expression.kind === 'any') {
    const children = expression.requirements.map(requirement => evaluate(requirement, context))
    const satisfied = expression.kind === 'all' ? children.every(child => child.satisfied) : children.some(child => child.satisfied)
    return evidence(expression.kind, satisfied, expression.kind === 'all' ? 'All requirements' : 'Any requirement', children)
  }
  if (expression.kind === 'level') return evidence('level', context.level >= expression.minimum, `Level ${expression.minimum}`)
  if (expression.kind === 'skill') return evidence('skill', (context.skillRanks[expression.skillId] ?? 0) >= expression.minimumRank, `${expression.skillId} rank ${expression.minimumRank}`)
  if (expression.kind === 'any-skill') return evidence('any-skill', Object.values(context.skillRanks).some(rank => rank >= expression.minimumRank), `Any Skill rank ${expression.minimumRank}`)
  if (expression.kind === 'edge') return evidence('edge', context.effectiveEdgeKeys.has(canonicalEdgeKey(expression.family, expression.canonicalId)), expression.canonicalId)
  if (expression.kind === 'edge-choice') {
    const choices = context.edgeChoices?.get(canonicalEdgeKey(expression.family, expression.canonicalId))?.get(expression.choiceId)
    return evidence('edge-choice', hasNormalized(choices, expression.value), `${expression.canonicalId}: ${expression.value}`)
  }
  if (expression.kind === 'feature-tag') return evidence('feature-tag', hasNormalized(context.featureTags, expression.tag), `[${expression.tag}] Feature`)
  if (expression.kind === 'capability') return evidence('capability', hasNormalized(context.capabilityIds, expression.canonicalId), `${expression.canonicalId} Capability`)
  if (expression.kind === 'ability-keyword') return evidence('ability-keyword', hasNormalized(context.abilityKeywords, expression.keyword), `${expression.keyword} Ability`)
  if (expression.kind === 'stat-points') return evidence('stat-points', (context.statPoints?.[expression.statId] ?? 0) >= expression.minimum, `${expression.minimum} ${expression.statId} Level-Up points`)
  if (expression.kind === 'pokemon-classification') return evidence('pokemon-classification', hasNormalized(context.pokemonClassifications, expression.classificationId), expression.classificationId)
  return evidence('owner-provider', hasNormalized(context.ownerProviderIds, expression.providerId), expression.providerId)
}

export const evaluateEdgePrerequisite = (
  family: EdgeFamily,
  canonicalId: string,
  context: EdgePrerequisiteContext,
): EdgePrerequisiteEvaluation => {
  const entry = EDGE_PREREQUISITE_BY_KEY.get(canonicalEdgeKey(family, canonicalId))
  if (!entry) throw new Error(`Unknown Edge prerequisite ${family}:${canonicalId}.`)
  const rootEvidence = evaluate(entry.expression, context)
  const unmet: string[] = []
  const collect = (node: EdgePrerequisiteEvidence): void => {
    if (!node.satisfied && node.children.length === 0) unmet.push(node.label)
    node.children.forEach(collect)
  }
  collect(rootEvidence)
  return Object.freeze({ eligible: rootEvidence.satisfied, evidence: rootEvidence, unmet: Object.freeze([...new Set(unmet)]) })
}
