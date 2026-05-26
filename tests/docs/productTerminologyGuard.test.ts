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
    pattern: new RegExp(`${join('tick', 'et')}s?\\s+0\\d\\d`, 'i'),
  },
]

const filenameRules: Rule[] = [
  {
    label: 'old session phase filename',
    pattern: new RegExp(`(^|/)${join('tr', 'ack')}[-_]?2`, 'i'),
  },
  {
    label: 'old completion filename',
    pattern: new RegExp(join('autonomous', '.*completion|completion', '-marker'), 'i'),
  },
  {
    label: 'old review-process filename',
    pattern: new RegExp(join('chunk', '-pr'), 'i'),
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

describe('product terminology guard', () => {
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
