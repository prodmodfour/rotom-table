import { resolvedSheetFeatureClosure } from '#shared/featureAutomation/sheetFeatures'
import { FEATURE_AUTOMATION_MANIFEST_BY_ID } from '#shared/featureAutomation/manifest'
import type { FeaturePrerequisiteContext } from '#shared/featureAutomation/prerequisites'
import { resolveEffectiveEdges } from '../edgeAutomation/effectiveEdges'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import type { TrainerSheet } from '~/types/trainerSheet'

export const buildFeaturePrerequisiteContext = (
  sheet: TrainerSheet,
  approvedClauseIds: ReadonlySet<string> = new Set(),
): FeaturePrerequisiteContext => {
  const featureInstances = resolvedSheetFeatureClosure(sheet)
  const featureIds = new Set(featureInstances.map(instance => instance.canonicalId))
  const featureClassCounts: Record<string, number> = {}
  for (const instance of featureInstances) {
    const className = FEATURE_AUTOMATION_MANIFEST_BY_ID.get(instance.canonicalId)?.className
    if (className) featureClassCounts[className] = (featureClassCounts[className] ?? 0) + instance.rank
  }
  const edgeIds = new Set(resolveEffectiveEdges({ ownerId: sheet.slug, family: 'trainer', sheet }).instances.filter(instance => instance.effective).map(instance => instance.canonicalId))
  return Object.freeze({
    level: Math.max(1, Math.floor(sheet.level || 1)),
    skillRanks: Object.freeze(Object.fromEntries(resolveTrainerSkills(sheet).map(skill => [skill.key, skill.rankValue]))),
    featureIds,
    edgeIds,
    featureClassCounts: Object.freeze(featureClassCounts),
    approvedClauseIds,
  })
}
