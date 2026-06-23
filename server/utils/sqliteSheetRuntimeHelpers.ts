import { basename, extname } from 'node:path'
import { validateSlug } from '#shared/paths'
import { normalizeRevision } from '#shared/sessionRevisions'
import type { SheetKind } from '#shared/sheets'
import { sqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { logicalSheetResourcePath } from './runtimeResourcePaths'

export const readRuntimeSheet = <T extends object>(
  kind: SheetKind,
  slug: string,
  repository: Pick<SheetRepository<Record<string, unknown>>, 'getByRef'> = sqliteSheetRepository,
): { readonly path: string; readonly sheet: T } | null => {
  const persisted = repository.getByRef(kind, slug)
  if (!persisted) return null
  return {
    path: logicalSheetResourcePath(kind, persisted.sheet),
    sheet: persisted.sheet as unknown as T,
  }
}

const kindFromLogicalSheetPath = (path: string): SheetKind => {
  if (path.startsWith('data/trainers/')) return 'trainer'
  return 'pokemon'
}

const slugFromSheetPathOrPayload = (path: string, sheet: Record<string, unknown>): string => {
  if (typeof sheet.slug === 'string' && sheet.slug.trim()) return validateSlug(sheet.slug, 'sheet slug')
  const fileName = path.split(/[\\/]/).pop() ?? ''
  return validateSlug(basename(fileName, extname(fileName)), 'sheet path slug')
}

export const writeRuntimeSheet = (
  path: string,
  sheet: Record<string, unknown>,
  repository: Pick<SheetRepository<Record<string, unknown>>, 'getByRef' | 'applyLivePlayUpdate'> = sqliteSheetRepository,
): void => {
  const kind = kindFromLogicalSheetPath(path)
  const slug = slugFromSheetPathOrPayload(path, sheet)
  const current = repository.getByRef(kind, slug)
  if (!current) throw new Error(`${kind} sheet ${slug} not found`)

  const requestedRevision = normalizeRevision(sheet.revision)
  const expectedRevision = requestedRevision > current.revision
    ? requestedRevision - 1
    : current.revision
  const result = repository.applyLivePlayUpdate({
    kind,
    slug,
    expectedRevision,
    nextSheet: sheet,
  })
  if (result !== 'applied') throw new Error(`${kind} sheet ${slug} changed before it could be persisted`)
}
