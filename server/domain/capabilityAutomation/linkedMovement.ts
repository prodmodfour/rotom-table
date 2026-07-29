import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  createEmptyCapabilityRuntimeState,
  parseCapabilityRuntimeState,
} from '#shared/capabilityAutomation/state'
import type { CapabilityLinkState } from '#shared/capabilityAutomation/state'
import { resolveEffectiveCapabilities } from './effectiveCapabilities'

export interface CapabilityLinkedMovementInput {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
}

const sourceEffectiveForLink = (
  input: CapabilityLinkedMovementInput,
  link: CapabilityLinkState,
): boolean => {
  const owner = input.map.placements.find(placement => placement.id === link.ownerPlacementId)
  const sheet = owner?.sheetKind === 'pokemon'
    ? input.pokemonSheets.get(owner.sheetSlug)
    : owner ? input.trainerSheets.get(owner.sheetSlug) : null
  return Boolean(owner && sheet && resolveEffectiveCapabilities({
    map: input.map,
    placement: owner,
    sheet,
    sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
  }).instances.some(instance => (
    instance.instanceId === link.capabilityInstanceId
    && instance.canonicalId === link.canonicalId
    && instance.effective
  )))
}

/** Resolve the exact transitive, still-source-effective co-movement group. */
export const capabilityLinkedMovementPlacementIds = (
  input: CapabilityLinkedMovementInput,
  movedPlacementId: string,
): readonly string[] => {
  const group = new Set([movedPlacementId])
  const links = parseCapabilityRuntimeState(
    input.map.encounterState?.capabilityRuntime ?? createEmptyCapabilityRuntimeState(),
  ).links
    .filter(link => sourceEffectiveForLink(input, link))
  let expanded = true
  while (expanded) {
    expanded = false
    const add = (id: string): void => {
      if (group.has(id)) return
      group.add(id)
      expanded = true
    }
    for (const link of links) {
      if (link.kind === 'living-weapon'
        && (group.has(link.ownerPlacementId) || link.participantPlacementIds.some(id => group.has(id)))) {
        add(link.ownerPlacementId)
        link.participantPlacementIds.forEach(add)
      }
      else if (link.kind === 'shadow-rider' && link.participantPlacementIds.some(id => group.has(id))) {
        add(link.ownerPlacementId)
      }
      else if (['as-one-mount', 'viral-fusion', 'mount-rider', 'marsupial-pouch'].includes(link.kind)
        && group.has(link.ownerPlacementId)) {
        link.participantPlacementIds.forEach(add)
      }
    }
  }
  group.delete(movedPlacementId)
  return [...group]
}
