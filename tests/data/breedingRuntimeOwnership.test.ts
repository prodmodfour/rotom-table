import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')

interface FactOwner {
  id: string
  authority: string
  writeOwner: string
  ownerTicket: string
  readers: string[]
  prohibitedWriters: string[]
  existingAuthority?: boolean
}
interface OwnershipMap {
  schemaVersion: number
  mapId: string
  rulesetId: string
  rulesetDefinitionSha256: string
  securityDefinitionSha256: string
  sourceManifestSha256: string
  definitionSha256: string
  definition: {
    facts: FactOwner[]
    aggregateRepositories: Array<{ aggregate: string, plannedPath?: string, existingPath?: string, ownerTicket: string }>
    transactionBoundaries: Array<{ id: string, members: string[], commit: string }>
    apiBoundaries: Record<string, string>
    moduleLayers: Array<{ id: string, plannedRoot: string, mayImport: string[], mustNotImport: string[] }>
    singleAuthorityRules: string[]
  }
}

const ownership = readJson<OwnershipMap>('data/breeding-automation/ownership-map.json')
const ruleset = readJson<{ rulesetId: string, definitionSha256: string }>('data/breeding-automation/ruleset.json')
const security = readJson<{ definitionSha256: string }>('data/breeding-automation/security-policy.json')

