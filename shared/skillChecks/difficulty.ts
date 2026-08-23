import registryJson from '../../data/deferred-closure/skill-check-dc-presets.v1.json'
import {
  SKILL_CHECK_DC_PRESET_IDS,
  type SkillCheckDcPresetId,
  type SkillCheckDcSelectionV1,
} from './contract'

export interface SkillCheckDcPresetV1 {
  readonly presetId: SkillCheckDcPresetId
  readonly label: string
  readonly difficultyClass: number
  readonly guidance: string
}

interface SkillCheckDcPresetRegistryV1 {
  readonly schemaVersion: 1
  readonly registryId: 'generic-skill-check-dc-presets-v1'
  readonly ticket: 'P11-047'
  readonly status: 'reviewed'
  readonly runtimeProseParsing: false
  readonly explicitDifficultyClass: { readonly minimum: 1, readonly maximum: 100 }
  readonly presets: readonly SkillCheckDcPresetV1[]
}

const registry = registryJson as SkillCheckDcPresetRegistryV1
const fail = (message: string): never => { throw new Error(`Skill Check DC preset registry is invalid: ${message}`) }

if (registry.schemaVersion !== 1
  || registry.registryId !== 'generic-skill-check-dc-presets-v1'
  || registry.ticket !== 'P11-047'
  || registry.status !== 'reviewed'
  || registry.runtimeProseParsing !== false
  || registry.explicitDifficultyClass.minimum !== 1
  || registry.explicitDifficultyClass.maximum !== 100) fail('reviewed header or explicit bounds changed')
if (registry.presets.length !== SKILL_CHECK_DC_PRESET_IDS.length
  || new Set(registry.presets.map(preset => preset.presetId)).size !== registry.presets.length) {
  fail('preset identities are incomplete or duplicated')
}
for (const presetId of SKILL_CHECK_DC_PRESET_IDS) {
  const preset = registry.presets.find(candidate => candidate.presetId === presetId)
    ?? fail(`missing ${presetId}`)
  if (!Number.isSafeInteger(preset.difficultyClass)
    || preset.difficultyClass < registry.explicitDifficultyClass.minimum
    || preset.difficultyClass > registry.explicitDifficultyClass.maximum
    || !preset.label.trim() || preset.label.length > 80
    || !preset.guidance.trim() || preset.guidance.length > 200) fail(`invalid ${presetId}`)
}

export const SKILL_CHECK_DC_PRESETS: readonly SkillCheckDcPresetV1[] = Object.freeze(
  registry.presets.map(preset => Object.freeze({ ...preset })),
)

export const skillCheckDcPreset = (presetId: SkillCheckDcPresetId): SkillCheckDcPresetV1 => (
  SKILL_CHECK_DC_PRESETS.find(preset => preset.presetId === presetId)
  ?? fail(`unknown ${presetId}`)
)

export const resolveSkillCheckDifficultyClass = (selection: SkillCheckDcSelectionV1): number => {
  if (selection.kind === 'preset') return skillCheckDcPreset(selection.presetId).difficultyClass
  if (!Number.isSafeInteger(selection.difficultyClass)
    || selection.difficultyClass < registry.explicitDifficultyClass.minimum
    || selection.difficultyClass > registry.explicitDifficultyClass.maximum) {
    return fail('explicit difficultyClass is outside the reviewed bounds')
  }
  return selection.difficultyClass
}
