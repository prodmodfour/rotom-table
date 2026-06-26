const LEGACY_TRAINER_SKILL_RANK_KEY = 'rank'

const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

/** Remove the retired per-skill manual rank override from a mutable skill entry. */
export const stripLegacyTrainerSkillRank = <T extends object>(entry: T): T => {
  delete (entry as Record<string, unknown>)[LEGACY_TRAINER_SKILL_RANK_KEY]
  return entry
}

/**
 * Remove retired per-skill manual rank overrides from a trainer sheet payload.
 * Empty entries left behind by a lone legacy rank are pruned as well.
 */
export const stripLegacyTrainerSheetSkillRanks = (sheet: { skills?: unknown }): void => {
  const skills = sheet.skills
  if (!isPlainRecord(skills)) return

  for (const [key, value] of Object.entries(skills)) {
    if (!isPlainRecord(value)) {
      delete skills[key]
      continue
    }

    stripLegacyTrainerSkillRank(value)
    if (Object.keys(value).length === 0) delete skills[key]
  }
}