describe('breeding runtime architecture and ownership', () => {
  it('is bound to the source, ruleset, and security policy', () => {
    expect(ownership).toMatchObject({
      schemaVersion: 1,
      mapId: 'breeding-runtime-ownership-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      securityDefinitionSha256: security.definitionSha256,
    })
    expect(ownership.sourceManifestSha256).toBe(sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))))
    expect(ownership.definitionSha256).toBe(sha256(stableJsonStringify(ownership.definition)))
  })

  it('assigns every fact one server or reviewed-migration writer and explicit prohibited writers', () => {
    expect(ownership.definition.facts).toHaveLength(22)
    expect(new Set(ownership.definition.facts.map(fact => fact.id)).size).toBe(ownership.definition.facts.length)
    for (const fact of ownership.definition.facts) {
      expect(fact.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(fact.authority.trim(), fact.id).not.toBe('')
      expect(fact.writeOwner.trim(), fact.id).not.toBe('')
      expect(fact.ownerTicket, fact.id).toMatch(/^BR-\d{3}$/)
      expect(fact.readers.length, fact.id).toBeGreaterThan(0)
      expect(fact.prohibitedWriters.length, fact.id).toBeGreaterThan(0)
      expect(new Set(fact.prohibitedWriters).size, fact.id).toBe(fact.prohibitedWriters.length)
      expect(['browser', 'vue', 'map-command-executor', 'runtime-prose-parser']).not.toContain(fact.writeOwner)
    }
    expect(ownership.definition.facts.find(fact => fact.id === 'pokemon-egg')).toMatchObject({
      authority: 'pokemon-egg-repository',
      writeOwner: 'server/useCases/pokemonEggs',
      prohibitedWriters: ['pokemon-sheet-repository-before-hatch', 'map-metadata', 'inventory-row', 'browser'],
    })
    expect(ownership.definition.facts.find(fact => fact.id === 'child-pokemon-sheet')).toMatchObject({
      authority: 'sheet-repository-pokemon-kind',
      writeOwner: 'server/useCases/completeEggHatch',
    })
    expect(ownership.definition.facts.find(fact => fact.id === 'map-and-encounter-state')).toMatchObject({
      writeOwner: 'none',
      prohibitedWriters: ['breeding-project', 'pokemon-egg', 'incubation', 'hatch'],
    })
  })

  it('keeps dedicated aggregates separate while reusing exactly two existing sheet kinds', () => {
    expect(ownership.definition.aggregateRepositories.map(row => row.aggregate)).toEqual([
      'breeding-project',
      'pokemon-egg',
      'campaign-clock',
      'breeding-operation',
      'parent-consent',
      'species-acquisition',
      'pokemon-sheet',
      'trainer-sheet',
    ])
    expect(new Set(ownership.definition.aggregateRepositories.map(row => row.aggregate)).size)
      .toBe(ownership.definition.aggregateRepositories.length)
    const existing = ownership.definition.aggregateRepositories.filter(row => row.existingPath)
    expect(existing.map(row => row.aggregate)).toEqual(['pokemon-sheet', 'trainer-sheet'])
    for (const row of existing) expect(existsSync(resolve(ROOT, row.existingPath!)), row.aggregate).toBe(true)
    expect(ownership.definition.singleAuthorityRules).toContain('no-third-sheet-kind-for-eggs')
    expect(ownership.definition.singleAuthorityRules).toContain('no-map-scoped-breeding-command')
    expect(ownership.definition.singleAuthorityRules).toContain('no-second-child-construction-path')
    expect(ownership.definition.singleAuthorityRules).toContain('no-runtime-documentary-source')
  })

  it('freezes all-or-nothing project, production, clock, hatch, and restore boundaries', () => {
    expect(ownership.definition.transactionBoundaries.map(boundary => boundary.id)).toEqual([
      'project-mutation', 'egg-production', 'clock-advance', 'hatch', 'export-restore',
    ])
    for (const boundary of ownership.definition.transactionBoundaries) {
      expect(boundary.members.length, boundary.id).toBeGreaterThan(3)
      expect(new Set(boundary.members).size, boundary.id).toBe(boundary.members.length)
      expect(boundary.commit, boundary.id).toMatch(/transaction|all-or-nothing/)
    }
    expect(ownership.definition.transactionBoundaries.find(boundary => boundary.id === 'hatch')).toEqual({
      id: 'hatch',
      members: [
        'egg', 'child-sheet', 'trainer-link', 'species-acquisition',
        'first-species-reward', 'operation-result', 'audit-events',
      ],
      commit: 'single-sqlite-transaction',
    })
  })

  it('separates shared, domain, storage, use-case, API, and presentation imports', () => {
    expect(ownership.definition.moduleLayers.map(layer => layer.id)).toEqual([
      'shared-contracts', 'pure-domain', 'storage', 'use-cases', 'api', 'presentation',
    ])
    for (const layer of ownership.definition.moduleLayers) {
      expect(layer.plannedRoot.trim(), layer.id).not.toBe('')
      expect(layer.mayImport.length, layer.id).toBeGreaterThan(0)
      expect(layer.mustNotImport.length, layer.id).toBeGreaterThan(0)
    }
    expect(ownership.definition.apiBoundaries).toEqual({
      routePrefix: '/api/breeding',
      workshopPrefix: '/breeding',
      mapRouteDependency: 'none',
      commandParsing: 'exact-closed-versioned',
      resultProjection: 'audience-specific-server-schema',
      realtime: 'refresh-signal-after-commit',
    })
  })

  it('records the ADR, ownership guide, contributor workflow, operator recovery, and baseline', () => {
    const adr = readFileSync(resolve(ROOT, 'docs/adrs/018-authoritative-breeding-and-egg-runtime.md'), 'utf8')
    const architecture = readFileSync(resolve(ROOT, 'docs/breeding/architecture-and-ownership.md'), 'utf8')
    const contributor = readFileSync(resolve(ROOT, 'docs/breeding/contributor-guide.md'), 'utf8')
    const operator = readFileSync(resolve(ROOT, 'docs/breeding/operator-guide.md'), 'utf8')
    const baseline = readFileSync(resolve(ROOT, 'docs/breeding/baseline-audit.md'), 'utf8')

    expect(adr).toContain('There remain exactly two sheet kinds')
    expect(adr).toContain('Events publish only after commit.')
    expect(adr).toContain('map.metadata.capabilityEggs')
    expect(architecture).toContain('one writer for every fact')
    expect(architecture).toContain('Normal operations have no map slug')
    expect(contributor).toContain('Do not use web search to establish PTU identities')
    expect(contributor).toContain('Never use `Math.random` in an owning use case.')
    expect(operator).toContain('Do not represent edits to `eggMoves`')
    expect(operator).toContain('Retry the exact command with the same operation ID and bytes.')
    expect(baseline).toContain('No production path at the baseline can truthfully claim')
    expect(baseline).toContain('Level 100 checkpoint')
  })
})
