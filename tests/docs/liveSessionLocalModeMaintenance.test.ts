import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')
const exists = (relativePath: string): boolean => existsSync(resolve(repoRoot, relativePath))

describe('Live session local-mode maintenance checks', () => {
  const audit = readText('docs/live-session-local-mode-maintenance.md')

  it('records the local-first maintenance baseline and scope', () => {
    expect(audit).toContain('local-first maintenance checks')
    expect(audit).toContain('Last checked: 2026-05-26')
    expect(audit).toContain('Current maintenance baseline: the checked local-first boundaries remain intact')
    expect(audit).toContain('Plain `npm run dev` remains the default local app')
    expect(audit).toContain('plain `/maps/<slug>` remains local-first')
    expect(audit).toContain('sheet editing still uses local autosave/persistence')
    expect(audit).toContain('legacy non-session realtime still uses `GET /api/events`')
    expect(audit).toContain('explicit `?session=1` map route')
    expect(audit).toContain('Local-first mode is the default')
    expect(audit).toContain('Live-session mode is explicit')
    expect(audit).toContain('Local and session state do not share write authority')
  })

  it('covers local map, sheet, realtime, and data-hygiene workflows', () => {
    expect(audit).toContain('map library create/list/rename/move/delete/load/save paths')
    expect(audit).toContain('token movement/facing, spawn/delete, send-out, initiative, hazards, field effects, terrain voxels')
    expect(audit).toContain('Pokémon and trainer sheet library/editor create/list/load/save/rename/move/delete paths')
    expect(audit).toContain('sheet autosave, unload flush, slug rename sync')
    expect(audit).toContain('legacy local realtime/SSE updates')
    expect(audit).toContain('private campaign maps/sheets, generated wild sheets, `data/sessions/`, snapshots, event logs')
  })

  it('names focused automated coverage for existing non-session behaviour', () => {
    const expectedCoverage = [
      'tests/server/sessionHostingHardening.test.ts',
      'tests/server/legacyRealtimeBoundary.test.ts',
      'tests/composables/useRealtime.test.ts',
      'tests/composables/localFirstEditingNoRegression.test.ts',
      'tests/composables/map-editor/useSessionMapEditorState.test.ts',
      'tests/composables/map-editor/sessionClientIntegration.test.ts',
      'tests/composables/map-editor/useTokenControls.test.ts',
      'tests/composables/map-editor/useInitiativeTracker.test.ts',
      'tests/composables/map-editor/useHazardBuilder.test.ts',
      'tests/composables/map-editor/useFieldEffectsEditor.test.ts',
      'tests/composables/map-editor/useTerrainBuilder.test.ts',
      'tests/composables/map-editor/useTokenSheetMutations.test.ts',
      'tests/server/saveSheet.test.ts',
      'tests/server/loadMap.test.ts',
      'tests/utils/autosave.test.ts',
      'tests/utils/sheets/persistence.test.ts',
    ]

    for (const coveragePath of expectedCoverage) {
      expect(audit).toContain(coveragePath)
      expect(exists(coveragePath)).toBe(true)
    }
  })

  it('keeps source-level local/session route boundaries locked', () => {
    const mapRoute = readText('src/pages/maps/[slug].vue')
    expect(mapRoute).toContain('useEditableMap(slug, {')
    expect(mapRoute).toContain('autosaveEnabled: computed(() => !sessionMoveTokenEnabled.value)')
    expect(mapRoute).toContain('isSessionModeQueryEnabled(route.query.session)')
    expect(mapRoute).toContain('if (sessionMoveTokenEnabled.value)')
    expect(mapRoute).toContain('deletePlacement(id)')
    expect(mapRoute).toContain('await modifyHp(payload, options)')
    expect(mapRoute).toContain('nextInitiative()')
    expect(mapRoute).toContain('placeHazard(hazard)')
    expect(mapRoute).toContain('placeVoxel(voxel)')
    expect(mapRoute).toContain('sendOutPokemon(payload)')

    const editableMap = readText('src/composables/useEditableMap.ts')
    expect(editableMap).toContain('MAP_API_PATHS.save')
    expect(editableMap).toContain('useRealtimeChannel(mapChannel(slug)')
    expect(editableMap).not.toContain('/api/sessions/socket')

    const editableSheet = readText('src/composables/useEditableSheet.ts')
    expect(editableSheet).toContain('SHEET_API_PATHS.save')
    expect(editableSheet).toContain('subscribeChannel(sheetChannel(kind, nextSlug), handleRealtimeEvent)')
    expect(editableSheet).not.toContain('/api/sessions/socket')

    const realtime = readText('src/composables/useRealtime.ts')
    expect(realtime).toContain('EventSource')
    expect(realtime).toContain('/api/events')
    expect(realtime).not.toContain('/api/sessions/socket')
  })

  it('documents accepted limitations without changing locked architecture', () => {
    expect(audit).toContain('last-writer-wins semantics')
    expect(audit).toContain('intended local-first behaviour')
    expect(audit).toContain('not the live-session concurrency mechanism')
    expect(audit).toContain('Production write limitations remain')
    expect(audit).toContain('`/login` GM/player role picker remains a trust switch')
    expect(audit).toContain('not public authentication')
    expect(audit).toContain('do not broaden Live session into public authentication, SaaS hosting, a generic collaborative document editor, cloud persistence, or Quick Tunnel campaign hosting')
  })

  it('is linked from primary Live session and local-development docs', () => {
    expect(readText('README.md')).toContain('docs/live-session-local-mode-maintenance.md')
    expect(readText('docs/README.md')).toContain('live-session-local-mode-maintenance.md')
    const localDevelopment = readText('docs/local-development.md')
    expect(localDevelopment).toContain('Local-first versus live-session mode')
    expect(localDevelopment).toContain('Plain `npm run dev` is local-first mode')
    expect(localDevelopment).toContain('Leaving `?session=1` off is the intended local-first editing path')
    expect(localDevelopment).toContain('live-session-local-mode-maintenance.md')
    expect(readText('docs/live-session-roadmap.md')).toContain('live-session-local-mode-maintenance.md')
    expect(readText('docs/live-session-validation-matrix.md')).toContain('live-session-local-mode-maintenance.md')
    expect(readText('docs/live-session-client-integration.md')).toContain('live-session-local-mode-maintenance.md')
    expect(readText('docs/live-session-command-flow-maintenance.md')).toContain('live-session-local-mode-maintenance.md')
  })
})
