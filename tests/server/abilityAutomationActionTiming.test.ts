import { describe, expect, it } from 'vitest'
import { abilityMechanicRequiresStandardAction } from '~~/server/domain/abilityAutomation/actionTiming'
import { ILLUSION_ABILITY_SPEC } from '~~/server/domain/abilityAutomation/specs/aa075'
import { MEMORY_WIPE_ABILITY_SPEC } from '~~/server/domain/abilityAutomation/specs/aa079'
import {
  MINI_NOSES_ABILITY_SPEC,
  MISSILE_LAUNCH_ABILITY_SPEC,
} from '~~/server/domain/abilityAutomation/specs/aa080'

const operationFor = (
  spec: { readonly phases: readonly { readonly modeId: string; readonly operations: readonly unknown[] }[] },
  modeId: string,
): unknown => spec.phases.find(phase => phase.modeId === modeId)?.operations[0]

describe('Ability authoritative action timing', () => {
  it('normalizes reviewed mode-specific Standard costs without blocking Swift or extended modes', () => {
    expect(abilityMechanicRequiresStandardAction(
      operationFor(MEMORY_WIPE_ABILITY_SPEC, 'standard'),
      'standard',
    )).toBe(true)
    expect(abilityMechanicRequiresStandardAction(
      operationFor(MEMORY_WIPE_ABILITY_SPEC, 'swift'),
      'swift',
    )).toBe(false)
    expect(abilityMechanicRequiresStandardAction(
      operationFor(MEMORY_WIPE_ABILITY_SPEC, 'extended'),
      'extended',
    )).toBe(false)
  })

  it('distinguishes Standard deployment from independently reviewed movement modes', () => {
    expect(abilityMechanicRequiresStandardAction(
      operationFor(MINI_NOSES_ABILITY_SPEC, 'deploy'),
      'deploy',
    )).toBe(true)
    expect(abilityMechanicRequiresStandardAction(
      operationFor(MINI_NOSES_ABILITY_SPEC, 'shift'),
      'shift',
    )).toBe(false)
    expect(abilityMechanicRequiresStandardAction(
      operationFor(MISSILE_LAUNCH_ABILITY_SPEC, 'deploy'),
      'deploy',
    )).toBe(true)
    expect(abilityMechanicRequiresStandardAction(
      operationFor(MISSILE_LAUNCH_ABILITY_SPEC, 'shift'),
      'shift',
    )).toBe(false)
  })

  it('recognizes Illusion mark and replace costs while retaining free assume and dismiss modes', () => {
    for (const modeId of ['mark-creature', 'mark-object', 'replace-creature', 'replace-object']) {
      expect(abilityMechanicRequiresStandardAction(
        operationFor(ILLUSION_ABILITY_SPEC, modeId),
        modeId,
      )).toBe(true)
    }
    for (const modeId of ['assume', 'dismiss']) {
      expect(abilityMechanicRequiresStandardAction(
        operationFor(ILLUSION_ABILITY_SPEC, modeId),
        modeId,
      )).toBe(false)
    }
  })
})
