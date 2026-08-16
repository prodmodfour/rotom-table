import type { SheetKind } from '#shared/sheets'
import type { PlayerProfile } from '#shared/playerProfiles'
import { projectSheetEquipmentStateForPlayer } from '#shared/itemAutomation/equipment'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { redactPokemonGmFields } from '~/utils/sheets/pokemonGmFields'
import {
  playerCanAccessSheet,
  type PlayerProfileLinkedTrainerSheetSource,
} from '../policies/playerProfilePolicy'
import { projectEquipmentContributionsForSheet } from '../domain/itemAutomation/equipmentContributionProjection'
import { parseItemMedicalTreatmentState } from '#shared/itemAutomation/medicalTreatments'
import { projectItemMedicalTreatments } from '../domain/itemAutomation/medicalTreatments'

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

export const projectSheetEquipmentContributions = <TSheet extends Record<string, unknown>>(
  kind: SheetKind,
  sheet: TSheet,
): TSheet => {
  const projected = { ...sheet } as Record<string, unknown>
  delete projected.equipmentContributionProjection
  delete projected.itemMedicalTreatmentProjection
  delete projected.itemExplorationProjection
  const medicalTreatmentState = projected.itemMedicalTreatments
  delete projected.itemMedicalTreatments
  const serverPrivate = projected.serverPrivate
  if (kind === 'trainer') delete projected.serverPrivate
  else if (serverPrivate && typeof serverPrivate === 'object' && !Array.isArray(serverPrivate)) {
    const safeServerPrivate = { ...(serverPrivate as Record<string, unknown>) }
    delete safeServerPrivate.itemPermanentAdvancement
    delete safeServerPrivate.itemMoveLearning
    delete safeServerPrivate.itemEvolution
    delete safeServerPrivate.itemGuidedLoyalty
    if (Object.keys(safeServerPrivate).length > 0) projected.serverPrivate = safeServerPrivate
    else delete projected.serverPrivate
  }
  if (medicalTreatmentState !== undefined) {
    try {
      const state = parseItemMedicalTreatmentState(medicalTreatmentState)
      const projectedAt = state.entries.reduce((maximum, entry) => Math.max(
        maximum,
        entry.terminalCampaignMinute ?? entry.healedThroughCampaignMinute,
      ), 0)
      projected.itemMedicalTreatmentProjection = projectItemMedicalTreatments({
        sheet: sheet as unknown as CharacterSheet | TrainerSheet,
        campaignMinute: projectedAt,
      })
    }
    catch { /* Corrupt lifecycle evidence remains private and mechanically fail-closed. */ }
  }
  if (projected.equipmentState !== undefined && typeof projected.slug === 'string') {
    const contributionProjection = projectEquipmentContributionsForSheet({
      kind,
      slug: projected.slug,
      sheet: sheet as unknown as CharacterSheet | TrainerSheet,
    })
    if (contributionProjection) projected.equipmentContributionProjection = contributionProjection
  }
  return projected as TSheet
}

export const redactSheetRecordForPlayer = <TSheet extends Record<string, unknown>>(
  kind: SheetKind,
  sheet: TSheet,
): TSheet => {
  const projected = {
    ...withoutPrivateBreedingMoveProvenance(kind === 'pokemon' ? redactPokemonGmFields(sheet) : sheet),
  } as Record<string, unknown>
  const equipmentState = projected.equipmentState
  const medicalTreatmentState = projected.itemMedicalTreatments
  delete projected.equipmentState
  delete projected.equipmentProjection
  delete projected.equipmentContributionProjection
  delete projected.itemMedicalTreatments
  delete projected.itemMedicalTreatmentProjection
  delete projected.itemExplorationProjection
  delete projected.serverPrivate
  if (equipmentState !== undefined && kind === 'trainer') delete projected.equipmentSlots
  if (equipmentState !== undefined && kind === 'pokemon'
    && projected.items && typeof projected.items === 'object' && !Array.isArray(projected.items)) {
    const items = { ...(projected.items as Record<string, unknown>) }
    delete items.held
    projected.items = items
  }
  if (projected.inventory && typeof projected.inventory === 'object' && !Array.isArray(projected.inventory)) {
    projected.inventory = Object.fromEntries(Object.entries(projected.inventory as Record<string, unknown>).map(([section, value]) => [
      section,
      Array.isArray(value) ? value.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
        const row = { ...(entry as Record<string, unknown>) }
        if (Object.hasOwn(row, 'serializedEquipment')) row.qty = 1
        delete row.serializedEquipment
        return row
      }) : value,
    ]))
  }
  if (equipmentState !== undefined && typeof projected.slug === 'string') {
    try {
      projected.equipmentProjection = projectSheetEquipmentStateForPlayer(equipmentState, {
        kind,
        slug: projected.slug,
      })
      const contributionProjection = projectEquipmentContributionsForSheet({
        kind,
        slug: projected.slug,
        sheet: sheet as unknown as CharacterSheet | TrainerSheet,
      })
      if (contributionProjection) projected.equipmentContributionProjection = contributionProjection
    }
    catch { /* Malformed, stale, or misbound authority is private and mechanically fail-closed. */ }
  }
  if (medicalTreatmentState !== undefined) {
    try {
      const state = parseItemMedicalTreatmentState(medicalTreatmentState)
      const projectedAt = state.entries.reduce((maximum, entry) => Math.max(
        maximum,
        entry.terminalCampaignMinute ?? entry.healedThroughCampaignMinute,
      ), 0)
      projected.itemMedicalTreatmentProjection = projectItemMedicalTreatments({
        sheet: sheet as unknown as CharacterSheet | TrainerSheet,
        campaignMinute: projectedAt,
      })
    }
    catch { /* Corrupt private lifecycle evidence is withheld and fails closed in mechanics. */ }
  }
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
