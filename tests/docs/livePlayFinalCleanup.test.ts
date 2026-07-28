import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const readRepoText = (relativePath: string): string => readFileSync(join(repoRoot, relativePath), 'utf8')

const activeSourceFiles = [
  'src/pages/maps/[slug].vue',
  'src/composables/map-editor/useLivePlayCommands.ts',
  'server/api/maps/tokens/use-ability.post.ts',
  'server/api/maps/tokens/use-maneuver.post.ts',
  'server/api/maps/tokens/use-order.post.ts',
  'server/useCases/applyMapTokenTableAction.ts',
] as const

describe('final live-play cleanup guardrails', () => {
  it('keeps README and docs pointed at the current live-play authority material', () => {
    const readme = readRepoText('README.md')
    const docsIndex = readRepoText('docs/README.md')

    expect(readme).toContain('docs/live-play-authority.md')
    expect(readme).toContain('docs/adrs/009-server-authoritative-profile-play.md')
    expect(readme).toContain('docs/private-vps-live-play-smoke.md')
    expect(docsIndex).toContain('live-play-authority.md')
    expect(docsIndex).toContain('adrs/009-server-authoritative-profile-play.md')
    expect(docsIndex).toContain('private-vps-live-play-smoke.md')
  })

  it('removes obsolete direct live-save use cases and tests', () => {
    expect(existsSync(join(repoRoot, 'server/useCases/recordMoveUsage.ts'))).toBe(false)
    expect(existsSync(join(repoRoot, 'tests/server/recordMoveUsage.test.ts'))).toBe(false)
    expect(existsSync(join(repoRoot, 'tests/server/applyMapTokenAction.test.ts'))).toBe(false)

    const tokenActionSource = readRepoText('server/useCases/applyMapTokenAction.ts')
    expect(tokenActionSource).not.toContain('spawnMapTokenUseCase')
    expect(tokenActionSource).not.toContain('moveMapTokenUseCase')
    expect(tokenActionSource).not.toContain('turnMapTokenUseCase')
  })

  it('keeps normal map live-play UI away from whole-document save endpoints', () => {
    for (const relativePath of [
      'src/pages/maps/[slug].vue',
      'src/composables/map-editor/useLivePlayCommands.ts',
    ] as const) {
      const source = readRepoText(relativePath)
      expect(source, relativePath).not.toContain('/api/maps/save')
      expect(source, relativePath).not.toContain('/api/sheets/save')
      expect(source, relativePath).not.toContain('SHEET_API_PATHS.save')
      expect(source, relativePath).not.toContain('MAP_API_PATHS.save')
    }
  })

  it('routes manoeuvre and order commands separately from native Ability declarations', () => {
    const dispatcher = readRepoText('src/composables/map-editor/useLivePlayCommands.ts')
    expect(dispatcher).toContain('LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER')
    expect(dispatcher).not.toContain('LIVE_PLAY_COMMAND_TYPES.USE_ABILITY')
    expect(dispatcher).toContain('LIVE_PLAY_COMMAND_TYPES.USE_ORDER')
    expect(dispatcher).toContain("mapScope('metadata')")
    expect(dispatcher).not.toContain('server-side command executors are migrated')
    expect(dispatcher).not.toContain('slug: options.slug')
    expect(dispatcher).not.toContain('const runAction')

    for (const relativePath of activeSourceFiles) {
      const source = readRepoText(relativePath)
      expect(source, relativePath).not.toContain('useMapTokenAbilityUseCase')
      expect(source, relativePath).not.toContain('useMapTokenManeuverUseCase')
      expect(source, relativePath).not.toContain('useMapTokenOrderUseCase')
      expect(source, relativePath).not.toContain('recordMoveUsageUseCase')
    }

    const legacyAbilityRoute = readRepoText('server/api/maps/tokens/use-ability.post.ts')
    expect(legacyAbilityRoute).toContain('statusCode: 410')
    expect(legacyAbilityRoute).not.toContain('executeLivePlayTableActionCommandUseCase')
    expect(readRepoText('src/pages/maps/[slug].vue')).toContain('useAbilityAutomationGateway')
    expect(readRepoText('server/api/maps/tokens/use-maneuver.post.ts')).toContain('executeLivePlayTableActionCommandUseCase')
    expect(readRepoText('server/api/maps/tokens/use-order.post.ts')).toContain('executeLivePlayTableActionCommandUseCase')
  })
})
