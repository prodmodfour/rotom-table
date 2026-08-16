import { createHash } from 'node:crypto'
import {
  capabilityWeaponMove,
  livingWeaponMoveNames,
  type CapabilityWeaponMoveName,
} from '#shared/capabilityAutomation/weaponMoves'
import type { CapabilityLinkState } from '#shared/capabilityAutomation/state'
import type { MoveAttackSourceId } from '#shared/moveAutomation/attackSource'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { TokenSheetMoveEntry } from '~/utils/mapTokenMoves'
import type {
  EquipmentMoveGrantV1,
  EquipmentWeaponProfileGrantV1,
} from '#shared/itemAutomation/equipmentGrants'
import type {
  ResolvedEquipmentGrant,
  ResolveEquipmentGrantsResult,
} from '../itemAutomation/equipmentGrants'
import { resolveEffectiveCapabilities } from './effectiveCapabilities'
import {
  livingWeaponAttackSourceId,
  livingWeaponAttackSourceLabel,
} from './livingWeaponAttackSource'

export interface CapabilityWeaponMoveGrant {
  readonly canonicalId: CapabilityWeaponMoveName
  readonly entry: TokenSheetMoveEntry
  readonly sourceKind: 'wielder-item' | 'living-weapon'
  readonly sourceId: string
  readonly attackSourceId: MoveAttackSourceId | null
  readonly attackSourceLabel: string | null
  readonly damageBaseBonus: number
  readonly accuracyCheckPenalty: number
  readonly grantsReach: boolean
}

export interface EquipmentWeaponAttackSource {
  readonly attackSourceId: MoveAttackSourceId
  readonly attackSourceLabel: string
  readonly sourceId: string
  readonly canonicalItemId: string
  readonly profile: EquipmentWeaponProfileGrantV1
}

export interface LivingWeaponAttackSource {
  readonly attackSourceId: MoveAttackSourceId
  readonly attackSourceLabel: string
  readonly link: CapabilityLinkState
  readonly ownerPlacement: SheetPlacement
  readonly ownerSheet: CharacterSheet
  readonly wielderPlacementId: string
  readonly wielderToken: SpawnedPokemon
  readonly actorIsWielder: boolean
}

export interface ResolveCapabilityWeaponMoveGrantsInput {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
  readonly token: SpawnedPokemon
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly tokenForPlacement: (placementId: string) => SpawnedPokemon | null
  /** Current hash- and suppression-validated equipment grants. Omission grants nothing. */
  readonly equipmentGrants?: ResolveEquipmentGrantsResult
}

const placementSheet = (
  placement: SheetPlacement,
  input: ResolveCapabilityWeaponMoveGrantsInput,
): CharacterSheet | TrainerSheet | null => placement.sheetKind === 'pokemon'
  ? input.pokemonSheets.get(placement.sheetSlug) ?? null
  : input.trainerSheets.get(placement.sheetSlug) ?? null

const exactEffectiveLink = (
  link: CapabilityLinkState,
  input: ResolveCapabilityWeaponMoveGrantsInput,
): boolean => {
  const owner = input.map.placements.find(placement => placement.id === link.ownerPlacementId)
  if (!owner) return false
  const sheet = placementSheet(owner, input)
  if (!sheet) return false
  return resolveEffectiveCapabilities({
    map: input.map,
    placement: owner,
    sheet,
    sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
  }).instances.some(instance => (
    instance.effective
    && instance.instanceId === link.capabilityInstanceId
    && instance.canonicalId === link.canonicalId
    && instance.canonicalId === 'Living Weapon'
  ))
}

const grantFor = (input: {
  readonly canonicalId: CapabilityWeaponMoveName
  readonly sourceKind: CapabilityWeaponMoveGrant['sourceKind']
  readonly sourceId: string
  readonly attackSourceId: MoveAttackSourceId | null
  readonly attackSourceLabel: string | null
  readonly damageBaseBonus: number
  readonly accuracyCheckPenalty: number
  readonly grantsReach: boolean
}): CapabilityWeaponMoveGrant => {
  const move = capabilityWeaponMove(input.canonicalId)
  if (!move) throw new Error(`Missing reviewed capability weapon Move ${input.canonicalId}.`)
  return Object.freeze({
    ...input,
    entry: Object.freeze({
      move,
      automatic: true,
      suppressStab: true,
      ...(input.attackSourceId ? { attackSourceId: input.attackSourceId } : {}),
      ...(input.attackSourceLabel ? { attackSourceLabel: input.attackSourceLabel } : {}),
    }),
  })
}

