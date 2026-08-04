import { FEATURE_AUTOMATION_RUNTIME_REGISTRY } from './registry'
import { resolveEffectiveFeatures } from './effectiveFeatures'
import { featureTrainerStatContributions } from '#shared/featureAutomation/providers'
import type { FeatureMechanicDeclaration } from '#shared/featureAutomation/spec'
import type { TrainerSheet } from '~/types/trainerSheet'

export type FeatureProviderDomain = 'stats' | 'skills' | 'combat' | 'movement' | 'equipment' | 'recovery' | 'inventory' | 'orders' | 'campaign' | 'classification'
export interface EffectiveFeatureProviderContribution {
  readonly contributionId: string
  readonly canonicalId: string
  readonly sourceInstanceId: string
  readonly definitionHash: string
  readonly domain: FeatureProviderDomain
  readonly propertyId: string
  readonly mechanic: FeatureMechanicDeclaration
}
const domainFor = (mechanic: FeatureMechanicDeclaration): FeatureProviderDomain => {
  if (mechanic.kind === 'class-progression') return 'classification'
  if (mechanic.kind === 'campaign-operation') return 'campaign'
  if (mechanic.contextId === 'orders') return 'orders'
  return 'combat'
}

/** Ordered hash-bound declarations for owning domain reducers. */
export const effectiveFeatureProviderContributions = (sheet: TrainerSheet): readonly EffectiveFeatureProviderContribution[] => Object.freeze(
  resolveEffectiveFeatures({ ownerId: sheet.slug, sheet }).instances.flatMap(instance => {
    if (!instance.effective) return []
    const definition = FEATURE_AUTOMATION_RUNTIME_REGISTRY.require(instance.canonicalId)
    return instance.mechanics.filter(mechanic => ['passive-provider', 'permission-provider', 'class-progression'].includes(mechanic.kind)).map(mechanic => Object.freeze({
      contributionId: `feature-provider:${instance.instanceId}:${mechanic.mechanicId}`,
      canonicalId: instance.canonicalId,
      sourceInstanceId: instance.instanceId,
      definitionHash: definition.definitionHash,
      domain: domainFor(mechanic),
      propertyId: mechanic.propertyId,
      mechanic,
    }))
  }).sort((left, right) => left.propertyId.localeCompare(right.propertyId) || left.canonicalId.localeCompare(right.canonicalId) || left.sourceInstanceId.localeCompare(right.sourceInstanceId)),
)

export const explainFeatureProviders = (sheet: TrainerSheet): readonly { readonly source: string, readonly propertyId: string, readonly value: string }[] => Object.freeze([
  ...featureTrainerStatContributions(sheet).map(contribution => Object.freeze({ source: contribution.canonicalId, propertyId: `trainer.stat.${contribution.statId}`, value: `+${contribution.value}` })),
  ...effectiveFeatureProviderContributions(sheet).map(contribution => Object.freeze({ source: contribution.canonicalId, propertyId: contribution.propertyId, value: contribution.mechanic.operation })),
])
