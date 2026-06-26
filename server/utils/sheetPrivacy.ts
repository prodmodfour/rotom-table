import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { redactPokemonGmFields } from '~/utils/sheets/pokemonGmFields'

export type SheetPrivacyDocument = CharacterSheet | TrainerSheet

export interface SheetUpdateRecord<TSheet extends Record<string, unknown> = Record<string, unknown>> {
  readonly kind: SheetKind
  readonly sheet: TSheet
}

export const redactSheetRecordForPlayer = <TSheet extends Record<string, unknown>>(
  kind: SheetKind,
  sheet: TSheet,
): TSheet => (kind === 'pokemon' ? redactPokemonGmFields(sheet) : sheet)

export const redactSheetForPlayer = <TSheet extends SheetPrivacyDocument>(
  kind: SheetKind,
  sheet: TSheet,
): TSheet => redactSheetRecordForPlayer(kind, sheet as unknown as Record<string, unknown>) as unknown as TSheet

export const redactSheetUpdateForPlayer = <TUpdate extends SheetUpdateRecord>(update: TUpdate): TUpdate => {
  if (update.kind !== 'pokemon') return update
  return {
    ...update,
    sheet: redactSheetRecordForPlayer(update.kind, update.sheet),
  }
}

export const redactSheetUpdatesForPlayer = <TUpdate extends SheetUpdateRecord>(
  updates: readonly TUpdate[] | undefined,
): TUpdate[] | undefined => updates?.map((update) => redactSheetUpdateForPlayer(update))
