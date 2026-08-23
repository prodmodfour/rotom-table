import { createHash } from 'node:crypto'
import { parseSheetEquipmentStateForOwner } from '#shared/itemAutomation/equipment'
import { parseShockCollarPairState, type ShockCollarPairStateV1 } from '#shared/itemAutomation/shockCollar'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { ResolvedEquipmentGrant, ResolveEquipmentGrantsResult } from './equipmentGrants'

export interface ShockCollarImplicitRemoteAuthority {
  readonly remoteInstanceId: string
  readonly remoteInstanceRevision: number
  readonly holderTrainerSlug: string
  readonly collarSource: ResolvedEquipmentGrant
  readonly groundCapable: boolean
}

export interface ShockCollarPairCandidate {
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
  readonly source: ResolvedEquipmentGrant
  readonly pair: ShockCollarPairStateV1
}

export const shockCollarPairForInstance = (input: {
  readonly placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>
  readonly sheet: CharacterSheet | TrainerSheet
  readonly instanceId: string
}): ShockCollarPairStateV1 | null => {
  if (!input.sheet.equipmentState) return null
  const state = parseSheetEquipmentStateForOwner(input.sheet.equipmentState, {
    kind: input.placement.sheetKind,
    slug: input.placement.sheetSlug,
  })
  const instance = state.instances.find(candidate => candidate.instanceId === input.instanceId)
  return instance ? parseShockCollarPairState(instance.serializedState) : null
}

export const shockCollarImplicitRemoteAuthority = (input: {
  readonly placement: Pick<SheetPlacement, 'sheetKind' | 'sheetSlug'>
  readonly sheet: CharacterSheet | TrainerSheet
  readonly collarSource: ResolvedEquipmentGrant
}): ShockCollarImplicitRemoteAuthority | null => {
  if (!input.sheet.equipmentState || input.collarSource.canonicalItemId !== 'Shock Collar') return null
  const state = parseSheetEquipmentStateForOwner(input.sheet.equipmentState, {
    kind: input.placement.sheetKind,
    slug: input.placement.sheetSlug,
  })
  const instance = state.instances.find(candidate => candidate.instanceId === input.collarSource.instanceId)
  if (!instance || instance.source.containerKind !== 'trainer') return null
  const configured = parseShockCollarPairState(instance.serializedState)
  // Explicit split-pair state uses the stricter paired-component resolver below.
  if (configured) return null
  const groundCapable = instance.serializedState.shockCollarGroundCapable === true
  return Object.freeze({
    remoteInstanceId: `shock-collar-remote:v1:${createHash('sha256')
      .update(['shock-collar-remote.v1', instance.instanceId, instance.source.containerSlug].join('\u0000'))
      .digest('hex')}`,
    remoteInstanceRevision: instance.revision,
    holderTrainerSlug: instance.source.containerSlug,
    collarSource: input.collarSource,
    groundCapable,
  })
}

/** Resolve private exact collar/remote pairing only from current active grant authority. */
export const resolveShockCollarPairCandidates = (input: {
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly remoteSource: ResolvedEquipmentGrant
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly grantsForPlacement: (placementId: string) => ResolveEquipmentGrantsResult | null
}): readonly ShockCollarPairCandidate[] => {
  const remote = shockCollarPairForInstance({
    placement: input.actorPlacement,
    sheet: input.actorSheet,
    instanceId: input.remoteSource.instanceId,
  })
  if (!remote || remote.role !== 'remote') return Object.freeze([])
  return Object.freeze(input.map.placements.flatMap((placement): ShockCollarPairCandidate[] => {
    const sheet = placement.sheetKind === 'pokemon'
      ? input.pokemonSheets.get(placement.sheetSlug)
      : input.trainerSheets.get(placement.sheetSlug)
    if (!sheet) return []
    const source = input.grantsForPlacement(placement.id)?.active.find(entry => (
      entry.canonicalItemId === 'Shock Collar'
      && entry.instanceId !== input.remoteSource.instanceId
    ))
    if (!source) return []
    const pair = shockCollarPairForInstance({ placement, sheet, instanceId: source.instanceId })
    return pair?.role === 'collar' && pair.pairId === remote.pairId
      ? [{ placement, sheet, source, pair }]
      : []
  }))
}
