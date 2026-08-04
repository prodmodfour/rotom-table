import { resolveEffectiveFeatures } from './effectiveFeatures'
import { FEATURE_AUTOMATION_MANIFEST_BY_ID, type FeatureAutomationRole } from '#shared/featureAutomation/manifest'
import type { TrainerSheet } from '~/types/trainerSheet'

export interface FeaturePokemonRelationship {
  readonly pokemonId: string
  readonly ownerTrainerId: string
  readonly controllerIds: ReadonlySet<string>
  readonly roster: 'active' | 'party' | 'boxed' | 'other'
  readonly sideId: string | null
  readonly onMap: boolean
  readonly willing: boolean
  readonly distance: number | null
  readonly revision: number
}
export interface FeatureTeamOperationRequest {
  readonly requestId: string
  readonly sourceInstanceId: string
  readonly trainerId: string
  readonly targetPokemonIds: readonly string[]
  readonly mode: 'orders' | 'training' | 'tutoring' | 'team'
  readonly commandRange: number | null
  readonly requireMapPlacement: boolean
  readonly requireSameSide: boolean
}
export interface FeatureTeamOperationPlan {
  readonly accepted: boolean
  readonly reasonCode: string | null
  readonly canonicalId: string | null
  readonly targetPokemonIds: readonly string[]
  readonly readRevisions: Readonly<Record<string, number>>
}
const reject = (reasonCode: string): FeatureTeamOperationPlan => Object.freeze({ accepted: false, reasonCode, canonicalId: null, targetPokemonIds: Object.freeze([]), readRevisions: Object.freeze({}) })

/** Validate team/roster/control/range facts before any multi-sheet write. */
export const planFeatureTeamOperation = (input: {
  readonly sheet: TrainerSheet
  readonly request: FeatureTeamOperationRequest
  readonly relationships: ReadonlyMap<string, FeaturePokemonRelationship>
  readonly authorizedTrainerIds: ReadonlySet<string>
  readonly trainerSideId: string | null
}): FeatureTeamOperationPlan => {
  if (!input.authorizedTrainerIds.has(input.request.trainerId)) return reject('feature.team.trainer-unauthorized')
  if (!input.request.targetPokemonIds.length || input.request.targetPokemonIds.length > 32 || new Set(input.request.targetPokemonIds).size !== input.request.targetPokemonIds.length) return reject('feature.team.targets-invalid')
  const feature = resolveEffectiveFeatures({ ownerId: input.sheet.slug, sheet: input.sheet }).instances.find(instance => instance.instanceId === input.request.sourceInstanceId && instance.effective)
  if (!feature) return reject('feature.team.source-unavailable')
  const role: FeatureAutomationRole | null = input.request.mode === 'orders' ? 'orders-action' : input.request.mode === 'training' ? 'training-operation' : input.request.mode === 'tutoring' ? 'campaign-operation' : null
  if (role && !FEATURE_AUTOMATION_MANIFEST_BY_ID.get(feature.canonicalId)?.roles.includes(role)) return reject('feature.team.operation-unavailable')
  const readRevisions: Record<string, number> = {}
  for (const pokemonId of input.request.targetPokemonIds) {
    const relation = input.relationships.get(pokemonId)
    if (!relation) return reject('feature.team.target-missing')
    readRevisions[pokemonId] = relation.revision
    const controls = relation.ownerTrainerId === input.request.trainerId || relation.controllerIds.has(input.request.trainerId)
    if (!controls) return reject('feature.team.target-uncontrolled')
    if (!relation.willing) return reject('feature.team.target-unwilling')
    if (input.request.mode !== 'tutoring' && relation.roster === 'other') return reject('feature.team.target-outside-roster')
    if (input.request.requireMapPlacement && !relation.onMap) return reject('feature.team.target-not-on-map')
    if (input.request.requireSameSide && relation.sideId !== input.trainerSideId) return reject('feature.team.target-wrong-side')
    if (input.request.commandRange !== null && (relation.distance === null || relation.distance > input.request.commandRange)) return reject('feature.team.target-out-of-range')
  }
  return Object.freeze({ accepted: true, reasonCode: null, canonicalId: feature.canonicalId, targetPokemonIds: Object.freeze([...input.request.targetPokemonIds]), readRevisions: Object.freeze(readRevisions) })
}
