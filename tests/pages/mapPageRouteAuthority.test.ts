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
    expect(mapPage).toContain('documentTokenActions.useMove(request)')
    expect(mapPage).toContain('dispatchSetInitiative: (payload) => documentTokenActions.setInitiative(payload)')
    expect(mapPage).toContain('dispatchNextInitiative: () => documentTokenActions.nextInitiative()')
    expect(mapPage).toContain('dispatchPreviousInitiative: () => documentTokenActions.previousInitiative()')
    expect(mapPage).toContain('const setupEditModeActive = computed(() => isGm.value && (buildMode.value || adminPanelOpen.value))')
    expect(mapPage).toContain('documentTokenActions.placeHazard({ hazard })')
    expect(mapPage).toContain('documentTokenActions.removeHazard({ cell })')
    expect(mapPage).toContain('documentTokenActions.setFieldEffect({')
    expect(mapPage).toContain('documentTokenActions.tickFieldEffectDurations()')
    expect(mapPage).not.toContain('postJson<RecordMoveUsageResponse>')
    expect(mapPage).not.toContain('MAP_API_PATHS.useMove')
    expect(mapPage).not.toContain('applyRecordedSheetUsage')

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
