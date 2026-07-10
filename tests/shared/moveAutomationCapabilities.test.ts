import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import capabilitiesJson from '../../data/move-automation/capabilities.json'
import {
  MOVE_AUTOMATION_CAPABILITY_LIMITS,
  MoveAutomationCapabilityValidationError,
  parseMoveAutomationCapabilityCatalog,
  type MoveAutomationCapabilityValidationCode,
} from '#shared/moveAutomation/capabilities'
import {
  loadCanonicalMoveCatalog,
  type CanonicalMoveCatalog,
} from '#shared/moveAutomation/ruleset'

const movesPath = join(process.cwd(), 'data', 'reference', 'moves.json')

let canonicalCatalog: CanonicalMoveCatalog

beforeAll(async () => {
  canonicalCatalog = await loadCanonicalMoveCatalog(readFileSync(movesPath))
})

const capability = (
  code: string,
  dependencies: readonly string[] = [],
): Record<string, unknown> => ({
  code,
  owningPhase: 'phase-4',
  dependencies,
  implementationStatus: 'planned',
  representativeMove: 'Tackle',
})

const catalogWith = (...capabilities: unknown[]) => ({
  schemaVersion: 1,
  capabilities,
})

const expectCapabilityError = (
  value: unknown,
  code: MoveAutomationCapabilityValidationCode,
  path?: string,
): void => {
  try {
    parseMoveAutomationCapabilityCatalog(value, canonicalCatalog)
    expect.unreachable(`Expected ${code}`)
  }
  catch (error) {
    expect(error).toBeInstanceOf(MoveAutomationCapabilityValidationError)
    expect((error as MoveAutomationCapabilityValidationError).code).toBe(code)
    if (path) expect((error as MoveAutomationCapabilityValidationError).path).toBe(path)
  }
}

describe('move automation capability catalog', () => {
  it('loads the reviewed capability families as a typed dependency graph', () => {
    const catalog = parseMoveAutomationCapabilityCatalog(capabilitiesJson, canonicalCatalog)
    const byCode = new Map(catalog.capabilities.map(entry => [entry.code, entry]))

    expect(catalog.schemaVersion).toBe(1)
    expect([...byCode.keys()]).toEqual([
      'conditions.typed',
      'expressions.bounded',
      'fields.typed',
      'hazards.typed',
      'history.structured',
      'hp.typed',
      'items.authoritative',
      'lifecycle.effects',
      'movement.authoritative',
      'nested-moves.reviewed',
      'reactions.durable',
      'runtime.unimplemented',
      'stages.typed',
      'targeting.authoritative',
      'transformations.reversible',
    ])
    expect(byCode.get('runtime.unimplemented')).toEqual({
      code: 'runtime.unimplemented',
      owningPhase: 'phase-2',
      dependencies: [],
      implementationStatus: 'planned',
      representativeMove: 'Scratch',
    })

    for (const entry of catalog.capabilities) {
      expect(canonicalCatalog.moves.some(move => move.canonicalId === entry.representativeMove)).toBe(true)
      expect(entry.dependencies.every(dependency => byCode.has(dependency))).toBe(true)
    }
  })

  it('rejects unknown fields and unsupported phase or status values', () => {
    expectCapabilityError(
      { ...catalogWith(capability('targeting.authoritative')), extra: true },
      'invalid-capability-catalog',
      'capabilityCatalog',
    )
    expectCapabilityError(
      catalogWith({ ...capability('targeting.authoritative'), summary: 'Executable prose.' }),
      'invalid-capability-catalog',
      'capabilities[0]',
    )
    expectCapabilityError(
      catalogWith({ ...capability('targeting.authoritative'), owningPhase: 'someday' }),
      'invalid-capability-catalog',
      'capabilities[0].owningPhase',
    )
    expectCapabilityError(
      catalogWith({ ...capability('targeting.authoritative'), implementationStatus: 'partial' }),
      'invalid-capability-catalog',
      'capabilities[0].implementationStatus',
    )
  })

  it('rejects duplicate definitions and malformed or excessive dependencies', () => {
    expectCapabilityError(
      catalogWith(
        capability('targeting.authoritative'),
        capability('targeting.authoritative'),
      ),
      'duplicate-capability',
      'capabilityCatalog.capabilities',
    )
    expectCapabilityError(
      catalogWith(capability('Not Stable')),
      'invalid-capability-catalog',
      'capabilities[0].code',
    )
    expectCapabilityError(
      catalogWith(capability(
        'targeting.authoritative',
        Array.from(
          { length: MOVE_AUTOMATION_CAPABILITY_LIMITS.dependencies + 1 },
          (_, index) => `dependency-${index}`,
        ),
      )),
      'limit-exceeded',
      'capabilities[0].dependencies',
    )
  })

  it('rejects unknown dependency and representative move references', () => {
    expectCapabilityError(
      catalogWith(capability('targeting.authoritative', ['runtime.missing'])),
      'unknown-capability-dependency',
      'capabilities[0].dependencies[0]',
    )
    expectCapabilityError(
      catalogWith({
        ...capability('targeting.authoritative'),
        representativeMove: 'Not A Canonical Move',
      }),
      'unknown-representative-move',
      'capabilities[0].representativeMove',
    )
  })

  it('rejects direct and indirect dependency cycles', () => {
    expectCapabilityError(
      catalogWith(capability('targeting.authoritative', ['targeting.authoritative'])),
      'capability-dependency-cycle',
      'capabilities[0].dependencies[0]',
    )
    expectCapabilityError(
      catalogWith(
        capability('targeting.authoritative', ['expressions.bounded']),
        capability('expressions.bounded', ['targeting.authoritative']),
      ),
      'capability-dependency-cycle',
    )
  })
})
