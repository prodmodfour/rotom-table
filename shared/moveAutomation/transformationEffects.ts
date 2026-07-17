import {
  parseEncounterEffects,
  type EncounterEffect,
  type EncounterTransformationEffect,
} from './encounterEffects'

/**
 * Resolve the sole active transformation for a placement from durable state.
 * The encounter parser rejects two snapshots for one placement, so callers
 * never choose mechanics by array accident or client order.
 */
export const activeEncounterTransformation = (input: {
  readonly placementId: string
  readonly effects?: readonly EncounterEffect[] | null
}): EncounterTransformationEffect | null => {
  const effects = parseEncounterEffects(
    input.effects ?? [],
    'transformationProjection.effects',
  )
  return effects.find((effect): effect is EncounterTransformationEffect => (
    effect.kind === 'transformation'
    && effect.affected.placementIds[0] === input.placementId
    && effect.suppression.sources.length === 0
    && effect.charges !== 0
  )) ?? null
}
