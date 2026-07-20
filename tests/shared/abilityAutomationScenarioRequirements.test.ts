import { describe, expect, it } from 'vitest'
import requirementsJson from '../../data/ability-automation/scenario-requirements.json'
import {
  ABILITY_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS,
  AbilityAutomationScenarioRequirementValidationError,
  parseAbilityAutomationScenarioRequirementCatalog,
  type AbilityAutomationScenarioRequirementValidationCode,
} from '#shared/abilityAutomation/scenarioRequirements'

const evidenceClass = (code: string) => ({ code, summary: `Evidence for ${code}.` })
const requirement = (tag: string, requiredEvidenceClasses: readonly string[]) => ({
  tag,
  summary: `Requirement for ${tag}.`,
  requiredEvidenceClasses,
})
const catalogWith = (evidenceClasses: unknown[], requirements: unknown[]) => ({
  schemaVersion: 1,
  evidenceClasses,
  requirements,
})

const expectRequirementError = (
  value: unknown,
  code: AbilityAutomationScenarioRequirementValidationCode,
  path?: string,
): void => {
  try {
    parseAbilityAutomationScenarioRequirementCatalog(value)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityAutomationScenarioRequirementValidationError)
    expect((error as AbilityAutomationScenarioRequirementValidationError).code).toBe(code)
    if (path) expect((error as AbilityAutomationScenarioRequirementValidationError).path).toBe(path)
  }
}

describe('ability automation scenario requirement catalog', () => {
  it('maps every evidence class into at least one closed semantic requirement', () => {
    const catalog = parseAbilityAutomationScenarioRequirementCatalog(requirementsJson)
    const classes = new Set(catalog.evidenceClasses.map(entry => entry.code))
    const byTag = new Map(catalog.requirements.map(entry => [entry.tag, entry]))

    expect(catalog.schemaVersion).toBe(1)
    expect(catalog.evidenceClasses).toHaveLength(48)
    expect(catalog.requirements).toHaveLength(30)
    expect(byTag.get('mode.static')?.requiredEvidenceClasses)
      .toEqual(['passive-applied', 'passive-suppressed'])
    expect(byTag.get('mode.activated')?.requiredEvidenceClasses)
      .toEqual(['active-accepted', 'active-rejected'])
    expect(byTag.get('mode.triggered')?.requiredEvidenceClasses)
      .toEqual(['trigger-eligible', 'trigger-ineligible'])
    expect(byTag.get('mechanic.usage')?.requiredEvidenceClasses)
      .toEqual(['usage-spent', 'usage-exhausted', 'usage-reset'])
    expect(byTag.get('privacy.hidden')?.requiredEvidenceClasses).toEqual(['redacted-view'])
    expect(catalog.requirements.every(entry => (
      entry.requiredEvidenceClasses.every(evidenceClass => classes.has(evidenceClass))
    ))).toBe(true)
  })

  it('rejects unknown fields, malformed IDs, and empty requirement mappings', () => {
    expectRequirementError(
      { ...catalogWith([evidenceClass('hit')], [requirement('mechanic.damage', ['hit'])]), extra: true },
      'invalid-scenario-requirements',
      'scenarioRequirements',
    )
    expectRequirementError(
      catalogWith(
        [{ ...evidenceClass('hit'), executable: true }],
        [requirement('mechanic.damage', ['hit'])],
      ),
      'invalid-scenario-requirements',
      'scenarioRequirements.evidenceClasses[0]',
    )
    expectRequirementError(
      catalogWith([evidenceClass('Not Stable')], [requirement('mechanic.damage', ['Not Stable'])]),
      'invalid-scenario-requirements',
      'scenarioRequirements.evidenceClasses[0].code',
    )
    expectRequirementError(
      catalogWith([evidenceClass('hit')], [requirement('mechanic.damage', [])]),
      'invalid-scenario-requirements',
      'scenarioRequirements.requirements[0].requiredEvidenceClasses',
    )
  })

  it('rejects duplicate, unknown, unused, and excessive definitions', () => {
    expectRequirementError(
      catalogWith(
        [evidenceClass('hit'), evidenceClass('hit')],
        [requirement('mechanic.damage', ['hit'])],
      ),
      'duplicate-evidence-class',
      'scenarioRequirements.evidenceClasses',
    )
    expectRequirementError(
      catalogWith(
        [evidenceClass('hit')],
        [requirement('mechanic.damage', ['hit']), requirement('mechanic.damage', ['hit'])],
      ),
      'duplicate-requirement-tag',
      'scenarioRequirements.requirements',
    )
    expectRequirementError(
      catalogWith([evidenceClass('hit')], [requirement('mechanic.damage', ['miss'])]),
      'unknown-evidence-class',
      'scenarioRequirements.requirements[0].requiredEvidenceClasses[0]',
    )
    expectRequirementError(
      catalogWith(
        [evidenceClass('hit'), evidenceClass('miss')],
        [requirement('mechanic.damage', ['hit'])],
      ),
      'unused-evidence-class',
      'scenarioRequirements.evidenceClasses[1].code',
    )
    expectRequirementError(
      catalogWith(
        Array.from(
          { length: ABILITY_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS.evidenceClasses + 1 },
          (_, index) => evidenceClass(`class-${index}`),
        ),
        [requirement('mechanic.damage', ['class-0'])],
      ),
      'limit-exceeded',
      'scenarioRequirements.evidenceClasses',
    )
  })
})
