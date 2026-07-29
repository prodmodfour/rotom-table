import rulesetJson from '../../data/capability-automation/ruleset.json'

export const CAPABILITY_AUTOMATION_RULESET_SCHEMA_VERSION = 1 as const
export const CAPABILITY_AUTOMATION_RULESET_ID = 'ptu-1.05-capability-automation' as const
export const CAPABILITY_CANONICAL_SOURCE_SHA256 = '8f819401d40c598ae781ae0b273fd749575e05d6997a79c64be61f4ced8f654e' as const
export const CAPABILITY_CANONICAL_SOURCE_GIT_BLOB = '8d89cc293797ad9fb77d8f6f1b5840146b1e871b' as const

export interface CapabilityAutomationRulesetSource {
  readonly priority: number
  readonly path: string
  readonly basename: string
  readonly bytes: number
  readonly sha256: string
  readonly gitBlob: string
}

export interface CapabilityAutomationRuleset {
  readonly schemaVersion: typeof CAPABILITY_AUTOMATION_RULESET_SCHEMA_VERSION
  readonly rulesetId: typeof CAPABILITY_AUTOMATION_RULESET_ID
  readonly canonicalSource: {
    readonly path: 'data/reference/capabilities.json'
    readonly entryCount: 83
    readonly bytes: number
    readonly sha256: typeof CAPABILITY_CANONICAL_SOURCE_SHA256
    readonly gitBlob: typeof CAPABILITY_CANONICAL_SOURCE_GIT_BLOB
  }
  readonly parser: {
    readonly path: 'ptu-data/parse_capabilities.py'
    readonly bytes: number
    readonly sha256: string
    readonly gitBlob: string
  }
  readonly sourcePriority: readonly CapabilityAutomationRulesetSource[]
  readonly precedencePolicy: string
  readonly runtimeAuthority: 'data/reference/capabilities.json'
  readonly reviewPolicy: {
    readonly sourceDrift: 'fail-closed'
    readonly unknownCapability: string
    readonly ambiguousRule: string
    readonly clientAuthority: 'none'
  }
}

export class CapabilityAutomationRulesetValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'CapabilityAutomationRulesetValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const fail = (path: string, detail: string): never => { throw new CapabilityAutomationRulesetValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'must be a plain object.')
  return value as UnknownRecord
}
const text = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !value || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(path, 'must be non-empty, trimmed text.')
  }
  return value as string
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(path, 'must be a non-negative safe integer.')
  return value as number
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) fail(path, `has invalid fields (missing ${missing.join(', ') || 'none'}; unknown ${unknown.join(', ') || 'none'}).`)
}
const sha = (value: unknown, path: string): string => {
  const parsed = text(value, path)
  if (!/^[0-9a-f]{64}$/.test(parsed)) fail(path, 'must be a lowercase SHA-256 digest.')
  return parsed
}
const blob = (value: unknown, path: string): string => {
  const parsed = text(value, path)
  if (!/^[0-9a-f]{40}$/.test(parsed)) fail(path, 'must be a lowercase Git object ID.')
  return parsed
}

