import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')
const join = (...parts: string[]): string => parts.join('')

type Rule = {
  label: string
  pattern: RegExp
}

type Example = {
  label: string
  value: string
}

const contentRules: Rule[] = [
  {
    label: 'old session phase name',
    pattern: new RegExp(`${join('tr', 'ack')}[\\s_-]*2`, 'i'),
  },
  {
    label: 'old completion phrase',
    pattern: new RegExp(join('autonomous', ' completion'), 'i'),
  },
  {
    label: 'old external-process phrase',
    pattern: new RegExp(`${join('outer')}[\\s_-]*${join('controller')}`, 'i'),
  },
  {
    label: 'old review-process phrase',
    pattern: new RegExp(`${join('chunk')}[\\s_-]*${join('PR')}`, 'i'),
  },
  {
    label: 'old controller phrase',
    pattern: new RegExp(`${join('build')}[\\s_-]*${join('controller')}`, 'i'),
  },
  {
    label: 'numbered process note',
    pattern: new RegExp(`${join('tick', 'et')}s?[\\s_-]+0\\d\\d`, 'i'),
  },
]

const filenameRules: Rule[] = [
  {
    label: 'old session phase filename',
    pattern: new RegExp(`${join('tr', 'ack')}[-_]?2`, 'i'),
  },
  {
    label: 'old completion filename',
    pattern: new RegExp(join('autonomous', '.*completion|completion', '-marker'), 'i'),
  },
  {
    label: 'old external-process filename',
    pattern: new RegExp(`${join('outer')}[-_]?${join('controller')}`, 'i'),
  },
  {
    label: 'old review-process filename',
    pattern: new RegExp(`${join('chunk')}[-_]?${join('pr')}`, 'i'),
  },
  {
    label: 'old controller filename',
    pattern: new RegExp(`${join('build')}[-_]?${join('controller')}`, 'i'),
  },
]

const contentExamples: Example[] = [
  {
    label: 'spaced phase name',
    value: `${join('Tr', 'ack')} 2`,
  },
  {
    label: 'compact phase name',
    value: `${join('tr', 'ack')}2`,
  },
  {
    label: 'hyphenated phase name',
    value: `${join('track')}-2`,
  },
  {
    label: 'underscored phase name',
    value: `${join('track')}_2`,
  },
  {
    label: 'completion phrase',
    value: join('autonomous', ' completion'),
  },
  {
    label: 'external-process phrase',
    value: join('outer', ' controller'),
  },
  {
    label: 'review-process phrase',
    value: join('chunk', ' PR'),
  },
  {
    label: 'controller phrase',
    value: join('build', ' controller'),
  },
  {
    label: 'singular numbered note',
    value: join('ticket', ' 004'),
  },
  {
    label: 'plural numbered note',
    value: join('tickets', ' 004'),
  },
]

const filenameExamples: Example[] = [
  {
    label: 'compact phase path',
    value: `docs/${join('track', '2')}-notes.md`,
  },
  {
    label: 'hyphenated phase path',
    value: `docs/${join('track', '-2')}-notes.md`,
  },
  {
    label: 'underscored phase path',
    value: `tests/docs/${join('track', '_2')}Notes.test.ts`,
  },
  {
    label: 'completion process path',
    value: `docs/${join('autonomous', '-completion')}.md`,
  },
  {
    label: 'marker path',
    value: `docs/${join('completion', '-marker')}.md`,
  },
  {
    label: 'external-process path',
    value: `docs/${join('outer', '-controller')}.md`,
  },
  {
    label: 'review-process path',
    value: `docs/${join('chunk', '-pr')}.md`,
  },
  {
    label: 'controller path',
    value: `docs/${join('build', '-controller')}.md`,
  },
]

const trackedFiles = (): string[] => execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\n')
  .map((file) => file.trim())
  .filter(Boolean)

const toText = (relativePath: string): string | undefined => {
  const absolutePath = resolve(repoRoot, relativePath)

  if (!existsSync(absolutePath)) return undefined

  const bytes = readFileSync(absolutePath)
  if (bytes.includes(0)) return undefined

  return bytes.toString('utf8')
}

const matchesAny = (rules: Rule[], value: string): boolean => rules.some((rule) => rule.pattern.test(value))

describe('product terminology guard', () => {
  it('recognizes the forbidden content terms used by the repository leakage scan', () => {
    for (const example of contentExamples) {
      expect(matchesAny(contentRules, example.value), example.label).toBe(true)
    }
  })

  it('recognizes forbidden tracked filename terms before file content is read', () => {
    for (const example of filenameExamples) {
      expect(matchesAny(filenameRules, example.value), example.label).toBe(true)
    }
  })

  it('scans tracked app, docs, test, and script files', () => {
    const files = trackedFiles()

    for (const expectedPath of [
      'README.md',
      'docs/live-session-readiness-summary.md',
      'scripts/session-host-dev.mjs',
      'server/api/sessions/start.post.ts',
      'shared/sessionCommands.ts',
      'src/pages/sessions.vue',
      'tests/docs/productTerminologyGuard.test.ts',
    ]) {
      expect(files, `${expectedPath} should be scanned`).toContain(expectedPath)
    }
  })

  it('keeps old process language out of tracked target filenames and content', () => {
    const filenameMatches: string[] = []
    const contentMatches: string[] = []

    for (const relativePath of trackedFiles()) {
      for (const rule of filenameRules) {
        if (rule.pattern.test(relativePath)) {
          filenameMatches.push(`${relativePath} (${rule.label})`)
        }
      }

      const text = toText(relativePath)
      if (text === undefined) continue

      const lines = text.split('\n')
      lines.forEach((line, index) => {
        for (const rule of contentRules) {
          if (rule.pattern.test(line)) {
            contentMatches.push(`${relativePath}:${index + 1} (${rule.label})`)
          }
        }
      })
    }

    expect({ filenameMatches, contentMatches }).toEqual({
      filenameMatches: [],
      contentMatches: [],
    })
  })
})
