import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { AuthoritativeMoveRulesContext } from './context'

const normalizedTags = (effect: EncounterEffect): ReadonlySet<string> => new Set(
  effect.tags.map(tag => tag.trim().toLowerCase()),
)

/**
 * Resolve only the native marker emitted by the reviewed Endure MoveSpec.
 * Similar user-authored tags cannot grant the HP bound or trigger Vigor.
 */
export const authoritativeActiveEndureEffect = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly placementId: string
}): EncounterEffect | null => input.context.map.encounterState?.effects.find((effect) => {
  const tags = normalizedTags(effect)
  return effect.kind === 'capability'
    && effect.payload.capabilityId === 'shield'
    && effect.payload.action === 'grant'
    && effect.source.operationId === 'endure.shield'
    && effect.source.moveId === 'move.endure'
    && effect.affected.placementIds.includes(input.placementId)
    && tags.has('endure')
    && tags.has('shield')
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
    && (effect.charges === null || effect.charges > 0)
}) ?? null
