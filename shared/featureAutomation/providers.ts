import { FEATURE_AUTOMATION_MANIFEST_BY_ID } from './manifest'
import { featureChoiceValues } from './instances'
import { resolvedSheetFeatureClosure, type FeatureSheetLike } from './sheetFeatures'

export type FeatureTrainerStatId = 'hp' | 'atk' | 'def' | 'satk' | 'sdef' | 'spd'
const tagStats: Readonly<Record<string, readonly FeatureTrainerStatId[]>> = Object.freeze({
  '+HP': ['hp'], '+Attack': ['atk'], '+Defense': ['def'], '+Special Attack': ['satk'],
  '+Special Defense': ['sdef'], '+Speed': ['spd'],
})
export interface FeatureStatContribution {
  readonly canonicalId: string
  readonly sourceInstanceId: string
  readonly statId: FeatureTrainerStatId
  readonly value: number
}

export const featureTrainerStatContributions = (sheet: FeatureSheetLike): readonly FeatureStatContribution[] => Object.freeze(
  resolvedSheetFeatureClosure(sheet).flatMap(instance => {
    const manifest = FEATURE_AUTOMATION_MANIFEST_BY_ID.get(instance.canonicalId)
    if (!manifest) return []
    const direct = manifest.tags.flatMap(tag => tagStats[tag] ?? [])
    const ambiguous = manifest.tags.includes('+Attack or Special Attack') || manifest.tags.includes('+Any Stat')
      ? featureChoiceValues(instance, 'statTag').length ? featureChoiceValues(instance, 'statTag') : featureChoiceValues(instance, 'stat')
      : []
    return [...new Set([...direct, ...ambiguous])].flatMap(statId => ['hp', 'atk', 'def', 'satk', 'sdef', 'spd'].includes(statId)
      ? [Object.freeze({ canonicalId: instance.canonicalId, sourceInstanceId: instance.instanceId, statId: statId as FeatureTrainerStatId, value: instance.rank })]
      : [])
  }),
)
export const featureTrainerStatBonus = (sheet: FeatureSheetLike, statId: FeatureTrainerStatId): number => featureTrainerStatContributions(sheet).filter(contribution => contribution.statId === statId).reduce((sum, contribution) => sum + contribution.value, 0)
