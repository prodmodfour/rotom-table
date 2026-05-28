import type { AuthRole } from '#shared/auth'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { SheetKind } from '#shared/sheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { playerCanAccessSheet } from '../policies/playerProfilePolicy'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { readSheetFileWithFolder } from '../utils/sheetStorage'

export class LoadSheetUseCaseError extends UseCaseHttpError<403 | 404> {}

export type LoadedSheet = CharacterSheet | TrainerSheet

export type PlayerSheetLoadAccessPredicate = (
  kind: SheetKind,
  slug: string,
  sheet: LoadedSheet,
) => boolean

export interface LoadSheetInput {
  role: AuthRole
  kind: SheetKind
  slug: string
  playerProfile?: PlayerProfile | null
  canAccessPlayerSheet?: PlayerSheetLoadAccessPredicate
}

export interface LoadSheetDependencies {
  readSheet?: (kind: SheetKind, slug: string) => { sheet: LoadedSheet } | null
}

export interface LoadSheetResult {
  kind: SheetKind
  slug: string
  sheet: LoadedSheet
}

export const loadSheetUseCase = (
  input: LoadSheetInput,
  dependencies: LoadSheetDependencies = {},
): LoadSheetResult => {
  const readSheet = dependencies.readSheet
    ?? ((kind: SheetKind, slug: string) => readSheetFileWithFolder<LoadedSheet>(kind, slug))
  const result = readSheet(input.kind, input.slug)

  if (!result) throw new LoadSheetUseCaseError(404, `Sheet ${input.slug}.json not found`)
  if (
    input.role === 'player' &&
    !playerCanAccessSheet({
      kind: input.kind,
      slug: input.slug,
      sheet: result.sheet,
      playerProfile: input.playerProfile,
      canAccessPlayerSheet: input.canAccessPlayerSheet,
    })
  ) {
    throw new LoadSheetUseCaseError(
      403,
      'Sheet is not marked as player accessible or linked to the selected player profile',
    )
  }

  return {
    kind: input.kind,
    slug: input.slug,
    sheet: result.sheet,
  }
}
