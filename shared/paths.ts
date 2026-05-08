export const SLUG_RE = /^[a-z0-9-]+$/
export const SLUG_PATTERN_DESCRIPTION = '/^[a-z0-9-]+$/'
export const SAFE_FOLDER_SEGMENT_RE = /^[A-Za-z0-9_-]+$/
export const SAFE_FOLDER_SEGMENT_PATTERN_DESCRIPTION = '/^[A-Za-z0-9_-]+$/'

export interface SanitizeFolderPathOptions {
  allowEmpty?: boolean
  label?: string
}

export const isSlug = (value: unknown): value is string =>
  typeof value === 'string' && SLUG_RE.test(value)

export const validateSlug = (value: unknown, label = 'slug'): string => {
  const slug = String(value ?? '')
  if (!SLUG_RE.test(slug)) {
    throw new Error(`${label} must match ${SLUG_PATTERN_DESCRIPTION}`)
  }
  return slug
}

export const sanitizeFolderPath = (
  path: string,
  options: SanitizeFolderPathOptions = {},
): string => {
  const { allowEmpty = false, label = 'folder' } = options
  const trimmed = path.replace(/^\/+|\/+$/g, '').trim()
  if (!trimmed) {
    if (allowEmpty) return ''
    throw new Error(`${label} must not be empty`)
  }
  for (const seg of trimmed.split('/')) {
    if (!SAFE_FOLDER_SEGMENT_RE.test(seg)) {
      throw new Error(`${label} segment "${seg}" must match ${SAFE_FOLDER_SEGMENT_PATTERN_DESCRIPTION}`)
    }
  }
  return trimmed
}

export const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
