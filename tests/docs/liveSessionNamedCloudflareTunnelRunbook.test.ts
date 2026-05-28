import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

const collectMarkdown = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = resolve(directory, entry.name)

    if (entry.isDirectory()) return collectMarkdown(path)

    return entry.isFile() && entry.name.endsWith('.md') ? [path] : []
  })

const docsMarkdown = (): string[] => [
  'README.md',
  ...collectMarkdown(resolve(repoRoot, 'docs')).map((path) => relative(repoRoot, path)),
]

describe('profile-based play documentation boundaries', () => {
  it('documents current player-profile play and legacy live-session isolation', () => {
    const profileGuide = readText('docs/player-profiles.md')

    expect(profileGuide).toContain('persistent player profiles')
    expect(profileGuide).toContain('players normally open the relevant player-visible map')
    expect(profileGuide).toContain('Pokédex')
    expect(profileGuide).toContain('PTU reference pages')
    expect(profileGuide).toContain('Players do not need `/sessions`')
    expect(profileGuide).toContain('share link')
    expect(profileGuide).toContain('per-map invite')

    expect(readText('README.md')).toContain('docs/player-profiles.md')
    expect(readText('docs/README.md')).toContain('player-profiles.md')
    expect(readText('docs/live-session-product-readiness-review.md')).toContain('no longer the normal Rotom Table play guide')
    expect(readText('docs/live-session-lobby.md')).toContain('It does not describe normal map play')
  })

  it('keeps obsolete live-session-as-normal-play instructions out of docs', () => {
    const matches: string[] = []
    const forbidden = [
      /\?session=1/,
      /Visible session maps/,
      /Assign map tokens/,
      /Assign control/,
      /ready for trusted-table live-session rehearsal and play/i,
      /live-session map attachment doc/i,
    ]

    for (const path of docsMarkdown()) {
      const text = readText(path)
      const lines = text.split('\n')

      lines.forEach((line, index) => {
        for (const pattern of forbidden) {
          if (pattern.test(line)) matches.push(`${path}:${index + 1}: ${line}`)
        }
      })
    }

    expect(matches).toEqual([])
  })
})