const equipmentAttackSourceId = (input: {
  readonly mapSlug: string
  readonly placementId: string
  readonly instanceId: string
  readonly grantId: string
}): MoveAttackSourceId => `attack-source.v1.${createHash('sha256')
  .update(['equipment-weapon-source.v1', input.mapSlug, input.placementId, input.instanceId, input.grantId].join('\u0000'))
  .digest('hex')}`

const pokemonSizeAllowsProfile = (
  profile: EquipmentWeaponProfileGrantV1,
  size: string | null | undefined,
): boolean => {
  const normalized = size?.trim().toLocaleLowerCase('en-US') ?? ''
  return profile.pokemonWielderSizePolicy === 'small-only'
    ? normalized === 'small'
    : profile.pokemonWielderSizePolicy === 'medium-plus'
      ? ['medium', 'large', 'huge', 'gigantic'].includes(normalized)
      : false
}

const activeEquipmentProfiles = (
  input: ResolveCapabilityWeaponMoveGrantsInput,
  hasWielder: boolean,
): readonly { readonly source: ResolvedEquipmentGrant; readonly profile: EquipmentWeaponProfileGrantV1 }[] => (
  input.equipmentGrants?.active.flatMap((source) => {
    if (source.grant.kind !== 'weapon-profile' || source.grant.executionStatus !== 'native') return []
    if (input.placement.sheetKind === 'trainer') return [{ source, profile: source.grant }]
    return hasWielder && pokemonSizeAllowsProfile(source.grant, input.token.size)
      ? [{ source, profile: source.grant }]
      : []
  }) ?? []
)

/** Exact current equipment weapon selectors, opaque outside server authority. */
export const resolveEquipmentWeaponAttackSources = (
  input: ResolveCapabilityWeaponMoveGrantsInput,
): readonly EquipmentWeaponAttackSource[] => {
  const hasWielder = input.placement.sheetKind === 'pokemon'
    && resolveEffectiveCapabilities({
      map: input.map,
      placement: input.placement,
      sheet: input.sheet,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    }).instances.some(instance => instance.effective && instance.canonicalId === 'Wielder')
  return Object.freeze(activeEquipmentProfiles(input, hasWielder).map(({ source, profile }) => {
    const attackSourceId = equipmentAttackSourceId({
      mapSlug: input.map.slug,
      placementId: input.placement.id,
      instanceId: source.instanceId,
      grantId: profile.grantId,
    })
    return Object.freeze({
      attackSourceId,
      attackSourceLabel: source.canonicalItemId,
      sourceId: source.instanceId,
      canonicalItemId: source.canonicalItemId,
      profile,
    })
  }))
}

const eligibleEquipmentMoveGrant = (input: {
  readonly placementKind: SheetPlacement['sheetKind']
  readonly rank: number
  readonly hasWielder: boolean
  readonly move: EquipmentMoveGrantV1
}): boolean => input.move.executionStatus === 'native'
  && input.rank >= input.move.minimumCombatRank
  && (input.placementKind === 'trainer'
    ? input.move.trainerEligible
    : input.hasWielder && input.move.pokemonWielderEligible)

