import {
  capabilityWeaponMove,
  capabilityWeaponMoveName,
  livingWeaponMoveNames,
  type CapabilityWeaponMoveName,
} from '#shared/capabilityAutomation/weaponMoves'
import type { CapabilityLinkState } from '#shared/capabilityAutomation/state'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { TokenSheetMoveEntry } from '~/utils/mapTokenMoves'
import { resolveEffectiveCapabilities } from './effectiveCapabilities'
import { resolveWielderWeaponProfile, type WielderWeaponProfile } from './wielder'

export interface CapabilityWeaponMoveGrant {
  readonly canonicalId: CapabilityWeaponMoveName
  readonly entry: TokenSheetMoveEntry
  readonly sourceKind: 'wielder-item' | 'living-weapon'
  readonly sourceId: string
  readonly damageBaseBonus: number
  readonly accuracyCheckPenalty: number
  readonly grantsReach: boolean
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
  readonly damageBaseBonus: number
  readonly accuracyCheckPenalty: number
  readonly grantsReach: boolean
}): CapabilityWeaponMoveGrant => {
  const move = capabilityWeaponMove(input.canonicalId)
  if (!move) throw new Error(`Missing reviewed capability weapon Move ${input.canonicalId}.`)
  return Object.freeze({
    ...input,
    entry: Object.freeze({ move, automatic: true, suppressStab: true }),
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
    damageBaseBonus: profile.damageBaseBonus,
    accuracyCheckPenalty: profile.accuracyCheckPenalty,
    grantsReach: profile.grantsReach,
  })
}

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

  for (const link of input.map.encounterState?.capabilityRuntime?.links ?? []) {
    if (link.kind !== 'living-weapon'
      || link.participantPlacementIds.length !== 1
      || (link.ownerPlacementId !== input.placement.id
        && !link.participantPlacementIds.includes(input.placement.id))
      || !exactEffectiveLink(link, input)) continue
    const owner = input.map.placements.find(placement => placement.id === link.ownerPlacementId)
    const ownerSheet = owner?.sheetKind === 'pokemon'
      ? input.pokemonSheets.get(owner.sheetSlug) ?? null : null
    const wielderId = link.participantPlacementIds[0]!
    const wielder = input.tokenForPlacement(wielderId)
    if (!owner || !ownerSheet || !wielder) continue
    for (const canonicalId of livingWeaponMoveNames(ownerSheet.species, wielder.combatSkillRankValue)) {
      grants.push(grantFor({
        canonicalId,
        sourceKind: 'living-weapon',
        sourceId: link.id,
        damageBaseBonus: 1,
        accuracyCheckPenalty: 0,
        grantsReach: false,
      }))
    }
  }

  const byCanonicalId = new Map<CapabilityWeaponMoveName, CapabilityWeaponMoveGrant>()
  for (const grant of grants) {
    const existing = byCanonicalId.get(grant.canonicalId)
    if (!existing || grant.damageBaseBonus > existing.damageBaseBonus) {
      byCanonicalId.set(grant.canonicalId, grant)
    }
  }
  return Object.freeze([...byCanonicalId.values()])
}
