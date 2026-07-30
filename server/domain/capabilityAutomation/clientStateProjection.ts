import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { createEmptyCapabilityRuntimeState } from '#shared/capabilityAutomation/state'
import { isMoveAttackSourceId } from '#shared/moveAutomation/attackSource'
import { resolveEffectiveCapabilities } from './effectiveCapabilities'
import { createMoveAutomationWeatherResolver } from '../moveAutomation/weather'
import {
  physicalPowerSourceValues,
  resolvePhysicalPowerLoad,
} from './physicalPower'
import {
  livingWeaponAttackSourceId,
  livingWeaponAttackSourceLabel,
} from './livingWeaponAttackSource'

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
  const effectiveAcquisitionSources = new Map<string, ReadonlySet<string>>()
  for (const placement of map.placements) {
    const sheet = placement.sheetKind === 'pokemon'
      ? sheets.pokemon.get(placement.sheetSlug)
      : sheets.trainer.get(placement.sheetSlug)
    if (!sheet) continue
    const effective = resolveEffectiveCapabilities({ map, placement, sheet, sheets }).instances
    const effectiveInstances = effective.filter(instance => instance.effective)
    effectiveSources.set(placement.id, new Set(effectiveInstances
      .map(instance => `${instance.instanceId}\u0000${instance.canonicalId}`)))
    for (const instance of effectiveInstances) {
      effectiveAcquisitionSources.set(
        `${placement.id}\u0000${instance.instanceId}\u0000${instance.canonicalId}`,
        new Set(instance.sources.map(source => source.sourceId)),
      )
    }
    const physicalLoad = resolvePhysicalPowerLoad({
      map,
      placementId: placement.id,
      powerByCapabilityInstanceId: physicalPowerSourceValues(effective),
    })
    if (physicalLoad) {
      const loadLabel = physicalLoad.loadClass === 'heavy' ? 'Heavy Weight'
        : physicalLoad.loadClass === 'staggering' ? 'Staggering Weight'
          : physicalLoad.loadClass === 'drag' ? 'Drag Weight'
            : physicalLoad.loadClass === 'too-heavy' ? 'Too-Heavy Load' : 'Carrying Load'
      latest.set(`${placement.id}:physical-power-load`, {
        id: `public-rule-state:${placement.id}:physical-power-load`,
        placementId: placement.id,
        state: 'physical-power-load',
        label: loadLabel,
        description: loadLabel,
        loadClass: physicalLoad.loadClass,
        movementMetersPerShift: physicalLoad.movementMetersPerShift,
        speedCombatStagePenalty: physicalLoad.speedCombatStagePenalty,
        accuracyPenalty: physicalLoad.accuracyPenalty,
        evasionPenalty: physicalLoad.evasionPenalty,
        standardActionsAllowed: physicalLoad.standardActionsAllowed,
        athleticsCheckDc: physicalLoad.athleticsCheckDc,
        expiresAt: null,
      })
    }
  }
  const sourceIsEffective = (
    placementId: string,
    capabilityInstanceId: string,
    canonicalId: string,
    acquisitionSourceIds: readonly string[] | undefined,
  ): boolean => effectiveSources.get(placementId)?.has(`${capabilityInstanceId}\u0000${canonicalId}`) === true
    && (!acquisitionSourceIds?.length || acquisitionSourceIds.some(sourceId => (
      effectiveAcquisitionSources.get(`${placementId}\u0000${capabilityInstanceId}\u0000${canonicalId}`)?.has(sourceId)
    )))
  for (const mode of map.encounterState?.capabilityRuntime?.modes ?? []) {
    const label = PUBLIC_CAPABILITY_MODE_LABELS[mode.mode]
    if (!label || (mode.expiresAt !== null && mode.expiresAt <= now)
      || !sourceIsEffective(
        mode.actorPlacementId,
        mode.capabilityInstanceId,
        mode.canonicalId,
        mode.acquisitionSourceIds,
      )) continue
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
    const publicState = mode.mode === 'illusion' && !illusionDisrupted ? 'visual-effect' : mode.mode
    latest.set(`${mode.actorPlacementId}:${publicState}`, {
      id: `public-rule-state:${mode.actorPlacementId}:${publicState}`,
      placementId: mode.actorPlacementId,
      state: publicState,
      label: mode.mode === 'illusion'
        ? illusionDisrupted ? 'Disrupted Illusion' : visibleDescription ?? 'Visual Effect'
        : label,
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
    if (!sourceIsEffective(link.ownerPlacementId, link.capabilityInstanceId, link.canonicalId, undefined)) continue
    const add = (
      placementId: string,
      state: string,
      label: string,
      presentation: Readonly<Record<string, unknown>> = {},
      instanceKey: string = state,
    ): void => {
      if (!map.placements.some(placement => placement.id === placementId)) return
      const identitySuffix = instanceKey === state ? '' : `:${instanceKey}`
      latest.set(`${placementId}:${state}${identitySuffix}`, {
        id: `public-rule-state:${placementId}:${state}${identitySuffix}`,
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
      const ownerPlacement = map.placements.find(placement => placement.id === link.ownerPlacementId)
      const ownerSheet = ownerPlacement?.sheetKind === 'pokemon'
        ? sheets.pokemon.get(ownerPlacement.sheetSlug) ?? null
        : null
      if (!ownerPlacement || !ownerSheet) continue
      const attackSourceName = ownerSheet.nickname?.trim() || ownerSheet.species
      // The physical pairing and an opaque selector are public. Raw link,
      // source, configuration, and operation identities remain private; the
      // server independently revalidates every selected source.
      const ownerAttackSourceId = livingWeaponAttackSourceId({
        mapSlug: map.slug,
        actingPlacementId: link.ownerPlacementId,
        link,
      })
      const wielderAttackSourceId = livingWeaponAttackSourceId({
        mapSlug: map.slug,
        actingPlacementId: wielderPlacementId,
        link,
      })
      add(link.ownerPlacementId, 'living-weapon', 'Engaged Living Weapon', {
        counterpartPlacementId: wielderPlacementId,
        attackSourceId: ownerAttackSourceId,
        attackSourceLabel: livingWeaponAttackSourceLabel(attackSourceName, ownerAttackSourceId),
      }, ownerAttackSourceId)
      add(wielderPlacementId, 'living-weapon-wielder', 'Wielding Living Weapon', {
        counterpartPlacementId: link.ownerPlacementId,
        attackSourceId: wielderAttackSourceId,
        attackSourceLabel: livingWeaponAttackSourceLabel(attackSourceName, wielderAttackSourceId),
      }, wielderAttackSourceId)
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

const preservedCapabilityPresentationStates = (
  value: unknown,
  placementIds: ReadonlySet<string>,
): readonly Record<string, unknown>[] => {
  if (!Array.isArray(value)) return []
  const loadClasses = new Set(['unburdened', 'heavy', 'staggering', 'drag', 'too-heavy'])
  return value.flatMap((candidate): Record<string, unknown>[] => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const state = candidate as Record<string, unknown>
    if (typeof state.id !== 'string' || !state.id.startsWith('public-rule-state:') || state.id.length > 240
      || typeof state.placementId !== 'string' || !placementIds.has(state.placementId)
      || typeof state.state !== 'string' || !state.state || state.state.length > 120
      || typeof state.label !== 'string' || !state.label || state.label.length > 160) return []
    const projected: Record<string, unknown> = {
      id: state.id,
      placementId: state.placementId,
      state: state.state,
      label: state.label,
      description: state.description === null
        || (typeof state.description === 'string' && state.description.length <= 240)
        ? state.description : null,
      expiresAt: state.expiresAt === null
        || (Number.isSafeInteger(state.expiresAt) && (state.expiresAt as number) >= 0)
        ? state.expiresAt : null,
    }
    const position = state.position
    if (position && typeof position === 'object' && !Array.isArray(position)) {
      const point = position as Record<string, unknown>
      if (Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y) && Number.isSafeInteger(point.z)) {
        projected.position = { x: point.x, y: point.y, z: point.z }
      }
    }
    if (state.disrupted === true) projected.disrupted = true
    if (typeof state.loadClass === 'string' && loadClasses.has(state.loadClass)) projected.loadClass = state.loadClass
    for (const key of [
      'movementMetersPerShift', 'speedCombatStagePenalty', 'accuracyPenalty',
      'evasionPenalty', 'athleticsCheckDc',
    ] as const) {
      if (state[key] === null || (typeof state[key] === 'number' && Number.isFinite(state[key]))) {
        projected[key] = state[key]
      }
    }
    if (typeof state.standardActionsAllowed === 'boolean') {
      projected.standardActionsAllowed = state.standardActionsAllowed
    }
    if (typeof state.counterpartPlacementId === 'string'
      && placementIds.has(state.counterpartPlacementId)) {
      projected.counterpartPlacementId = state.counterpartPlacementId
    }
    if (isMoveAttackSourceId(state.attackSourceId)) projected.attackSourceId = state.attackSourceId
    if (typeof state.attackSourceLabel === 'string' && state.attackSourceLabel.length <= 120) {
      projected.attackSourceLabel = state.attackSourceLabel
    }
    return [projected]
  })
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

/** Remove every mechanics-only Capability lane from a public encounter value. */
export const projectCapabilityAutomationEncounterStateForPlayer = (
  encounter: NonNullable<TabletopMap['encounterState']>,
): NonNullable<TabletopMap['encounterState']> => ({
  ...encounter,
  capabilityRuntime: createEmptyCapabilityRuntimeState(),
  effects: encounter.effects.filter(effect => !isCapabilityOwnedEffect(effect)),
})

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
  const rawRuntime = map.encounterState?.capabilityRuntime
  const hasRawRuntimeAuthority = Boolean(rawRuntime) && (
    rawRuntime!.usages.entries.length > 0
    || rawRuntime!.modes.length > 0
    || rawRuntime!.links.length > 0
    || rawRuntime!.tasks.length > 0
    || rawRuntime!.pendingAdjudications.length > 0
    || rawRuntime!.checkPenalties.length > 0
  )
  // Preserve already-generated public presentation on a second privacy pass.
  // A raw authoritative runtime without sheets cannot prove those states, so
  // it deliberately drops them before stripping the authority lanes.
  const presentedMap = sheets || hasRawRuntimeAuthority
    ? projectCapabilityAutomationPresentationMap(map, sheets)
    : map
  const metadata = { ...(presentedMap.metadata ?? {}) } as Record<string, unknown>
  // Capability-prefixed map metadata is an authoritative input/ledger, never a
  // player payload. Public consequences are represented by placements,
  // terrain, sheets, and participant-specific Encounter Presentation facts.
  for (const key of Object.keys(metadata)) {
    if (key.startsWith('capability')) delete metadata[key]
  }
  const presentationStates = preservedCapabilityPresentationStates(
    metadata.automationPresentationStates,
    new Set(presentedMap.placements.map(placement => placement.id)),
  )
  if (presentationStates.length > 0) metadata.automationPresentationStates = presentationStates
  else delete metadata.automationPresentationStates
  const encounter = presentedMap.encounterState
  if (!encounter) return { ...presentedMap, metadata }
  const carriedPlacementIds = new Set((encounter.capabilityRuntime?.links ?? []).flatMap((link) => {
    if (link.kind !== 'as-one-mount' && link.kind !== 'viral-fusion' && link.kind !== 'marsupial-pouch') return []
    // A generic response/realtime privacy hook may not have a complete sheet
    // directory. Fail closed by hiding structurally carried participants; the
    // sheet-aware snapshot projector narrows this to exact effective sources.
    if (!sheets) return [...link.participantPlacementIds]
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
  return {
    ...presentedMap,
    metadata,
    placements: presentedMap.placements.filter(placement => !carriedPlacementIds.has(placement.id)),
    // Raw modes/links include source identities, retained choices, hidden
    // illusion/device data, and retry evidence. Public physical outcomes are
    // projected separately; none of this authority crosses the player map.
    encounterState: projectCapabilityAutomationEncounterStateForPlayer(encounter),
  }
}
