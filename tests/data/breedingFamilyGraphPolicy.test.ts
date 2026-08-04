import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')

interface Policy {
  schemaVersion: number
  policyId: string
  rulesetId: string
  rulesetDefinitionSha256: string
  taxonomyDefinitionSha256: string
  sourceManifestSha256: string
  definitionSha256: string
  definition: {
    nodePolicy: Record<string, unknown>
    sourceEvolutionPolicy: Record<string, unknown>
    edgeKinds: Array<{ id: string, directed: boolean, connectsReproductiveFamily: boolean }>
    familyInvariants: string[]
    rootSelection: Record<string, string>
    branchPolicy: Record<string, unknown>
    formPolicy: Record<string, unknown>
    compiledFamilySpecRequirements: string[]
    determinism: Record<string, string>
    failureReasonIds: string[]
    currentSourceDiagnostics: Record<string, unknown>
    compilerAcceptance: Record<string, unknown>
  }
}
interface PokedexRow {
  species: string
  evolution_stage?: number
  evolutions?: Array<{ stage?: number, species?: string }>
}

const policy = readJson<Policy>('data/breeding-automation/family-graph-policy.json')
const ruleset = readJson<{ rulesetId: string, definitionSha256: string }>('data/breeding-automation/ruleset.json')
const taxonomy = readJson<{ definitionSha256: string, definition: { formKinds: Array<{ id: string }> } }>('data/breeding-automation/taxonomies.json')

interface GraphEdge { from: string, to: string }
const resolveRoot = (nodes: readonly string[], edges: readonly GraphEdge[]): string | null => {
  const nodeSet = new Set(nodes)
  if (nodeSet.size !== nodes.length || edges.some(edge => !nodeSet.has(edge.from) || !nodeSet.has(edge.to))) return null
  const incoming = new Map(nodes.map(node => [node, 0]))
  const outgoing = new Map(nodes.map(node => [node, [] as string[]]))
  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
    outgoing.get(edge.from)?.push(edge.to)
  }
  const roots = nodes.filter(node => incoming.get(node) === 0)
  if (roots.length !== 1) return null
  const visited = new Set<string>()
  const active = new Set<string>()
  const visit = (node: string): boolean => {
    if (active.has(node)) return false
    if (visited.has(node)) return true
    active.add(node)
    for (const child of outgoing.get(node) ?? []) if (!visit(child)) return false
    active.delete(node)
    visited.add(node)
    return true
  }
  if (!visit(roots[0]!) || visited.size !== nodes.length) return null
  return roots[0]!
}

