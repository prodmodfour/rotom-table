import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readSource = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('map page route authority', () => {
  it('uses the saved map route regardless of the session query parameter', () => {
    const mapPage = readSource('src/pages/maps/[slug].vue')

    expect(mapPage).toContain('key: (route) => `map-${routeSlugParam(route.params)}`')
    expect(mapPage).toContain('useEditableMap(slug, {')
    expect(mapPage).not.toContain('route.query.session')
    expect(mapPage).not.toContain('isSessionModeQueryEnabled')
    expect(mapPage).not.toContain('useSessionMap(')
    expect(mapPage).not.toContain('useSessionMoveTokenDispatch')
    expect(mapPage).not.toContain('useSessionMapSceneCommands')
    expect(mapPage).not.toContain('sessionMoveTokenEnabled')
    expect(mapPage).not.toContain('autosaveEnabled: computed(() => !session')
  })
})
