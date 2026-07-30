import { describe, expect, it } from 'vitest'
import {
  CANONICAL_CAPABILITY_IDS,
  parseCapabilityLabel,
} from '#shared/capabilityAutomation/catalog'
import { CAPABILITY_AUTOMATION_MANIFEST } from '#shared/capabilityAutomation/manifest'
import {
  CAPABILITY_POWER_LIMITS,
  capabilityPowerLimits,
  resolveCapabilityJump,
  resolveCapabilityPowerLoad,
} from '#shared/capabilityAutomation/power'
import { CAPABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/capabilityAutomation/registry'

describe('canonical Capability automation catalog', () => {
  it('binds every frozen row to one native, hash-addressed runtime', () => {
    expect(CANONICAL_CAPABILITY_IDS).toHaveLength(83)
    expect(CAPABILITY_AUTOMATION_MANIFEST.entries.map(entry => entry.canonicalId)).toEqual(CANONICAL_CAPABILITY_IDS)
    expect(CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.definitions).toHaveLength(83)
    for (const canonicalId of CANONICAL_CAPABILITY_IDS) {
      const runtime = CAPABILITY_AUTOMATION_RUNTIME_REGISTRY.require(canonicalId)
      expect(runtime.definitionHash).toMatch(/^[0-9a-f]{64}$/)
      expect(runtime.spec.semanticTags.length).toBeGreaterThan(0)
      expect(runtime.spec.registeredHandlerId).toBe('capability.native.v1')
    }
  })

  it('normalizes reviewed whitespace, aliases, and parameterized identities without fuzzy matching', () => {
    expect(parseCapabilityLabel('  Aura   Reader ')).toMatchObject({ canonicalId: 'Aura Reader', matchedBy: 'canonical' })
    expect(parseCapabilityLabel('Mind Lock')).toMatchObject({ canonicalId: 'Mindlock', matchedBy: 'compatibility-alias' })
    expect(parseCapabilityLabel('Mountable  4')).toMatchObject({
      canonicalId: 'Mountable X', parameters: { kind: 'rider-capacity', riders: 4 },
    })
    expect(parseCapabilityLabel('Naturewalk (Ocean, Taiga,  Tundra)')).toMatchObject({
      canonicalId: 'Naturewalk', parameters: { kind: 'terrains', terrains: ['Ocean', 'Taiga', 'Tundra'] },
    })
    expect(parseCapabilityLabel('Planter (Berries)')).toMatchObject({
      canonicalId: 'Planter', parameters: { kind: 'categories', categories: ['Berries'] },
    })
    expect(parseCapabilityLabel('7/3')).toMatchObject({
      canonicalId: 'Jump', parameters: { kind: 'jump', long: 7, high: 3 },
    })
    expect(parseCapabilityLabel('not almost a capability')).toMatchObject({ canonicalId: null, matchedBy: 'unresolved' })
  })

  it('resolves the frozen Power and Jump tables at their exact boundaries', () => {
    expect(capabilityPowerLimits(1)).toEqual({ power: 1, heavyMinimum: 2, heavyMaximum: 5, staggeringMaximum: 10, dragMaximum: 20 })
    expect(capabilityPowerLimits(16).dragMaximum).toBe(3000)
    expect(resolveCapabilityPowerLoad(4, 45).loadClass).toBe('heavy')
    expect(resolveCapabilityPowerLoad(4, 71)).toMatchObject({ loadClass: 'staggering', standardActionsAllowed: false, athleticsCheckDc: 4 })
    expect(resolveCapabilityPowerLoad(4, 279).loadClass).toBe('drag')
    expect(resolveCapabilityPowerLoad(4, 280).loadClass).toBe('too-heavy')
    expect(resolveCapabilityPowerLoad(4, 281).loadClass).toBe('too-heavy')
    for (const limits of CAPABILITY_POWER_LIMITS) {
      expect(resolveCapabilityPowerLoad(limits.power, limits.heavyMinimum - 1).loadClass).toBe('unburdened')
      expect(resolveCapabilityPowerLoad(limits.power, limits.heavyMinimum).loadClass).toBe('heavy')
      expect(resolveCapabilityPowerLoad(limits.power, limits.heavyMaximum).loadClass).toBe('heavy')
      expect(resolveCapabilityPowerLoad(limits.power, limits.heavyMaximum + 1).loadClass).toBe('staggering')
      expect(resolveCapabilityPowerLoad(limits.power, limits.staggeringMaximum).loadClass).toBe('staggering')
      expect(resolveCapabilityPowerLoad(limits.power, limits.staggeringMaximum + 1).loadClass).toBe('drag')
      expect(resolveCapabilityPowerLoad(limits.power, limits.dragMaximum - 1).loadClass).toBe('drag')
      expect(resolveCapabilityPowerLoad(limits.power, limits.dragMaximum).loadClass).toBe('too-heavy')
    }
    expect(resolveCapabilityJump({ long: 3, high: 1, kind: 'long', acrobaticsCheckTotal: 16 })).toBe(4)
    expect(resolveCapabilityJump({ long: 3, high: 1, kind: 'high', runningStart: true })).toBe(2)
  })
})
