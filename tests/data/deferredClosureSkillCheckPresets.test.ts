import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import registry from '../../data/deferred-closure/skill-check-dc-presets.v1.json'
import { SKILL_CHECK_DC_PRESETS, resolveSkillCheckDifficultyClass } from '#shared/skillChecks/difficulty'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

describe('P11-047 reviewed Skill Check DC presets', () => {
  it('binds every documentary input by exact source hash without runtime prose parsing', () => {
    expect(registry).toMatchObject({
      schemaVersion: 1,
      registryId: 'generic-skill-check-dc-presets-v1',
      ticket: 'P11-047',
      status: 'reviewed',
      runtimeProseParsing: false,
      explicitDifficultyClass: { minimum: 1, maximum: 100 },
      policy: {
        presetSemantics: 'workflow-alias-for-exact-difficulty-class',
        explicitValuesRemainAllowed: true,
        gmOwnsSelection: true,
        runtimeSource: 'this-reviewed-json-only',
      },
    })
    for (const source of registry.sourceAuthority) expect(sha256(source.path)).toBe(source.sha256)
  })

  it('exposes exactly the reviewed deterministic aliases and fails closed outside explicit bounds', () => {
    expect(SKILL_CHECK_DC_PRESETS).toEqual(registry.presets)
    expect(SKILL_CHECK_DC_PRESETS.map(preset => [preset.label, preset.difficultyClass])).toEqual([
      ['Easy', 5],
      ['Challenging', 10],
      ['Hard', 15],
      ['Nigh-impossible', 25],
    ])
    for (const preset of SKILL_CHECK_DC_PRESETS) {
      expect(resolveSkillCheckDifficultyClass({ kind: 'preset', presetId: preset.presetId })).toBe(preset.difficultyClass)
    }
    expect(resolveSkillCheckDifficultyClass({ kind: 'explicit', difficultyClass: 1 })).toBe(1)
    expect(resolveSkillCheckDifficultyClass({ kind: 'explicit', difficultyClass: 100 })).toBe(100)
    expect(() => resolveSkillCheckDifficultyClass({ kind: 'explicit', difficultyClass: 0 })).toThrow('outside the reviewed bounds')
    expect(() => resolveSkillCheckDifficultyClass({ kind: 'preset', presetId: 'skill-check-dc-preset:v1:forged' as never })).toThrow('registry is invalid')
  })
})