/** Resolve every exact current Living Weapon source for one acting placement. */
export const resolveLivingWeaponAttackSources = (
  input: ResolveCapabilityWeaponMoveGrantsInput,
): readonly LivingWeaponAttackSource[] => Object.freeze(
  (input.map.encounterState?.capabilityRuntime?.links ?? []).flatMap((link): LivingWeaponAttackSource[] => {
    if (link.kind !== 'living-weapon'
      || link.participantPlacementIds.length !== 1
      || (link.ownerPlacementId !== input.placement.id
        && !link.participantPlacementIds.includes(input.placement.id))
      || !exactEffectiveLink(link, input)) return []
    const ownerPlacement = input.map.placements.find(placement => placement.id === link.ownerPlacementId)
    const ownerSheet = ownerPlacement?.sheetKind === 'pokemon'
      ? input.pokemonSheets.get(ownerPlacement.sheetSlug) ?? null : null
    const wielderPlacementId = link.participantPlacementIds[0]!
    const wielderToken = input.tokenForPlacement(wielderPlacementId)
    if (!ownerPlacement || !ownerSheet || !wielderToken) return []
    const attackSourceId = livingWeaponAttackSourceId({
      mapSlug: input.map.slug,
      actingPlacementId: input.placement.id,
      link,
    })
    return [{
      attackSourceId,
      attackSourceLabel: livingWeaponAttackSourceLabel(
        ownerSheet.nickname?.trim() || ownerSheet.species,
        attackSourceId,
      ),
      link,
      ownerPlacement,
      ownerSheet,
      wielderPlacementId,
      wielderToken,
      actorIsWielder: wielderPlacementId === input.placement.id,
    }]
  }),
)

/**
 * Resolve only source-effective, size/rank-legal supplemental weapon Moves.
 * Callers may expose the returned complete entries; raw links remain private.
 */
export const resolveCapabilityWeaponMoveGrants = (
  input: ResolveCapabilityWeaponMoveGrantsInput,
): readonly CapabilityWeaponMoveGrant[] => {
  const grants: CapabilityWeaponMoveGrant[] = []
  const hasWielder = input.placement.sheetKind === 'pokemon'
    && resolveEffectiveCapabilities({
      map: input.map,
      placement: input.placement,
      sheet: input.sheet,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    }).instances.some(instance => instance.effective && instance.canonicalId === 'Wielder')
  const profiles = activeEquipmentProfiles(input, hasWielder)
  const profileByInstance = new Map(profiles.map(entry => [entry.source.instanceId, entry.profile]))
  for (const source of input.equipmentGrants?.active ?? []) {
    if (source.grant.kind !== 'move' || !eligibleEquipmentMoveGrant({
      placementKind: input.placement.sheetKind,
      rank: input.token.combatSkillRankValue ?? 0,
      hasWielder,
      move: source.grant,
    })) continue
    const profile = profileByInstance.get(source.instanceId)
    if (!profile) continue
    const attackSourceId = equipmentAttackSourceId({
      mapSlug: input.map.slug,
      placementId: input.placement.id,
      instanceId: source.instanceId,
      grantId: profile.grantId,
    })
    grants.push(grantFor({
      canonicalId: source.grant.canonicalId as CapabilityWeaponMoveName,
      sourceKind: 'wielder-item',
      sourceId: source.instanceId,
      attackSourceId,
      attackSourceLabel: source.canonicalItemId,
      damageBaseBonus: profile.damageBaseBonus,
      accuracyCheckPenalty: profile.accuracyCheckPenalty,
      grantsReach: profile.grantsReach,
    }))
  }

  for (const source of resolveLivingWeaponAttackSources(input)) {
    for (const canonicalId of livingWeaponMoveNames(
      source.ownerSheet.species,
      source.wielderToken.combatSkillRankValue,
    )) {
      grants.push(grantFor({
        canonicalId,
        sourceKind: 'living-weapon',
        sourceId: source.link.id,
        attackSourceId: source.attackSourceId,
        attackSourceLabel: source.attackSourceLabel,
        damageBaseBonus: 1,
        accuracyCheckPenalty: 0,
        grantsReach: false,
      }))
    }
  }

  const retained = new Map<string, CapabilityWeaponMoveGrant>()
  for (const grant of grants) {
    const key = `${grant.canonicalId}\u0000${grant.attackSourceId ?? `source:${grant.sourceKind}:${grant.sourceId}`}`
    const existing = retained.get(key)
    if (!existing || grant.damageBaseBonus > existing.damageBaseBonus) retained.set(key, grant)
  }
  return Object.freeze([...retained.values()])
}
