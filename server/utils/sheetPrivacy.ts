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

const withoutPrivateBreedingMoveProvenance = <TSheet extends Record<string, unknown>>(sheet: TSheet): TSheet => {
  if (!Array.isArray(sheet.movelist)) return sheet
  let changed = false
  const movelist = sheet.movelist.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const row = value as Record<string, unknown>
    const source = row.permanentMoveSource
    if (!source || typeof source !== 'object' || Array.isArray(source)
      || (source as Record<string, unknown>).kind !== 'breeding-inheritance') return value
    const projected = { ...row }
    delete projected.permanentMoveSource
    changed = true
    return projected
  })
  return changed ? { ...sheet, movelist } : sheet
}

export const redactSheetRecordForPlayer = <TSheet extends Record<string, unknown>>(
  kind: SheetKind,
  sheet: TSheet,
): TSheet => {
  const projected = { ...withoutPrivateBreedingMoveProvenance(kind === 'pokemon' ? redactPokemonGmFields(sheet) : sheet) }
  // Capability operation IDs, retry clocks, and campaign internals are
  // projected through authorized facts/offers rather than raw sheet state.
  delete projected.capabilityUsage
  delete projected.capabilityCampaignState
  // Loyalty decisions are GM adjudication. Player mechanics receive only
  // server-derived outcomes (for example Return/Frustration damage), never rank.
  if (kind === 'pokemon') delete projected.loyalty
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
