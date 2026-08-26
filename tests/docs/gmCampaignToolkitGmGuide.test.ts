import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const path = 'docs/gm-campaign-toolkit/gm-guide.md'
const read = (target: string): string => readFileSync(resolve(root, target), 'utf8')
const links = (source: string): readonly string[] => [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
  .map(match => match[1]!)
  .filter(target => !target.startsWith('#'))

describe('GM Campaign Toolkit GM and operator documentation', () => {
  it('documents the complete private preparation-to-play workflow and exact product boundaries', () => {
    const guide = read(path)
    expect(guide.length).toBeGreaterThan(10_000)
    for (const phrase of [
      'Campaign tables',
      'Wild encounter generation',
      'NPC Trainer packages',
      'Session preparation',
      'Encounter Builder and launch',
      'A preview is inert',
      'Ready preparation is still a plan',
      'ordinary campaign sheets',
      'Exact retry',
      'structurally separate server projection',
    ]) expect(guide).toContain(phrase)
    for (const bound of ['1–30 encounter slots', 'Select 1–10 candidates', 'up to 20 ordered scenes', 'at most 50 campaign documents', 'maximum of six']) {
      expect(guide).toContain(bound)
    }
  })

  it('documents contiguous migration, safe backup/restore, integrity audit, and fail-closed troubleshooting', () => {
    const guide = read(path)
    for (const version of ['**v51**', '**v52**', '**v53**', '**v54**', '**v55**', '**v56**']) expect(guide).toContain(version)
    for (const phrase of [
      'A database from a future schema is refused before writes.',
      'SQLite\'s online backup API',
      'npm run audit:gm-toolkit-storage -- --database <restored.sqlite>',
      'Stop writes and preserve the database plus WAL/SHM sidecars.',
      'The old pokegen script, host-process generation, file-result workflow, and file-backed table runtime are retired',
      'Never patch a hash, receipt, journal, generated sheet, custody link, or preparation JSON directly.',
    ]) expect(guide).toContain(phrase)
    expect(read('docs/complete-play-loop-operator-guide.md')).toContain('current application schema is 56')
    expect(read('docs/private-vps-backups.md')).toContain('audit:gm-toolkit-storage')
  })

  it('keeps every guide link local and resolvable and registers the guide in the docs index', () => {
    const guide = read(path)
    for (const target of links(guide)) {
      expect(target).not.toMatch(/^(?:https?:|\/\/)/u)
      expect(existsSync(resolve(root, dirname(path), target)), `${path} -> ${target}`).toBe(true)
    }
    expect(read('docs/README.md')).toContain('(gm-campaign-toolkit/gm-guide.md)')
  })
})