export const parseCapabilityAutomationRuleset = (value: unknown): CapabilityAutomationRuleset => {
  const root = record(value, 'ruleset')
  exact(root, ['schemaVersion', 'rulesetId', 'canonicalSource', 'parser', 'sourcePriority', 'precedencePolicy', 'runtimeAuthority', 'reviewPolicy'], 'ruleset')
  if (root.schemaVersion !== CAPABILITY_AUTOMATION_RULESET_SCHEMA_VERSION) fail('ruleset.schemaVersion', 'is unsupported.')
  if (root.rulesetId !== CAPABILITY_AUTOMATION_RULESET_ID) fail('ruleset.rulesetId', 'does not match the reviewed ruleset.')

  const canonical = record(root.canonicalSource, 'ruleset.canonicalSource')
  exact(canonical, ['path', 'entryCount', 'bytes', 'sha256', 'gitBlob'], 'ruleset.canonicalSource')
  if (canonical.path !== 'data/reference/capabilities.json' || canonical.entryCount !== 83) fail('ruleset.canonicalSource', 'does not identify the frozen 83-entry corpus.')
  if (canonical.sha256 !== CAPABILITY_CANONICAL_SOURCE_SHA256 || canonical.gitBlob !== CAPABILITY_CANONICAL_SOURCE_GIT_BLOB) {
    fail('ruleset.canonicalSource', 'digest does not match the reviewed corpus.')
  }
  integer(canonical.bytes, 'ruleset.canonicalSource.bytes')

  const parser = record(root.parser, 'ruleset.parser')
  exact(parser, ['path', 'bytes', 'sha256', 'gitBlob'], 'ruleset.parser')
  if (parser.path !== 'ptu-data/parse_capabilities.py') fail('ruleset.parser.path', 'is unsupported.')
  integer(parser.bytes, 'ruleset.parser.bytes')
  sha(parser.sha256, 'ruleset.parser.sha256')
  blob(parser.gitBlob, 'ruleset.parser.gitBlob')

  if (!Array.isArray(root.sourcePriority) || root.sourcePriority.length !== 8) fail('ruleset.sourcePriority', 'must contain all eight precedence sources.')
  const seenPaths = new Set<string>()
  const seenBasenames = new Set<string>()
  const sources = (root.sourcePriority as unknown[]).map((candidate, index) => {
    const path = `ruleset.sourcePriority[${index}]`
    const source = record(candidate, path)
    exact(source, ['priority', 'path', 'basename', 'bytes', 'sha256', 'gitBlob'], path)
    if (source.priority !== index) fail(`${path}.priority`, 'must equal its zero-based precedence position.')
    const sourcePath = text(source.path, `${path}.path`)
    const basename = text(source.basename, `${path}.basename`)
    if (seenPaths.has(sourcePath) || seenBasenames.has(basename)) fail(path, 'duplicates a source identity.')
    seenPaths.add(sourcePath); seenBasenames.add(basename)
    return {
      priority: index,
      path: sourcePath,
      basename,
      bytes: integer(source.bytes, `${path}.bytes`),
      sha256: sha(source.sha256, `${path}.sha256`),
      gitBlob: blob(source.gitBlob, `${path}.gitBlob`),
    }
  })

  const policy = record(root.reviewPolicy, 'ruleset.reviewPolicy')
  exact(policy, ['sourceDrift', 'unknownCapability', 'ambiguousRule', 'clientAuthority'], 'ruleset.reviewPolicy')
  if (root.runtimeAuthority !== 'data/reference/capabilities.json'
    || policy.sourceDrift !== 'fail-closed'
    || policy.clientAuthority !== 'none') fail('ruleset', 'weakens the reviewed authority policy.')

  return Object.freeze({
    schemaVersion: 1,
    rulesetId: CAPABILITY_AUTOMATION_RULESET_ID,
    canonicalSource: Object.freeze({
      path: 'data/reference/capabilities.json', entryCount: 83,
      bytes: canonical.bytes as number,
      sha256: CAPABILITY_CANONICAL_SOURCE_SHA256,
      gitBlob: CAPABILITY_CANONICAL_SOURCE_GIT_BLOB,
    }),
    parser: Object.freeze({
      path: 'ptu-data/parse_capabilities.py', bytes: parser.bytes as number,
      sha256: parser.sha256 as string, gitBlob: parser.gitBlob as string,
    }),
    sourcePriority: Object.freeze(sources),
    precedencePolicy: text(root.precedencePolicy, 'ruleset.precedencePolicy'),
    runtimeAuthority: 'data/reference/capabilities.json',
    reviewPolicy: Object.freeze({
      sourceDrift: 'fail-closed',
      unknownCapability: text(policy.unknownCapability, 'ruleset.reviewPolicy.unknownCapability'),
      ambiguousRule: text(policy.ambiguousRule, 'ruleset.reviewPolicy.ambiguousRule'),
      clientAuthority: 'none',
    }),
  })
}

export const CAPABILITY_AUTOMATION_RULESET = parseCapabilityAutomationRuleset(rulesetJson)
