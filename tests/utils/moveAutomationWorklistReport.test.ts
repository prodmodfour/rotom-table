import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('move automation worklist report', () => {
  it('prints planning buckets without failing incomplete coverage', () => {
    const result = spawnSync('python3', ['scripts/check_move_automation_coverage.py', '--report'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Move automation worklist report')
    expect(result.stdout).toMatch(/Canonical valid move count: \d+/)
    expect(result.stdout).toMatch(/Explicit script count: \d+/)
    expect(result.stdout).toMatch(/Missing script count: \d+/)
    expect(result.stdout).toContain('plain-single-target-damage (')
    expect(result.stdout).toContain('complex-review-needed (')
    expect(result.stdout).toContain('Recommended next safest batch (')

    const recommendedSection = result.stdout.split(/\nRecommended next safest batch \(\d+ moves\):\n/)[1] ?? ''
    for (const moveName of ['Frost Breath', 'Storm Throw', 'Spacial Rend', 'Aura Wheel', 'Hammer Arm', 'Ice Hammer']) {
      expect(recommendedSection).not.toContain(`  - ${moveName}`)
    }
  })
})
