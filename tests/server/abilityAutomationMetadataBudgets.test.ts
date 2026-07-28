import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import actionExceptionsJson from '../../data/ability-automation/action-exceptions.json'
import capabilitiesJson from '../../data/ability-automation/capabilities.json'
import frequencyExceptionsJson from '../../data/ability-automation/frequency-exceptions.json'
import legacyBaselineJson from '../../data/ability-automation/legacy-baseline.json'
import manifestJson from '../../data/ability-automation/manifest.json'
import parameterDefinitionsJson from '../../data/ability-automation/parameter-definitions.json'
import privacyMatrixJson from '../../data/ability-automation/privacy-matrix.json'
import protectionsJson from '../../data/ability-automation/protections.json'
import requirementsJson from '../../data/ability-automation/scenario-requirements.json'
import timingConstraintsJson from '../../data/ability-automation/timing-constraints.json'
import {
  ABILITY_AUTOMATION_CAPABILITY_LIMITS,
  parseAbilityAutomationCapabilityCatalog,
} from '#shared/abilityAutomation/capabilities'
import {
  parseAbilityActionExceptionCatalog,
  parseCanonicalAbilityActions,
} from '#shared/abilityAutomation/actionEconomy'
import {
  parseAbilityFrequencyExceptionCatalog,
  parseCanonicalAbilityFrequencies,
} from '#shared/abilityAutomation/frequency'
import { parseAbilityAutomationLegacyBaseline } from '#shared/abilityAutomation/legacyBaseline'
import { parseAbilityAutomationPrivacyMatrix } from '#shared/abilityAutomation/privacy'
import { parseAbilityParameterDefinitionCatalog } from '#shared/abilityAutomation/parameters'
import { parseAbilityProtectionCatalog } from '#shared/abilityAutomation/protections'
import {
  ABILITY_AUTOMATION_MANIFEST_LIMITS,
  parseAbilityAutomationManifest,
} from '#shared/abilityAutomation/manifest'
import { loadCanonicalAbilityCatalog } from '#shared/abilityAutomation/ruleset'
import { parseAbilityTimingConstraintCatalog } from '#shared/abilityAutomation/timingConstraints'
import {
  ABILITY_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS,
  parseAbilityAutomationScenarioRequirementCatalog,
} from '#shared/abilityAutomation/scenarioRequirements'

const root = process.cwd()
const path = (relative: string): string => join(root, relative)

describe('ability automation metadata budgets', () => {
  it('keeps catalogs, manifest, and plan within bounded reviewable sizes', () => {
    // The evidence-complete 483-row catalog remains bounded after final rollout.
    expect(statSync(path('data/ability-automation/manifest.json')).size).toBeLessThan(1280 * 1024)
    expect(statSync(path('data/ability-automation/action-exceptions.json')).size).toBeLessThan(32 * 1024)
    expect(statSync(path('data/ability-automation/capabilities.json')).size).toBeLessThan(128 * 1024)
    expect(statSync(path('data/ability-automation/frequency-exceptions.json')).size).toBeLessThan(32 * 1024)
    expect(statSync(path('data/ability-automation/legacy-baseline.json')).size).toBeLessThan(128 * 1024)
    expect(statSync(path('data/ability-automation/parameter-definitions.json')).size).toBeLessThan(32 * 1024)
    expect(statSync(path('data/ability-automation/privacy-matrix.json')).size).toBeLessThan(128 * 1024)
    expect(statSync(path('data/ability-automation/protections.json')).size).toBeLessThan(32 * 1024)
    expect(statSync(path('data/ability-automation/scenario-requirements.json')).size).toBeLessThan(128 * 1024)
    expect(statSync(path('data/ability-automation/timing-constraints.json')).size).toBeLessThan(32 * 1024)
    expect(statSync(path('implementation-plans/ABILITY_AUTOMATION_PLAN.md')).size).toBeLessThan(128 * 1024)
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
    const frequencyExceptions = parseAbilityFrequencyExceptionCatalog(frequencyExceptionsJson, catalog)
    const frequencies = parseCanonicalAbilityFrequencies(catalog, frequencyExceptions)
    const actionExceptions = parseAbilityActionExceptionCatalog(actionExceptionsJson, catalog, frequencies)
    parseCanonicalAbilityActions(catalog, frequencies, actionExceptions)
    parseAbilityTimingConstraintCatalog(timingConstraintsJson, catalog)
    parseAbilityAutomationScenarioRequirementCatalog(requirementsJson)
    parseAbilityAutomationLegacyBaseline(legacyBaselineJson, catalog)
    parseAbilityAutomationPrivacyMatrix(privacyMatrixJson)
    parseAbilityProtectionCatalog(protectionsJson, catalog)
    parseAbilityParameterDefinitionCatalog(parameterDefinitionsJson, catalog)
    const manifest = parseAbilityAutomationManifest(manifestJson, catalog)
    const elapsedMs = performance.now() - startedAt

    expect(manifest.abilities).toHaveLength(483)
    expect(elapsedMs).toBeLessThan(2_000)
  })
})
