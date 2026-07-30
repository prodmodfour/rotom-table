import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createEmptyCapabilityRuntimeState } from '#shared/capabilityAutomation/state'
import { resolveEffectiveCapabilities } from './effectiveCapabilities'
import { createMoveAutomationWeatherResolver } from '../moveAutomation/weather'

export interface CapabilityPresentationSheets {
  readonly pokemon: ReadonlyMap<string, CharacterSheet>
  readonly trainer: ReadonlyMap<string, TrainerSheet>
}

const PUBLIC_CAPABILITY_MODE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  blended: 'Blended',
  glowing: 'Glowing',
  illusion: 'Maintaining an Illusion',
  inflated: 'Inflated',
  invisible: 'Invisible',
  intangible: 'Intangible',
  'mega-evolved': 'Mega Evolved',
  crowned: 'Crowned Forme',
  'shadow-melded': 'Shadow Melded',
  shapechanged: 'Shapechanged',
  shrunken: 'Shrunken',
  'inside-machine': 'Inside a Machine',
  'zygarde-form': 'Zygarde Forme',
})

const publicCapabilityPresentationStates = (
  map: TabletopMap,
  sheets: CapabilityPresentationSheets | undefined,
  now: number,
): readonly Record<string, unknown>[] => {
  // Raw modes and links are authority, not evidence. If a realtime caller
  // cannot resolve every referenced sheet, it must omit presentation rather
  // than accidentally publishing a stale source-owned state.
  if (!sheets) return []
  const latest = new Map<string, Record<string, unknown>>()
  const effectiveSources = new Map<string, ReadonlySet<string>>()
  for (const placement of map.placements) {
    const sheet = placement.sheetKind === 'pokemon'
      ? sheets.pokemon.get(placement.sheetSlug)
      : sheets.trainer.get(placement.sheetSlug)
    if (!sheet) continue
    effectiveSources.set(placement.id, new Set(resolveEffectiveCapabilities({ map, placement, sheet, sheets })
      .instances.filter(instance => instance.effective)
      .map(instance => `${instance.instanceId}\u0000${instance.canonicalId}`)))
  }
  const sourceIsEffective = (placementId: string, capabilityInstanceId: string, canonicalId: string): boolean => (
    effectiveSources.get(placementId)?.has(`${capabilityInstanceId}\u0000${canonicalId}`) === true
  )
  for (const mode of map.encounterState?.capabilityRuntime?.modes ?? []) {
    const label = PUBLIC_CAPABILITY_MODE_LABELS[mode.mode]
    if (!label || (mode.expiresAt !== null && mode.expiresAt <= now)
      || !sourceIsEffective(mode.actorPlacementId, mode.capabilityInstanceId, mode.canonicalId)) continue
    const visibleDescription = (mode.mode === 'illusion' || mode.mode === 'shapechanged' || mode.mode === 'zygarde-form')
      && mode.description?.trim() && mode.description.trim().length <= 240
      ? mode.description.trim() : null
    const illusion = mode.mode === 'illusion' && Array.isArray(map.metadata?.capabilityIllusions)
      ? map.metadata.capabilityIllusions.find(raw => (
          raw && typeof raw === 'object' && !Array.isArray(raw)
          && (raw as Record<string, unknown>).ownerPlacementId === mode.actorPlacementId
        )) as Record<string, unknown> | undefined : undefined
    const illusionPosition = illusion?.position as Record<string, unknown> | undefined
    const publicPosition = Number.isSafeInteger(illusionPosition?.x)
      && Number.isSafeInteger(illusionPosition?.y) && Number.isSafeInteger(illusionPosition?.z)
      ? { x: illusionPosition!.x, y: illusionPosition!.y, z: illusionPosition!.z } : null
    const illusionDisrupted = mode.mode === 'illusion' && illusion?.disrupted === true
    latest.set(`${mode.actorPlacementId}:${mode.mode}`, {
      id: `public-rule-state:${mode.actorPlacementId}:${mode.mode}`,
      placementId: mode.actorPlacementId,
      state: mode.mode,
      label: illusionDisrupted ? 'Disrupted Illusion' : label,
      description: visibleDescription,
      ...(publicPosition ? { position: publicPosition } : {}),
      ...(illusionDisrupted ? { disrupted: true } : {}),
      expiresAt: mode.expiresAt,
    })
  }
  {
    for (const placement of map.placements) {
      if (placement.sheetKind !== 'pokemon') continue
      const sheet = sheets.pokemon.get(placement.sheetSlug)
      if (!sheet) continue
      const effectiveIds = new Set(resolveEffectiveCapabilities({ map, placement, sheet, sheets })
        .instances.filter(instance => instance.effective).map(instance => instance.canonicalId))
      const weather = createMoveAutomationWeatherResolver(map, { subjectPlacementId: placement.id }).active()[0]?.kind ?? null
      const form = effectiveIds.has('Bloom') && weather === 'sunny'
        ? 'Cherrim Sunshine Form'
        : effectiveIds.has('Weathershape')
          ? weather === 'sunny' ? 'Castform Sunny Form'
            : weather === 'rainy' ? 'Castform Rainy Form'
              : weather === 'hail' ? 'Castform Hail Form'
                : weather === 'sandstorm' ? 'Castform Sandstorm Form' : null
          : null
      if (form) latest.set(`${placement.id}:weather-form`, {
        id: `public-rule-state:${placement.id}:weather-form`,
        placementId: placement.id,
        state: 'weather-form',
        label: form,
        description: form,
        expiresAt: null,
      })
    }
  }
  for (const link of map.encounterState?.capabilityRuntime?.links ?? []) {
    if (!sourceIsEffective(link.ownerPlacementId, link.capabilityInstanceId, link.canonicalId)) continue
    const add = (
      placementId: string,
      state: string,
      label: string,
      presentation: Readonly<Record<string, unknown>> = {},
    ): void => {
      if (!map.placements.some(placement => placement.id === placementId)) return
      latest.set(`${placementId}:${state}`, {
        id: `public-rule-state:${placementId}:${state}`,
        placementId,
        state,
        label,
        description: null,
        expiresAt: null,
        ...presentation,
      })
    }
    if (link.kind === 'as-one-mount') add(link.ownerPlacementId, 'as-one-mounted', 'Mounted as One')
    if (link.kind === 'viral-fusion') add(link.ownerPlacementId, 'viral-fusion', 'Viral Fusion')
    if (link.kind === 'mount-rider') {
      add(link.ownerPlacementId, 'carrying-rider', 'Carrying Rider')
      for (const participantId of link.participantPlacementIds) add(participantId, 'mounted-rider', 'Mounted')
    }
    if (link.kind === 'living-weapon' && link.participantPlacementIds.length === 1) {
      const wielderPlacementId = link.participantPlacementIds[0]!
      // The physical pairing is public, but the raw link/source/configuration
      // remains private. Clients use this bounded relation only to derive an
      // exact menu from their authorized sheets; the server re-authorizes use.
      add(link.ownerPlacementId, 'living-weapon', 'Engaged Living Weapon', {
        counterpartPlacementId: wielderPlacementId,
      })
      add(wielderPlacementId, 'living-weapon-wielder', 'Wielding Living Weapon', {
        counterpartPlacementId: link.ownerPlacementId,
      })
    }
    if (link.kind === 'shadow-rider') {
      add(link.ownerPlacementId, 'shadow-rider', 'Riding a Shadow')
      for (const participantId of link.participantPlacementIds) add(participantId, 'shadow-host', 'Carrying a Shadow Rider')
    }
    if (link.kind === 'marsupial-pouch') {
      add(link.ownerPlacementId, 'marsupial-mother', 'Sheltering Baby')
      for (const participantId of link.participantPlacementIds) add(participantId, 'marsupial-baby', 'In Mother’s Pouch')
    }
  }
  return [...latest.values()]
}

