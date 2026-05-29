import { existsSync, mkdirSync } from 'node:fs'
import { sep } from 'node:path'
import {
  SAFE_FOLDER_SEGMENT_RE,
  SLUG_RE as SHARED_SLUG_RE,
  sanitizeFolderPath as sanitizeSharedFolderPath,
  slugify as sharedSlugify,
} from '#shared/paths'
import { CAMPAIGN_MAPS_ROOT, campaignPathLabel } from './campaignPaths'
import { pruneEmptyParents } from './fsPaths'

export const MAPS_ROOT = CAMPAIGN_MAPS_ROOT
export const SLUG_RE = SHARED_SLUG_RE
export const SAFE_SEGMENT = SAFE_FOLDER_SEGMENT_RE

export const ensureMapsRoot = (): void => {
  if (!existsSync(MAPS_ROOT)) mkdirSync(MAPS_ROOT, { recursive: true })
}

export const folderFromPath = (filePath: string): string => {
  const rel = filePath.slice(MAPS_ROOT.length + 1).split(sep).join('/')
  const lastSlash = rel.lastIndexOf('/')
  if (lastSlash === -1) return ''
  return rel.slice(0, lastSlash)
}

export const mapPathLabel = (filePath: string): string => campaignPathLabel(filePath)

/** Walk up from `path`, removing empty map directories until we leave `MAPS_ROOT`. */
export const pruneEmptyMapParents = (path: string): void => {
  pruneEmptyParents(path, MAPS_ROOT)
}

export const sanitizeMapFolderPath = (path: string, allowEmpty = false): string =>
  sanitizeSharedFolderPath(path, { allowEmpty })

export const slugify = sharedSlugify
