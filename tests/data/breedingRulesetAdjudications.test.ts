import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '#shared/automation/stableJson'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex')
const SHA256 = /^[0-9a-f]{64}$/
const GIT_OBJECT = /^[0-9a-f]{40}$/

interface FrozenSource { path: string, sha256: string }
interface SourceManifest {
  runtimeSources: FrozenSource[]
  reviewedAutomationContracts: FrozenSource[]
  productAuthority: FrozenSource[]
  documentarySources: FrozenSource[]
  parserBaselines: FrozenSource[]
}
interface CampaignOption {
  id: string
  kind: 'enum' | 'integer'
  default: string | number
  allowed?: string[]
  minimum?: number
  maximum?: number
  snapshot: string
  gmOnly: boolean
}
interface Ruleset {
  schemaVersion: number
  rulesetId: string
  status: string
  definitionSha256: string
  definition: {
    sourceManifestSha256: string
    campaignOptions: CampaignOption[]
    inheritance: { slotLevels: { first: number, interval: number, last: number }, illegalSlotPolicy: string }
    hatch: { fossilStartingLevel: number, specialRoll: { triggerValues: number[], automaticShiny: boolean } }
    project: { initialCampaignMinutes: number, additionalCampaignMinutesOnSuccess: number, check: { dc: number } }
  }
}
interface Adjudication {
  id: string
  conflictId: string
  sourceEvidence: FrozenSource[]
  decision: string
  defaultPolicyId: string
  campaignOptionIds: string[]
  failureMode: string
  status: string
  canonicalDiagnostic?: Record<string, unknown>
}
interface Adjudications {
  schemaVersion: number
  rulesetId: string
  rulesetDefinitionSha256: string
  sourceManifestSha256: string
  status: string
  runtimeDocumentaryUse: string
  entries: Adjudication[]
}
interface BaselineAudit {
  schemaVersion: number
  auditId: string
  sourceBaselineGitCommit: string
  storageSchemaVersion: number
  codeInventory: Array<{ path: string, finding: string, bytes: number, sha256: string, gitBlob: string }>
  existingAuthority: Array<{ id: string, status: string }>
  missingAuthority: string[]
  canonicalDataDiagnostics: Record<string, unknown>
  acceptedBoundaries: string[]
}
interface PokedexRow {
  species: string
  source_gen?: string
  egg_groups?: string[]
  hatch_rate?: string | null
  abilities?: Record<string, string[]>
  tm_hm_moves?: Array<{ name?: string }>
  evolutions?: Array<{ stage?: number, species?: string }>
  evolution_stage?: number
}

const sourceManifest = readJson<SourceManifest>('data/breeding-automation/source-manifest.json')
const ruleset = readJson<Ruleset>('data/breeding-automation/ruleset.json')
const adjudications = readJson<Adjudications>('data/breeding-automation/source-adjudications.json')
const audit = readJson<BaselineAudit>('data/breeding-automation/baseline-audit.json')

const EXPECTED_CONFLICTS = [
  'parent-family-selection',
  'lowest-stage-and-form-root',
  'ditto-identity-and-group',
  'genderless-and-parent-roles',
  'undefined-maturity-threshold',
  'egg-group-vocabulary-drift',
  'missing-egg-group-versus-no-breeding',
  'hatch-duration-average-and-variation',
  'missing-hatch-duration',
  'special-hatch-not-automatic-shiny',
  'optional-baby-template',
  'fossil-created-eggs',
  'inheritance-candidate-pathways',
  'inheritance-prerequisite-empty-slot',
  'unknown-machine-move-identity',
  'unknown-ability-identity',
  'sparse-species-records',
  'legacy-generator-and-sheet-fields',
  'breeder-project-timeline-and-failure',
  'non-breeding-egg-producers',
] as const

const EXPECTED_OPTIONS = [
  'breeding.parent-family-policy',
  'breeding.maturity-policy',
  'breeding.minimum-maturity-level',
  'breeding.genderless-policy',
  'breeding.same-sex-policy',
  'breeding.form-root-policy',
  'breeding.hatch-duration-variation',
  'breeding.missing-hatch-duration-policy',
  'breeding.gm-hatch-duration-minutes',
  'breeding.hatch-special-policy',
  'breeding.baby-template-policy',
  'breeding.baby-template-stat-penalty',
  'breeding.fossil-inheritance-policy',
  'breeding.fossil-hatch-level',
  'breeding.check-failure-policy',
] as const

