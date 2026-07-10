import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import menuStatusJson from '../../data/move-automation/menu-status.json'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const runGenerator = (args: readonly string[]) => spawnSync(
  'python3',
  ['scripts/generate_move_automation_menu_status.py', ...args],
  { cwd: repoRoot, encoding: 'utf8' },
)

const expectedProjection = () => ({
  schemaVersion: 1,
  moves: manifestJson.moves.map((row) => ({
    canonicalId: row.canonicalId,
    displayName: row.displayName,
    baseStatus: row.baseStatus,
    interactionStatus: row.interactionStatus,
    runtimeKind: row.runtime.kind,
    blockerCodes: row.blockerCodes,
    limitations: row.limitations,
    manualSteps: row.manualSteps,
  })),
})

describe('move automation menu status projection', () => {
  it('contains only the current bounded menu fields for every manifest row', () => {
    expect(menuStatusJson).toEqual(expectedProjection())

    const check = runGenerator(['--check'])
    expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0)
  })

  it('generates byte-stable output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rotom-move-menu-status-'))
    try {
      const firstPath = join(directory, 'first.json')
      const secondPath = join(directory, 'second.json')
      const first = runGenerator(['--output', firstPath])
      const second = runGenerator(['--output', secondPath])

      expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0)
      expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0)
      expect(readFileSync(firstPath)).toEqual(readFileSync(secondPath))
    }
    finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
