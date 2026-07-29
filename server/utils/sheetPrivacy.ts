import type { SheetKind } from '#shared/sheets'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { redactPokemonGmFields } from '~/utils/sheets/pokemonGmFields'
import {
  playerCanAccessSheet,
  type PlayerProfileLinkedTrainerSheetSource,
} from '../policies/playerProfilePolicy'

export type SheetPrivacyDocument = CharacterSheet | TrainerSheet

export interface SheetUpdateRecord<TSheet extends Record<string, unknown> = Record<string, unknown>> {
  readonly kind: SheetKind
  readonly sheet: TSheet
}

export const redactSheetRecordForPlayer = <TSheet extends Record<string, unknown>>(
  kind: SheetKind,
  sheet: TSheet,
): TSheet => {
  const projected = { ...(kind === 'pokemon' ? redactPokemonGmFields(sheet) : sheet) }
  // Capability operation IDs, retry clocks, and campaign internals are
  // projected through authorized facts/offers rather than raw sheet state.
  delete projected.capabilityUsage
  delete projected.capabilityCampaignState
  return projected as TSheet
}

export const redactSheetForPlayer = <TSheet extends SheetPrivacyDocument>(
  kind: SheetKind,
  sheet: TSheet,
): TSheet => redactSheetRecordForPlayer(kind, sheet as unknown as Record<string, unknown>) as unknown as TSheet

export const redactSheetUpdateForPlayer = <TUpdate extends SheetUpdateRecord>(update: TUpdate): TUpdate => {
  return {
    ...update,
    sheet: redactSheetRecordForPlayer(update.kind, update.sheet),
  }
}

export const redactSheetUpdatesForPlayer = <TUpdate extends SheetUpdateRecord>(
  updates: readonly TUpdate[] | undefined,
): TUpdate[] | undefined => updates?.map((update) => redactSheetUpdateForPlayer(update))

/**
 * Filter authoritative sheet responses through the same profile visibility
 * boundary as direct sheet loads. This prevents a move against a private token
 * from returning that token's held items or trainer inventory in HTTP data.
 */
export const accessibleSheetUpdatesForPlayer = <TUpdate extends SheetUpdateRecord>(
  updates: readonly TUpdate[] | undefined,
  input: {
    readonly playerProfile?: PlayerProfile | null
    readonly linkedTrainerSheets?: PlayerProfileLinkedTrainerSheetSource
  },
): TUpdate[] | undefined => updates?.flatMap((update) => {
  const slug = typeof update.sheet.slug === 'string' ? update.sheet.slug : ''
  if (!slug || !playerCanAccessSheet({
    kind: update.kind,
    slug,
    sheet: update.sheet,
    playerProfile: input.playerProfile,
    linkedTrainerSheets: input.linkedTrainerSheets,
  })) {
    return []
  }
  return [redactSheetUpdateForPlayer(update)]
})
