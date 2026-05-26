export const MAP_LIBRARY_PATH = '/maps'
export const MAP_SESSION_MODE_QUERY_VALUE = '1'

export const mapLibraryPath = (): typeof MAP_LIBRARY_PATH => MAP_LIBRARY_PATH

export const mapEditorPath = (slug: string): string => `${MAP_LIBRARY_PATH}/${encodeURIComponent(slug)}`

export const mapEditorSessionPath = (slug: string): string =>
  `${mapEditorPath(slug)}?session=${MAP_SESSION_MODE_QUERY_VALUE}`
