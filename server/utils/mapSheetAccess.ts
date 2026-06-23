import type { SheetKind } from '#shared/sheets'
import { sqliteMapRepository, type MapRepository, type StoredMapDocument } from '../storage/mapRepository'
import { normalizeMapDocument } from './mapNormalization'

const addPlayerVisibleMapSheetAccessKeys = (
  keys: Set<`${SheetKind}:${string}`>,
  map: { readonly playerVisible?: boolean; readonly placements?: readonly { readonly sheetKind: SheetKind; readonly sheetSlug: string }[] },
): void => {
  if (map.playerVisible !== true) return
  for (const placement of map.placements ?? []) {
    keys.add(`${placement.sheetKind}:${placement.sheetSlug}`)
  }
}

const storedMapDocumentToTabletopMap = (stored: StoredMapDocument<unknown>) => ({
  ...normalizeMapDocument(stored.document, { sourceLabel: `SQLite map ${stored.slug}` }),
  slug: stored.slug,
  revision: stored.revision,
  updatedAt: stored.updatedAt,
})

export const sqlitePlayerVisibleMapSheetAccessKeys = (
  mapRepository: Pick<MapRepository<unknown>, 'list'> = sqliteMapRepository,
): Set<`${SheetKind}:${string}`> => {
  const keys = new Set<`${SheetKind}:${string}`>()
  for (const stored of mapRepository.list()) {
    addPlayerVisibleMapSheetAccessKeys(keys, storedMapDocumentToTabletopMap(stored as StoredMapDocument<unknown>))
  }
  return keys
}
