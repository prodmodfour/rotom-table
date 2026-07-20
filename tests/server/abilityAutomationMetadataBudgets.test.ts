import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import capabilitiesJson from '../../data/ability-automation/capabilities.json'
import legacyBaselineJson from '../../data/ability-automation/legacy-baseline.json'
import manifestJson from '../../data/ability-automation/manifest.json'
import privacyMatrixJson from '../../data/ability-automation/privacy-matrix.json'
import requirementsJson from '../../data/ability-automation/scenario-requirements.json'
import {
  ABILITY_AUTOMATION_CAPABILITY_LIMITS,
  parseAbilityAutomationCapabilityCatalog,
} from '#shared/abilityAutomation/capabilities'
import { parseAbilityAutomationLegacyBaseline } from '#shared/abilityAutomation/legacyBaseline'
import { parseAbilityAutomationPrivacyMatrix } from '#shared/abilityAutomation/privacy'
import {
  ABILITY_AUTOMATION_MANIFEST_LIMITS,
  parseAbilityAutomationManifest,
} from '#shared/abilityAutomation/manifest'
import { loadCanonicalAbilityCatalog } from '#shared/abilityAutomation/ruleset'
import {
  ABILITY_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS,
  parseAbilityAutomationScenarioRequirementCatalog,
} from '#shared/abilityAutomation/scenarioRequirements'

const root = process.cwd()
const path = (relative: string): string => join(root, relative)

describe('ability automation metadata budgets', () => {
  it('keeps catalogs, manifest, and plan within bounded reviewable sizes', () => {
    expect(statSync(path('data/ability-automation/manifest.json')).size).toBeLessThan(1024 * 1024)
    expect(statSync(path('data/ability-automation/capabilities.json')).size).toBeLessThan(128 * 1024)
    expect(statSync(path('data/ability-automation/legacy-baseline.json')).size).toBeLessThan(128 * 1024)
    expect(statSync(path('data/ability-automation/privacy-matrix.json')).size).toBeLessThan(128 * 1024)
    expect(statSync(path('data/ability-automation/scenario-requirements.json')).size).toBeLessThan(128 * 1024)
    expect(statSync(path('ABILITY_AUTOMATION_PLAN.md')).size).toBeLessThan(128 * 1024)
    expect(manifestJson.abilities.length).toBeLessThanOrEqual(ABILITY_AUTOMATION_MANIFEST_LIMITS.records)
    expect(capabilitiesJson.capabilities.length).toBeLessThanOrEqual(
      ABILITY_AUTOMATION_CAPABILITY_LIMITS.capabilities,
    )
    expect(requirementsJson.evidenceClasses.length).toBeLessThanOrEqual(
      ABILITY_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS.evidenceClasses,
    )
    expect(requirementsJson.requirements.length).toBeLessThanOrEqual(
      ABILITY_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS.requirements,
    )
  })

  it('parses the full bootstrap metadata well below the startup guardrail', async () => {
    const startedAt = performance.now()
    const catalog = await loadCanonicalAbilityCatalog(
      readFileSync(path('data/reference/abilities.json')),
    )
    parseAbilityAutomationCapabilityCatalog(capabilitiesJson, catalog)
    parseAbilityAutomationScenarioRequirementCatalog(requirementsJson)
    parseAbilityAutomationLegacyBaseline(legacyBaselineJson, catalog)
    parseAbilityAutomationPrivacyMatrix(privacyMatrixJson)
    const manifest = parseAbilityAutomationManifest(manifestJson, catalog)
    const elapsedMs = performance.now() - startedAt

    expect(manifest.abilities).toHaveLength(483)
    expect(elapsedMs).toBeLessThan(2_000)
  })
})
