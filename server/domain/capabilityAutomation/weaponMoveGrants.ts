import {
  capabilityWeaponMove,
  capabilityWeaponMoveName,
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
import { resolveEffectiveCapabilities } from './effectiveCapabilities'
import { resolveWielderWeaponProfile, type WielderWeaponProfile } from './wielder'
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

const itemGrant = (
  profile: WielderWeaponProfile,
  rank: number,
): CapabilityWeaponMoveGrant | null => {
  if (rank < 4 || !profile.adeptMoveName) return null
  const canonicalId = capabilityWeaponMoveName(profile.adeptMoveName)
  if (!canonicalId) return null
  return grantFor({
    canonicalId,
    sourceKind: 'wielder-item',
    sourceId: profile.canonicalItemName,
    attackSourceId: null,
    attackSourceLabel: null,
    damageBaseBonus: profile.damageBaseBonus,
    accuracyCheckPenalty: profile.accuracyCheckPenalty,
    grantsReach: profile.grantsReach,
  })
}

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
  if (input.placement.sheetKind === 'pokemon') {
    const hasWielder = resolveEffectiveCapabilities({
      map: input.map,
      placement: input.placement,
      sheet: input.sheet,
      sheets: { pokemon: input.pokemonSheets, trainer: input.trainerSheets },
    }).instances.some(instance => instance.effective && instance.canonicalId === 'Wielder')
    const profile = hasWielder ? resolveWielderWeaponProfile({
      heldItemName: (input.sheet as CharacterSheet).items?.held,
      size: input.token.size,
    }) : null
    const grant = profile ? itemGrant(profile, input.token.combatSkillRankValue ?? 0) : null
    if (grant) grants.push(grant)
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
