import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readSource = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('map navigation rail', () => {
  it('keeps map navigation focused on normal app navigation instead of live-session attach controls', () => {
    const rail = readSource('src/components/map/MapNavigationRail.vue')
    const mapPage = readSource('src/pages/maps/[slug].vue')

    expect(rail).toContain('AppNavigation')
    expect(rail).not.toContain('MapSessionNavigationPanel')
    expect(rail).not.toContain('useSessionLobby')
    expect(rail).not.toContain('attachMapToSession')
    expect(rail).not.toContain('Attach current map')
    expect(rail).not.toContain('Visible session maps')
    expect(mapPage).not.toContain(':map-tokens="sessionAssignmentTokens"')
    expect(mapPage).not.toContain(':session-mode-enabled="sessionMoveTokenEnabled"')
  })
})
