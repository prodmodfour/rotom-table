import type { CapabilityLinkState } from '#shared/capabilityAutomation/state'
import {
  parseEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'

export type CapabilityLinkSourceEffectiveness = (link: CapabilityLinkState) => boolean

const asOnePair = (link: CapabilityLinkState): readonly [string, string] | null => (
  link.kind === 'as-one-mount'
  && link.canonicalId === 'As One'
  && link.participantPlacementIds.length === 1
    ? [link.ownerPlacementId, link.participantPlacementIds[0]!]
    : null
)

/**
 * Expand a set of fainted placements through exact source-effective As One
 * links. The closure makes malformed/chained legacy state deterministic rather
 * than depending on runtime link order.
 */
export const expandSourceEffectiveAsOneFaintedPlacements = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly faintedPlacementIds: ReadonlySet<string>
  readonly sourceIsEffective: CapabilityLinkSourceEffectiveness
}): ReadonlySet<string> => {
  const fainted = new Set(input.faintedPlacementIds)
  const pairs = (input.map.encounterState?.capabilityRuntime?.links ?? []).flatMap((link) => {
    const pair = asOnePair(link)
    return pair && input.sourceIsEffective(link) ? [pair] : []
  })
  let changed = true
  while (changed) {
    changed = false
    for (const [ownerPlacementId, participantPlacementId] of pairs) {
      if (!fainted.has(ownerPlacementId) && !fainted.has(participantPlacementId)) continue
      if (!fainted.has(ownerPlacementId)) {
        fainted.add(ownerPlacementId)
        changed = true
      }
      if (!fainted.has(participantPlacementId)) {
        fainted.add(participantPlacementId)
        changed = true
      }
    }
  }
  return fainted
}

/** Crowned Forme ends immediately when its actor faints and cannot reactivate on healing. */
export const removeCrownedCapabilityModesForFaintedPlacements = (
  encounterState: EncounterState,
  faintedPlacementIds: ReadonlySet<string>,
): EncounterState => {
  const runtime = encounterState.capabilityRuntime
  if (!runtime || faintedPlacementIds.size === 0) return encounterState
  const modes = runtime.modes.filter(mode => (
    mode.mode !== 'crowned' || !faintedPlacementIds.has(mode.actorPlacementId)
  ))
  if (modes.length === runtime.modes.length) return encounterState
  return parseEncounterState({
    ...encounterState,
    capabilityRuntime: { ...runtime, modes },
  })
}
