import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import capabilitiesJson from '../../data/ability-automation/capabilities.json'
import {
  ABILITY_AUTOMATION_CAPABILITY_LIMITS,
  AbilityAutomationCapabilityValidationError,
  parseAbilityAutomationCapabilityCatalog,
  type AbilityAutomationCapabilityValidationCode,
} from '#shared/abilityAutomation/capabilities'
import {
  loadCanonicalAbilityCatalog,
  type CanonicalAbilityCatalog,
} from '#shared/abilityAutomation/ruleset'

let canonicalCatalog: CanonicalAbilityCatalog

beforeAll(async () => {
  canonicalCatalog = await loadCanonicalAbilityCatalog(
    readFileSync(join(process.cwd(), 'data/reference/abilities.json')),
  )
})

const capability = (code: string, dependencies: readonly string[] = []) => ({
  code,
  owningPhase: 'phase-2',
  dependencies,
  implementationStatus: 'planned',
  representativeAbility: 'Abominable',
})

const catalogWith = (...capabilities: unknown[]) => ({ schemaVersion: 1, capabilities })

const expectCapabilityError = (
  value: unknown,
  code: AbilityAutomationCapabilityValidationCode,
  path?: string,
): void => {
  try {
    parseAbilityAutomationCapabilityCatalog(value, canonicalCatalog)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(AbilityAutomationCapabilityValidationError)
    expect((error as AbilityAutomationCapabilityValidationError).code).toBe(code)
    if (path) expect((error as AbilityAutomationCapabilityValidationError).path).toBe(path)
  }
}

describe('ability automation capability catalog', () => {
  it('loads a closed acyclic graph with canonical representative abilities', () => {
    const catalog = parseAbilityAutomationCapabilityCatalog(capabilitiesJson, canonicalCatalog)
    const codes = catalog.capabilities.map(capability => capability.code)
    const knownCodes = new Set(codes)

    expect(catalog.schemaVersion).toBe(1)
    expect(catalog.capabilities).toHaveLength(53)
    expect(codes).toEqual([...codes].sort())
    expect(codes).toEqual(expect.arrayContaining([
      'runtime.unimplemented',
      'runtime.abilityspec-v1',
      'mode.static',
      'mode.activated',
      'mode.triggered',
      'events.routing',
      'choices.durable',
      'planning.atomic',
    ]))
    for (const capability of catalog.capabilities) {
      expect(capability.implementationStatus).toBe('implemented')
      expect(capability.dependencies.every(dependency => knownCodes.has(dependency))).toBe(true)
      expect(canonicalCatalog.abilities.some(ability => (
        ability.canonicalId === capability.representativeAbility
      ))).toBe(true)
    }
  })

  it('rejects unknown fields, phases, statuses, and representative abilities', () => {
    expectCapabilityError(
      { ...catalogWith(capability('runtime.unimplemented')), extra: true },
      'invalid-capability-catalog',
      'capabilityCatalog',
    )
    expectCapabilityError(
      catalogWith({ ...capability('runtime.unimplemented'), executable: true }),
      'invalid-capability-catalog',
      'capabilities[0]',
    )
    expectCapabilityError(
      catalogWith({ ...capability('runtime.unimplemented'), owningPhase: 'phase-99' }),
      'invalid-capability-catalog',
      'capabilities[0].owningPhase',
    )
    expectCapabilityError(
      catalogWith({ ...capability('runtime.unimplemented'), implementationStatus: 'partial' }),
      'invalid-capability-catalog',
      'capabilities[0].implementationStatus',
    )
    expectCapabilityError(
      catalogWith({ ...capability('runtime.unimplemented'), representativeAbility: 'Unknown' }),
      'unknown-representative-ability',
      'capabilities[0].representativeAbility',
    )
  })

  it('rejects duplicates, unknown dependencies, cycles, and excessive dependency lists', () => {
    expectCapabilityError(
      catalogWith(capability('runtime.unimplemented'), capability('runtime.unimplemented')),
      'duplicate-capability',
      'capabilityCatalog.capabilities',
    )
    expectCapabilityError(
      catalogWith(capability('runtime.abilityspec-v1', ['runtime.missing'])),
      'unknown-capability-dependency',
      'capabilities[0].dependencies[0]',
    )
    expectCapabilityError(
      catalogWith(
        capability('runtime.unimplemented', ['runtime.abilityspec-v1']),
        capability('runtime.abilityspec-v1', ['runtime.unimplemented']),
      ),
      'capability-dependency-cycle',
    )
    expectCapabilityError(
      catalogWith(capability(
        'runtime.unimplemented',
        Array.from(
          { length: ABILITY_AUTOMATION_CAPABILITY_LIMITS.dependencies + 1 },
          (_, index) => `dependency-${index}`,
        ),
      )),
      'limit-exceeded',
      'capabilities[0].dependencies',
    )
  })
})