describe('breeding evolution-family graph policy', () => {
  it('is hash-bound to the source, ruleset, and taxonomy definitions', () => {
    expect(policy).toMatchObject({
      schemaVersion: 1,
      policyId: 'ptu-1.05-breeding-family-graph-policy-v1',
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      taxonomyDefinitionSha256: taxonomy.definitionSha256,
    })
    expect(policy.sourceManifestSha256).toBe(sha256(readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))))
    expect(policy.definitionSha256).toBe(sha256(stableJsonStringify(policy.definition)))
  })

  it('requires exact canonical nodes and rejects runtime repair or name-pattern form inference', () => {
    expect(policy.definition.nodePolicy).toMatchObject({
      canonicalSourcePath: 'data/reference/pokedex.json',
      identityField: 'species',
      identityComparison: 'exact-canonical-id',
      runtimeNameNormalization: 'forbidden',
      unknownNode: 'reject-edge-and-exclude-affected-family',
      sparseNode: 'exclude-until-source-bound-adjudication',
    })
    expect(policy.definition.sourceEvolutionPolicy).toMatchObject({
      acceptedTarget: 'exact-existing-canonical-species-id-only',
      embeddedConditionInTarget: 'reject-not-strip',
      sameStageEntries: 'branch-siblings-not-edges',
      decreasingOrSkippedStage: 'requires-adjudication',
      recordEvolutionStage: 'diagnostic-cross-check-only',
    })
    expect(policy.definition.formPolicy).toMatchObject({
      classification: 'explicit-form-kind-and-root-policy-only',
      speciesNamePatternInference: 'forbidden',
      baseFamilyFallback: 'explicit-reviewed-edge-only',
    })

    const formKinds = taxonomy.definition.formKinds.map(row => row.id)
    for (const formKind of formKinds) {
      expect(policy.definition.formPolicy, formKind).toHaveProperty(formKind)
    }
  })

  it('freezes closed edge kinds, family invariants, root behavior, and compiled outputs', () => {
    expect(policy.definition.edgeKinds).toEqual([
      { id: 'evolves-to', directed: true, connectsReproductiveFamily: true },
      { id: 'branch-evolves-to', directed: true, connectsReproductiveFamily: true },
      { id: 'regional-lineage', directed: false, connectsReproductiveFamily: false },
      { id: 'form-variant', directed: false, connectsReproductiveFamily: false },
      { id: 'transformation', directed: false, connectsReproductiveFamily: false },
      { id: 'fusion', directed: false, connectsReproductiveFamily: false },
    ])
    expect(new Set(policy.definition.edgeKinds.map(edge => edge.id)).size).toBe(policy.definition.edgeKinds.length)
    expect(policy.definition.familyInvariants).toEqual([
      'directed-evolution-subgraph-is-acyclic',
      'exactly-one-reviewed-root-per-family',
      'root-has-no-incoming-evolution-edge',
      'every-non-root-node-is-reachable-from-root',
      'every-species-node-belongs-to-at-most-one-family',
      'branch-siblings-share-root-without-sibling-edge',
      'all-emitted-edge-targets-exist',
      'all-emitted-family-and-root-identities-are-canonical',
    ])
    expect(policy.definition.rootSelection).toMatchObject({
      candidate: 'unique-node-with-zero-incoming-evolution-edges',
      stageTieBreaker: 'none-fail-closed',
      multipleRoots: 'exclude-family',
      noRoot: 'exclude-family',
      cycle: 'exclude-family',
      operationTimeTraversal: 'forbidden-use-compiled-family-spec',
    })
    expect(policy.definition.compiledFamilySpecRequirements).toEqual([
      'family-id', 'family-root-species-id', 'offspring-root-species-id', 'member-species-ids',
      'directed-evolution-edges', 'form-policy-id-by-member', 'source-hashes', 'definition-hash',
    ])
    expect(policy.definition.compilerAcceptance).toMatchObject({
      unknownEmittedNodes: 0,
      cycles: 0,
      multiRootFamilies: 0,
      disconnectedEmittedMembers: 0,
      crossFamilyMemberships: 0,
      unclassifiedForms: 0,
      diagnosticForEveryExcludedRecord: true,
    })
  })

  it('makes linear and branch roots deterministic and rejects cycles, multiple roots, and disconnected components', () => {
    expect(resolveRoot(['root', 'middle', 'final'], [
      { from: 'root', to: 'middle' },
      { from: 'middle', to: 'final' },
    ])).toBe('root')
    expect(resolveRoot(['root', 'branch-a', 'branch-b'], [
      { from: 'root', to: 'branch-a' },
      { from: 'root', to: 'branch-b' },
    ])).toBe('root')
    expect(resolveRoot(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).toBeNull()
    expect(resolveRoot(['a', 'b'], [])).toBeNull()
    expect(resolveRoot(['root', 'child', 'isolated'], [{ from: 'root', to: 'child' }])).toBeNull()
    expect(resolveRoot(['root'], [{ from: 'root', to: 'missing' }])).toBeNull()
  })

  it('keeps current malformed graph facts diagnostic rather than executable', () => {
    const pokedex = readJson<PokedexRow[]>('data/reference/pokedex.json')
    const species = new Set(pokedex.map(row => row.species))
    const unknownTargets = new Set<string>()
    let unknownReferences = 0
    let selfStageMismatches = 0
    for (const row of pokedex) {
      const evolutions = row.evolutions ?? []
      for (const evolution of evolutions) {
        if (!evolution.species || species.has(evolution.species)) continue
        unknownTargets.add(evolution.species)
        unknownReferences += 1
      }
      if (evolutions.length > 0) {
        const matchingStages = evolutions.filter(evolution => evolution.species === row.species).map(evolution => evolution.stage)
        if (!matchingStages.includes(row.evolution_stage)) selfStageMismatches += 1
      }
    }
    expect(policy.definition.currentSourceDiagnostics).toEqual({
      pokedexRecordCount: pokedex.length,
      recordsWithEvolutionLists: pokedex.filter(row => (row.evolutions?.length ?? 0) > 0).length,
      recordsWithoutEvolutionLists: pokedex.filter(row => !row.evolutions?.length).length,
      unknownEvolutionTargetCount: unknownTargets.size,
      unknownEvolutionReferenceCount: unknownReferences,
      selfStageMismatchRecordCount: selfStageMismatches,
      emittedGraphPolicy: 'diagnose-and-exclude-never-repair-at-runtime',
    })
    expect(new Set(policy.definition.failureReasonIds).size).toBe(policy.definition.failureReasonIds.length)
    expect(policy.definition.failureReasonIds.every(id => /^breeding\.family\.[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))).toBe(true)
  })
})
