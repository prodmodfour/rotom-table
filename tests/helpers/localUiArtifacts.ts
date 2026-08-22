import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const LOCAL_UI_ARTIFACT_PREFIX = '.pi/artifacts/' as const

export const isLocalUiArtifactPath = (path: string): boolean => (
  path.startsWith(LOCAL_UI_ARTIFACT_PREFIX) && !path.includes('..')
)

export const assertLocalUiArtifactPath = (path: string): void => {
  if (!isLocalUiArtifactPath(path)) {
    throw new Error(`Expected an ignored local UI artifact path, received ${path}.`)
  }
}

/**
 * UI workflow artifacts are intentionally ignored by Git. Repository tests may
 * verify one when it is present, but a clean checkout must not require it.
 */
export const readOptionalLocalUiArtifact = (root: string, path: string): Buffer | null => {
  assertLocalUiArtifactPath(path)
  const absolutePath = resolve(root, path)
  return existsSync(absolutePath) ? readFileSync(absolutePath) : null
}