describe('versioned breeding ruleset and source adjudications', () => {
  it('freezes one hash-bound, server-authoritative default and a closed option registry', () => {
    const sourceManifestBytes = readFileSync(resolve(ROOT, 'data/breeding-automation/source-manifest.json'))
    expect(ruleset).toMatchObject({
      schemaVersion: 1,
      rulesetId: 'ptu-1.05-breeding-v1',
      status: 'reviewed',
      definition: {
        authority: {
          mechanics: 'server-only',
          randomness: 'persisted-replay-safe-roll-ledger',
          documentaryRuntimeUse: 'forbidden',
          unknownOrAmbiguous: 'fail-closed',
        },
      },
    })
    expect(ruleset.definition.sourceManifestSha256).toBe(sha256(sourceManifestBytes))
    expect(ruleset.definitionSha256).toMatch(SHA256)
    expect(sha256(stableJsonStringify(ruleset.definition))).toBe(ruleset.definitionSha256)
    expect(ruleset.definition.project).toMatchObject({
      initialCampaignMinutes: 240,
      additionalCampaignMinutesOnSuccess: 240,
      check: { dc: 12 },
    })
    expect(ruleset.definition.inheritance.slotLevels).toEqual({ first: 20, interval: 10, last: 100 })
    expect(ruleset.definition.inheritance.illegalSlotPolicy).toContain('leave-slot-empty')
    expect(ruleset.definition.hatch).toMatchObject({
      fossilStartingLevel: 10,
      specialRoll: { triggerValues: [1, 100], automaticShiny: false },
    })

    const optionIds = ruleset.definition.campaignOptions.map(option => option.id)
    expect(optionIds).toEqual(EXPECTED_OPTIONS)
    expect(new Set(optionIds).size).toBe(optionIds.length)
    for (const option of ruleset.definition.campaignOptions) {
      expect(option.gmOnly, option.id).toBe(true)
      expect(option.snapshot.trim(), option.id).not.toBe('')
      if (option.kind === 'enum') {
        expect(option.allowed, option.id).toContain(option.default)
        expect(new Set(option.allowed).size, option.id).toBe(option.allowed?.length)
      }
      else {
        expect(Number.isSafeInteger(option.default), option.id).toBe(true)
        expect(option.default as number, option.id).toBeGreaterThanOrEqual(option.minimum ?? Number.MIN_SAFE_INTEGER)
        expect(option.default as number, option.id).toBeLessThanOrEqual(option.maximum ?? Number.MAX_SAFE_INTEGER)
      }
    }
  })

  it('closes every recorded source conflict with source-bound evidence and fail-closed behavior', () => {
    expect(adjudications).toMatchObject({
      schemaVersion: 1,
      rulesetId: ruleset.rulesetId,
      rulesetDefinitionSha256: ruleset.definitionSha256,
      sourceManifestSha256: ruleset.definition.sourceManifestSha256,
      status: 'reviewed-no-open-runtime-conflicts',
      runtimeDocumentaryUse: 'forbidden',
    })
    expect(adjudications.entries.map(entry => entry.conflictId)).toEqual(EXPECTED_CONFLICTS)
    expect(new Set(adjudications.entries.map(entry => entry.id)).size).toBe(adjudications.entries.length)

    const frozenHashes = new Map([
      ...sourceManifest.runtimeSources,
      ...sourceManifest.reviewedAutomationContracts,
      ...sourceManifest.productAuthority,
      ...sourceManifest.documentarySources,
      ...sourceManifest.parserBaselines,
    ].map(source => [source.path, source.sha256]))
    const optionIds = new Set(ruleset.definition.campaignOptions.map(option => option.id))
    const referencedOptions = new Set<string>()

    for (const entry of adjudications.entries) {
      expect(entry.status, entry.id).toBe('accepted')
      expect(entry.decision.trim().length, entry.id).toBeGreaterThan(40)
      expect(entry.defaultPolicyId.trim(), entry.id).not.toBe('')
      expect(entry.failureMode, entry.id).toBe('unavailable-with-stable-diagnostic')
      expect(entry.sourceEvidence.length, entry.id).toBeGreaterThan(0)
      for (const evidence of entry.sourceEvidence) {
        expect(evidence.sha256, `${entry.id}:${evidence.path}`).toBe(frozenHashes.get(evidence.path))
      }
      for (const optionId of entry.campaignOptionIds) {
        expect(optionIds, `${entry.id}:${optionId}`).toContain(optionId)
        referencedOptions.add(optionId)
      }
    }
    expect(referencedOptions).toEqual(optionIds)
  })

  it('records a reproducible current-code and canonical-data conflict baseline', () => {
    expect(audit).toMatchObject({
      schemaVersion: 1,
      auditId: 'breeding-current-code-baseline-v1',
      storageSchemaVersion: 21,
    })
    expect(audit.sourceBaselineGitCommit).toMatch(GIT_OBJECT)
    expect(audit.codeInventory).toHaveLength(16)
    expect(new Set(audit.codeInventory.map(row => row.path)).size).toBe(audit.codeInventory.length)

    for (const row of audit.codeInventory) {
      expect(row.finding.trim().length, row.path).toBeGreaterThan(30)
      expect(row.sha256, row.path).toMatch(SHA256)
      expect(row.gitBlob, row.path).toMatch(GIT_OBJECT)
      const baselineBytes = execFileSync('git', ['show', `${audit.sourceBaselineGitCommit}:${row.path}`], { cwd: ROOT })
      expect(baselineBytes.byteLength, `${row.path} baseline bytes`).toBe(row.bytes)
      expect(sha256(baselineBytes), `${row.path} baseline SHA-256`).toBe(row.sha256)
      expect(execFileSync('git', ['rev-parse', `${audit.sourceBaselineGitCommit}:${row.path}`], { cwd: ROOT, encoding: 'utf8' }).trim()).toBe(row.gitBlob)
    }

    expect(audit.existingAuthority).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'edge-breeder-delegation', status: 'reusable' }),
      expect.objectContaining({ id: 'map-capability-eggs', status: 'must-retire' }),
      expect.objectContaining({ id: 'legacy-generator', status: 'documentary-only' }),
    ]))
    expect(audit.missingAuthority).toContain('pokemon-egg-aggregate')
    expect(audit.missingAuthority).toContain('authoritative-campaign-clock')
    expect(audit.acceptedBoundaries.some(boundary => boundary.includes('never become a third sheet kind'))).toBe(true)
  })

  it('keeps the audited canonical diagnostics truthful', () => {
    const pokedex = readJson<PokedexRow[]>('data/reference/pokedex.json')
    const moves = new Set(Object.keys(readJson<Record<string, unknown>>('data/reference/moves.json')))
    const abilities = new Set(Object.keys(readJson<Record<string, unknown>>('data/reference/abilities.json')))
    const species = new Set(pokedex.map(row => row.species))
    const unknownEvolutionTargets = new Set<string>()
    let unknownEvolutionReferences = 0
    let selfStageMismatches = 0
    let unknownAbilityAssignments = 0
    const unknownAbilityLabels = new Set<string>()
    const unknownMachineMoveLabels = new Set<string>()
    let unknownMachineMoveAssignments = 0

    for (const row of pokedex) {
      const evolutions = row.evolutions ?? []
      for (const evolution of evolutions) {
        if (!evolution.species || species.has(evolution.species)) continue
        unknownEvolutionTargets.add(evolution.species)
        unknownEvolutionReferences += 1
      }
      if (evolutions.length > 0) {
        const matchingStages = evolutions.filter(evolution => evolution.species === row.species).map(evolution => evolution.stage)
        if (!matchingStages.includes(row.evolution_stage)) selfStageMismatches += 1
      }
      for (const values of Object.values(row.abilities ?? {})) {
        for (const ability of values) {
          if (abilities.has(ability)) continue
          unknownAbilityLabels.add(ability)
          unknownAbilityAssignments += 1
        }
      }
      for (const machineMove of row.tm_hm_moves ?? []) {
        if (!machineMove.name || moves.has(machineMove.name)) continue
        unknownMachineMoveLabels.add(machineMove.name)
        unknownMachineMoveAssignments += 1
      }
    }

    // The closed Breeding baseline intentionally retains its original Façade
    // source identity. P8-001's reviewed successor normalized that one key to
    // Facade and therefore resolves the baseline's 947 documentary references
    // without silently rewriting the historical audit.
    expect([...unknownMachineMoveLabels]).toEqual([])
    expect(unknownMachineMoveAssignments).toBe(0)
    expect(audit.canonicalDataDiagnostics).toEqual({
      pokedexRecordCount: pokedex.length,
      completeLegacyShapeRecordCount: pokedex.filter(row => row.source_gen !== undefined).length,
      sparseRecordCount: pokedex.filter(row => row.source_gen === undefined).length,
      missingEggGroupRecordCount: pokedex.filter(row => !row.egg_groups?.length).length,
      missingHatchRateRecordCount: pokedex.filter(row => !row.hatch_rate).length,
      distinctEggGroupSourceValueCount: new Set(pokedex.flatMap(row => row.egg_groups ?? [])).size,
      unknownEvolutionTargetCount: unknownEvolutionTargets.size,
      unknownEvolutionReferenceCount: unknownEvolutionReferences,
      selfStageMismatchRecordCount: selfStageMismatches,
      missingBasicAbilityRecordCount: pokedex.filter(row => !row.abilities?.basic?.length).length,
      unknownAbilityLabelCount: unknownAbilityLabels.size,
      unknownAbilityAssignmentCount: unknownAbilityAssignments,
      unknownMachineMoveLabels: ['Facade'],
      unknownMachineMoveAssignmentCount: 947,
    })
  })
})
