import type { TabletopMap } from '~/types/map'

/**
 * Capabilities that canonically remove a participant from separate play keep
 * that participant in the owner's physical presence group. Ordinary mounts,
 * shadow riders, and Living Weapons intentionally are not coupled: deleting
 * or recalling one of those participants merely ends their link.
 */
export const capabilityCoupledPresenceIds = (
  map: TabletopMap,
  requestedPlacementId: string,
  authoritativeMarsupialPlacementIds: ReadonlySet<string> = new Set(),
): ReadonlySet<string> => {
  // Coupled-presence links are physically indivisible. Resolve the complete
  // undirected component so recall/delete through either owner or carried
  // participant cannot strand the counterpart or its source-owned state.
  const groups: readonly (readonly string[])[] = [
    ...(map.encounterState?.capabilityRuntime?.links ?? []).flatMap(link => (
      link.kind === 'as-one-mount' || link.kind === 'viral-fusion'
        ? [[link.ownerPlacementId, ...link.participantPlacementIds]] : []
    )),
    ...(authoritativeMarsupialPlacementIds.has(requestedPlacementId)
      ? [[...authoritativeMarsupialPlacementIds]] : []),
  ]
  const ids = new Set<string>([requestedPlacementId])
  let changed = true
  while (changed) {
    changed = false
    for (const group of groups) {
      if (!group.some(id => ids.has(id))) continue
      for (const id of group) {
        if (!ids.has(id)) {
          ids.add(id)
          changed = true
        }
      }
    }
  }
  return ids
}

/** Remove a recalled/deleted physical presence group and all map-owned state
 * whose authority depended on one of those placements. Sheet/roster writes
 * remain the responsibility of the calling transactional use case. */
export const removeCapabilityPresenceGroup = <TMap extends TabletopMap>(input: {
  readonly map: TMap
  readonly ownerPlacementId: string
  readonly authoritativeMarsupialPlacementIds?: ReadonlySet<string>
}): { readonly map: TMap; readonly removedPlacementIds: ReadonlySet<string> } => {
  const removedPlacementIds = capabilityCoupledPresenceIds(
    input.map,
    input.ownerPlacementId,
    input.authoritativeMarsupialPlacementIds,
  )
  const runtime = input.map.encounterState?.capabilityRuntime
  const encounterState = input.map.encounterState ? {
    ...input.map.encounterState,
    effects: input.map.encounterState.effects.filter(effect => (
      !removedPlacementIds.has(effect.source.placementId)
      && !effect.affected.placementIds.some(id => removedPlacementIds.has(id))
    )),
    ...(runtime ? {
      capabilityRuntime: {
        ...runtime,
        modes: runtime.modes.filter(mode => !removedPlacementIds.has(mode.actorPlacementId)),
        links: runtime.links.filter(link => (
          !removedPlacementIds.has(link.ownerPlacementId)
          && !link.participantPlacementIds.some(id => removedPlacementIds.has(id))
        )),
        tasks: runtime.tasks.filter(task => !removedPlacementIds.has(task.actorPlacementId)),
        pendingAdjudications: runtime.pendingAdjudications.filter(request => !removedPlacementIds.has(request.actorPlacementId)),
        checkPenalties: runtime.checkPenalties.filter(penalty => (
          !removedPlacementIds.has(penalty.actorPlacementId)
          && !removedPlacementIds.has(penalty.targetPlacementId)
        )),
      },
    } : {}),
  } : undefined
  const metadata = { ...(input.map.metadata ?? {}) }
  if (Array.isArray(metadata.capabilityMarsupialPouches)) {
    metadata.capabilityMarsupialPouches = metadata.capabilityMarsupialPouches.filter(raw => {
      const pouch = raw as Record<string, unknown>
      return !removedPlacementIds.has(String(pouch?.motherPlacementId))
        && !removedPlacementIds.has(String(pouch?.babyPlacementId))
    })
  }
  if (Array.isArray(metadata.capabilityIllusions)) {
    metadata.capabilityIllusions = metadata.capabilityIllusions.filter(raw => (
      !removedPlacementIds.has(String((raw as Record<string, unknown>)?.ownerPlacementId))
    ))
  }
  const initiative = input.map.initiative ? {
    ...input.map.initiative,
    ...(input.map.initiative.activeId && removedPlacementIds.has(input.map.initiative.activeId)
      ? { activeId: null } : {}),
    ...(input.map.initiative.manualOrderIds ? {
      manualOrderIds: input.map.initiative.manualOrderIds.filter(id => !removedPlacementIds.has(id)),
    } : {}),
  } : undefined
  return {
    removedPlacementIds,
    map: {
      ...input.map,
      placements: input.map.placements.filter(placement => !removedPlacementIds.has(placement.id)),
      metadata,
      ...(encounterState === undefined ? {} : { encounterState }),
      ...(initiative === undefined ? {} : { initiative }),
    } as TMap,
  }
}
