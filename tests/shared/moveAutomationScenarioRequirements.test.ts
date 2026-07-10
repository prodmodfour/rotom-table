import { describe, expect, it } from 'vitest'
import requirementsJson from '../../data/move-automation/scenario-requirements.json'
import {
  MOVE_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS,
  MoveAutomationScenarioRequirementValidationError,
  parseMoveAutomationScenarioRequirementCatalog,
  type MoveAutomationScenarioRequirementValidationCode,
} from '#shared/moveAutomation/scenarioRequirements'

const evidenceClass = (code: string) => ({
  code,
  summary: `Evidence for ${code}.`,
})

const requirement = (
  tag: string,
  requiredEvidenceClasses: readonly string[],
) => ({
  tag,
  summary: `Requirement for ${tag}.`,
  requiredEvidenceClasses,
})

const catalogWith = (
  evidenceClasses: readonly unknown[],
  requirements: readonly unknown[],
) => ({
  schemaVersion: 1,
  evidenceClasses,
  requirements,
})

const expectRequirementError = (
  value: unknown,
  code: MoveAutomationScenarioRequirementValidationCode,
  path?: string,
): void => {
  try {
    parseMoveAutomationScenarioRequirementCatalog(value)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveAutomationScenarioRequirementValidationError)
    expect((error as MoveAutomationScenarioRequirementValidationError).code).toBe(code)
    if (path) {
      expect((error as MoveAutomationScenarioRequirementValidationError).path).toBe(path)
    }
  }
}

describe('move automation scenario requirement catalog', () => {
  it('maps every reviewed mechanic and branch tag to explicit evidence classes', () => {
    const catalog = parseMoveAutomationScenarioRequirementCatalog(requirementsJson)
    const classes = new Set(catalog.evidenceClasses.map(entry => entry.code))
    const byTag = new Map(catalog.requirements.map(entry => [entry.tag, entry]))

    expect(catalog.schemaVersion).toBe(1)
    expect(classes).toEqual(new Set([
      'ally',
      'alternate-branch',
      'area-mixed-outcomes',
      'choice',
      'crit',
      'enemy',
      'hit',
      'immunity',
      'lifecycle-cleanup',
      'lifecycle-trigger',
      'miss',
      'multi-resource-conflict',
      'pass',
      'reconnect',
      'retry',
      'self',
      'threshold-fail',
      'threshold-pass',
    ]))
    expect(byTag.get('mechanic.damage')?.requiredEvidenceClasses)
      .toEqual(['hit', 'miss', 'crit', 'immunity'])
    expect(byTag.get('branch.threshold')?.requiredEvidenceClasses)
      .toEqual(['threshold-pass', 'threshold-fail'])
    expect(byTag.get('mechanic.lifecycle')?.requiredEvidenceClasses)
      .toEqual(['lifecycle-trigger', 'lifecycle-cleanup'])
    expect(byTag.get('interaction.choice')?.requiredEvidenceClasses)
      .toEqual(['choice', 'pass'])
    expect(byTag.get('resource.multi')?.requiredEvidenceClasses)
      .toEqual(['multi-resource-conflict'])
    expect([...byTag.values()].every(entry =>
      entry.requiredEvidenceClasses.every(evidence => classes.has(evidence)),
    )).toBe(true)
  })

  it('rejects unknown fields, malformed IDs, and empty requirement mappings', () => {
    expectRequirementError(
      { ...catalogWith([evidenceClass('hit')], [requirement('branch.accuracy', ['hit'])]), extra: true },
      'invalid-scenario-requirements',
      'scenarioRequirements',
    )
    expectRequirementError(
      catalogWith(
        [{ ...evidenceClass('hit'), executable: true }],
        [requirement('branch.accuracy', ['hit'])],
      ),
      'invalid-scenario-requirements',
      'scenarioRequirements.evidenceClasses[0]',
    )
    expectRequirementError(
      catalogWith([evidenceClass('Not Stable')], [requirement('branch.accuracy', ['Not Stable'])]),
      'invalid-scenario-requirements',
      'scenarioRequirements.evidenceClasses[0].code',
    )
    expectRequirementError(
      catalogWith([evidenceClass('hit')], [requirement('branch.accuracy', [])]),
      'invalid-scenario-requirements',
      'scenarioRequirements.requirements[0].requiredEvidenceClasses',
    )
  })

  it('rejects duplicate, unknown, unused, and excessive evidence definitions', () => {
    expectRequirementError(
      catalogWith(
        [evidenceClass('hit'), evidenceClass('hit')],
        [requirement('branch.accuracy', ['hit'])],
      ),
      'duplicate-evidence-class',
      'scenarioRequirements.evidenceClasses',
    )
    expectRequirementError(
      catalogWith(
        [evidenceClass('hit')],
        [requirement('branch.accuracy', ['hit']), requirement('branch.accuracy', ['hit'])],
      ),
      'duplicate-requirement-tag',
      'scenarioRequirements.requirements',
    )
    expectRequirementError(
      catalogWith([evidenceClass('hit')], [requirement('branch.accuracy', ['miss'])]),
      'unknown-evidence-class',
      'scenarioRequirements.requirements[0].requiredEvidenceClasses[0]',
    )
    expectRequirementError(
      catalogWith(
        [evidenceClass('hit'), evidenceClass('miss')],
        [requirement('branch.accuracy', ['hit'])],
      ),
      'unused-evidence-class',
      'scenarioRequirements.evidenceClasses[1].code',
    )
    expectRequirementError(
      catalogWith(
        Array.from(
          { length: MOVE_AUTOMATION_SCENARIO_REQUIREMENT_LIMITS.evidenceClasses + 1 },
          (_, index) => evidenceClass(`class-${index}`),
        ),
        [requirement('branch.accuracy', ['class-0'])],
      ),
      'limit-exceeded',
      'scenarioRequirements.evidenceClasses',
    )
  })
})
