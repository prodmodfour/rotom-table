import type { SheetKind } from '#shared/sheets'

export const logicalMapResourcePath = (resource: { readonly slug?: unknown; readonly folder?: unknown }): string => {
  const folder = typeof resource.folder === 'string' && resource.folder.length > 0
    ? `${resource.folder.replace(/^\/+|\/+$/g, '')}/`
    : ''
  return `data/maps/${folder}${String(resource.slug ?? '')}.json`
}

export const logicalSheetResourcePath = (
  kind: SheetKind,
  resource: { readonly slug?: unknown; readonly folder?: unknown },
): string => {
  const root = kind === 'pokemon' ? 'data/sheets' : 'data/trainers'
  const folder = typeof resource.folder === 'string' && resource.folder.length > 0
    ? `${resource.folder.replace(/^\/+|\/+$/g, '')}/`
    : ''
  return `${root}/${folder}${String(resource.slug ?? '')}.json`
}

export const logicalMapFolderPath = (folder: string): string => `data/maps/${folder}`

export const logicalSheetFolderPath = (kind: SheetKind, folder: string): string => {
  const root = kind === 'pokemon' ? 'data/sheets' : 'data/trainers'
  return `${root}/${folder}`
}
