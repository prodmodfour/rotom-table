import { resolveFeatureGrants, type FeatureGrantKind } from '#shared/featureAutomation/grants'
import { resolveEffectiveFeatures } from './effectiveFeatures'
import type { TrainerSheet } from '~/types/trainerSheet'

export interface FeatureTargetPokemonGrant {
  readonly grantId: string
  readonly kind: FeatureGrantKind
  readonly canonicalId: string
  readonly sourceCanonicalId: string
  readonly sourceInstanceId: string
  readonly duration: 'permanent' | 'temporary'
}

/** Provenance-bound grants available to an authorized Pokémon target query. */
export const featureTargetPokemonGrants = (sheet: TrainerSheet, input: {
  readonly includeTemporary?: boolean
  readonly eligibleCanonicalIds?: ReadonlySet<string>
} = {}): readonly FeatureTargetPokemonGrant[] => Object.freeze(
  resolveEffectiveFeatures({ ownerId: sheet.slug, sheet }).instances.flatMap(instance => {
    if (!instance.effective) return []
    return resolveFeatureGrants(instance.instance).flatMap((grant, index): FeatureTargetPokemonGrant[] => {
      if (grant.targetPolicy !== 'target-pokemon' || (!input.includeTemporary && grant.duration !== 'permanent') || (input.eligibleCanonicalIds && !input.eligibleCanonicalIds.has(grant.canonicalId))) return []
      return [Object.freeze({ grantId: `feature-pokemon-grant:${instance.instanceId}:${index}`, kind: grant.kind, canonicalId: grant.canonicalId, sourceCanonicalId: instance.canonicalId, sourceInstanceId: instance.instanceId, duration: grant.duration })]
    })
  }),
)

export const reconcileFeatureTargetPokemonGrants = (input: {
  readonly previous: readonly FeatureTargetPokemonGrant[]
  readonly next: readonly FeatureTargetPokemonGrant[]
}): { readonly added: readonly FeatureTargetPokemonGrant[], readonly removed: readonly FeatureTargetPokemonGrant[], readonly retained: readonly FeatureTargetPokemonGrant[] } => {
  const previous = new Map(input.previous.map(grant => [grant.grantId, grant]))
  const next = new Map(input.next.map(grant => [grant.grantId, grant]))
  return Object.freeze({
    added: Object.freeze([...next].flatMap(([id, grant]) => previous.has(id) ? [] : [grant])),
    removed: Object.freeze([...previous].flatMap(([id, grant]) => next.has(id) ? [] : [grant])),
    retained: Object.freeze([...next].flatMap(([id, grant]) => previous.has(id) ? [grant] : [])),
  })
}
