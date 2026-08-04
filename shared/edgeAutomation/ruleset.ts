import rulesetJson from '../../data/edge-automation/ruleset.json'

export const EDGE_AUTOMATION_RULESET_SCHEMA_VERSION = 1 as const
export const EDGE_AUTOMATION_RULESET_ID = 'ptu-1.05-edge-automation-v1' as const
export const TRAINER_EDGE_SOURCE_SHA256 = '62348f9f5e57c28a3b61bfc3f554bcad258a769b054f5531c1d07ae6853e2123' as const
export const POKE_EDGE_SOURCE_SHA256 = '3e2dbb84a8c35e4655b62ece57a3760a2b9a6e09b917dc8a581e5e613e14e021' as const

export interface EdgeAutomationCatalogProvenance {
  readonly path: string
  readonly entryCount: number
  readonly bytes: number
  readonly sha256: string
  readonly gitBlob: string
}

export interface EdgeAutomationRuleset {
  readonly schemaVersion: 1
  readonly rulesetId: typeof EDGE_AUTOMATION_RULESET_ID
  readonly runtimeAuthority: readonly ['data/reference/edges.json', 'data/reference/poke-edges.json']
  readonly catalogs: {
    readonly trainer: EdgeAutomationCatalogProvenance
    readonly poke: EdgeAutomationCatalogProvenance
  }
  readonly identityOrder: 'family-then-unicode-code-point'
  readonly unknownIdentityPolicy: 'preserve-for-maintenance-but-never-execute'
  readonly sourceDriftPolicy: 'fail-closed'
  readonly clientAuthority: 'none'
}

export class EdgeAutomationRulesetValidationError extends Error {
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'EdgeAutomationRulesetValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const fail = (path: string, detail: string): never => { throw new EdgeAutomationRulesetValidationError(path, detail) }
const record = (value: unknown, path: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'must be an object.')
  return value as UnknownRecord
}
const catalog = (value: unknown, family: 'trainer' | 'poke'): EdgeAutomationCatalogProvenance => {
  const row = record(value, `ruleset.catalogs.${family}`)
  const expected = family === 'trainer'
    ? { path: 'data/reference/edges.json', count: 61, sha256: TRAINER_EDGE_SOURCE_SHA256 }
    : { path: 'data/reference/poke-edges.json', count: 20, sha256: POKE_EDGE_SOURCE_SHA256 }
  if (row.path !== expected.path || row.entryCount !== expected.count || row.sha256 !== expected.sha256
    || !Number.isSafeInteger(row.bytes) || (row.bytes as number) <= 0
    || typeof row.gitBlob !== 'string' || !/^[0-9a-f]{40}$/.test(row.gitBlob)) {
    fail(`ruleset.catalogs.${family}`, 'does not match the frozen app-owned catalog.')
  }
  return Object.freeze({
    path: expected.path,
    entryCount: expected.count,
    bytes: row.bytes as number,
    sha256: expected.sha256,
    gitBlob: row.gitBlob as string,
  })
}

export const parseEdgeAutomationRuleset = (value: unknown): EdgeAutomationRuleset => {
  const root = record(value, 'ruleset')
  if (root.schemaVersion !== 1 || root.rulesetId !== EDGE_AUTOMATION_RULESET_ID) fail('ruleset', 'has an unsupported identity.')
  if (!Array.isArray(root.runtimeAuthority)
    || root.runtimeAuthority[0] !== 'data/reference/edges.json'
    || root.runtimeAuthority[1] !== 'data/reference/poke-edges.json'
    || root.runtimeAuthority.length !== 2
    || root.identityOrder !== 'family-then-unicode-code-point'
    || root.unknownIdentityPolicy !== 'preserve-for-maintenance-but-never-execute'
    || root.sourceDriftPolicy !== 'fail-closed'
    || root.clientAuthority !== 'none') fail('ruleset', 'weakens the reviewed authority policy.')
  const catalogs = record(root.catalogs, 'ruleset.catalogs')
  return Object.freeze({
    schemaVersion: 1,
    rulesetId: EDGE_AUTOMATION_RULESET_ID,
    runtimeAuthority: Object.freeze([
      'data/reference/edges.json',
      'data/reference/poke-edges.json',
    ] as const),
    catalogs: Object.freeze({ trainer: catalog(catalogs.trainer, 'trainer'), poke: catalog(catalogs.poke, 'poke') }),
    identityOrder: 'family-then-unicode-code-point',
    unknownIdentityPolicy: 'preserve-for-maintenance-but-never-execute',
    sourceDriftPolicy: 'fail-closed',
    clientAuthority: 'none',
  })
}

export const EDGE_AUTOMATION_RULESET = parseEdgeAutomationRuleset(rulesetJson)
