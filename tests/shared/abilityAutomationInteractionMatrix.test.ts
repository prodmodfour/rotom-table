import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import capabilityCatalogJson from '../../data/ability-automation/capabilities.json'
import interactionMatrixJson from '../../data/ability-automation/interaction-matrix.json'
import manifestJson from '../../data/ability-automation/manifest.json'
import rulesetJson from '../../data/ability-automation/ruleset.json'
import scenarioRequirementsJson from '../../data/ability-automation/scenario-requirements.json'
import {
  ABILITY_AUTOMATION_INTERACTION_DOMAINS,
  parseAbilityAutomationInteractionMatrix,
} from '#shared/abilityAutomation/interactionMatrix'
import { parseAbilityAutomationManifest } from '#shared/abilityAutomation/manifest'
import { loadCanonicalAbilityCatalog } from '#shared/abilityAutomation/ruleset'
import { abilityAutomationInteractionReviewSha256 } from '~~/server/domain/abilityAutomation/interactionMatrix'

const root = resolve(import.meta.dirname, '../..')

describe('ability automation interaction matrix', () => {
  it('binds every complete manifest row to all separately reviewed domains', async () => {
    const matrix = parseAbilityAutomationInteractionMatrix(interactionMatrixJson)
    const catalog = await loadCanonicalAbilityCatalog(
      readFileSync(resolve(root, 'data/reference/abilities.json')),
    )
    const manifest = parseAbilityAutomationManifest(
      manifestJson,
      catalog,
      capabilityCatalogJson,
      scenarioRequirementsJson,
    )

    expect(matrix.rulesetId).toBe(rulesetJson.rulesetId)
    expect(matrix.sourceDataSha256).toBe(rulesetJson.sourceData.sha256)
    expect(matrix.canonicalAbilityCount).toBe(manifest.abilities.length)
    expect(matrix.reviewedManifestSha256).toBe(
      abilityAutomationInteractionReviewSha256(manifest),
    )
    expect(matrix.domains.map(domain => domain.id)).toEqual(
      ABILITY_AUTOMATION_INTERACTION_DOMAINS,
    )
    expect(manifest.abilities.every(record => (
      record.baseStatus === 'complete'
      && record.interactionStatus === 'complete'
      && record.unsupportedInteractionIds.length === 0
    ))).toBe(true)
  })

  it('links every domain and cross-domain claim to executable repository evidence', () => {
    const matrix = parseAbilityAutomationInteractionMatrix(interactionMatrixJson)
    const files = [
      ...matrix.domains.flatMap(domain => domain.evidenceFiles),
      ...matrix.crossDomainEvidenceFiles,
    ]
    expect([...new Set(files)].every(file => existsSync(resolve(root, file)))).toBe(true)
  })

  it('rejects drift, missing domains, unsupported statuses, and unordered evidence', () => {
    expect(() => parseAbilityAutomationInteractionMatrix({
      ...interactionMatrixJson,
      reviewedManifestSha256: '0'.repeat(63),
    })).toThrow(/reviewedManifestSha256/)
    expect(() => parseAbilityAutomationInteractionMatrix({
      ...interactionMatrixJson,
      domains: interactionMatrixJson.domains.slice(1),
    })).toThrow(/every closed interaction domain/)
    expect(() => parseAbilityAutomationInteractionMatrix({
      ...interactionMatrixJson,
      domains: interactionMatrixJson.domains.map((domain, index) => (
        index === 0 ? { ...domain, status: 'partial' } : domain
      )),
    })).toThrow(/status/)
    expect(() => parseAbilityAutomationInteractionMatrix({
      ...interactionMatrixJson,
      crossDomainEvidenceFiles: [...interactionMatrixJson.crossDomainEvidenceFiles].reverse(),
    })).toThrow(/deterministic code-point order/)
  })
})
