export const MAP_LIBRARY_PATH = '/maps'

export const mapLibraryPath = (): typeof MAP_LIBRARY_PATH => MAP_LIBRARY_PATH

export const mapEditorPath = (slug: string): string => `${MAP_LIBRARY_PATH}/${encodeURIComponent(slug)}`
