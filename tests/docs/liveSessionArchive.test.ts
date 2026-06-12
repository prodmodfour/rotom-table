import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')
const archiveNote = 'These documents describe obsolete/maintenance-only session infrastructure and are not the current multiplayer architecture.'

const readRepoText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')
const listMarkdownFiles = (root: string): string[] => {
  const absoluteRoot = resolve(repoRoot, root)
  const walk = (directory: string): string[] => readdirSync(directory).flatMap((entry) => {
    const absolutePath = join(directory, entry)
    const relativePath = absolutePath.slice(repoRoot.length + 1)
    if (statSync(absolutePath).isDirectory()) return walk(absolutePath)
    return relativePath.endsWith('.md') ? [relativePath] : []
  })

  return existsSync(absoluteRoot) ? walk(absoluteRoot).sort() : []
}

describe('legacy live-session archive', () => {
  it('keeps legacy live-session documents and ADRs under the archive with an explicit obsolete note', () => {
    const docsRootFiles = readdirSync(resolve(repoRoot, 'docs'))
      .filter((fileName) => /^live-session.*\.md$/.test(fileName))
      .sort()
    expect(docsRootFiles).toEqual([])

    const activeAdrFiles = readdirSync(resolve(repoRoot, 'docs/adrs'))
      .filter((fileName) => /^00[1-8]-.*\.md$/.test(fileName))
      .sort()
    expect(activeAdrFiles).toEqual([])

    const archivedFiles = readdirSync(resolve(repoRoot, 'docs/archive/live-session'))
      .filter((fileName) => /^live-session.*\.md$/.test(fileName))
      .sort()
    const archivedAdrFiles = readdirSync(resolve(repoRoot, 'docs/archive/live-session/adrs'))
      .filter((fileName) => /^00[1-8]-.*\.md$/.test(fileName))
      .sort()

    expect(archivedFiles).toContain('live-session-roadmap.md')
    expect(archivedFiles).toContain('live-session-protocol.md')
    expect(archivedFiles).toContain('live-session-socket-protocol.md')
    expect(archivedFiles).toContain('live-session-security-boundaries.md')
    expect(archivedAdrFiles).toContain('001-gm-hosted-session-model.md')
    expect(archivedAdrFiles).toContain('008-session-runtime-safety-flag.md')

    for (const fileName of archivedFiles) {
      const leadingText = readRepoText(`docs/archive/live-session/${fileName}`).split('\n').slice(0, 6).join('\n')
      expect(leadingText, fileName).toContain(archiveNote)
    }
    for (const fileName of archivedAdrFiles) {
      const leadingText = readRepoText(`docs/archive/live-session/adrs/${fileName}`).split('\n').slice(0, 6).join('\n')
      expect(leadingText, fileName).toContain(archiveNote)
    }

    const archiveIndex = readRepoText('docs/archive/live-session/README.md')
    expect(archiveIndex).toContain(archiveNote)
    expect(archiveIndex).toContain('[Live play authority](../../live-play-authority.md)')
    expect(archiveIndex).toContain('[ADR 001: GM-hosted session model](adrs/001-gm-hosted-session-model.md)')
    expect(archiveIndex).toContain('Session hosting still fails closed unless `ROTOM_ENABLE_SESSION_HOST=1` is set.')
  })

  it('keeps active documentation pointing to the archive and current live-play authority', () => {
    const docsIndex = readRepoText('docs/README.md')
    expect(docsIndex).toContain('[Live play authority](live-play-authority.md)')
    expect(docsIndex).toContain('[Archived legacy live-session documents](archive/live-session/README.md)')
    expect(docsIndex).not.toContain('](live-session')

    const livePlayAuthority = readRepoText('docs/live-play-authority.md')
    expect(livePlayAuthority).toContain('[Archived legacy live-session documents](archive/live-session/README.md)')
    expect(livePlayAuthority).toContain('normal profile play')

    const architecture = readRepoText('docs/architecture.md')
    expect(architecture).toContain('[Archived legacy live-session documents](archive/live-session/README.md)')
    expect(architecture).toContain('They are not the normal profile-play architecture')

    const security = readRepoText('SECURITY.md')
    expect(security).toContain('[docs/archive/live-session/README.md](docs/archive/live-session/README.md)')
    expect(security).toContain('is not the current multiplayer architecture')
  })

  it('keeps searchable legacy session language inside the archive only', () => {
    const markdownFiles = [
      'README.md',
      'SECURITY.md',
      ...listMarkdownFiles('docs'),
    ]

    for (const relativePath of markdownFiles) {
      const text = readRepoText(relativePath)
      const searchableText = text.toLowerCase()
      const legacyRoadmapPhrase = ['live session', 'roadmap'].join(' ')
      const sessionAuthorityPhrase = ['session-owned map', 'authority'].join(' ')
      const hasLegacySearchPhrase = searchableText.includes(legacyRoadmapPhrase)
        || searchableText.includes(sessionAuthorityPhrase)

      if (!hasLegacySearchPhrase) continue

      expect(relativePath, `${relativePath} contains legacy search language outside the archive`)
        .toMatch(/^docs\/archive\/live-session\//)
    }
  })

  it('keeps normal map play source independent from legacy session routes and lobby helpers', () => {
    const normalPlaySources = [
      'src/pages/maps/[slug].vue',
      'src/composables/map-editor/useLivePlayCommands.ts',
      'src/components/map/MapScenePanel.vue',
    ] as const

    for (const relativePath of normalPlaySources) {
      const source = readRepoText(relativePath)
      expect(source, relativePath).not.toContain('/api/sessions')
      expect(source, relativePath).not.toContain('/sessions')
      expect(source, relativePath).not.toContain('useSessionLobby')
      expect(source, relativePath).not.toContain('SESSION_LOBBY')
      expect(source, relativePath).not.toContain('route.query.session')
      expect(source, relativePath).not.toContain('session-owned map')
    }
  })
})
