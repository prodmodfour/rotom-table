import { parseCapabilityRuntimeState } from '#shared/capabilityAutomation/state'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { resolveEffectiveCapabilities } from './effectiveCapabilities'
import { capabilityGlowLightId } from './glow'

const sheetForPlacement = (
  placement: TabletopMap['placements'][number],
  sheets: {
    readonly pokemon: ReadonlyMap<string, CharacterSheet>
    readonly trainer: ReadonlyMap<string, TrainerSheet>
  },
): CharacterSheet | TrainerSheet | null => placement.sheetKind === 'pokemon'
  ? sheets.pokemon.get(placement.sheetSlug) ?? null
  : sheets.trainer.get(placement.sheetSlug) ?? null

/**
 * Permanently discard temporary Capability modes/links once their exact source
 * instance is no longer effective. This prevents a suppressed, removed, or
 * replaced source from silently reactivating old state if it is later regained.
 * Irreversible Letter Press state is sheet-owned and intentionally survives.
 */
export const reconcileCapabilityRuntimeSourceLoss = (input: {
  readonly map: TabletopMap
  readonly sheets: {
    readonly pokemon: ReadonlyMap<string, CharacterSheet>
    readonly trainer: ReadonlyMap<string, TrainerSheet>
  }
}): TabletopMap => {
  const encounter = input.map.encounterState
  const runtime = encounter?.capabilityRuntime
  if (!encounter || !runtime) return input.map
  const placementById = new Map(input.map.placements.map(placement => [placement.id, placement]))
  const sourceEffective = (entry: {
    readonly ownerPlacementId?: string
    readonly actorPlacementId?: string
    readonly capabilityInstanceId: string
    readonly canonicalId: string
  }): boolean => {
    const placementId = entry.actorPlacementId ?? entry.ownerPlacementId
    const placement = placementId ? placementById.get(placementId) : null
    const sheet = placement ? sheetForPlacement(placement, input.sheets) : null
    if (!placement || !sheet) return false
    return resolveEffectiveCapabilities({
      map: input.map,
      placement,
      sheet,
      sheets: input.sheets,
    }).instances.some(instance => (
      instance.instanceId === entry.capabilityInstanceId
      && instance.canonicalId === entry.canonicalId
      && instance.effective
    ))
  }
  const modes = runtime.modes.filter(entry => (
    sourceEffective(entry)
    && (entry.mode !== 'blended' || encounter.effects.some(effect => (
      effect.id === entry.id
      && effect.suppression.sources.length === 0
      && (effect.duration.remaining === null || effect.duration.remaining > 0)
    )))
    && (entry.mode !== 'mega-evolved' || Boolean(input.map.activeScene
      && Array.isArray(input.map.metadata?.capabilityMegaEvolutionUses)
      && input.map.metadata.capabilityMegaEvolutionUses.some(raw => {
        const use = raw as Record<string, unknown>
        return use?.actorPlacementId === entry.actorPlacementId
          && typeof use.trainerSlug === 'string'
          && entry.configurationId?.startsWith(`trainer:${use.trainerSlug};ability:`) === true
          && use.sceneStartedAt === (input.map.activeScene?.startedAt ?? 0)
      })))
  ))
  const links = runtime.links.filter(link => (
    link.kind === 'letter-press'
    || (sourceEffective(link) && link.participantPlacementIds.every(id => placementById.has(id)))
  ))
  const tasks = runtime.tasks.filter(task => sourceEffective(task))
  let pouchStateChanged = false
  const capabilityMarsupialPouches = Array.isArray(input.map.metadata?.capabilityMarsupialPouches)
    ? input.map.metadata.capabilityMarsupialPouches.filter((raw) => {
        const pouch = raw as Record<string, unknown>
        const motherId = typeof pouch?.motherPlacementId === 'string' ? pouch.motherPlacementId : null
        const babyId = typeof pouch?.babyPlacementId === 'string' ? pouch.babyPlacementId : null
        const babyPlacement = babyId ? placementById.get(babyId) : null
        const babySheet = babyPlacement?.sheetKind === 'pokemon'
          ? input.sheets.pokemon.get(babyPlacement.sheetSlug) : null
        const pouchLink = motherId && babyId ? links.find(link => (
          link.kind === 'marsupial-pouch'
          && link.ownerPlacementId === motherId
          && link.participantPlacementIds.includes(babyId)
          && (typeof pouch.capabilityInstanceId !== 'string'
            || link.capabilityInstanceId === pouch.capabilityInstanceId)
        )) : null
        // The retained link has already proved the exact Marsupial instance is
        // still effective. A same-canonical replacement must never preserve a
        // pouch that belonged to a different source instance.
        const retained = Boolean(motherId && babyId && babyPlacement && babySheet
          && (babySheet.level ?? 0) < 25
          && pouchLink)
        if (!retained) pouchStateChanged = true
        return retained
      }) : null
  let attachmentSourceRemoved = false
  const capabilityObjects = Array.isArray(input.map.metadata?.capabilityObjects)
    ? input.map.metadata.capabilityObjects.map((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
        const object = raw as Record<string, unknown>
        if (typeof object.attachedToPlacementId !== 'string'
          || typeof object.attachedCapabilityInstanceId !== 'string') return raw
        if (sourceEffective({
          actorPlacementId: object.attachedToPlacementId,
          capabilityInstanceId: object.attachedCapabilityInstanceId,
          canonicalId: 'Magnetic',
        })) return raw
        attachmentSourceRemoved = true
        return { ...object, attachedToPlacementId: null, attachedCapabilityInstanceId: null }
      }) : null
  if (modes.length === runtime.modes.length && links.length === runtime.links.length
    && tasks.length === runtime.tasks.length && !attachmentSourceRemoved && !pouchStateChanged) return input.map
  const retainedModeIds = new Set(modes.map(mode => mode.id))
  const removedModes = runtime.modes.filter(mode => !retainedModeIds.has(mode.id))
  const removedModeIds = new Set(removedModes.map(mode => mode.id))
  const removedIllusionModes = removedModes.filter(mode => mode.mode === 'illusion')
  const retainedGlowPlacementIds = new Set(modes
    .filter(mode => mode.mode === 'glowing')
    .map(mode => mode.actorPlacementId))
  const removedGlowPlacementIds = new Set(removedModes
    .filter(mode => mode.mode === 'glowing' && !retainedGlowPlacementIds.has(mode.actorPlacementId))
    .map(mode => mode.actorPlacementId))
  const retainedIllusionModes = modes.filter(mode => mode.mode === 'illusion')
  const metadata = { ...(input.map.metadata ?? {}) }
  if (capabilityObjects) metadata.capabilityObjects = capabilityObjects
  if (capabilityMarsupialPouches) metadata.capabilityMarsupialPouches = capabilityMarsupialPouches
  if (removedIllusionModes.length > 0 && Array.isArray(metadata.capabilityIllusions)) {
    metadata.capabilityIllusions = metadata.capabilityIllusions.filter((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return true
      const illusion = raw as Record<string, unknown>
      const ownerPlacementId = typeof illusion.ownerPlacementId === 'string'
        ? illusion.ownerPlacementId : null
      if (!ownerPlacementId) return true
      const sourceOperationId = typeof illusion.sourceOperationId === 'string'
        ? illusion.sourceOperationId : null
      const removedForOwner = removedIllusionModes.filter(mode => mode.actorPlacementId === ownerPlacementId)
      if (removedForOwner.length === 0) return true
      if (sourceOperationId !== null) {
        return !removedForOwner.some(mode => mode.sourceOperationId === sourceOperationId)
      }
      // Legacy illusion metadata did not always retain operation provenance.
      // Keep an ambiguous record only while an exact, source-effective
      // illusion mode for that owner remains; otherwise source loss is final.
      return retainedIllusionModes.some(mode => mode.actorPlacementId === ownerPlacementId)
    })
  }
  return {
    ...input.map,
    metadata,
    ...(removedGlowPlacementIds.size > 0 ? {
      lights: (input.map.lights ?? []).filter(light => (
        ![...removedGlowPlacementIds].some(placementId => light.id === capabilityGlowLightId(placementId))
      )),
    } : {}),
    encounterState: {
      ...encounter,
      effects: encounter.effects.filter(effect => !removedModeIds.has(effect.id)),
      capabilityRuntime: parseCapabilityRuntimeState({ ...runtime, modes, links, tasks }),
    },
  }
}