const isCapabilityOwnedEffect = (effect: unknown): boolean => {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect)) return false
  const record = effect as Record<string, unknown>
  const source = record.source && typeof record.source === 'object' && !Array.isArray(record.source)
    ? record.source as Record<string, unknown> : null
  const moveId = typeof source?.moveId === 'string' ? source.moveId : ''
  const tags = Array.isArray(record.tags) ? record.tags : []
  return moveId.startsWith('capability.')
    || tags.some(tag => typeof tag === 'string' && (tag === 'capability' || tag.startsWith('capability-') || tag.startsWith('capability.')))
}

/** Add bounded, non-authoritative physical state used by shared renderers. */
export const projectCapabilityAutomationPresentationMap = (
  map: TabletopMap,
  sheets?: CapabilityPresentationSheets,
  now: number = Date.now(),
): TabletopMap => {
  const metadata = { ...(map.metadata ?? {}) } as Record<string, unknown>
  const presentationStates = publicCapabilityPresentationStates(map, sheets, now)
  if (presentationStates.length > 0) metadata.automationPresentationStates = presentationStates
  else delete metadata.automationPresentationStates
  return { ...map, metadata }
}

/**
 * Strip server-owned Capability authority and private sensory evidence from a
 * player map. Authorized facts/offers are projected separately by participant.
 */
export const projectCapabilityAutomationMapForPlayer = (
  map: TabletopMap,
  sheets?: CapabilityPresentationSheets,
): TabletopMap => {
  const presentedMap = projectCapabilityAutomationPresentationMap(map, sheets)
  const metadata = { ...(presentedMap.metadata ?? {}) } as Record<string, unknown>
  // Capability-prefixed map metadata is an authoritative input/ledger, never a
  // player payload. Public consequences are represented by placements,
  // terrain, sheets, and participant-specific Encounter Presentation facts.
  for (const key of Object.keys(metadata)) {
    if (key.startsWith('capability')) delete metadata[key]
  }
  const encounter = presentedMap.encounterState
  if (!encounter) return { ...presentedMap, metadata }
  const carriedPlacementIds = new Set((encounter.capabilityRuntime?.links ?? []).flatMap((link) => {
    if (!sheets || (link.kind !== 'as-one-mount' && link.kind !== 'viral-fusion' && link.kind !== 'marsupial-pouch')) return []
    const owner = map.placements.find(placement => placement.id === link.ownerPlacementId)
    const sheet = owner?.sheetKind === 'pokemon'
      ? sheets.pokemon.get(owner.sheetSlug)
      : owner?.sheetKind === 'trainer' ? sheets.trainer.get(owner.sheetSlug) : null
    if (!owner || !sheet) return []
    const sourceEffective = resolveEffectiveCapabilities({ map, placement: owner, sheet, sheets }).instances.some(instance => (
      instance.effective && instance.instanceId === link.capabilityInstanceId && instance.canonicalId === link.canonicalId
    ))
    return sourceEffective ? [...link.participantPlacementIds] : []
  }))
  const empty = createEmptyCapabilityRuntimeState()
  return {
    ...presentedMap,
    metadata,
    placements: presentedMap.placements.filter(placement => !carriedPlacementIds.has(placement.id)),
    encounterState: {
      ...encounter,
      // Raw modes/links include source identities, retained choices, hidden
      // illusion/device data, and retry evidence. Public physical outcomes are
      // projected separately; none of this authority crosses the player map.
      capabilityRuntime: empty,
      effects: encounter.effects.filter(effect => !isCapabilityOwnedEffect(effect)),
    },
  }
}
