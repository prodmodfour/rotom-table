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
    expect(mapPage).toContain('interactionMode: mapInteractionMode')
    expect(mapPage).toContain('MAP_INTERACTION_MODES.LIVE_PLAY')
    expect(mapPage).not.toContain('route.query.session')
    expect(mapPage).not.toContain('isSessionModeQueryEnabled')
    expect(mapPage).not.toContain('useSessionMap(')
    expect(mapPage).not.toContain('useSessionMoveTokenDispatch')
    expect(mapPage).not.toContain('useSessionMapSceneCommands')
    expect(mapPage).not.toContain('sessionMoveTokenEnabled')
    expect(mapPage).not.toContain('autosaveEnabled: computed(() => !session')
    expect(mapPage).not.toContain('shouldUseDocumentTokenActions')
    expect(mapPage).not.toContain('turnPlacement,')
    expect(mapPage).not.toContain('movePlacement,')

    const scenePanel = readSource('src/components/map/MapScenePanel.vue')
    expect(scenePanel).not.toContain('SessionCommandRejectionBanner')
    expect(scenePanel).not.toContain('SessionConnectionStatusBanner')
    expect(scenePanel).not.toContain('SessionPresencePanel')
    expect(scenePanel).not.toContain('refresh-session-snapshot')
    expect(scenePanel).not.toContain('dismiss-session-command-rejection')

    const tokenControls = readSource('src/composables/map-editor/useTokenControls.ts')
    expect(tokenControls).not.toContain('sessionMoveTokenDispatcher')
    expect(tokenControls).not.toContain('sessionTokenControl')
    expect(tokenControls).not.toContain('dispatchMoveToken')
    expect(tokenControls).not.toContain('dispatchTurnToken')

    const mapAccess = readSource('src/composables/map-editor/useMapAccess.ts')
    expect(mapAccess).not.toContain('sessionModeEnabled')
    expect(mapAccess).not.toContain('hasAuthoritativeSessionState')
  })
})
