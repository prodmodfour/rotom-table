import {
  isEncounterGlobalFieldZone,
  type EncounterZone,
} from '#shared/moveAutomation/encounterZones'

/** Clear links owned by zones that have left authoritative battlefield state. */
export const clearBattlefieldZoneSuppressionSources = (input: {
  readonly zones: readonly EncounterZone[]
  readonly removedZoneIds: ReadonlySet<string>
}): {
  readonly zones: readonly EncounterZone[]
  readonly clearedZoneIds: readonly string[]
} => {
  if (input.removedZoneIds.size === 0) return { zones: input.zones, clearedZoneIds: [] }
  const clearedZoneIds: string[] = []
  const zones = input.zones.map((zone): EncounterZone => {
    if (!isEncounterGlobalFieldZone(zone)) return zone
    const sources = zone.fieldPolicy.suppression.sources.filter(
      source => !input.removedZoneIds.has(source.zoneId),
    )
    if (sources.length === zone.fieldPolicy.suppression.sources.length) return zone
    clearedZoneIds.push(zone.id)
    return {
      ...zone,
      fieldPolicy: {
        ...zone.fieldPolicy,
        suppression: { sources },
      },
    }
  })
  return { zones, clearedZoneIds }
}

/** Keep suppression ancestry exact when a side transfer changes a zone ID. */
export const remapBattlefieldZoneSuppressionSources = (input: {
  readonly zones: readonly EncounterZone[]
  readonly zoneIdRemap: ReadonlyMap<string, string>
}): {
  readonly zones: readonly EncounterZone[]
  readonly remappedZoneIds: readonly string[]
} => {
  if (input.zoneIdRemap.size === 0) return { zones: input.zones, remappedZoneIds: [] }
  const remappedZoneIds: string[] = []
  const zones = input.zones.map((zone): EncounterZone => {
    if (!isEncounterGlobalFieldZone(zone)) return zone
    let changed = false
    const sources = zone.fieldPolicy.suppression.sources.map((source) => {
      const zoneId = input.zoneIdRemap.get(source.zoneId) ?? source.zoneId
      if (zoneId !== source.zoneId) changed = true
      return { ...source, zoneId }
    })
    if (!changed) return zone
    remappedZoneIds.push(zone.id)
    return {
      ...zone,
      fieldPolicy: {
        ...zone.fieldPolicy,
        suppression: { sources },
      },
    }
  })
  return { zones, remappedZoneIds }
}
